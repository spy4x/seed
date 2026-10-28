/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, type SignInMethodsResponse, UserMFAStatus } from "@domain/identity"
import type { OAuthFlowKv } from "@spy4x/server/auth/oauth"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  createOAuthRoute,
  METHOD_IS_LAST,
  METHOD_NOT_FOUND,
} from "../../apps/api/routes/auth-oauth.ts"
import {
  createPasskeyRoute,
  PASSKEY_ALREADY_YOURS,
  PASSKEY_NAME_INVALID,
  PASSKEY_NOT_FOUND,
  PASSKEY_NOT_SAVED,
  PASSKEY_REFUSED,
  PASSKEY_UNKNOWN,
} from "../../apps/api/routes/auth-passkeys.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { SoftPasskey } from "./soft-authenticator.ts"
import { apiError } from "../../apps/api/_testing/api-error.ts"

/**
 * Passkeys (#222) through the real routes and sign-in against a real Postgres: adding one, signing
 * in with it, renaming and removing it, and the refusals around each. The passkeys are made in
 * software (`soft-authenticator.ts`), so every check of `@spy4x/server/webauthn` runs. The KV is a
 * map whose `take` gets and deletes in one step, as Valkey's does.
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
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `passkey_test_${uuidV7().replaceAll("-", "")}`
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

/**
 * A KV whose `take` returns and deletes in one step. Expiry is left to the challenge itself.
 * `keys` lists what it holds, so a test can see under which name a challenge waits.
 */
function memoryKv(): OAuthFlowKv & { keys(): string[] } {
  const values = new Map<string, string>()
  return {
    keys: () => [...values.keys()],
    set: (key, value) => (values.set(key, value), Promise.resolve()),
    take: (key) => {
      const value = values.get(key) ?? null
      values.delete(key)
      return Promise.resolve(value)
    },
  }
}

const pass = (_c: unknown, next: () => Promise<void>) => next()

/** The real passkey and sign-in method routes over `sql`, with the password routes beside them. */
function buildApp(sql: postgres.Sql) {
  const logged: string[] = []
  const db = new AppDbBase({ sql })
  const url = new URL(ORIGIN)
  const kv = memoryKv()
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
    passkeys: {
      rp: { id: url.hostname, name: "Example", origins: [url.origin] },
      kv,
      log: (message) => void logged.push(message),
    },
  })
  const rateLimits = { strictByIp: pass, strictByUser: pass, normal: pass }
  const mutationGuards = createMutationGuards(ORIGIN)
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.route("/auth", createPasskeyRoute({ signIn, mutationGuards, rateLimits }))
  app.route(
    "/auth",
    createOAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards,
      rateLimits,
      origin: ORIGIN,
      logError: (message) => void logged.push(message),
    }),
  )
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
  return { app, db, sql, logged, kv }
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
        "user-agent": FIREFOX,
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
    patch: (path: string, body: unknown) => send("PATCH", path, body),
    delete: (path: string, body: unknown = {}) => send("DELETE", path, body),
  }
}

type Browser = ReturnType<typeof browser>

/** A password account signed in on a new browser. */
async function passwordAccount(app: App, email: string): Promise<{ id: number; visitor: Browser }> {
  const visitor = browser(app)
  const response = await visitor.post("/password/sign-up", { email })
  expect(response.status).toBe(200)
  return { id: (await response.json()).id, visitor }
}

/** Adds `passkey` to the account signed in on `visitor`, proven with the password. */
async function addPasskey(visitor: Browser, passkey: SoftPasskey): Promise<Response> {
  const options = await visitor.post("/auth/passkeys/add/options", { password: PASSWORD })
  expect(options.status).toBe(200)
  return await visitor.post("/auth/passkeys", await passkey.create(await options.json()))
}

/** Signs in with `passkey` on `visitor`: the options, the device, the answer. */
async function passkeySignIn(visitor: Browser, passkey: SoftPasskey): Promise<Response> {
  const options = await visitor.post("/auth/passkeys/sign-in/options")
  expect(options.status).toBe(200)
  return await visitor.post("/auth/passkeys/sign-in", await passkey.get(await options.json()))
}

async function methodsOf(visitor: Browser): Promise<SignInMethodsResponse> {
  const response = await visitor.get("/auth/methods")
  expect(response.status).toBe(200)
  return await response.json()
}

/** The audit events of `userId`, oldest first, with what each names. */
async function audit(sql: postgres.Sql, userId: number): Promise<[AuthAuditEventType, string][]> {
  const rows = await sql`
    SELECT event_type, identifier FROM auth_audits WHERE user_id = ${userId} ORDER BY id`
  return rows.map((row) => [row.eventType, row.identifier])
}

