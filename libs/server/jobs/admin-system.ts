/**
 * The System page's reads over Postgres (#429): the database itself, the job and outbox queue
 * (`outbox_events`), the latest backup and the migrations, and running a failed job again. Who may
 * call them is the API's business (`apps/api/routes/admin/system.ts`); nothing here checks it.
 *
 * A failed row keeps only its error's name (`last_error_code`), never its message, so nothing read
 * here can quote an address or a provider's answer.
 *
 * @module
 */

import type postgres from "postgres"
import {
  ADMIN_FAILED_JOBS_DAYS,
  ADMIN_JOB_RETRIED_KIND,
  type AdminFailedJob,
  AdminJobRetryOutcome,
  type AdminSystemJobKind,
} from "@domain/identity"
import { JOB_AGGREGATE } from "./jobs.ts"

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
 * table. `failed` counts rows given up in the last {@link ADMIN_FAILED_JOBS_DAYS} days.
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
          AND last_error_code IS NOT NULL
      )::int AS failed,
      now() AS now
    FROM outbox_events
  `
  return row
}

/**
 * Each kind of job the table holds a row of: when one last finished and whether it failed, and when
 * the next one is due. Processed rows are deleted after a week, so a kind that has not run since is
 * left out.
 */
export async function readJobKinds(sql: postgres.Sql): Promise<AdminSystemJobKind[]> {
  const rows = await sql<
    { kind: string; lastRunAt: Date | null; lastFailed: boolean | null; nextRunAt: Date | null }[]
  >`
    SELECT event_kind AS kind,
      max(processed_at) AS last_run_at,
      (array_agg(last_error_code IS NOT NULL ORDER BY processed_at DESC, id DESC)
        FILTER (WHERE processed_at IS NOT NULL))[1] AS last_failed,
      min(available_at) FILTER (WHERE processed_at IS NULL) AS next_run_at
    FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE}
    GROUP BY event_kind
    ORDER BY event_kind
  `
  return rows.map((row) => ({
    kind: row.kind,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastFailed: row.lastFailed === true,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
  }))
}

/**
 * The newest `limit` rows the worker gave up on in the last {@link ADMIN_FAILED_JOBS_DAYS} days,
 * jobs and group changes alike, newest first.
 */
export async function readFailedJobs(sql: postgres.Sql, limit: number): Promise<AdminFailedJob[]> {
  const rows = await sql<
    {
      id: string
      kind: string
      attempts: number
      errorCode: string
      failedAt: Date
      isJob: boolean
      superseded: boolean
    }[]
  >`
    SELECT e.id, e.event_kind AS kind, e.attempt_count AS attempts, e.last_error_code AS error_code,
      e.processed_at AS failed_at, e.aggregate_type = ${JOB_AGGREGATE} AS is_job,
      EXISTS (
        SELECT 1 FROM outbox_events w
        WHERE w.processed_at IS NULL AND w.event_kind = e.event_kind
          AND w.aggregate_type = e.aggregate_type AND w.aggregate_id = e.aggregate_id
      ) AS superseded
    FROM outbox_events e
    WHERE e.processed_at >= now() - make_interval(days => ${ADMIN_FAILED_JOBS_DAYS})
      AND e.last_error_code IS NOT NULL
    ORDER BY e.processed_at DESC, e.id DESC
    LIMIT ${limit}
  `
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    attempts: row.attempts,
    errorCode: row.errorCode,
    failedAt: row.failedAt.toISOString(),
    retryable: row.isJob && !row.superseded,
  }))
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

/**
 * Runs the failed job `id` again: it waits for the worker as if new, with its attempts reset, and
 * an `audit_events` row names the operator, the request and the job's kind. A row that is no failed job, or a
 * group change, is {@link AdminJobRetryOutcome.NotFound}: a group change replayed out of order
 * could undo a later one. A job whose next run waits already (a repeating job is rescheduled when
 * it gives up) is {@link AdminJobRetryOutcome.Superseded}.
 *
 * Inside a transaction only: the row is locked from the check to the write, so two operators
 * pressing at once run it once, and the job and its audit row are written together or not at all.
 */
export async function retryFailedJob(
  sql: postgres.Sql,
  id: string,
  operatorId: number,
  requestId: string | null,
): Promise<AdminJobRetryOutcome> {
  const [job] = await sql<{ kind: string; aggregateId: string }[]>`
    SELECT event_kind AS kind, aggregate_id FROM outbox_events
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
      AND processed_at IS NOT NULL AND last_error_code IS NOT NULL
    FOR UPDATE
  `
  if (!job) return AdminJobRetryOutcome.NotFound
  const waiting = await sql`
    SELECT 1 FROM outbox_events
    WHERE processed_at IS NULL AND event_kind = ${job.kind}
      AND aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${job.aggregateId}
    LIMIT 1
  `
  if (waiting.length > 0) return AdminJobRetryOutcome.Superseded
  await sql`
    UPDATE outbox_events
    SET processed_at = NULL, attempt_count = 0, available_at = now(), claimed_at = NULL,
      last_error_code = NULL
    WHERE id = ${id}
  `
  await sql`
    INSERT INTO audit_events (
      event_kind, actor_user_id, request_id, entity_type, entity_id, details
    ) VALUES (
      ${ADMIN_JOB_RETRIED_KIND}, ${operatorId}, ${requestId}, 'job', ${id},
      ${sql.json({ kind: job.kind })}
    )
  `
  return AdminJobRetryOutcome.Retried
}
