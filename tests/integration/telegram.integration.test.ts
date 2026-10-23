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
import type { TelegramLinkService } from "../../apps/api/telegram/bot.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
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

/** A code sent to the bot, then the "Link" press by the same Telegram user. */
async function linkWith(links: TelegramLinkService, code: string, telegramUserId: number) {
  const prepared = await links.prepare(code, telegramUserId)
  if (!prepared) return `invalid`
  return await links.link(prepared.token, telegramUserId)
}

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
    expect(await linkWith(links, code!.code, TG)).toBe(`linked`)
    expect(await linkedTelegram(sql, ada)).toEqual([String(TG)])
    expect((await accounts.status(ada)).linkedAt).not.toBeNull()

    await links.unlink(TG)
    expect(await linkWith(links, code!.code, TG)).toBe(`invalid`)
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
    expect(await linkWith(links, old!.code, TG)).toBe(`invalid`)

    at.now = new Date(T0.getTime() + 10 * 60_000 + 1_000)
    expect(await linkWith(links, fresh!.code, TG)).toBe(`invalid`)
    expect(await linkedTelegram(sql, ada)).toEqual([])
  })
})

Deno.test(`telegram: a chat linked to one person is refused for another until it unlinks`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    const bob = await insertUser(sql)
    expect(await linkWith(links, (await accounts.issueCode(ada))!.code, TG)).toBe(`linked`)

    expect(await linkWith(links, (await accounts.issueCode(bob))!.code, TG)).toBe(`taken`)
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

    await linkWith(links, (await accounts.issueCode(ada))!.code, TG)
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
    await linkWith(links, (await accounts.issueCode(ada))!.code, TG)
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

Deno.test(`telegram: a code names the account it links by first name and masked address, and only its Telegram user's press links`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    await sql`UPDATE users SET first_name = 'Ada' WHERE id = ${ada}`
    await sql`
      INSERT INTO auth_keys (user_id, method, subject, email)
      VALUES (${ada}, 'password', 'ada@example.com', 'ada@example.com')
    `

    const prepared = await links.prepare((await accounts.issueCode(ada))!.code, TG)
    expect(prepared && { firstName: prepared.firstName, maskedAddress: prepared.maskedAddress })
      .toEqual({ firstName: `Ada`, maskedAddress: `a•••@example.com` })
    expect(await linkedTelegram(sql, ada)).toEqual([])

    expect(await links.link(prepared!.token, TG + 1)).toBe(`invalid`)
    expect(await linkedTelegram(sql, ada)).toEqual([])
    expect(await links.link(prepared!.token, TG)).toBe(`linked`)
    expect(await linkedTelegram(sql, ada)).toEqual([String(TG)])
  })
})

Deno.test(`telegram: wrong codes made from a person's user id leave their live code and the next one working`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    const live = (await accounts.issueCode(ada))!.code

    for (let guess = 0; guess < 6; guess++) {
      const forged = `${ada}_${`${guess}`.padStart(16, `b`)}_${`c`.repeat(24)}`
      expect(await links.prepare(forged, TG + 1)).toBeNull()
    }
    expect(await linkWith(links, live, TG)).toBe(`linked`)
    await links.unlink(TG)
    expect(await linkWith(links, (await accounts.issueCode(ada))!.code, TG)).toBe(`linked`)
  })
})

Deno.test(`telegram: linking a second Telegram account records the first one's unlink`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const ada = await insertUser(sql)
    await linkWith(links, (await accounts.issueCode(ada))!.code, TG)

    expect(await linkWith(links, (await accounts.issueCode(ada))!.code, TG + 1)).toBe(`linked`)

    expect(await linkedTelegram(sql, ada)).toEqual([String(TG + 1)])
    expect(await audits(sql, ada)).toEqual([
      { eventType: AuthAuditEventType.TELEGRAM_LINKED, identifier: `telegram:${TG}` },
      { eventType: AuthAuditEventType.TELEGRAM_UNLINKED, identifier: `telegram:${TG}` },
      { eventType: AuthAuditEventType.TELEGRAM_LINKED, identifier: `telegram:${TG + 1}` },
    ])
  })
})

