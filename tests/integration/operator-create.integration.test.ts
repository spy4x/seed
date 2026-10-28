/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { AuthAuditEventType, UserRole } from "@domain/identity"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  createOperator,
  databasePorts,
  OperatorCreateOutcome,
} from "../../apps/worker/operator-create.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * `deno task operator:create` (#471) against a real Postgres with every migration applied: the
 * account it creates signs in with the typed password as an administrator, a second run changes
 * nothing, and an existing person is raised with one audit row and their password kept.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "seller-password-1"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `operator_create_test_${uuidV7().replaceAll("-", "")}`
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

/** Signs up or signs in through the API's own sign-in; answers the user or `null`. */
async function viaSignIn(
  sql: postgres.Sql,
  action: "signUp" | "signIn",
  email: string,
  password: string,
): Promise<{ id: number; role: UserRole } | null> {
  const signIn = createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  let user: { id: number; role: UserRole } | null = null
  const app = new Hono().post("/", async (c) => {
    user = (await signIn[action](c, email, password))?.user ?? null
    return c.body(null, 204)
  })
  await app.request("/", { method: "POST" })
  return user
}

async function roleChanges(sql: postgres.Sql, userId: number): Promise<string[]> {
  const rows = await sql<{ identifier: string }[]>`
    SELECT identifier FROM auth_audits
    WHERE user_id = ${userId} AND event_type = ${AuthAuditEventType.USER_ROLE_CHANGED}
    ORDER BY id
  `
  return rows.map((row) => row.identifier)
}

Deno.test("operator:create makes an administrator who signs in with the typed password, and a second run changes nothing", async () => {
  await withSchema(async (sql) => {
    let asked = 0
    const ports = databasePorts(sql, PEPPER, () => {
      asked++
      return Promise.resolve(PASSWORD)
    })

    const first = await createOperator("seller@example.com", ports)
    expect(first).toMatchObject({ outcome: OperatorCreateOutcome.Created })
    const signedIn = await viaSignIn(sql, "signIn", "seller@example.com", PASSWORD)
    expect(signedIn?.role).toBe(UserRole.ADMIN)
    const [key] = await sql<{ provenAt: Date | null; secret: string }[]>`
      SELECT proven_at, secret FROM auth_keys WHERE subject = 'seller@example.com'
    `
    expect(key.provenAt).not.toBe(null)

    const second = await createOperator("seller@example.com", ports)
    expect(second).toEqual({ outcome: OperatorCreateOutcome.Unchanged, id: signedIn!.id })
    expect(asked).toBe(1)
    const [after] = await sql<{ secret: string }[]>`
      SELECT secret FROM auth_keys WHERE subject = 'seller@example.com'
    `
    expect(after.secret).toBe(key.secret)
    expect(await sql`SELECT id FROM users`).toHaveLength(1)
    expect(await roleChanges(sql, signedIn!.id)).toEqual([
      "cli:operator-create from viewer to administrator",
    ])
  })
})

Deno.test("operator:create raises an existing person without asking for or changing their password", async () => {
  await withSchema(async (sql) => {
    const person = await viaSignIn(sql, "signUp", "ops@example.com", PASSWORD)
    const ports = databasePorts(sql, PEPPER, () => Promise.reject(new Error("asked")))

    expect(await createOperator("ops@example.com", ports))
      .toEqual({ outcome: OperatorCreateOutcome.Raised, id: person!.id })
    expect((await viaSignIn(sql, "signIn", "ops@example.com", PASSWORD))?.role)
      .toBe(UserRole.ADMIN)
    expect(await roleChanges(sql, person!.id)).toEqual([
      "cli:operator-create from viewer to administrator",
    ])
  })
})
