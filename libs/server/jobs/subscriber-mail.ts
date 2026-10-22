import type postgres from "postgres"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { button, paragraph, renderLetter } from "@spy4x/email/letter"
import { sendIssue } from "@spy4x/server/subscribers"
import {
  createPostgresSendLog,
  createPostgresSubscriberStore,
} from "@spy4x/server/subscribers/postgres"
import { isSubscriberList, type SubscriberList } from "@domain/subscribers"
import {
  createListCrypto,
  subscriberConfirmLink,
  subscriberPagesUrl,
  type SubscribersSetup,
  subscriberUnsubscribeLink,
} from "../subscribers/subscribers.ts"
import type { MailBrand } from "../mail/mail.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** Mails a confirm link to an address that asked to join a list. */
export const SUBSCRIBER_CONFIRM_MAIL_JOB = `subscribers.confirm-mail`

/** Mails the welcome, with its one-click unsubscribe, after an address confirmed. */
export const SUBSCRIBER_WELCOME_MAIL_JOB = `subscribers.welcome-mail`

/** Mails one stored issue to a list. */
export const SUBSCRIBER_SEND_ISSUE_JOB = `subscribers.send-issue`

/** A request the worker never managed to handle is removed after this long. */
export const SUBSCRIPTION_REQUEST_RETENTION_HOURS = 24

/** The two jobs that mail one address, each from a `subscription_requests` row. */
export type SubscriberMailJob =
  | typeof SUBSCRIBER_CONFIRM_MAIL_JOB
  | typeof SUBSCRIBER_WELCOME_MAIL_JOB

/**
 * Queues one mail to `email` for `list`. A subscribe request writes the same row and job for a
 * listed address and a new one, so neither the answer nor the writes tell which. The row is written
 * before its job, as for a password reset: the worker never runs a job whose row is not there yet.
 */
export async function enqueueSubscriberMail(
  sql: postgres.Sql,
  job: SubscriberMailJob,
  list: string,
  email: string,
): Promise<void> {
  const id = uuidV7()
  await sql`INSERT INTO subscription_requests (id, list_id, email) VALUES (${id}, ${list}, ${email})`
  await enqueueJob(sql, job, id, { inMs: 0 })
}

/** What the subscriber jobs need. */
export interface SubscriberMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: a request is dropped, an issue is left for a later rerun. */
  sender: EmailSender | null
  brand: MailBrand
  /** `null` when subscriptions are off: the jobs drop what they find. */
  setup: SubscribersSetup | null
  /** Told what went wrong. Gets no address, token or link. */
  log: (line: string) => void
}

interface RequestRow {
  listId: string
  email: string
}

/** A request row whose list the app still has. */
interface ListRequest {
  listId: SubscriberList
  email: string
}

/**
 * The confirm mail job: signs a confirm token here, next to the send, so the API never holds one
 * and no token is stored. A failed send throws, so the job is retried with a fresh token.
 */
export function subscriberConfirmMailJob(deps: SubscriberMailDeps): JobHandler {
  return requestJob(deps, async (request, setup) => {
    const crypto = await createListCrypto(setup, request.listId)
    const link = subscriberConfirmLink(
      subscriberPagesUrl(setup, deps.brand.webAppUrl),
      request.listId,
      await crypto.confirmToken(request.email),
    )
    return subscriberConfirmMail(deps.brand, { to: request.email, link })
  })
}

/**
 * The welcome mail job: mails a subscriber who is still listed, with an unsubscribe link minted
 * from the stored key, in the body and as a one-click `List-Unsubscribe`. Nothing is sent to an
 * address that unsubscribed before the job ran.
 */
export function subscriberWelcomeMailJob(deps: SubscriberMailDeps): JobHandler {
  return requestJob(deps, async (request, setup) => {
    const crypto = await createListCrypto(setup, request.listId)
    const store = createPostgresSubscriberStore(deps.sql, { listId: request.listId })
    const subscriber = await store.findByKey(await crypto.subscriberKey(request.email))
    if (!subscriber) return null
    const link = subscriberUnsubscribeLink(
      deps.brand.webAppUrl,
      request.listId,
      await crypto.unsubscribeToken(subscriber.email, subscriber.key),
    )
    return subscriberWelcomeMail(deps.brand, { to: subscriber.email, unsubscribeLink: link })
  })
}

/**
 * Loads the job's request row, builds its mail, sends it and deletes the row. With mail or
 * subscriptions off, or a list the app no longer has, the row is deleted and nothing is sent.
 */
