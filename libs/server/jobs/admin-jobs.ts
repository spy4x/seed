/**
 * The Jobs module's reads and actions over Postgres (#394): the runs of every job, the repeating
 * jobs, and an operator's run again, run now and cancel. Who may call them is the API's business
 * (`apps/api/routes/admin/jobs.ts`); nothing here checks it. Only job rows (`aggregate_type =
 * 'job'`) are read or changed: a group change replayed or dropped out of order could undo a later
 * one.
 *
 * A row keeps only its error's name (`last_error_code`), never its message, and no payload, so
 * nothing read here can quote an address or a provider's answer.
 *
 * Each action is guarded in its own SQL, so a second press, a second operator or the worker
 * claiming the row at the same moment changes nothing it should not: a cancel closes only a row no
 * worker holds; run now only moves the due time of a waiting row and never writes a second row of
 * a chain; run again reopens only a row the worker gave up, and only while no other run of the same
 * job and thing waits. Each writes its `audit_events` row in the same transaction.
 *
 * @module
 */

import type postgres from "postgres"
import {
  ADMIN_JOB_CANCELLED_KIND,
  ADMIN_JOB_FILTER_STATES,
  ADMIN_JOB_RETRIED_KIND,
  ADMIN_JOB_RUN_NOW_KIND,
  ADMIN_JOB_STATE_FILTERS,
  ADMIN_JOBS_PAGE_SIZE,
  AdminJobActionOutcome,
  type AdminJobFilter,
  type AdminJobPhoto,
  type AdminJobRow,
  AdminJobState,
  type AdminJobStateFilter,
} from "@domain/identity"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type CatalogText, catalogText } from "@domain/catalog"
import { JOB_RETRY } from "./job-failures.ts"
import { JOB_AGGREGATE, JOB_AGGREGATE_ID, LEGACY_JOB_AGGREGATE_ID } from "./jobs.ts"
import { type JobDefinition, jobDefinition, JOBS } from "./registry.ts"

/** A row as the reads return it, before the API adds the registry's label. */
export type AdminJobRecord = Omit<AdminJobRow, "label" | "photo"> & { aggregateId: string }

/** What a search matches: kinds whose name matched (from the registry), and text in the kind. */
export interface AdminJobMatch {
  kinds: readonly string[]
  text: string
}

/** One page of runs and the count of every state chip. */
export interface AdminJobPage {
  jobs: AdminJobRecord[]
  counts: Record<AdminJobStateFilter, number>
  total: number
}

/**
 * A row a worker holds now. A claim sets `claimed_at` to now and `available_at` exactly one lease
 * later in one statement; a retry's back-off, a release or an operator's action writes
 * `available_at` alone, so the two never stay that far apart otherwise.
 */
function running(sql: postgres.Sql) {
  return sql`(claimed_at IS NOT NULL AND available_at > now()
    AND available_at = claimed_at + make_interval(secs => ${JOB_RETRY.leaseSeconds}::float8))`
}

/** The row's {@link AdminJobState}, as SQL. */
function stateOf(sql: postgres.Sql) {
  return sql`CASE
    WHEN cancelled_at IS NOT NULL THEN ${AdminJobState.Cancelled}::int
    WHEN processed_at IS NOT NULL AND last_error_code IS NULL THEN ${AdminJobState.Done}::int
    WHEN processed_at IS NOT NULL THEN ${AdminJobState.Failed}::int
    WHEN ${running(sql)} THEN ${AdminJobState.Running}::int
    WHEN attempt_count >= ${JOB_RETRY.maxAttempts} THEN ${AdminJobState.Failed}::int
    WHEN last_error_code IS NOT NULL THEN ${AdminJobState.Retrying}::int
    WHEN available_at <= now() THEN ${AdminJobState.Due}::int
    ELSE ${AdminJobState.Scheduled}::int
  END`
}

/** A row the worker gave up: closed with an error, or (an older worker's) out of attempts. */
function givenUp(sql: postgres.Sql) {
  return sql`(cancelled_at IS NULL AND (
    (processed_at IS NOT NULL AND last_error_code IS NOT NULL)
    OR (processed_at IS NULL AND attempt_count >= ${JOB_RETRY.maxAttempts} AND NOT ${running(sql)})
  ))`
}

