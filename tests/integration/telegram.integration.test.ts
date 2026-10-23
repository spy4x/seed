/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import type postgres from "postgres"
import type { JobHandler } from "@spy4x/server/outbox"
import { AuthAuditEventType, TELEGRAM_METHOD, UserRole } from "@domain/identity"
import { NotificationKind } from "@domain/notifications"
import { createNotification } from "@server/notifications/create-notification.ts"
import { telegramNotificationJob } from "@server/jobs/telegram-notification.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { AdminActionKind, AdminActOutcome, createAdmin } from "../../apps/api/services/admin.ts"
import type { AppAuthState } from "../../apps/api/services/sign-in.ts"
import {
  createTelegramAccounts,
  createTelegramLinkService,
} from "../../apps/api/services/telegram.ts"
import { fakeTelegram } from "../../apps/api/telegram/fake-telegram.ts"
import { insertUser, withSchema } from "./group-team.ts"

/**
 * Linking a Telegram chat (#269) against a real Postgres built from schema.sql, with a fake
 * Telegram API: a code links once and only for ten minutes, a notification reaches the linked
 * chat and stops after unlinking, and an operator removes a person's link with its audit row.
 * Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in docs/handoff.md); it fails when
 * they are missing.
 */

const T0 = new Date(`2026-12-04T10:00:00.000Z`)
const TG = 7_001

function services(sql: postgres.Sql, at: { now: Date }) {
  const db = new AppDbBase({ sql })
  const now = () => at.now
  return {
    db,
    accounts: createTelegramAccounts({ db, botUsername: `seed_bot`, now }),
    links: createTelegramLinkService({ db, now }),
  }
}

async function linkedTelegram(sql: postgres.Sql, userId: number) {
  const rows = await sql<{ subject: string }[]>`
    SELECT subject FROM auth_keys WHERE user_id = ${userId} AND method = ${TELEGRAM_METHOD}
  `
  return rows.map((row) => row.subject)
}

async function audits(sql: postgres.Sql, userId: number) {
  return await sql<{ eventType: number; identifier: string }[]>`
    SELECT event_type, identifier FROM auth_audits WHERE user_id = ${userId} ORDER BY id
  `
}

Deno.test(`telegram: a code links the chat once, with its audit row, and a reused code is refused`, async () => {
  await withSchema(async (sql) => {
    const at = { now: T0 }
    const { accounts, links } = services(sql, at)
    const ada = await insertUser(sql)

    const code = await accounts.issueCode(ada)
    expect(code?.url).toBe(`https://t.me/seed_bot?start=${code?.code}`)
    expect(await links.link(code!.code, TG)).toBe(`linked`)
    expect(await linkedTelegram(sql, ada)).toEqual([String(TG)])
    expect((await accounts.status(ada)).linkedAt).not.toBeNull()

    await links.unlink(TG)
    expect(await links.link(code!.code, TG)).toBe(`invalid`)
    expect(await linkedTelegram(sql, ada)).toEqual([])
    expect((await audits(sql, ada)).map((row) => row.eventType)).toEqual([
      AuthAuditEventType.TELEGRAM_LINKED,
      AuthAuditEventType.TELEGRAM_UNLINKED,
    ])
  })
})

Deno.test(`telegram: a code older than ten minutes, or one a newer code replaced, links nothing`, async () => {
  await withSchema(async (sql) => {
    const at = { now: T0 }
    const { accounts, links } = services(sql, at)
    const ada = await insertUser(sql)

    const old = await accounts.issueCode(ada)
    const fresh = await accounts.issueCode(ada)
    expect(await links.link(old!.code, TG)).toBe(`invalid`)

    at.now = new Date(T0.getTime() + 10 * 60_000 + 1_000)
    expect(await links.link(fresh!.code, TG)).toBe(`invalid`)
    expect(await linkedTelegram(sql, ada)).toEqual([])
  })
})

Deno.test(`telegram: a chat linked to one person is refused for another until it unlinks`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    const bob = await insertUser(sql)
    expect(await links.link((await accounts.issueCode(ada))!.code, TG)).toBe(`linked`)

    expect(await links.link((await accounts.issueCode(bob))!.code, TG)).toBe(`taken`)
    expect(await linkedTelegram(sql, bob)).toEqual([])
    expect(await linkedTelegram(sql, ada)).toEqual([String(TG)])
  })
})

Deno.test(`telegram: a notification reaches the linked chat, and none is sent after unlinking`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    const telegram = fakeTelegram()
    const job = telegramNotificationJob({
      sql,
      client: telegram.client,
      webAppUrl: `https://app.example.com`,
      log: () => {},
    })
    const notify = () =>
      sql.begin((tx) =>
        createNotification(tx, {
          userId: ada,
          kind: NotificationKind.RoleChanged,
          payload: { groupName: `Team`, from: `editor`, to: `viewer` },
          link: `/groups`,
        })
      )
    const run = async () => {
      const queued = await sql<{ id: string }[]>`SELECT id FROM telegram_messages ORDER BY id`
      for (const { id } of queued) await job({ aggregateId: id } as Parameters<JobHandler>[0])
      return queued.length
    }

    // Nothing is queued for a person with no chat linked.
    await notify()
    expect(await run()).toBe(0)

    await links.link((await accounts.issueCode(ada))!.code, TG)
    await notify()
    expect(await run()).toBe(1)
    const [message] = telegram.calls.filter((call) => call.method === `sendMessage`)
    expect(message.params.chat_id).toBe(String(TG))
    expect(message.params.text).toBe(`Your role in “Team” is now a viewer.`)
    expect(message.params.reply_markup).toEqual({
      inline_keyboard: [[{ text: `Open`, url: `https://app.example.com/groups` }]],
    })

    // Queued while linked, run after the unlink: the job sends nothing.
    await notify()
    await links.unlink(TG)
    await notify()
    expect(await run()).toBe(1)
    expect(telegram.sent()).toHaveLength(1)
    expect(await sql`SELECT 1 FROM telegram_messages`).toHaveLength(0)
  })
})

Deno.test(`telegram: an operator unlinks a person's chat, with an audit row naming both`, async () => {
  await withSchema(async (sql) => {
    const { db, accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    const operator = await insertUser(sql)
    await sql`UPDATE users SET role = ${UserRole.OPERATOR} WHERE id = ${operator}`
    await links.link((await accounts.issueCode(ada))!.code, TG)
    const admin = createAdmin({
      db,
      pageSize: 10,
      resetByAddress: () => Promise.reject(new Error(`unused`)),
    })
    expect((await admin.detail(ada))?.methods.map((method) => method.method)).toContain(
      TELEGRAM_METHOD,
    )
    const actor = { user: { id: operator, role: UserRole.OPERATOR } } as AppAuthState
    const app = new Hono().post(
      `/`,
      async (c) => c.json(await admin.act(c, actor, ada, AdminActionKind.UnlinkTelegram)),
    )
    const act = async () => (await (await app.request(`http://local/`, { method: `POST` })).json())

    expect(await act()).toMatchObject({ outcome: AdminActOutcome.Done })
    expect(await act()).toMatchObject({ outcome: AdminActOutcome.Unchanged })

    expect(await linkedTelegram(sql, ada)).toEqual([])
    expect((await audits(sql, ada)).at(-1)).toEqual({
      eventType: AuthAuditEventType.TELEGRAM_UNLINKED,
      identifier: `operator:${operator} telegram:${TG}`,
    })
  })
})
