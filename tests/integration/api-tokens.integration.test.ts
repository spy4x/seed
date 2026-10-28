/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono, type MiddlewareHandler } from "hono"
import postgres from "postgres"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { createKvStore } from "@spy4x/platform/rate-limit"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import type { OutboxEvent } from "@spy4x/server/outbox"
import { GroupRole } from "@domain/groups"
import { API_TOKENS_MAX, ApiTokenAccess } from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import { NoteCreateCommand, NoteGetQuery, NoteListQuery } from "@domain/notes"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import { createNoteListCursor } from "@server/notes/note-list-cursor.ts"
import { API_TOKEN_USE_RESOLUTION_MS } from "@server/api-tokens/api-tokens.ts"
import { purgeExpiredApiTokens } from "@server/api-tokens/purge-expired-api-tokens.ts"
import { API_TOKEN_CREATED_MAIL_JOB, apiTokenCreatedMailJob } from "@server/jobs/api-token-mail.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { createApiTokens, PASSWORD_NOT_SET_MESSAGE } from "../../apps/api/services/api-tokens.ts"
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
import {
  createTokenRateLimits,
  REFUSAL_AUDIT_WINDOW_MS,
} from "../../apps/api/middlewares/token-rate-limits.ts"
import { issuePasswordReset } from "../../libs/server/auth/password-reset.ts"
import { createTokenApiRoute } from "../../apps/api/routes/token-api.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"
import { checkedError } from "../../apps/api/_testing/api-error.ts"

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
  guestStart: notCalled,
  normal: passThrough,
  resetByAddress: notCalled,
  emailCodeByAddress: notCalled,
  signUpCode: notCalled,
  signInLink: notCalled,
  emailChangeByUser: notCalled,
  emailChangeByAddress: notCalled,
}
const openLockout = {
  begin: () => Promise.resolve(0),
  refund: () => Promise.resolve(),
  fail: () => Promise.resolve(),
}

/** The API as `index.ts` mounts the parts this feature touches, with a clock the test moves. */
/**
 * `countPasswords: false` checks every password without the account's count of wrong ones
 * (#406), for a test that sends more creates at once than the count lets through together.
 */
async function buildApp(sql: postgres.Sql, { countPasswords = true } = {}) {
  const db = new AppDbBase({ sql })
  const clock = { now: new Date(), storeDown: false }
  const signIn = createSignIn({
    db,
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  // The refusal audit's budget in memory, on the test's clock; `storeDown` fails every read.
  const entries = new Map<string, unknown>()
  const limits = createTokenRateLimits({
    windowMs: 60_000,
    limit: 1_000,
    clock: () => clock.now.getTime(),
    store: () =>
      createKvStore({
        backend: {
          get: (key) =>
            clock.storeDown
              ? Promise.reject(new Error("store down"))
              : Promise.resolve(entries.get(key)),
          set: (key, value) => Promise.resolve(void entries.set(key, value)),
          delete: (key) => Promise.resolve(void entries.delete(key)),
        },
      }),
    onStoreError: (error) => {
      throw error
    },
  })
  const logged: string[] = []
  const hooks: { passwordChecked: (() => Promise<void>) | null } = { passwordChecked: null }
  const tokens = createApiTokens({
    db,
    key: TOKEN_KEY,
    checkPassword: async (tx, userId, password) => {
      const valid = (await signIn.hasPassword(userId, tx))
        ? await signIn.verifyPassword(userId, password, tx)
        : null
      // Where a test puts another request between a create's password check and its insert.
      await hooks.passwordChecked?.()
      return valid
    },
    countPasswordCheck: countPasswords
      ? signIn.countPasswordCheck
      : <Right extends boolean | null>(_userId: number, check: () => Promise<Right>) => check(),
    mayAuditRefusal: limits.refusalAudit,
    logError: (message, error) => {
      if (!clock.storeDown) throw new Error(`${message}: ${error}`)
      logged.push(message)
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
      passwordFailures: openLockout,
      requestPasswordReset: () => Promise.resolve(),
      requestSignInLink: () => Promise.resolve(),
      emailCodeFailures: openLockout,
      requestEmailCode: () => Promise.resolve(),
    }),
  )
  app.route(
    "/tokens",
    createApiTokensRoute({
      auth: signIn.auth,
      mutationGuards: createMutationGuards(WEB_APP_URL),
      limit: passThrough,
      passwordLimit: passThrough,
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
      auditRefusal: (c, tokenId, reason) => tokens.auditRefusal(c, tokenId, reason),
    }),
  )
  return { app, clock, groups, sql, db, signIn, logged, hooks }
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
      password: PASSWORD,
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

/** The token audit rows of one kind for `userId`, oldest first: what each names and from where. */
async function auditRows(
  sql: postgres.Sql,
  userId: number,
  eventType: AuthAuditEventType,
): Promise<{ identifier: string; ip: string | null }[]> {
  return [
    ...await sql<{ identifier: string; ip: string | null }[]>`
      SELECT identifier, ip FROM auth_audits
      WHERE user_id = ${userId} AND event_type = ${eventType}
      ORDER BY id
    `,
  ].map(({ identifier, ip }) => ({ identifier, ip }))
}

/** What an audit row says of a token: its id, group, access, the reason if any, then its name. */
function named(
  token: { id: string },
  groupId: string,
  access: "read" | "write",
  reason: string | null,
  name = "Script",
): string {
  return `${token.id} group=${groupId} access=${access}${
    reason ? ` reason=${reason}` : ""
  } name=${name}`
}

/** Adds `userId` to `groupId` as an editor, as an accepted invitation does. */
async function addMember(app: App, groupId: string, userId: number, by: number): Promise<void> {
  await app.sql`
    INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
    VALUES (${groupId}, ${userId}, ${GroupRole.EDITOR}, ${by})
  `
}

/** How many tokens the person's list shows. */
async function listed(app: App, person: Person): Promise<number> {
  const response = await app.app.request(`${API}/tokens`, { headers: browser(person.cookie) })
  return ((await response.json()) as { tokens: unknown[] }).tokens.length
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
    // Neither is in the owner's list any more.
    expect(await listed(app, ada)).toBe(0)
  })
})

