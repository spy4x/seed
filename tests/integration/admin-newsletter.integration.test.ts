/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type { MiddlewareHandler } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, UserRole } from "@domain/identity"
import { ADMIN_SUBSCRIBERS_NO_FILTER, type AdminSubscriberListResponse } from "@domain/subscribers"
import {
  createPostgresSendLog,
  createPostgresSubscriberStore,
} from "@spy4x/server/subscribers/postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  enqueueSubscriberMail,
  SUBSCRIBER_CONFIRM_MAIL_JOB,
  SUBSCRIBER_WELCOME_MAIL_JOB,
} from "@server/jobs/subscriber-mail.ts"
import { createListCrypto, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import { listAdminSubscribers } from "@server/subscribers/admin-newsletter.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildAuthData } from "../../apps/api/_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../apps/api/_testing/mutation-requests.ts"
import { createAdminRoute } from "../../apps/api/routes/admin/+routes.ts"
import {
  createAdminNewsletter,
  createAdminNewsletterRoutes,
} from "../../apps/api/routes/admin/newsletter.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's newsletter module (#428) against a real Postgres with every migration
 * applied: the list joins confirmed rows and queued confirm mails, its search, filter and paging,
 * the numbers, the sent issues, and the two actions with their audit rows.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

/** A throwaway secret for this test only. */
const SETUP: SubscribersSetup = {
  secret: `integration-admin-newsletter-secret-0123456789`,
  previousSecrets: [],
}
const NOW = new Date(`2026-10-16T09:00:00.000Z`)
const DAY_MS = 24 * 60 * 60 * 1000

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_newsletter_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

Deno.test(`operator area: the newsletter module on a real database`, async (t) => {
  await withSchema(async (sql) => {
    const [{ id: operatorId }] = await sql<{ id: number }[]>`
      WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
      INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
    `
    const crypto = await createListCrypto(SETUP, `news`)
    const store = createPostgresSubscriberStore(sql, { listId: `news` })
    const subscribe = async (email: string, at: Date) =>
      expect(
        await store.add({
          email,
          key: await crypto.subscriberKey(email),
          mark: await crypto.unsubscribeMark(email),
          issuedAt: at.getTime(),
          at,
        }),
      ).toBe(`added`)
    // Ann confirmed 40 days ago, Bea 5 days ago; Cat waits for her confirm mail.
    await subscribe(`ann@example.com`, new Date(NOW.getTime() - 40 * DAY_MS))
    await subscribe(`bea@example.com`, new Date(NOW.getTime() - 5 * DAY_MS))
    await enqueueSubscriberMail(sql, SUBSCRIBER_CONFIRM_MAIL_JOB, `news`, `cat@example.com`)
    // Neither is pending: Ann is listed already, and Dan's mail is a welcome.
    await enqueueSubscriberMail(sql, SUBSCRIBER_CONFIRM_MAIL_JOB, `news`, `ann@example.com`)
    await enqueueSubscriberMail(sql, SUBSCRIBER_WELCOME_MAIL_JOB, `news`, `dan@example.com`)
    // Another list's address never shows.
    await createPostgresSubscriberStore(sql, { listId: `other` }).add({
      email: `eve@example.com`,
      key: `other-key`,
      mark: `other-mark`,
      issuedAt: NOW.getTime(),
      at: NOW,
    })

    const db = new AppDbBase({ sql })
    const newsletter = createAdminNewsletter({
      sql,
      db,
      setup: SETUP,
      list: `news`,
      now: () => NOW,
    })
    const route = createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [
        createAdminNewsletterRoutes({
          limit: passThrough,
          newsletter,
          list: `news`,
          now: () => NOW,
        }),
      ],
    })
    const app = mountRoute(
      `/admin`,
      route,
      buildAuthData({ user: { id: operatorId, role: UserRole.OPERATOR } }),
    )
    const get = (path: string) =>
      app.request(`${API_URL}/admin/newsletter/${path}`, { headers: { ...sameOriginHeaders } })
    const post = (path: string, body?: unknown) =>
      app.request(`${API_URL}/admin/newsletter/subscribers/${path}`, {
        method: `POST`,
        headers: { ...sameOriginHeaders },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const listed = async (search: Record<string, string> = {}) =>
      (await (await post(`search`, search)).json()) as AdminSubscriberListResponse
    const audits = () =>
      sql<{ eventType: number; identifier: string }[]>`
        SELECT event_type, identifier FROM auth_audits WHERE user_id = ${operatorId} ORDER BY id
      `

    await t.step(`lists confirmed and pending addresses of the list, newest first`, async () => {
      const page = await listed()

      expect(page.total).toBe(3)
      expect(page.subscribers.map((row) => [row.email, row.status])).toEqual([
        [`cat@example.com`, `pending`],
        [`bea@example.com`, `confirmed`],
        [`ann@example.com`, `confirmed`],
      ])
      expect(page.subscribers[0].requestedAt).not.toBeNull()
      expect(page.subscribers[1].confirmedAt).toBe(
        new Date(NOW.getTime() - 5 * DAY_MS).toISOString(),
      )
    })

    await t.step(`searches inside the address and filters by status`, async () => {
      expect((await listed({ q: `EA@` })).subscribers.map((row) => row.email)).toEqual([
        `bea@example.com`,
      ])
      expect((await listed({ status: `pending` })).subscribers.map((row) => row.email)).toEqual([
        `cat@example.com`,
      ])
      // `%` and `_` are searched as text, not as patterns.
      expect((await listed({ q: `%` })).total).toBe(0)
    })

    await t.step(`pages the list and counts every match`, async () => {
      const second = await listAdminSubscribers(
        sql,
        `news`,
        { ...ADMIN_SUBSCRIBERS_NO_FILTER, page: 2 },
        2,
      )
      expect(second).toEqual({
        total: 3,
        subscribers: [expect.objectContaining({ email: `ann@example.com` })],
      })
    })

    await t.step(`counts the list and its growth over 30 days`, async () => {
      const stats = await (await get(`stats`)).json()

      expect(stats.confirmed).toBe(2)
      expect(stats.pending).toBe(1)
      expect(stats.joined).toEqual({ current: 1, previous: 1 })
      expect(stats.subscribersPerDay.length).toBe(30)
      expect(stats.subscribersPerDay[0].count).toBe(1)
      expect(stats.subscribersPerDay.at(-1)).toEqual({ day: `2026-10-16`, count: 2 })
      expect(stats.issues).toBe(0)
    })

    await t.step(`lists a sent issue with its recipients, deliveries and failures`, async () => {
      const log = createPostgresSendLog(sql, { listId: `news` })
      await log.start({
        issue: `2026-10-first`,
        subject: `First issue`,
        audience: [`mark-a`, `mark-b`],
        at: new Date(NOW.getTime() - DAY_MS),
      })
      await log.record(`2026-10-first`, `mark-a`)
      await log.finish({ issue: `2026-10-first`, failed: 1, at: NOW })

      expect(await (await get(`sends`)).json()).toEqual({
        sends: [{
          issue: `2026-10-first`,
          subject: `First issue`,
          startedAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
          completedAt: null,
          recipients: 2,
          sent: 1,
          failed: 1,
        }],
      })
      expect((await (await get(`stats`)).json()).issues).toBe(1)
    })

    await t.step(`queues a new confirm mail to a pending address and audits it`, async () => {
      const before = await sql`SELECT 1 FROM subscription_requests WHERE email = 'cat@example.com'`
      const response = await post(`resend`, { email: `cat@example.com` })

      expect(response.status).toBe(202)
      const after = await sql`
        SELECT 1 FROM subscription_requests r
        JOIN outbox_events o ON o.aggregate_id = r.id AND o.event_kind = ${SUBSCRIBER_CONFIRM_MAIL_JOB}
        WHERE r.email = 'cat@example.com'
      `
      expect(after.length).toBe(before.length + 1)
      expect((await listed({ status: `pending` })).total).toBe(1)
      expect((await audits()).at(-1)).toEqual({
        eventType: AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT,
        identifier: `news:c***@e***.com`,
      })
    })

    await t.step(
      `removes a confirmed address so no earlier confirm link adds it back`,
      async () => {
        const response = await post(`remove`, { email: `bea@example.com` })

        expect(response.status).toBe(200)
        expect((await listed()).subscribers.map((row) => row.email)).toEqual([
          `cat@example.com`,
          `ann@example.com`,
        ])
        // A confirm link Bea was mailed before now is refused.
        expect(
          await store.add({
            email: `bea@example.com`,
            key: await crypto.subscriberKey(`bea@example.com`),
            mark: await crypto.unsubscribeMark(`bea@example.com`),
            issuedAt: NOW.getTime() - DAY_MS,
            at: NOW,
          }),
        ).toBe(`replay`)
        const marks = await sql<{ mark: string }[]>`SELECT mark FROM subscriber_unsubscribes`
        expect(marks.map((row) => row.mark)).toContain(
          await crypto.unsubscribeMark(`bea@example.com`),
        )
        expect((await audits()).at(-1)).toEqual({
          eventType: AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED,
          identifier: `news:b***@e***.com`,
        })
      },
    )

    await t.step(`removes a pending address with every confirm mail queued for it`, async () => {
      const response = await post(`remove`, { email: `cat@example.com` })

      expect(response.status).toBe(200)
      expect(await sql`SELECT 1 FROM subscription_requests WHERE email = 'cat@example.com'`)
        .toHaveLength(0)
      expect((await listed()).subscribers.map((row) => row.email)).toEqual([`ann@example.com`])
      expect((await post(`remove`, { email: `cat@example.com` })).status).toBe(404)
    })

    await t.step(`exports the list as a CSV and audits how many rows left`, async () => {
      const response = await post(`export`)

      expect(response.status).toBe(200)
      const text = new TextDecoder().decode(await response.arrayBuffer())
      expect(text).toContain(`ann@example.com,confirmed`)
      expect(text).not.toContain(`eve@example.com`)
      expect((await audits()).at(-1)).toEqual({
        eventType: AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED,
        identifier: `news:1`,
      })
      // No audit row keeps a whole address.
      for (const row of await audits()) expect(row.identifier).not.toMatch(/^news:[a-z]{2,}@/)
    })
  })
})
