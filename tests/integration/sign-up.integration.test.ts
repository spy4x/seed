/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import type { AuthStore } from "@spy4x/server/auth"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createPasswordHasher, type PasswordHasher } from "@spy4x/server/sign-in"
import type { EmailSender } from "@spy4x/email/sender"
import type { EmailMessage } from "@spy4x/email/message"
import { AuthAuditEventType } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn, SignUpOutcome } from "../../apps/api/services/sign-in.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createOutboxProcessor } from "../../libs/server/jobs/wiring.ts"
import { SIGN_UP_MAX_GUESSES } from "../../libs/server/auth/sign-up-requests.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * Sign-up that proves the address first (#142), through the exact `createSignIn`, `AppDbBase` and
 * worker job the app runs, on a schema built from every migration. The request must do the same
 * work for every address and never ask whether an account uses it; only the right code may tell.
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const OLD_PASSWORD = "the-owner's-own-password"
const BRAND = { webAppUrl: "http://app.localhost" }

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1 })
  const schema = `sign_up_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** The store methods that tell whether an account uses an address, or list an account's keys. */
const LOOKUPS = new Set(["findKey", "findUserIdByProvenEmail", "listKeys", "findUser"])

/**
 * The app's database, whose auth store throws on any lookup of an account while `blind.on` is
 * set, so a sign-up request that asked whether an account uses its address fails loudly.
 */
class BlindDb extends AppDbBase {
  constructor(sql: postgres.Sql, readonly blind: { on: boolean }) {
    super({ sql })
  }

  override get authStore(): AuthStore {
    const store = super.authStore
    const blind = this.blind
    return new Proxy(store, {
      get(target, name, receiver) {
        const value = Reflect.get(target, name, receiver)
        if (typeof value !== "function") return value
        return (...args: unknown[]) => {
          if (blind.on && LOOKUPS.has(String(name))) {
            throw new Error(`the sign-up request looked up an account with ${String(name)}`)
          }
          return value.apply(target, args)
        }
      },
    })
  }
}

/** A hasher that counts its hashes. */
function countingHasher(): PasswordHasher & { hashes: number } {
  const real = createPasswordHasher({ pepper: PEPPER })
  const hasher = {
    hashes: 0,
    hash: (password: string) => (hasher.hashes++, real.hash(password)),
    verify: (password: string, stored: string) => real.verify(password, stored),
  }
  return hasher
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

/** A browser with its own cookie jar, over the sign-in's sign-up operations. */
function browser(signIn: SignIn) {
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/request", async (c) => {
    const { email, password } = await c.req.json()
    return c.json({ ok: await signIn.requestSignUp(c, email, password) })
  })
  app.post("/verify", async (c) => {
    const { code } = await c.req.json()
    const result = await signIn.completeSignUp(c, code)
    return c.json(
      result.outcome === SignUpOutcome.Created
        ? { outcome: result.outcome, userId: result.signedIn.user.id }
        : result.outcome === SignUpOutcome.AccountExists
        ? { outcome: result.outcome, account: result.account }
        : { outcome: result.outcome },
    )
  })
  app.post("/resend", async (c) => c.json({ ok: await signIn.resendSignUpCode(c) }))
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    return c.json({ ok: (await signIn.signIn(c, login, password)) !== null })
  })
  app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))

  const cookies = new Map<string, string>()
  return {
    cookies,
    async call(method: string, path: string, body?: unknown) {
      const headers = new Headers({ "content-type": "application/json" })
      if (cookies.size) {
        headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "))
      }
      const response = await app.request(`http://local${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const setCookies = response.headers.getSetCookie()
      for (const line of setCookies) {
        const [pair] = line.split(";")
        const name = pair.slice(0, pair.indexOf("="))
        const value = pair.slice(pair.indexOf("=") + 1)
        if (value === "") cookies.delete(name)
        else cookies.set(name, value)
      }
      return {
        status: response.status,
        text: await response.text(),
        cookieNames: setCookies.map((line) => line.slice(0, line.indexOf("="))).sort(),
      }
    },
  }
}

interface Fixture {
  sql: postgres.Sql
  blind: { on: boolean }
  hasher: PasswordHasher & { hashes: number }
  signIn: SignIn
  /** Runs the worker once and answers the code of the newest code mail to `email`. */
  codeFor(email: string): Promise<string>
  count(table: string): Promise<number>
}