Deno.test("a request with a revoked or an expired token is audited for its owner, naming the token", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const revoked = await createToken(app, ada, { name: "Old laptop" })
    const expired = await createToken(app, ada, { name: "Cron", access: ApiTokenAccess.READ })
    await app.app.request(`${API}/tokens/${revoked.id}`, {
      method: "DELETE",
      headers: browser(ada.cookie),
    })
    await sql`UPDATE api_tokens SET expires_at = now() - interval '1 second' WHERE id = ${expired.id}`

    expect((await listNotes(app, ada.groupId, revoked.secret)).status).toBe(401)
    expect((await listNotes(app, ada.groupId, expired.secret)).status).toBe(401)
    // A token nobody has names no owner: it leaves no row.
    expect((await listNotes(app, ada.groupId, "tpl_unknown000000000000000")).status).toBe(401)

    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REFUSED)).toEqual([
      {
        identifier: named(revoked, ada.groupId, "write", "revoked", "Old laptop"),
        ip: "198.51.100.7",
      },
      { identifier: named(expired, ada.groupId, "read", "expired", "Cron"), ip: "198.51.100.7" },
    ])
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM auth_audits
      WHERE event_type = ${AuthAuditEventType.API_TOKEN_REFUSED}
    `
    expect(count).toBe(2)
  })
})

Deno.test("a request refused for scope is audited once per token in five minutes, however many are sent", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const otherGroup = uuidV7()
    await app.groups.create({ id: otherGroup, name: "Side project" }, ada.userId)
    const reader = await createToken(app, ada, { access: ApiTokenAccess.READ })
    const writer = await createToken(app, ada, { name: "Writer" })
    const write = () =>
      app.app.request(`${API}/v1/groups/${ada.groupId}/notes`, {
        method: "POST",
        headers: bearer(reader.secret),
        body: JSON.stringify({ id: uuidV7(), title: "Not allowed", body: "" }),
      })
    const refused = () => auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REFUSED)

    for (let i = 0; i < 20; i++) expect((await write()).status).toBe(403)
    expect(await refused()).toEqual([
      { identifier: named(reader, ada.groupId, "read", "scope"), ip: "198.51.100.7" },
    ])

    // Another token has a budget of its own, and a request that is served leaves no refusal.
    expect((await listNotes(app, otherGroup, writer.secret)).status).toBe(403)
    expect((await listNotes(app, ada.groupId, writer.secret)).status).toBe(200)
    expect((await refused()).map((row) => row.identifier)).toEqual([
      named(reader, ada.groupId, "read", "scope"),
      named(writer, ada.groupId, "write", "scope", "Writer"),
    ])

    app.clock.now = new Date(app.clock.now.getTime() + REFUSAL_AUDIT_WINDOW_MS - 1_000)
    await write()
    expect(await refused()).toHaveLength(2)
    app.clock.now = new Date(app.clock.now.getTime() + 2_000)
    await write()
    await write()
    expect(await refused()).toHaveLength(3)
  })
})

Deno.test("a refusal is still answered, and leaves no audit row, while the limit's store is down", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const reader = await createToken(app, ada, { access: ApiTokenAccess.READ })
    app.clock.storeDown = true

    const response = await app.app.request(`${API}/v1/groups/${ada.groupId}/notes`, {
      method: "POST",
      headers: bearer(reader.secret),
      body: JSON.stringify({ id: uuidV7(), title: "Not allowed", body: "" }),
    })

    expect(response.status).toBe(403)
    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REFUSED)).toEqual([])
    expect(app.logged).toEqual(["error: cannot record that an API token was refused"])
  })
})

Deno.test("creating a token needs the account's password: none, a wrong one and another person's are refused", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    await sql`UPDATE auth_keys SET secret = NULL WHERE user_id = ${bob.userId}`
    const create = async (person: Person, password?: string, says = false) => {
      const response = await app.app.request(`${API}/tokens`, {
        method: "POST",
        headers: browser(person.cookie),
        body: JSON.stringify({
          name: "Script",
          groupId: person.groupId,
          access: ApiTokenAccess.READ,
          expiresInDays: 30,
          ...(password === undefined ? {} : { password }),
        }),
      })
      if (response.ok) return { status: response.status, code: undefined, error: undefined }
      const error = checkedError(await response.json())
      return {
        status: response.status,
        code: error.reason,
        ...(says ? { error: error.message } : {}),
      }
    }

    expect(await create(ada)).toEqual({ status: 400, code: "INVALID_REQUEST" })
    expect(await create(ada, "")).toEqual({ status: 400, code: "INVALID_REQUEST" })
    expect(await create(ada, "Not-the-Passw0rd")).toEqual({ status: 400, code: "PASSWORD_INVALID" })
    // An account with no password has nothing to prove with: it cannot make a token, and is told
    // so instead of being told that a password it never had is wrong.
    expect(await create(bob, PASSWORD, true)).toEqual({
      status: 400,
      code: "PASSWORD_INVALID",
      error: PASSWORD_NOT_SET_MESSAGE,
    })
    expect((await create(ada, "Not-the-Passw0rd", true)).error).toBe("The password is incorrect")

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT (SELECT count(*) FROM api_tokens)::int + (
        SELECT count(*) FROM auth_audits
        WHERE event_type = ${AuthAuditEventType.API_TOKEN_CREATED}
      )::int + (
        SELECT count(*) FROM outbox_events WHERE event_kind = ${API_TOKEN_CREATED_MAIL_JOB}
      )::int AS count
    `
    expect(count).toBe(0)
    expect((await create(ada, PASSWORD)).status).toBe(201)
  })
})

