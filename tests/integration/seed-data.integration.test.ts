/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  DEMO_EMAIL,
  DEMO_GROUP_NAME,
  seed,
  SeedRefusedError,
} from "../../infra/scripts/seed-data.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { SessionStatus } from "@spy4x/server/sign-in"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * `seed()` of `deno task db:seed` against a real Postgres with every migration applied.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"

interface Counts extends postgres.Row {
  authUsers: number
  users: number
  groups: number
  ownerMemberships: number
  activeSessions: number
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `seed_test_${uuidV7().replaceAll("-", "")}`
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

/** Every row the seed may write, counted over the whole schema. */
async function count(sql: postgres.Sql): Promise<Counts> {
  const [row] = await sql<Counts[]>`
    SELECT
      (SELECT COUNT(*)::int FROM auth_users) AS auth_users,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM groups) AS groups,
      (SELECT COUNT(*)::int FROM group_members WHERE role = ${GroupRole.OWNER})
        AS owner_memberships,
      (SELECT COUNT(*)::int FROM auth_sessions WHERE status = ${SessionStatus.Active})
        AS active_sessions
  `
  return row
}

/** Signs in through the API's own sign-in, as `POST /api/auth/password/sign-in` does. */
async function canSignIn(sql: postgres.Sql, login: string, password: string): Promise<boolean> {
  const signIn = createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  let signedIn = false
  let failure: unknown = null
  const app = new Hono().post("/", async (c) => {
    try {
      signedIn = (await signIn.signIn(c, login, password)) !== null
    } catch (error) {
      failure = error
    }
    return c.body(null, 204)
  })
  await app.request("/", { method: "POST" })
  if (failure) throw failure
  return signedIn
}

const EMPTY = { authUsers: 0, users: 0, groups: 0, ownerMemberships: 0, activeSessions: 0 }
const SEEDED = { authUsers: 1, users: 1, groups: 2, ownerMemberships: 2, activeSessions: 0 }

Deno.test("seed creates a demo user who can sign in and owns the demo group", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    expect(await count(sql)).toEqual(EMPTY)

    expect(await seed(db, { pepper: PEPPER, password: PASSWORD })).toBe(true)

    // The user, the first group of every sign-up and the demo group, each owned by the user, and
    // the session that sign-up opened is signed out.
    expect(await count(sql)).toEqual(SEEDED)
    const owned = await sql<{ name: string }[]>`
      SELECT g.name FROM groups g
      JOIN group_members m ON m.group_id = g.id AND m.role = ${GroupRole.OWNER}
      JOIN auth_keys k ON k.user_id = m.user_id AND k.email = ${DEMO_EMAIL}
      WHERE g.owner_user_id = m.user_id
      ORDER BY g.name
    `
    expect(owned.map((row) => row.name)).toEqual([DEMO_GROUP_NAME, "Personal"])
    expect(await canSignIn(sql, DEMO_EMAIL, PASSWORD)).toBe(true)
    expect(await canSignIn(sql, DEMO_EMAIL, `${PASSWORD}x`)).toBe(false)
  })
})

/** The role of the person whose password key names `address`. */
async function roleOf(sql: postgres.Sql, address: string): Promise<number | undefined> {
  const [row] = await sql<{ role: number }[]>`
    SELECT u.role FROM users u JOIN auth_keys k ON k.user_id = u.id AND k.email = ${address}
  `
  return row?.role
}

Deno.test("seed makes the demo user an administrator, and makes them one again on a rerun", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await seed(db, { pepper: PEPPER, password: PASSWORD })
    expect(await roleOf(sql, DEMO_EMAIL)).toBe(UserRole.ADMIN)

    await sql`UPDATE users SET role = ${UserRole.VIEWER}`
    expect(await seed(db, { pepper: PEPPER, password: PASSWORD })).toBe(false)
    expect(await roleOf(sql, DEMO_EMAIL)).toBe(UserRole.ADMIN)
  })
})

Deno.test("seed run again reports that the user exists and writes no other row", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await seed(db, { pepper: PEPPER, password: PASSWORD })

    expect(await seed(db, { pepper: PEPPER, password: PASSWORD })).toBe(false)

    expect(await count(sql)).toEqual(SEEDED)
  })
})

/** When the key that names `address` (the demo user's only key) was proven, or `null`. */
async function provenAt(sql: postgres.Sql, address: string): Promise<Date | null> {
  const [row] = await sql<{ provenAt: Date | null }[]>`
    SELECT proven_at FROM auth_keys WHERE email = ${address}
  `
  return row?.provenAt ?? null
}

Deno.test("seed proves the demo user's address, and proves it again on a rerun", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await seed(db, { pepper: PEPPER, password: PASSWORD })
    expect(await provenAt(sql, DEMO_EMAIL)).not.toBeNull()

    // A demo user seeded before the address was proven by the seed.
    await sql`UPDATE auth_keys SET proven_at = NULL WHERE email = ${DEMO_EMAIL}`
    expect(await seed(db, { pepper: PEPPER, password: PASSWORD })).toBe(false)
    expect(await provenAt(sql, DEMO_EMAIL)).not.toBeNull()
  })
})

Deno.test("seed fails when sign-up refuses a user that does not exist", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    // Longer than the password hasher takes, so sign-up answers `null` as it does for a taken
    // address.
    const refused = "x".repeat(100_000)

    await expect(seed(db, { pepper: PEPPER, password: refused })).rejects.toThrow(SeedRefusedError)

    expect(await count(sql)).toEqual(EMPTY)
  })
})
