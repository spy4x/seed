/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { ADMIN_JOB_RETRIED_KIND, AdminJobRetryOutcome, UserRole } from "@domain/identity"
import {
  readDatabaseFacts,
  readFailedJobs,
  readJobKinds,
  readLastBackup,
  readMigrations,
  readQueueCounts,
} from "@server/jobs/admin-system.ts"
import { JOB_AGGREGATE } from "@server/jobs/jobs.ts"
import { AppDbBase } from "../../apps/api/services/db-base.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's System page (#429) against a real Postgres with every migration applied: the
 * queue's counts, the failed jobs, running one again with its audit row, the backup's time and
 * the migrations.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `admin_system_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 4,
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

async function operator(sql: postgres.Sql): Promise<number> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, role) SELECT id, ${UserRole.OPERATOR} FROM auth_user RETURNING id
  `
  return id
}

interface Row {
  kind?: string
  type?: string
  aggregateId?: string
  version?: number
  available?: string
  claimed?: string | null
  processed?: string | null
  error?: string | null
  attempts?: number
}

/** One outbox row; times are SQL intervals from now, such as `-10 minutes`. */
async function outbox(sql: postgres.Sql, row: Row = {}): Promise<string> {
  const id = uuidV7()
  const at = (offset: string | null | undefined) =>
    offset == null ? null : sql`now() + ${offset}::interval`
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at, claimed_at,
      processed_at, last_error_code, attempt_count
    ) VALUES (
      ${id}, ${row.kind ?? "mail.password_reset"}, ${row.type ?? JOB_AGGREGATE},
      ${row.aggregateId ?? uuidV7()}, ${row.version ?? 1}, ${at(row.available ?? "0 seconds")},
      ${at(row.claimed)}, ${at(row.processed)}, ${row.error ?? null}, ${row.attempts ?? 0}
    )
  `
  return id
}

const failed = { processed: "-1 hour", error: "MailSendError", attempts: 20 }

Deno.test("system: counts the queue's rows by state", async () => {
  await withSchema(async (sql) => {
    await outbox(sql, { available: "-10 minutes" })
    await outbox(sql, { available: "-1 minute" })
    await outbox(sql, { available: "1 day" })
    await outbox(sql, { available: "30 seconds", claimed: "0 seconds", attempts: 1 })
    await outbox(sql, { available: "2 minutes", claimed: "-1 minute", error: "Boom", attempts: 2 })
    await outbox(sql, failed)
    await outbox(sql, { ...failed, processed: "-8 days" })
    await outbox(sql, { processed: "-1 hour" })
    const counts = await readQueueCounts(sql)

    expect(counts).toMatchObject({ due: 2, scheduled: 1, running: 1, retrying: 1, failed: 1 })
    expect(counts.now.valueOf() - counts.oldestDueAt!.valueOf()).toBeGreaterThanOrEqual(
      10 * 60_000 - 1_000,
    )
  })
})

Deno.test("system: lists each job's last run and next run", async () => {
  await withSchema(async (sql) => {
    const chain = uuidV7()
    await outbox(sql, { kind: "outbox.cleanup", aggregateId: chain, processed: "-2 days" })
    await outbox(sql, { kind: "outbox.cleanup", aggregateId: chain, version: 2, ...failed })
    await outbox(sql, {
      kind: "outbox.cleanup",
      aggregateId: chain,
      version: 3,
      available: "1 day",
    })
    await outbox(sql, { kind: "note.created", type: "note", processed: "-1 hour" })
    const kinds = await readJobKinds(sql)

    expect(kinds).toHaveLength(1)
    expect(kinds[0]).toMatchObject({ kind: "outbox.cleanup", lastFailed: true })
    expect(kinds[0].nextRunAt).not.toBeNull()
    // Only these columns leave the store: never a payload or an error message.
    expect(Object.keys(kinds[0]).sort()).toEqual(["kind", "lastFailed", "lastRunAt", "nextRunAt"])
  })
})

Deno.test("system: lists failed rows newest first, and which may run again", async () => {
  await withSchema(async (sql) => {
    const chain = uuidV7()
    const lone = await outbox(sql, failed)
    const superseded = await outbox(sql, { ...failed, processed: "-2 hours", aggregateId: chain })
    await outbox(sql, { aggregateId: chain, version: 2, available: "1 day" })
    const change = await outbox(sql, { ...failed, processed: "-3 hours", type: "note" })
    await outbox(sql, { ...failed, processed: "-8 days" })
    const rows = await readFailedJobs(sql, 50)

    expect(rows.map((row) => [row.id, row.retryable])).toEqual([
      [lone, true],
      [superseded, false],
      [change, false],
    ])
    expect(rows[0]).toMatchObject({ errorCode: "MailSendError", attempts: 20 })
    // Only these columns leave the store: never a payload or an error message.
    expect(Object.keys(rows[0]).sort()).toEqual([
      "attempts",
      "errorCode",
      "failedAt",
      "id",
      "kind",
      "retryable",
    ])
    expect(await readFailedJobs(sql, 1)).toHaveLength(1)
  })
})

Deno.test("system: running a failed job again resets it and writes the operator's audit row", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const id = await outbox(sql, { ...failed, claimed: "-1 hour" })
    const db = new AppDbBase({ sql })
    const outcome = await db.begin((tx) => tx.adminSystem.retryJob(id, op, "req-9"))

    expect(outcome).toBe(AdminJobRetryOutcome.Retried)
    const [row] = await sql`
      SELECT processed_at, claimed_at, last_error_code, attempt_count,
        available_at <= now() AS due
      FROM outbox_events WHERE id = ${id}
    `
    expect(row).toEqual({
      processedAt: null,
      claimedAt: null,
      lastErrorCode: null,
      attemptCount: 0,
      due: true,
    })
    const audits = await sql`
      SELECT event_kind, actor_user_id, request_id, entity_type, entity_id, details
      FROM audit_events
    `
    expect(audits).toEqual([{
      eventKind: ADMIN_JOB_RETRIED_KIND,
      actorUserId: op,
      requestId: "req-9",
      entityType: "job",
      entityId: id,
      details: { kind: "mail.password_reset" },
    }])
    // Run again already: the second press finds no failed job and writes nothing.
    expect(await db.begin((tx) => tx.adminSystem.retryJob(id, op, null))).toBe(
      AdminJobRetryOutcome.NotFound,
    )
    expect(await sql`SELECT 1 FROM audit_events`).toHaveLength(1)
  })
})

Deno.test("system: refuses to run again a group change, a live job or a superseded job", async () => {
  await withSchema(async (sql) => {
    const op = await operator(sql)
    const db = new AppDbBase({ sql })
    const retry = (id: string) => db.begin((tx) => tx.adminSystem.retryJob(id, op, null))
    const change = await outbox(sql, { ...failed, type: "note" })
    const live = await outbox(sql)
    const done = await outbox(sql, { processed: "-1 hour" })
    const chain = uuidV7()
    const superseded = await outbox(sql, { ...failed, aggregateId: chain })
    await outbox(sql, { aggregateId: chain, version: 2, available: "1 day" })

    expect(await retry(change)).toBe(AdminJobRetryOutcome.NotFound)
    expect(await retry(live)).toBe(AdminJobRetryOutcome.NotFound)
    expect(await retry(done)).toBe(AdminJobRetryOutcome.NotFound)
    expect(await retry(uuidV7())).toBe(AdminJobRetryOutcome.NotFound)
    expect(await retry(superseded)).toBe(AdminJobRetryOutcome.Superseded)
    expect(await sql`SELECT 1 FROM audit_events`).toEqual([])
    const [row] = await sql`SELECT processed_at FROM outbox_events WHERE id = ${superseded}`
    expect(row.processedAt).not.toBeNull()
  })
})

Deno.test("system: reads the last backup the backup service recorded", async () => {
  await withSchema(async (sql) => {
    expect(await readLastBackup(sql)).toBeNull()
    // The statement `infra/backup/backup.sh` runs after a backup, twice: the row is replaced.
    const record = () =>
      sql.unsafe(`insert into backup_status (target, succeeded_at) values ('database', now())
        on conflict (target) do update set succeeded_at = excluded.succeeded_at`)
    await record()
    await record()

    expect(await sql`SELECT 1 FROM backup_status`).toHaveLength(1)
    expect(await readLastBackup(sql)).toBeInstanceOf(Date)
  })
})

Deno.test("system: describes the database and its newest migration", async () => {
  await withSchema(async (sql) => {
    // The migration runner makes this table itself, as `schema.sql` shows it.
    await sql`
      CREATE TABLE migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `
    await sql`
      INSERT INTO migrations (name) VALUES
        ('2026_11_09_0001_admin_stats_indexes.sql'), ('2026_11_14_0001_backup_status.sql')
    `
    const facts = await readDatabaseFacts(sql)

    expect(facts.sizeBytes).toBeGreaterThan(0)
    expect(facts.version).toMatch(/^\d+(\.\d+)?$/)
    expect(facts.startedAt).toBeInstanceOf(Date)
    expect(await readMigrations(sql)).toMatchObject({
      applied: 2,
      latest: "2026_11_14_0001_backup_status",
    })
  })
})
