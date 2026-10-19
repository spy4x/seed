/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import postgres from "postgres"
import { UserRole } from "@domain/identity"
import { DEMO_ADMIN_EMAIL, DEMO_USER_EMAIL } from "@server/auth/demo-accounts.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { DEV_SUBSCRIBERS_SECRET } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { FAKE_COUNTS, fakeDemoData } from "../../apps/worker/demo/fake-data.ts"
import { type DemoSeedOptions, seedDemo, SeedRefusedError } from "../../apps/worker/demo/seed.ts"
import { KEPT_TABLES, wipeDatabase } from "../../apps/worker/demo/wipe.ts"
import { isDemoSeeded, resetDemo } from "../../apps/worker/demo/run.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { SessionStatus } from "@spy4x/server/sign-in"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The public demo's seed, wipe and reset (docs/demo.md) against a real Postgres with every
 * migration applied, plus the migration history table the runner keeps in a migrated database.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"
// Test-only secrets, long enough for the package's 32-character minimum.
const PEPPER = "integration-test-only-pepper-0123456789"
const COOKIE_SECRET = "integration-test-only-cookie-secret-0123456789"
const PASSWORD = "Passw0rd!"
const SUBSCRIBERS = { secret: DEV_SUBSCRIBERS_SECRET, previousSecrets: [] }
const OPTIONS: DemoSeedOptions = {
  pepper: PEPPER,
  password: PASSWORD,
  dataSeed: 7,
  subscribers: SUBSCRIBERS,
}

/** Runs `body` against a fresh schema with every migration applied, and drops the schema after. */
async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `demo_test_${uuidV7().replaceAll("-", "")}`
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
    // What the migration runner keeps in a migrated database; the wipe must leave it alone.
    await sql`CREATE TABLE migrations (name text PRIMARY KEY)`
    await sql`INSERT INTO migrations ${sql(names.map((name) => ({ name })))}`
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

interface Counts extends postgres.Row {
  users: number
  groups: number
  members: number
  notes: number
  tags: number
  invitations: number
  subscribers: number
  activeSessions: number
}

async function count(sql: postgres.Sql): Promise<Counts> {
  const [row] = await sql<Counts[]>`
    SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM groups) AS groups,
      (SELECT COUNT(*)::int FROM group_members) AS members,
      (SELECT COUNT(*)::int FROM notes) AS notes,
      (SELECT COUNT(*)::int FROM tags) AS tags,
      (SELECT COUNT(*)::int FROM group_invitations) AS invitations,
      (SELECT COUNT(*)::int FROM subscribers) AS subscribers,
      (SELECT COUNT(*)::int FROM auth_sessions WHERE status = ${SessionStatus.Active})
        AS active_sessions
  `
  return row
}

/** Signs in through the API's own sign-in, as `POST /api/auth/password/check` does. */
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

/** The role, proven time and second factor of the person whose password key names `address`. */
async function accountOf(sql: postgres.Sql, address: string) {
  const [row] = await sql<{ role: number; provenAt: Date | null; mfa: number }[]>`
    SELECT u.role, k.proven_at, u.mfa FROM users u
    JOIN auth_keys k ON k.user_id = u.id AND k.email = ${address}
  `
  return row
}

Deno.test("the demo seed creates two shared accounts that sign in with no second factor", async () => {
  await withSchema(async (sql) => {
    expect(await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)).toBe(true)

    for (const address of [DEMO_USER_EMAIL, DEMO_ADMIN_EMAIL]) {
      expect(await canSignIn(sql, address, PASSWORD)).toBe(true)
      expect(await canSignIn(sql, address, `${PASSWORD}x`)).toBe(false)
      const account = await accountOf(sql, address)
      expect(account.provenAt).not.toBeNull()
      expect(account.mfa).toBe(1)
    }
    expect((await accountOf(sql, DEMO_USER_EMAIL)).role).toBe(UserRole.VIEWER)
    expect((await accountOf(sql, DEMO_ADMIN_EMAIL)).role).toBe(UserRole.ADMIN)
  })
})

