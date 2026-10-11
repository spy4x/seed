/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono, type MiddlewareHandler } from "hono"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { API_TOKENS_MAX, ApiTokenAccess } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import { NoteCreateCommand, NoteGetQuery, NoteListQuery } from "@domain/notes"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { createNoteListCursor } from "@server/notes/note-list-cursor.ts"
import { API_TOKEN_USE_RESOLUTION_MS } from "@server/api-tokens/api-tokens.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { createApiTokens } from "../../apps/api/services/api-tokens.ts"
import { createMutationGuards } from "../../apps/api/middlewares/mutation-guards.ts"
import { createSessionGate } from "../../apps/api/cqrs/session-gate.ts"
import { createEntitlementGate } from "../../apps/api/cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../apps/api/cqrs/entitlement-needs.ts"
import {
  createNoteCreateHandler,
  createNoteGetHandler,
  createNoteListHandler,
} from "../../apps/api/features/notes/handlers.ts"
import { createApiTokensRoute } from "../../apps/api/routes/api-tokens.ts"
import { createAuthRoute } from "../../apps/api/routes/auth.ts"
import type { AuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { createTokenApiRoute } from "../../apps/api/routes/token-api.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Personal API tokens (#167) against a real Postgres, through the real sign-in, the real token
 * service and both real routes: what the table keeps, who a token acts as and when it stops.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const TOKEN_KEY = "integration-test-only-api-token-key-0123456789"
const PASSWORD = "Passw0rd!"
const WEB_APP_URL = "https://app.example.com"
const API = "http://app.example.com/api"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `api_tokens_test_${uuidV7().replaceAll("-", "")}`
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

const passThrough: MiddlewareHandler = async (_c, next) => await next()
const notCalled = () => Promise.reject(new Error("not part of this test"))

/** The auth routes' limits, all open: limits are not what these tests are about. */
const openAuthLimits: AuthRateLimits = {
  strictByIp: passThrough,
  strictByUser: passThrough,
  otpByUser: passThrough,
  normal: passThrough,
  resetByAddress: notCalled,
  emailCodeByAddress: notCalled,
  emailChangeByUser: notCalled,
  emailChangeByAddress: notCalled,
}
const openLockout = {
  begin: () => Promise.resolve(0),
  refund: () => Promise.resolve(),
  fail: () => Promise.resolve(),
}

/** The API as `index.ts` mounts the parts this feature touches, with a clock the test moves. */
async function buildApp(sql: postgres.Sql) {
  const db = new AppDbBase({ sql })
  const clock = { now: new Date() }
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  const tokens = createApiTokens({
    db,
    key: TOKEN_KEY,
    logError: (message, error) => {
      throw new Error(`${message}: ${error}`)
    },
    now: () => clock.now,
  })
  const groups = new PostgresGroupRepository(sql)
  const roleOf = async (groupId: string, userId: number) =>
    (await groups.getForMember(groupId, userId))?.role ?? null
  const dependencies = { notes: new PostgresNoteRepository(sql), groups: { roleOf } }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: false,
    planOf: () => Promise.reject(new Error("billing is off")),
    roleOf,
    usage: {
      maxNotes: () => Promise.reject(new Error("billing is off")),
      maxMembers: () => Promise.reject(new Error("billing is off")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))

  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("requestId", uuidV7())
    await next()
  })
  app.use("*", signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email, groupId } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD, groupId)
    return result ? c.json({ ok: true }) : c.json({ error: "refused" }, 401)
  })
  // The real account routes, where the password, sessions and second factor live.
  app.route(
    "/auth",
    createAuthRoute({
      signIn,
      emit: () => {},
      mutationGuards: createMutationGuards(WEB_APP_URL),
      rateLimits: openAuthLimits,
      totpFailures: openLockout,
      requestPasswordReset: () => Promise.resolve(),
      emailCodeFailures: openLockout,
      requestEmailCode: () => Promise.resolve(),
      logError: (message, error) => {
        throw new Error(`${message}: ${error}`)
      },
    }),
  )
  app.route(
    "/tokens",
    createApiTokensRoute({
      auth: signIn.auth,
      mutationGuards: createMutationGuards(WEB_APP_URL),
      limit: passThrough,
      tokens,
    }),
  )
  app.route(
    "/v1",
    createTokenApiRoute({
      authenticate: (c, presented) => tokens.authenticate(c, presented),
      create: (command) => commands.execute(command),
      get: (query) => queries.execute(query),
      list: (query) => queries.execute(query),
      cursor: await createNoteListCursor(COOKIE_SECRET),
      limitByIp: passThrough,
      limitByToken: passThrough,
    }),
  )
  return { app, clock, groups, sql, db, signIn }
}

