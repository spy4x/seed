/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { type Context, Hono } from "hono"
import postgres from "postgres"
import { GroupRole } from "@domain/groups"
import { UserRole } from "@domain/identity"
import { DEV_ADMIN_EMAIL } from "@server/auth/demo-accounts.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { WELCOME_NOTE_TITLE } from "@server/jobs/starter-data.ts"
import { postgresFakePayments } from "@server/billing/fake-payments.ts"
import { readOnboarding } from "@server/auth/onboarding.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { DEV_SUBSCRIBERS_SECRET } from "@server/subscribers/subscribers.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { createSignIn } from "../../apps/api/services/sign-in.ts"
import {
  FAKE_COUNTS,
  FAKE_PASSKEYS,
  fakeDemoData,
  fakePeople,
  fakeWorkspace,
  VIDEO_PERSON_INDEX,
} from "../../apps/worker/demo/fake-data.ts"
import {
  createAdmin,
  type DemoSeedOptions,
  seedDemo,
  SeedRefusedError,
  seedWorkspace,
} from "../../apps/worker/demo/seed.ts"
import { KEPT_TABLES, wipeDatabase } from "../../apps/worker/demo/wipe.ts"
import { SAMPLE_POSTS, seedSamplePosts } from "@server/blog/sample-posts.ts"
import { isDemoSeeded, resetDemo } from "../../apps/worker/demo/run.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { SessionStatus } from "@spy4x/server/sign-in"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { BILLING_AUDIT_EVENTS, BillingStatus } from "@domain/billing"
import { AuthAuditEventType } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { readAdminStats } from "@server/auth/admin-stats.ts"
import {
  listAdminBillingCustomers,
  readAdminBillingFigures,
  readAdminBillingRecord,
} from "@server/billing/admin-billing.ts"
import { readLastBackup } from "@server/jobs/admin-system.ts"
import {
  listAdminNewsletterSends,
  readAdminNewsletterStats,
} from "@server/subscribers/admin-newsletter.ts"

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
/** The moment the seed's history counts back from: now, so the database's own clock agrees. */
const NOW = new Date()
const OPTIONS: DemoSeedOptions = {
  pepper: PEPPER,
  adminPassword: null,
  dataSeed: 7,
  subscribers: SUBSCRIBERS,
  now: NOW,
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
  passkeys: number
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
        AS active_sessions,
      (SELECT COUNT(*)::int FROM auth_passkeys) AS passkeys
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

/** A file store that keeps what the seed puts in a map, by key. Nothing opens a socket. */
function fakeFiles() {
  const stored = new Map<string, string>()
  return {
    stored,
    put: (key: string, bytes: Uint8Array) => {
      stored.set(key, String(bytes.length))
      return Promise.resolve()
    },
  }
}

/** Runs the worker's queued jobs once, with the demo's sample groups on, as the worker does. */
async function drainJobs(
  sql: postgres.Sql,
  dataSeed = OPTIONS.dataSeed,
  files = fakeFiles(),
): Promise<void> {
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
    (userId) => seedWorkspace(db, sql, userId, dataSeed, new Date(), files),
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

Deno.test("the public demo's seed creates no administrator, operator history or backup", async () => {
  await withSchema(async (sql) => {
    expect(await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)).toBe(true)

    // The public demo has no administrator: its password would be public.
    expect(await sql`SELECT 1 FROM auth_keys WHERE email = ${DEV_ADMIN_EMAIL}`).toHaveLength(0)
    expect(await sql`SELECT 1 FROM users WHERE role >= ${UserRole.OPERATOR}`).toHaveLength(0)
    expect(
      await sql`SELECT 1 FROM auth_audits WHERE event_type IN ${
        sql([AuthAuditEventType.USER_BLOCKED, BILLING_AUDIT_EVENTS.paymentRefunded])
      }`,
    ).toHaveLength(0)
    // The server's own backup service records its backups; the demo seed never fakes one.
    expect(await readLastBackup(sql)).toBeNull()
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
    const data = fakeDemoData(OPTIONS.dataSeed, NOW)
    const people = FAKE_COUNTS.users

    const counts = await count(sql)
    // Every person's first group, plus the themed groups.
    expect(counts.users).toBe(people)
    expect(counts.groups).toBe(people + data.groups.length)
    expect(counts.members).toBe(
      people + data.groups.reduce((sum, group) => sum + 1 + group.members.length, 0),
    )
    // Every person's welcome note, dated when they joined, their own notes, and the groups' notes.
    expect(counts.notes).toBe(
      people + data.users.reduce((sum, user) => sum + user.ownNotes.length, 0) +
        data.groups.reduce((sum, group) => sum + group.notes.length, 0),
    )
    const welcomes = await sql<{ late: number }[]>`
      SELECT COUNT(*)::int AS late FROM notes n JOIN users u ON u.id = n.created_by_user_id
      WHERE n.title = ${WELCOME_NOTE_TITLE} AND n.created_at <> u.created_at
    `
    expect(welcomes[0].late).toBe(0)
    expect(counts.tags).toBe(data.groups.reduce((sum, group) => sum + group.tags.length, 0))
    expect(counts.invitations).toBe(
      data.groups.reduce((sum, group) => sum + group.invitations.length, 0),
    )
    // The group the fake data marks imported has the date and a log that starts with the import.
    const imported = await sql<{ name: string; kinds: string[] }[]>`
      SELECT g.name,
        array_agg(a.event_kind)
          FILTER (WHERE a.event_kind IN ('group.created', 'group.imported')) AS kinds
      FROM groups g LEFT JOIN audit_events a ON a.group_id = g.id
      WHERE g.imported_at IS NOT NULL
      GROUP BY g.id
    `
    expect([...imported]).toEqual([{
      name: data.groups.find((group) => group.imported)!.name,
      kinds: [`group.imported`],
    }])
    expect(counts.subscribers).toBe(FAKE_COUNTS.subscribers)
    expect(counts.activeSessions).toBe(
      data.users.reduce((sum, user) => sum + user.sessions.length, 0),
    )
    // Every fake passkey is a key of method `passkey` with its row, linked in the audit trail.
    expect(counts.passkeys).toBe(FAKE_PASSKEYS)
    const passkeyKeys = await sql`
      SELECT 1 FROM auth_keys k JOIN auth_passkeys p ON p.key_id = k.id AND p.user_id = k.user_id
      WHERE k.method = 'passkey' AND k.subject LIKE 'fake-%'
    `
    expect(passkeyKeys).toHaveLength(FAKE_PASSKEYS)
    const linked = await sql`
      SELECT 1 FROM auth_audits WHERE identifier LIKE 'passkey name=%'
        AND event_type = ${AuthAuditEventType.SIGN_IN_METHOD_LINKED}
    `
    expect(linked).toHaveLength(FAKE_PASSKEYS)
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
    const files = fakeFiles()
    await drainJobs(sql, OPTIONS.dataSeed, files)

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
    const population = FAKE_COUNTS.users + fakeDemoData(OPTIONS.dataSeed, NOW).groups.length
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
    // The sample notes' files: stored, and on the notes of the visitor's groups.
    const attached = await sql<{ objectKey: string }[]>`
      SELECT a.object_key FROM note_attachments a JOIN notes n ON n.id = a.note_id
      WHERE n.group_id IN (SELECT group_id FROM group_members WHERE user_id = ${userId})
    `
    const sampleFiles = sample.flatMap((group) => group.notes.flatMap((note) => note.files ?? []))
    expect(sampleFiles.length).toBeGreaterThan(0)
    expect(attached.length).toBe(sampleFiles.length)
    expect([...files.stored.keys()].sort()).toEqual(attached.map((row) => row.objectKey).sort())

    // A retried job and a second sign-in add nothing.
    const before = await count(sql)
    await sql`UPDATE starter_data_requests SET done_at = NULL WHERE user_id = ${userId}`
    await sql`UPDATE outbox_events SET processed_at = NULL, available_at = now()`
    await drainJobs(sql)
    expect(await canSignIn(sql, "visitor@example.net", PASSWORD)).toBe(true)
    await drainJobs(sql)
    expect({ ...await count(sql), activeSessions: 0 }).toEqual({ ...before, activeSessions: 0 })
    const [{ files: after }] = await sql<{ files: number }[]>`
      SELECT COUNT(*)::int AS files FROM note_attachments
    `
    expect(after).toBe(attached.length)
  })
})

Deno.test("a visitor still gets the group they own when the population is of another day", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const userId = await signUpVisitor(sql, "late@example.net")
    // The sample groups of the next day's seed: few of its fake people have accounts today.
    const next = OPTIONS.dataSeed + 1
    await drainJobs(sql, next)

    const sample = fakeWorkspace(next)
    const owned = sample.find((group) => group.owner === "you")!
    // A group whose made-up owner has no account today is left out; the owned one never is.
    const today = new Set(fakePeople(OPTIONS.dataSeed).map((person) => person.email))
    const kept = sample.filter((group) =>
      group.owner === "you" || today.has(fakePeople(next)[group.owner].email)
    )
    expect(kept.length).toBeLessThan(sample.length)
    const workspace = await workspaceOf(sql, userId)
    expect(workspace.groups.map((group) => group.name)).toEqual([
      "Personal",
      ...kept.map((group) => group.name),
    ])
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

Deno.test("the wipe empties every table but the kept ones, keeps the blog, queues every stored file for deletion, and never reuses an id", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    await sql`INSERT INTO backup_status (target, succeeded_at) VALUES ('database', now())`
    const [{ before }] = await sql<{ before: number }[]>`SELECT max(id) AS before FROM users`
    // The website's real posts, by an account the wipe removes.
    await seedSamplePosts(sql, before)
    // A visitor's sample groups, whose files' objects the wipe queues for deletion.
    await signUpVisitor(sql, "wiped@example.net")
    await drainJobs(sql)
    const keys = await sql<{ objectKey: string }[]>`SELECT object_key FROM note_attachments`
    expect(keys.length).toBeGreaterThan(0)
    // A profile picture's object is queued too (#228); the seed gives nobody one.
    const picture = uuidV7()
    await sql`
      UPDATE users SET picture_id = ${picture}, picture_type = 'image/webp'
      WHERE id = (SELECT min(id) FROM users)
    `
    keys.push({ objectKey: `pictures/${picture}` })

    const wiped = await wipeDatabase(sql)
    const queued = await sql<{ objectKey: string }[]>`SELECT object_key FROM file_deletions`
    expect(queued.map((row) => row.objectKey).sort()).toEqual(
      keys.map((row) => row.objectKey).sort(),
    )

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

    const [{ posts }] = await sql<
      { posts: number }[]
    >`SELECT COUNT(*)::int AS posts FROM blog_posts`
    expect(posts).toBe(SAMPLE_POSTS.length)

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

    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: null }, DAY)
    expect(await isDemoSeeded(sql, DAY)).toBe(true)
    expect(await sql`SELECT 1 FROM auth_keys WHERE email = ${DEV_ADMIN_EMAIL}`).toHaveLength(0)
  })
})

