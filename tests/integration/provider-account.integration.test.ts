/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import * as OTPAuth from "@hectorm/otpauth"
import {
  AuthAuditEventType,
  type EmailStatus,
  PROVIDER_PROOF_MINUTES,
  type SignInMethodsResponse,
} from "@domain/identity"
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT } from "@spy4x/server/auth/oauth-google"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { enabledOAuthProviders } from "../../apps/api/services/oauth-providers.ts"
import { createTotpFailures } from "../../apps/api/services/totp-failures.ts"
import { createEmailCodeFailures } from "../../apps/api/services/email-code-failures.ts"
import { createPasswordFailures } from "../../apps/api/services/password-failures.ts"
import { createOAuthRoute, METHOD_IS_LAST } from "../../apps/api/routes/auth-oauth.ts"
import {
  createAuthRoute,
  EMAIL_ALREADY_CARRIED,
  PASSWORD_ALREADY_SET,
  PASSWORD_SET_CODE_REQUIRED,
  PROVIDER_PROOF_REQUIRED,
} from "../../apps/api/routes/auth.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import { createAuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { sendEmailCode } from "../../libs/server/auth/email-verification.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { checkedError } from "../../apps/api/_testing/api-error.ts"

/**
 * What an account made with Google can do without a password (#384): delete itself, set a first
 * password and change its address, each confirmed by a sign-in with the provider a moment ago.
 * The real routes and sign-in run against a real Postgres; the provider is a fake `fetch` that
 * answers from a table, and any other request fails the test.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const NEW_PASSWORD = "Passw0rd!"
const ORIGIN = "https://app.example.test"

/** Makes every session look started longer ago than a provider sign-in confirms anything. */
async function outliveTheProof(sql: postgres.Sql): Promise<void> {
  const minutes = PROVIDER_PROOF_MINUTES + 1
  await sql`UPDATE auth_sessions SET created_at = created_at - make_interval(mins => ${minutes})`
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `provider_account_test_${uuidV7().replaceAll("-", "")}`
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

/** A person as Google knows them. The authorization `code` of the fake names one. */
interface ProviderPerson {
  sub: string
  email: string
}

/** Answers Google's token and profile requests from `people`, keyed by code. */
function fakeGoogle(people: Record<string, ProviderPerson>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  return async (request: Request): Promise<Response> => {
    const url = request.url.split("?")[0]
    if (url === GOOGLE_TOKEN_ENDPOINT) {
      const code = new URLSearchParams(await request.text()).get("code") ?? ""
      return people[code]
        ? json({ access_token: code, token_type: "bearer" })
        : json({ error: "invalid_grant" }, 400)
    }
    const person = people[(request.headers.get("authorization") ?? "").replace(/^Bearer /, "")]
    if (person && url === GOOGLE_USERINFO_ENDPOINT) {
      return json({ sub: person.sub, email: person.email, email_verified: true })
    }
    throw new Error(`the test reached for the network: ${request.url}`)
  }
}

/** A new in-process store each call, standing in for one limiter's share of Valkey. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

const pass = (_c: unknown, next: () => Promise<void>) => next()

/**
 * The real account and provider routes over `sql`, with the fake Google. A code mail is not sent:
 * `codes` keeps the last code per address.
 */
function buildApp(sql: postgres.Sql, people: Record<string, ProviderPerson>) {
  const codes = new Map<string, string>()
  const db = new AppDbBase({ sql })
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
    oauth: {
      providers: enabledOAuthProviders({
        google: { clientId: "test-client-id", clientSecret: "test-client-secret" },
      }),
      origin: ORIGIN,
      fetch: fakeGoogle(people),
    },
  })
  const mutationGuards = createMutationGuards(ORIGIN)
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.route(
    "/auth",
    createOAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards,
      rateLimits: { strictByIp: pass, strictByUser: pass, normal: pass },
      origin: ORIGIN,
      logError: () => {},
    }),
  )
  app.route(
    "/auth",
    createAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards,
      rateLimits: createAuthRateLimits({
        windowMs: 60_000,
        strictLimit: 1_000,
        limit: 1_000,
        otpWindowMs: 900_000,
        otpLimit: 1_000,
        store: memoryStore,
        onStoreError: () => {},
      }),
      totpFailures: createTotpFailures({ sql }),
      passwordFailures: createPasswordFailures({ sql }),
      emailCodeFailures: createEmailCodeFailures({ sql }),
      requestPasswordReset: () => Promise.resolve(),
      requestSignInLink: () => Promise.resolve(),
      requestEmailCode: (userId, email) =>
        sendEmailCode(
          db.authStore,
          userId,
          email,
          (to, code) => Promise.resolve(void codes.set(to, code)),
        ),
    }),
  )
  return { app, db, sql, codes }
}