/** `%text%` for ILIKE, with its wildcards escaped. */
function contains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}

function searchWhere(sql: postgres.Sql, match: AdminJobMatch | null) {
  if (!match) return sql`TRUE`
  return sql`(event_kind = ANY(${match.kinds as string[]}) OR event_kind ILIKE ${
    contains(match.text)
  })`
}

const COLUMNS = (sql: postgres.Sql) =>
  sql`id, event_kind AS kind, aggregate_id::text AS aggregate_id, ${stateOf(sql)} AS state,
    attempt_count AS attempts, created_at, available_at AS due_at, claimed_at AS started_at,
    processed_at AS finished_at, last_error_code AS error_code`

interface RecordRaw {
  id: string
  kind: string
  aggregateId: string
  state: AdminJobState
  attempts: number
  createdAt: Date
  dueAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  errorCode: string | null
}

function toRecord(row: RecordRaw): AdminJobRecord {
  return {
    id: row.id,
    kind: row.kind,
    aggregateId: row.aggregateId,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: JOB_RETRY.maxAttempts,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
  }
}

/**
 * One page of job runs, newest first, with the count of each state chip over the same search.
 * `match` is `null` for no search.
 */
export async function listJobs(
  sql: postgres.Sql,
  filter: AdminJobFilter,
  match: AdminJobMatch | null,
): Promise<AdminJobPage> {
  const search = searchWhere(sql, match)
  const states = ADMIN_JOB_FILTER_STATES[filter.state]
  const stateWhere = states.length === 0 ? sql`TRUE` : sql`${stateOf(sql)} = ANY(${states})`
  const byState = await sql<{ state: AdminJobState; count: number }[]>`
    SELECT ${stateOf(sql)} AS state, count(*)::int AS count
    FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND ${search}
    GROUP BY 1
  `
  const counts = Object.fromEntries(ADMIN_JOB_STATE_FILTERS.map((name) => {
    const wanted = ADMIN_JOB_FILTER_STATES[name]
    const count = byState
      .filter((row) => wanted.length === 0 || wanted.includes(row.state))
      .reduce((sum, row) => sum + row.count, 0)
    return [name, count]
  })) as Record<AdminJobStateFilter, number>
  const rows = await sql<RecordRaw[]>`
    SELECT ${COLUMNS(sql)}
    FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND ${search} AND ${stateWhere}
    ORDER BY created_at DESC, id DESC
    LIMIT ${ADMIN_JOBS_PAGE_SIZE} OFFSET ${(filter.page - 1) * ADMIN_JOBS_PAGE_SIZE}
  `
  return { jobs: rows.map(toRecord), counts, total: counts[filter.state] }
}

/** One job run, or `null` when no job row has the id. */
export async function readJob(sql: postgres.Sql, id: string): Promise<AdminJobRecord | null> {
  const [row] = await sql<RecordRaw[]>`
    SELECT ${COLUMNS(sql)} FROM outbox_events
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
  `
  return row ? toRecord(row) : null
}

/**
 * The person a job is about: the `user_id` of the row `aggregateId` in `table`, with their name,
 * or `null` once that row is gone. `table` comes from the job registry, never from a request.
 */
export async function readJobUser(
  sql: postgres.Sql,
  table: string,
  aggregateId: string,
): Promise<{ id: number; name: string } | null> {
  const [row] = await sql<
    { id: number; firstName: string | null; lastName: string | null; email: string | null }[]
  >`
    SELECT u.id, u.first_name, u.last_name, (
      SELECT k.email FROM auth_keys k
      WHERE k.user_id = u.id AND k.email IS NOT NULL ORDER BY k.id LIMIT 1
    ) AS email
    FROM ${sql(table)} t JOIN users u ON u.id = t.user_id
    WHERE t.id = ${aggregateId}
  `
  if (!row) return null
  const name = `${row.firstName ?? ``} ${row.lastName ?? ``}`.trim() || row.email || `No name`
  return { id: row.id, name }
}