Deno.test("the reset wipes, seeds again and schedules the nightly cleanup", async () => {
  await withSchema(async (sql) => {
    expect(await isDemoSeeded(sql, DAY)).toBe(false)
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: null }, DAY)
    const first = await count(sql)
    expect(await isDemoSeeded(sql, DAY)).toBe(true)
    // The next day's population is not there yet, so a start then seeds at once.
    expect(await isDemoSeeded(sql, new Date("2026-10-21T12:00:00Z"))).toBe(false)
    expect(await sql`SELECT 1 FROM users WHERE role >= ${UserRole.OPERATOR}`).toHaveLength(0)

    await signUpVisitor(sql, "visitor@example.net")
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: null }, DAY)

    expect(await count(sql)).toEqual(first)
    const cleanup = await sql`SELECT 1 FROM outbox_events WHERE event_kind = ${OUTBOX_CLEANUP_JOB}`
    expect(cleanup.length).toBe(1)
  })
})

/** The owner's private administrator on the demo, as the worker reads it from the env. */
const DEMO_ADMIN = { pepper: PEPPER, password: PASSWORD }

Deno.test("the reset seeds the private administrator, who signs in with the API's pepper", async () => {
  await withSchema(async (sql) => {
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: DEMO_ADMIN }, DAY)

    expect(await canSignIn(sql, DEV_ADMIN_EMAIL, PASSWORD)).toBe(true)
    const account = await accountOf(sql, DEV_ADMIN_EMAIL)
    expect(account.role).toBe(UserRole.ADMIN)
    expect(account.provenAt).not.toBeNull()
    // The only operator, so the worker keeps the demo; without the setting it is a leaked one.
    expect(await sql`SELECT 1 FROM users WHERE role >= ${UserRole.OPERATOR}`).toHaveLength(1)
    expect(await isDemoSeeded(sql, DAY, true)).toBe(true)
    expect(await isDemoSeeded(sql, DAY, false)).toBe(false)
    // No operator history or fake backup: the admin panel shows the demo as it is.
    expect(
      await sql`SELECT 1 FROM auth_audits WHERE event_type = ${AuthAuditEventType.USER_BLOCKED}`,
    ).toHaveLength(0)
    expect(await readLastBackup(sql)).toBeNull()

    // The next reset wipes it and makes it again, with the same password.
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: DEMO_ADMIN }, DAY)
    expect(await canSignIn(sql, DEV_ADMIN_EMAIL, PASSWORD)).toBe(true)
  })
})

