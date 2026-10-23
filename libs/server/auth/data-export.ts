/**
 * A person's data exports (#229, docs/data-export.md): asking for one, reading where it stands and
 * finding the file to download. The worker builds the file (`libs/server/jobs/data-export.ts`).
 * Every call takes the person's own id and reads only their rows.
 *
 * @module
 */

import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  DATA_EXPORT_COOLDOWN_HOURS,
  dataExportFileName,
  type DataExportRow,
  DataExportStatus,
  type DataExportView,
  dataExportView,
} from "@domain/identity"
import { enqueueJob } from "../jobs/jobs.ts"

/** The job that builds one export's file. Its `aboutId` is the export's id. */
export const DATA_EXPORT_BUILD_JOB = `account.data-export`

/** Where an export's file is kept in the file store. */
export function dataExportKey(id: string): string {
  return `data-exports/${id}.zip`
}

/** The prefix every export's file shares, for the nightly safety net. */
export const DATA_EXPORT_PREFIX = `data-exports/`

const columns = (sql: postgres.Sql) =>
  sql`id, requested_at, ready_at, expires_at, expired_at, size_bytes`

/** The outcome of {@link requestDataExport}. */
export type DataExportRequestResult =
  | { success: true; output: DataExportView; error?: undefined }
  /** One was asked for in the last day; `output` is that one, and when the next may be asked. */
  | { success: false; output: DataExportView; error: `TOO_SOON` }

/**
 * Asks for a new export of user `userId` and queues its build, in one transaction. The person's
 * `users` row is locked first, so two requests at once make one row: the second waits, then finds
 * the first and is refused with it. An export asked for within {@link DATA_EXPORT_COOLDOWN_HOURS}
 * refuses a new one, whatever its status.
 */
export async function requestDataExport(
  sql: postgres.Sql,
  userId: number,
  now: () => Date = () => new Date(),
): Promise<DataExportRequestResult> {
  return await sql.begin(async (tx: postgres.TransactionSql) => {
    await tx`SELECT 1 FROM users WHERE id = ${userId} FOR UPDATE`
    const [recent] = await tx<DataExportRow[]>`
      SELECT ${columns(tx)} FROM data_exports
      WHERE user_id = ${userId}
        AND requested_at > now() - make_interval(hours => ${DATA_EXPORT_COOLDOWN_HOURS})
      ORDER BY requested_at DESC
      LIMIT 1
    `
    if (recent) return { success: false, output: dataExportView(recent, now()), error: `TOO_SOON` }
    const id = uuidV7()
    const [created] = await tx<DataExportRow[]>`
      INSERT INTO data_exports (id, user_id) VALUES (${id}, ${userId})
      RETURNING ${columns(tx)}
    `
    await enqueueJob(tx, DATA_EXPORT_BUILD_JOB, id, { inMs: 0 })
    return { success: true, output: dataExportView(created, now()) }
  })
}

/** The person's newest export, or `null` when they never asked for one. */
export async function latestDataExport(
  sql: postgres.Sql,
  userId: number,
  now: Date = new Date(),
): Promise<DataExportView | null> {
  const [row] = await sql<DataExportRow[]>`
    SELECT ${columns(sql)} FROM data_exports
    WHERE user_id = ${userId}
    ORDER BY requested_at DESC
    LIMIT 1
  `
  return row ? dataExportView(row, now) : null
}

/** The most exports the operator area lists of one person, newest first. */
export const ADMIN_DATA_EXPORTS_LIMIT = 50

/** The person's exports for the operator area: what and when, never the file. */
export async function listDataExports(
  sql: postgres.Sql,
  userId: number,
  now: Date = new Date(),
): Promise<DataExportView[]> {
  const rows = await sql<DataExportRow[]>`
    SELECT ${columns(sql)} FROM data_exports
    WHERE user_id = ${userId}
    ORDER BY requested_at DESC
    LIMIT ${ADMIN_DATA_EXPORTS_LIMIT}
  `
  return rows.map((row) => dataExportView(row, now))
}

/** What a download signs: the file's key and the name it is saved under. */
export interface DataExportFile {
  key: string
  filename: string
}

/**
 * The file of the person's newest export, when it is ready. Only the newest: a person who asked
 * again downloads the new file once it is ready, never an older one.
 */
export async function readyDataExportFile(
  sql: postgres.Sql,
  userId: number,
  now: Date = new Date(),
): Promise<DataExportFile | null> {
  const [row] = await sql<DataExportRow[]>`
    SELECT ${columns(sql)} FROM data_exports
    WHERE user_id = ${userId}
    ORDER BY requested_at DESC
    LIMIT 1
  `
  if (!row || dataExportView(row, now).status !== DataExportStatus.Ready) return null
  return { key: dataExportKey(row.id), filename: dataExportFileName(row.readyAt!) }
}
