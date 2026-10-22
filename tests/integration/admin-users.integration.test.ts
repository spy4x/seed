/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, GuestEventKind, UserRole } from "@domain/identity"
import { ADMIN_NO_FILTER, type AdminUserFilter } from "@domain/identity"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { AdminActionKind, AdminActOutcome, createAdmin } from "../../apps/api/services/admin.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { USER_ROLE_ACTOR } from "../../apps/worker/user-role.ts"
import { createKvStore } from "@spy4x/platform/rate-limit"
import { createAuthRateLimits } from "../../apps/api/middlewares/auth-rate-limits.ts"
import { readAdminStats } from "@server/auth/admin-stats.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area (#146) against a real Postgres with every migration applied: the user list's
 * search and filters, the role script's lookup, and a block that ends the person's sessions,
 * refuses their password and their API tokens, and writes its audit row.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_users_test_${uuidV7().replaceAll("-", "")}`
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

function buildSignIn(sql: postgres.Sql): SignIn {
  return createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
}

/** The auth limits with an in-process store per limiter, as Valkey keeps them per prefix. */
function memoryRateLimits() {
  return createAuthRateLimits({
    windowMs: 60_000,
    strictLimit: 1_000,
    limit: 1_000,
    otpWindowMs: 900_000,
    otpLimit: 1_000,
    store: () => {
      const entries = new Map<string, unknown>()
      return createKvStore({
        backend: {
          get: (key) => Promise.resolve(entries.get(key)),
          set: (key, value) => Promise.resolve(void entries.set(key, value)),
          delete: (key) => Promise.resolve(void entries.delete(key)),
        },
      })
    },
    onStoreError: () => {},
  })
}

/**
 * The sign-in routes and one operator action, each with a cookie jar of its own per client. The
 * action runs `hooks.meanwhile` between reading the session and acting, when a test sets it: what
 * changes in the database while a request is under way.
 */
function buildApp(sql: postgres.Sql) {
  const signIn = buildSignIn(sql)
  const rateLimits = memoryRateLimits()
  const admin = createAdmin({
    db: new AppDbBase({ sql }),
    pageSize: 2,
    resetByAddress: rateLimits.resetByAddress,
  })
  const hooks: { meanwhile?: (actorId: number) => Promise<unknown> } = {}
  const app = new Hono<APIContext>()
  app.use(signIn.auth.parseAuth)
  app.post("/sign-up", async (c) => {
    const { email } = await c.req.json()
    const result = await signIn.signUp(c, email, PASSWORD)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.post("/sign-in", async (c) => {
    const { login, password } = await c.req.json()
    const result = await signIn.signIn(c, login, password)
    return result ? c.json(result.user) : c.json({ error: "refused" }, 401)
  })
  app.get("/me", signIn.auth.isAuthenticated2FA, (c) => c.json(c.get("auth")!.user))
  app.post("/act/:id/:kind", signIn.auth.isAuthenticated2FA, async (c) => {
    const kind = Number(c.req.param("kind")) as AdminActionKind
    const text = await c.req.text()
    const input = text ? JSON.parse(text) : undefined
    const auth = c.get("auth")!
    await hooks.meanwhile?.(auth.user.id)
    const { outcome } = await admin.act(c, auth, Number(c.req.param("id")), kind, input)
    return c.json({ outcome })
  })
  app.post("/export", signIn.auth.isAuthenticated2FA, async (c) => {
    const batches = await admin.export(c, c.get("auth")!, await c.req.json())
    const emails: (string | null)[][] = []
    for await (const batch of batches) emails.push(batch.map((row) => row.email))
    return c.json(emails)
  })

  /** One browser: its own cookies. */
  function client() {
    const cookies = new Map<string, string>()
    return async (method: string, path: string, body?: unknown): Promise<Response> => {
      const headers = new Headers({ "content-type": "application/json" })
      if (cookies.size) {
        headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "))
      }
      const response = await app.request(`http://local${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      for (const line of response.headers.getSetCookie()) {
        const [pair] = line.split(";")
        const name = pair.slice(0, pair.indexOf("="))
        const value = pair.slice(pair.indexOf("=") + 1)
        if (value === "") cookies.delete(name)
        else cookies.set(name, value)
      }
      return response
    }
  }
  return { client, admin, rateLimits, hooks }
}

