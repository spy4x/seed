/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url"
import { type } from "arktype"
import { Hono, type MiddlewareHandler } from "hono"
import postgres from "postgres"
import {
  AuthAuditEventType,
  type PendingSignUp,
  PROVIDER_PROOF_MINUTES,
  type SignInMethodsResponse,
  UserMFAStatus,
} from "@domain/identity"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import type { OutboxEvent } from "@spy4x/server/outbox"
import {
  GITHUB_EMAILS_ENDPOINT,
  GITHUB_TOKEN_ENDPOINT,
  GITHUB_USER_ENDPOINT,
} from "@spy4x/server/auth/oauth-github"
import { GOOGLE_TOKEN_ENDPOINT, GOOGLE_USERINFO_ENDPOINT } from "@spy4x/server/auth/oauth-google"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { enabledOAuthProviders } from "../../apps/api/services/oauth-providers.ts"
import { createOAuthRoute, METHOD_IS_LAST } from "../../apps/api/routes/auth-oauth.ts"
import { PROVIDER_PROOF_REQUIRED } from "../../apps/api/routes/auth.ts"
import {
  SIGN_IN_METHOD_MAIL_JOB,
  signInMethodMailJob,
} from "../../libs/server/jobs/sign-in-method-mail.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { EMAIL_CODE_METHOD } from "@spy4x/server/auth/email-code"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { checkedError } from "../../apps/api/_testing/api-error.ts"

/**
 * Sign-in with Google and GitHub (#141) and the question before a provider signs anyone up (#142),
 * through the real routes and sign-in against a real Postgres. The provider is a fake `fetch`: it
 * answers the token and profile requests from a table, and any other request fails the test, so
 * nothing here reaches the network.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const ORIGIN = "https://app.example.test"

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `oauth_test_${uuidV7().replaceAll("-", "")}`
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

/** A person as a provider knows them. The authorization `code` of the fake names one. */
interface ProviderPerson {
  /** The provider's id of the account: Google's `sub`, GitHub's numeric `id`. */
  sub: string
  email?: string
  /** Whether the provider says the address is verified. */
  verified?: boolean
  /** The name on the provider account. */
  name?: string
  /** The provider's picture: Google's `picture`, GitHub's `avatar_url`. */
  picture?: string
}

/** Answers Google's and GitHub's token and profile requests from `people`, keyed by code. */
function fakeProviders(people: Record<string, ProviderPerson>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  /** The person the request's bearer token (the code it was traded for) names. */
  const personOf = (request: Request) =>
    people[(request.headers.get("authorization") ?? "").replace(/^Bearer /, "")]
  return async (request: Request): Promise<Response> => {
    const url = request.url.split("?")[0]
    if (url === GOOGLE_TOKEN_ENDPOINT || url === GITHUB_TOKEN_ENDPOINT) {
      const code = new URLSearchParams(await request.text()).get("code") ?? ""
      return people[code]
        ? json({ access_token: code, token_type: "bearer" })
        : json({ error: "invalid_grant" }, 400)
    }
    const person = personOf(request)
    if (!person) return json({ error: "unauthorized" }, 401)
    if (url === GOOGLE_USERINFO_ENDPOINT) {
      return json({
        sub: person.sub,
        email: person.email,
        email_verified: person.verified,
        name: person.name,
        picture: person.picture,
      })
    }
    if (url === GITHUB_USER_ENDPOINT) {
      return json({ id: Number(person.sub), name: person.name, avatar_url: person.picture })
    }
    if (url === GITHUB_EMAILS_ENDPOINT) {
      return json(
        person.email ? [{ email: person.email, primary: true, verified: person.verified }] : [],
      )
    }
    throw new Error(`the test reached for the network: ${request.url}`)
  }
}

const pass = (_c: unknown, next: () => Promise<void>) => next()

/** The real provider routes and sign-in over `sql`, with the fake providers and a clock to move. */
function buildApp(
  sql: postgres.Sql,
  people: Record<string, ProviderPerson>,
  on: ("google" | "github")[] = ["google", "github"],
  limits: Partial<Record<"strictByIp" | "normal", MiddlewareHandler<APIContext>>> = {},
) {
  let now = Date.now()
  /** The ids of the users whose sign-out was announced, and what was logged as an error. */
  const signedOut: number[] = []
  const logged: string[] = []
  const db = new AppDbBase({ sql })
  const credentials = { clientId: "test-client-id", clientSecret: "test-client-secret" }
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
    oauth: {
      providers: enabledOAuthProviders(Object.fromEntries(on.map((id) => [id, credentials]))),
      origin: ORIGIN,
      fetch: fakeProviders(people),
      clock: { now: () => now },
    },
  })
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.route(
    "/auth",
    createOAuthRoute({
      signIn,
      emit: (event) => void signedOut.push(event.data.userId),
      mutationGuards: createMutationGuards(ORIGIN),
      rateLimits: { strictByIp: pass, strictByUser: pass, normal: pass, ...limits },
      origin: ORIGIN,
      logError: (message) => void logged.push(message),
    }),
  )
  // "Try it now" (#224): a guest account signed in on the browser that asks.
  app.post("/guest", async (c) => {
    const started = await signIn.guests.start(c, c.get("auth"))
    return c.json({ userId: "signedIn" in started ? started.signedIn.user.id : null })
  })
  // The password sign-up and sign-in, for accounts that exist before a provider is used.
  app.post("/password/sign-up", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/password/sign-in", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signIn(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  return { app, db, sql, signIn, signedOut, logged, advance: (ms: number) => now += ms }
}

type App = ReturnType<typeof buildApp>

