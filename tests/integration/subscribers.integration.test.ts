/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { confirmSubscription, type FlowDeps, unsubscribe } from "@spy4x/server/subscribers"
import {
  createPostgresSendLog,
  createPostgresSubscriberStore,
} from "@spy4x/server/subscribers/postgres"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import {
  enqueueSubscriberMail,
  rememberSubscriberLanguage,
  removeStaleSubscriptionRequests,
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
} from "@server/jobs/subscriber-mail.ts"
import { queueSubscriberIssue, renderSubscriberIssue } from "@server/jobs/subscriber-issue.ts"
import {
  createListCrypto,
  subscriberConfirmLink,
  type SubscribersSetup,
  subscriberUnsubscribeLink,
} from "@server/subscribers/subscribers.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/** A throwaway secret for this test only. */
const SETUP: SubscribersSetup = {
  secret: `integration-subscribers-secret-0123456789abcdef`,
  previousSecrets: [],
}
/** HTTPS, so the mails keep their `List-Unsubscribe` header. */
const BRAND = { webAppUrl: `https://app.example.com` }

/** Runs `body` on a fresh schema built from schema.sql. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const connection = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...connection, max: 1 })
  const schema = `subscribers_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...connection,
    // The send log holds a session lock on one connection while it writes on another.
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await sql.unsafe(await Deno.readTextFile(`libs/server/db/schema.sql`))
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A sender that keeps what it is given, and refuses every address in `refuse`. */
function recordingSender(): EmailSender & { sent: EmailMessage[]; refuse: Set<string> } {
  const sender = {
    sent: [] as EmailMessage[],
    refuse: new Set<string>(),
    send(message: EmailMessage) {
      if (sender.refuse.has(String(message.to))) {
        return Promise.resolve({ ok: false as const, error: `refused ${message.to}` })
      }
      sender.sent.push(message)
      return Promise.resolve({ ok: true as const, id: String(sender.sent.length) })
    },
  }
  return sender as unknown as EmailSender & { sent: EmailMessage[]; refuse: Set<string> }
}

/** The one link in a mail's text that starts with `prefix`. */
function linkIn(mail: EmailMessage, prefix: string): URL {
  const found = mail.text!.split(/\s+/).find((word) => word.startsWith(prefix))
  if (!found) throw new Error(`no ${prefix} link in the mail`)
  return new URL(found)
}

/** Everything a console line, log callback or relay error wrote while `body` ran. */
async function captureLines(body: (log: (line: string) => void) => Promise<void>) {
  const lines: string[] = []
  const write = (...args: unknown[]) => void lines.push(args.map(String).join(` `))
  const original = { log: console.log, error: console.error, warn: console.warn }
  Object.assign(console, { log: write, error: write, warn: write })
  try {
    await body(write)
  } finally {
    Object.assign(console, original)
  }
  return lines
}

Deno.test(`a subscriber's mails are written in the language of the page they signed up on (#527)`, async (t) => {
  await withSchema(async (sql) => {
    const setup = { ...SETUP, siteUrl: `https://www.example.com` }
    const sender = recordingSender()
    const processor = createOutboxProcessor(
      sql,
      { store: createPostgresAuthStore(sql), sender, brand: BRAND, log: () => {} },
      null,
      setup,
    )

    await t.step(
      `an address that asked on an English page gets the English confirm mail`,
      async () => {
        await enqueueSubscriberMail(
          sql,
          SUBSCRIBER_CONFIRM_MAIL_JOB,
          `news`,
          `ann@example.com`,
          `en`,
        )
        await processor.drainOnce()

        expect(sender.sent.at(-1)?.subject).toBe(`Confirm your subscription to app.example.com`)
        linkIn(sender.sent.at(-1)!, `https://www.example.com/subscribe/confirm?`)
      },
    )

    await t.step(
      `one that asked on a Spanish page gets it in Spanish, linking the Spanish page`,
      async () => {
        await enqueueSubscriberMail(
          sql,
          SUBSCRIBER_CONFIRM_MAIL_JOB,
          `news`,
          `eva@example.com`,
          `es`,
        )
        await processor.drainOnce()

        expect(sender.sent.at(-1)?.subject).toBe(`Confirma tu suscripción a app.example.com`)
        linkIn(sender.sent.at(-1)!, `https://www.example.com/es/subscribe/confirm?`)
      },
    )

    await t.step(
      `the welcome follows the language it confirmed in, which the list keeps`,
      async () => {
        const crypto = await createListCrypto(setup, `news`)
        await sql`INSERT INTO subscribers (list_id, email, key, subscribed_at)
        VALUES ('news', 'eva@example.com', ${await crypto.subscriberKey(`eva@example.com`)}, now())`
        await rememberSubscriberLanguage(sql, `news`, `eva@example.com`, `de`)
        await enqueueSubscriberMail(
          sql,
          SUBSCRIBER_WELCOME_MAIL_JOB,
          `news`,
          `eva@example.com`,
          `de`,
        )
        await processor.drainOnce()

        expect(sender.sent.at(-1)?.subject).toBe(`Du hast app.example.com abonniert`)
        expect(await sql`SELECT language FROM subscribers WHERE email = 'eva@example.com'`)
          .toEqual([{ language: `de` }])
      },
    )
  })
})

