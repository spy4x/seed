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
import { createOAuthRoute } from "../../apps/api/routes/auth-oauth.ts"
import { MAILED_CODE_DEAD, MAILED_CODE_WRONG } from "../../apps/api/routes/auth-answers.ts"
import { PASSWORD_RESET_REFUSED } from "../../apps/api/routes/auth-password-reset.ts"
import { SIGN_IN_CODE_UNCONFIRMED } from "../../apps/api/routes/auth-sign-in-codes.ts"
import { createAuthRoute } from "../../apps/api/routes/auth.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createOutboxProcessor } from "../../libs/server/jobs/wiring.ts"
import { MAILED_CODE_MAX_GUESSES } from "../../libs/server/auth/mailed-codes.ts"
import { readAdminUserParts } from "../../libs/server/auth/admin-users.ts"
import { expectVersion7Ids } from "./ids.ts"
import { applyMigrations } from "./migrations.ts"
import { notified, sessionsOfRows, subscribeNewest } from "./push-rows.ts"

/**
 * Sign-in and sign-up by an e-mailed code, and password reset by one (#391, #752), through the
 * real auth and guest routes, the real sign-in, the worker's mail jobs and a real Postgres: one
 * request and one mail for every address, a code that works once, only in the browser that asked,
 * within its guesses and its lifetime; it signs in to the owner of the address or makes the
 * account, keeps a guest, still asks for an authenticator code, and leaves alone an account that
 * never proved the address.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "the-owner's-own-password"
const NEW_PASSWORD = "a-brand-new-password-of-the-owner"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"

/** A code alone on its line of a mail's text. */
const CODE_LINE = /^([A-Za-z0-9_-]{8})$/m

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `code_test_${uuidV7().replaceAll("-", "")}`
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
  signInCode: allowed,
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
  /** The `Set-Cookie` lines of the last answer, as sent. */
  setCookies(): string[]
}

interface Fixture {
  sql: postgres.Sql
  sender: EmailSender & { sent: EmailMessage[] }
  /** A browser with its own cookie jar. */
  browser(): Browser
  /**
   * Asks for a sign-in code to `email` from `browser`, from a page in `language` when given, runs
   * the worker, and answers the mailed code.
   */
  codeFor(browser: Browser, email: string, next?: string, language?: string): Promise<string>
  /**
   * Asks for a password-reset code to `email` from `browser`, runs the worker, and answers the
   * mailed code, or `null` when no mail went out.
   */
  resetCodeFor(browser: Browser, email: string): Promise<string | null>
  /** Runs the worker once and answers the code of the newest mail to `email`. */
  mailedCode(email: string): Promise<string>
  /** A full account that signs in with `email` and {@link PASSWORD}, its address proven or not. */
  account(email: string, proven?: boolean): Promise<number>
  count(table: string): Promise<number>
}