/** Signs `email` up in a client of its own and answers that client and the user's id. */
async function signUp(app: ReturnType<typeof buildApp>, email: string) {
  const request = app.client()
  const response = await request("POST", "/sign-up", { email })
  expect(response.status, await response.clone().text()).toBe(200)
  return { request, id: (await response.json()).id as number }
}

async function activeSessions(sql: postgres.Sql, userId: number): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id = ${userId} AND status = 1
  `
  return row.count
}

Deno.test("the user list searches names and addresses and filters by role and block", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const grace = await signUp(app, "grace@example.com")
    await signUp(app, "linus@example.com")
    await sql`UPDATE users SET first_name = 'Ada', last_name = 'Lovelace' WHERE id = ${ada.id}`
    await sql`UPDATE users SET role = ${UserRole.OPERATOR}, blocked_at = now()
      WHERE id = ${grace.id}`
    const db = new AppDbBase({ sql })

    const names = async (filter = {}) =>
      (await db.admin.list({ ...ADMIN_NO_FILTER, ...filter }, 10)).users.map((user) => user.email)

    expect((await db.admin.list(ADMIN_NO_FILTER, 10)).total).toBe(3)
    expect(await names({ query: "lovelace" })).toEqual(["ada@example.com"])
    expect(await names({ query: "GRACE@" })).toEqual(["grace@example.com"])
    expect(await names({ role: UserRole.OPERATOR })).toEqual(["grace@example.com"])
    expect(await names({ blocked: "blocked" })).toEqual(["grace@example.com"])
    expect((await names({ blocked: "active" })).sort()).toEqual([
      "ada@example.com",
      "linus@example.com",
    ])
    // A search character that LIKE treats as a wildcard matches only itself.
    expect(await names({ query: "%" })).toEqual([])

    const second = await app.admin.list({ ...ADMIN_NO_FILTER, page: 2 })
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 })
    expect(second.users.length).toBe(1)
  })
})

Deno.test("the user list sorts on the server by any column, ties kept in one order by id", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const grace = await signUp(app, "grace@example.com")
    const linus = await signUp(app, "linus@example.com")
    await sql`UPDATE users SET first_name = 'Ada', last_name = 'Lovelace',
      last_seen_at = now() - interval '1 day' WHERE id = ${ada.id}`
    await sql`UPDATE users SET first_name = 'grace', last_name = 'Hopper', last_seen_at = NULL
      WHERE id = ${grace.id}`
    await sql`UPDATE users SET last_seen_at = now() - interval '2 days' WHERE id = ${linus.id}`
    const db = new AppDbBase({ sql })
    const order = async (sort: AdminUserFilter["sort"]) =>
      (await db.admin.list({ ...ADMIN_NO_FILTER, sort }, 10)).users.map((user) => user.id)

    // Linus has no name, so he sorts first; the case of a name does not change its place.
    expect(await order([{ key: "name", direction: "asc" }])).toEqual([linus.id, ada.id, grace.id])
    expect(await order([{ key: "name", direction: "desc" }])).toEqual([grace.id, ada.id, linus.id])
    // Never seen goes last, whichever way.
    expect(await order([{ key: "lastSeenAt", direction: "desc" }])).toEqual([
      ada.id,
      linus.id,
      grace.id,
    ])
    expect(await order([{ key: "lastSeenAt", direction: "asc" }])).toEqual([
      linus.id,
      ada.id,
      grace.id,
    ])
    expect(await order([])).toEqual([linus.id, grace.id, ada.id])
    // Everyone has the same role: the id decides, in the rule's direction.
    expect(await order([{ key: "role", direction: "asc" }])).toEqual([ada.id, grace.id, linus.id])
    expect(await order([{ key: "role", direction: "desc" }])).toEqual([linus.id, grace.id, ada.id])
    // A higher role sorts after the lower ones, and first when the rule is descending.
    await sql`UPDATE users SET role = ${UserRole.OPERATOR} WHERE id = ${grace.id}`
    expect(await order([{ key: "role", direction: "asc" }])).toEqual([ada.id, linus.id, grace.id])
    expect(await order([{ key: "role", direction: "desc" }])).toEqual([grace.id, linus.id, ada.id])
  })
})

Deno.test("the dashboard counts people, sign-ups and activity, and carries no content", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const ada = await signUp(app, "ada@example.com")
    const grace = await signUp(app, "grace@example.com")
    const linus = await signUp(app, "linus@example.com")
    const alan = await signUp(app, "alan@example.com")
    const now = new Date()
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    // Only the rows below count as activity.
    await sql`DELETE FROM auth_audits`
    await sql`DELETE FROM audit_events`
    await sql`UPDATE users SET last_seen_at = NULL, created_at = ${now} WHERE id = ${ada.id}`
    await sql`UPDATE users SET created_at = ${daysAgo(3)}, blocked_at = ${now}
      WHERE id = ${grace.id}`
    await sql`UPDATE users SET created_at = ${daysAgo(10)}, last_seen_at = ${daysAgo(9)}
      WHERE id = ${linus.id}`
    await sql`UPDATE users SET created_at = ${daysAgo(40)}, deleted_at = ${now}
      WHERE id = ${alan.id}`
    await sql`INSERT INTO auth_audits (user_id, event_type, created_at)
      VALUES (${ada.id}, ${AuthAuditEventType.SIGNED_IN}, ${now}),
        (${grace.id}, ${AuthAuditEventType.SIGNED_IN}, ${daysAgo(1)})`
    await sql`UPDATE users SET last_seen_at = NULL WHERE id IN (${ada.id}, ${grace.id})`
    const [before] = await sql<{ groups: number; notes: number }[]>`
      SELECT (SELECT COUNT(*) FROM groups WHERE deleted_at IS NULL)::int AS groups,
        (SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL)::int AS notes
    `
    const groupId = uuidV7()
    await sql`INSERT INTO groups (id, name, owner_user_id) VALUES (${groupId}, 'Plans', ${ada.id})`
    await sql`INSERT INTO notes (id, group_id, title, body, change_sequence, deleted_at)
      VALUES (${uuidV7()}, ${groupId}, 'Secret recipe', 'The sauce is mostly butter', 1, NULL),
        (${uuidV7()}, ${groupId}, 'Gone', 'Deleted text', 2, ${now})`

    const stats = await new AppDbBase({ sql }).admin.stats(now)
    const day = (date: Date) => date.toISOString().slice(0, 10)
    const nonZero = (series: { day: string; count: number }[]) =>
      series.filter((row) => row.count > 0)

    expect(stats).toMatchObject({
      people: 3,
      blocked: 1,
      newThisWeek: { current: 2, previous: 1 },
      activeToday: { current: 1, previous: 1 },
      activeThisWeek: { current: 2, previous: 1 },
      groups: before.groups + 1,
      notes: before.notes + 1,
    })
    expect(stats.signUpsPerDay.length).toBe(30)
    expect(stats.signUpsPerDay.at(-1)!.day).toBe(day(now))
    expect(nonZero(stats.signUpsPerDay)).toEqual([
      { day: day(daysAgo(10)), count: 1 },
      { day: day(daysAgo(3)), count: 1 },
      { day: day(now), count: 1 },
    ])
    expect(nonZero(stats.activePerDay)).toEqual([
      { day: day(daysAgo(9)), count: 1 },
      { day: day(daysAgo(1)), count: 1 },
      { day: day(now), count: 1 },
    ])
    const answer = JSON.stringify(stats)
    for (const text of ["Secret", "butter", "Deleted text", "Plans", "example.com"]) {
      expect(answer).not.toContain(text)
    }
  })
})

Deno.test("the dashboard estimates a large table's live rows from the planner and says so", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    for (const name of ["ada", "grace", "linus", "alan"]) await signUp(app, `${name}@example.com`)
    await sql`UPDATE users SET deleted_at = now() WHERE id IN (
      SELECT id FROM users ORDER BY id LIMIT 1
    )`
    const now = new Date()

    const counted = await readAdminStats(sql, now)
    expect(counted.approximate).toBe(false)
    expect(counted.people).toBe(3)

    // A table never analyzed is counted whatever its size: the planner has no figure for it.
    expect((await readAdminStats(sql, now, { exactBelow: 0 })).approximate).toBe(false)

    // Once analyzed, every table counts as large here: each figure is the planner's.
    await sql`ANALYZE users, groups, notes`
    const estimated = await readAdminStats(sql, now, { exactBelow: 0 })
    expect(estimated.approximate).toBe(true)
    // An ANALYZE of a table this small reads every row: the estimate leaves the deleted one out.
    expect(estimated.people).toBe(3)
    expect(estimated.groups).toBe(counted.groups)
    expect(estimated.notes).toBe(counted.notes)
  })
})

Deno.test("the role script finds a person by the address they sign in with", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id } = await signUp(app, "ops@example.com")
    const db = new AppDbBase({ sql })

    expect(await db.admin.setRoleByAddress("  OPS@example.com ", UserRole.OPERATOR, "test"))
      .toEqual({ id, previous: UserRole.VIEWER })
    expect((await db.admin.find(id))?.role).toBe(UserRole.OPERATOR)
    expect(await db.admin.setRoleByAddress("nobody@example.com", UserRole.ADMIN, "test")).toBe(null)
  })
})

Deno.test("a block ends the person's sessions and refuses their password and API tokens", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, "test")
    const [group] = await sql<{ id: string }[]>`
      SELECT id FROM groups WHERE owner_user_id = ${target.id} LIMIT 1
    `
    const hash = "a".repeat(64)
    await sql`INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access)
      VALUES (${uuidV7()}, ${target.id}, ${group.id}, 'script', ${hash}, 1)`
    expect(await apiTokenRows(sql).find(hash)).not.toBe(null)
    expect((await target.request("GET", "/me")).status).toBe(200)
    expect(await activeSessions(sql, target.id)).toBe(1)

    const blocked = await operator.request("POST", `/act/${target.id}/${AdminActionKind.Block}`)
    expect(await blocked.json()).toEqual({ outcome: AdminActOutcome.Done })

    // The open session is gone, the password no longer signs in and the token acts as nobody.
    expect(await activeSessions(sql, target.id)).toBe(0)
    expect((await target.request("GET", "/me")).status).toBe(401)
    const again = await app.client()("POST", "/sign-in", {
      login: "ada@example.com",
      password: PASSWORD,
    })
    expect(again.status).toBe(401)
    expect(await activeSessions(sql, target.id)).toBe(0)
    expect(await apiTokenRows(sql).find(hash)).toBe(null)

    const audits = await sql<{ eventType: number; identifier: string }[]>`
      SELECT event_type, identifier FROM auth_audits
      WHERE user_id = ${target.id} AND event_type = ${AuthAuditEventType.USER_BLOCKED}
    `
    expect(audits).toEqual([{
      eventType: AuthAuditEventType.USER_BLOCKED,
      identifier: `operator:${operator.id}`,
    }])

    // Unblocked, the same password and the same token work again.
    const unblocked = await operator.request(
      "POST",
      `/act/${target.id}/${AdminActionKind.Unblock}`,
    )
    expect(await unblocked.json()).toEqual({ outcome: AdminActOutcome.Done })
    const back = await app.client()("POST", "/sign-in", {
      login: "ada@example.com",
      password: PASSWORD,
    })
    expect(back.status).toBe(200)
    expect(await apiTokenRows(sql).find(hash)).not.toBe(null)
  })
})

Deno.test("block, unblock and end sessions each write an audit row that names the operator", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "ada@example.com")
    await new AppDbBase({ sql }).admin.setRoleByAddress(
      "ops@example.com",
      UserRole.OPERATOR,
      "test",
    )

    for (
      const kind of [AdminActionKind.Block, AdminActionKind.Unblock, AdminActionKind.EndSessions]
    ) {
      const response = await operator.request("POST", `/act/${target.id}/${kind}`)
      expect(await response.json()).toEqual({ outcome: AdminActOutcome.Done })
    }

    const audits = await sql<{ eventType: number; identifier: string }[]>`
      SELECT event_type, identifier FROM auth_audits
      WHERE user_id = ${target.id} AND identifier LIKE 'operator:%'
      ORDER BY id
    `
    const identifier = `operator:${operator.id}`
    expect(audits).toEqual([
      { eventType: AuthAuditEventType.USER_BLOCKED, identifier },
      { eventType: AuthAuditEventType.USER_UNBLOCKED, identifier },
      { eventType: AuthAuditEventType.SESSIONS_ENDED, identifier },
    ])
  })
})

Deno.test("an operator acts on no one at or above their own role, nor on themselves", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const peer = await signUp(app, "peer@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, "test")
    await db.admin.setRoleByAddress("peer@example.com", UserRole.OPERATOR, "test")

    const onPeer = await operator.request("POST", `/act/${peer.id}/${AdminActionKind.Block}`)
    expect(await onPeer.json()).toEqual({ outcome: AdminActOutcome.Outranked })
    const onSelf = await operator.request(
      "POST",
      `/act/${operator.id}/${AdminActionKind.EndSessions}`,
    )
    expect(await onSelf.json()).toEqual({ outcome: AdminActOutcome.Self })
    expect((await db.admin.find(peer.id))?.blockedAt).toBe(null)
    expect(await activeSessions(sql, peer.id)).toBe(1)
  })
})

/** The audit rows on `userId` with `eventType`, oldest first. */
async function auditsOf(sql: postgres.Sql, userId: number, eventType: AuthAuditEventType) {
  return await sql<{ identifier: string }[]>`
    SELECT identifier FROM auth_audits
    WHERE user_id = ${userId} AND event_type = ${eventType}
    ORDER BY id
  `.then((rows) => rows.map((row) => row.identifier))
}

Deno.test("an administrator gives a role below their own, with an audit row naming them", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const admin = await signUp(app, "admin@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("admin@example.com", UserRole.ADMIN, "test")
    const changeRole = (role: UserRole) =>
      admin.request("POST", `/act/${target.id}/${AdminActionKind.ChangeRole}`, { role })

    expect(await (await changeRole(UserRole.SUPERVISOR)).json())
      .toEqual({ outcome: AdminActOutcome.Done })
    expect((await db.admin.find(target.id))?.role).toBe(UserRole.SUPERVISOR)
    expect(await (await changeRole(UserRole.SUPERVISOR)).json())
      .toEqual({ outcome: AdminActOutcome.Unchanged })
    // An administrator makes no peer: that stays with the role script.
    expect(await (await changeRole(UserRole.ADMIN)).json())
      .toEqual({ outcome: AdminActOutcome.RoleTooHigh })
    expect((await db.admin.find(target.id))?.role).toBe(UserRole.SUPERVISOR)

    expect(await auditsOf(sql, target.id, AuthAuditEventType.USER_ROLE_CHANGED)).toEqual([
      `operator:${admin.id} from viewer to supervisor`,
    ])
  })
})

Deno.test("only an administrator changes a role, never their own nor a peer's", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const supervisor = await signUp(app, "sup@example.com")
    const admin = await signUp(app, "admin@example.com")
    const peer = await signUp(app, "peer@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("sup@example.com", UserRole.SUPERVISOR, "test")
    await db.admin.setRoleByAddress("admin@example.com", UserRole.ADMIN, "test")
    await db.admin.setRoleByAddress("peer@example.com", UserRole.ADMIN, "test")
    const changeRole = (
      actor: { request: (method: string, path: string, body?: unknown) => Promise<Response> },
      id: number,
      role: UserRole,
    ) => actor.request("POST", `/act/${id}/${AdminActionKind.ChangeRole}`, { role })

    expect(await (await changeRole(supervisor, target.id, UserRole.OPERATOR)).json())
      .toEqual({ outcome: AdminActOutcome.NotAdministrator })
    expect(await (await changeRole(admin, admin.id, UserRole.VIEWER)).json())
      .toEqual({ outcome: AdminActOutcome.Self })
    expect(await (await changeRole(admin, peer.id, UserRole.VIEWER)).json())
      .toEqual({ outcome: AdminActOutcome.Outranked })

    expect((await db.admin.find(target.id))?.role).toBe(UserRole.VIEWER)
    expect((await db.admin.find(admin.id))?.role).toBe(UserRole.ADMIN)
    expect((await db.admin.find(peer.id))?.role).toBe(UserRole.ADMIN)
    for (const id of [target.id, admin.id, peer.id]) {
      // The setup's own rows name "test"; none names an operator.
      const rows = await auditsOf(sql, id, AuthAuditEventType.USER_ROLE_CHANGED)
      expect(rows.filter((row) => row.startsWith("operator:"))).toEqual([])
    }
  })
})

Deno.test("an operator ends one session of a person and leaves the others open", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "ada@example.com")
    const second = app.client()
    const again = await second("POST", "/sign-in", { login: "ada@example.com", password: PASSWORD })
    expect(again.status).toBe(200)
    await new AppDbBase({ sql }).admin.setRoleByAddress(
      "ops@example.com",
      UserRole.OPERATOR,
      "test",
    )
    const [first] = await sql<{ id: number }[]>`
      SELECT id FROM auth_sessions WHERE user_id = ${target.id} AND status = 1 ORDER BY id LIMIT 1
    `
    const endSession = (sessionId: number) =>
      operator.request("POST", `/act/${target.id}/${AdminActionKind.EndSession}`, { sessionId })

    expect(await (await endSession(first.id)).json()).toEqual({ outcome: AdminActOutcome.Done })
    expect((await target.request("GET", "/me")).status).toBe(401)
    expect((await second("GET", "/me")).status).toBe(200)
    expect(await activeSessions(sql, target.id)).toBe(1)

    // Ended already, or someone else's session: nothing to end.
    expect(await (await endSession(first.id)).json())
      .toEqual({ outcome: AdminActOutcome.SessionNotFound })
    const [operatorSession] = await sql<{ id: number }[]>`
      SELECT id FROM auth_sessions WHERE user_id = ${operator.id} AND status = 1 LIMIT 1
    `
    expect(await (await endSession(operatorSession.id)).json())
      .toEqual({ outcome: AdminActOutcome.SessionNotFound })
    expect(await activeSessions(sql, operator.id)).toBe(1)

    expect(await auditsOf(sql, target.id, AuthAuditEventType.SESSIONS_ENDED)).toEqual([
      `operator:${operator.id} session ${first.id}`,
    ])
  })
})

Deno.test("a reset link from the operator area queues the same request as Forgot password", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "Ada@Example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, "test")
    const sendReset = (id: number) =>
      operator.request("POST", `/act/${id}/${AdminActionKind.SendPasswordReset}`)

    expect(await (await sendReset(target.id)).json()).toEqual({ outcome: AdminActOutcome.Done })
    expect(await sql`SELECT email FROM password_reset_requests`).toEqual([
      { email: "ada@example.com" },
    ])
    expect(await auditsOf(sql, target.id, AuthAuditEventType.PASSWORD_RESET_SENT)).toEqual([
      `operator:${operator.id}`,
    ])

    // Without a password that has an address, no link can reach the person.
    await sql`UPDATE auth_keys SET proven_at = NULL, email = NULL WHERE user_id = ${target.id}`
    expect(await (await sendReset(target.id)).json())
      .toEqual({ outcome: AdminActOutcome.NoPassword })
    expect((await sql`SELECT email FROM password_reset_requests`).length).toBe(1)
  })
})

Deno.test("an address gets no more reset links than Forgot password allows, whoever asks", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const supervisor = await signUp(app, "sup@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, "test")
    await db.admin.setRoleByAddress("sup@example.com", UserRole.SUPERVISOR, "test")
    const sendReset = (actor: typeof operator) =>
      actor.request("POST", `/act/${target.id}/${AdminActionKind.SendPasswordReset}`)

    // "Forgot password" spends the address's budget too: twice from the sign-in page here.
    for (let i = 0; i < 2; i++) {
      expect((await app.rateLimits.resetByAddress("ada@example.com")).allowed).toBe(true)
    }
    expect(await (await sendReset(operator)).json()).toEqual({ outcome: AdminActOutcome.Done })
    // The budget is spent: another operator is refused, and so is the sign-in page.
    expect(await (await sendReset(supervisor)).json())
      .toEqual({ outcome: AdminActOutcome.TooManyResets })
    expect(await (await sendReset(operator)).json())
      .toEqual({ outcome: AdminActOutcome.TooManyResets })
    expect((await app.rateLimits.resetByAddress("ada@example.com")).allowed).toBe(false)

    expect((await sql`SELECT email FROM password_reset_requests`).length).toBe(1)
    expect(await auditsOf(sql, target.id, AuthAuditEventType.PASSWORD_RESET_SENT)).toEqual([
      `operator:${operator.id}`,
    ])
  })
})

Deno.test("a reset link is queued only together with its audit row", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, "test")
    // The audit row cannot be written: the queued request must not outlive it.
    await sql.unsafe(`
      CREATE FUNCTION refuse_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'audit refused'; END $$;
      CREATE TRIGGER refuse_reset_audit BEFORE INSERT ON auth_audits FOR EACH ROW
        WHEN (NEW.event_type = ${AuthAuditEventType.PASSWORD_RESET_SENT})
        EXECUTE FUNCTION refuse_reset_audit();
    `)

    const response = await operator.request(
      "POST",
      `/act/${target.id}/${AdminActionKind.SendPasswordReset}`,
    )

    expect(response.status).toBe(500)
    expect(await sql`SELECT email FROM password_reset_requests`).toEqual([])
  })
})

Deno.test("an operator whose role was lowered or who was blocked since the request began acts with what they have now", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const admin = await signUp(app, "admin@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("admin@example.com", UserRole.ADMIN, "test")
    const act = (kind: AdminActionKind, body?: unknown) =>
      admin.request("POST", `/act/${target.id}/${kind}`, body)

    // Lowered to operator after the request read the session.
    app.hooks.meanwhile = (id) => sql`UPDATE users SET role = ${UserRole.OPERATOR} WHERE id = ${id}`
    expect(await (await act(AdminActionKind.ChangeRole, { role: UserRole.SUPERVISOR })).json())
      .toEqual({ outcome: AdminActOutcome.NotAdministrator })
    expect((await db.admin.find(target.id))?.role).toBe(UserRole.VIEWER)

    // Blocked after the request read the session, still an administrator: no action at all.
    await sql`UPDATE users SET role = ${UserRole.ADMIN} WHERE id = ${admin.id}`
    app.hooks.meanwhile = (id) => sql`UPDATE users SET blocked_at = now() WHERE id = ${id}`
    expect(await (await act(AdminActionKind.Block)).json())
      .toEqual({ outcome: AdminActOutcome.Outranked })
    expect((await db.admin.find(target.id))?.blockedAt).toBe(null)

    for (const kind of [AuthAuditEventType.USER_ROLE_CHANGED, AuthAuditEventType.USER_BLOCKED]) {
      const rows = await auditsOf(sql, target.id, kind)
      expect(rows.filter((row) => row.startsWith("operator:"))).toEqual([])
    }
  })
})

Deno.test("the export reads every person the filter matches, across batches, and audits it", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    for (const name of ["ada", "adam", "adele", "linus"]) await signUp(app, `${name}@example.com`)
    await new AppDbBase({ sql }).admin.setRoleByAddress(
      "ops@example.com",
      UserRole.OPERATOR,
      "test",
    )
    const filter = { ...ADMIN_NO_FILTER, query: "ad", page: 2 }

    // The service reads in batches of 500; the database layer is asked for batches of 2 here.
    const response = await operator.request("POST", "/export", filter)
    expect(await response.json()).toEqual([[
      "adele@example.com",
      "adam@example.com",
      "ada@example.com",
    ]])
    const batches: (string | null)[][] = []
    for await (const batch of await new AppDbBase({ sql }).admin.export(filter, 2)) {
      batches.push(batch.map((row) => row.email))
    }
    expect(batches).toEqual([["adele@example.com", "adam@example.com"], ["ada@example.com"]])
    expect(await auditsOf(sql, operator.id, AuthAuditEventType.USERS_EXPORTED)).toEqual([
      `operator:${operator.id} q=ad`,
    ])
  })
})

Deno.test("the role script writes an audit row naming itself, and none when nothing changes", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id } = await signUp(app, "ops@example.com")
    const db = new AppDbBase({ sql })

    expect(await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, USER_ROLE_ACTOR))
      .toEqual({ id, previous: UserRole.VIEWER })
    expect(await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR, USER_ROLE_ACTOR))
      .toEqual({ id, previous: UserRole.OPERATOR })

    expect(await auditsOf(sql, id, AuthAuditEventType.USER_ROLE_CHANGED)).toEqual([
      "cli:user-role from viewer to operator",
    ])
  })
})

Deno.test("an operator deletes a guest account at once, never a full one, with the audit row on the operator", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const guest = await signUp(app, "guest@example.com")
    const full = await signUp(app, "ada@example.com")
    await new AppDbBase({ sql }).admin.setRoleByAddress(
      "ops@example.com",
      UserRole.OPERATOR,
      "test",
    )
    await sql`UPDATE users SET guest_since = now() WHERE id = ${guest.id}`

    const refused = await operator.request("POST", `/act/${full.id}/${AdminActionKind.DeleteGuest}`)
    expect(await refused.json()).toEqual({ outcome: AdminActOutcome.NotGuest })
    const done = await operator.request("POST", `/act/${guest.id}/${AdminActionKind.DeleteGuest}`)
    expect(await done.json()).toEqual({ outcome: AdminActOutcome.Done })

    const left = await sql<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id`
    expect(left.map((row) => row.id)).toEqual([operator.id, full.id].sort((a, b) => a - b))
    const audits = await sql<{ userId: number; eventType: number; identifier: string }[]>`
      SELECT user_id, event_type, identifier FROM auth_audits
      WHERE event_type = ${AuthAuditEventType.GUEST_DELETED_BY_OPERATOR}
    `
    expect(audits).toEqual([{
      userId: operator.id,
      eventType: AuthAuditEventType.GUEST_DELETED_BY_OPERATOR,
      identifier: `user:${guest.id}`,
    }])
  })
})

