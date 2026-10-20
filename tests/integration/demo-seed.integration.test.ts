/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type Context, Hono } from "hono"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { WELCOME_NOTE_TITLE } from "@server/jobs/starter-data.ts"
import { readOnboarding } from "@server/auth/onboarding.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { DEV_SUBSCRIBERS_SECRET } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import { FAKE_COUNTS, fakeDemoData, fakeWorkspace } from "../../apps/worker/demo/fake-data.ts"
import {
  type DemoSeedOptions,
  seedDemo,
  SeedRefusedError,
  seedWorkspace,
} from "../../apps/worker/demo/seed.ts"
import { KEPT_TABLES, wipeDatabase } from "../../apps/worker/demo/wipe.ts"
import { isDemoSeeded, resetDemo } from "../../apps/worker/demo/run.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { SessionStatus } from "@spy4x/server/sign-in"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The public demo's seed, sample groups, wipe and reset (docs/demo.md) against a real Postgres with every
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
  adminPassword: null,
  dataSeed: 7,
  subscribers: SUBSCRIBERS,
}
/** What `deno task db:seed` passes in development: the administrator too. */
const DEV_OPTIONS: DemoSeedOptions = { ...OPTIONS, adminPassword: PASSWORD }
/** A day whose fake data the reset picks: the demo's date there is 2026-10-20. */
const DAY = new Date("2026-10-20T12:00:00Z")

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

/** Runs `run` inside a request to the API's own sign-in, as its routes do. */
async function inRequest<T>(
  sql: postgres.Sql,
  run: (signIn: ReturnType<typeof createSignIn>, c: Context) => Promise<T>,
): Promise<T> {
  const signIn = createSignIn({
    db: new AppDbBase({ sql }),
    pepper: PEPPER,
    cookieSecret: COOKIE_SECRET,
    secureCookie: false,
    sessionMinutes: 60,
    totpIssuer: "example.test",
  })
  let result: T | undefined
  let failure: unknown = null
  const app = new Hono().post("/", async (c) => {
    try {
      result = await run(signIn, c)
    } catch (error) {
      failure = error
    }
    return c.body(null, 204)
  })
  await app.request("/", { method: "POST" })
  if (failure) throw failure
  return result as T
}

/** Signs in through the API's own sign-in, as `POST /api/auth/password/check` does. */
async function canSignIn(sql: postgres.Sql, login: string, password: string): Promise<boolean> {
  return await inRequest(
    sql,
    async (signIn, c) => (await signIn.signIn(c, login, password)) !== null,
  )
}

/** Signs a visitor up through the API's own sign-up, which queues their starter data. */
async function signUpVisitor(sql: postgres.Sql, email: string): Promise<number> {
  const user = await inRequest(sql, (signIn, c) => signIn.signUp(c, email, PASSWORD))
  if (!user) throw new Error(`sign-up refused ${email}`)
  return user.user.id
}

/** Runs the worker's queued jobs once, with the demo's sample groups on, as the worker does. */
async function drainJobs(sql: postgres.Sql, dataSeed = OPTIONS.dataSeed): Promise<void> {
  const db = new AppDbBase({ sql })
  const mail = {
    store: createPostgresAuthStore(sql),
    sender: null,
    brand: { webAppUrl: "http://app.localhost" },
    log: () => {},
  }
  const processor = createOutboxProcessor(
    sql,
    mail,
    null,
    null,
    0,
    true,
    (userId) => seedWorkspace(db, sql, userId, dataSeed),
  )
  // One batch at a time, until every queued job ran: the population queues theirs too.
  for (;;) {
    const result = await processor.drainOnce()
    expect(result.failed).toBe(0)
    if (result.claimed === 0) return
  }
}

/** What a visitor holds: their groups by name and role, their notes, tags and invitations. */
async function workspaceOf(sql: postgres.Sql, userId: number) {
  const groups = await sql<{ name: string; role: number; notes: number; tags: number }[]>`
    SELECT g.name, m.role,
      (SELECT COUNT(*)::int FROM notes n WHERE n.group_id = g.id) AS notes,
      (SELECT COUNT(*)::int FROM tags t WHERE t.group_id = g.id) AS tags
    FROM group_members m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ${userId}
    ORDER BY g.created_at, g.id
  `
  const [selected] = await sql<{ name: string }[]>`
    SELECT g.name FROM user_settings s JOIN groups g ON g.id = s.selected_group_id
    WHERE s.user_id = ${userId}
  `
  return { groups, selected: selected?.name ?? null }
}