Deno.test("a person adds a passkey, named after the browser, and signs in with it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id, visitor } = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)

    const added = await addPasskey(visitor, passkey)
    expect(added.status).toBe(201)
    const { keyId, name } = await added.json()
    expect(name).toBe("Firefox on Linux")
    const passkeyRow = (await methodsOf(visitor)).methods.find((method) => method.id === keyId)
    expect(passkeyRow).toMatchObject({
      kind: "passkey",
      email: null,
      current: false,
      canUnlink: true,
      passkey: { name: "Firefox on Linux", lastUsedAt: null },
    })
    // The credential is a key of method `passkey`, and the person is told by mail.
    const [key] = await sql`SELECT method, subject FROM auth_keys WHERE id = ${keyId}`
    expect(key).toEqual({ method: "passkey", subject: passkey.id })
    expect(await sql`SELECT method FROM sign_in_method_changes WHERE user_id = ${id}`)
      .toEqual([{ method: "passkey" }])

    const laptop = browser(app)
    const signedIn = await passkeySignIn(laptop, passkey)
    expect(signedIn.status).toBe(200)
    expect((await signedIn.json()).id).toBe(id)
    const used = (await methodsOf(laptop)).methods.find((method) => method.id === keyId)!
    expect(used.current).toBe(true)
    expect(used.passkey?.lastUsedAt).not.toBeNull()
    expect(await audit(sql, id)).toEqual(expect.arrayContaining([
      [AuthAuditEventType.SIGN_IN_METHOD_LINKED, "passkey name=Firefox on Linux"],
      [AuthAuditEventType.SIGNED_IN, "passkey name=Firefox on Linux"],
    ]))
  })
})

Deno.test("adding a passkey asks for the password first", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { visitor } = await passwordAccount(app, "ada@example.com")

    const without = await visitor.post("/auth/passkeys/add/options", {})
    expect(without.status).toBe(400)
    const wrong = await visitor.post("/auth/passkeys/add/options", { password: "wrong" })
    expect(wrong.status).toBe(400)
    expect(await sql`SELECT 1 FROM auth_passkeys`).toHaveLength(0)
  })
})

Deno.test("a challenge answers once: a replayed sign-in or add is refused", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { visitor } = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)

    const options = await visitor.post("/auth/passkeys/add/options", { password: PASSWORD })
    const registration = await passkey.create(await options.json())
    expect((await visitor.post("/auth/passkeys", registration)).status).toBe(201)
    const again = await visitor.post("/auth/passkeys", registration)
    expect(again.status).toBe(400)
    expect(await apiError(again)).toMatchObject({ message: PASSKEY_NOT_SAVED })

    const laptop = browser(app)
    const signInOptions = await laptop.post("/auth/passkeys/sign-in/options")
    const assertion = await passkey.get(await signInOptions.json())
    expect((await laptop.post("/auth/passkeys/sign-in", assertion)).status).toBe(200)
    const thief = browser(app)
    const replayed = await thief.post("/auth/passkeys/sign-in", assertion)
    expect(replayed.status).toBe(400)
    expect(await apiError(replayed)).toMatchObject({ message: PASSKEY_REFUSED })
    expect((await thief.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("the same passkey cannot be added twice, to the same or another account", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const bob = await passwordAccount(app, "bob@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    expect((await addPasskey(ada.visitor, passkey)).status).toBe(201)

    const twice = await addPasskey(ada.visitor, passkey)
    expect(twice.status).toBe(409)
    expect(await apiError(twice)).toMatchObject({ message: PASSKEY_ALREADY_YOURS })
    const taken = await addPasskey(bob.visitor, passkey)
    expect(taken.status).toBe(400)
    expect(await apiError(taken)).toMatchObject({ message: PASSKEY_NOT_SAVED })
    expect(await sql`SELECT user_id FROM auth_passkeys`).toEqual([{ userId: ada.id }])
  })
})

Deno.test("a passkey is renamed by its owner only, to a name of 1 to 64 characters, and the trail says so", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const bob = await passwordAccount(app, "bob@example.com")
    const { keyId } = await (await addPasskey(ada.visitor, new SoftPasskey(ORIGIN))).json()

    const renamed = await ada.visitor.patch(`/auth/passkeys/${keyId}`, { name: "  Work laptop " })
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toEqual({ name: "Work laptop" })
    for (const name of ["", " ", "x".repeat(65), "line\nbreak", 7]) {
      const refused = await ada.visitor.patch(`/auth/passkeys/${keyId}`, { name })
      expect(refused.status).toBe(400)
      expect(await apiError(refused)).toMatchObject({ message: PASSKEY_NAME_INVALID })
    }
    const other = await bob.visitor.patch(`/auth/passkeys/${keyId}`, { name: "Mine now" })
    expect(other.status).toBe(404)
    expect(await apiError(other)).toMatchObject({ message: PASSKEY_NOT_FOUND })
    expect(await sql`SELECT name FROM auth_passkeys`).toEqual([{ name: "Work laptop" }])
    // The same name again changes nothing, so the trail gets one row for the one rename.
    expect((await ada.visitor.patch(`/auth/passkeys/${keyId}`, { name: "Work laptop" })).status)
      .toBe(200)
    const renames = (await audit(sql, ada.id))
      .filter(([type]) => type === AuthAuditEventType.SIGN_IN_METHOD_RENAMED)
    expect(renames).toEqual([[
      AuthAuditEventType.SIGN_IN_METHOD_RENAMED,
      "passkey name=Work laptop from=Firefox on Linux",
    ]])
    expect(
      (await audit(sql, bob.id)).filter(([type]) =>
        type === AuthAuditEventType.SIGN_IN_METHOD_RENAMED
      ),
    ).toEqual([])
  })
})

