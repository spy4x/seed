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
  DEFAULT_PREFERENCES,
  type GuestSwitchResponse,
  SIGN_IN_LINK_METHOD,
  UserMFAStatus,
} from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { createGuestRoute } from "../../apps/api/routes/auth-guest.ts"
import {
  createAuthRoute,
  SIGN_IN_LINK_REFUSED,
  SIGN_IN_LINK_UNCONFIRMED,
} from "../../apps/api/routes/auth.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createOutboxProcessor } from "../../libs/server/jobs/wiring.ts"
import { SIGN_IN_LINK_PATH } from "../../libs/server/auth/sign-in-links.ts"
import { enqueueSignInLinkMail } from "../../libs/server/jobs/sign-in-link-mail.ts"
import { readAdminUserParts } from "../../libs/server/auth/admin-users.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * Sign-in and sign-up by e-mail link (#391) through the real auth and guest routes, the real
 * sign-in, the worker's mail job and a real Postgres: one request and one mail for every address,
 * a link that works once, signs in to the owner of the address or makes the account, keeps a
 * guest, still asks for an authenticator code, and leaves alone an account that never proved the
 * address.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "the-owner's-own-password"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `link_test_${uuidV7().replaceAll("-", "")}`
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

interface Answer {
  status: number
  body: Record<string, unknown>
}

interface Browser {
  call(method: string, path: string, body?: unknown): Promise<Answer>
}

interface Fixture {
  sql: postgres.Sql
  sender: EmailSender & { sent: EmailMessage[] }
  /** A browser with its own cookie jar. */
  browser(): Browser
  /**
   * Asks for a link to `email` from `browser`, from a page in `language` when given, runs the
   * worker, and answers the link's token.
   */
  linkFor(browser: Browser, email: string, next?: string, language?: string): Promise<string>
  /** A full account that signs in with `email` and {@link PASSWORD}, its address proven or not. */
  account(email: string, proven?: boolean): Promise<number>
  count(table: string): Promise<number>
}