/** A browser: it keeps the cookies the app sets and sends them back. */
function browser({ app }: App) {
  const cookies = new Map<string, string>()
  const send = async (
    method: string,
    path: string,
    body?: unknown,
    from: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" },
  ): Promise<Response> => {
    const response = await app.request(`http://local${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...from,
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
    cookies,
    get: (path: string) => send("GET", path),
    post: (path: string, body: unknown = {}) => send("POST", path, body),
    /** An unlink sends its proof in the body: the password, or nothing for a provider sign-in. */
    delete: (path: string, body: unknown = {}) => send("DELETE", path, body),
    /** The request another site makes this browser send: its cookies, the other site's origin. */
    fromAnotherSite: (method: "POST" | "DELETE", path: string) =>
      send(method, path, {}, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
    /**
     * Goes to the provider and comes back as the person `code` names: follows `startUrl` (the
     * start route, or the address a link request answered) and returns the callback's answer.
     */
    async through(provider: "google" | "github", code: string, start?: string): Promise<Response> {
      const at = start ?? (await send("GET", `/auth/${provider}/start`)).headers.get("location")
      if (!at) throw new Error(`the ${provider} flow did not start`)
      const state = new URL(at).searchParams.get("state")
      return await send("GET", `/auth/${provider}/callback?code=${code}&state=${state}`)
    },
  }
}

/** Where a redirect goes, without the origin. */
function target(response: Response): string {
  expect(response.status).toBe(302)
  return (response.headers.get("location") ?? "").replace(ORIGIN, "")
}

/** How many accounts exist, in the auth tables and as profiles. */
async function accounts(sql: postgres.Sql): Promise<{ authUsers: number; profiles: number }> {
  const [row] = await sql`
    SELECT (SELECT count(*)::int FROM auth_users) AS auth_users,
           (SELECT count(*)::int FROM users) AS profiles`
  return { authUsers: row.authUsers, profiles: row.profiles }
}

/** The audit events of `userId`, oldest first, with what each names. */
async function audit(sql: postgres.Sql, userId: number): Promise<[AuthAuditEventType, string][]> {
  const rows = await sql`
    SELECT event_type, identifier FROM auth_audits WHERE user_id = ${userId} ORDER BY id`
  return rows.map((row) => [row.eventType, row.identifier])
}

/** A password account whose address is proven, signed in on `visitor`. Returns its user id. */
async function provenPasswordAccount(
  app: App,
  visitor: ReturnType<typeof browser>,
  email: string,
): Promise<number> {
  const response = await visitor.post("/password/sign-up", { email })
  expect(response.status).toBe(200)
  const { id } = await response.json()
  const [key] = await app.db.authStore.listKeys(id)
  await app.db.authStore.proveKey(key.id, new Date())
  return id
}

/** The sign-up that waits in this browser, as the question page reads it. */
async function pendingOf(visitor: ReturnType<typeof browser>): Promise<PendingSignUp | null> {
  const response = await visitor.get("/auth/sign-up/pending")
  expect(response.status).toBe(200)
  return (await response.json()).pending
}

async function methodsOf(visitor: ReturnType<typeof browser>): Promise<SignInMethodsResponse> {
  const response = await visitor.get("/auth/methods")
  expect(response.status).toBe(200)
  return await response.json()
}

/**
 * What the sign-up cookie of `visitor` says. Its holder can read it, although it is signed, and
 * can write it back saying something else under the signature it came with.
 */
function signUpCookieOf(visitor: ReturnType<typeof browser>) {
  const [body, signature] = decodeURIComponent(visitor.cookies.get("oauth_sign_up")!).split(".")
  const envelope = JSON.parse(new TextDecoder().decode(decodeBase64Url(body)))
  return {
    payload: envelope.payload as Record<string, unknown>,
    edited(payload: Record<string, unknown>): string {
      const changed = new TextEncoder().encode(JSON.stringify({ ...envelope, payload }))
      return `${encodeBase64Url(changed)}.${signature}`
    },
  }
}

const ADA: ProviderPerson = { sub: "1001", email: "ada@example.com", verified: true }

Deno.test("only a provider with credentials is listed and can be started", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA }, ["google"])
    const visitor = browser(app)

    expect(await (await visitor.get("/auth/providers")).json()).toEqual({ providers: ["google"] })
    // Both are pages a browser opens: the person lands on the sign-in page, not on JSON.
    expect(target(await visitor.get("/auth/github/start"))).toBe("/sign-in?oauth=failed")
    expect(target(await visitor.get("/auth/github/callback?code=ada&state=x")))
      .toBe("/sign-in?oauth=failed")
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    const started = await visitor.get("/auth/google/start")
    const provider = new URL(started.headers.get("location")!)
    expect(provider.origin).toBe("https://accounts.google.com")
    expect(provider.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/google/callback`)
  })
})

Deno.test("a first Google sign-in creates nothing until the person confirms the new account", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("google", "ada"))).toBe("/sign-up/confirm")
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    const pending = (await pendingOf(visitor))!
    expect(pending.provider).toBe("google")
    expect(pending.email).toBe("ada@example.com")
    // Not signed in yet.
    expect((await visitor.get("/auth/methods")).status).toBe(401)

    const confirmed = await visitor.post("/auth/sign-up/confirm")

    expect(confirmed.status).toBe(201)
    const user = await confirmed.json()
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect(await audit(sql, user.id)).toEqual([[
      AuthAuditEventType.SIGNED_UP,
      "ada@example.com",
    ]])
    const [{ groups }] = await sql`
      SELECT count(*)::int AS groups FROM group_members WHERE user_id = ${user.id}`
    expect(groups).toBe(1)
    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.current]))
      .toEqual([["google", true]])
    // The question is answered: nothing waits any more.
    expect(await pendingOf(visitor)).toBe(null)
  })
})

Deno.test("a returning person is matched by the provider's id, not by the address", async () => {
  await withSchema(async (sql) => {
    const people = { ada: { ...ADA } }
    const app = buildApp(sql, people)
    const first = browser(app)
    await first.through("google", "ada")
    const user = await (await first.post("/auth/sign-up/confirm")).json()
    // The person changes the address at the provider; the id stays.
    people.ada.email = "countess@example.com"

    const later = browser(app)
    expect(target(await later.through("google", "ada"))).toBe("/")

    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect((await methodsOf(later)).methods).toHaveLength(1)
    expect((await audit(sql, user.id)).at(-1)).toEqual([
      AuthAuditEventType.SIGNED_IN,
      "oauth:google",
    ])
  })
})

Deno.test("GitHub signs a person up with its verified primary address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("github", "ada"))).toBe("/sign-up/confirm")
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(201)

    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.email]))
      .toEqual([["github", "ada@example.com"]])
  })
})

Deno.test("the question shows the provider's name and picture, from Google and GitHub alike", async () => {
  await withSchema(async (sql) => {
    const face = { name: "Ada Lovelace", picture: "https://lh3.googleusercontent.com/a/ada=s96-c" }
    const app = buildApp(sql, {
      google: { ...ADA, ...face },
      github: {
        sub: "2002",
        email: "ada@example.com",
        verified: true,
        ...face,
        picture: "https://avatars.githubusercontent.com/u/2002?v=4",
      },
    })

    const viaGoogle = browser(app)
    await viaGoogle.through("google", "google")
    const viaGithub = browser(app)
    await viaGithub.through("github", "github")

    expect(await pendingOf(viaGoogle)).toMatchObject({
      name: "Ada Lovelace",
      avatarUrl: "https://lh3.googleusercontent.com/a/ada=s96-c",
    })
    expect(await pendingOf(viaGithub)).toMatchObject({
      name: "Ada Lovelace",
      avatarUrl: "https://avatars.githubusercontent.com/u/2002?v=4",
    })
  })
})

Deno.test("the question drops a picture from any other host, and shows none when there is none", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      elsewhere: { ...ADA, name: "Ada", picture: "https://tracker.example/pixel.png" },
      bare: { sub: "1002", email: "bare@example.com", verified: true },
    })

    const elsewhere = browser(app)
    await elsewhere.through("google", "elsewhere")
    const bare = browser(app)
    await bare.through("google", "bare")

    expect(await pendingOf(elsewhere)).toMatchObject({ name: "Ada", avatarUrl: null })
    expect(await pendingOf(bare)).toMatchObject({ name: null, avatarUrl: null })
  })
})

Deno.test("going back creates nothing and the question cannot be answered afterwards", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const held = new Map(visitor.cookies)

    expect((await visitor.post("/auth/sign-up/cancel")).status).toBe(200)

    expect(await pendingOf(visitor)).toBe(null)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(400)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })

    // Even a browser that kept the cookie: going back took the held sign-up away on the server.
    const keeper = browser(app)
    for (const [name, value] of held) keeper.cookies.set(name, value)
    expect((await keeper.post("/auth/sign-up/confirm")).status).toBe(400)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
  })
})

Deno.test("a question left unanswered for ten minutes can no longer be answered", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    app.advance(10 * 60_000 - 5000)
    expect(await pendingOf(visitor)).not.toBe(null)

    app.advance(6000)

    expect(await pendingOf(visitor)).toBe(null)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(400)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
  })
})