async function withFixture(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  await withSchema(async (sql) => {
    const blind = { on: false }
    const hasher = countingHasher()
    const signIn = createSignIn({
      db: new BlindDb(sql, blind),
      pepper: PEPPER,
      cookieSecret: COOKIE_SECRET,
      secureCookie: false,
      sessionMinutes: 60,
      totpIssuer: "example.test",
      hasher,
    })
    const sender = recordingSender()
    const store = createPostgresAuthStore(sql)
    const processor = createOutboxProcessor(sql, { store, sender, brand: BRAND, log: () => {} })
    await body({
      sql,
      blind,
      hasher,
      signIn,
      async codeFor(email) {
        await processor.drainOnce()
        const mail = sender.sent.findLast((sent) => sent.to === email)
        if (!mail) throw new Error(`no code mail to ${email}`)
        return mail.text!.split("\n\n")[1].trim()
      },
      count: async (table) =>
        (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM ${sql(table)}`)[0]
          .count,
    })
  })
}

/** Creates an account that signs in with `email` and `OLD_PASSWORD`, proven or not. */
async function existingAccount(fixture: Fixture, email: string, proven: boolean): Promise<number> {
  const store = createPostgresAuthStore(fixture.sql)
  const { user } = await store.createUserWithKey({
    method: PASSWORD_METHOD,
    subject: email,
    email,
    secret: await createPasswordHasher({ pepper: PEPPER }).hash(OLD_PASSWORD),
    provenAt: proven ? new Date() : null,
  })
  await fixture.sql`
    INSERT INTO users (id, first_name, last_name, mfa, role) VALUES (${user.id}, '', '', 1, 1)
  `
  return user.id
}

Deno.test("a sign-up request does the same work for a free and a taken address", async () => {
  await withFixture(async (fixture) => {
    await existingAccount(fixture, "taken@example.com", true)
    const answers = []
    const work = []
    fixture.blind.on = true
    for (const email of ["free@example.com", "taken@example.com"]) {
      const before = {
        hashes: fixture.hasher.hashes,
        requests: await fixture.count("sign_up_requests"),
        mails: await fixture.count("sign_up_code_requests"),
      }
      const answer = await browser(fixture.signIn).call("POST", "/request", {
        email,
        password: PASSWORD,
      })
      answers.push({ status: answer.status, text: answer.text, cookieNames: answer.cookieNames })
      work.push({
        hashes: fixture.hasher.hashes - before.hashes,
        requests: await fixture.count("sign_up_requests") - before.requests,
        mails: await fixture.count("sign_up_code_requests") - before.mails,
      })
    }
    fixture.blind.on = false

    expect(answers[0]).toEqual({
      status: 200,
      text: JSON.stringify({ ok: true }),
      cookieNames: ["password_sign_up"],
    })
    expect(answers[1]).toEqual(answers[0])
    expect(work).toEqual([
      { hashes: 1, requests: 1, mails: 1 },
      { hashes: 1, requests: 1, mails: 1 },
    ])
    // Nothing of an account: no session, user, group or audit row for either request.
    expect(await fixture.count("auth_sessions")).toBe(0)
    expect(await fixture.count("auth_users")).toBe(1)
    expect(await fixture.count("groups")).toBe(0)
    expect(await fixture.count("auth_audits")).toBe(0)
  })
})

Deno.test("the right code for a free address creates the account, proven, and signs it in", async () => {
  await withFixture(async (fixture) => {
    const person = browser(fixture.signIn)
    await person.call("POST", "/request", { email: "ann@example.com", password: PASSWORD })

    const verified = await person.call("POST", "/verify", {
      code: await fixture.codeFor("ann@example.com"),
    })

    const answer = JSON.parse(verified.text)
    expect(answer.outcome).toBe(SignUpOutcome.Created)
    expect(verified.cookieNames).toContain("password_sign_up")
    expect(person.cookies.has("password_sign_up")).toBe(false)
    expect((await person.call("GET", "/me")).status).toBe(200)
    const [key] = await fixture.sql<{ provenAt: Date | null }[]>`
      SELECT proven_at AS "provenAt" FROM auth_keys WHERE subject = 'ann@example.com'
    `
    expect(key.provenAt).not.toBe(null)
    const [owner] = await fixture.sql<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM auth_email_owners WHERE email = 'ann@example.com'
    `
    expect(owner.userId).toBe(answer.userId)
    expect(await fixture.count("groups")).toBe(1)
    const audits = await fixture.sql<{ eventType: number }[]>`
      SELECT event_type AS "eventType" FROM auth_audits WHERE user_id = ${answer.userId}
    `
    expect(audits.map((row) => row.eventType)).toEqual([AuthAuditEventType.SIGNED_UP])
    expect(await fixture.count("sign_up_requests")).toBe(0)
    expect(JSON.parse(
      (await browser(fixture.signIn).call("POST", "/sign-in", {
        login: "ann@example.com",
        password: PASSWORD,
      })).text,
    )).toEqual({ ok: true })
  })
})

for (const proven of [true, false]) {
  Deno.test(`the right code for a taken address, ${proven ? "proven" : "never confirmed"}, creates nothing and says how the account signs in`, async () => {
    await withFixture(async (fixture) => {
      const owner = await existingAccount(fixture, "taken@example.com", proven)
      const person = browser(fixture.signIn)
      await person.call("POST", "/request", { email: "taken@example.com", password: PASSWORD })
      const code = await fixture.codeFor("taken@example.com")

      const verified = await person.call("POST", "/verify", { code })

      expect(JSON.parse(verified.text)).toEqual({
        outcome: SignUpOutcome.AccountExists,
        account: { userId: owner, password: true, providers: [] },
      })
      // No session: the only cookie the browser held, the sign-up's, is cleared.
      expect(person.cookies.size).toBe(0)
      expect((await person.call("GET", "/me")).status).toBe(401)
      expect(await fixture.count("auth_users")).toBe(1)
      expect(await fixture.count("groups")).toBe(0)
      expect(await fixture.count("auth_audits")).toBe(0)
      expect(await fixture.count("sign_up_requests")).toBe(0)
      // The sign-up is gone, so the same code is refused the second time.
      expect(JSON.parse((await person.call("POST", "/verify", { code })).text))
        .toEqual({ outcome: SignUpOutcome.Expired })
      // The owner keeps their password and their claim.
      expect(JSON.parse(
        (await browser(fixture.signIn).call("POST", "/sign-in", {
          login: "taken@example.com",
          password: OLD_PASSWORD,
        })).text,
      )).toEqual({ ok: true })
      const [key] = await fixture.sql<{ provenAt: Date | null }[]>`
        SELECT proven_at AS "provenAt" FROM auth_keys WHERE user_id = ${owner}
      `
      expect(key.provenAt === null).toBe(!proven)
    })
  })
}

Deno.test("a wrong code answers the same for a free and a taken address and spends one guess", async () => {
  await withFixture(async (fixture) => {
    await existingAccount(fixture, "taken@example.com", true)
    const answers = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const person = browser(fixture.signIn)
      await person.call("POST", "/request", { email, password: PASSWORD })
      await fixture.codeFor(email)
      answers.push((await person.call("POST", "/verify", { code: "wrong-00" })).text)
    }

    expect(answers).toEqual([
      JSON.stringify({ outcome: SignUpOutcome.WrongCode }),
      JSON.stringify({ outcome: SignUpOutcome.WrongCode }),
    ])
    const guesses = await fixture.sql<{ attempts: number }[]>`
      SELECT attempts FROM auth_challenges WHERE purpose = 'app.sign-up' ORDER BY subject
    `
    expect(guesses.map((row) => row.attempts)).toEqual([1, 1])
  })
})

Deno.test("an expired sign-up answers the same for a free and a taken address", async () => {
  await withFixture(async (fixture) => {
    await existingAccount(fixture, "taken@example.com", true)
    const answers = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const person = browser(fixture.signIn)
      await person.call("POST", "/request", { email, password: PASSWORD })
      const code = await fixture.codeFor(email)
      await fixture.sql`UPDATE sign_up_requests SET expires_at = now() - interval '1 second'`
      answers.push((await person.call("POST", "/verify", { code })).text)
    }

    expect(answers).toEqual([
      JSON.stringify({ outcome: SignUpOutcome.Expired }),
      JSON.stringify({ outcome: SignUpOutcome.Expired }),
    ])
    expect(await fixture.count("auth_users")).toBe(1)
  })
})