/** The auth and guest routes as `index.ts` mounts them, with the worker's mail jobs. */
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
      createOAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards,
        rateLimits: openLimits,
        origin: WEB_APP_URL,
        logError: () => {},
      }),
    )
    app.route(
      "/auth",
      createAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards,
        rateLimits: openLimits,
        totpFailures: openLockout,
        passwordFailures: openLockout,
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
      let setCookies: string[] = []
      const own = `198.51.100.${++ip}`
      return {
        setCookies: () => setCookies,
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
          setCookies = response.headers.getSetCookie()
          return { status: response.status, body: text ? JSON.parse(text) : {} }
        },
      }
    }
    const mailedCode = async (email: string) => {
      await processor.drainOnce()
      const mail = sender.sent.findLast((sent) => sent.to === email)
      const code = mail?.text?.match(CODE_LINE)?.[1]
      if (!code) throw new Error(`no code mail to ${email}`)
      return code
    }
    await body({
      sql,
      sender,
      browser,
      mailedCode,
      async codeFor(browser, email, next, language) {
        const asked = await browser.call("POST", "/auth/code", { email, next, language })
        expect(asked.status).toBe(200)
        return await mailedCode(email)
      },
      async resetCodeFor(browser, email) {
        const before = sender.sent.length
        const asked = await browser.call("POST", "/auth/password/forgot", { email })
        expect(asked.status).toBe(200)
        await processor.drainOnce()
        if (sender.sent.length === before) return null
        return sender.sent.at(-1)!.text!.match(CODE_LINE)![1]
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

const wrong = { status: 400, body: { error: { code: "bad_request", message: MAILED_CODE_WRONG } } }
const dead = { status: 410, body: { error: { code: "not_found", message: MAILED_CODE_DEAD } } }

/** A well-formed code that the mail did not carry. */
function otherThan(code: string): string {
  return code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA"
}

Deno.test("a code request writes the same rows and sends the same mail for a known and an unknown address", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("known@example.com")
    const work = []
    for (const email of ["known@example.com", "unknown@example.com"]) {
      const code = await fixture.codeFor(fixture.browser(), email)
      const mail = fixture.sender.sent.at(-1)!
      // Everything but the code and the minute of asking, which the first line names.
      const [, ...rest] = mail.text!.replace(code, "CODE").split("\n")
      work.push({ subject: mail.subject, text: rest })
    }

    expect(fixture.sender.sent).toHaveLength(2)
    expect(work[1]).toEqual(work[0])
    expect(await fixture.count("sign_in_code_requests")).toBe(2)
    expect(await fixture.count("auth_challenges")).toBe(2)
    // Nothing of an account yet: the unknown address got no user, session or audit row.
    expect(await fixture.count("auth_users")).toBe(1)
    expect(await fixture.count("auth_sessions")).toBe(0)
    expect(await fixture.count("auth_audits")).toBe(0)
  })
})

Deno.test("the code cookies are HttpOnly, SameSite=Lax and sent only to their own routes", async () => {
  await withFixture(async (fixture) => {
    const browser = fixture.browser()
    const cookieOf = (name: string) => {
      const line = browser.setCookies().find((cookie) => cookie.startsWith(`${name}=`))
      if (!line) throw new Error(`no ${name} cookie in ${JSON.stringify(browser.setCookies())}`)
      return line.split(";").slice(1).map((part) => part.trim().toLowerCase()).sort()
    }

    await browser.call("POST", "/auth/code", { email: "ann@example.com" })
    expect(cookieOf("sign_in_code")).toEqual(
      ["httponly", "max-age=600", "path=/api/auth/code", "samesite=lax"],
    )
    await browser.call("POST", "/auth/password/forgot", { email: "ann@example.com" })
    expect(cookieOf("password_reset")).toEqual(
      ["httponly", "max-age=600", "path=/api/auth/password/reset", "samesite=lax"],
    )
  })
})

Deno.test("a code mail to an account is in the account's saved language, not the asking page's", async () => {
  await withFixture(async (fixture) => {
    const userId = await fixture.account("ann@example.com")
    await fixture.sql`
      INSERT INTO user_preferences (user_id, value, version)
      VALUES (${userId}, ${fixture.sql.json({ ...DEFAULT_PREFERENCES, language: "de" })}, 1)
    `
    await fixture.codeFor(fixture.browser(), "ann@example.com", undefined, "es")

    expect(fixture.sender.sent.at(-1)!.subject).toBe("Dein Anmeldecode für app.example.com")
  })
})

Deno.test("a code mail to an address with no account is in the asking page's language", async () => {
  await withFixture(async (fixture) => {
    await fixture.codeFor(fixture.browser(), "new@example.com", undefined, "es")

    expect(fixture.sender.sent.at(-1)!.subject)
      .toBe("Tu código para iniciar sesión en app.example.com")
  })
})

