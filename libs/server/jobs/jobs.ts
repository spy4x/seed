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
