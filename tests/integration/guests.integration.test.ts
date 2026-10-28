/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono, type MiddlewareHandler } from "hono"
import postgres from "postgres"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createPasswordHasher } from "@spy4x/server/sign-in"
import type { EmailSender } from "@spy4x/email/sender"
import type { EmailMessage } from "@spy4x/email/message"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  AuthAuditEventType,
  GUEST_REFUSAL_CODE,
  GUEST_SESSION_DAYS,
  GuestReminderKind,
  type GuestSwitchResponse,
} from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { createGuestRoute } from "../../apps/api/routes/auth-guest.ts"
import { createAuthRoute } from "../../apps/api/routes/auth.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import {
  type AuthRateLimits,
  createAuthRateLimits,
} from "../../apps/api/middlewares/auth-rate-limits.ts"
import { createKvStore } from "@spy4x/platform/rate-limit"
import { GUEST_LIMITED_PATHS, refuseGuests } from "../../apps/api/middlewares/guest-limits.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createOutboxProcessor } from "../../libs/server/jobs/wiring.ts"
import { cleanUpGuests, remindGuest, renewGuestSession } from "../../libs/server/auth/guests.ts"
import { applyMigrations } from "./migrations.ts"
import { checkedError } from "../../apps/api/_testing/api-error.ts"

/**
 * Guest accounts (#224) through the real guest and auth routes, the real sign-in and the worker's
 * mail job, against a real Postgres: one click in, keeping the account by e-mail with the same
 * user id, the switch when the address belongs to another account, the limits, the reminders, the
 * deletion and the nightly clean-up with a clock the test sets.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const OTHER_PASSWORD = "the-other-account's-password"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"
const DAY_MS = 24 * 60 * 60_000
const SESSION_MINUTES = 60

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `guest_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
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
const allowed = () => Promise.resolve({ allowed: true, remaining: 1, retryAfterMs: 0 } as never)
const openLimits: AuthRateLimits = {
  strictByIp: passThrough,
  strictByUser: passThrough,
  otpByUser: passThrough,
  guestStart: allowed,
  normal: passThrough,
  resetByAddress: allowed,
  emailCodeByAddress: allowed,
  signUpCode: allowed,
  signInLink: allowed,
  emailChangeByUser: allowed,
  emailChangeByAddress: allowed,
}
const openLockout = {
  begin: () => Promise.resolve(0),
  refund: () => Promise.resolve(),
  fail: () => Promise.resolve(),
}

/** A sender that keeps what it is given. */
function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sender = {
    sent: [] as EmailMessage[],
    send(message: EmailMessage) {
      sender.sent.push(message)
      return Promise.resolve({ ok: true as const, id: String(sender.sent.length) })
    },
  }
  return sender as unknown as EmailSender & { sent: EmailMessage[] }
}

interface Fixture {
  sql: postgres.Sql
  signIn: SignIn
  /** A browser with its own cookie jar, behind its own address unless `ip` names one. */
  browser(ip?: string): Browser
  /** Runs the worker once and answers the code of the newest code mail to `email`. */
  codeFor(email: string): Promise<string>
  /** Creates a full account that signs in with `email` and {@link OTHER_PASSWORD}. */
  account(email: string): Promise<number>
}

interface Browser {
  cookies: Map<string, string>
  call(method: string, path: string, body?: unknown): Promise<Answer>
}

interface Answer {
  status: number
  body: Record<string, unknown>
  setCookies: string[]
  retryAfter: string | null
}