Deno.test("the question says when creating would lock an unconfirmed account with that address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      eve: { sub: "4004", email: "ada@example.com", verified: false },
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    // Someone signed up with the address and a password, and never confirmed the address.
    const first = browser(app)
    expect((await first.post("/password/sign-up", { email: "ada@example.com" })).status).toBe(200)

    const owner = browser(app)
    await owner.through("google", "ada")
    expect((await pendingOf(owner))!.unconfirmedAccount).toBe(true)

    // No other account uses Bob's address, and an address the provider does not vouch for takes
    // nothing away: neither is warned.
    const bob = browser(app)
    await bob.through("google", "bob")
    expect((await pendingOf(bob))!.unconfirmedAccount).toBe(false)
    const eve = browser(app)
    await eve.through("google", "eve")
    expect((await pendingOf(eve))!.unconfirmedAccount).toBe(false)

    // Going back keeps the first account as it was: its password still signs in.
    expect((await owner.post("/auth/sign-up/cancel")).status).toBe(200)
    expect((await browser(app).post("/password/sign-in", { email: "ada@example.com" })).status)
      .toBe(200)
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("creating the account records that an unconfirmed account lost its password", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const first = browser(app)
    const firstUser = await (await first.post("/password/sign-up", { email: "ada@example.com" }))
      .json()
    const before = await audit(sql, firstUser.id)
    const owner = browser(app)
    await owner.through("google", "ada")

    const confirmed = await owner.post("/auth/sign-up/confirm")

    expect(confirmed.status).toBe(201)
    const created = await confirmed.json()
    expect(created.id).not.toBe(firstUser.id)
    expect((await audit(sql, firstUser.id)).slice(before.length)).toEqual([[
      AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
      "oauth:google",
    ]])
    expect(await audit(sql, created.id)).toEqual([[
      AuthAuditEventType.SIGNED_UP,
      "ada@example.com",
    ]])
    // What the row is about: the first account is locked.
    expect(await app.db.authStore.listKeys(firstUser.id)).toHaveLength(0)
    expect((await first.get("/auth/methods")).status).toBe(401)
    expect((await browser(app).post("/password/sign-in", { email: "ada@example.com" })).status)
      .toBe(401)
  })
})

Deno.test("the record of a taken address follows what was written, not what the cookie says", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const first = await (await browser(app).post("/password/sign-up", { email: "ada@example.com" }))
      .json()
    const before = await audit(sql, first.id)
    const owner = browser(app)
    await owner.through("google", "ada")
    // A cookie under the API's own secret that says the provider does not vouch for the address,
    // while the sign-up the server keeps says it does. No browser can make one; it stands for any
    // way the two could come to disagree.
    const api = createSignedPayloadCodec({
      secret: COOKIE_SECRET,
      purpose: "oauth.sign-up",
      version: 1,
      schema: type("object"),
    })
    owner.cookies.set(
      "oauth_sign_up",
      await api.sign({ ...signUpCookieOf(owner).payload, verified: false }),
    )

    expect((await owner.post("/auth/sign-up/confirm")).status).toBe(201)

    // The write took the first account's password away, so the row is there.
    expect(await app.db.authStore.listKeys(first.id)).toHaveLength(0)
    expect((await audit(sql, first.id)).slice(before.length)).toEqual([[
      AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
      "oauth:google",
    ]])
  })
})

Deno.test("a sign-up the provider does not vouch for records no taken address, whatever the cookie says", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { eve: { sub: "4004", email: "bob@example.com", verified: false } })
    // Bob never confirmed his address, and the provider does not vouch for Eve's use of it.
    const bob = await (await browser(app).post("/password/sign-up", { email: "bob@example.com" }))
      .json()
    const before = await audit(sql, bob.id)
    const eve = browser(app)
    await eve.through("google", "eve")
    const kept = signUpCookieOf(eve).payload
    expect(kept.verified).toBe(false)
    // The same disagreement the other way round: the cookie says the provider vouched.
    const api = createSignedPayloadCodec({
      secret: COOKIE_SECRET,
      purpose: "oauth.sign-up",
      version: 1,
      schema: type("object"),
    })
    eve.cookies.set("oauth_sign_up", await api.sign({ ...kept, verified: true }))

    expect((await eve.post("/auth/sign-up/confirm")).status).toBe(201)

    expect(await audit(sql, bob.id)).toEqual(before)
    const [{ taken }] = await sql`
      SELECT count(*)::int AS taken FROM auth_audits
      WHERE event_type = ${AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN}`
    expect(taken).toBe(0)
    expect((await browser(app).post("/password/sign-in", { email: "bob@example.com" })).status)
      .toBe(200)
  })
})

Deno.test("a sign-up cookie changed by hand is no cookie: nothing is shown, created or taken", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    // Someone signed up with Ada's address and a password, and never confirmed the address.
    const first = await (await browser(app).post("/password/sign-up", { email: "ada@example.com" }))
      .json()
    const before = await audit(sql, first.id)
    // Written back as it was, the cookie is still the one the API signed.
    const honest = browser(app)
    await honest.through("google", "ada")
    const untouched = signUpCookieOf(honest)
    honest.cookies.set("oauth_sign_up", untouched.edited(untouched.payload))
    expect((await pendingOf(honest))!.unconfirmedAccount).toBe(true)

    const changes: Record<string, unknown>[] = [
      // Would keep the audit row from the account that loses its password.
      { verified: false },
      // Would ask the question page about somebody else's address.
      { email: "bob@example.com" },
      // Would make "go back" take another entry out of the flow store.
      { held: "sign-up:oauth:google:somebody-elses" },
    ]
    for (const change of changes) {
      const owner = browser(app)
      await owner.through("google", "ada")
      const cookie = signUpCookieOf(owner)
      owner.cookies.set("oauth_sign_up", cookie.edited({ ...cookie.payload, ...change }))

      expect(await pendingOf(owner), JSON.stringify(change)).toBe(null)
      expect((await owner.post("/auth/sign-up/confirm")).status, JSON.stringify(change)).toBe(400)
    }

    // Nobody was created, and the first account keeps its password and gained no audit row.
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect(await audit(sql, first.id)).toEqual(before)
    expect((await browser(app).post("/password/sign-in", { email: "ada@example.com" })).status)
      .toBe(200)
  })
})

Deno.test("a sign-up cookie the API did not sign shows no sign-up, whatever address it names", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    // An unconfirmed account uses the address: what such a cookie could once find out.
    expect((await browser(app).post("/password/sign-up", { email: "ada@example.com" })).status)
      .toBe(200)
    const said = {
      provider: "google",
      token: "t".repeat(43),
      held: "sign-up:oauth:google:written-by-hand",
      email: "ada@example.com",
      verified: true,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
    // Signed like the API's own cookie, with a secret that is not the API's.
    const forger = createSignedPayloadCodec({
      secret: "not-the-cookie-secret-of-this-api-0123456789",
      purpose: "oauth.sign-up",
      version: 1,
      schema: type("object"),
    })
    const written = { "plain JSON": encodeURIComponent(JSON.stringify(said)) }
    const forged = { "signed with another secret": await forger.sign(said) }

    for (const [how, value] of Object.entries({ ...written, ...forged })) {
      const visitor = browser(app)
      visitor.cookies.set("oauth_sign_up", value)

      expect(await pendingOf(visitor), how).toBe(null)
      expect((await visitor.post("/auth/sign-up/confirm")).status, how).toBe(400)
    }
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("going back with a cookie pointed at another person's sign-up leaves that sign-up alone", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const ada = browser(app)
    await ada.through("google", "ada")
    const bob = browser(app)
    await bob.through("google", "bob")
    // Bob's own cookie, saying his profile is held where the flow store holds Ada's.
    const { held } = signUpCookieOf(ada).payload
    const own = signUpCookieOf(bob)
    expect(own.payload.held).not.toBe(held)
    bob.cookies.set("oauth_sign_up", own.edited({ ...own.payload, held }))

    expect((await bob.post("/auth/sign-up/cancel")).status).toBe(200)

    // Ada's question still waits, and her answer creates her account.
    expect((await ada.post("/auth/sign-up/confirm")).status).toBe(201)
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("another site cannot answer the question for a browser", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")

    expect((await visitor.fromAnotherSite("POST", "/auth/sign-up/confirm")).status).toBe(403)
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    expect((await visitor.fromAnotherSite("POST", "/auth/sign-up/cancel")).status).toBe(403)

    // The question still waits for the person's own answer.
    expect(await pendingOf(visitor)).not.toBe(null)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(201)
  })
})

