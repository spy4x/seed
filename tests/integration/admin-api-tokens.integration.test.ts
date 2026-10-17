/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, UserRole } from "@domain/identity"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import type { AppAuthState } from "../../apps/api/services/sign-in.ts"
import type { PushDevicesUpdatedEvent } from "../../apps/api/cqrs/events.ts"
import type { APIContext } from "../../apps/api/_types.ts"
import {
  createAdminApiTokens,
  createAdminApiTokensRoutes,
} from "../../apps/api/routes/admin/api-tokens.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's API tokens, push devices and notifications (#427) against a real Postgres
 * with every migration applied, through the module's own routes: what each list shows, that no
 * answer carries a token's hash, a device's endpoint or keys or a notification's payload, and that
 * a revoke and a removal change the row and write an audit row naming the operator.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const NOW = new Date("2026-10-16T09:00:00.000Z")

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_api_tokens_test_${uuidV7().replaceAll("-", "")}`
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

/** A person with a group of their own, as sign-up would leave them. */
async function person(
  sql: postgres.Sql,
  email: string,
  role = UserRole.VIEWER,
): Promise<{ id: number; groupId: string; role: UserRole }> {
  const [user] = await sql<{ id: number }[]>`INSERT INTO auth_users DEFAULT VALUES RETURNING id`
  await sql`INSERT INTO users (id, first_name, last_name, role)
    VALUES (${user.id}, ${email.split("@")[0]}, '', ${role})`
  await sql`INSERT INTO auth_keys (user_id, method, subject, email)
    VALUES (${user.id}, 'password', ${email}, ${email})`
  const groupId = uuidV7()
  await sql`INSERT INTO groups (id, name, owner_user_id) VALUES (${groupId}, 'Home', ${user.id})`
  return { id: user.id, groupId, role }
}

/** A token row with the hash `hash`, created `minutesAgo` before {@link NOW}. */
async function tokenOf(
  sql: postgres.Sql,
  owner: { id: number; groupId: string },
  hash: string,
  { minutesAgo = 0, expiresAt = null as Date | null, revoked = false } = {},
): Promise<string> {
  const id = uuidV7()
  await sql`INSERT INTO api_tokens
      (id, user_id, group_id, name, token_hash, access, created_at, expires_at, revoked_at)
    VALUES (${id}, ${owner.id}, ${owner.groupId}, ${`token ${hash[0]}`}, ${hash}, 2,
      ${new Date(NOW.getTime() - minutesAgo * 60_000)}, ${expiresAt}, ${revoked ? NOW : null})`
  return id
}

/** The module's routes over `sql`, acting as `actor`, with every event they emit recorded. */
function buildApp(sql: postgres.Sql, actor: { id: number; role: UserRole }) {
  const emitted: PushDevicesUpdatedEvent[] = []
  const app = new Hono<APIContext>()
  app.use(async (c, next) => {
    c.set("auth", { user: actor } as unknown as AppAuthState)
    await next()
  })
  app.route(
    "/",
    createAdminApiTokensRoutes({
      limit: async (_c, next) => await next(),
      emit: (event) => emitted.push(event),
      service: createAdminApiTokens({ db: new AppDbBase({ sql }), now: () => NOW }),
    }),
  )
  const call = async (method: string, path: string) => {
    const response = await app.request(`http://admin.local${path}`, {
      method,
      headers: { "x-forwarded-for": "203.0.113.9" },
    })
    return { status: response.status, text: await response.text() }
  }
  return { call, emitted }
}

async function auditsOf(sql: postgres.Sql, userId: number, eventType: AuthAuditEventType) {
  return await sql<{ identifier: string; ip: string | null }[]>`
    SELECT identifier, ip FROM auth_audits WHERE user_id = ${userId} AND event_type = ${eventType}
    ORDER BY id
  `
}