Deno.test("wrong passwords at a token create count on the account's lock, which refuses the right one (#406)", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const create = async (password: string) => {
      const response = await app.app.request(`${API}/tokens`, {
        method: "POST",
        headers: browser(ada.cookie),
        body: JSON.stringify({
          name: "Script",
          groupId: ada.groupId,
          access: ApiTokenAccess.READ,
          expiresInDays: 30,
          password,
        }),
      })
      return {
        status: response.status,
        code: checkedError(await response.json()).reason,
        retryAfter: response.headers.get("retry-after"),
      }
    }

    for (let guess = 0; guess < 6; guess++) {
      expect(await create("Not-the-Passw0rd")).toEqual({
        status: 400,
        code: "PASSWORD_INVALID",
        retryAfter: null,
      })
    }
    expect(await create(PASSWORD)).toEqual({
      status: 429,
      code: "PASSWORD_LOCKED",
      retryAfter: "60",
    })
    expect(await sql`SELECT 1 FROM api_tokens`).toEqual([])
  })
})

Deno.test("creating a token queues one mail to its owner, which names the token and not its secret", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const token = await createToken(app, ada, { name: "Zapier", expiresInDays: null })

    const queued = await sql<{ aggregateId: string }[]>`
      SELECT aggregate_id FROM outbox_events WHERE event_kind = ${API_TOKEN_CREATED_MAIL_JOB}
    `
    expect(queued.map((row) => row.aggregateId)).toEqual([token.id])

    const sent: EmailMessage[] = []
    const logged: string[] = []
    const job = apiTokenCreatedMailJob({
      sql,
      sender: {
        send: (message: EmailMessage) => (
          sent.push(message), Promise.resolve({ ok: true, accepted: [message.to], duplicates: [] })
        ),
      } as unknown as EmailSender,
      brand: { webAppUrl: WEB_APP_URL },
      log: (line) => void logged.push(line),
    })
    const event = { aggregateId: token.id } as OutboxEvent

    // Nobody proved the address yet: nothing is sent to it.
    await job(event)
    expect(sent).toEqual([])
    expect(logged).toEqual([
      "warn: an API token mail was not sent: the account has no proven address",
    ])

    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ada@example.com', ${ada.userId})`
    await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${ada.userId}`
    await job(event)
    expect(sent.map((mail) => mail.to)).toEqual(["ada@example.com"])
    expect(sent[0].text).toContain(`An API token named "\u2068Zapier\u2069" was created`)
    expect(sent[0].text).toContain(
      `It can read and write the group "\u2068Personal\u2069" and never expires.`,
    )
    expect(JSON.stringify(sent)).not.toContain(token.secret)
    expect(JSON.stringify(sent)).not.toContain(token.secret.slice(4))
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
        password: PASSWORD,
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
        password: PASSWORD,
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
    const token = { id }
    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_USED)).toEqual([
      { identifier: named(token, ada.groupId, "write", null), ip: "198.51.100.7" },
      { identifier: named(token, ada.groupId, "write", null), ip: "198.51.100.7" },
    ])
    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_CREATED)).toEqual([
      { identifier: named(token, ada.groupId, "write", null), ip: "203.0.113.42" },
    ])
  })
})

Deno.test("the audit rows still name a token after it is revoked and after its row is purged", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const revoked = await createToken(app, ada, { name: "Old laptop" })
    const expired = await createToken(app, ada, { name: "Cron", access: ApiTokenAccess.READ })
    await listNotes(app, ada.groupId, revoked.secret)
    await app.app.request(`${API}/tokens/${revoked.id}`, {
      method: "DELETE",
      headers: browser(ada.cookie),
    })
    const rows = (type: AuthAuditEventType) => auditRows(sql, ada.userId, type)

    // Revoked: gone from the list, and the row that says so names it.
    expect(await listed(app, ada)).toBe(1)
    expect(await rows(AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      {
        identifier: named(revoked, ada.groupId, "write", "owner", "Old laptop"),
        ip: "203.0.113.42",
      },
    ])

    await sql`
      UPDATE api_tokens SET revoked_at = now() - interval '40 days' WHERE id = ${revoked.id}
    `
    await sql`
      UPDATE api_tokens SET expires_at = now() - interval '40 days' WHERE id = ${expired.id}
    `
    expect(await purgeExpiredApiTokens(sql)).toBe(2)
    const [{ count }] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM api_tokens`
    expect(count).toBe(0)

    // Purged: every row written about either token still says which token it was.
    expect(await rows(AuthAuditEventType.API_TOKENS_PURGED)).toEqual([
      { identifier: named(expired, ada.groupId, "read", null, "Cron"), ip: null },
    ])
    const all = await sql<{ identifier: string }[]>`
      SELECT identifier FROM auth_audits
      WHERE user_id = ${ada.userId} AND event_type BETWEEN ${AuthAuditEventType.API_TOKEN_CREATED}
        AND ${AuthAuditEventType.API_TOKEN_REFUSED}
      ORDER BY id
    `
    expect(all.map((row) => row.identifier)).toEqual([
      named(revoked, ada.groupId, "write", null, "Old laptop"),
      named(expired, ada.groupId, "read", null, "Cron"),
      named(revoked, ada.groupId, "write", null, "Old laptop"),
      named(revoked, ada.groupId, "write", "owner", "Old laptop"),
      named(expired, ada.groupId, "read", null, "Cron"),
    ])
    // No row carries a secret or its hash.
    const dump = JSON.stringify(await sql`SELECT * FROM auth_audits`)
    expect(dump).not.toContain(revoked.secret.slice(4))
    expect(dump).not.toMatch(/[0-9a-f]{64}/)
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
      password: PASSWORD,
    }),
  })
  await response.body?.cancel()
  return response.status
}