Deno.test("the cookies of a flow are kept from page scripts and gone once used", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    const attributes = (response: Response, name: string) =>
      response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`))
        ?.toLowerCase().split(";").map((part) => part.trim()) ?? []

    const started = await visitor.get("/auth/google/start")
    const state = attributes(started, "oauth_state_google")
    expect(state).toContain("httponly")
    expect(state).toContain("samesite=lax")
    expect(state).toContain("path=/api/auth")

    const back = await visitor.through("google", "ada", started.headers.get("location")!)
    const question = attributes(back, "oauth_sign_up")
    expect(question).toContain("httponly")
    expect(question).toContain("samesite=lax")
    expect(question).toContain("path=/api/auth")
    expect(visitor.cookies.has("oauth_state_google")).toBe(false)

    await visitor.post("/auth/sign-up/confirm")
    expect(visitor.cookies.has("oauth_sign_up")).toBe(false)
  })
})

Deno.test("signing in with a provider ends the session the browser had before", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const shared = browser(app)
    const adaId = await provenPasswordAccount(app, shared, "ada@example.com")
    const adaSession = new Map(shared.cookies)
    const sessionsOf = async (userId: number) =>
      (await sql`SELECT count(*)::int AS open FROM auth_sessions WHERE user_id = ${userId}`)[0].open
    expect(await sessionsOf(adaId)).toBe(1)

    // Bob creates his account in the same browser, without signing Ada out first.
    await shared.through("google", "bob")
    expect(await sessionsOf(adaId)).toBe(1)
    const bob = await (await shared.post("/auth/sign-up/confirm")).json()

    expect(await sessionsOf(adaId)).toBe(0)
    const kept = browser(app)
    for (const [name, value] of adaSession) kept.cookies.set(name, value)
    expect((await kept.get("/auth/methods")).status).toBe(401)
    expect(await sessionsOf(bob.id)).toBe(1)

    // And the same when a known provider account signs in over a session.
    const again = browser(app)
    expect((await again.post("/password/sign-in", { email: "ada@example.com" })).status).toBe(200)
    expect(await sessionsOf(adaId)).toBe(1)
    expect(target(await again.through("google", "bob"))).toBe("/")
    expect(await sessionsOf(adaId)).toBe(0)
    expect(await sessionsOf(bob.id)).toBe(2)
  })
})

Deno.test("a spent rate limit or a failure sends the person to the sign-in page with a reason", async () => {
  await withSchema(async (sql) => {
    // The refusal as a response of its own: nothing is left on the request for the redirect.
    const spent: MiddlewareHandler<APIContext> = () =>
      Promise.resolve(
        Response.json({ error: "Too many requests" }, {
          status: 429,
          headers: { "retry-after": "42" },
        }),
      )
    const limited = buildApp(sql, { ada: ADA }, ["google"], { strictByIp: spent, normal: spent })
    const start = await browser(limited).get("/auth/google/start")
    expect(target(start)).toBe("/sign-in?oauth=busy")
    expect(start.headers.get("retry-after")).toBe("42")
    expect(target(await browser(limited).get("/auth/google/callback?code=ada&state=x")))
      .toBe("/sign-in?oauth=busy")
    // The routes a script calls keep the limiter's own answer.
    expect((await browser(limited).get("/auth/providers")).status).toBe(429)

    const down: MiddlewareHandler<APIContext> = () => Promise.reject(new Error("store down"))
    const broken = buildApp(sql, { ada: ADA }, ["google"], { strictByIp: down })
    expect(target(await browser(broken).through("google", "ada"))).toBe("/sign-in?oauth=failed")
    expect(broken.logged).toEqual(["error: provider sign-in could not count its rate limit"])
    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
  })
})

Deno.test("a failure inside the callback is logged and shown as a sentence, not as an error page", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await provenPasswordAccount(app, browser(app), "ada@example.com")
    // The audit table is gone, so the sign-in cannot be recorded.
    await sql`ALTER TABLE auth_audits RENAME TO auth_audits_away`

    expect(target(await visitor.through("google", "ada"))).toBe("/sign-in?oauth=failed")

    expect(app.logged).toEqual(["error: provider sign-in failed"])
    expect((await visitor.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("a confirmed sign-up cannot be confirmed a second time", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const held = new Map(visitor.cookies)
    expect((await visitor.post("/auth/sign-up/confirm")).status).toBe(201)

    const replay = browser(app)
    for (const [name, value] of held) replay.cookies.set(name, value)

    expect((await replay.post("/auth/sign-up/confirm")).status).toBe(400)
    expect((await replay.get("/auth/methods")).status).toBe(401)
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("a provider address that is not verified never links to the account that owns it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      impostor: { sub: "666", email: "ada@example.com", verified: false },
    })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const visitor = browser(app)

    // Asked like a stranger, never let into the owner's account.
    expect(target(await visitor.through("google", "impostor"))).toBe("/sign-up/confirm")

    expect((await visitor.get("/auth/methods")).status).toBe(401)
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method)).toEqual([
      "password",
    ])
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("a verified provider address signs in to the account that owns it and links the provider", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const ownerId = await provenPasswordAccount(app, browser(app), "ada@example.com")
    const visitor = browser(app)

    expect(target(await visitor.through("google", "ada"))).toBe("/")

    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    const listed = await methodsOf(visitor)
    expect(listed.methods.map((method) => [method.kind, method.current, method.canUnlink]))
      .toEqual([["password", false, false], ["google", true, true]])
    expect(listed.available).toEqual(["github"])
    expect((await audit(sql, ownerId)).slice(-2)).toEqual([
      [AuthAuditEventType.SIGN_IN_METHOD_LINKED, "oauth:google"],
      [AuthAuditEventType.SIGNED_IN, "oauth:google"],
    ])
  })
})

Deno.test("a callback whose state is not this browser's signs nobody in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")
    const attacker = browser(app)
    const started = await attacker.get("/auth/google/start")
    const state = new URL(started.headers.get("location")!).searchParams.get("state")

    // The attacker's link, opened in a browser that never started the flow.
    const victim = browser(app)
    const answer = await victim.get(`/auth/google/callback?code=ada&state=${state}`)

    expect(target(answer)).toBe("/sign-in?oauth=failed")
    expect((await victim.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("a provider that refuses the code signs nobody in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)

    expect(target(await visitor.through("google", "nobody"))).toBe("/sign-in?oauth=failed")

    expect(await accounts(sql)).toEqual({ authUsers: 0, profiles: 0 })
    expect(await pendingOf(visitor)).toBe(null)
  })
})

Deno.test("a provider sign-in returns to the page it was started for, and never to another site", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")

    const reader = browser(app)
    const started = await reader.get(`/auth/google/start?next=${encodeURIComponent("/notes/abc")}`)
    expect(target(await reader.through("google", "ada", started.headers.get("location")!)))
      .toBe("/notes/abc")

    for (const next of ["//evil.example", "https://evil.example/", "/api/auth/sign-out"]) {
      const lured = browser(app)
      const begun = await lured.get(`/auth/google/start?next=${encodeURIComponent(next)}`)
      const answer = await lured.through("google", "ada", begun.headers.get("location")!)
      expect(answer.headers.get("location")).toBe(`${ORIGIN}/`)
    }
  })
})

Deno.test("a return page written into the flow's cookie by hand is checked again", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const first = browser(app)
    await first.through("google", "ada")
    await first.post("/auth/sign-up/confirm")

    for (const next of ["//evil.example", "https://evil.example/", "/api/auth/sign-out"]) {
      const visitor = browser(app)
      const started = (await visitor.get("/auth/google/start")).headers.get("location")!
      const kept = JSON.parse(decodeURIComponent(visitor.cookies.get("oauth_state_google")!))
      visitor.cookies.set(
        "oauth_state_google",
        encodeURIComponent(JSON.stringify({ ...kept, next })),
      )

      expect(target(await visitor.through("google", "ada", started))).toBe("/")
    }

    // A page of the app written the same way is kept, so the loop above proves the check.
    const visitor = browser(app)
    const started = (await visitor.get("/auth/google/start")).headers.get("location")!
    const kept = JSON.parse(decodeURIComponent(visitor.cookies.get("oauth_state_google")!))
    visitor.cookies.set(
      "oauth_state_google",
      encodeURIComponent(JSON.stringify({ ...kept, next: "/notes" })),
    )
    expect(target(await visitor.through("google", "ada", started))).toBe("/notes")
  })
})

Deno.test("a provider sign-in to an account with two-factor on still owes the code", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const ownerId = await provenPasswordAccount(app, browser(app), "ada@example.com")
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${ownerId}`
    const visitor = browser(app)
    const started = await visitor.get(`/auth/google/start?next=${encodeURIComponent("/notes")}`)

    const answer = await visitor.through("google", "ada", started.headers.get("location")!)

    expect(target(answer)).toBe("/totp?next=%2Fnotes")
    // The session exists but is not let past the second factor.
    expect((await visitor.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("a blocked person cannot sign in with a provider, and no session is made", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const first = browser(app)
    await first.through("google", "ada")
    const user = await (await first.post("/auth/sign-up/confirm")).json()
    await sql`UPDATE users SET blocked_at = now() WHERE id = ${user.id}`
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`

    const later = browser(app)
    expect(target(await later.through("google", "ada"))).toBe("/sign-in?oauth=failed")

    expect((await later.get("/auth/methods")).status).toBe(401)
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
  })
})

Deno.test("a sign-up confirmed after its person was blocked signs nobody in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    // Two browsers ask the same question; the first answer makes the account.
    const first = browser(app)
    const second = browser(app)
    await first.through("google", "ada")
    await second.through("google", "ada")
    const user = await (await first.post("/auth/sign-up/confirm")).json()
    await sql`UPDATE users SET blocked_at = now() WHERE id = ${user.id}`
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`

    expect((await second.post("/auth/sign-up/confirm")).status).toBe(400)

    expect((await second.get("/auth/methods")).status).toBe(401)
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("the profile links a provider whose verified address is the account's own", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`

    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    expect(link.status).toBe(200)
    const answer = await owner.through("google", "ada", (await link.json()).url)

    expect(target(answer)).toBe("/profile/security?oauth=linked")
    const listed = await methodsOf(owner)
    // Still the password session: linking signs nobody in again.
    expect(listed.methods.map((method) => [method.kind, method.current]))
      .toEqual([["password", true], ["google", false]])
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
    expect((await audit(sql, ownerId)).at(-1)).toEqual([
      AuthAuditEventType.SIGN_IN_METHOD_LINKED,
      "oauth:google",
    ])
  })
})

/** The guest's row: its id and whether it is a guest still. */
async function guestRow(sql: postgres.Sql, id: number): Promise<{ guest: boolean } | undefined> {
  const [row] = await sql<{ guest: boolean }[]>`
    SELECT guest_since IS NOT NULL AS guest FROM users WHERE id = ${id}`
  return row
}

Deno.test("a guest keeps the account with Google, with no password asked, and the same user id", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const guest = browser(app)
    const { userId } = await (await guest.post("/guest")).json()
    expect(await guestRow(sql, userId)).toEqual({ guest: true })

    const link = await guest.post("/auth/methods/google/link", {})
    expect(link.status).toBe(200)
    expect(target(await guest.through("google", "ada", (await link.json()).url)))
      .toBe("/keep?oauth=kept")

    expect(await guestRow(sql, userId)).toEqual({ guest: false })
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect((await methodsOf(guest)).methods.map((method) => method.kind)).toContain("google")
    const later = browser(app)
    expect(target(await later.through("google", "ada"))).toBe("/")
    const [{ id }] = await sql<{ id: number }[]>`SELECT id FROM users`
    expect(id).toBe(userId)
  })
})

Deno.test("a guest's Google that signs in to another account offers the switch and merges nothing", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    expect(target(await owner.through("google", "ada"))).toBe("/sign-up/confirm")
    expect((await owner.post("/auth/sign-up/confirm")).status).toBe(201)
    const before = await accounts(sql)

    const guest = browser(app)
    const { userId } = await (await guest.post("/guest")).json()
    const link = await guest.post("/auth/methods/google/link", {})
    expect(target(await guest.through("google", "ada", (await link.json()).url)))
      .toBe("/keep/taken")

    expect(await guestRow(sql, userId)).toEqual({ guest: true })
    expect(await accounts(sql)).toEqual({
      authUsers: before.authUsers + 1,
      profiles: before.profiles + 1,
    })
    const [{ switches }] = await sql<{ switches: number }[]>`
      SELECT count(*)::int AS switches FROM guest_switches WHERE guest_user_id = ${userId}`
    expect(switches).toBe(1)
  })
})

Deno.test("the profile links a provider account whatever its address, and it then signs in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      work: { sub: "2002", email: "ada@work.example", verified: true },
      loose: { sub: "2003", email: "ada@loose.example", verified: false },
    })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")

    const google = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    expect(target(await owner.through("google", "work", (await google.json()).url)))
      .toBe("/profile/security?oauth=linked")
    const github = await owner.post("/auth/methods/github/link", { password: PASSWORD })
    expect(target(await owner.through("github", "loose", (await github.json()).url)))
      .toBe("/profile/security?oauth=linked")

    expect((await methodsOf(owner)).methods.map((method) => method.kind))
      .toEqual(["password", "google", "github"])
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    // No question is left open in this browser either.
    expect(await pendingOf(owner)).toBe(null)

    // The linked Google account is now a way in to the same account, with no question asked.
    const later = browser(app)
    expect(target(await later.through("google", "work"))).toBe("/")
    expect((await methodsOf(later)).methods.find((method) => method.current)?.kind).toBe("google")
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
    expect(
      (await audit(sql, ownerId)).filter(([type]) =>
        type === AuthAuditEventType.SIGN_IN_METHOD_LINKED
      ).length,
    ).toBe(2)
  })
})

Deno.test("linking a provider account that signs in to another account changes neither", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const bob = browser(app)
    await bob.through("google", "bob")
    const bobUser = await (await bob.post("/auth/sign-up/confirm")).json()
    const ada = browser(app)
    const adaId = await provenPasswordAccount(app, ada, "ada@example.com")
    const [{ before }] = await sql`SELECT count(*)::int AS before FROM auth_sessions`
    const adaAudit = await audit(sql, adaId)

    const link = await ada.post("/auth/methods/google/link", { password: PASSWORD })
    const answer = await ada.through("google", "bob", (await link.json()).url)

    expect(target(answer)).toBe("/profile/security?oauth=link-taken")
    // Ada is still Ada, with her one method, and no session of Bob's was left behind.
    expect((await methodsOf(ada)).methods.map((method) => method.kind)).toEqual(["password"])
    expect((await app.db.authStore.listKeys(adaId)).length).toBe(1)
    expect((await app.db.authStore.listKeys(bobUser.id)).length).toBe(1)
    expect(await audit(sql, adaId)).toEqual(adaAudit)
    const [{ after }] = await sql`SELECT count(*)::int AS after FROM auth_sessions`
    expect(after).toBe(before)
  })
})

Deno.test("Alice links a Google account whose verified address is Bob's and Bob's account is untouched", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      // A Google account nobody has used here, whose address is the one Bob proved.
      stray: { sub: "4004", email: "bob@example.com", verified: true },
    })
    const bob = browser(app)
    const bobId = await provenPasswordAccount(app, bob, "bob@example.com")
    const bobKeys = await app.db.authStore.listKeys(bobId)
    const bobAudit = await audit(sql, bobId)
    const alice = browser(app)
    const aliceId = await provenPasswordAccount(app, alice, "alice@example.com")

    const link = await alice.post("/auth/methods/google/link", { password: PASSWORD })
    const answer = await alice.through("google", "stray", (await link.json()).url)

    expect(target(answer)).toBe("/profile/security?oauth=linked")
    expect((await methodsOf(alice)).methods.map((method) => method.kind))
      .toEqual(["password", "google"])
    // Bob keeps his one key, proven as before, and nothing was written about him.
    expect(await app.db.authStore.listKeys(bobId)).toEqual(bobKeys)
    expect(await audit(sql, bobId)).toEqual(bobAudit)
    expect((await methodsOf(bob)).methods.map((method) => method.kind)).toEqual(["password"])
    // The address is Bob's: Alice's new key does not carry it as proven.
    const linked = (await app.db.authStore.listKeys(aliceId)).find((key) =>
      key.method === "oauth:google"
    )
    expect(linked?.provenAt ?? null).toBe(null)
    // That Google account signs in to Alice, never to Bob.
    const later = browser(app)
    expect(target(await later.through("google", "stray"))).toBe("/")
    const [session] = await sql`
      SELECT user_id FROM auth_sessions ORDER BY id DESC LIMIT 1`
    expect(session.userId).toBe(aliceId)
    expect(await accounts(sql)).toEqual({ authUsers: 2, profiles: 2 })
  })
})

Deno.test("linking the same provider account a second time says so and records nothing new", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const first = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    await owner.through("google", "ada", (await first.json()).url)
    const recorded = await audit(sql, ownerId)

    const again = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    const answer = await owner.through("google", "ada", (await again.json()).url)

    expect(target(answer)).toBe("/profile/security?oauth=link-exists")
    expect(await audit(sql, ownerId)).toEqual(recorded)
    expect((await app.db.authStore.listKeys(ownerId)).length).toBe(2)
  })
})

Deno.test("a sign-in that comes back while an abandoned link's cookie waits is still a sign-in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    // A link started on the profile and left at the provider: its cookie stays for ten minutes.
    expect((await owner.post("/auth/methods/google/link", { password: PASSWORD })).status).toBe(200)
    const abandoned = owner.cookies.get("oauth_connect_google")
    expect(abandoned).toBeDefined()

    // The same browser then signs in with Google: both cookies come back with the callback.
    const answer = await owner.through("google", "ada")

    expect(target(answer)).toBe("/")
    expect((await methodsOf(owner)).methods.find((method) => method.current)?.kind).toBe("google")
    expect((await audit(sql, ownerId)).at(-1)).toEqual([
      AuthAuditEventType.SIGNED_IN,
      "oauth:google",
    ])
    // Only the cookie whose `state` came back was used up.
    expect(owner.cookies.get("oauth_connect_google")).toBe(abandoned)
    expect(owner.cookies.has("oauth_state_google")).toBe(false)
  })
})

Deno.test("linking that takes an unconfirmed account's address records it on that account", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      // Google spells the address its own way; it is the same address.
      mine: { sub: "5005", email: "Ada@Work.example", verified: true },
    })
    // Someone signed up with the address and never confirmed it.
    const squatter = await (await browser(app).post("/password/sign-up", {
      email: "ada@work.example",
    })).json()
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")

    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    expect(target(await owner.through("google", "mine", (await link.json()).url)))
      .toBe("/profile/security?oauth=linked")

    expect(await app.db.authStore.listKeys(squatter.id)).toEqual([])
    expect((await audit(sql, squatter.id)).at(-1)).toEqual([
      AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
      "oauth:google",
    ])
    expect(
      (await audit(sql, ownerId)).filter(([type]) =>
        type === AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN
      ),
    ).toEqual([])
  })
})

Deno.test("a link belongs to the person who started it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")
    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    const { url } = await link.json()
    const flowOf = (visitor: ReturnType<typeof browser>) => {
      for (const [name, value] of owner.cookies) {
        if (name.startsWith("oauth_connect_")) visitor.cookies.set(name, value)
      }
      return visitor
    }
    // Signed out before the provider answered: only the flow's cookie is left.
    const signedOut = flowOf(browser(app))
    // Someone else, signed in, who got hold of the flow's cookie and address.
    const other = browser(app)
    const otherId = await provenPasswordAccount(app, other, "eve@example.com")
    flowOf(other)

    expect(target(await signedOut.through("google", "ada", url))).toBe(
      "/profile/security?oauth=failed",
    )
    expect(target(await other.through("google", "ada", url))).toBe("/profile/security?oauth=failed")

    expect((await methodsOf(owner)).methods.map((method) => method.kind)).toEqual(["password"])
    expect((await signedOut.get("/auth/methods")).status).toBe(401)
    expect((await app.db.authStore.listKeys(otherId)).length).toBe(1)
    expect(await accounts(sql)).toEqual({ authUsers: 2, profiles: 2 })
  })
})

Deno.test("a session that still owes its second factor cannot finish a link", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { work: { sub: "2002", email: "ada@work.example", verified: true } })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    const { url } = await link.json()
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${ownerId}`
    // The password alone, on another device that holds the flow's cookie.
    const half = browser(app)
    expect((await half.post("/password/sign-in", { email: "ada@example.com" })).status).toBe(200)
    for (const [name, value] of owner.cookies) {
      if (name.startsWith("oauth_connect_")) half.cookies.set(name, value)
    }

    expect(target(await half.through("google", "work", url))).toBe("/profile/security?oauth=failed")

    expect((await app.db.authStore.listKeys(ownerId)).length).toBe(1)
  })
})

Deno.test("the cookie of a link is kept from page scripts and gone once the provider answered", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")

    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    const set = link.headers.getSetCookie().find((line) => line.startsWith("oauth_connect_google="))
    expect(set).toMatch(/;\s*HttpOnly/i)
    expect(set).toMatch(/;\s*SameSite=Lax/i)
    await owner.through("google", "ada", (await link.json()).url)

    expect([...owner.cookies.keys()].filter((name) => name.startsWith("oauth_"))).toEqual([])
  })
})