/** The auth and guest routes as `index.ts` mounts them, with the worker's mail job. */
async function withFixture(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  await withSchema(async (sql) => {
    const signIn = createSignIn({
      db: new AppDbBase({ sql }),
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: 60,
      totpIssuer: "example.test",
    })
    const mutationGuards = createMutationGuards(WEB_APP_URL)
    const app = new Hono<APIContext>().basePath("/api")
    app.use("*", async (c, next) => {
      c.set("requestId", uuidV7())
      await next()
    })
    app.use("*", signIn.auth.parseAuth)
    app.route("/auth", createGuestRoute({ signIn, mutationGuards, rateLimits: openLimits }))
    app.route(
      "/auth",
      createAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards,
        rateLimits: openLimits,
        totpFailures: openLockout,
        passwordFailures: openLockout,
        requestPasswordReset: () => Promise.resolve(),
        requestSignInLink: (email, next, requestedBy, language) =>
          enqueueSignInLinkMail(sql, email, next, requestedBy, language),
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
    const browser = (): Browser => {
      const cookies = new Map<string, string>()
      const own = `198.51.100.${++ip}`
      return {
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
          for (const line of response.headers.getSetCookie()) {
            const [pair] = line.split(";")
            const name = pair.slice(0, pair.indexOf("="))
            const value = pair.slice(pair.indexOf("=") + 1)
            if (value === "" || /max-age=0/i.test(line)) cookies.delete(name)
            else cookies.set(name, value)
          }
          const text = await response.text()
          return { status: response.status, body: text ? JSON.parse(text) : {} }
        },
      }
    }
    await body({
      sql,
      sender,
      browser,
      async linkFor(browser, email, next, language) {
        const asked = await browser.call("POST", "/auth/link", { email, next, language })
        expect(asked.status).toBe(200)
        await processor.drainOnce()
        const mail = sender.sent.findLast((sent) => sent.to === email)
        if (!mail) throw new Error(`no link mail to ${email}`)
        const link = new URL(mail.text!.split("\n\n")[2].trim())
        expect(link.pathname).toBe(SIGN_IN_LINK_PATH)
        return new URLSearchParams(link.hash.slice(1)).get("token")!
      },
      async account(email, proven = true) {
        const { user } = await store.createUserWithKey({
          method: PASSWORD_METHOD,
          subject: email,
          email,
          secret: await createPasswordHasher({ pepper: PEPPER }).hash(PASSWORD),
          provenAt: proven ? new Date() : null,
        })
        await sql`
          INSERT INTO users (id, first_name, last_name, mfa, role) VALUES (${user.id}, '', '', 1, 1)
        `
        return user.id
      },
      count: async (table) =>
        (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)}`)[0]
          .count,
    })
  })
}

/** The audit rows of `userId`, oldest first, as event type and identifier. */
async function auditsOf(sql: postgres.Sql, userId: number) {
  return await sql<{ eventType: number; identifier: string | null }[]>`
    SELECT event_type AS "eventType", identifier FROM auth_audits
    WHERE user_id = ${userId} ORDER BY id
  `
}

Deno.test("a link request writes the same rows and sends the same mail for a known and an unknown address", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("known@example.com")
    const work = []
    for (const email of ["known@example.com", "unknown@example.com"]) {
      await fixture.linkFor(fixture.browser(), email)
      const mail = fixture.sender.sent.at(-1)!
      work.push({ subject: mail.subject, lines: mail.text!.split("\n\n").length })
    }

    expect(fixture.sender.sent).toHaveLength(2)
    expect(work[1]).toEqual(work[0])
    expect(await fixture.count("sign_in_link_requests")).toBe(2)
    // Nothing of an account yet: the unknown address got no user, session or audit row.
    expect(await fixture.count("auth_users")).toBe(1)
    expect(await fixture.count("auth_sessions")).toBe(0)
    expect(await fixture.count("auth_audits")).toBe(0)
  })
})

Deno.test("a link mail to an account is in the account's saved language, not the asking page's", async () => {
  await withFixture(async (fixture) => {
    const userId = await fixture.account("ann@example.com")
    await fixture.sql`
      INSERT INTO user_preferences (user_id, value, version)
      VALUES (${userId}, ${fixture.sql.json({ ...DEFAULT_PREFERENCES, language: "de" })}, 1)
    `
    await fixture.linkFor(fixture.browser(), "ann@example.com", undefined, "es")

    expect(fixture.sender.sent.at(-1)!.subject).toBe("Dein Anmeldelink für app.example.com")
  })
})

Deno.test("a link mail to an address with no account is in the asking page's language", async () => {
  await withFixture(async (fixture) => {
    await fixture.linkFor(fixture.browser(), "new@example.com", undefined, "es")

    expect(fixture.sender.sent.at(-1)!.subject)
      .toBe("Tu enlace para iniciar sesión en app.example.com")
  })
})

Deno.test("a link signs in to the owner of its address, once, through the link key", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "ada@example.com", "/notes?tag=work")

    const redeemed = await person.call("POST", "/auth/link/redeem", { token })
    const again = await fixture.browser().call("POST", "/auth/link/redeem", { token })

    expect(redeemed).toEqual({
      status: 200,
      body: {
        email: "ada@example.com",
        next: "/notes?tag=work",
        created: false,
        secondFactorPending: false,
      },
    })
    expect(await person.call("GET", "/auth/me")).toMatchObject({ status: 200, body: { id: owner } })
    expect(again).toMatchObject({
      status: 410,
      body: { error: { code: "not_found", message: SIGN_IN_LINK_REFUSED } },
    })
    const [session] = await fixture.sql<{ method: string }[]>`
      SELECT k.method FROM auth_sessions s JOIN auth_keys k ON k.id = s.key_id
      WHERE s.user_id = ${owner}
    `
    expect(session.method).toBe(SIGN_IN_LINK_METHOD)
    expect(await auditsOf(fixture.sql, owner)).toEqual([
      { eventType: AuthAuditEventType.SIGNED_IN, identifier: SIGN_IN_LINK_METHOD },
    ])
    expect(await fixture.count("sign_in_link_requests")).toBe(0)
    // The operator sees the link among the ways in, with when it was last used.
    const { methods } = await readAdminUserParts(fixture.sql, owner)
    expect(methods.find((method) => method.method === SIGN_IN_LINK_METHOD)?.lastUsedAt)
      .toEqual(expect.any(String))
  })
})

Deno.test("using one link stops the address's other links", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const first = await fixture.linkFor(fixture.browser(), "ada@example.com")
    const second = await fixture.linkFor(fixture.browser(), "ada@example.com")

    expect((await fixture.browser().call("POST", "/auth/link/redeem", { token: second })).status)
      .toBe(200)
    expect((await fixture.browser().call("POST", "/auth/link/redeem", { token: first })).status)
      .toBe(410)
  })
})

Deno.test("a link to a new address makes the account with the address proven, and signs it in", async () => {
  await withFixture(async (fixture) => {
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "new@example.com")

    const redeemed = await person.call("POST", "/auth/link/redeem", { token })

    expect(redeemed).toEqual({
      status: 200,
      body: { email: "new@example.com", next: null, created: true, secondFactorPending: false },
    })
    const me = await person.call("GET", "/auth/me")
    expect(me.status).toBe(200)
    const userId = me.body.id as number
    const [owner] = await fixture.sql<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM auth_email_owners WHERE email = 'new@example.com'
    `
    expect(owner.userId).toBe(userId)
    expect(await fixture.count("groups")).toBe(1)
    expect(await auditsOf(fixture.sql, userId)).toEqual([
      { eventType: AuthAuditEventType.SIGNED_UP, identifier: SIGN_IN_LINK_METHOD },
    ])
    // The next link to the same address signs in to that account instead of making another.
    const later = fixture.browser()
    await later.call("POST", "/auth/link/redeem", {
      token: await fixture.linkFor(later, "new@example.com"),
    })
    expect(await later.call("GET", "/auth/me")).toMatchObject({ body: { id: userId } })
    expect(await fixture.count("auth_users")).toBe(1)
  })
})