Deno.test("the demo seed fills the database with the fake data", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const data = fakeDemoData(OPTIONS.dataSeed)
    const people = FAKE_COUNTS.users + 2

    const counts = await count(sql)
    // Every person's first group, plus the themed groups.
    expect(counts.users).toBe(people)
    expect(counts.groups).toBe(people + data.groups.length)
    expect(counts.notes).toBe(data.groups.reduce((sum, group) => sum + group.notes.length, 0))
    expect(counts.tags).toBe(data.groups.reduce((sum, group) => sum + group.tags.length, 0))
    expect(counts.invitations).toBe(
      data.groups.reduce((sum, group) => sum + group.invitations.length, 0),
    )
    expect(counts.subscribers).toBe(FAKE_COUNTS.subscribers)
    expect(counts.activeSessions).toBe(0)
    // The demo user is in three themed groups besides their own.
    const [{ groups }] = await sql<{ groups: number }[]>`
      SELECT COUNT(*)::int AS groups FROM group_members m
      JOIN auth_keys k ON k.user_id = m.user_id AND k.email = ${DEMO_USER_EMAIL}
    `
    expect(groups).toBe(4)
  })
})

Deno.test("the demo seed run again writes nothing but the shared accounts' roles", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await seedDemo(db, sql, OPTIONS)
    const seeded = await count(sql)
    await sql`UPDATE users SET role = ${UserRole.ADMIN}`
    await sql`UPDATE auth_keys SET proven_at = NULL WHERE email = ${DEMO_ADMIN_EMAIL}`

    expect(await seedDemo(db, sql, OPTIONS)).toBe(false)

    expect(await count(sql)).toEqual(seeded)
    expect((await accountOf(sql, DEMO_USER_EMAIL)).role).toBe(UserRole.VIEWER)
    expect((await accountOf(sql, DEMO_ADMIN_EMAIL)).provenAt).not.toBeNull()
  })
})

Deno.test("the demo seed fails when sign-up refuses an account that does not exist", async () => {
  await withSchema(async (sql) => {
    // Longer than the password hasher takes, so sign-up answers `null` as for a taken address.
    const refused = { ...OPTIONS, password: "x".repeat(100_000) }

    await expect(seedDemo(new AppDbBase({ sql }), sql, refused)).rejects.toThrow(SeedRefusedError)

    expect((await count(sql)).users).toBe(0)
  })
})

Deno.test("the wipe empties every table but the kept ones, and never reuses an id", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    await sql`INSERT INTO backup_status (target, succeeded_at) VALUES ('database', now())`
    const [{ before }] = await sql<{ before: number }[]>`SELECT max(id) AS before FROM users`

    const wiped = await wipeDatabase(sql)

    const tables = await sql<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()
    `
    for (const { name } of tables) {
      const [{ rows }] = await sql.unsafe<{ rows: number }[]>(
        `SELECT COUNT(*)::int AS rows FROM "${name}"`,
      )
      if (KEPT_TABLES.includes(name)) {
        expect({ name, kept: rows > 0 }).toEqual({ name, kept: true })
        expect(wiped).not.toContain(name)
      } else {
        expect({ name, rows }).toEqual({ name, rows: 0 })
      }
    }

    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const [{ after }] = await sql<{ after: number }[]>`SELECT min(id) AS after FROM users`
    expect(after).toBeGreaterThan(before)
  })
})

Deno.test("the reset wipes, seeds again and schedules the nightly cleanup", async () => {
  await withSchema(async (sql) => {
    expect(await isDemoSeeded(sql)).toBe(false)
    const { pepper, password, subscribers } = OPTIONS
    await resetDemo(sql, { pepper, password, subscribers })
    const first = await count(sql)
    expect(await isDemoSeeded(sql)).toBe(true)

    await sql`INSERT INTO groups (id, name, owner_user_id)
      SELECT ${uuidV7()}, 'Left by a visitor', id FROM users LIMIT 1`
    await resetDemo(sql, { pepper, password, subscribers })

    expect(await count(sql)).toEqual(first)
    const cleanup = await sql`SELECT 1 FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}`
    expect(cleanup.length).toBe(1)
  })
})