type App = Awaited<ReturnType<typeof buildApp>>

/** A signed-up person with a session cookie and the "Personal" group sign-up made them. */
interface Person {
  userId: number
  cookie: string
  groupId: string
}

async function signUp(app: App, email: string): Promise<Person> {
  const groupId = uuidV7()
  const response = await app.app.request(`${API}/sign-up`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.42" },
    body: JSON.stringify({ email, groupId }),
  })
  expect(response.status).toBe(200)
  const header = response.headers.get("set-cookie")
  if (!header) throw new Error("sign-up set no cookie")
  const [{ userId }] = await app.sql<{ userId: number }[]>`
    SELECT user_id FROM group_members WHERE group_id = ${groupId}
  `
  return { userId, cookie: header.split(";")[0], groupId }
}

const browser = (cookie: string) => ({
  "content-type": "application/json",
  cookie,
  origin: WEB_APP_URL,
  "sec-fetch-site": "same-origin",
  "x-real-ip": "203.0.113.42",
})

const bearer = (secret: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${secret}`,
  "x-real-ip": "198.51.100.7",
})

async function createToken(
  app: App,
  person: Person,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; secret: string }> {
  const response = await app.app.request(`${API}/tokens`, {
    method: "POST",
    headers: browser(person.cookie),
    body: JSON.stringify({
      name: "Script",
      groupId: person.groupId,
      access: ApiTokenAccess.WRITE,
      expiresInDays: 90,
      ...overrides,
    }),
  })
  expect(response.status).toBe(201)
  const body = await response.json() as { token: { id: string }; secret: string }
  expectVersion7Ids([body.token])
  return { id: body.token.id, secret: body.secret }
}

function listNotes(app: App, groupId: string, secret: string) {
  return app.app.request(`${API}/v1/groups/${groupId}/notes`, { headers: bearer(secret) })
}

async function audits(sql: postgres.Sql, userId: number): Promise<number[]> {
  const rows = await sql<{ eventType: number }[]>`
    SELECT event_type FROM auth_audits
    WHERE user_id = ${userId} AND event_type IN (
      ${AuthAuditEventType.API_TOKEN_CREATED}, ${AuthAuditEventType.API_TOKEN_USED},
      ${AuthAuditEventType.API_TOKEN_REVOKED}
    )
    ORDER BY id
  `
  return rows.map((row) => row.eventType)
}

Deno.test("the database keeps only a keyed hash of a token, never the token", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { secret } = await createToken(app, ada)

    expect(secret).toMatch(/^tpl_[A-Za-z0-9_-]{22}$/)
    const dump = JSON.stringify(await sql`SELECT * FROM api_tokens`)
    expect(dump).not.toContain(secret)
    expect(dump).not.toContain(secret.slice(4))
    const [row] = await sql<{ tokenHash: string }[]>`SELECT token_hash FROM api_tokens`
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    // The list never carries a secret either.
    const listed = await app.app.request(`${API}/tokens`, { headers: browser(ada.cookie) })
    expect(await listed.text()).not.toContain(secret.slice(4))
  })
})

Deno.test("a token works in its own group only, and a read-only one cannot write", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const otherGroup = uuidV7()
    await app.groups.create({ id: otherGroup, name: "Side project" }, ada.userId)
    const writer = await createToken(app, ada)
    const reader = await createToken(app, ada, { access: ApiTokenAccess.READ })

    const created = await app.app.request(`${API}/v1/groups/${ada.groupId}/notes`, {
      method: "POST",
      headers: bearer(writer.secret),
      body: JSON.stringify({ id: uuidV7(), title: "From a script", body: "" }),
    })
    expect(created.status).toBe(201)
    expect((await listNotes(app, ada.groupId, reader.secret)).status).toBe(200)
    expect((await listNotes(app, otherGroup, writer.secret)).status).toBe(403)

    const refused = await app.app.request(`${API}/v1/groups/${ada.groupId}/notes`, {
      method: "POST",
      headers: bearer(reader.secret),
      body: JSON.stringify({ id: uuidV7(), title: "Not allowed", body: "" }),
    })
    expect(refused.status).toBe(403)
    const notes = await sql<{ title: string; groupId: string }[]>`SELECT title, group_id FROM notes`
    expect(notes).toEqual([{ title: "From a script", groupId: ada.groupId }])
  })
})

Deno.test("a revoked token and an expired token are refused on the very next request", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const revoked = await createToken(app, ada)
    const expiring = await createToken(app, ada, { expiresInDays: 30 })
    expect((await listNotes(app, ada.groupId, revoked.secret)).status).toBe(200)
    expect((await listNotes(app, ada.groupId, expiring.secret)).status).toBe(200)

    const response = await app.app.request(`${API}/tokens/${revoked.id}`, {
      method: "DELETE",
      headers: browser(ada.cookie),
    })
    expect(response.status).toBe(200)
    expect((await listNotes(app, ada.groupId, revoked.secret)).status).toBe(401)

    await sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${expiring.id}`
    expect((await listNotes(app, ada.groupId, expiring.secret)).status).toBe(401)
    // The expired one is gone from the owner's list too.
    const listed = await app.app.request(`${API}/tokens`, { headers: browser(ada.cookie) })
    expect(((await listed.json()) as { tokens: unknown[] }).tokens).toEqual([])
  })
})