Deno.test("the right code in the asking browser signs in to the owner of the address, once, through the code key", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com", "/notes?tag=work")
    // Only a hash of the code is stored.
    const stored = await fixture.sql<{ secretHash: string }[]>`
      SELECT secret_hash AS "secretHash" FROM auth_challenges`
    expect(stored.map((row) => row.secretHash)).not.toContain(code)

    const verified = await person.call("POST", "/auth/code/verify", { code })
    const again = await person.call("POST", "/auth/code/verify", { code })

    expect(verified).toEqual({
      status: 200,
      body: {
        email: "ada@example.com",
        next: "/notes?tag=work",
        created: false,
        secondFactorPending: false,
      },
    })
    expect(await person.call("GET", "/auth/me")).toMatchObject({ status: 200, body: { id: owner } })
    expect(again).toMatchObject(dead)
    const [session] = await fixture.sql<{ method: string }[]>`
      SELECT k.method FROM auth_sessions s JOIN auth_keys k ON k.id = s.key_id
      WHERE s.user_id = ${owner}
    `
    expect(session.method).toBe(SIGN_IN_LINK_METHOD)
    expect(await auditsOf(fixture.sql, owner)).toEqual([
      { eventType: AuthAuditEventType.SIGNED_IN, identifier: SIGN_IN_LINK_METHOD },
    ])
    expect(await fixture.count("sign_in_code_requests")).toBe(0)
    expect(await fixture.count("auth_challenges")).toBe(0)
    // The operator sees the e-mail code among the ways in, with when it was last used.
    const { methods } = await readAdminUserParts(fixture.sql, owner)
    expect(methods.find((method) => method.method === SIGN_IN_LINK_METHOD)?.lastUsedAt)
      .toEqual(expect.any(String))
  })
})

Deno.test("a code from the danger zone signs the same person in again with fresh proof and returns to the profile", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    const person = fixture.browser()
    const signedIn = await person.call("POST", "/auth/password/check", {
      login: "ada@example.com",
      password: PASSWORD,
    })
    expect(signedIn.status).toBe(200)
    const before = await person.call("GET", "/auth/methods")
    expect(before).toMatchObject({ status: 200, body: { providerProofUntil: null } })

    const code = await fixture.codeFor(person, "ada@example.com", "/profile/danger-zone")
    const verified = await person.call("POST", "/auth/code/verify", { code })

    expect(verified).toMatchObject({
      status: 200,
      body: { email: "ada@example.com", next: "/profile/danger-zone", created: false },
    })
    expect(await person.call("GET", "/auth/me")).toMatchObject({ status: 200, body: { id: owner } })
    const after = await person.call("GET", "/auth/methods")
    expect(after.status).toBe(200)
    expect(Date.parse(after.body.providerProofUntil as string)).toBeGreaterThan(Date.now())
  })
})

Deno.test("the right code typed in another browser does nothing, and still works in the asking one", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")
    const stranger = fixture.browser()

    expect(await stranger.call("POST", "/auth/code/verify", { code })).toMatchObject(dead)
    expect((await stranger.call("GET", "/auth/me")).status).toBe(401)
    expect(await fixture.count("auth_sessions")).toBe(0)

    expect((await person.call("POST", "/auth/code/verify", { code })).status).toBe(200)
    expect(await person.call("GET", "/auth/me")).toMatchObject({ body: { id: owner } })
  })
})

Deno.test("a wrong code is refused with the request still waiting for the right one", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    expect(await person.call("POST", "/auth/code/verify", { code: otherThan(code) }))
      .toMatchObject(wrong)
    expect(await person.call("GET", "/auth/code")).toEqual({
      status: 200,
      body: { email: "ada@example.com" },
    })
    expect((await person.call("POST", "/auth/code/verify", { code })).status).toBe(200)
  })
})

Deno.test("after the last wrong guess even the right code is refused and the request ends", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    for (let guess = 0; guess < MAILED_CODE_MAX_GUESSES; guess++) {
      expect(await person.call("POST", "/auth/code/verify", { code: otherThan(code) }))
        .toMatchObject(wrong)
    }
    const locked = await person.call("POST", "/auth/code/verify", { code })

    expect(locked).toMatchObject(dead)
    expect(await fixture.count("auth_sessions")).toBe(0)
    expect(await fixture.count("sign_in_code_requests")).toBe(0)
    expect(await person.call("GET", "/auth/code")).toEqual({ status: 200, body: { email: null } })
  })
})

Deno.test("an expired code is refused and the request ends", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")
    await fixture.sql`UPDATE sign_in_code_requests SET expires_at = now() - interval '1 second'`
    await fixture.sql`UPDATE auth_challenges SET expires_at = now() - interval '1 second'`

    expect(await person.call("POST", "/auth/code/verify", { code })).toMatchObject(dead)
    expect(await fixture.count("auth_sessions")).toBe(0)
  })
})