Deno.test("the token list shows every live person's tokens by state with counts, never a hash", async () => {
  await withSchema(async (sql) => {
    const ops = await person(sql, "ops@example.com", UserRole.OPERATOR)
    const ada = await person(sql, "ada@example.com")
    const gone = await person(sql, "gone@example.com")
    const live = await tokenOf(sql, ada, "a".repeat(64), { minutesAgo: 1 })
    const expired = await tokenOf(sql, ada, "b".repeat(64), {
      minutesAgo: 2,
      expiresAt: new Date(NOW.getTime() - 1),
    })
    const revoked = await tokenOf(sql, ada, "c".repeat(64), { minutesAgo: 3, revoked: true })
    const later = await tokenOf(sql, ops, "d".repeat(64), {
      minutesAgo: 4,
      expiresAt: new Date(NOW.getTime() + 60_000),
    })
    await tokenOf(sql, gone, "e".repeat(64))
    await sql`UPDATE users SET deleted_at = now() WHERE id = ${gone.id}`
    const { call } = buildApp(sql, ops)

    const all = await call("GET", "/api-tokens")
    expect(all.status).toBe(200)
    const body = JSON.parse(all.text)
    // Newest first; the deleted person's token is not listed.
    expect(body.tokens.map((token: { id: string }) => token.id)).toEqual([
      live,
      expired,
      revoked,
      later,
    ])
    expect(body.tokens.map((token: { state: string }) => token.state)).toEqual([
      "live",
      "expired",
      "revoked",
      "live",
    ])
    expect(body).toMatchObject({
      total: 4,
      page: 1,
      pageSize: 25,
      counts: { live: 2, expired: 1, revoked: 1 },
    })
    expect(body.tokens[0]).toEqual({
      id: live,
      name: "token a",
      groupId: ada.groupId,
      groupName: "Home",
      access: 2,
      state: "live",
      createdAt: new Date(NOW.getTime() - 60_000).toISOString(),
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      owner: { id: ada.id, firstName: "ada", lastName: "", email: "ada@example.com" },
    })
    for (const letter of "abcde") expect(all.text).not.toContain(letter.repeat(64))
    expect(all.text).not.toMatch(/hash|secret/i)

    const onlyLive = JSON.parse((await call("GET", "/api-tokens?state=live")).text)
    expect(onlyLive.tokens.map((token: { id: string }) => token.id)).toEqual([live, later])
    expect(onlyLive.total).toBe(2)
    const onlyRevoked = JSON.parse((await call("GET", "/api-tokens?state=revoked")).text)
    expect(onlyRevoked.tokens.map((token: { id: string }) => token.id)).toEqual([revoked])

    const mine = JSON.parse((await call("GET", `/users/${ada.id}/api-tokens`)).text)
    expect(mine.tokens.map((token: { id: string }) => token.id)).toEqual([live, expired, revoked])
    expect((await call("GET", `/users/${gone.id}/api-tokens`)).status).toBe(404)
  })
})

Deno.test("an operator's revoke ends the token and audits it; their own or a peer's is refused", async () => {
  await withSchema(async (sql) => {
    const ops = await person(sql, "ops@example.com", UserRole.OPERATOR)
    const peer = await person(sql, "peer@example.com", UserRole.OPERATOR)
    const ada = await person(sql, "ada@example.com")
    const hash = "a".repeat(64)
    const token = await tokenOf(sql, ada, hash)
    const own = await tokenOf(sql, ops, "b".repeat(64))
    const peers = await tokenOf(sql, peer, "c".repeat(64))
    const { call } = buildApp(sql, ops)

    expect(await apiTokenRows(sql).find(hash)).toMatchObject({ refused: null })
    expect((await call("POST", `/api-tokens/${token}/revoke`)).status).toBe(200)

    expect(await apiTokenRows(sql).find(hash)).toMatchObject({ refused: "revoked" })
    const audits = await auditsOf(sql, ada.id, AuthAuditEventType.API_TOKEN_REVOKED)
    expect(audits).toEqual([{
      identifier:
        `${token} group=${ada.groupId} access=write reason=operator:${ops.id} name=token a`,
      ip: "203.0.113.9",
    }])

    expect((await call("POST", `/api-tokens/${token}/revoke`)).status).toBe(409)
    expect((await call("POST", `/api-tokens/${own}/revoke`)).status).toBe(403)
    expect((await call("POST", `/api-tokens/${peers}/revoke`)).status).toBe(403)
    expect((await call("POST", `/api-tokens/${uuidV7()}/revoke`)).status).toBe(404)
    const [{ live }] = await sql<{ live: number }[]>`
      SELECT count(*)::int AS live FROM api_tokens WHERE revoked_at IS NULL
    `
    expect(live).toBe(2)
    expect(await auditsOf(sql, ada.id, AuthAuditEventType.API_TOKEN_REVOKED)).toHaveLength(1)
  })
})