Deno.test("with the private administrator, any other operator still makes the worker seed again", async () => {
  await withSchema(async (sql) => {
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: DEMO_ADMIN }, DAY)
    await signUpVisitor(sql, "visitor@example.net")
    await new AppDbBase({ sql }).admin.setRoleByAddress(
      "visitor@example.net",
      UserRole.OPERATOR,
      "test",
    )

    expect(await isDemoSeeded(sql, DAY, true)).toBe(false)
  })
})

Deno.test("a demo without the private administrator is seeded again once it is configured", async () => {
  await withSchema(async (sql) => {
    await resetDemo(sql, { subscribers: SUBSCRIBERS, admin: null }, DAY)

    expect(await isDemoSeeded(sql, DAY, false)).toBe(true)
    expect(await isDemoSeeded(sql, DAY, true)).toBe(false)
  })
})

Deno.test("the private administrator is never made from an account a visitor holds", async () => {
  await withSchema(async (sql) => {
    await signUpVisitor(sql, DEV_ADMIN_EMAIL)
    const db = new AppDbBase({ sql })

    await expect(createAdmin(db, sql, PEPPER, `${PASSWORD}x`)).rejects.toThrow(SeedRefusedError)
    expect((await accountOf(sql, DEV_ADMIN_EMAIL)).role).toBe(UserRole.VIEWER)
  })
})

