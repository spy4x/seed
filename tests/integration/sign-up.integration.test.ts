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
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { SignUpOutcome } from "../../apps/api/services/sign-up.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { createOutboxProcessor } from "../../libs/server/jobs/wiring.ts"
import { SIGN_UP_MAX_GUESSES } from "../../libs/server/auth/sign-up-requests.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"
import { createAuthRoute } from "../../apps/api/routes/auth.ts"
import { SIGN_UP_CODES_TOO_MANY } from "../../apps/api/routes/auth-sign-up.ts"
import {
  createAuthRateLimits,
  SIGN_UP_CODE_MAILS_PER_ADDRESS,
  SIGN_UP_CODE_MAILS_PER_CLIENT,
} from "../../apps/api/middlewares/auth-rate-limits.ts"
import { fakeTotpFailures, generousLimits } from "../../apps/api/_testing/auth-routes.ts"
import { checkedError } from "../../apps/api/_testing/api-error.ts"
import {
  API_URL,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
} from "../../apps/api/_testing/mutation-requests.ts"

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
  return cookieJar(app, `http://local`)
}

/**
 * A client of `app` with its own cookie jar: sends back the cookies the answers set, on top of
 * `headers`, at `base` plus the path.
 */
function cookieJar(app: Hono<APIContext>, base: string, headers: Record<string, string> = {}) {
  const cookies = new Map<string, string>()
  return {
    cookies,
    async call(method: string, path: string, body?: unknown) {
      const sent = new Headers({ ...headers, "content-type": "application/json" })
      if (cookies.size) {
        sent.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "))
      }
      const response = await app.request(`${base}${path}`, {
        method,
        headers: sent,
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

/**
 * The app's `/auth` routes over the real sign-in and the real auth rate limits, in memory, as
 * `index.ts` mounts them, plus `/me` behind the session guard. The strict per-address limit is
 * generous, so the sign-up code budgets are the only limits a test reaches.
 */
function authApp(signIn: SignIn): Hono<APIContext> {
  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("requestId", uuidV7())
    await next()
  })
  app.use("*", signIn.auth.parseAuth)
  app.route(
    "/auth",
    createAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards: testMutationGuards,
      rateLimits: createAuthRateLimits(generousLimits),
      totpFailures: fakeTotpFailures([]),
      passwordFailures: fakeTotpFailures([]),
      emailCodeFailures: fakeTotpFailures([]),
      requestEmailCode: () => Promise.resolve(),
    }),
  )
  app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))
  return app
}