/** The guest and auth routes as `index.ts` mounts them, with the guest limits in front. */
async function withFixture(
  body: (fixture: Fixture) => Promise<void>,
  options: { guests?: boolean; rateLimits?: Partial<AuthRateLimits> } = {},
): Promise<void> {
  await withSchema(async (sql) => {
    const signIn = createSignIn({
      db: new AppDbBase({ sql }),
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: SESSION_MINUTES,
      totpIssuer: "example.test",
      guests: options.guests,
    })
    const rateLimits = { ...openLimits, ...options.rateLimits }
    const mutationGuards = createMutationGuards(WEB_APP_URL)
    const app = new Hono<APIContext>().basePath("/api")
    app.use("*", async (c, next) => {
      c.set("requestId", uuidV7())
      await next()
    })
    app.use("*", signIn.auth.parseAuth)
    for (const [action, paths] of Object.entries(GUEST_LIMITED_PATHS)) {
      const remind = action === "invite"
        ? (userId: number) => signIn.guests.remind(userId, GuestReminderKind.Invite)
        : undefined
      app.on("POST", [...paths], refuseGuests(action as never, remind))
    }
    app.post("/tokens", (c) => c.json({ created: true }, 201))
    app.route("/auth", createGuestRoute({ signIn, mutationGuards, rateLimits }))
    app.route(
      "/auth",
      createAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards,
        rateLimits,
        totpFailures: openLockout,
        passwordFailures: openLockout,
        requestPasswordReset: () => Promise.resolve(),
        requestSignInLink: () => Promise.resolve(),
        emailCodeFailures: openLockout,
        requestEmailCode: () => Promise.resolve(),
      }),
    )
    const sender = recordingSender()
    const store = createPostgresAuthStore(sql)
    const processor = createOutboxProcessor(sql, {
      store,
      sender,
      brand: { webAppUrl: WEB_APP_URL },
      log: () => {},
    })
    let ip = 0
    const browser = (address?: string): Browser => {
      const cookies = new Map<string, string>()
      const own = address ?? `198.51.100.${++ip}`
      return {
        cookies,
        async call(method, path, payload) {
          const headers = new Headers({
            "content-type": "application/json",
            origin: WEB_APP_URL,
            "sec-fetch-site": "same-origin",
            "x-real-ip": own,
          })
          if (cookies.size) {
            headers.set(
              "cookie",
              [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
            )
          }
          const response = await app.request(`${API}${path}`, {
            method,
            headers,
            body: payload === undefined ? undefined : JSON.stringify(payload),
          })
          const setCookies = response.headers.getSetCookie()
          for (const line of setCookies) {
            const [pair] = line.split(";")
            const name = pair.slice(0, pair.indexOf("="))
            const value = pair.slice(pair.indexOf("=") + 1)
            if (value === "" || /max-age=0/i.test(line)) cookies.delete(name)
            else cookies.set(name, value)
          }
          const text = await response.text()
          return {
            status: response.status,
            body: text ? JSON.parse(text) : {},
            setCookies,
            retryAfter: response.headers.get("retry-after"),
          }
        },
      }
    }
    await body({
      sql,
      signIn,
      browser,
      async codeFor(email) {
        await processor.drainOnce()
        const mail = sender.sent.findLast((sent) => sent.to === email)
        if (!mail) throw new Error(`no code mail to ${email}`)
        return mail.text!.split("\n\n")[1].trim()
      },
      async account(email) {
        const { user } = await store.createUserWithKey({
          method: PASSWORD_METHOD,
          subject: email,
          email,
          secret: await createPasswordHasher({ pepper: PEPPER }).hash(OTHER_PASSWORD),
          provenAt: new Date(),
        })
        await sql`
          INSERT INTO users (id, first_name, last_name, mfa, role) VALUES (${user.id}, '', '', 1, 1)
        `
        return user.id
      },
    })
  })
}

/** Starts a guest in a new browser and answers the browser and the guest's user id. */
async function startGuest(fixture: Fixture): Promise<{ browser: Browser; userId: number }> {
  const browser = fixture.browser()
  const started = await browser.call("POST", "/auth/guest")
  expect(started).toMatchObject({ status: 201, body: { guest: "started" } })
  const me = await browser.call("GET", "/auth/me")
  expect(me.status).toBe(200)
  return { browser, userId: me.body.id as number }
}

/** Keeps the guest of `browser` with `email` by the sign-up code path. */
async function keepByEmail(fixture: Fixture, browser: Browser, email: string): Promise<Answer> {
  const requested = await browser.call("POST", "/auth/password/sign-up", {
    email,
    password: PASSWORD,
  })
  expect(requested.status).toBe(200)
  return await browser.call("POST", "/auth/password/sign-up/verify", {
    code: await fixture.codeFor(email),
  })
}