Deno.test("a person holds at most the cap of live tokens, even when creates race", async () => {
  await withSchema(async (sql) => {
    // Each check counts as a wrong password until it is found right, so 25 at once would lock
    // the account; the cap is what this test is about.
    const app = await buildApp(sql, { countPasswords: false })
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

Deno.test("deleting a group revokes its tokens for good: restoring the group does not bring them back", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    const side = uuidV7()
    await app.groups.create({ id: side, name: "Side project" }, ada.userId)
    await addMember(app, side, bob.userId, ada.userId)
    const adas = await createToken(app, ada, { groupId: side, name: "Ada's" })
    const bobs = await createToken(app, bob, { groupId: side, name: "Bob's" })
    const elsewhere = await createToken(app, ada)
    for (let i = 2; i < API_TOKENS_MAX; i++) await createToken(app, ada, { groupId: side })
    expect(await createStatus(app, ada, ada.groupId)).toBe(409)

    expect(await app.groups.softDelete(side, ada.userId)).not.toBe(null)
    // The group's tokens no longer count against the cap, and the other group's token works.
    expect(await listed(app, ada)).toBe(1)
    expect(await listed(app, bob)).toBe(0)
    expect((await listNotes(app, ada.groupId, elsewhere.secret)).status).toBe(200)
    expect(await createStatus(app, ada, ada.groupId)).toBe(201)

    expect(await app.groups.restore(side, ada.userId)).not.toBe(null)
    expect((await listNotes(app, side, adas.secret)).status).toBe(401)
    expect((await listNotes(app, side, bobs.secret)).status).toBe(401)
    expect(await listed(app, ada)).toBe(2)
    expect(await listed(app, bob)).toBe(0)
    expect(await auditRows(sql, bob.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      { identifier: named(bobs, side, "write", "group-deleted", "Bob's"), ip: null },
    ])
    expect(
      (await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REVOKED))
        .map((row) => row.identifier),
    ).toContain(named(adas, side, "write", "group-deleted", "Ada's"))
  })
})