Deno.test("the user list shows guest accounts or full ones, and marks a guest", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const guest = await signUp(app, "guest@example.com")
    await signUp(app, "ada@example.com")
    await sql`UPDATE users SET guest_since = now() WHERE id = ${guest.id}`
    const db = new AppDbBase({ sql })
    const emails = async (filter: Partial<AdminUserFilter>) =>
      (await db.admin.list({ ...ADMIN_NO_FILTER, ...filter }, 10)).users.map((user) => user.email)

    expect(await emails({ account: "guest" })).toEqual(["guest@example.com"])
    expect(await emails({ account: "full" })).toEqual(["ada@example.com"])
    expect((await emails({})).sort()).toEqual(["ada@example.com", "guest@example.com"])
    const rows = (await db.admin.list(ADMIN_NO_FILTER, 10)).users
    expect(rows.find((row) => row.id === guest.id)!.guestSince).not.toBeNull()
    expect(rows.find((row) => row.id !== guest.id)!.guestSince).toBeNull()
  })
})

Deno.test("the dashboard counts guest accounts started, kept and cleaned up over its days", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    for (const kind of [GuestEventKind.Created, GuestEventKind.Created, GuestEventKind.Kept]) {
      await db.guests.event(kind)
    }
    await db.guests.event(GuestEventKind.CleanedUp)
    // An event older than the dashboard's days is left out.
    await sql`
      INSERT INTO guest_events (id, kind, created_at)
      VALUES (${uuidV7()}, 1, now() - interval '40 days')
    `

    expect((await readAdminStats(sql, new Date())).guests).toEqual({
      created: 2,
      kept: 1,
      cleanedUp: 1,
    })
  })
})