Deno.test("a new code ends the old one, and the new one signs in", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    const person = fixture.browser()
    const first = await fixture.codeFor(person, "ada@example.com")
    expect((await person.call("POST", "/auth/code/resend")).status).toBe(200)
    const second = await fixture.mailedCode("ada@example.com")

    expect(second).not.toBe(first)
    expect(await person.call("POST", "/auth/code/verify", { code: first })).toMatchObject(wrong)
    expect((await person.call("POST", "/auth/code/verify", { code: second })).status).toBe(200)
    expect(await person.call("GET", "/auth/me")).toMatchObject({ body: { id: owner } })
  })
})

Deno.test("using one code stops the address's other codes", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const laptop = fixture.browser()
    const phone = fixture.browser()
    const first = await fixture.codeFor(laptop, "ada@example.com")
    const second = await fixture.codeFor(phone, "ada@example.com")

    expect((await phone.call("POST", "/auth/code/verify", { code: second })).status).toBe(200)
    expect(await laptop.call("POST", "/auth/code/verify", { code: first })).toMatchObject(dead)
  })
})

Deno.test("a code used on a browser signed in as someone else stops that person's notifications there", async () => {
  await withFixture(async (fixture) => {
    const ada = await fixture.account("ada@example.com")
    const bob = await fixture.account("bob@example.com")
    const shared = fixture.browser()
    const own = await fixture.codeFor(shared, "ada@example.com")
    expect((await shared.call("POST", "/auth/code/verify", { code: own })).status).toBe(200)
    const before = await subscribeNewest(fixture.sql, ada)

    // Ada signs in again with a second code: the browser's notifications follow her new session.
    const second = await fixture.codeFor(shared, "ada@example.com")
    expect((await shared.call("POST", "/auth/code/verify", { code: second })).status).toBe(200)
    const [session] = await fixture.sql<{ id: number }[]>`
      SELECT id FROM auth_sessions WHERE user_id = ${ada}`
    expect(session.id).not.toBe(before.sessionId)
    expect(await sessionsOfRows(fixture.sql, ada)).toEqual({ [before.deviceId]: session.id })

    // Bob signs in with his code on the same browser: Ada's notifications stop there.
    const bobs = await fixture.codeFor(shared, "bob@example.com")
    expect((await shared.call("POST", "/auth/code/verify", { code: bobs })).status).toBe(200)
    expect(await shared.call("GET", "/auth/me")).toMatchObject({ body: { id: bob } })
    expect(await notified(fixture.sql, ada)).toEqual([])
  })
})

Deno.test("a code to a new address makes the account with the address proven, and signs it in", async () => {
  await withFixture(async (fixture) => {
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "new@example.com")

    const verified = await person.call("POST", "/auth/code/verify", { code })

    expect(verified).toEqual({
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
    // The request named no group, so the server made the id of the first one.
    expectVersion7Ids(await fixture.sql<{ id: string }[]>`SELECT id FROM groups`)
    expect(await auditsOf(fixture.sql, userId)).toEqual([
      { eventType: AuthAuditEventType.SIGNED_UP, identifier: SIGN_IN_LINK_METHOD },
    ])
    // The next code to the same address signs in to that account instead of making another.
    const later = fixture.browser()
    await later.call("POST", "/auth/code/verify", {
      code: await fixture.codeFor(later, "new@example.com"),
    })
    expect(await later.call("GET", "/auth/me")).toMatchObject({ body: { id: userId } })
    expect(await fixture.count("auth_users")).toBe(1)
  })
})

Deno.test("a code to an account with an authenticator app still owes the app's code", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${owner}`
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    const verified = await person.call("POST", "/auth/code/verify", { code })

    expect(verified.body.secondFactorPending).toBe(true)
    expect(await person.call("GET", "/auth/me")).toEqual({
      status: 202,
      body: { secondFactor: "Pending" },
    })
  })
})

Deno.test("a code leaves alone an account that signs in with the address but never proved it", async () => {
  await withFixture(async (fixture) => {
    const claimant = await fixture.account("ada@example.com", false)
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    const verified = await person.call("POST", "/auth/code/verify", { code })

    expect(verified).toMatchObject({
      status: 409,
      body: { error: { code: "conflict", message: SIGN_IN_CODE_UNCONFIRMED } },
    })
    expect((await person.call("GET", "/auth/me")).status).toBe(401)
    expect(await fixture.count("auth_users")).toBe(1)
    const keys = await fixture.sql<{ method: string; provenAt: Date | null }[]>`
      SELECT method, proven_at AS "provenAt" FROM auth_keys WHERE user_id = ${claimant}
    `
    expect(keys).toEqual([{ method: PASSWORD_METHOD, provenAt: null }])
  })
})

Deno.test("a code refuses a deleted account like a dead code", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE auth_users SET deleted_at = now() WHERE id = ${owner}`
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    expect(await person.call("POST", "/auth/code/verify", { code })).toMatchObject(dead)
    expect(await fixture.count("auth_sessions")).toBe(0)
  })
})