Deno.test("a member removed from a group loses their tokens for it, and being added back does not wake them", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    await addMember(app, ada.groupId, bob.userId, ada.userId)
    const inAdas = await createToken(app, bob, { groupId: ada.groupId, name: "In Ada's" })
    const own = await createToken(app, bob, { name: "Own" })
    const adas = await createToken(app, ada)
    expect((await listNotes(app, ada.groupId, inAdas.secret)).status).toBe(200)

    expect(await app.groups.removeMember(ada.groupId, bob.userId, ada.userId)).toBe(true)
    expect((await listNotes(app, ada.groupId, inAdas.secret)).status).toBe(401)

    await addMember(app, ada.groupId, bob.userId, ada.userId)
    expect((await listNotes(app, ada.groupId, inAdas.secret)).status).toBe(401)
    expect(await listed(app, bob)).toBe(1)
    // Their token for another group, and the other members' tokens, are untouched.
    expect((await listNotes(app, bob.groupId, own.secret)).status).toBe(200)
    expect((await listNotes(app, ada.groupId, adas.secret)).status).toBe(200)
    expect(await auditRows(sql, bob.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      { identifier: named(inAdas, ada.groupId, "write", "membership-ended", "In Ada's"), ip: null },
    ])
    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([])
  })
})

Deno.test("a member who leaves a group loses their tokens for it, and rejoining does not wake them", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    await addMember(app, ada.groupId, bob.userId, ada.userId)
    const inAdas = await createToken(app, bob, { groupId: ada.groupId, name: "In Ada's" })
    const own = await createToken(app, bob, { name: "Own" })

    expect(await app.groups.leave(ada.groupId, bob.userId)).toBe(true)
    expect((await listNotes(app, ada.groupId, inAdas.secret)).status).toBe(401)

    await addMember(app, ada.groupId, bob.userId, ada.userId)
    expect((await listNotes(app, ada.groupId, inAdas.secret)).status).toBe(401)
    expect((await listNotes(app, bob.groupId, own.secret)).status).toBe(200)
    expect(await auditRows(sql, bob.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      { identifier: named(inAdas, ada.groupId, "write", "membership-ended", "In Ada's"), ip: null },
    ])
  })
})