Deno.test("starting a link needs a signed-in person and a request from the app itself", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })

    expect((await browser(app).post("/auth/methods/google/link")).status).toBe(401)

    const owner = browser(app)
    await provenPasswordAccount(app, owner, "ada@example.com")
    const forged = await app.app.request("http://local/auth/methods/google/link", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        cookie: [...owner.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      },
    })
    expect(forged.status).toBe(403)
  })
})

Deno.test("unlinking a provider ends the sessions that signed in with it and keeps the others", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const withPassword = browser(app)
    const ownerId = await provenPasswordAccount(app, withPassword, "ada@example.com")
    const withGoogle = browser(app)
    await withGoogle.through("google", "ada")
    const google = (await methodsOf(withGoogle)).methods.find((method) => method.kind === "google")!

    const answer = await withPassword.delete(`/auth/methods/${google.id}`, { password: PASSWORD })

    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ signedOut: false })
    // Announced, so the sockets of the ended sessions close.
    expect(app.signedOut).toEqual([ownerId])
    expect((await withGoogle.get("/auth/methods")).status).toBe(401)
    expect((await methodsOf(withPassword)).methods.map((method) => method.kind))
      .toEqual(["password"])
    expect((await audit(sql, ownerId)).at(-1)).toEqual([
      AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
      "oauth:google",
    ])
  })
})