Deno.test(`telegram: a blocked or deleted person's chat gets no message`, async () => {
  await withSchema(async (sql) => {
    const { accounts, links } = services(sql, { now: T0 })
    const telegram = fakeTelegram()
    const job = telegramNotificationJob({
      sql,
      client: telegram.client,
      webAppUrl: `https://app.example.com`,
      log: () => {},
    })
    for (const column of [`blocked_at`, `deleted_at`]) {
      const person = await insertUser(sql)
      const chat = column === `blocked_at` ? TG : TG + 1
      await linkWith(links, (await accounts.issueCode(person))!.code, chat)
      await sql.begin((tx) =>
        createNotification(tx, {
          userId: person,
          kind: NotificationKind.RoleChanged,
          payload: { groupName: `Team`, from: `editor`, to: `viewer` },
          link: `/groups`,
        })
      )
      await sql`UPDATE users SET ${sql(column)} = now() WHERE id = ${person}`
      const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM telegram_messages`
      await job({ aggregateId: id } as Parameters<JobHandler>[0])
    }

    expect(telegram.sent()).toEqual([])
    expect(await sql`SELECT 1 FROM telegram_messages`).toHaveLength(0)
  })
})

const PEPPER = `integration-test-only-pepper-0123456789`
const COOKIE_SECRET = `integration-test-only-cookie-secret-0123456789`
const PASSWORD = `Passw0rd!`

/**
 * What an attacker with the person's session leaves behind for later: a "Link" press for their
 * own Telegram, prepared from a code, and a fresh code kept unsent.
 */
async function prepareForLater(
  accounts: ReturnType<typeof services>[`accounts`],
  links: TelegramLinkService,
  userId: number,
  telegramUserId: number,
) {
  const press = await links.prepare((await accounts.issueCode(userId))!.code, telegramUserId)
  return { press: press!.token, code: (await accounts.issueCode(userId))!.code }
}

Deno.test(`telegram: a password reset and a password change each end the link, with an audit row, and every code and Link press made before`, async () => {
  await withSchema(async (sql) => {
    const { db, accounts, links } = services(sql, { now: T0 })
    const signIn = createSignIn({
      db,
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: 60,
      totpIssuer: `example.test`,
    })
    const app = new Hono()
      .post(`/sign-up`, async (c) => {
        const { email } = await c.req.json()
        return c.json((await signIn.signUp(c, email, PASSWORD))!.user)
      })
      .post(`/change/:id`, async (c) =>
        c.json(
          await signIn.changePassword(
            c,
            { user: { id: Number(c.req.param(`id`)) } } as never,
            PASSWORD,
            `Changed-Passw0rd`,
            false,
          ),
        ))
    const signUp = async (email: string) =>
      ((await (await app.request(`http://local/sign-up`, {
        method: `POST`,
        body: JSON.stringify({ email }),
      })).json()) as { id: number }).id

    const ada = await signUp(`ada@example.com`)
    await linkWith(links, (await accounts.issueCode(ada))!.code, TG)
    // A proven address, so the reset's clean-up of an unproven one does not remove the link too.
    const [key] = await sql<
      { id: number }[]
    >`SELECT id FROM auth_keys WHERE subject = 'ada@example.com'`
    await db.authStore.proveKey(key.id, new Date())
    const adaLater = await prepareForLater(accounts, links, ada, TG + 2)
    const issued = (await issuePasswordReset(db.authStore, `ada@example.com`, new Date()))!
    expect(await signIn.resetPassword(`ada@example.com`, issued.code, `Reset-Passw0rd`)).toBe(true)
    expect(await links.account(TG)).toBeNull()
    expect((await audits(sql, ada)).at(-1)).toEqual({
      eventType: AuthAuditEventType.TELEGRAM_UNLINKED,
      identifier: `password-reset telegram:${TG}`,
    })
    expect(await links.link(adaLater.press, TG + 2)).toBe(`invalid`)
    expect(await linkWith(links, adaLater.code, TG + 3)).toBe(`invalid`)
    expect(await linkedTelegram(sql, ada)).toEqual([])

    const bob = await signUp(`bob@example.com`)
    await linkWith(links, (await accounts.issueCode(bob))!.code, TG + 1)
    const bobLater = await prepareForLater(accounts, links, bob, TG + 4)
    expect((await app.request(`http://local/change/${bob}`, { method: `POST` })).status).toBe(200)
    expect(await links.account(TG + 1)).toBeNull()
    expect(await links.link(bobLater.press, TG + 4)).toBe(`invalid`)
    expect(await linkWith(links, bobLater.code, TG + 5)).toBe(`invalid`)
    expect(await linkedTelegram(sql, bob)).toEqual([])
    expect(
      (await audits(sql, bob)).filter((row) =>
        row.eventType === AuthAuditEventType.TELEGRAM_UNLINKED
      ),
    )
      .toEqual([{
        eventType: AuthAuditEventType.TELEGRAM_UNLINKED,
        identifier: `password-change telegram:${TG + 1}`,
      }])
  })
})
