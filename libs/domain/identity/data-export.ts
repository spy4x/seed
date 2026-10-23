/**
 * A person's copy of their data (#229, docs/data-export.md): what the profile and the operator
 * area read about one export, and the rules both sides share.
 *
 * @module
 */

/** A person may ask for one export per this many hours. */
export const DATA_EXPORT_COOLDOWN_HOURS = 24

/** A ready file is kept this many days, then deleted. */
export const DATA_EXPORT_KEEP_DAYS = 7

/** An export still not ready this many hours after it was asked for reads as failed. */
export const DATA_EXPORT_FAILED_AFTER_HOURS = 24

const HOUR_MS = 3_600_000

/** Where one export stands. */
export enum DataExportStatus {
  /** The worker has not stored the file yet. */
  Preparing = 1,
  /** The file can be downloaded until `expiresAt`. */
  Ready = 2,
  /** The file was deleted after its days. */
  Expired = 3,
  /** The worker never stored the file. The person may ask again. */
  Failed = 4,
}

/** One export as the profile and the operator area show it. */
export interface DataExportView {
  id: string
  status: DataExportStatus
  requestedAt: Date
  readyAt: Date | null
  expiresAt: Date | null
  sizeBytes: number | null
  /** When the person may ask for the next one. */
  nextRequestAt: Date
}

/** The stored columns {@link dataExportView} reads. */
export interface DataExportRow {
  id: string
  requestedAt: Date
  readyAt: Date | null
  expiresAt: Date | null
  expiredAt: Date | null
  sizeBytes: number | string | null
}

/** The status of `row` at `now`. A file past `expiresAt` is expired even before its job ran. */
export function dataExportStatus(row: DataExportRow, now: Date): DataExportStatus {
  if (row.readyAt) {
    return row.expiredAt || (row.expiresAt && row.expiresAt <= now)
      ? DataExportStatus.Expired
      : DataExportStatus.Ready
  }
  return now.getTime() - row.requestedAt.getTime() >= DATA_EXPORT_FAILED_AFTER_HOURS * HOUR_MS
    ? DataExportStatus.Failed
    : DataExportStatus.Preparing
}

/** `row` as the profile and the operator area read it, at `now`. */
export function dataExportView(row: DataExportRow, now: Date): DataExportView {
  return {
    id: row.id,
    status: dataExportStatus(row, now),
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    nextRequestAt: new Date(row.requestedAt.getTime() + DATA_EXPORT_COOLDOWN_HOURS * HOUR_MS),
  }
}

/** The name the downloaded file is saved under: `my-data-2026-10-23.zip`, the day it was made. */
export function dataExportFileName(readyAt: Date): string {
  return `my-data-${readyAt.toISOString().slice(0, 10)}.zip`
}

/** {@link DataExportView} as JSON carries it: dates as ISO 8601 strings. */
export interface DataExportJson {
  id: string
  status: DataExportStatus
  requestedAt: string
  readyAt: string | null
  expiresAt: string | null
  sizeBytes: number | null
  nextRequestAt: string
}

/** Reads a {@link DataExportJson} back into a view; the API wrote it, so it is trusted. */
export function parseDataExportJson(json: DataExportJson): DataExportView {
  return {
    ...json,
    requestedAt: new Date(json.requestedAt),
    readyAt: json.readyAt === null ? null : new Date(json.readyAt),
    expiresAt: json.expiresAt === null ? null : new Date(json.expiresAt),
    nextRequestAt: new Date(json.nextRequestAt),
  }
}