function requestJob(
  deps: SubscriberMailDeps,
  build: (request: ListRequest, setup: SubscribersSetup) => Promise<EmailMessage | null>,
): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [request] = await sql<RequestRow[]>`
      SELECT list_id, email FROM subscription_requests WHERE id = ${event.aggregateId}
    `
    if (!request) return
    const { listId, email } = request
    if (deps.sender && deps.setup && isSubscriberList(listId)) {
      const message = await build({ listId, email }, deps.setup)
      if (message) {
        const result = await sendable(deps.sender, deps.brand).send(message)
        if (!result.ok) {
          deps.log(`error: a ${event.eventKind} mail was not sent and will be retried`)
          throw new Error(`${event.eventKind} mail not sent`)
        }
      }
    }
    await sql`DELETE FROM subscription_requests WHERE id = ${event.aggregateId}`
  }
}

interface IssueRow {
  listId: string
  issueId: string
  subject: string
  html: string
  text: string
}

/**
 * The send-issue job: mails the stored issue to everyone on its list through `sendIssue`, which
 * records each recipient in the Postgres send log. A rerun mails only the audience members the log
 * does not list as reached. Throws when any mail failed or another run holds the send lock, so the
 * job is retried; the issue row stays for that rerun.
 */
export function subscriberSendIssueJob(deps: SubscriberMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const [issue] = await sql<IssueRow[]>`
      SELECT list_id, issue_id, subject, html, text
      FROM subscriber_issue_content WHERE id = ${event.aggregateId}
    `
    if (!issue) return
    if (!deps.sender || !deps.setup || !isSubscriberList(issue.listId)) {
      deps.log(`warning: issue ${issue.issueId} not sent: mail or subscriptions are off`)
      return
    }
    const crypto = await createListCrypto(deps.setup, issue.listId)
    const store = createPostgresSubscriberStore(sql, { listId: issue.listId })
    const result = await sendIssue({
      issue: issue.issueId,
      subject: issue.subject,
      letter: { html: issue.html, text: issue.text },
      subscribers: await store.list(),
      crypto,
      unsubscribeLink: (token) =>
        subscriberUnsubscribeLink(deps.brand.webAppUrl, issue.listId, token),
      sender: sendable(deps.sender, deps.brand),
      log: { info: () => {}, error: (...args) => deps.log(args.join(` `)) },
    }, createPostgresSendLog(sql, { listId: issue.listId }))
    if (result.status === `sent`) {
      console.log(
        `Issue ${issue.issueId}: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
      )
      if (result.failed > 0) {
        throw new Error(`issue ${issue.issueId}: ${result.failed} mail(s) not sent`)
      }
      return
    }
    if (result.status === `in-progress`) {
      throw new Error(`issue ${issue.issueId}: another run is sending it`)
    }
    console.log(`Issue ${issue.issueId}: ${result.status}, nothing sent`)
  }
}

/**
 * `List-Unsubscribe` takes only an `https:` link, and a development stack serves plain HTTP. There
 * the header is left off, so the mail still goes out (to `dev_mail`) with its link in the body.
 * Production always serves HTTPS and keeps the header.
 */
function sendable(sender: EmailSender, brand: MailBrand): EmailSender {
  if (brand.webAppUrl.startsWith(`https:`)) return sender
  return {
    send: ({ listUnsubscribe: _dropped, ...message }) => sender.send(message),
  }
}

/**
 * Deletes requests older than {@link SUBSCRIPTION_REQUEST_RETENTION_HOURS}: ones whose job gave up
 * after its last retry. Returns how many.
 */
export async function removeStaleSubscriptionRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM subscription_requests
    WHERE created_at < now() - make_interval(hours => ${SUBSCRIPTION_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}

/** The double opt-in mail. */
export function subscriberConfirmMail(
  brand: MailBrand,
  { to, link }: { to: string; link: string },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const letter = renderLetter({
    blocks: [
      paragraph(`Someone asked to send news from ${host} to this address.`),
      paragraph(`Confirm within three days to start getting it.`),
      button(link, `Confirm`),
    ],
    footer: { reason: `If you did not ask for this, ignore this mail: nothing is sent to you.` },
  })
  return { to, subject: `Confirm your subscription to ${host}`, ...letter }
}

/** The mail a new subscriber gets, with the one-click unsubscribe every list mail carries. */
export function subscriberWelcomeMail(
  brand: MailBrand,
  { to, unsubscribeLink }: { to: string; unsubscribeLink: string },
): EmailMessage {
  const host = new URL(brand.webAppUrl).host
  const letter = renderLetter({
    blocks: [paragraph(`You are subscribed to news from ${host}.`)],
    footer: { reason: `You get this mail because you subscribed at ${host}.`, unsubscribeLink },
  })
  return {
    to,
    subject: `You are subscribed to ${host}`,
    ...letter,
    listUnsubscribe: { url: unsubscribeLink, oneClick: true },
  }
}