Deno.test("a sign-up guessed at too often ends, and a new code does not bring it back", async () => {
  await withFixture(async (fixture) => {
    const person = browser(fixture.signIn)
    await person.call("POST", "/request", { email: "ann@example.com", password: PASSWORD })
    await fixture.codeFor("ann@example.com")
    for (let guess = 0; guess < SIGN_UP_MAX_GUESSES; guess++) {
      await person.call("POST", "/verify", { code: "wrong-00" })
    }

    expect(JSON.parse((await person.call("POST", "/verify", { code: "wrong-00" })).text))
      .toEqual({ outcome: SignUpOutcome.Expired })
    expect(JSON.parse((await person.call("POST", "/resend")).text)).toEqual({ ok: false })
    expect(await fixture.count("sign_up_requests")).toBe(0)
  })
})

Deno.test("a new code works and the one it replaced does not", async () => {
  await withFixture(async (fixture) => {
    const person = browser(fixture.signIn)
    await person.call("POST", "/request", { email: "ann@example.com", password: PASSWORD })
    const first = await fixture.codeFor("ann@example.com")
    expect(JSON.parse((await person.call("POST", "/resend")).text)).toEqual({ ok: true })
    const second = await fixture.codeFor("ann@example.com")

    expect(JSON.parse((await person.call("POST", "/verify", { code: first })).text))
      .toEqual({ outcome: SignUpOutcome.WrongCode })
    expect(JSON.parse((await person.call("POST", "/verify", { code: second })).text).outcome)
      .toBe(SignUpOutcome.Created)
  })
})

Deno.test("of two sign-ups of one address, the second right code finds the account the first made", async () => {
  await withFixture(async (fixture) => {
    const first = browser(fixture.signIn)
    const second = browser(fixture.signIn)
    await first.call("POST", "/request", { email: "ann@example.com", password: PASSWORD })
    const firstCode = await fixture.codeFor("ann@example.com")
    await second.call("POST", "/request", { email: "ann@example.com", password: "Other-pass1" })
    const secondCode = await fixture.codeFor("ann@example.com")

    const created = JSON.parse((await first.call("POST", "/verify", { code: firstCode })).text)
    const exists = JSON.parse((await second.call("POST", "/verify", { code: secondCode })).text)

    expect(created.outcome).toBe(SignUpOutcome.Created)
    expect(exists).toEqual({
      outcome: SignUpOutcome.AccountExists,
      account: { userId: created.userId, password: true, providers: [] },
    })
    expect(await fixture.count("auth_users")).toBe(1)
  })
})