Deno.test("try it now makes a guest with a first group, starter data and a year-long cookie", async () => {
  await withFixture(async (fixture) => {
    const browser = fixture.browser()
    const started = await browser.call("POST", "/auth/guest")
    expect(started).toMatchObject({ status: 201, body: { guest: "started" } })
    const session = started.setCookies.find((line) => /max-age=\d+/i.test(line))!
    const maxAge = Number(/max-age=(\d+)/i.exec(session)![1])
    expect(maxAge).toBeGreaterThan((GUEST_SESSION_DAYS - 1) * 24 * 60 * 60)
    expect(session).toMatch(/HttpOnly/i)

    const me = await browser.call("GET", "/auth/me")
    expect(me.status).toBe(200)
    expect(me.body.guestSince).not.toBeNull()
    const userId = me.body.id as number
    const [counts] = await fixture.sql<{ groups: number; starter: number; events: number }[]>`
      SELECT
        (SELECT count(*)::int FROM groups WHERE owner_user_id = ${userId}) AS groups,
        (SELECT count(*)::int FROM starter_data_requests WHERE user_id = ${userId}) AS starter,
        (SELECT count(*)::int FROM guest_events WHERE kind = 1) AS events
    `
    expect(counts).toEqual({ groups: 1, starter: 1, events: 1 })
    const [audit] = await fixture.sql<{ eventType: number }[]>`
      SELECT event_type AS "eventType" FROM auth_audits WHERE user_id = ${userId}
    `
    expect(audit.eventType).toBe(AuthAuditEventType.GUEST_STARTED)
  })
})

Deno.test("a browser that already has a session makes no second account", async () => {
  await withFixture(async (fixture) => {
    const { browser } = await startGuest(fixture)
    const again = await browser.call("POST", "/auth/guest")
    expect(again).toMatchObject({ status: 200, body: { guest: "already-guest" } })

    await fixture.account("ada@example.com")
    const full = fixture.browser()
    const signedIn = await full.call("POST", "/auth/password/check", {
      login: "ada@example.com",
      password: OTHER_PASSWORD,
    })
    expect(signedIn.status).toBe(200)
    const tried = await full.call("POST", "/auth/guest")
    expect(tried).toMatchObject({ status: 200, body: { guest: "signed-in" } })
    const [{ users }] = await fixture.sql<{ users: number }[]>`
      SELECT count(*)::int AS users FROM users
    `
    expect(users).toBe(2)
  })
})

Deno.test("guest mode off refuses to make a guest", async () => {
  await withFixture(async (fixture) => {
    const answer = await fixture.browser().call("POST", "/auth/guest")
    expect(answer.status).toBe(404)
    const [{ users }] = await fixture.sql<
      { users: number }[]
    >`SELECT count(*)::int AS users FROM users`
    expect(users).toBe(0)
  }, { guests: false })
})

Deno.test("keeping a guest by e-mail keeps the user id, the data and this browser's session", async () => {
  await withFixture(async (fixture) => {
    const { browser, userId } = await startGuest(fixture)
    const kept = await keepByEmail(fixture, browser, "grace@example.com")
    expect(kept.status).toBe(200)
    expect(kept.body.id).toBe(userId)
    expect(kept.body.guestSince).toBeNull()

    const me = await browser.call("GET", "/auth/me")
    expect(me).toMatchObject({ status: 200, body: { id: userId, guestSince: null } })
    const keys = await fixture.sql<{ method: string }[]>`
      SELECT method FROM auth_keys WHERE user_id = ${userId}
    `
    expect(keys.map((key) => key.method)).toEqual([PASSWORD_METHOD])
    const [session] = await fixture.sql<{ expiresAt: Date }[]>`
      SELECT expires_at AS "expiresAt" FROM auth_sessions WHERE user_id = ${userId}
    `
    // A kept account's session lasts as long as any other account's, not a guest's year.
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + SESSION_MINUTES * 60_000 + 60_000,
    )
    const [{ groups, kept: keptEvents }] = await fixture.sql<{ groups: number; kept: number }[]>`
      SELECT
        (SELECT count(*)::int FROM groups WHERE owner_user_id = ${userId}) AS groups,
        (SELECT count(*)::int FROM guest_events WHERE kind = 2) AS kept
    `
    expect({ groups, keptEvents }).toEqual({ groups: 1, keptEvents: 1 })

    // The kept account signs in with its new password from any other browser.
    const other = fixture.browser()
    const signedIn = await other.call("POST", "/auth/password/check", {
      login: "grace@example.com",
      password: PASSWORD,
    })
    expect(signedIn).toMatchObject({ status: 200, body: { id: userId } })
  })
})