Deno.test("the demo seed's history fills the admin panel's screens", async (t) => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)

    await t.step(
      "the seed spreads sign-ups and activity over the dashboard's 30 days",
      async () => {
        const stats = await readAdminStats(sql, NOW)
        expect(stats.people).toBe(FAKE_COUNTS.users)
        // Not everyone joined today: sign-ups fall on most days, and only some in the window.
        const signUpDays = stats.signUpsPerDay.filter((day) => day.count > 0)
        expect(signUpDays.length).toBeGreaterThanOrEqual(15)
        const signUps = stats.signUpsPerDay.reduce((sum, day) => sum + day.count, 0)
        expect(signUps).toBeLessThan(FAKE_COUNTS.users * 0.75)
        // Someone is active every past day, and today is no spike of the whole population. Today
        // is the UTC day so far: empty just after midnight, about a full day's activity late.
        expect(stats.activePerDay.slice(0, -1).every((day) => day.count > 0)).toBe(true)
        expect(stats.activeToday.current).toBeLessThan(FAKE_COUNTS.users * 0.75)
        expect(stats.blocked).toBe(2)
      },
    )

    await t.step(
      "the seed's billing has paying customers, one past due, one cancelled and trials",
      async () => {
        const figures = await readAdminBillingFigures(sql, NOW)
        expect(figures.paying).toBe(7)
        expect(figures.pastDue).toBe(1)
        expect(figures.trials).toBe(2)
        expect(figures.ending).toBe(1)
        expect(figures.monthlyRevenue).toHaveLength(1)
        expect(figures.monthlyRevenue[0].amount).toBeGreaterThan(0)
        expect(figures.lastEventAt).not.toBeNull()
        const cancelled = await listAdminBillingCustomers(
          sql,
          { query: "", status: "cancelled", page: 1 },
          25,
        )
        expect(cancelled.total).toBe(1)
        // Every provider id is marked as fake.
        const ids = await sql<{ id: string }[]>`
        SELECT provider_subscription_id AS id FROM subscriptions
        UNION ALL SELECT provider_customer_id FROM billing_customers
        UNION ALL SELECT id FROM billing_events
      `
        expect(ids.every(({ id }) => /^(sub|cus|evt)_fake[0-9a-f]+$/.test(id))).toBe(true)
      },
    )

    await t.step("the newsletter grows over time and has three sent issues", async () => {
      const stats = await readAdminNewsletterStats(sql, DEFAULT_SUBSCRIBER_LIST, NOW)
      expect(stats.confirmed).toBe(FAKE_COUNTS.subscribers)
      expect(stats.issues).toBe(3)
      const sizes = stats.subscribersPerDay.map((day) => day.count)
      expect(sizes[0]).toBeLessThan(sizes[sizes.length - 1])
      const sends = await listAdminNewsletterSends(sql, DEFAULT_SUBSCRIBER_LIST, 10)
      expect(sends).toHaveLength(3)
      for (const send of sends) {
        expect(send.completedAt).not.toBeNull()
        expect(send.sent).toBeGreaterThan(0)
      }
      // Older issues went to fewer people.
      expect(sends[0].recipients!).toBeGreaterThan(sends[2].recipients!)
    })

    await t.step(
      "the video's person has two sessions: Firefox on Windows and Safari on iPhone",
      async () => {
        const claire = fakeDemoData(OPTIONS.dataSeed, NOW).users[VIDEO_PERSON_INDEX]

        const sessions = await sql<{ deviceName: string }[]>`
        SELECT s.device_name FROM auth_sessions s
        JOIN auth_keys k ON k.user_id = s.user_id AND k.subject = ${claire.email}
        WHERE s.status = ${SessionStatus.Active}
        ORDER BY s.device_name
      `
        expect(claire.email).toBe("claire.hartley@example.com")
        expect(sessions.map((s) => s.deviceName)).toEqual([
          "Firefox on Windows",
          "Safari on iPhone",
        ])
      },
    )
  })
})

