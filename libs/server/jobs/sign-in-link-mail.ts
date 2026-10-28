import type postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import type { EmailSender } from "@spy4x/email/sender"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  issueSignInLink,
  SIGN_IN_LINK_REQUEST_RETENTION_HOURS,
  SIGN_IN_LINK_TTL_MINUTES,
  signInLinkRequests,
  signInLinkUrl,
} from "../auth/sign-in-links.ts"
import { type MailBrand, signInLinkMail } from "../mail/mail.ts"
import { readMailReader, requestReader } from "../mail/reader.ts"
import { accountUsing } from "../auth/sign-up-requests.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

/** The job that mails one sign-in link (#391). */
export const SIGN_IN_LINK_MAIL_JOB = "auth.sign-in-link-mail"

/**
 * Queues a sign-in link for `email`, already normalised, with the checked page `next` to open
 * after sign-in, asked for by the guest account `requestedBy` or by someone with none (`null`),
 * from a page in `language` (#277), which the mail uses unless the address's account saved one.
 * The same two writes for every address, known or not, so neither the answer nor its timing tells
 * which. The request row is written before its job, and the job points at it.
 */
export async function enqueueSignInLinkMail(
  sql: postgres.Sql,
  email: string,
  next: string | null,
  requestedBy: number | null = null,
  language: string | null = null,
): Promise<void> {
  const id = uuidV7()
  await signInLinkRequests(sql).create({ id, email, next, requestedBy, language })
  await enqueueJob(sql, SIGN_IN_LINK_MAIL_JOB, id, { inMs: 0 })
}

/** What the sign-in link mail job needs. */
export interface SignInLinkMailDeps {
  sql: postgres.Sql
  store: AuthStore
  /** `null` when mail is off: nothing is issued or sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails; the job is then retried. Gets no address or link. */
  log: (line: string) => void
}

/**
 * Handles one request: issues its link's secret and mails the link. The same mail for every
 * address, whether or not an account uses it: the link itself decides, once opened. The secret is
 * made here, next to the send, so it is never stored. The request stays, since the link needs it;
 * using a link of the address, or the nightly cleanup, removes it. A request already gone (another
 * link of the address was used first) sends nothing. A failed send throws, so the job is retried
 * with a fresh secret.
 */
export function signInLinkMailJob(deps: SignInLinkMailDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    if (!deps.sender) return
    const request = await signInLinkRequests(sql).find(event.aggregateId)
    if (!request) return
    const { token } = await issueSignInLink(deps.store, request)
    // The address's account, when one uses it, speaks its saved language; else the asking page's.
    // The answer reaches only the mailbox, so it tells the asker nothing (#277).
    const account = await accountUsing(deps.store, request.email)
    const reader = account
      ? await readMailReader(sql, account.userId, request.language)
      : requestReader(request.language)
    const result = await deps.sender.send(
      signInLinkMail(deps.brand, {
        to: request.email,
        link: signInLinkUrl(deps.brand.webAppUrl, token),
        validMinutes: SIGN_IN_LINK_TTL_MINUTES,
        at: new Date(),
        reader,
      }),
    )
    if (!result.ok) {
      deps.log("error: a sign-in link was not sent and will be retried")
      throw new Error("sign-in link not sent")
    }
  }
}

/**
 * Deletes requests older than {@link SIGN_IN_LINK_REQUEST_RETENTION_HOURS}: their links stopped
 * working long before. Returns how many.
 */
export async function removeStaleSignInLinkRequests(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM sign_in_link_requests
    WHERE created_at < now() - make_interval(hours => ${SIGN_IN_LINK_REQUEST_RETENTION_HOURS})
  `
  return removed.count
}