Deno.test("a group or an account deleted for good takes its tokens' rows with it", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    const side = uuidV7()
    await app.groups.create({ id: side, name: "Side project" }, ada.userId)
    await createToken(app, ada, { groupId: side })
    await createToken(app, bob)
    const count = async () =>
      (await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM api_tokens`)[0].count
    expect(await count()).toBe(2)

    await sql`DELETE FROM groups WHERE id = ${side}`
    expect(await count()).toBe(1)
    await sql`DELETE FROM groups WHERE owner_user_id = ${bob.userId}`
    await sql`DELETE FROM auth_users WHERE id = ${bob.userId}`
    expect(await count()).toBe(0)
  })
})

Deno.test("a password change and a password reset each revoke every token of the person, and say which", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    const first = await createToken(app, ada, { name: "First" })
    const other = await createToken(app, ada, { name: "Other", access: ApiTokenAccess.READ })
    const bobs = await createToken(app, bob)

    const refusedChange = await app.app.request(`${API}/auth/password/change`, {
      method: "POST",
      headers: browser(ada.cookie),
      body: JSON.stringify({ password: "Not-the-Passw0rd", newPassword: "Changed-Passw0rd" }),
    })
    expect(refusedChange.status).not.toBe(200)
    expect((await listNotes(app, ada.groupId, first.secret)).status).toBe(200)

    // Keeping the other devices signed in does not keep the tokens.
    const change = await app.app.request(`${API}/auth/password/change`, {
      method: "POST",
      headers: browser(ada.cookie),
      body: JSON.stringify({
        password: PASSWORD,
        newPassword: "Changed-Passw0rd",
        signOutOthers: false,
      }),
    })
    expect(change.status).toBe(200)
    expect(await change.json()).toEqual({ success: true, revokedTokens: 2 })
    expect((await listNotes(app, ada.groupId, first.secret)).status).toBe(401)
    expect((await listNotes(app, ada.groupId, other.secret)).status).toBe(401)
    expect((await listNotes(app, bob.groupId, bobs.secret)).status).toBe(200)
    // One statement writes both rows, in no promised order; token ids sort by when they were made.
    const byChange = await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REVOKED)
    expect(byChange.toSorted((a, b) => a.identifier.localeCompare(b.identifier))).toEqual([
      {
        identifier: named(first, ada.groupId, "write", "password-change", "First"),
        ip: "203.0.113.42",
      },
      {
        identifier: named(other, ada.groupId, "read", "password-change", "Other"),
        ip: "203.0.113.42",
      },
    ])

    // The change gives this session a new cookie; a token now needs the new password.
    const renewed = {
      ...ada,
      cookie: change.headers.get("set-cookie")?.split(";")[0] ?? ada.cookie,
    }
    expect(await listed(app, renewed)).toBe(0)
    const second = await createToken(app, renewed, { name: "Second", password: "Changed-Passw0rd" })
    const issued = (await issuePasswordReset(app.db.authStore, "ada@example.com", new Date()))!
    expect(await app.signIn.resetPassword("ada@example.com", issued.code, "Reset-Passw0rd")).toBe(
      true,
    )

    expect((await listNotes(app, ada.groupId, second.secret)).status).toBe(401)
    expect((await listNotes(app, bob.groupId, bobs.secret)).status).toBe(200)
    expect(
      (await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REVOKED))
        .filter((row) => !byChange.some((earlier) => earlier.identifier === row.identifier)),
    ).toEqual([
      { identifier: named(second, ada.groupId, "write", "password-reset", "Second"), ip: null },
    ])
  })
})

/** Changes the person's password on the profile page's route. */
function changePassword(app: App, person: Person, body: Record<string, unknown>) {
  return app.app.request(`${API}/auth/password/change`, {
    method: "POST",
    headers: browser(person.cookie),
    body: JSON.stringify({ password: PASSWORD, newPassword: "Changed-Passw0rd", ...body }),
  })
}

Deno.test("a password change that signs the other devices out, the page's default, revokes every token", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { secret } = await createToken(app, ada)

    // No `signOutOthers`: what the page sends unless the person unticks the box.
    const change = await changePassword(app, ada, {})
    expect(change.status).toBe(200)
    expect(await change.json()).toEqual({ success: true, revokedTokens: 1 })
    expect((await listNotes(app, ada.groupId, secret)).status).toBe(401)
  })
})

Deno.test("a password change or reset whose token revoke fails changes nothing: the old password still works", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const { secret } = await createToken(app, ada)
    // The revoke writes an audit row of type 10 in the same statement: this makes it fail.
    await sql`
      ALTER TABLE auth_audits ADD CONSTRAINT no_revoke_row
      CHECK (event_type <> ${sql.unsafe(String(AuthAuditEventType.API_TOKEN_REVOKED))}) NOT VALID
    `
    const unchanged = async () => {
      expect(await app.signIn.checkPassword(ada.userId, PASSWORD)).toBe(true)
      expect(await app.signIn.checkPassword(ada.userId, "Changed-Passw0rd")).toBe(false)
      expect((await listNotes(app, ada.groupId, secret)).status).toBe(200)
      // The session the change would have replaced is still the person's.
      expect(await listed(app, ada)).toBe(1)
    }

    for (const body of [{}, { signOutOthers: false }]) {
      const change = await changePassword(app, ada, body)
      await change.body?.cancel()
      expect(change.status).toBe(500)
      expect(change.headers.get("set-cookie")).toBe(null)
      await unchanged()
    }

    const issued = (await issuePasswordReset(app.db.authStore, "ada@example.com", new Date()))!
    await expect(app.signIn.resetPassword("ada@example.com", issued.code, "Changed-Passw0rd"))
      .rejects.toThrow("no_revoke_row")
    await unchanged()

    // With the revoke working again, the same change goes through and ends the token.
    await sql`ALTER TABLE auth_audits DROP CONSTRAINT no_revoke_row`
    expect((await changePassword(app, ada, {})).status).toBe(200)
    expect((await listNotes(app, ada.groupId, secret)).status).toBe(401)
  })
})

/**
 * Runs `other` between a token create's password check and its insert, waits for both and
 * answers the create's status and the new token's secret. `other` gets a moment to finish first:
 * when nothing makes it wait for the create, it does.
 */
async function createDuring(
  app: App,
  person: Person,
  other: () => Promise<unknown>,
): Promise<{ status: number; secret: string | null }> {
  let running: Promise<unknown> = Promise.resolve()
  app.hooks.passwordChecked = async () => {
    app.hooks.passwordChecked = null
    running = other()
    let timer: ReturnType<typeof setTimeout> | undefined
    const moment = new Promise((resolve) => (timer = setTimeout(resolve, 1_000)))
    await Promise.race([running, moment])
    clearTimeout(timer)
  }
  const response = await app.app.request(`${API}/tokens`, {
    method: "POST",
    headers: browser(person.cookie),
    body: JSON.stringify({
      name: "Raced",
      groupId: person.groupId,
      access: ApiTokenAccess.READ,
      expiresInDays: 30,
      password: PASSWORD,
    }),
  })
  await running
  const body = (await response.json()) as { secret?: string }
  return { status: response.status, secret: body.secret ?? null }
}

/** How many of the person's tokens could still act. */
async function liveTokens(sql: postgres.Sql, userId: number): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM api_tokens
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `
  return count
}

Deno.test("a token created with the old password while the password changes does not outlive the change", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")

    // The change is called past the session middleware, which locks the person's row for a moment
    // on every signed-in request, and keeps the other devices signed in, so it writes no session
    // row either: both would wait for the create anyway, and this test is about the lock the
    // change takes on purpose.
    const direct = new Hono().post("/", async (c) =>
      c.json(
        await app.signIn.changePassword(
          c,
          { user: { id: ada.userId } } as never,
          PASSWORD,
          "Changed-Passw0rd",
          false,
        ),
      ))
    let change: Response | undefined
    const raced = await createDuring(app, ada, async () => {
      change = await direct.request("/", { method: "POST" })
    })

    // The create held the person's row, so the change waited for it and revoked its token.
    expect(raced.status).toBe(201)
    expect(await change?.json()).toEqual({ revokedTokens: 1 })
    expect((await listNotes(app, ada.groupId, raced.secret!)).status).toBe(401)
    expect(await liveTokens(sql, ada.userId)).toBe(0)
  })
})