/**
 * How many rows have an earlier time than the row with the id before theirs: in `audit_events`
 * within each group, whose feeds sort by id, and in `auth_audits` across the table.
 */
async function outOfOrder(
  sql: postgres.Sql,
  table: "audit_events" | "auth_audits",
): Promise<number> {
  const scope = table === "audit_events" ? sql`PARTITION BY group_id` : sql``
  const [{ rows }] = await sql<{ rows: number }[]>`
    SELECT COUNT(*)::int AS rows FROM (
      SELECT created_at < lag(created_at) OVER (${scope} ORDER BY id) AS back FROM ${sql(table)}
    ) t WHERE back
  `
  return rows
}

Deno.test("the seeds' audit rows have ids in the order of their times", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, DEV_OPTIONS)
    await signUpVisitor(sql, "visitor@example.net")
    await drainJobs(sql)

    // Feeds and billing histories sort by id: a row out of order would jump back in time.
    expect(await outOfOrder(sql, "audit_events")).toBe(0)
    expect(await outOfOrder(sql, "auth_audits")).toBe(0)
  })
})

Deno.test("the development billing provider tells the seeded customers' payments", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, DEV_OPTIONS)
    const payments = postgresFakePayments(sql)
    const subscriptions = await sql<{
      id: string
      status: BillingStatus
      quantity: number
      currentPeriodEnd: Date
      pastDueSince: Date | null
    }[]>`
      SELECT provider_subscription_id AS id, status, quantity, current_period_end, past_due_since
      FROM subscriptions
    `
    const month = 30 * 24 * 60 * 60_000
    for (const subscription of subscriptions) {
      const payment = await payments(subscription.id)
      if (subscription.status === BillingStatus.Trialing) {
        expect(payment).toBeNull()
        continue
      }
      // The price of every seat, at the start of the period paid for.
      expect(payment!.amount).toBe(900 * subscription.quantity)
      const due = subscription.pastDueSince ?? subscription.currentPeriodEnd
      expect(payment!.paidAt.getTime()).toBe(due.getTime() - month)
    }
    const [{ groupId }] = await sql<{ groupId: string }[]>`
      SELECT substring(a.identifier from 'group:([^ ]+)') AS group_id
      FROM auth_audits a WHERE a.event_type = ${BILLING_AUDIT_EVENTS.paymentRefunded}
    `
    const [refunded] = await sql<{ id: string }[]>`
      SELECT provider_subscription_id AS id FROM subscriptions WHERE group_id = ${groupId}
    `
    expect((await payments(refunded.id))!.refunded).toBe(true)
    const others = subscriptions.filter((s) =>
      s.id !== refunded.id && s.status !== BillingStatus.Trialing
    )
    for (const other of others) expect((await payments(other.id))!.refunded).toBe(false)
  })
})