Deno.test("an address of another account changes nothing and offers the switch", async () => {
  await withFixture(async (fixture) => {
    const otherId = await fixture.account("ada@example.com")
    const { browser, userId } = await startGuest(fixture)
    const taken = await keepByEmail(fixture, browser, "ada@example.com")
    expect(taken).toMatchObject({ status: 200, body: { guestTaken: true } })

    const me = await browser.call("GET", "/auth/me")
    expect(me).toMatchObject({ body: { id: userId } })
    expect(me.body.guestSince).not.toBeNull()
    const waiting = await browser.call("GET", "/auth/guest/switch")
    const state = (waiting.body as unknown as GuestSwitchResponse).switch!
    expect(state).toMatchObject({
      method: PASSWORD_METHOD,
      maskedEmail: "a***@example.com",
      needsPassword: true,
      needsCode: false,
      // The worker wrote the welcome note while it sent the code mail.
      notes: 1,
    })
    expect(state.groups).toHaveLength(1)
    expect(otherId).not.toBe(userId)
  })
})

Deno.test("the switch with a wrong password moves nothing and deletes nothing", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const { browser, userId } = await startGuest(fixture)
    await keepByEmail(fixture, browser, "ada@example.com")
    for (const body of [{ choice: "move" }, { choice: "move", password: "wrong-password" }]) {
      const refused = await browser.call("POST", "/auth/guest/switch", body)
      expect(refused.status).toBe(401)
    }
    const [{ groups, users }] = await fixture.sql<{ groups: number; users: number }[]>`
      SELECT
        (SELECT count(*)::int FROM groups WHERE owner_user_id = ${userId}) AS groups,
        (SELECT count(*)::int FROM users WHERE id = ${userId}) AS users
    `
    expect({ groups, users }).toEqual({ groups: 1, users: 1 })
    const me = await browser.call("GET", "/auth/me")
    expect(me.body.id).toBe(userId)
  })
})

Deno.test("switch and move signs in to the other account with the guest's groups", async () => {
  await withFixture(async (fixture) => {
    const otherId = await fixture.account("ada@example.com")
    const { browser, userId } = await startGuest(fixture)
    const [group] = await fixture.sql<{ id: string }[]>`
      SELECT id FROM groups WHERE owner_user_id = ${userId}
    `
    await keepByEmail(fixture, browser, "ada@example.com")
    const switched = await browser.call("POST", "/auth/guest/switch", {
      choice: "move",
      password: OTHER_PASSWORD,
    })
    expect(switched).toMatchObject({ status: 200, body: { movedGroups: 1 } })

    const me = await browser.call("GET", "/auth/me")
    expect(me).toMatchObject({ status: 200, body: { id: otherId } })
    const [moved] = await fixture.sql<{ ownerUserId: number }[]>`
      SELECT owner_user_id AS "ownerUserId" FROM groups WHERE id = ${group.id}
    `
    expect(moved.ownerUserId).toBe(otherId)
    const [{ guests }] = await fixture.sql<{ guests: number }[]>`
      SELECT count(*)::int AS guests FROM auth_users WHERE id = ${userId}
    `
    expect(guests).toBe(0)
    // A second answer to the same choice finds none.
    const again = await browser.call("POST", "/auth/guest/switch", {
      choice: "move",
      password: OTHER_PASSWORD,
    })
    expect(again.status).toBe(403)
  })
})

Deno.test("switch and delete removes the guest's groups and signs in to the other account", async () => {
  await withFixture(async (fixture) => {
    const otherId = await fixture.account("ada@example.com")
    const { browser, userId } = await startGuest(fixture)
    const [group] = await fixture.sql<{ id: string }[]>`
      SELECT id FROM groups WHERE owner_user_id = ${userId}
    `
    await keepByEmail(fixture, browser, "ada@example.com")
    const switched = await browser.call("POST", "/auth/guest/switch", {
      choice: "delete",
      password: OTHER_PASSWORD,
    })
    expect(switched).toMatchObject({ status: 200, body: { movedGroups: 0 } })
    const me = await browser.call("GET", "/auth/me")
    expect(me.body.id).toBe(otherId)
    const [{ groups, users }] = await fixture.sql<{ groups: number; users: number }[]>`
      SELECT
        (SELECT count(*)::int FROM groups WHERE id = ${group.id}) AS groups,
        (SELECT count(*)::int FROM auth_users WHERE id = ${userId}) AS users
    `
    expect({ groups, users }).toEqual({ groups: 0, users: 0 })
  })
})