Deno.test("a token stops working when its owner's account is deleted", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { secret } = await createToken(app, ada)

    await sql`UPDATE users SET deleted_at = now() WHERE id = ${ada.userId}`
    expect((await listNotes(app, ada.groupId, secret)).status).toBe(401)
  })
})

Deno.test("a token cannot reach account actions: token management, password, sessions", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { id, secret } = await createToken(app, ada)

    const list = await app.app.request(`${API}/tokens`, { headers: bearer(secret) })
    expect(list.status).toBe(401)
    const create = await app.app.request(`${API}/tokens`, {
      method: "POST",
      headers: { ...bearer(secret), origin: WEB_APP_URL, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({
        name: "Escalated",
        groupId: ada.groupId,
        access: ApiTokenAccess.WRITE,
        expiresInDays: null,
      }),
    })
    expect(create.status).toBe(401)
    const revoke = await app.app.request(`${API}/tokens/${id}`, {
      method: "DELETE",
      headers: { ...bearer(secret), origin: WEB_APP_URL, "sec-fetch-site": "same-origin" },
    })
    expect(revoke.status).toBe(401)
    // The real account routes: `parseAuth` reads only the session cookie, so a bearer token is no
    // one there.
    const sameSite = { ...bearer(secret), origin: WEB_APP_URL, "sec-fetch-site": "same-origin" }
    const password = await app.app.request(`${API}/auth/password/change`, {
      method: "POST",
      headers: sameSite,
      body: JSON.stringify({ password: PASSWORD, newPassword: "Hijacked-Passw0rd" }),
    })
    expect(password.status).toBe(401)
    const sessions = await app.app.request(`${API}/auth/sessions`, { headers: sameSite })
    expect(sessions.status).toBe(401)
    const endOthers = await app.app.request(`${API}/auth/sessions/others`, {
      method: "DELETE",
      headers: sameSite,
    })
    expect(endOthers.status).toBe(401)
    const [{ count }] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM api_tokens`
    expect(count).toBe(1)
  })
})

Deno.test("nobody can make a token for a group they are not in, or revoke another person's", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    const adas = await createToken(app, ada)

    const intoAda = await app.app.request(`${API}/tokens`, {
      method: "POST",
      headers: browser(bob.cookie),
      body: JSON.stringify({
        name: "Sneaky",
        groupId: ada.groupId,
        access: ApiTokenAccess.READ,
        expiresInDays: 30,
      }),
    })
    expect(intoAda.status).toBe(404)
    const revoke = await app.app.request(`${API}/tokens/${adas.id}`, {
      method: "DELETE",
      headers: browser(bob.cookie),
    })
    expect(revoke.status).toBe(404)
    expect((await listNotes(app, ada.groupId, adas.secret)).status).toBe(200)
  })
})

Deno.test("create and revoke are audited, and use at most once per few minutes", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { id, secret } = await createToken(app, ada)

    for (let i = 0; i < 3; i++) await listNotes(app, ada.groupId, secret)
    const [first] = await sql<{ lastUsedAt: Date }[]>`
      SELECT last_used_at FROM api_tokens WHERE id = ${id}
    `
    expect(first.lastUsedAt.getTime()).toBe(app.clock.now.getTime())

    app.clock.now = new Date(app.clock.now.getTime() + API_TOKEN_USE_RESOLUTION_MS + 1_000)
    await listNotes(app, ada.groupId, secret)
    await app.app.request(`${API}/tokens/${id}`, { method: "DELETE", headers: browser(ada.cookie) })

    expect(await audits(sql, ada.userId)).toEqual([
      AuthAuditEventType.API_TOKEN_CREATED,
      AuthAuditEventType.API_TOKEN_USED,
      AuthAuditEventType.API_TOKEN_USED,
      AuthAuditEventType.API_TOKEN_REVOKED,
    ])
    const [row] = await sql<{ identifier: string; ip: string }[]>`
      SELECT identifier, ip FROM auth_audits
      WHERE event_type = ${AuthAuditEventType.API_TOKEN_USED} LIMIT 1
    `
    expect(row).toEqual({ identifier: id, ip: "198.51.100.7" })
  })
})

/** Sends a create for `groupId` and answers its status, whatever it is. */
async function createStatus(app: App, person: Person, groupId: string): Promise<number> {
  const response = await app.app.request(`${API}/tokens`, {
    method: "POST",
    headers: browser(person.cookie),
    body: JSON.stringify({
      name: "Script",
      groupId,
      access: ApiTokenAccess.READ,
      expiresInDays: 30,
    }),
  })
  await response.body?.cancel()
  return response.status
}

Deno.test("a person holds at most the cap of live tokens, even when creates race", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const statuses = await Promise.all(
      Array.from({ length: API_TOKENS_MAX + 5 }, () => createStatus(app, ada, ada.groupId)),
    )

    expect(statuses.filter((status) => status === 201).length).toBe(API_TOKENS_MAX)
    expect(statuses.filter((status) => status === 409).length).toBe(5)
    const [{ count }] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM api_tokens`
    expect(count).toBe(API_TOKENS_MAX)
  })
})