Deno.test("a link to an account with an authenticator app still owes its code", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${owner}`
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "ada@example.com")

    const redeemed = await person.call("POST", "/auth/link/redeem", { token })

    expect(redeemed.body.secondFactorPending).toBe(true)
    expect(await person.call("GET", "/auth/me")).toEqual({
      status: 202,
      body: { secondFactor: "Pending" },
    })
  })
})

Deno.test("a link leaves alone an account that signs in with the address but never proved it", async () => {
  await withFixture(async (fixture) => {
    const claimant = await fixture.account("ada@example.com", false)
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "ada@example.com")

    const redeemed = await person.call("POST", "/auth/link/redeem", { token })

    expect(redeemed).toMatchObject({
      status: 409,
      body: { error: { code: "conflict", message: SIGN_IN_LINK_UNCONFIRMED } },
    })
    expect((await person.call("GET", "/auth/me")).status).toBe(401)
    expect(await fixture.count("auth_users")).toBe(1)
    const keys = await fixture.sql<{ method: string; provenAt: Date | null }[]>`
      SELECT method, proven_at AS "provenAt" FROM auth_keys WHERE user_id = ${claimant}
    `
    expect(keys).toEqual([{ method: PASSWORD_METHOD, provenAt: null }])
  })
})

Deno.test("a link refuses a deleted account like a used link", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE auth_users SET deleted_at = now() WHERE id = ${owner}`
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "ada@example.com")

    expect(await person.call("POST", "/auth/link/redeem", { token })).toMatchObject({
      status: 410,
      body: { error: { code: "not_found", message: SIGN_IN_LINK_REFUSED } },
    })
    expect(await fixture.count("auth_sessions")).toBe(0)
  })
})

Deno.test("a guest who opens a link someone else asked for keeps their guest session and user id", async () => {
  await withFixture(async (fixture) => {
    const asker = fixture.browser()
    const token = await fixture.linkFor(asker, "mallory@example.com")
    const victim = fixture.browser()
    await victim.call("POST", "/auth/guest")
    const guestId = (await victim.call("GET", "/auth/me")).body.id as number

    const redeemed = await victim.call("POST", "/auth/link/redeem", { token })

    // Still the same guest, on the one session the guest had: a guest key has no secret, so a
    // lost session would lose the account for good.
    expect(await victim.call("GET", "/auth/me")).toMatchObject({
      status: 200,
      body: { id: guestId, guestSince: expect.any(String) },
    })
    expect(await fixture.sql`SELECT 1 FROM auth_sessions WHERE user_id = ${guestId}`)
      .toHaveLength(1)
    // A refusal of its own, which the link page words, and the link is spent: no account came of it.
    expect(redeemed).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden", reason: "SIGN_IN_LINK_ASKED_ELSEWHERE" } },
    })
    expect((await asker.call("POST", "/auth/link/redeem", { token })).status).toBe(410)
    expect(await fixture.count("auth_users")).toBe(1)
    // The asker signs in with a new link to the same address, as an attacker would, and gets the
    // address's own account; the guest account gained no address.
    await asker.call("POST", "/auth/link/redeem", {
      token: await fixture.linkFor(asker, "mallory@example.com"),
    })
    expect((await asker.call("GET", "/auth/me")).body.id).not.toBe(guestId)
    expect(
      await fixture.sql`SELECT 1 FROM auth_keys WHERE user_id = ${guestId} AND email IS NOT NULL`,
    ).toHaveLength(0)
  })
})