/** The role, proven time and second factor of the person whose password key names `address`. */
async function accountOf(sql: postgres.Sql, address: string) {
  const [row] = await sql<{ role: number; provenAt: Date | null; mfa: number }[]>`
    SELECT u.role, k.proven_at, u.mfa FROM users u
    JOIN auth_keys k ON k.user_id = u.id AND k.email = ${address}
  `
  return row
}

Deno.test("the public demo's seed creates no administrator and no session", async () => {
  await withSchema(async (sql) => {
    expect(await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)).toBe(true)

    // The public demo has no administrator: its password would be public.
    expect(await sql`SELECT 1 FROM auth_keys WHERE email = ${DEV_ADMIN_EMAIL}`).toHaveLength(0)
    expect(await sql`SELECT 1 FROM users WHERE role >= ${UserRole.OPERATOR}`).toHaveLength(0)
    expect((await count(sql)).activeSessions).toBe(0)
  })
})

Deno.test("the development seed adds an administrator", async () => {
  await withSchema(async (sql) => {
    expect(await seedDemo(new AppDbBase({ sql }), sql, DEV_OPTIONS)).toBe(true)

    expect(await canSignIn(sql, DEV_ADMIN_EMAIL, PASSWORD)).toBe(true)
    expect(await canSignIn(sql, DEV_ADMIN_EMAIL, `${PASSWORD}x`)).toBe(false)
    const account = await accountOf(sql, DEV_ADMIN_EMAIL)
    expect(account.provenAt).not.toBeNull()
    expect(account.mfa).toBe(1)
    expect(account.role).toBe(UserRole.ADMIN)
  })
})

Deno.test("the demo seed fills the database with the fake data", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const data = fakeDemoData(OPTIONS.dataSeed)
    const people = FAKE_COUNTS.users

    const counts = await count(sql)
    // Every person's first group, plus the themed groups.
    expect(counts.users).toBe(people)
    expect(counts.groups).toBe(people + data.groups.length)
    expect(counts.members).toBe(
      people + data.groups.reduce((sum, group) => sum + 1 + group.members.length, 0),
    )
    expect(counts.notes).toBe(data.groups.reduce((sum, group) => sum + group.notes.length, 0))
    expect(counts.tags).toBe(data.groups.reduce((sum, group) => sum + group.tags.length, 0))
    expect(counts.invitations).toBe(
      data.groups.reduce((sum, group) => sum + group.invitations.length, 0),
    )
    expect(counts.subscribers).toBe(FAKE_COUNTS.subscribers)
    expect(counts.activeSessions).toBe(0)
  })
})

Deno.test("the demo seed run again writes nothing but the administrator's role", async () => {
  await withSchema(async (sql) => {
    const db = new AppDbBase({ sql })
    await seedDemo(db, sql, DEV_OPTIONS)
    const seeded = await count(sql)
    await sql`UPDATE users SET role = ${UserRole.VIEWER}`
    await sql`UPDATE auth_keys SET proven_at = NULL WHERE email = ${DEV_ADMIN_EMAIL}`

    expect(await seedDemo(db, sql, DEV_OPTIONS)).toBe(false)

    expect(await count(sql)).toEqual(seeded)
    const admin = await accountOf(sql, DEV_ADMIN_EMAIL)
    expect(admin.role).toBe(UserRole.ADMIN)
    expect(admin.provenAt).not.toBeNull()
  })
})