Deno.test("a person's devices carry no endpoint or keys; a removal deletes one, audits it and spares a role at or above the operator's", async () => {
  await withSchema(async (sql) => {
    const ops = await person(sql, "ops@example.com", UserRole.OPERATOR)
    const ada = await person(sql, "ada@example.com")
    const grace = await person(sql, "grace@example.com")
    const insert = async (userId: number, deviceId: string) => {
      const [row] = await sql<{ id: number }[]>`
        INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
        VALUES (${userId}, ${deviceId}, 'https://push.example.com/capability-path',
          'auth-key-value', 'p256dh-key-value')
        RETURNING id
      `
      return row.id
    }
    const phone = await insert(ada.id, "device-0000-phone123")
    const laptop = await insert(ada.id, "device-0000-laptop12")
    const graces = await insert(grace.id, "device-0000-grace123")
    const { call, emitted } = buildApp(sql, ops)

    const listed = await call("GET", `/users/${ada.id}/devices`)
    expect(listed.status).toBe(200)
    const { devices } = JSON.parse(listed.text)
    expect(devices.map((device: { id: number }) => device.id).sort()).toEqual(
      [phone, laptop].sort(),
    )
    expect(devices.find((device: { id: number }) => device.id === phone).label).toBe("phone123")
    for (const secret of ["capability-path", "auth-key-value", "p256dh-key-value", "device-0000"]) {
      expect(listed.text).not.toContain(secret)
    }

    expect((await call("POST", `/users/${ada.id}/devices/${phone}/remove`)).status).toBe(200)
    const left = JSON.parse((await call("GET", `/users/${ada.id}/devices`)).text).devices
    expect(left.map((device: { id: number }) => device.id)).toEqual([laptop])
    expect(await auditsOf(sql, ada.id, AuthAuditEventType.PUSH_DEVICE_REMOVED)).toEqual([
      { identifier: `operator:${ops.id} device=${phone}`, ip: "203.0.113.9" },
    ])
    expect(emitted.map((event) => [event.data.userId, event.data.devices.map((d) => d.id)]))
      .toEqual([[ada.id, [laptop]]])

    // Removed already, or another person's device named under Ada: the same 404, nothing changes.
    expect((await call("POST", `/users/${ada.id}/devices/${phone}/remove`)).status).toBe(404)
    expect((await call("POST", `/users/${ada.id}/devices/${graces}/remove`)).status).toBe(404)
    const [{ live }] = await sql<{ live: number }[]>`
      SELECT count(*)::int AS live FROM user_push_tokens WHERE user_id = ${grace.id}
        AND deleted_at IS NULL
    `
    expect(live).toBe(1)
    expect(await auditsOf(sql, ada.id, AuthAuditEventType.PUSH_DEVICE_REMOVED)).toHaveLength(1)
    expect(emitted).toHaveLength(1)

    // The operator's own device is not theirs to remove here.
    const mine = await insert(ops.id, "device-0000-myphone1")
    expect((await call("POST", `/users/${ops.id}/devices/${mine}/remove`)).status).toBe(403)

    // Nor a peer's, nor a supervisor's: a role at or above their own.
    for (const role of [UserRole.OPERATOR, UserRole.SUPERVISOR]) {
      const above = await person(sql, `role-${role}@example.com`, role)
      const theirs = await insert(above.id, `device-0000-role${role}xxx`)
      expect((await call("POST", `/users/${above.id}/devices/${theirs}/remove`)).status).toBe(403)
      const [{ live }] = await sql<{ live: number }[]>`
        SELECT count(*)::int AS live FROM user_push_tokens WHERE id = ${theirs}
          AND deleted_at IS NULL
      `
      expect(live).toBe(1)
      expect(await auditsOf(sql, above.id, AuthAuditEventType.PUSH_DEVICE_REMOVED)).toEqual([])
    }
    expect(emitted).toHaveLength(1)
  })
})

Deno.test("a person's notifications show kind and read state with counts, never the payload", async () => {
  await withSchema(async (sql) => {
    const ops = await person(sql, "ops@example.com", UserRole.OPERATOR)
    const ada = await person(sql, "ada@example.com")
    const ids: string[] = []
    for (const [kind, read] of [["invitation.received", true], ["group.removed", false]] as const) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO notifications (user_id, kind, payload, link, read_at)
        VALUES (${ada.id}, ${kind}, ${sql.json({ groupName: "Secret Garden" })}, '/groups',
          ${read ? NOW : null})
        RETURNING id::text AS id
      `
      ids.push(row.id)
    }
    const { call } = buildApp(sql, ops)

    const answer = await call("GET", `/users/${ada.id}/notifications`)
    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.text)).toEqual({
      notifications: [
        { id: ids[1], kind: "group.removed", createdAt: expect.any(String), readAt: null },
        {
          id: ids[0],
          kind: "invitation.received",
          createdAt: expect.any(String),
          readAt: NOW.toISOString(),
        },
      ],
      total: 2,
      unread: 1,
    })
    expect(answer.text).not.toContain("Secret Garden")
    expect((await call("GET", `/users/999999/notifications`)).status).toBe(404)
  })
})