type App = ReturnType<typeof buildApp>

/** A browser: it keeps the cookies the app sets and sends them back. */
function browser({ app }: App) {
  const cookies = new Map<string, string>()
  const send = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const response = await app.request(`http://local${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
        "x-real-ip": "203.0.113.42",
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attributes] = line.split(";")
      const name = pair.slice(0, pair.indexOf("="))
      const value = pair.slice(pair.indexOf("=") + 1)
      const gone = value === "" || attributes.some((entry) => /^\s*max-age=0$/i.test(entry))
      if (gone) cookies.delete(name)
      else cookies.set(name, value)
    }
    return response
  }
  return {
    get: (path: string) => send("GET", path),
    post: (path: string, body: unknown = {}) => send("POST", path, body),
    delete: (path: string, body: unknown = {}) => send("DELETE", path, body),
    /** Goes to Google and comes back as the person `code` names; returns where it lands. */
    async throughGoogle(code: string): Promise<string> {
      const at = (await send("GET", "/auth/google/start")).headers.get("location")
      if (!at) throw new Error("the Google flow did not start")
      const state = new URL(at).searchParams.get("state")
      const back = await send("GET", `/auth/google/callback?code=${code}&state=${state}`)
      expect(back.status).toBe(302)
      return (back.headers.get("location") ?? "").replace(ORIGIN, "")
    },
  }
}

type Browser = ReturnType<typeof browser>

const ADA: ProviderPerson = { sub: "1001", email: "ada@example.com" }

/** The authenticator code of `secret` (base32) at `timestamp`. */
function totpCode(secret: string, timestamp: number): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate({ timestamp })
}

/** An account made with Google and no password, signed in on the browser returned with its id. */
async function googleAccount(app: App): Promise<{ ada: Browser; userId: number }> {
  const ada = browser(app)
  expect(await ada.throughGoogle("ada")).toBe("/sign-up/confirm")
  const confirmed = await ada.post("/auth/sign-up/confirm")
  expect(confirmed.status).toBe(201)
  return { ada, userId: (await confirmed.json()).id }
}

async function methodsOf(visitor: Browser): Promise<SignInMethodsResponse> {
  const response = await visitor.get("/auth/methods")
  expect(response.status).toBe(200)
  return await response.json()
}

async function emailOf(visitor: Browser): Promise<EmailStatus> {
  const response = await visitor.get("/auth/email")
  expect(response.status).toBe(200)
  return await response.json()
}

/** The body of a refusal, after checking its status. */
async function refusal(response: Response, status = 400): Promise<string> {
  expect(response.status).toBe(status)
  return checkedError(await response.json()).message
}

Deno.test("an account made with Google deletes itself after a Google sign-in a moment ago", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)

    const deleted = await ada.post("/auth/account/delete", {})

    expect(deleted.status).toBe(200)
    expect(typeof (await deleted.json()).deleteAfter).toBe("string")
    expect((await ada.get("/auth/methods")).status).toBe(401)
    const [profile] = await sql`SELECT deleted_at FROM users WHERE id = ${userId}`
    expect(profile.deletedAt).not.toBe(null)
  })
})

Deno.test("a Google sign-in from longer ago does not delete the account until it is repeated", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    expect((await methodsOf(ada)).providerProofUntil).not.toBe(null)
    await outliveTheProof(sql)

    expect((await methodsOf(ada)).providerProofUntil).toBe(null)
    expect(await refusal(await ada.post("/auth/account/delete", {}))).toBe(PROVIDER_PROOF_REQUIRED)
    const [profile] = await sql`SELECT deleted_at FROM users WHERE id = ${userId}`
    expect(profile.deletedAt).toBe(null)

    // Signing in with Google again is the proof.
    expect(await ada.throughGoogle("ada")).toBe("/")
    expect((await ada.post("/auth/account/delete", {})).status).toBe(200)
  })
})

Deno.test("an account made with Google sets a first password and then has two ways in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    expect((await methodsOf(ada)).methods.map((method) => [method.kind, method.canUnlink]))
      .toEqual([["google", false]])

    const set = await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })

    expect(set.status).toBe(200)
    const { methods } = await methodsOf(ada)
    // Google can be unlinked now: the password is the other way in.
    expect(methods.map((method) => [method.kind, method.email, method.canUnlink]).sort()).toEqual([
      ["google", "ada@example.com", true],
      ["password", "ada@example.com", false],
    ])
    const [linked] = await sql`
      SELECT identifier FROM auth_audits
      WHERE user_id = ${userId} AND event_type = ${AuthAuditEventType.SIGN_IN_METHOD_LINKED}`
    expect(linked.identifier).toBe(PASSWORD_METHOD)
    // The password signs in on another device, with the address Google vouched for.
    const phone = browser(app)
    const signedIn = await phone.post("/auth/password/check", {
      login: "ada@example.com",
      password: NEW_PASSWORD,
    })
    expect(signedIn.status).toBe(200)
    expect((await signedIn.json()).id).toBe(userId)
    // A second password is a change, which asks for the first one.
    expect(await refusal(await ada.post("/auth/password/set", { newPassword: "An0ther-one!" })))
      .toBe(PASSWORD_ALREADY_SET)
  })
})

Deno.test("a Google sign-in from longer ago sets no password", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    await outliveTheProof(sql)

    expect(await refusal(await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })))
      .toBe(PROVIDER_PROOF_REQUIRED)

    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["google"])
    const refused = await browser(app).post("/auth/password/check", {
      login: "ada@example.com",
      password: NEW_PASSWORD,
    })
    expect(refused.status).toBe(401)
  })
})

Deno.test("an account made with Google moves to a new address once its code is entered", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    expect(await emailOf(ada)).toEqual({ email: "ada@example.com", proven: true, pending: null })

    const asked = await ada.post("/auth/email/change", { email: "ada@new.example" })

    expect(asked.status).toBe(200)
    // Nothing moves until the new address is proven.
    expect(await emailOf(ada)).toEqual({
      email: "ada@example.com",
      proven: true,
      pending: "ada@new.example",
    })
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@new.example"),
    })
    expect(verified.status).toBe(200)
    expect(await emailOf(ada)).toEqual({ email: "ada@new.example", proven: true, pending: null })
    // Still signed in, and Google still opens the same account.
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["google"])

    // A second move frees the first new address: the account has one address.
    expect((await ada.post("/auth/email/change", { email: "ada@third.example" })).status).toBe(200)
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@third.example") })
    expect(await emailOf(ada)).toEqual({ email: "ada@third.example", proven: true, pending: null })
    const [{ held }] = await sql`
      SELECT count(*)::int AS held FROM auth_keys WHERE email = 'ada@new.example'`
    expect(held).toBe(0)
  })
})

Deno.test("an account made with Google unlinks it once another method holds a proven address, which a sign-in link then reaches", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    expect((await ada.post("/auth/email/change", { email: "ada@new.example" })).status).toBe(200)
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@new.example") })
    const [google] = (await methodsOf(ada)).methods
    expect([google.kind, google.canUnlink]).toEqual(["google", true])

    const unlinked = await ada.delete(`/auth/methods/${google.id}`, {})

    expect(unlinked.status).toBe(200)
    expect(await unlinked.json()).toEqual({ signedOut: true })
    // A sign-in link finds its account by the proven address: it is still this one.
    expect(await app.db.authStore.findUserIdByProvenEmail("ada@new.example")).toBe(userId)
  })
})

Deno.test("an account made with Google cannot unlink it while Google alone holds its proven address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    // A new address waiting for its code is no way in yet.
    expect((await ada.post("/auth/email/change", { email: "ada@new.example" })).status).toBe(200)
    const [google] = (await methodsOf(ada)).methods
    expect([google.kind, google.canUnlink]).toEqual(["google", false])

    const unlinked = await ada.delete(`/auth/methods/${google.id}`, {})

    expect(await refusal(unlinked, 409)).toBe(METHOD_IS_LAST)
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["google"])
  })
})

Deno.test("a first password after an address change signs in with the new address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    await ada.post("/auth/email/change", { email: "ada@new.example" })
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@new.example") })

    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)

    const phone = browser(app)
    const signedIn = await phone.post("/auth/password/check", {
      login: "ada@new.example",
      password: NEW_PASSWORD,
    })
    expect(signedIn.status).toBe(200)
    expect((await signedIn.json()).id).toBe(userId)
    expect(await emailOf(ada)).toEqual({ email: "ada@new.example", proven: true, pending: null })
  })
})

Deno.test("a Google sign-in from longer ago changes no address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    await outliveTheProof(sql)

    expect(await refusal(await ada.post("/auth/email/change", { email: "ada@new.example" })))
      .toBe(PROVIDER_PROOF_REQUIRED)

    expect(await emailOf(ada)).toEqual({ email: "ada@example.com", proven: true, pending: null })
    expect(app.codes.size).toBe(0)
  })
})

Deno.test("an address the account left opens it no more, also after a first password in between", async () => {
  await withSchema(async (sql) => {
    // Whoever has the middle address later, with a Google account that vouches for it.
    const app = buildApp(sql, { ada: ADA, later: { sub: "3003", email: "ada@new.example" } })
    const { ada, userId } = await googleAccount(app)
    await ada.post("/auth/email/change", { email: "ada@new.example" })
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@new.example") })
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)

    const asked = await ada.post("/auth/email/change", {
      email: "ada@third.example",
      password: NEW_PASSWORD,
    })
    expect(asked.status).toBe(200)
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@third.example"),
    })
    expect(verified.status).toBe(200)

    const keys = await sql`
      SELECT method, email FROM auth_keys WHERE user_id = ${userId} ORDER BY method`
    // The Google key lost the first address at the first move (#403).
    expect(keys.map((key) => [key.method, key.email])).toEqual([
      ["oauth:google", null],
      [PASSWORD_METHOD, "ada@third.example"],
    ])
    // The stranger is asked whether to create an account: Ada's is not theirs.
    const stranger = browser(app)
    expect(await stranger.throughGoogle("later")).toBe("/sign-up/confirm")
    expect((await stranger.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("a first password takes the address off the code key that held it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    await ada.post("/auth/email/change", { email: "ada@new.example" })
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@new.example") })

    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)

    const keys = await sql`
      SELECT method, email FROM auth_keys WHERE user_id = ${userId} ORDER BY method`
    // The Google key gave up the old address at the move (#403).
    expect(keys.map((key) => [key.method, key.email])).toEqual([
      ["oauth:google", null],
      [PASSWORD_METHOD, "ada@new.example"],
    ])
  })
})

Deno.test("a Google sign-in from longer ago links no provider, so it cannot make itself recent", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA, mallory: { sub: "6006", email: "mallory@example.com" } })
    const { ada, userId } = await googleAccount(app)
    await outliveTheProof(sql)

    const link = await ada.post("/auth/methods/google/link")

    expect(await refusal(link)).toBe(PROVIDER_PROOF_REQUIRED)
    // No flow started, so no second Google account lands in Ada's and signs in fresh.
    const intruder = browser(app)
    expect(await intruder.throughGoogle("mallory")).toBe("/sign-up/confirm")
    const [{ keys }] = await sql`
      SELECT count(*)::int AS keys FROM auth_keys WHERE user_id = ${userId}`
    expect(keys).toBe(1)
    expect(await refusal(await ada.post("/auth/account/delete", {}))).toBe(PROVIDER_PROOF_REQUIRED)
    expect(await refusal(await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })))
      .toBe(PROVIDER_PROOF_REQUIRED)
    expect(await refusal(await ada.post("/auth/email/change", { email: "ada@new.example" })))
      .toBe(PROVIDER_PROOF_REQUIRED)
  })
})

Deno.test("a Google sign-in a moment ago starts the link of another provider account", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)

    const link = await ada.post("/auth/methods/google/link")

    expect(link.status).toBe(200)
    expect(typeof (await link.json()).url).toBe("string")
  })
})

Deno.test("an account with a password links a provider only with that password", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)

    // The Google sign-in of a moment ago stands in for no password that exists.
    expect(await refusal(await ada.post("/auth/methods/google/link"))).toBe("Invalid password")
    expect(await refusal(await ada.post("/auth/methods/google/link", { password: "Wr0ng-one!" })))
      .toBe("Invalid password")
    expect((await ada.post("/auth/methods/google/link", { password: NEW_PASSWORD })).status)
      .toBe(200)
  })
})

Deno.test("a link and an unlink wait out the lock the account's wrong passwords set (#406)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)
    for (let guess = 0; guess < 6; guess++) {
      const wrong = await ada.post("/auth/totp/disconnect", { password: "Wr0ng-one!" })
      expect(wrong.status).toBe(400)
      await wrong.body?.cancel()
    }

    const link = await ada.post("/auth/methods/google/link", { password: NEW_PASSWORD })
    expect(link.headers.get("retry-after")).toBe("60")
    expect(await refusal(link, 429)).toBe("Too many wrong passwords. Try again in 1 minute.")
    const google = (await methodsOf(ada)).methods.find((method) => method.kind === "google")!
    const unlink = await ada.delete(`/auth/methods/${google.id}`, { password: NEW_PASSWORD })
    expect(await refusal(unlink, 429)).toBe("Too many wrong passwords. Try again in 1 minute.")
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toContain("google")
  })
})

Deno.test("a first password waits for the authenticator code while two-factor is on", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    const { secret } = await (await ada.post("/auth/totp/connect/start")).json()
    const now = Date.now()
    const finished = await ada.post("/auth/totp/connect/finish", { otp: totpCode(secret, now) })
    expect(finished.status).toBe(200)

    expect(await refusal(await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })))
      .toBe(PASSWORD_SET_CODE_REQUIRED)
    const wrong = await ada.post("/auth/password/set", {
      newPassword: NEW_PASSWORD,
      otp: totpCode(secret, now + 10 * 60_000),
    })
    expect(await refusal(wrong)).toBe("Code is incorrect")
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["google"])
    // So the password that could turn two-factor off does not exist yet.
    expect((await ada.post("/auth/totp/disconnect", { password: NEW_PASSWORD })).status).toBe(400)

    // The next code: the one that turned two-factor on is spent.
    const set = await ada.post("/auth/password/set", {
      newPassword: NEW_PASSWORD,
      otp: totpCode(secret, now + 30_000),
    })
    expect(set.status).toBe(200)
    expect((await methodsOf(ada)).methods.map((method) => method.kind).sort())
      .toEqual(["google", "password"])
  })
})

Deno.test("a session a password started confirms nothing in a provider's place", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)
    const phone = browser(app)
    const signedIn = await phone.post("/auth/password/check", {
      login: "ada@example.com",
      password: NEW_PASSWORD,
    })
    expect(signedIn.status).toBe(200)

    expect((await methodsOf(phone)).providerProofUntil).toBe(null)
    expect((await methodsOf(ada)).providerProofUntil).not.toBe(null)
  })
})

/** Another device of the account the fake Google person `code` names, signed in with Google there. */
async function secondDevice(app: App, code: string): Promise<Browser> {
  const laptop = browser(app)
  expect(await laptop.throughGoogle(code)).toBe("/")
  expect((await laptop.get("/auth/methods")).status).toBe(200)
  return laptop
}

Deno.test("an account without a password turns two-factor on only after a Google sign-in a moment ago (#406)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    await outliveTheProof(sql)

    expect(await refusal(await ada.post("/auth/totp/connect/start"))).toBe(PROVIDER_PROOF_REQUIRED)
    const [enrolment] = await sql`SELECT 1 FROM user_totp WHERE user_id = ${userId}`
    expect(enrolment).toBe(undefined)

    // Signing in with Google again is the proof.
    expect(await ada.throughGoogle("ada")).toBe("/")
    const started = await ada.post("/auth/totp/connect/start")
    expect(started.status).toBe(200)
    expect(typeof (await started.json()).secret).toBe("string")
  })
})

Deno.test("a new address signs the other devices of an account without a password out (#406)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    const laptop = await secondDevice(app, "ada")

    await ada.post("/auth/email/change", { email: "ada@new.example" })
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@new.example"),
    })

    expect(verified.status).toBe(200)
    expect((await laptop.get("/auth/methods")).status).toBe(401)
    expect((await ada.get("/auth/methods")).status).toBe(200)
  })
})

Deno.test("a first password signs the other devices out, and keeps this one (#406)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    const laptop = await secondDevice(app, "ada")

    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)

    expect((await laptop.get("/auth/methods")).status).toBe(401)
    expect((await ada.get("/auth/methods")).status).toBe(200)
  })
})

Deno.test("a new address signs the other devices of an account with a password out, the Google ones too (#406)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada } = await googleAccount(app)
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)
    // Both signed in after the password was set: one with Google, one with the password.
    const laptop = await secondDevice(app, "ada")
    const phone = browser(app)
    const signedIn = await phone.post("/auth/password/check", {
      login: "ada@example.com",
      password: NEW_PASSWORD,
    })
    expect(signedIn.status).toBe(200)

    const asked = await ada.post("/auth/email/change", {
      email: "ada@new.example",
      password: NEW_PASSWORD,
    })
    expect(asked.status).toBe(200)
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@new.example"),
    })

    expect(verified.status).toBe(200)
    expect((await laptop.get("/auth/methods")).status).toBe(401)
    expect((await phone.get("/auth/methods")).status).toBe(401)
    expect((await ada.get("/auth/methods")).status).toBe(200)
    expect(await emailOf(ada)).toEqual({ email: "ada@new.example", proven: true, pending: null })
  })
})

Deno.test("an account without a password cannot move to an address another of its methods carries (#406)", async () => {
  await withSchema(async (sql) => {
    const other: ProviderPerson = { sub: "1002", email: "ada@other.example" }
    const app = buildApp(sql, { ada: ADA, other })
    const { ada } = await googleAccount(app)
    // A second Google account, linked: it carries another address.
    const link = await ada.post("/auth/methods/google/link")
    const state = new URL((await link.json()).url).searchParams.get("state")
    expect((await ada.get(`/auth/google/callback?code=other&state=${state}`)).status).toBe(302)
    expect((await methodsOf(ada)).methods.map((method) => method.email).sort())
      .toEqual(["ada@example.com", "ada@other.example"])

    expect(await refusal(await ada.post("/auth/email/change", { email: "ada@other.example" })))
      .toBe(EMAIL_ALREADY_CARRIED)

    expect(await emailOf(ada)).toEqual({ email: "ada@example.com", proven: true, pending: null })
    expect(app.codes.size).toBe(0)
  })
})

/** The provider keys of the user, as `[method, subject, email]`. */
async function providerKeysOf(sql: postgres.Sql, userId: number): Promise<unknown[][]> {
  const keys = await sql`
    SELECT method, subject, email FROM auth_keys
    WHERE user_id = ${userId} AND method LIKE 'oauth:%' ORDER BY id`
  return keys.map((key) => [key.method, key.subject, key.email])
}

// Whoever holds Ada's old mailbox next, with a Google identity of their own that vouches for it.
const NEXT_HOLDER: ProviderPerson = { sub: "9009", email: "ada@example.com" }

Deno.test("after a move, another Google identity for the old address is not signed into the account (#403)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA, next: NEXT_HOLDER })
    const { ada, userId } = await googleAccount(app)
    await ada.post("/auth/email/change", { email: "ada@new.example" })
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@new.example"),
    })
    expect(verified.status).toBe(200)

    const stranger = browser(app)
    // Asked whether to create an account, as for any address nobody owns.
    expect(await stranger.throughGoogle("next")).toBe("/sign-up/confirm")
    expect((await stranger.get("/auth/me")).status).toBe(401)
    expect(await providerKeysOf(sql, userId)).toEqual([["oauth:google", "1001", null]])
  })
})

Deno.test("after a move, the Google identity linked before it still signs in to the account (#403)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const { ada, userId } = await googleAccount(app)
    await ada.post("/auth/email/change", { email: "ada@new.example" })
    await ada.post("/auth/email/verify", { code: app.codes.get("ada@new.example") })

    const laptop = browser(app)
    expect(await laptop.throughGoogle("ada")).toBe("/")
    expect(await emailOf(laptop)).toEqual({ email: "ada@new.example", proven: true, pending: null })
    const me = await laptop.get("/auth/me")
    expect(me.status).toBe(200)
    expect((await me.json()).id).toBe(userId)
  })
})

Deno.test("after a password account moves, another Google identity for the old address is not signed in, and the linked one is (#403)", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA, next: NEXT_HOLDER })
    const { ada, userId } = await googleAccount(app)
    expect((await ada.post("/auth/password/set", { newPassword: NEW_PASSWORD })).status).toBe(200)
    await ada.post("/auth/email/change", { email: "ada@new.example", password: NEW_PASSWORD })
    const verified = await ada.post("/auth/email/verify", {
      code: app.codes.get("ada@new.example"),
    })
    expect(verified.status).toBe(200)

    const stranger = browser(app)
    expect(await stranger.throughGoogle("next")).toBe("/sign-up/confirm")
    expect((await stranger.get("/auth/me")).status).toBe(401)

    const laptop = browser(app)
    expect(await laptop.throughGoogle("ada")).toBe("/")
    expect((await (await laptop.get("/auth/me")).json()).id).toBe(userId)
    expect(await providerKeysOf(sql, userId)).toEqual([["oauth:google", "1001", null]])
  })
})