/** A browser on the network address `ip`, on the app's own page, calling {@link authApp}. */
function browserAt(app: Hono<APIContext>, ip: string) {
  return cookieJar(app, API_URL, { ...sameOriginWithoutCookieHeaders, "x-real-ip": ip })
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
    // The client named no group, so the server made the id of the first one.
    expectVersion7Ids(await fixture.sql<{ id: string }[]>`SELECT id FROM groups`)
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

Deno.test("an account with no group gets a Personal group with a version 7 id at its next sign-in", async () => {
  await withFixture(async (fixture) => {
    const userId = await existingAccount(fixture, "bob@example.com", true)
    const person = browser(fixture.signIn)

    await person.call("POST", "/sign-in", { login: "bob@example.com", password: OLD_PASSWORD })
    expect((await person.call("GET", "/me")).status).toBe(200)

    const groups = await fixture.sql<{ id: string; name: string }[]>`
      SELECT id, name FROM groups WHERE owner_user_id = ${userId}
    `
    expect(groups.map((group) => group.name)).toEqual(["Personal"])
    expectVersion7Ids(groups)
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

// The address's sign-up total (#321): strangers on other networks can spend the address's
// `SIGN_UP_CODE_MAILS_PER_ADDRESS` codes an hour, but each sign-up is its own row named by its
// browser's cookie, so the code its owner already holds keeps working.

const OWNER_IP = "198.51.100.7"

/**
 * Strangers on networks of their own (`192.0.2.<n>`) ask for sign-ups of `email`, each until its
 * client's share is spent, until a stranger's first request is refused: the address's total is
 * spent then, not that client's share. Answers the browsers of the strangers who got a sign-up,
 * and the refused stranger's browser and answer.
 */
async function spendAddressTotal(app: Hono<APIContext>, email: string) {
  const strangers: ReturnType<typeof browserAt>[] = []
  for (let network = 1; network <= SIGN_UP_CODE_MAILS_PER_ADDRESS; network++) {
    const stranger = browserAt(app, `192.0.2.${network}`)
    for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
      const answer = await stranger.call("POST", "/auth/password/sign-up", {
        email,
        password: "Stranger-pass1",
      })
      if (answer.status === 429) {
        if (mail === 0) return { strangers, refused: stranger, refusal: answer }
        break
      }
      expect(answer.status).toBe(200)
      if (mail === 0) strangers.push(stranger)
    }
  }
  throw new Error(`the address's sign-up total was never spent`)
}

Deno.test("a sign-up code issued before the address's total is spent still verifies after it is spent", async () => {
  await withFixture(async (fixture) => {
    const app = authApp(fixture.signIn)
    const owner = browserAt(app, OWNER_IP)
    expect(
      (await owner.call("POST", "/auth/password/sign-up", {
        email: "ann@example.com",
        password: PASSWORD,
      })).status,
    ).toBe(200)
    const code = await fixture.codeFor("ann@example.com")

    const { strangers, refusal } = await spendAddressTotal(app, "ann@example.com")
    // The worker mails every stranger's code too, as it does in production.
    await fixture.codeFor("ann@example.com")

    // Four networks: three spend their whole share, which with the owner's code is the address's
    // total, and the fourth's first request finds it spent.
    expect(strangers).toHaveLength(3)
    expect(refusal.status).toBe(429)
    expect(checkedError(JSON.parse(refusal.text)).message).toBe(SIGN_UP_CODES_TOO_MANY)
    const verified = await owner.call("POST", "/auth/password/sign-up/verify", { code })
    expect(verified.status).toBe(200)
    const [key] = await fixture.sql<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM auth_keys WHERE subject = 'ann@example.com'
    `
    expect(JSON.parse(verified.text).id).toBe(key.userId)
    expect((await owner.call("GET", "/me")).status).toBe(200)
    expect(await fixture.count("auth_users")).toBe(1)
  })
})

Deno.test("four clients spending the address's total and guessing leave the owner's earlier code the one that works", async () => {
  await withFixture(async (fixture) => {
    const app = authApp(fixture.signIn)
    const owner = browserAt(app, OWNER_IP)
    await owner.call("POST", "/auth/password/sign-up", {
      email: "ann@example.com",
      password: PASSWORD,
    })
    const code = await fixture.codeFor("ann@example.com")

    const { strangers, refused, refusal } = await spendAddressTotal(app, "ann@example.com")
    await fixture.codeFor("ann@example.com")
    const guesses = []
    for (const stranger of strangers) {
      // A wrong code, and the owner's own: neither works on a stranger's sign-up.
      for (const guess of ["wrong-00", code]) {
        guesses.push(
          (await stranger.call("POST", "/auth/password/sign-up/verify", { code: guess })).status,
        )
      }
    }

    // The refused stranger has no sign-up to guess at.
    const refusedGuess = await refused.call("POST", "/auth/password/sign-up/verify", { code })

    expect(refusal.status).toBe(429)
    expect(strangers).toHaveLength(3)
    expect(guesses).toEqual(Array(strangers.length * 2).fill(400))
    expect(refusedGuess.status).toBe(410)
    expect(await fixture.count("auth_users")).toBe(0)
    const verified = await owner.call("POST", "/auth/password/sign-up/verify", { code })
    expect(verified.status).toBe(200)
    expect((await owner.call("GET", "/me")).status).toBe(200)
    const [key] = await fixture.sql<{ provenAt: Date | null }[]>`
      SELECT proven_at AS "provenAt" FROM auth_keys WHERE subject = 'ann@example.com'
    `
    expect(key.provenAt).not.toBe(null)
    // The account signs in with the owner's password, not a stranger's.
    expect(JSON.parse(
      (await browser(fixture.signIn).call("POST", "/sign-in", {
        login: "ann@example.com",
        password: PASSWORD,
      })).text,
    )).toEqual({ ok: true })
  })
})