Deno.test("a code refuses a blocked account like a dead code", async () => {
  await withFixture(async (fixture) => {
    const owner = await fixture.account("ada@example.com")
    await fixture.sql`UPDATE users SET blocked_at = now() WHERE id = ${owner}`
    const person = fixture.browser()
    const code = await fixture.codeFor(person, "ada@example.com")

    expect(await person.call("POST", "/auth/code/verify", { code })).toMatchObject(dead)
    expect(await fixture.count("auth_sessions")).toBe(0)
  })
})

Deno.test("a guest who started after the code was asked for is refused and keeps their guest session", async () => {
  await withFixture(async (fixture) => {
    const shared = fixture.browser()
    const code = await fixture.codeFor(shared, "mallory@example.com")
    await shared.call("POST", "/auth/guest")
    const guestId = (await shared.call("GET", "/auth/me")).body.id as number

    const verified = await shared.call("POST", "/auth/code/verify", { code })

    // Still the same guest, on the one session the guest had: a guest key has no secret, so a
    // lost session would lose the account for good.
    expect(verified).toMatchObject(dead)
    expect(await shared.call("GET", "/auth/me")).toMatchObject({
      status: 200,
      body: { id: guestId, guestSince: expect.any(String) },
    })
    expect(await fixture.sql`SELECT 1 FROM auth_sessions WHERE user_id = ${guestId}`)
      .toHaveLength(1)
    expect(await fixture.count("auth_users")).toBe(1)
    expect(
      await fixture.sql`SELECT 1 FROM auth_keys WHERE user_id = ${guestId} AND email IS NOT NULL`,
    ).toHaveLength(0)
  })
})