Deno.test("tokens of a deleted group are neither listed nor counted, and come back with it", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const side = uuidV7()
    await app.groups.create({ id: side, name: "Side project" }, ada.userId)
    for (let i = 0; i < API_TOKENS_MAX; i++) await createToken(app, ada, { groupId: side })
    expect(await createStatus(app, ada, ada.groupId)).toBe(409)

    await sql`UPDATE groups SET deleted_at = now() WHERE id = ${side}`
    const listed = async () => {
      const response = await app.app.request(`${API}/tokens`, { headers: browser(ada.cookie) })
      return ((await response.json()) as { tokens: unknown[] }).tokens.length
    }
    expect(await listed()).toBe(0)
    expect(await createStatus(app, ada, ada.groupId)).toBe(201)

    // Restoring the group brings its tokens back, so the list and the cap still agree.
    await sql`UPDATE groups SET deleted_at = NULL WHERE id = ${side}`
    expect(await listed()).toBe(API_TOKENS_MAX + 1)
    expect(await createStatus(app, ada, ada.groupId)).toBe(409)
  })
})

Deno.test("a password reset revokes every token, and a password change keeps them", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const kept = await createToken(app, ada)

    const change = await app.app.request(`${API}/auth/password/change`, {
      method: "POST",
      headers: browser(ada.cookie),
      body: JSON.stringify({ password: PASSWORD, newPassword: "Changed-Passw0rd" }),
    })
    expect(change.status).toBe(200)
    expect((await listNotes(app, ada.groupId, kept.secret)).status).toBe(200)

    // The change gives this session a new cookie.
    const renewed = change.headers.get("set-cookie")?.split(";")[0] ?? ada.cookie
    const second = await createToken(app, { ...ada, cookie: renewed }, {
      access: ApiTokenAccess.READ,
    })
    const issued = (await issuePasswordReset(app.db.authStore, "ada@example.com", new Date()))!
    expect(await app.signIn.resetPassword("ada@example.com", issued.code, "Reset-Passw0rd")).toBe(
      true,
    )

    expect((await listNotes(app, ada.groupId, kept.secret)).status).toBe(401)
    expect((await listNotes(app, ada.groupId, second.secret)).status).toBe(401)
    const [{ count }] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM api_tokens`
    expect(count).toBe(0)
    const rows = await sql<{ identifier: string }[]>`
      SELECT identifier FROM auth_audits
      WHERE user_id = ${ada.userId} AND event_type = ${AuthAuditEventType.API_TOKEN_REVOKED}
    `
    expect(rows).toEqual([{ identifier: "password-reset" }])
  })
})