/**
 * The catalog photos among the images `imageIds`, by image id, each with its item and the item's
 * name in the first of `languages` that has one (#514). An image that is no catalog photo, such as a
 * profile picture, or one removed since, is left out.
 */
export async function readJobPhotos(
  sql: postgres.Sql,
  imageIds: readonly string[],
  languages: readonly string[],
): Promise<Map<string, AdminJobPhoto>> {
  if (imageIds.length === 0) return new Map()
  const rows = await sql<{ id: string; itemId: string; name: CatalogText; ready: boolean }[]>`
    SELECT p.id, p.item_id, i.name,
      EXISTS (SELECT 1 FROM image_variants v WHERE v.image_id = p.id) AS ready
    FROM catalog_photos p JOIN catalog_items i ON i.id = p.item_id
    WHERE p.id = ANY(${imageIds as string[]}::uuid[])
  `
  return new Map(rows.map((row) => [row.id, {
    id: row.id,
    ready: row.ready,
    itemId: row.itemId,
    itemName: catalogText(row.name, languages),
  }]))
}

/** The group a job is about, by its id, or `null` once it is gone. */
export async function readJobGroup(
  sql: postgres.Sql,
  groupId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM groups WHERE id = ${groupId}
  `
  return row ?? null
}

/** One repeating job's last finished run and its waiting run, as the table holds them. */
export interface RepeatingJobRuns {
  kind: string
  lastRunAt: Date | null
  lastFailed: boolean
  nextId: string | null
  nextRunAt: Date | null
  running: boolean
}

/** The last finished run and the waiting run of each of `kinds`, in the order given. */
export async function readRepeatingRuns(
  sql: postgres.Sql,
  kinds: readonly string[],
): Promise<RepeatingJobRuns[]> {
  if (kinds.length === 0) return []
  const rows = await sql<
    {
      kind: string
      lastRunAt: Date | null
      lastFailed: boolean | null
      nextId: string | null
      nextRunAt: Date | null
      running: boolean | null
    }[]
  >`
    SELECT event_kind AS kind,
      max(processed_at) FILTER (WHERE cancelled_at IS NULL) AS last_run_at,
      (array_agg(last_error_code IS NOT NULL ORDER BY processed_at DESC, id DESC)
        FILTER (WHERE processed_at IS NOT NULL AND cancelled_at IS NULL))[1] AS last_failed,
      (array_agg(id ORDER BY available_at) FILTER (WHERE processed_at IS NULL))[1]::text AS next_id,
      min(available_at) FILTER (WHERE processed_at IS NULL) AS next_run_at,
      bool_or(processed_at IS NULL AND ${running(sql)}) AS running
    FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND event_kind = ANY(${kinds as string[]})
    GROUP BY event_kind
  `
  const byKind = new Map(rows.map((row) => [row.kind, row]))
  return kinds.map((kind) => {
    const row = byKind.get(kind)
    return {
      kind,
      lastRunAt: row?.lastRunAt ?? null,
      lastFailed: row?.lastFailed === true,
      nextId: row?.nextId ?? null,
      nextRunAt: row?.nextRunAt ?? null,
      running: row?.running === true,
    }
  })
}

/** Writes the operator's audit row for an action on the job `jobId` of `kind`. */
async function audit(
  sql: postgres.Sql,
  eventKind: string,
  jobId: string,
  kind: string,
  operatorId: number,
  requestId: string | null,
): Promise<void> {
  await sql`
    INSERT INTO audit_events (
      event_kind, actor_user_id, request_id, entity_type, entity_id, details
    ) VALUES (
      ${eventKind}, ${operatorId}, ${requestId}, 'job', ${jobId}, ${sql.json({ kind })}
    )
  `
}

/**
 * Locks the chain of `kind` about `aggregateId` for the rest of the transaction: the same key as
 * `ensureScheduledOutboxEvent` takes, so a worker starting a repeating job and an operator acting
 * on it take turns.
 */
async function lockChain(sql: postgres.Sql, kind: string, aggregateId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${kind}/${JOB_AGGREGATE}/${aggregateId}`}, 0))`
}

/**
 * A row's version as of now, in epoch milliseconds. The outbox writes a repeating job's next run
 * with its run time as its version, and a cron job's next run after an early one is the very time
 * the moved row was first due. So cancel and run now give the row the time of the action, and the
 * next run (written by the worker, or by its start-up after a cancel) never collides with it.
 */
function versionNow(sql: postgres.Sql) {
  return sql`(extract(epoch FROM now()) * 1000)::bigint`
}

/**
 * Cancels the waiting job `id`: marks it processed and cancelled, so no worker claims it and the
 * cleanup removes it a week later, and writes the operator's audit row. Only a row that waits and
 * no worker holds: a running, finished, failed or cancelled one is
 * {@link AdminJobActionOutcome.NotFound}. A cancelled repeating job writes no next run; the worker
 * starts its chain again when it next starts. A kind the registry marks `cannotCancel` is
 * {@link AdminJobActionOutcome.NotCancellable} and stays as it is.
 *
 * Inside a transaction only, so the cancel and its audit row are written together.
 */
export async function cancelJob(
  sql: postgres.Sql,
  id: string,
  operatorId: number,
  requestId: string | null,
  jobs: readonly JobDefinition[] = JOBS,
): Promise<AdminJobActionOutcome> {
  const [found] = await sql<{ kind: string }[]>`
    SELECT event_kind AS kind FROM outbox_events
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
  `
  if (found && jobDefinition(found.kind, jobs)?.cannotCancel) {
    return AdminJobActionOutcome.NotCancellable
  }
  const [row] = await sql<{ kind: string }[]>`
    UPDATE outbox_events
    SET processed_at = now(), cancelled_at = now(), aggregate_version = ${versionNow(sql)}
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
      AND processed_at IS NULL AND NOT ${running(sql)}
    RETURNING event_kind AS kind
  `
  if (!row) return AdminJobActionOutcome.NotFound
  await audit(sql, ADMIN_JOB_CANCELLED_KIND, id, row.kind, operatorId, requestId)
  return AdminJobActionOutcome.Done
}

/**
 * Makes the waiting job `id` due now, so the worker takes it within a moment, and writes the
 * operator's audit row. It moves the row's own due time and writes no row, so a repeating job's
 * chain stays one row and keeps its schedule after this run. Only a row that waits, has attempts
 * left and no worker holds; anything else is {@link AdminJobActionOutcome.NotFound}.
 *
 * Inside a transaction only.
 */
export async function runJobNow(
  sql: postgres.Sql,
  id: string,
  operatorId: number,
  requestId: string | null,
): Promise<AdminJobActionOutcome> {
  const [row] = await sql<{ kind: string }[]>`
    UPDATE outbox_events
    SET available_at = now(), aggregate_version = ${versionNow(sql)}
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
      AND processed_at IS NULL AND attempt_count < ${JOB_RETRY.maxAttempts}
      AND NOT ${running(sql)}
    RETURNING event_kind AS kind
  `
  if (!row) return AdminJobActionOutcome.NotFound
  await audit(sql, ADMIN_JOB_RUN_NOW_KIND, id, row.kind, operatorId, requestId)
  return AdminJobActionOutcome.Done
}

/**
 * Runs the repeating job `kind` now: its waiting run becomes due now, or, when none waits (an
 * operator cancelled it), a run is written for now that starts the chain again. Never a second
 * waiting row: the chain is locked as `ensureScheduledOutboxEvent` locks it, and a chain with a
 * run a worker holds is {@link AdminJobActionOutcome.Superseded}. Writes the operator's audit row.
 * The caller checks that `kind` is a repeating job.
 *
 * Inside a transaction only.
 */
export async function runRepeatingNow(
  sql: postgres.Sql,
  kind: string,
  operatorId: number,
  requestId: string | null,
): Promise<{ outcome: AdminJobActionOutcome; id: string | null }> {
  await lockChain(sql, kind, JOB_AGGREGATE_ID)
  const chain = [JOB_AGGREGATE_ID, LEGACY_JOB_AGGREGATE_ID]
  const [moved] = await sql<{ id: string }[]>`
    UPDATE outbox_events
    SET available_at = now(), aggregate_version = ${versionNow(sql)}
    WHERE event_kind = ${kind} AND aggregate_type = ${JOB_AGGREGATE}
      AND aggregate_id = ANY(${chain}::uuid[])
      AND processed_at IS NULL AND attempt_count < ${JOB_RETRY.maxAttempts}
      AND NOT ${running(sql)}
    RETURNING id
  `
  let id = moved?.id ?? null
  if (!id) {
    const waiting = await sql`
      SELECT 1 FROM outbox_events
      WHERE event_kind = ${kind} AND aggregate_type = ${JOB_AGGREGATE}
        AND aggregate_id = ANY(${chain}::uuid[]) AND processed_at IS NULL
      LIMIT 1
    `
    if (waiting.length > 0) return { outcome: AdminJobActionOutcome.Superseded, id: null }
    id = uuidV7()
    await sql`
      INSERT INTO outbox_events (
        id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at
      )
      SELECT ${id}, ${kind}, ${JOB_AGGREGATE}, ${JOB_AGGREGATE_ID},
        ${versionNow(sql)}, now()
    `
  }
  await audit(sql, ADMIN_JOB_RUN_NOW_KIND, id, kind, operatorId, requestId)
  return { outcome: AdminJobActionOutcome.Done, id }
}

/**
 * Runs the failed job `id` again: it waits for the worker as if new, with its attempts and error
 * reset, and an `audit_events` row names the operator, the request and the job's kind. A row that
 * is no failed job is {@link AdminJobActionOutcome.NotFound}. A job whose next run waits already
 * (a repeating job writes one when it gives up) is {@link AdminJobActionOutcome.Superseded}.
 *
 * Inside a transaction only: the chain and the row are locked from the check to the write, so two
 * operators pressing at once run it once, and the job and its audit row are written together.
 */
export async function retryJob(
  sql: postgres.Sql,
  id: string,
  operatorId: number,
  requestId: string | null,
): Promise<AdminJobActionOutcome> {
  const [found] = await sql<{ kind: string; aggregateId: string }[]>`
    SELECT event_kind AS kind, aggregate_id::text AS aggregate_id FROM outbox_events
    WHERE id = ${id} AND aggregate_type = ${JOB_AGGREGATE}
  `
  if (!found) return AdminJobActionOutcome.NotFound
  await lockChain(sql, found.kind, found.aggregateId)
  const [job] = await sql`
    SELECT 1 FROM outbox_events
    WHERE id = ${id} AND ${givenUp(sql)}
    FOR UPDATE
  `
  if (!job) return AdminJobActionOutcome.NotFound
  const waiting = await sql`
    SELECT 1 FROM outbox_events
    WHERE processed_at IS NULL AND event_kind = ${found.kind} AND id <> ${id}
      AND aggregate_type = ${JOB_AGGREGATE} AND aggregate_id = ${found.aggregateId}
    LIMIT 1
  `
  if (waiting.length > 0) return AdminJobActionOutcome.Superseded
  await sql`
    UPDATE outbox_events
    SET processed_at = NULL, attempt_count = 0, available_at = now(), claimed_at = NULL,
      last_error_code = NULL
    WHERE id = ${id}
  `
  await audit(sql, ADMIN_JOB_RETRIED_KIND, id, found.kind, operatorId, requestId)
  return AdminJobActionOutcome.Done
}

/**
 * Runs again up to `limit` failed jobs, oldest first, each as {@link retryJob} does, with its own
 * audit row. A failed job whose next run waits already is left as it is. Returns how many started.
 *
 * Inside a transaction only.
 */
export async function retryFailedJobs(
  sql: postgres.Sql,
  operatorId: number,
  requestId: string | null,
  limit: number,
): Promise<number> {
  const failed = await sql<{ id: string }[]>`
    SELECT id FROM outbox_events
    WHERE aggregate_type = ${JOB_AGGREGATE} AND ${givenUp(sql)}
    ORDER BY created_at, id
    LIMIT ${limit}
  `
  let retried = 0
  for (const { id } of failed) {
    if (await retryJob(sql, id, operatorId, requestId) === AdminJobActionOutcome.Done) retried++
  }
  return retried
}