Deno.test("a visitor who signs up to the demo gets sample groups once and opens the busy one", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const userId = await signUpVisitor(sql, "visitor@example.net")
    await drainJobs(sql)

    const sample = fakeWorkspace(OPTIONS.dataSeed)
    const owned = sample.find((group) => group.owner === "you")!
    const workspace = await workspaceOf(sql, userId)
    expect(workspace.groups).toEqual([
      // Their own first group, with the welcome note, then the sample groups.
      { name: "Personal", role: GroupRole.OWNER, notes: 1, tags: 0 },
      ...sample.map((group) => ({
        name: group.name,
        role: group.owner === "you"
          ? GroupRole.OWNER
          : group.members.find((m) => m.member === "you")!.role,
        notes: group.notes.length,
        tags: group.tags.length,
      })),
    ])
    expect(workspace.selected).toBe(owned.name)
    // The population's jobs ran too, and gave the fake people no sample groups.
    const population = FAKE_COUNTS.users + fakeDemoData(OPTIONS.dataSeed).groups.length
    expect((await count(sql)).groups).toBe(population + 1 + sample.length)
    // The sample groups' members are the population's fake people.
    const [{ members }] = await sql<{ members: number }[]>`
      SELECT COUNT(*)::int AS members FROM group_members m
      WHERE m.group_id IN (SELECT group_id FROM group_members WHERE user_id = ${userId})
        AND m.user_id <> ${userId}
    `
    // Everyone in the sample groups, owners included, but the visitor.
    const everyone = sample.reduce((sum, group) => sum + 1 + group.members.length, 0)
    expect(members).toBe(everyone - sample.length)
    const [{ invitations }] = await sql<{ invitations: number }[]>`
      SELECT COUNT(*)::int AS invitations FROM group_invitations i
      JOIN groups g ON g.id = i.group_id AND g.owner_user_id = ${userId}
    `
    expect(invitations).toBe(owned.invitations.length)
    // Someone else wrote the sample content, so the checklist starts unticked.
    const onboarding = await readOnboarding(sql, userId)
    expect(onboarding?.steps.noteCreated).toBe(false)
    expect(onboarding?.steps.memberInvited).toBe(false)
    const welcome = await sql`
      SELECT 1 FROM notes WHERE title = ${WELCOME_NOTE_TITLE} AND created_by_user_id = ${userId}
    `
    expect(welcome).toHaveLength(1)

    // A retried job and a second sign-in add nothing.
    const before = await count(sql)
    await sql`UPDATE starter_data_requests SET done_at = NULL`
    await sql`UPDATE outbox_events SET processed_at = NULL, available_at = now()`
    await drainJobs(sql)
    expect(await canSignIn(sql, "visitor@example.net", PASSWORD)).toBe(true)
    await drainJobs(sql)
    expect({ ...await count(sql), activeSessions: 0 }).toEqual({ ...before, activeSessions: 0 })
  })
})

Deno.test("a visitor still gets the group they own when the population is of another day", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const userId = await signUpVisitor(sql, "late@example.net")
    // The sample groups of the next day's seed: none of its fake people have accounts.
    await drainJobs(sql, OPTIONS.dataSeed + 1)

    const owned = fakeWorkspace(OPTIONS.dataSeed + 1).find((group) => group.owner === "you")!
    const workspace = await workspaceOf(sql, userId)
    expect(workspace.groups.map((group) => group.name)).toEqual(["Personal", owned.name])
    expect(workspace.selected).toBe(owned.name)
  })
})

Deno.test("the demo seed fails when sign-up refuses an account that does not exist", async () => {
  await withSchema(async (sql) => {
    // Longer than the password hasher takes, so sign-up answers `null` as for a taken address.
    const refused = { ...OPTIONS, adminPassword: "x".repeat(100_000) }

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

Deno.test("an operator account left in the demo makes the worker seed it again", async () => {
  await withSchema(async (sql) => {
    // What a development seed of the same day leaves: the population and an administrator.
    await seedDemo(new AppDbBase({ sql }), sql, { ...DEV_OPTIONS, dataSeed: 20261020 })
    expect(await isDemoSeeded(sql, DAY)).toBe(false)

    await resetDemo(sql, { subscribers: SUBSCRIBERS }, DAY)
    expect(await isDemoSeeded(sql, DAY)).toBe(true)
    expect(await sql`SELECT 1 FROM auth_keys WHERE email = ${DEV_ADMIN_EMAIL}`).toHaveLength(0)
  })
})

Deno.test("the reset wipes, seeds again and schedules the nightly cleanup", async () => {
  await withSchema(async (sql) => {
    expect(await isDemoSeeded(sql, DAY)).toBe(false)
    await resetDemo(sql, { subscribers: SUBSCRIBERS }, DAY)
    const first = await count(sql)
    expect(await isDemoSeeded(sql, DAY)).toBe(true)
    // The next day's population is not there yet, so a start then seeds at once.
    expect(await isDemoSeeded(sql, new Date("2026-10-21T12:00:00Z"))).toBe(false)
    expect(await sql`SELECT 1 FROM users WHERE role >= ${UserRole.OPERATOR}`).toHaveLength(0)

    await signUpVisitor(sql, "visitor@example.net")
    await resetDemo(sql, { subscribers: SUBSCRIBERS }, DAY)

    expect(await count(sql)).toEqual(first)
    const cleanup = await sql`SELECT 1 FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}`
    expect(cleanup.length).toBe(1)
  })
})
