/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  readDatabaseFacts,
  readLastBackup,
  readMigrations,
  readQueueCounts,
} from "@server/jobs/admin-system.ts"
import { JOB_AGGREGATE } from "@server/jobs/jobs.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { applyMigrations } from "./migrations.ts"

/**
 * The operator area's System page (#429) against a real Postgres with every migration applied: the
 * queue's counts, the backup's time and the migrations. The jobs are `admin-jobs.integration.test.ts`.
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
  cancelled?: string | null
}

/** One outbox row; times are SQL intervals from now, such as `-10 minutes`. */
async function outbox(sql: postgres.Sql, row: Row = {}): Promise<string> {
  const id = uuidV7()
  const at = (offset: string | null | undefined) =>
    offset == null ? null : sql`now() + ${offset}::interval`
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at, claimed_at,
      processed_at, last_error_code, attempt_count, cancelled_at
    ) VALUES (
      ${id}, ${row.kind ?? "mail.password_reset"}, ${row.type ?? JOB_AGGREGATE},
      ${row.aggregateId ?? uuidV7()}, ${row.version ?? 1}, ${at(row.available ?? "0 seconds")},
      ${at(row.claimed)}, ${at(row.processed)}, ${row.error ?? null}, ${row.attempts ?? 0},
      ${at(row.cancelled)}
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
    await outbox(sql, { ...failed, cancelled: "-1 hour" })
    await outbox(sql, { processed: "-1 hour" })
    const counts = await readQueueCounts(sql)

    expect(counts).toMatchObject({ due: 2, scheduled: 1, running: 1, retrying: 1, failed: 1 })
    expect(counts.now.valueOf() - counts.oldestDueAt!.valueOf()).toBeGreaterThanOrEqual(
      10 * 60_000 - 1_000,
    )
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