Deno.test("a guest who opens someone else's link to an existing account is refused, with no switch into it", async () => {
  await withFixture(async (fixture) => {
    // The stranger's own account, and a link to it that the stranger hands a guest.
    await fixture.account("mallory@example.com")
    const token = await fixture.linkFor(fixture.browser(), "mallory@example.com")
    const victim = fixture.browser()
    await victim.call("POST", "/auth/guest")
    const guestId = (await victim.call("GET", "/auth/me")).body.id as number

    const redeemed = await victim.call("POST", "/auth/link/redeem", { token })

    expect(redeemed).toMatchObject({
      status: 403,
      body: { error: { code: "forbidden", reason: "SIGN_IN_LINK_ASKED_ELSEWHERE" } },
    })
    expect(await victim.call("GET", "/auth/guest/switch")).toEqual({
      status: 200,
      body: { switch: null },
    })
    expect(await victim.call("GET", "/auth/me")).toMatchObject({
      status: 200,
      body: { id: guestId, guestSince: expect.any(String) },
    })
  })
})

Deno.test("a link refuses a blocked account like a used link", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE users SET blocked_at = now() WHERE id = ${owner}`
    const person = fixture.browser()
    const token = await fixture.linkFor(person, "ada@example.com")

    expect(await person.call("POST", "/auth/link/redeem", { token })).toMatchObject({
      status: 410,
      body: { error: { code: "not_found", message: SIGN_IN_LINK_REFUSED } },
    })
    expect(await fixture.count("auth_sessions")).toBe(0)
  })
})

Deno.test("a guest's link to a new address keeps the guest with the same user id", async () => {
  await withFixture(async (fixture) => {
    const guest = fixture.browser()
    expect((await guest.call("POST", "/auth/guest")).status).toBe(201)
    const guestId = (await guest.call("GET", "/auth/me")).body.id as number
    const token = await fixture.linkFor(guest, "grace@example.com")

    const redeemed = await guest.call("POST", "/auth/link/redeem", { token })

    expect(redeemed.body).toMatchObject({ email: "grace@example.com", created: true })
    expect(await guest.call("GET", "/auth/me")).toMatchObject({
      status: 200,
      body: { id: guestId, guestSince: null },
    })
    const [owner] = await fixture.sql<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM auth_email_owners WHERE email = 'grace@example.com'
    `
    expect(owner.userId).toBe(guestId)
  })
})

Deno.test("a guest's link to another account's address changes nothing and offers the switch", async () => {
  await withFixture(async (fixture) => {
    const other = await fixture.account("ada@example.com")
    const guest = fixture.browser()
    await guest.call("POST", "/auth/guest")
    const guestId = (await guest.call("GET", "/auth/me")).body.id as number
    const token = await fixture.linkFor(guest, "ada@example.com")

    const redeemed = await guest.call("POST", "/auth/link/redeem", { token })

    expect(redeemed).toEqual({ status: 200, body: { guestTaken: true } })
    expect(await guest.call("GET", "/auth/me")).toMatchObject({ body: { id: guestId } })
    const waiting = await guest.call("GET", "/auth/guest/switch")
    expect((waiting.body as unknown as GuestSwitchResponse).switch).toMatchObject({
      method: SIGN_IN_LINK_METHOD,
      maskedEmail: "a***@example.com",
      needsPassword: false,
    })
    const switched = await guest.call("POST", "/auth/guest/switch", { choice: "move" })
    expect(switched.status).toBe(200)
    expect(await guest.call("GET", "/auth/me")).toMatchObject({ body: { id: other } })
  })
})