Deno.test("a token created with the old password while the password is reset does not outlive the reset", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    // A proven address, so the reset writes nothing to the person's row: such a write would wait
    // for the create anyway, and this test is about the lock the reset takes on purpose.
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('ada@example.com', ${ada.userId})`
    await sql`UPDATE auth_keys SET proven_at = now() WHERE user_id = ${ada.userId}`
    const issued = (await issuePasswordReset(app.db.authStore, "ada@example.com", new Date()))!

    let reset: boolean | undefined
    const raced = await createDuring(app, ada, async () => {
      reset = await app.signIn.resetPassword("ada@example.com", issued.code, "Reset-Passw0rd")
    })

    expect(raced.status).toBe(201)
    expect(reset).toBe(true)
    expect((await listNotes(app, ada.groupId, raced.secret!)).status).toBe(401)
    expect(await liveTokens(sql, ada.userId)).toBe(0)
  })
})

Deno.test("a create that starts after a password change has the old password refused", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const change = await changePassword(app, ada, { signOutOthers: false })
    await change.body?.cancel()

    expect(await createStatus(app, ada, ada.groupId)).toBe(400)
    expect(await liveTokens(sql, ada.userId)).toBe(0)
  })
})

Deno.test("a revoked token no longer counts against the cap: the person can create another", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const tokens = []
    for (let index = 0; index < API_TOKENS_MAX; index += 1) {
      tokens.push(await createToken(app, ada, { name: `Script ${index}` }))
    }
    expect(await createStatus(app, ada, ada.groupId)).toBe(409)

    const revoke = await app.app.request(`${API}/tokens/${tokens[0].id}`, {
      method: "DELETE",
      headers: browser(ada.cookie),
    })
    await revoke.body?.cancel()
    expect(revoke.status).toBe(200)

    expect(await createStatus(app, ada, ada.groupId)).toBe(201)
    expect(await createStatus(app, ada, ada.groupId)).toBe(409)
  })
})

Deno.test("the migration ends the tokens the old code left asleep: a removed member's and a trashed group's, each with its audit row", async () => {
  await withSchema(async (sql) => {
    const app = await buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const bob = await signUp(app, "bob@example.com")
    const side = uuidV7()
    await app.groups.create({ id: side, name: "Side project" }, ada.userId)
    await addMember(app, ada.groupId, bob.userId, ada.userId)
    const kept = await createToken(app, ada)
    const trashed = await createToken(app, ada, { name: "Trashed", groupId: side })
    const removed = await createToken(app, bob, {
      name: "Removed",
      groupId: ada.groupId,
      access: ApiTokenAccess.READ,
    })
    const bobsOwn = await createToken(app, bob)

    // The state the old code left: the membership row gone and the group in the trash, with both
    // token rows untouched, in a table that has no `revoked_at` yet.
    await sql`DELETE FROM group_members WHERE group_id = ${ada.groupId} AND user_id = ${bob.userId}`
    await sql`UPDATE groups SET deleted_at = now() WHERE id = ${side}`
    await sql`ALTER TABLE api_tokens DROP COLUMN revoked_at`
    await sql.unsafe(
      await Deno.readTextFile(`${MIGRATIONS_DIR}/2026_10_30_0001_api_token_hardening.sql`),
    )

    // What used to wake them: the person is added back and the group is restored.
    await addMember(app, ada.groupId, bob.userId, ada.userId)
    await sql`UPDATE groups SET deleted_at = NULL WHERE id = ${side}`
    expect((await listNotes(app, ada.groupId, removed.secret)).status).toBe(401)
    expect((await listNotes(app, side, trashed.secret)).status).toBe(401)
    expect((await listNotes(app, ada.groupId, kept.secret)).status).toBe(200)
    expect((await listNotes(app, bob.groupId, bobsOwn.secret)).status).toBe(200)

    expect(await auditRows(sql, bob.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      { identifier: named(removed, ada.groupId, "read", "membership-ended", "Removed"), ip: null },
    ])
    expect(await auditRows(sql, ada.userId, AuthAuditEventType.API_TOKEN_REVOKED)).toEqual([
      { identifier: named(trashed, side, "write", "group-deleted", "Trashed"), ip: null },
    ])
  })
})
