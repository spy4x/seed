/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, UserRole } from "@domain/identity"
import { ADMIN_NO_FILTER } from "@domain/identity"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn, type SignIn } from "../../apps/api/services/sign-in.ts"
import { AdminActionKind, AdminActOutcome, createAdmin } from "../../apps/api/services/admin.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
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

/** The sign-in routes and one operator action, each with a cookie jar of its own per client. */
function buildApp(sql: postgres.Sql) {
  const signIn = buildSignIn(sql)
  const admin = createAdmin({ db: new AppDbBase({ sql }), pageSize: 2 })
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
    const { outcome } = await admin.act(c, c.get("auth")!, Number(c.req.param("id")), kind)
    return c.json({ outcome })
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
  return { client, admin }
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

Deno.test("the role script finds a person by the address they sign in with", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const { id } = await signUp(app, "ops@example.com")
    const db = new AppDbBase({ sql })

    expect(await db.admin.setRoleByAddress("  OPS@example.com ", UserRole.OPERATOR)).toBe(id)
    expect((await db.admin.find(id))?.role).toBe(UserRole.OPERATOR)
    expect(await db.admin.setRoleByAddress("nobody@example.com", UserRole.ADMIN)).toBe(null)
  })
})

Deno.test("a block ends the person's sessions and refuses their password and API tokens", async () => {
  await withSchema(async (sql) => {
    const app = buildApp(sql)
    const operator = await signUp(app, "ops@example.com")
    const target = await signUp(app, "ada@example.com")
    const db = new AppDbBase({ sql })
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR)
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
    await new AppDbBase({ sql }).admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR)

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
    await db.admin.setRoleByAddress("ops@example.com", UserRole.OPERATOR)
    await db.admin.setRoleByAddress("peer@example.com", UserRole.OPERATOR)

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