Deno.test("a guest who types someone else's code to an existing account is refused, with no switch into it", async () => {
  await withFixture(async (fixture) => {
    // The stranger's own account, and a code to it that the stranger hands a guest.
    await fixture.account("mallory@example.com")
    const code = await fixture.codeFor(fixture.browser(), "mallory@example.com")
    const victim = fixture.browser()
    await victim.call("POST", "/auth/guest")
    const guestId = (await victim.call("GET", "/auth/me")).body.id as number

    expect(await victim.call("POST", "/auth/code/verify", { code })).toMatchObject(dead)
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

Deno.test("a guest's code to a new address keeps the guest with the same user id on a new session", async () => {
  await withFixture(async (fixture) => {
    const guest = fixture.browser()
    expect((await guest.call("POST", "/auth/guest")).status).toBe(201)
    const guestId = (await guest.call("GET", "/auth/me")).body.id as number
    const code = await fixture.codeFor(guest, "grace@example.com")
    const sessionIds = () =>
      fixture.sql<{ id: number }[]>`SELECT id FROM auth_sessions WHERE user_id = ${guestId}`
    const [guestSession] = await sessionIds()

    const verified = await guest.call("POST", "/auth/code/verify", { code })

    expect(verified.body).toMatchObject({ email: "grace@example.com", created: true })
    expect(await guest.call("GET", "/auth/me")).toMatchObject({
      status: 200,
      body: { id: guestId, guestSince: null },
    })
    // The guest's session ended (#374); the browser goes on with a new one, on the new cookie.
    const after = await sessionIds()
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(guestSession.id)
    const [owner] = await fixture.sql<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM auth_email_owners WHERE email = 'grace@example.com'
    `
    expect(owner.userId).toBe(guestId)
  })
})

Deno.test("a guest's code to another account's address changes nothing and offers the switch", async () => {
  await withFixture(async (fixture) => {
    const other = await fixture.account("ada@example.com")
    const guest = fixture.browser()
    await guest.call("POST", "/auth/guest")
    const guestId = (await guest.call("GET", "/auth/me")).body.id as number
    const code = await fixture.codeFor(guest, "ada@example.com")

    const verified = await guest.call("POST", "/auth/code/verify", { code })

    expect(verified).toEqual({ status: 200, body: { guestTaken: true } })
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

Deno.test("a reset code in the asking browser gives a token that sets the new password, with no token in any URL", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = await fixture.resetCodeFor(person, "ada@example.com")
    if (code === null) throw new Error("no reset mail")
    const mail = fixture.sender.sent.at(-1)!
    expect(mail.text).not.toMatch(/https?:\/\//)

    const verified = await person.call("POST", "/auth/password/reset/verify", { code })
    const token = verified.body.token as string
    const reset = await person.call("POST", "/auth/password/reset", {
      token,
      newPassword: NEW_PASSWORD,
    })

    expect(verified.status).toBe(200)
    expect(token).toEqual(expect.any(String))
    expect(mail.text).not.toContain(token)
    expect(reset).toEqual({ status: 200, body: { success: true } })
    expect(await fixture.count("password_reset_requests")).toBe(0)
    expect(await person.call("POST", "/auth/password/reset/verify", { code })).toMatchObject(dead)
    const signIn = (password: string) =>
      fixture.browser().call("POST", "/auth/password/check", {
        login: "ada@example.com",
        password,
      })
    expect((await signIn(NEW_PASSWORD)).status).toBe(200)
    expect((await signIn(PASSWORD)).status).not.toBe(200)
  })
})

Deno.test("a reset code or token used in another browser changes nothing", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const person = fixture.browser()
    const code = (await fixture.resetCodeFor(person, "ada@example.com"))!
    const stranger = fixture.browser()

    expect(await stranger.call("POST", "/auth/password/reset/verify", { code }))
      .toMatchObject(dead)
    const verified = await person.call("POST", "/auth/password/reset/verify", { code })
    const token = verified.body.token as string
    const stolen = await stranger.call("POST", "/auth/password/reset", {
      token,
      newPassword: NEW_PASSWORD,
    })

    expect(stolen).toMatchObject({
      status: 400,
      body: { error: { code: "bad_request", message: PASSWORD_RESET_REFUSED } },
    })
    const signedIn = await fixture.browser().call("POST", "/auth/password/check", {
      login: "ada@example.com",
      password: PASSWORD,
    })
    expect(signedIn.status).toBe(200)
  })
})

Deno.test("a reset for an unknown address answers and counts guesses as for a known one, and mails nothing", async () => {
  await withFixture(async (fixture) => {
    await fixture.account("ada@example.com")
    const known = fixture.browser()
    const unknown = fixture.browser()
    const code = (await fixture.resetCodeFor(known, "ada@example.com"))!
    expect(await fixture.resetCodeFor(unknown, "nobody@example.com")).toBeNull()
    expect(fixture.sender.sent).toHaveLength(1)
    expect(await fixture.count("password_reset_requests")).toBe(2)
    expect(await fixture.count("auth_challenges")).toBe(2)

    for (const browser of [known, unknown]) {
      for (let guess = 0; guess < MAILED_CODE_MAX_GUESSES; guess++) {
        expect(
          await browser.call("POST", "/auth/password/reset/verify", { code: otherThan(code) }),
        ).toMatchObject(wrong)
      }
      expect(await browser.call("POST", "/auth/password/reset/verify", { code }))
        .toMatchObject(dead)
    }
  })
})
