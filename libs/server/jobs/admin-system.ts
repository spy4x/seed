/**
 * The System page's reads over Postgres (#429): the database itself, the job and outbox queue
 * (`outbox_events`), the latest backup and the migrations. The jobs themselves are the Jobs
 * module's (`admin-jobs.ts`). Who may
 * call them is the API's business (`apps/api/routes/admin/system.ts`); nothing here checks it.
 *
 * A failed row keeps only its error's name (`last_error_code`), never its message, so nothing read
 * here can quote an address or a provider's answer.
 *
 * @module
 */

import type postgres from "postgres"
import { ADMIN_FAILED_JOBS_DAYS } from "@domain/identity"

/** What the backup service records after a backup finished well, in `backup_status.target`. */
export const BACKUP_TARGET_DATABASE = "database"

/** The database as it describes itself. */
export interface DatabaseFacts {
  sizeBytes: number
  /** Such as `18.6`. */
  version: string
  startedAt: Date
}

/** The database's size, version and start time. */
export async function readDatabaseFacts(sql: postgres.Sql): Promise<DatabaseFacts> {
  const [row] = await sql<{ sizeBytes: number; version: string; startedAt: Date }[]>`
    SELECT pg_database_size(current_database())::float8 AS size_bytes,
      current_setting('server_version') AS version,
      pg_postmaster_start_time() AS started_at
  `
  // A distribution's build adds its name after a space: `18.6 (Debian 18.6-1)`.
  return { ...row, version: row.version.split(" ")[0] }
}

/** The queue's counts, its oldest due row and the database's clock, which wrote every time. */
export interface QueueCounts {
  due: number
  oldestDueAt: Date | null
  scheduled: number
  running: number
  retrying: number
  failed: number
  /** The database's `now()`, so lateness is measured on the clock that wrote `available_at`. */
  now: Date
}

/**
 * How many outbox rows are in each state. A claim moves `available_at` past now for its lease, so
 * a row is due only while no worker holds it. `running` counts first attempts under a lease; a
 * retry, waiting or running, counts as `retrying`, because a lease and a back-off look alike in the
 * table. `failed` counts rows given up in the last {@link ADMIN_FAILED_JOBS_DAYS} days; a row an
 * operator cancelled is not one.
 */
export async function readQueueCounts(sql: postgres.Sql): Promise<QueueCounts> {
  const [row] = await sql<QueueCounts[]>`
    SELECT
      count(*) FILTER (WHERE processed_at IS NULL AND available_at <= now())::int AS due,
      min(available_at) FILTER (WHERE processed_at IS NULL AND available_at <= now())
        AS oldest_due_at,
      count(*) FILTER (
        WHERE processed_at IS NULL AND available_at > now() AND claimed_at IS NULL
      )::int AS scheduled,
      count(*) FILTER (
        WHERE processed_at IS NULL AND available_at > now() AND claimed_at IS NOT NULL
          AND last_error_code IS NULL
      )::int AS running,
      count(*) FILTER (WHERE processed_at IS NULL AND last_error_code IS NOT NULL)::int
        AS retrying,
      count(*) FILTER (
        WHERE processed_at >= now() - make_interval(days => ${ADMIN_FAILED_JOBS_DAYS})
          AND last_error_code IS NOT NULL AND cancelled_at IS NULL
      )::int AS failed,
      now() AS now
    FROM outbox_events
  `
  return row
}

/** When the backup service last recorded a backup that finished well, or `null` for never. */
export async function readLastBackup(sql: postgres.Sql): Promise<Date | null> {
  const [row] = await sql<{ succeededAt: Date }[]>`
    SELECT succeeded_at FROM backup_status WHERE target = ${BACKUP_TARGET_DATABASE}
  `
  return row?.succeededAt ?? null
}

/** How many migrations ran, and the newest one's name and time. */
export async function readMigrations(
  sql: postgres.Sql,
): Promise<{ applied: number; latest: string | null; latestAt: Date | null }> {
  const [count] = await sql<{ applied: number }[]>`SELECT count(*)::int AS applied FROM migrations`
  const [latest] = await sql<{ name: string; createdAt: Date }[]>`
    SELECT name, created_at FROM migrations ORDER BY id DESC LIMIT 1
  `
  return {
    applied: count.applied,
    latest: latest?.name.replace(/(\.no_transaction)?\.sql$/, "") ?? null,
    latestAt: latest?.createdAt ?? null,
  }
}