Deno.test("unlinking the method this device signed in with signs it out", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    await provenPasswordAccount(app, browser(app), "ada@example.com")
    const withGoogle = browser(app)
    await withGoogle.through("google", "ada")
    const google = (await methodsOf(withGoogle)).methods.find((method) => method.current)!

    const answer = await withGoogle.delete(`/auth/methods/${google.id}`, { password: PASSWORD })

    expect(await answer.json()).toEqual({ signedOut: true })
    // The browser is told to drop the session cookie, not left to find out it is dead.
    expect([...withGoogle.cookies.keys()].filter((name) => !name.startsWith("oauth_")))
      .toEqual([])
    expect((await withGoogle.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("another site cannot unlink a method of a signed-in person", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    await browser(app).through("google", "ada")
    const google = (await methodsOf(owner)).methods.find((method) => method.kind === "google")!

    const forged = await owner.fromAnotherSite("DELETE", `/auth/methods/${google.id}`)

    expect(forged.status).toBe(403)
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method)).toEqual([
      "password",
      "oauth:google",
    ])
    expect(app.signedOut).toEqual([])
  })
})

Deno.test("a provider that was switched off does not count as a way in", async () => {
  await withSchema(async (sql) => {
    const both = buildApp(sql, { ada: ADA })
    const visitor = browser(both)
    await visitor.through("google", "ada")
    const user = await (await visitor.post("/auth/sign-up/confirm")).json()
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    // GitHub's key holds the address too, and a proven address is a way in through a sign-in link
    // (seed#406). Taken off, only the switched-off provider is left to count.
    const github = (await both.db.authStore.listKeys(user.id))
      .find((key) => key.method === "oauth:github")!
    expect(await both.db.authStore.releaseKeyEmail!(user.id, github.id)).toBe(true)

    // The same database, with GitHub's credentials removed from the configuration.
    const googleOnly = buildApp(sql, { ada: ADA }, ["google"])
    const later = browser(googleOnly)
    expect(target(await later.through("google", "ada"))).toBe("/")
    const { methods, available } = await methodsOf(later)

    expect(methods.map((method) => [method.kind, method.canUnlink])).toEqual([["google", false]])
    expect(available).toEqual([])
    expect((await later.delete(`/auth/methods/${methods[0].id}`)).status).toBe(409)
    expect((await googleOnly.db.authStore.listKeys(user.id)).map((key) => key.method)).toEqual([
      "oauth:google",
      "oauth:github",
    ])
  })
})