Deno.test(`mail subscriptions go through the worker's queue and Postgres`, async (t) => {
  await withSchema(async (sql) => {
    const store = createPostgresSubscriberStore(sql, { listId: `news` })
    const crypto = await createListCrypto(SETUP, `news`)
    const sender = recordingSender()
    const logged: string[] = []
    const processor = createOutboxProcessor(
      sql,
      { store: createPostgresAuthStore(sql), sender, brand: BRAND, log: (l) => logged.push(l) },
      null,
      SETUP,
    )
    const count = async (table: string) =>
      (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)}`)[0].count
    const flows: FlowDeps = {
      crypto,
      store,
      links: {
        confirm: (token) => subscriberConfirmLink(BRAND.webAppUrl, `news`, token),
        unsubscribe: (token) => subscriberUnsubscribeLink(BRAND.webAppUrl, `news`, token),
      },
      sendMail: async (mail) => {
        if (mail.kind === `welcome`) {
          await enqueueSubscriberMail(sql, SUBSCRIBER_WELCOME_MAIL_JOB, `news`, mail.email)
        }
      },
      log: { error: (...args) => logged.push(args.join(` `)), warn: () => {} },
    }

    let welcome: EmailMessage
    await t.step(`the worker signs and mails a confirm link, then drops the request`, async () => {
      await enqueueSubscriberMail(sql, SUBSCRIBER_CONFIRM_MAIL_JOB, `news`, `ann@example.com`)
      expectVersion7Ids(await sql<{ id: string }[]>`SELECT id FROM subscription_requests`)

      expect((await processor.drainOnce()).published).toBe(1)

      expect(sender.sent.map((mail) => mail.to)).toEqual([`ann@example.com`])
      const link = linkIn(sender.sent[0], `${BRAND.webAppUrl}/subscribe/confirm`)
      expect(link.searchParams.get(`list`)).toBe(`news`)
      expect(await count(`subscription_requests`)).toBe(0)

      const outcome = await confirmSubscription(link.searchParams.get(`token`)!, flows)
      expect(outcome.state).toBe(`confirmed`)
      if (outcome.state === `confirmed`) await outcome.mails
      expect((await store.list()).map((row) => row.email)).toEqual([`ann@example.com`])
    })

    await t.step(
      `the welcome carries a one-click unsubscribe that removes the address`,
      async () => {
        expect((await processor.drainOnce()).published).toBe(1)

        welcome = sender.sent[1]
        expect(welcome.to).toBe(`ann@example.com`)
        const link = linkIn(welcome, `${BRAND.webAppUrl}/api/subscribers/unsubscribe`)
        expect(welcome.listUnsubscribe).toEqual({ url: link.href, oneClick: true })

        expect(await unsubscribe(link.searchParams.get(`token`)!, flows)).toEqual({ state: `done` })
        expect(await store.count()).toBe(0)
        expect(await count(`subscriber_unsubscribes`)).toBe(1)
      },
    )

    await t.step(`a welcome queued for an address that left is not sent`, async () => {
      await enqueueSubscriberMail(sql, SUBSCRIBER_WELCOME_MAIL_JOB, `news`, `ann@example.com`)

      expect((await processor.drainOnce()).published).toBe(1)

      expect(sender.sent.length).toBe(2)
      expect(await count(`subscription_requests`)).toBe(0)
    })

    await t.step(`a rerun of an issue mails only whom the first run missed`, async () => {
      for (const email of [`a@example.com`, `b@example.com`, `c@example.com`]) {
        await store.add({
          email,
          key: await crypto.subscriberKey(email),
          mark: await crypto.unsubscribeMark(email),
          issuedAt: Date.now(),
          at: new Date(),
        })
      }
      const issue = renderSubscriberIssue(BRAND, {
        id: `2026-10-first`,
        subject: `First issue`,
        blocks: [{ heading: `Hello` }, { paragraph: `The first issue.` }],
      })
      sender.sent.length = 0
      sender.refuse.add(`b@example.com`)

      const lines = await captureLines(async () => {
        await queueSubscriberIssue(sql, `news`, issue)
        expectVersion7Ids(await sql<{ id: string }[]>`SELECT id FROM subscriber_issue_content`)
        expect((await processor.drainOnce()).failed).toBe(1)
        expect(sender.sent.map((mail) => mail.to)).toEqual([`a@example.com`, `c@example.com`])

        sender.refuse.clear()
        await queueSubscriberIssue(sql, `news`, issue)
        await processor.drainOnce()
      })

      expect(sender.sent.map((mail) => mail.to)).toEqual([
        `a@example.com`,
        `c@example.com`,
        `b@example.com`,
      ])
      for (const mail of sender.sent) {
        const link = linkIn(mail, `${BRAND.webAppUrl}/api/subscribers/unsubscribe`)
        expect(mail.listUnsubscribe).toEqual({ url: link.href, oneClick: true })
      }
      const entry = await createPostgresSendLog(sql, { listId: `news` }).find(`2026-10-first`)
      expect(entry?.recipients?.length).toBe(3)
      expect(lines.length).toBeGreaterThan(0)
      expect([...lines, ...logged].join(`\n`)).not.toMatch(/[a-c]@example\.com/)
    })

    await t.step(`a request older than a day is removed by the cleanup`, async () => {
      await sql`
        INSERT INTO subscription_requests (id, list_id, email, created_at) VALUES
          (${uuidV7()}, 'news', 'old@example.com',
            now() - interval '25 hours'),
          (${uuidV7()}, 'news', 'new@example.com', now() - interval '23 hours')
      `

      expect(await removeStaleSubscriptionRequests(sql)).toBe(1)
      const left = await sql<{ email: string }[]>`SELECT email FROM subscription_requests`
      expect(left.map((row) => row.email)).toEqual([`new@example.com`])
    })

    await t.step(
      `a confirm mail that is refused keeps the request and is sent on the retry`,
      async () => {
        await sql`DELETE FROM subscription_requests`
        await sql`DELETE FROM outbox_events`
        const sentBefore = sender.sent.length
        sender.refuse.add(`bea@example.com`)
        await enqueueSubscriberMail(sql, SUBSCRIBER_CONFIRM_MAIL_JOB, `news`, `bea@example.com`)

        expect((await processor.drainOnce()).failed).toBe(1)

        expect(sender.sent.length).toBe(sentBefore)
        expect(await count(`subscription_requests`)).toBe(1)
        expect(logged).toContain(
          `error: a ${SUBSCRIBER_CONFIRM_MAIL_JOB} mail was not sent and will be retried`,
        )

        sender.refuse.clear()
        await sql`UPDATE outbox_events SET available_at = now() WHERE processed_at IS NULL`
        expect((await processor.drainOnce()).published).toBe(1)
        expect(sender.sent.at(-1)?.to).toBe(`bea@example.com`)
        expect(await count(`subscription_requests`)).toBe(0)
      },
    )
  })
})
