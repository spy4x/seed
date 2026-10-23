import type postgres from "postgres"
import { type OutboxSchedule, scheduleOutboxEvent } from "@spy4x/server/outbox"

/** The outbox rows that are jobs, not group changes, carry this aggregate type. */
export const JOB_AGGREGATE = "job"

/** A job row names no real thing, so every job of one kind points at the same fixed id. */
export const JOB_AGGREGATE_ID = "00000000-0000-7000-8000-000000000000"

/**
 * The fixed id job rows carried before {@link JOB_AGGREGATE_ID} took the version 7 shape. Stored
 * ids are never rewritten (docs/ids.md), and each nightly run copies its row's id to the next, so
 * a database started before the change keeps its cleanup chain on this id.
 */
export const LEGACY_JOB_AGGREGATE_ID = "00000000-0000-4000-8000-000000000000"

/** The nightly removal of old processed outbox rows. */
export const OUTBOX_CLEANUP_JOB = "outbox.cleanup"

/**
 * Processed outbox rows are kept this long, so a recent change can still be looked at; the nightly
 * cleanup removes older ones (`PostgresOutboxRepository.removeProcessed`).
 */
export const OUTBOX_RETENTION_DAYS = 7

export type { JobHandler } from "@spy4x/server/outbox"

/** When a job runs: at a moment, or a number of milliseconds from now on the database clock. */
export type JobWhen = OutboxSchedule

/**
 * Queues one run of the job `kind` about `aboutId`, the row its handler reads (docs/jobs.md). Pass
 * the transaction of the change that needs the job, so both commit together or neither does. The
 * handler gets `aboutId` as `event.aggregateId` and reads everything else from the database: a job
 * row carries no payload. Returns the job's id.
 *
 * ```ts
 * await sql.begin(async (tx) => {
 *   await tx`INSERT INTO invoices (id) VALUES (${invoiceId})`
 *   await enqueueJob(tx, INVOICE_MAIL_JOB, invoiceId, { inMs: 0 })
 * })
 * ```
 *
 * @throws RangeError when `inMs` is negative or not finite, or `at` is not a valid date.
 */
export async function enqueueJob(
  sql: postgres.Sql,
  kind: string,
  aboutId: string,
  when: JobWhen,
): Promise<string> {
  return await scheduleOutboxEvent(
    sql,
    { eventKind: kind, aggregateType: JOB_AGGREGATE, aggregateId: aboutId },
    when,
  )
}