Deno.test("the last sign-in method cannot be unlinked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const user = await (await visitor.post("/auth/sign-up/confirm")).json()
    // GitHub vouches for the same address, so it links to the same account.
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    const [google, github] = (await methodsOf(visitor)).methods
    expect([google.kind, google.canUnlink, github.kind, github.canUnlink])
      .toEqual(["google", true, "github", true])

    expect((await visitor.delete(`/auth/methods/${google.id}`)).status).toBe(200)
    const last = await visitor.delete(`/auth/methods/${github.id}`)

    expect(last.status).toBe(409)
    expect((await app.db.authStore.listKeys(user.id)).map((key) => key.method)).toEqual([
      "oauth:github",
    ])
    expect((await methodsOf(visitor)).methods.map((method) => [method.kind, method.canUnlink]))
      .toEqual([["github", false]])
  })
})

Deno.test("two unlinks sent at once leave one way in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const user = await (await visitor.post("/auth/sign-up/confirm")).json()
    // GitHub vouches for the same address, so it links to the same account: two ways in, no password.
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    const [google, github] = (await methodsOf(visitor)).methods
    expect([google.canUnlink, github.canUnlink]).toEqual([true, true])

    const [toGoogle, toGitHub] = await Promise.all([
      visitor.delete(`/auth/methods/${google.id}`),
      visitor.delete(`/auth/methods/${github.id}`),
    ])

    // Each alone would be allowed; together, one wins and the other is refused. The loser that got
    // past the proof check waits for the winner and finds its method is the last way in. GitHub is
    // the session's own method: when it wins, the session ends with it, and a Google unlink that
    // reaches the proof check after that finds no recent provider sign-in left.
    const [winner, loser, kept] = toGoogle.status === 200
      ? [toGoogle, toGitHub, "oauth:github"]
      : [toGitHub, toGoogle, "oauth:google"]
    const refusal = [loser.status, checkedError(await loser.json()).message]
    expect(winner.status).toBe(200)
    expect([
      [409, METHOD_IS_LAST],
      ...(winner === toGitHub ? [[400, PROVIDER_PROOF_REQUIRED]] : []),
    ])
      .toContainEqual(refusal)
    expect((await app.db.authStore.listKeys(user.id)).map((key) => key.method)).toEqual([kept])
  })
})

Deno.test("a password key that holds no password does not count as a way in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const ownerId = await provenPasswordAccount(app, browser(app), "ada@example.com")
    const withGoogle = browser(app)
    expect(target(await withGoogle.through("google", "ada"))).toBe("/")
    expect((await methodsOf(withGoogle)).methods.map((method) => [method.kind, method.canUnlink]))
      .toEqual([["password", false], ["google", true]])

    // The key stays, without a password anybody could sign in with. Its proven address goes too:
    // a proven address is a way in through a sign-in link (seed#406), which is not this case.
    await sql`UPDATE auth_keys SET secret = NULL WHERE user_id = ${ownerId} AND method = 'password'`
    const password = (await app.db.authStore.listKeys(ownerId))
      .find((key) => key.method === "password")!
    expect(await app.db.authStore.releaseKeyEmail!(ownerId, password.id)).toBe(true)

    const { methods } = await methodsOf(withGoogle)
    expect(methods.map((method) => [method.kind, method.canUnlink])).toEqual([["google", false]])
    expect((await withGoogle.delete(`/auth/methods/${methods[0].id}`)).status).toBe(409)
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method)).toEqual([
      "password",
      "oauth:google",
    ])
  })
})

Deno.test("the password, another person's method and a misspelt id cannot be unlinked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      ada: ADA,
      bob: { sub: "3003", email: "bob@example.com", verified: true },
    })
    const ada = browser(app)
    const adaId = await provenPasswordAccount(app, ada, "ada@example.com")
    await browser(app).through("google", "ada")
    const bob = browser(app)
    await bob.through("google", "bob")
    await bob.post("/auth/sign-up/confirm")
    const [bobKey] = (await methodsOf(bob)).methods
    const password = (await methodsOf(ada)).methods.find((method) => method.kind === "password")!

    const proof = { password: PASSWORD }
    expect((await ada.delete(`/auth/methods/${password.id}`, proof)).status).toBe(404)
    expect((await ada.delete(`/auth/methods/${bobKey.id}`, proof)).status).toBe(404)
    // Her own Google method, but its id written as no page writes it.
    const google = (await methodsOf(ada)).methods.find((method) => method.kind === "google")!
    expect((await ada.delete(`/auth/methods/0x${google.id.toString(16)}`, proof)).status)
      .toBe(404)

    expect((await app.db.authStore.listKeys(adaId)).map((key) => key.method)).toEqual([
      "password",
      "oauth:google",
    ])
    expect((await methodsOf(bob)).methods).toHaveLength(1)
  })
})

/** The mails the sign-in method job sends, with a sender that records them. */
function methodMails(sql: postgres.Sql) {
  const sent: EmailMessage[] = []
  const job = signInMethodMailJob({
    sql,
    sender: {
      send: (message: EmailMessage) => (
        sent.push(message), Promise.resolve({ ok: true, accepted: [message.to], duplicates: [] })
      ),
    } as unknown as EmailSender,
    brand: { webAppUrl: ORIGIN },
    log: () => {},
  })
  return {
    sent,
    /** Runs the job for every sign-in method mail queued so far, oldest first. */
    async runQueued(): Promise<void> {
      const rows = await sql<{ aggregateId: string }[]>`
        SELECT aggregate_id FROM outbox_events WHERE event_kind = ${SIGN_IN_METHOD_MAIL_JOB}
        ORDER BY id`
      for (const row of rows) await job({ aggregateId: row.aggregateId } as OutboxEvent)
    },
  }
}