Deno.test("the development seed adds the operator's refund, blocks and a recent backup", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, DEV_OPTIONS)

    const [{ groupId }] = await sql<{ groupId: string }[]>`
      SELECT substring(a.identifier from 'group:([^ ]+)') AS group_id
      FROM auth_audits a WHERE a.event_type = ${BILLING_AUDIT_EVENTS.paymentRefunded}
    `
    const record = await readAdminBillingRecord(sql, groupId)
    const refund = record!.history.find((entry) =>
      entry.event === BILLING_AUDIT_EVENTS.paymentRefunded
    )
    expect(refund?.operator).toBe("Emma Walsh")
    expect(refund?.amount?.amount).toBeGreaterThan(0)
    const blocks = await sql`
      SELECT 1 FROM auth_audits WHERE event_type = ${AuthAuditEventType.USER_BLOCKED}
    `
    expect(blocks).toHaveLength(2)
    const backup = await readLastBackup(sql)
    expect(NOW.getTime() - backup!.getTime()).toBeLessThan(24 * 60 * 60_000)
  })
})

Deno.test("a visitor's sample groups have notes by several people on different days", async () => {
  await withSchema(async (sql) => {
    await seedDemo(new AppDbBase({ sql }), sql, OPTIONS)
    const userId = await signUpVisitor(sql, "visitor@example.net")
    await drainJobs(sql)

    const groups = await sql<{ authors: number; days: number }[]>`
      SELECT
        COUNT(DISTINCT e.actor_user_id)::int AS authors,
        (EXTRACT(EPOCH FROM max(e.created_at) - min(e.created_at)) / 86400)::float8 AS days
      FROM audit_events e JOIN group_members m ON m.group_id = e.group_id AND m.user_id = ${userId}
      JOIN groups g ON g.id = e.group_id
      WHERE g.name <> 'Personal' AND e.event_kind = 'note.created'
      GROUP BY e.group_id
    `
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      expect(group.authors).toBeGreaterThanOrEqual(2)
      expect(group.days).toBeGreaterThan(1)
    }
  })
})
