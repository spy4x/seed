import type postgres from "postgres"

/** The outbox rows that are jobs, not group changes, carry this aggregate type. */
export const JOB_AGGREGATE = "job"

/** A job row names no real thing, so every job of one kind points at the same fixed id. */
export const JOB_AGGREGATE_ID = "00000000-0000-4000-8000-000000000000"

/** The nightly removal of old processed outbox rows. */
export const OUTBOX_CLEANUP_JOB = "outbox.cleanup"

/** Processed outbox rows are kept this long, so a recent change can still be looked at. */
export const OUTBOX_RETENTION_DAYS = 7

export type { JobHandler } from "@spy4x/server/outbox"

/**
 * Deletes outbox rows processed more than {@link OUTBOX_RETENTION_DAYS} days ago and returns how
 * many. Every group change leaves a row, so without this the table only grows. Unprocessed rows,
 * including a job waiting for its time, are never touched.
 */
export async function removeProcessedOutboxEvents(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM outbox_events
    WHERE processed_at < now() - make_interval(days => ${OUTBOX_RETENTION_DAYS})
  `
  return removed.count
}
