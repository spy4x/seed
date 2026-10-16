/**
 * The operator area's System page (#429): how each part of the stack is doing, the job queue and
 * its failed jobs, the latest backup, the running build and the database's migrations. Types only,
 * plus the thresholds that turn a reading into a status; the SQL is
 * `libs/server/jobs/admin-system.ts`.
 *
 * Nothing here ever holds an environment value, a connection string or a secret: names and states
 * only.
 *
 * This module imports nothing from `+lib.ts` at run time: `+lib.ts` re-exports it.
 *
 * @module
 */

/** How a part of the stack is doing. Ordered, so the worst of several is their maximum. */
export enum AdminHealth {
  OK = 1,
  WARNING = 2,
  ERROR = 3,
}

/** The worst of `states`; {@link AdminHealth.OK} for none. */
export function worstHealth(...states: AdminHealth[]): AdminHealth {
  return states.reduce((worst, state) => (state > worst ? state : worst), AdminHealth.OK)
}

/** A job that waits past this many minutes after it was due warns: the worker is behind. */
export const ADMIN_QUEUE_LATE_WARNING_MINUTES = 5
/** A job that waits past this many minutes after it was due is an error: the worker is down. */
export const ADMIN_QUEUE_LATE_ERROR_MINUTES = 30
/** How far back the page counts and lists failed jobs. Older processed rows are deleted anyway. */
export const ADMIN_FAILED_JOBS_DAYS = 7
/** How many failed jobs the page lists, newest first. */
export const ADMIN_FAILED_JOBS_LIMIT = 50
/** A backup older than this many hours warns: the daily run was missed once. */
export const ADMIN_BACKUP_WARNING_HOURS = 26
/** A backup older than this many hours is an error: the daily run was missed twice. */
export const ADMIN_BACKUP_ERROR_HOURS = 48

/** The database: whether the API reaches it, and what it is. */
export interface AdminSystemDatabase {
  health: AdminHealth
  reachable: boolean
  /** How long the check took, in milliseconds. */
  latencyMs: number
  /** The size of the product's database in bytes, or `null` when it is unreachable. */
  sizeBytes: number | null
  /** The server's version, such as `18.6`. */
  version: string | null
  /** When the database server started. ISO 8601. */
  startedAt: string | null
}

/** The cache (Valkey): whether the API reaches it. */
export interface AdminSystemCache {
  health: AdminHealth
  reachable: boolean
  latencyMs: number
}

/** The job and outbox queue as one table holds it (`outbox_events`). */
export interface AdminSystemQueue {
  health: AdminHealth
  /** Jobs and events due now and not claimed by a worker yet. */
  due: number
  /** The oldest due row's due time, or `null` with none due. ISO 8601. */
  oldestDueAt: string | null
  /** Rows due later: a scheduled job, or a retry waiting for its back-off. */
  scheduled: number
  /** Rows a worker claimed and has not finished. */
  running: number
  /** Rows that failed at least once and wait for another attempt. */
  retrying: number
  /** Jobs and events given up in the last {@link ADMIN_FAILED_JOBS_DAYS} days. */
  failed: number
}

/** One kind of job: its last run and its next. */
export interface AdminSystemJobKind {
  kind: string
  /** When a run of this kind last finished, well or not. ISO 8601. */
  lastRunAt: string | null
  /** Whether that run failed. */
  lastFailed: boolean
  /** When the next run is due, or `null` with none waiting. ISO 8601. */
  nextRunAt: string | null
}

/** A job, or another outbox row such as a group change, the worker gave up on. */
export interface AdminFailedJob {
  /** The outbox row's id, a UUID. */
  id: string
  kind: string
  attempts: number
  /** The error's name, as the worker recorded it; never its message. */
  errorCode: string
  failedAt: string
  /**
   * An operator may run it again: it is a job, not a group change (whose order matters), and no
   * newer run of the same job waits already.
   */
  retryable: boolean
}

/** What running a failed job again came to. */
export enum AdminJobRetryOutcome {
  /** The job waits for the worker again, with its attempts reset. */
  Retried = 1,
  /** No failed job has that id: it never failed, it was run again already, or it is gone. */
  NotFound = 2,
  /** A newer run of the same job waits already; a second one would run it twice. */
  Superseded = 3,
}

/** The latest backup the backup service recorded. */
export interface AdminSystemBackup {
  health: AdminHealth
  /** When the last backup finished well, or `null` when none was ever recorded. ISO 8601. */
  succeededAt: string | null
}

/** The database's migrations. */
export interface AdminSystemMigrations {
  health: AdminHealth
  applied: number
  /** The newest migration's name, such as `2026_11_14_0001_backup_status`. */
  latest: string | null
  latestAt: string | null
}

/** The API process that answered. */
export interface AdminSystemBuild {
  /** The release tag the image was built from, or `null` for a build without one (development). */
  version: string | null
  /** The commit the image was built from. */
  commit: string | null
  /** The runtime and its version, such as `Deno/2.5.6`. */
  runtime: string
  /** When this API process started. ISO 8601. */
  startedAt: string
}

/** The System page: each part of the stack, and the worst of them. */
export interface AdminSystemSnapshot {
  health: AdminHealth
  /** When the snapshot was taken. ISO 8601. */
  checkedAt: string
  database: AdminSystemDatabase
  cache: AdminSystemCache
  queue: AdminSystemQueue
  jobs: AdminSystemJobKind[]
  failedJobs: AdminFailedJob[]
  backup: AdminSystemBackup
  migrations: AdminSystemMigrations
  build: AdminSystemBuild
}

/** The queue's status from how long its oldest due row has waited, at `now`. */
export function queueHealth(oldestDueAt: Date | null, failed: number, now: Date): AdminHealth {
  const late = oldestDueAt ? (now.valueOf() - oldestDueAt.valueOf()) / 60_000 : 0
  if (late > ADMIN_QUEUE_LATE_ERROR_MINUTES) return AdminHealth.ERROR
  if (late > ADMIN_QUEUE_LATE_WARNING_MINUTES || failed > 0) return AdminHealth.WARNING
  return AdminHealth.OK
}

/** The backup's status from when the last one finished, at `now`. None at all is an error. */
export function backupHealth(succeededAt: Date | null, now: Date): AdminHealth {
  if (!succeededAt) return AdminHealth.ERROR
  const hours = (now.valueOf() - succeededAt.valueOf()) / 3_600_000
  if (hours > ADMIN_BACKUP_ERROR_HOURS) return AdminHealth.ERROR
  if (hours > ADMIN_BACKUP_WARNING_HOURS) return AdminHealth.WARNING
  return AdminHealth.OK
}