Deno.test("a removed passkey signs its devices out and no longer signs in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id, visitor } = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    const { keyId } = await (await addPasskey(visitor, passkey)).json()
    const laptop = browser(app)
    expect((await passkeySignIn(laptop, passkey)).status).toBe(200)

    const removed = await visitor.delete(`/auth/methods/${keyId}`, { password: PASSWORD })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ signedOut: false })
    expect(await sql`SELECT 1 FROM auth_passkeys`).toHaveLength(0)
    expect((await laptop.get("/auth/methods")).status).toBe(401)
    expect(await audit(sql, id)).toContainEqual([
      AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
      "passkey name=Firefox on Linux",
    ])
    // The device still offers it: the answer tells the page to have the device forget it.
    const stale = await passkeySignIn(browser(app), passkey)
    expect(stale.status).toBe(404)
    expect(await apiError(stale)).toMatchObject({
      message: PASSKEY_UNKNOWN,
      details: { unknown: true },
    })
  })
})

Deno.test("the only passkey of an account without a password cannot be removed", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id, visitor } = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    const { keyId } = await (await addPasskey(visitor, passkey)).json()
    // The account keeps its passkey only, as one made before passwords were optional would.
    await sql`DELETE FROM auth_keys WHERE user_id = ${id} AND method = 'password'`

    // A passkey sign-in a moment ago is the proof an account without a password gives.
    const phone = browser(app)
    expect((await passkeySignIn(phone, passkey)).status).toBe(200)
    const methods = await methodsOf(phone)
    expect(methods.methods).toHaveLength(1)
    expect(methods.methods[0].canUnlink).toBe(false)
    expect(methods.providerProofUntil).not.toBeNull()
    const last = await phone.delete(`/auth/methods/${keyId}`)
    expect(last.status).toBe(409)
    expect(await apiError(last)).toMatchObject({ message: METHOD_IS_LAST })
    expect(await sql`SELECT 1 FROM auth_passkeys`).toHaveLength(1)
  })
})

Deno.test("another person's passkey is refused where the person is known", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const bob = await passwordAccount(app, "bob@example.com")
    const adas = new SoftPasskey(ORIGIN)
    const { keyId } = await (await addPasskey(ada.visitor, adas)).json()
    expect((await addPasskey(bob.visitor, new SoftPasskey(ORIGIN))).status).toBe(201)

    // Bob signs in again to confirm a step, but with Ada's passkey: refused, and Bob stays Bob.
    const options = await bob.visitor.post("/auth/passkeys/confirm/options")
    expect(options.status).toBe(200)
    const confirm = await bob.visitor.post(
      "/auth/passkeys/confirm",
      await adas.get(await options.json()),
    )
    expect(confirm.status).toBe(400)
    expect(await apiError(confirm)).toMatchObject({ message: PASSKEY_REFUSED })
    expect(app.logged.join("\n")).toContain("wrong_credential")
    const removed = await bob.visitor.delete(`/auth/methods/${keyId}`, { password: PASSWORD })
    expect(removed.status).toBe(404)
    expect(await apiError(removed)).toMatchObject({ message: METHOD_NOT_FOUND })
    expect(await sql`SELECT user_id FROM auth_passkeys WHERE key_id = ${keyId}`)
      .toEqual([{ userId: ada.id }])

    // Ada confirms with her own: a fresh session of hers replaces the one she had.
    const own = await ada.visitor.post("/auth/passkeys/confirm/options")
    const confirmed = await ada.visitor.post(
      "/auth/passkeys/confirm",
      await adas.get(await own.json()),
    )
    expect(confirmed.status).toBe(200)
    expect((await confirmed.json()).id).toBe(ada.id)
    expect((await methodsOf(ada.visitor)).providerProofUntil).not.toBeNull()
  })
})