Deno.test("keep the guest account forgets the switch and changes nothing else", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const { browser, userId } = await startGuest(fixture)
    await keepByEmail(fixture, browser, "ada@example.com")
    expect((await browser.call("DELETE", "/auth/guest/switch")).status).toBe(200)
    const waiting = await browser.call("GET", "/auth/guest/switch")
    expect(waiting.body).toEqual({ switch: null })
    const me = await browser.call("GET", "/auth/me")
    expect(me.body.id).toBe(userId)
  })
})

Deno.test("a guest is refused an API token with the typed reason, a kept account is not", async () => {
  await withFixture(async (fixture) => {
    const { browser } = await startGuest(fixture)
    const refused = await browser.call("POST", "/tokens", {})
    expect(refused).toMatchObject({
      status: 403,
      body: {
        error: { code: "forbidden", reason: GUEST_REFUSAL_CODE, details: { action: "api-token" } },
      },
    })
    await keepByEmail(fixture, browser, "grace@example.com")
    const allowedNow = await browser.call("POST", "/tokens", {})
    expect(allowedNow.status).toBe(201)
  })
})

Deno.test("an invite refusal sends the invite reminder once", async () => {
  await withFixture(async (fixture) => {
    const { browser, userId } = await startGuest(fixture)
    for (let attempt = 0; attempt < 2; attempt++) {
      const refused = await browser.call("POST", `/groups/${uuidV7()}/invitations`, {})
      expect(refused).toMatchObject({
        status: 403,
        body: { error: { reason: GUEST_REFUSAL_CODE, details: { action: "invite" } } },
      })
    }
    const [{ reminders }] = await fixture.sql<{ reminders: number }[]>`
      SELECT count(*)::int AS reminders FROM notifications WHERE user_id = ${userId}
    `
    expect(reminders).toBe(1)
  })
})

Deno.test("reminders go to guests only, once each, and keeping drops the unread ones", async () => {
  await withFixture(async (fixture) => {
    const fullId = await fixture.account("ada@example.com")
    expect(await remindGuest(fixture.sql, fullId, GuestReminderKind.FirstNote)).toBe(false)
    const { browser, userId } = await startGuest(fixture)
    expect(await remindGuest(fixture.sql, userId, GuestReminderKind.FirstNote)).toBe(true)
    expect(await remindGuest(fixture.sql, userId, GuestReminderKind.FirstNote)).toBe(false)
    await keepByEmail(fixture, browser, "grace@example.com")
    const [{ left }] = await fixture.sql<{ left: number }[]>`
      SELECT count(*)::int AS left FROM notifications WHERE user_id = ${userId}
    `
    expect(left).toBe(0)
    expect(await remindGuest(fixture.sql, userId, GuestReminderKind.ThirdVisit)).toBe(false)
  })
})

Deno.test("a guest's session is renewed to a year at most once a day", async () => {
  await withFixture(async (fixture) => {
    const { userId } = await startGuest(fixture)
    const [session] = await fixture.sql<{ id: number }[]>`
      SELECT id FROM auth_sessions WHERE user_id = ${userId}
    `
    const now = Date.now()
    expect(await renewGuestSession(fixture.sql, userId, session.id, new Date(now))).toBeNull()
    const nextDay = new Date(now + DAY_MS + 60_000)
    const renewed = await renewGuestSession(fixture.sql, userId, session.id, nextDay)
    expect(renewed?.visitDays).toBe(1)
    expect(renewed!.expiresAt.getTime()).toBe(nextDay.getTime() + GUEST_SESSION_DAYS * DAY_MS)
    expect(await renewGuestSession(fixture.sql, userId, session.id, nextDay)).toBeNull()
  })
})

Deno.test("a guest deletes the account with the typed word, not without it", async () => {
  await withFixture(async (fixture) => {
    const { browser, userId } = await startGuest(fixture)
    const wrong = await browser.call("POST", "/auth/guest/delete", { confirm: "yes" })
    expect(wrong.status).toBe(400)
    const deleted = await browser.call("POST", "/auth/guest/delete", { confirm: "delete" })
    expect(deleted.status).toBe(200)
    const [{ users }] = await fixture.sql<{ users: number }[]>`
      SELECT count(*)::int AS users FROM auth_users WHERE id = ${userId}
    `
    expect(users).toBe(0)
    expect((await browser.call("GET", "/auth/me")).status).toBe(401)
  })
})