/** How many sign-in method mails are queued. */
async function queuedMethodMails(sql: postgres.Sql): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM outbox_events WHERE event_kind = ${SIGN_IN_METHOD_MAIL_JOB}`
  return row.count
}

Deno.test("unlinking asks an account with a password for it, and a refusal leaves the method linked", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    // A provider sign-in by the verified address links Google: one mail queued for that.
    await browser(app).through("google", "ada")
    const google = (await methodsOf(owner)).methods.find((method) => method.kind === "google")!
    expect(await queuedMethodMails(sql)).toBe(1)

    const without = await owner.delete(`/auth/methods/${google.id}`)
    const wrong = await owner.delete(`/auth/methods/${google.id}`, { password: "Wr0ng-one!" })

    for (const refused of [without, wrong]) {
      expect(refused.status).toBe(400)
      expect(checkedError(await refused.json()).message).toBe("Invalid password")
    }
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method))
      .toEqual(["password", "oauth:google"])
    expect(await queuedMethodMails(sql)).toBe(1)
    expect(app.signedOut).toEqual([])

    const unlinked = await owner.delete(`/auth/methods/${google.id}`, { password: PASSWORD })

    expect(unlinked.status).toBe(200)
    expect((await app.db.authStore.listKeys(ownerId)).map((key) => key.method))
      .toEqual(["password"])
  })
})

Deno.test("an account without a password unlinks only after a provider sign-in a moment ago", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const visitor = browser(app)
    await visitor.through("google", "ada")
    const user = await (await visitor.post("/auth/sign-up/confirm")).json()
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    const [google] = (await methodsOf(visitor)).methods
    // Every session now looks started longer ago than a provider sign-in confirms anything.
    const minutes = PROVIDER_PROOF_MINUTES + 1
    await sql`UPDATE auth_sessions SET created_at = created_at - make_interval(mins => ${minutes})`

    const stale = await visitor.delete(`/auth/methods/${google.id}`)

    expect(stale.status).toBe(400)
    expect(checkedError(await stale.json()).message).toBe(PROVIDER_PROOF_REQUIRED)
    expect(await app.db.authStore.listKeys(user.id)).toHaveLength(2)

    // Signing in with GitHub again is the proof.
    expect(target(await visitor.through("github", "ada"))).toBe("/")
    expect((await visitor.delete(`/auth/methods/${google.id}`)).status).toBe(200)
    expect((await app.db.authStore.listKeys(user.id)).map((key) => key.method))
      .toEqual(["oauth:github"])
  })
})

Deno.test("linking and unlinking a provider each mail the proven address once, naming the provider", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { ada: ADA })
    const owner = browser(app)
    const ownerId = await provenPasswordAccount(app, owner, "ada@example.com")
    const mails = methodMails(sql)

    const link = await owner.post("/auth/methods/google/link", { password: PASSWORD })
    expect(target(await owner.through("google", "ada", (await link.json()).url)))
      .toBe("/profile/security?oauth=linked")
    await mails.runQueued()

    expect(mails.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      ["ada@example.com", "Google was linked to your account"],
    ])

    const google = (await methodsOf(owner)).methods.find((method) => method.kind === "google")!
    expect((await owner.delete(`/auth/methods/${google.id}`, { password: PASSWORD })).status)
      .toBe(200)
    await mails.runQueued()

    expect(mails.sent.map((mail) => [mail.to, mail.subject])).toEqual([
      ["ada@example.com", "Google was linked to your account"],
      ["ada@example.com", "Google was unlinked from your account"],
    ])
    // The mail names the event the audit log records, and its row is gone once it is sent.
    expect((await audit(sql, ownerId)).slice(-2)).toEqual([
      [AuthAuditEventType.SIGN_IN_METHOD_LINKED, "oauth:google"],
      [AuthAuditEventType.SIGN_IN_METHOD_UNLINKED, "oauth:google"],
    ])
    expect(await sql`SELECT id FROM sign_in_method_changes`).toHaveLength(0)
  })
})

/** Resets the password of the account that signs in with `email`, as the mailed link does. */
async function resetByLink(app: App, email: string): Promise<boolean> {
  const issued = (await issuePasswordReset(app.db.authStore, email, new Date()))!
  return await app.signIn.resetPassword(email, issued.code, "N3w-Passw0rd")
}

Deno.test("a reset of an address nobody proved removes the providers linked before it, and they no longer sign in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {
      mallory: { sub: "6001", email: "mallory@evil.example", verified: true },
      loose: { sub: "6002", email: "mallory@loose.example", verified: false },
    })
    // Mallory signs up with Ada's address, which asks for no proof, and links her own accounts.
    const mallory = browser(app)
    const signedUp = await mallory.post("/password/sign-up", { email: "ada@example.com" })
    const { id } = await signedUp.json()
    const google = await mallory.post("/auth/methods/google/link", { password: PASSWORD })
    expect(target(await mallory.through("google", "mallory", (await google.json()).url)))
      .toBe("/profile/security?oauth=linked")
    const github = await mallory.post("/auth/methods/github/link", { password: PASSWORD })
    expect(target(await mallory.through("github", "loose", (await github.json()).url)))
      .toBe("/profile/security?oauth=linked")
    expect((await app.db.authStore.listKeys(id)).map((key) => key.method))
      .toEqual(["password", "oauth:google", "oauth:github"])

    // Ada takes the account back with the link in her mailbox.
    expect(await resetByLink(app, "ada@example.com")).toBe(true)

    // Mallory's Google account is a stranger's again: it is asked whether to make a new account.
    const later = browser(app)
    expect(target(await later.through("google", "mallory"))).not.toBe("/")
    expect((await later.get("/auth/methods")).status).toBe(401)
    expect(await pendingOf(later)).not.toBe(null)
    // GitHub vouched for no address, so there is nothing to sign up with either.
    const other = browser(app)
    await other.through("github", "loose")
    expect((await other.get("/auth/methods")).status).toBe(401)
    expect((await app.db.authStore.listKeys(id)).map((key) => key.method)).toEqual(["password"])
    expect(await accounts(sql)).toEqual({ authUsers: 1, profiles: 1 })
  })
})

Deno.test("a reset of an address nobody proved removes a code key the account holds for another address", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, {})
    const signedUp = await browser(app).post("/password/sign-up", { email: "ada@example.com" })
    const { id } = await signedUp.json()
    await app.db.authStore.addKey(id, {
      method: EMAIL_CODE_METHOD,
      subject: "mallory@evil.example",
      email: "mallory@evil.example",
      secret: null,
      provenAt: new Date(),
    })

    expect(await resetByLink(app, "ada@example.com")).toBe(true)

    expect((await app.db.authStore.listKeys(id)).map((key) => key.method)).toEqual(["password"])
    // The address the code key held is free again for whoever owns it.
    expect(await app.db.authStore.findUserIdByProvenEmail("mallory@evil.example")).toBe(null)
  })
})

Deno.test("a reset of an address that was proven before keeps the linked providers, and they still sign in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql, { work: { sub: "6003", email: "ada@work.example", verified: true } })
    const ada = browser(app)
    const adaId = await provenPasswordAccount(app, ada, "ada@example.com")
    const link = await ada.post("/auth/methods/google/link", { password: PASSWORD })
    expect(target(await ada.through("google", "work", (await link.json()).url)))
      .toBe("/profile/security?oauth=linked")

    expect(await resetByLink(app, "ada@example.com")).toBe(true)

    expect((await app.db.authStore.listKeys(adaId)).map((key) => key.method))
      .toEqual(["password", "oauth:google"])
    const later = browser(app)
    expect(target(await later.through("google", "work"))).toBe("/")
    expect((await methodsOf(later)).methods.find((method) => method.current)?.kind).toBe("google")
  })
})