Deno.test("a passkey sign-in on an account with an authenticator app passes the two-factor gate", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    expect((await addPasskey(ada.visitor, passkey)).status).toBe(201)
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${ada.id}`

    // The device verified the person, so the passkey counts as both factors: no code is asked.
    const laptop = browser(app)
    const signedIn = await passkeySignIn(laptop, passkey)
    expect(signedIn.status).toBe(200)
    expect((await laptop.get("/auth/methods")).status).toBe(200)
  })
})

Deno.test("confirming with a passkey on an account with an authenticator app keeps the person signed in", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    expect((await addPasskey(ada.visitor, passkey)).status).toBe(201)
    await sql`UPDATE users SET mfa = ${UserMFAStatus.CONFIGURED} WHERE id = ${ada.id}`
    const laptop = browser(app)
    expect((await passkeySignIn(laptop, passkey)).status).toBe(200)

    const options = await laptop.post("/auth/passkeys/confirm/options")
    expect(options.status).toBe(200)
    const confirmed = await laptop.post(
      "/auth/passkeys/confirm",
      await passkey.get(await options.json()),
    )
    expect(confirmed.status).toBe(200)
    expect((await laptop.get("/auth/methods")).status).toBe(200)
  })
})

Deno.test("a blocked person cannot sign in with their passkey", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    expect((await addPasskey(ada.visitor, passkey)).status).toBe(201)
    await sql`UPDATE users SET blocked_at = CURRENT_TIMESTAMP WHERE id = ${ada.id}`

    const laptop = browser(app)
    const refused = await passkeySignIn(laptop, passkey)
    expect(refused.status).toBe(400)
    expect(await apiError(refused)).toMatchObject({ message: PASSKEY_REFUSED })
    expect((await laptop.get("/auth/methods")).status).toBe(401)
  })
})

Deno.test("only the session that asked to add a passkey can finish adding it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    // A second session of the same person, signed in with the password on another browser.
    const elsewhere = browser(app)
    expect((await elsewhere.post("/password/sign-in", { email: "ada@example.com" })).status)
      .toBe(200)
    const passkey = new SoftPasskey(ORIGIN)

    const options = await ada.visitor.post("/auth/passkeys/add/options", { password: PASSWORD })
    const registration = await passkey.create(await options.json())
    const stolen = await elsewhere.post("/auth/passkeys", registration)
    expect(stolen.status).toBe(400)
    expect(await apiError(stolen)).toMatchObject({ message: PASSKEY_NOT_SAVED })
    expect(await sql`SELECT 1 FROM auth_passkeys`).toHaveLength(0)
    // The session that asked still can.
    expect((await ada.visitor.post("/auth/passkeys", registration)).status).toBe(201)
  })
})

Deno.test("each ceremony keeps its challenge under its own name, the add and confirm ones under the session", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const passkey = new SoftPasskey(ORIGIN)
    expect((await addPasskey(ada.visitor, passkey)).status).toBe(201)
    const waiting = (prefix: string) => app.kv.keys().filter((key) => key.startsWith(prefix))

    await browser(app).post("/auth/passkeys/sign-in/options")
    expect(waiting("passkey:sign-in:")).toHaveLength(1)
    expect(waiting("passkey:sign-in:")[0]).toMatch(/^passkey:sign-in:[^:]+$/)
    await ada.visitor.post("/auth/passkeys/confirm/options")
    expect(waiting("passkey:confirm:")).toHaveLength(1)
    expect(waiting("passkey:confirm:")[0]).toMatch(/^passkey:confirm:[^:]+:[^:]+$/)
    await ada.visitor.post("/auth/passkeys/add/options", { password: PASSWORD })
    expect(waiting("passkey:add:")).toHaveLength(1)
    expect(waiting("passkey:add:")[0]).toMatch(/^passkey:add:[^:]+:[^:]+$/)
    // A confirm challenge does not open the signed-out sign-in.
    const confirmOptions = await ada.visitor.post("/auth/passkeys/confirm/options")
    const assertion = await passkey.get(await confirmOptions.json())
    const crossed = await browser(app).post("/auth/passkeys/sign-in", assertion)
    expect(crossed.status).toBe(400)
    expect(await apiError(crossed)).toMatchObject({ message: PASSKEY_REFUSED })
  })
})

Deno.test("a passkey's stored counter never goes down, even when two sign-ins finish out of order", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await passwordAccount(app, "ada@example.com")
    const { keyId } = await (await addPasskey(ada.visitor, new SoftPasskey(ORIGIN))).json()

    await app.db.passkeys.recordUse(keyId, { counter: 5, backedUp: true })
    await app.db.passkeys.recordUse(keyId, { counter: 3, backedUp: true })
    expect(await sql`SELECT counter FROM auth_passkeys WHERE key_id = ${keyId}`)
      .toEqual([{ counter: "5" }])
  })
})