Deno.test("a full account cannot use the guest deletion", async () => {
  await withFixture(async (fixture) => {
    const id = await fixture.account("ada@example.com")
    const full = fixture.browser()
    await full.call("POST", "/auth/password/check", {
      login: "ada@example.com",
      password: OTHER_PASSWORD,
    })
    const refused = await full.call("POST", "/auth/guest/delete", { confirm: "delete" })
    expect(refused.status).toBe(403)
    const [{ users }] = await fixture.sql<{ users: number }[]>`
      SELECT count(*)::int AS users FROM auth_users WHERE id = ${id}
    `
    expect(users).toBe(1)
  })
})

Deno.test("the clean-up deletes empty guests after a week and idle ones after a year, once", async () => {
  await withFixture(async (fixture) => {
    const empty = await startGuest(fixture)
    const busy = await startGuest(fixture)
    const fullId = await fixture.account("ada@example.com")
    const [group] = await fixture.sql<{ id: string }[]>`
      SELECT id FROM groups WHERE owner_user_id = ${busy.userId}
    `
    await fixture.sql`
      INSERT INTO notes (id, group_id, title, change_sequence, created_by_user_id)
      VALUES (${uuidV7()}, ${group.id}, 'Mine', 1, ${busy.userId})
    `
    const now = Date.now()
    expect(await cleanUpGuests(fixture.sql, new Date(now + 6 * DAY_MS))).toBe(0)
    expect(await cleanUpGuests(fixture.sql, new Date(now + 8 * DAY_MS))).toBe(1)
    expect(await cleanUpGuests(fixture.sql, new Date(now + 8 * DAY_MS))).toBe(0)
    const left = await fixture.sql<{ id: number }[]>`SELECT id FROM users ORDER BY id`
    expect(left.map((row) => row.id)).toEqual([busy.userId, fullId].sort((a, b) => a - b))
    expect(left.some((row) => row.id === empty.userId)).toBe(false)

    expect(await cleanUpGuests(fixture.sql, new Date(now + 366 * DAY_MS))).toBe(1)
    const after = await fixture.sql<{ id: number }[]>`SELECT id FROM users`
    expect(after.map((row) => row.id)).toEqual([fullId])
    const [{ cleaned }] = await fixture.sql<{ cleaned: number }[]>`
      SELECT count(*)::int AS cleaned FROM guest_events WHERE kind = 3
    `
    expect(cleaned).toBe(2)
  })
})

Deno.test("the hourly limit refuses a sixth guest from one network with the wait", async () => {
  const entries = new Map<string, unknown>()
  const limits = createAuthRateLimits({
    windowMs: 60_000,
    strictLimit: 100,
    limit: 100,
    otpWindowMs: 60_000,
    otpLimit: 100,
    store: () =>
      createKvStore({
        backend: {
          get: (key) => Promise.resolve(entries.get(key)),
          set: (key, value) => Promise.resolve(void entries.set(key, value)),
          delete: (key) => Promise.resolve(void entries.delete(key)),
        },
      }),
    onStoreError: () => {},
  })
  await withFixture(async (fixture) => {
    const answers = []
    // Six browsers, each with no cookie, behind one address.
    for (let attempt = 0; attempt < 6; attempt++) {
      answers.push(await fixture.browser("203.0.113.9").call("POST", "/auth/guest"))
    }
    expect(answers.map((answer) => answer.status)).toEqual([201, 201, 201, 201, 201, 429])
    expect(Number(answers[5].retryAfter)).toBeGreaterThan(60 * 59)
    const refused = checkedError(answers[5].body)
    expect(refused.details).toEqual({ retryAfterSeconds: Number(answers[5].retryAfter) })
    // The sentence says the real wait in minutes, under a title that already says what happened.
    expect(refused.message).toBe(
      `Try again in ${
        Math.ceil(Number(answers[5].retryAfter) / 60)
      } minutes, or create an account with your e-mail address.`,
    )
    // Another network is not counted with it.
    expect((await fixture.browser("203.0.113.10").call("POST", "/auth/guest")).status).toBe(201)
  }, { rateLimits: { guestStart: limits.guestStart } })
})
