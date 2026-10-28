/**
 * The worker's side of a person's data export (#229, docs/data-export.md): building the ZIP,
 * storing it, telling the person, and deleting the file when its days are over.
 *
 * @module
 */

import type postgres from "postgres"
import { Zip, ZipDeflate } from "fflate"
import type { EmailSender } from "@spy4x/email/sender"
import { type CsvColumn, csvHeaderRow, csvRow } from "@spy4x/platform/universal/csv"
import { DATA_EXPORT_KEEP_DAYS } from "@domain/identity"
import { NotificationKind } from "@domain/notifications"
import { DATA_EXPORT_PREFIX, dataExportKey } from "../auth/data-export.ts"
import type { ServerFiles } from "../files/files.ts"
import { dataExportReadyMail, type MailBrand } from "../mail/mail.ts"
import { readMailReader } from "../mail/reader.ts"
import { createNotification } from "../notifications/create-notification.ts"
import { DATA_EXPORT_SECTIONS, type DataExportSection } from "./data-export-sections.ts"
import { enqueueJob, type JobHandler } from "./jobs.ts"

export { DATA_EXPORT_BUILD_JOB } from "../auth/data-export.ts"

/** The job that mails the person that the file is ready. Its `aboutId` is the export's id. */
export const DATA_EXPORT_MAIL_JOB = `account.data-export-mail`

/** The job that deletes the file once its days are over. Its `aboutId` is the export's id. */
export const DATA_EXPORT_EXPIRE_JOB = `account.data-export-expire`

/** The JSON file's `format`, so a reader knows what it holds. */
export const DATA_EXPORT_FORMAT = `seed.data-export`

/** Rows read from the database per round trip: the export never holds a whole table. */
const CURSOR_ROWS = 500

const DAY_MS = 86_400_000

const README = `Your data, as this app keeps it.

data.json holds everything in one file. Each CSV file holds one kind of row: the same rows as the
section of data.json with its name. Dates and times are ISO 8601 in UTC. CSV files are UTF-8 with a
header row.

Notes and tags are the ones you created in the groups you belong to. Other people's notes, and
their names and addresses, are not here.
`

/** A cell as the export writes it: an ISO 8601 date, a JSON text for an object, or the value. */
function plain(value: unknown): string | number | boolean | null | object {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === `bigint`) return value.toString()
  return value as string | number | boolean | object
}

/** One row with exactly the section's columns, in its order. */
function pick(section: DataExportSection, row: postgres.Row): Record<string, unknown> {
  return Object.fromEntries(section.columns.map((column) => [column, plain(row[column])]))
}

function csvColumns(section: DataExportSection): CsvColumn<Record<string, unknown>>[] {
  return section.columns.map((column) => ({
    key: column,
    header: column,
    format: (value) =>
      value === null ? `` : typeof value === `object` ? JSON.stringify(value) : String(value),
  }))
}

/**
 * Builds user `userId`'s export as ZIP bytes: `README.txt`, `data.json` with every section, and
 * one CSV file per section. Every section is read twice, for the JSON and for its CSV file, inside
 * one read-only repeatable-read transaction, so both copies show the same moment. Rows come by
 * cursor and go into the ZIP as they arrive; only the compressed bytes are held.
 */
export async function buildDataExport(
  sql: postgres.Sql,
  userId: number,
  now: Date,
  sections: readonly DataExportSection[] = DATA_EXPORT_SECTIONS,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let failure: Error | null = null
  const zip = new Zip((error, chunk) => {
    if (error) failure = error
    else chunks.push(chunk)
  })
  const encoder = new TextEncoder()
  const file = (name: string) => {
    const entry = new ZipDeflate(name, { level: 6 })
    entry.mtime = now
    zip.add(entry)
    return {
      write: (text: string) => entry.push(encoder.encode(text)),
      end: () => entry.push(new Uint8Array(0), true),
    }
  }

  const readme = file(`README.txt`)
  readme.write(README)
  readme.end()

  await sql.begin(`ISOLATION LEVEL REPEATABLE READ READ ONLY`, async (tx) => {
    const json = file(`data.json`)
    json.write(
      `{"format":${JSON.stringify(DATA_EXPORT_FORMAT)},"version":1,` +
        `"exportedAt":${JSON.stringify(now.toISOString())},"sections":{`,
    )
    for (const [index, section] of sections.entries()) {
      json.write(`${index === 0 ? `` : `,`}${JSON.stringify(section.name)}:[`)
      let first = true
      for await (const rows of section.rows(tx, userId).cursor(CURSOR_ROWS)) {
        for (const row of rows) {
          json.write(`${first ? `` : `,`}${JSON.stringify(pick(section, row))}`)
          first = false
        }
      }
      json.write(`]`)
    }
    json.write(`}}\n`)
    json.end()

    for (const section of sections) {
      const columns = csvColumns(section)
      const csv = file(`${section.name}.csv`)
      csv.write(`﻿${csvHeaderRow(columns)}\r\n`)
      for await (const rows of section.rows(tx, userId).cursor(CURSOR_ROWS)) {
        for (const row of rows) csv.write(`${csvRow(columns, pick(section, row))}\r\n`)
      }
      csv.end()
    }
  })
  zip.end()
  if (failure) throw failure

  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/** What the build job needs. */
export interface DataExportJobDeps {
  sql: postgres.Sql
  /** `null` when the worker has no file store settings: the job fails and is retried. */
  files: ServerFiles | null
  now?: () => Date
}

/**
 * Builds the export the job names and stores it, then, in one transaction, marks it ready, tells
 * the person in the inbox, and queues the mail and the file's deletion. An export that is gone (the
 * account was deleted) or already ready does nothing, so a job that runs again changes nothing; a
 * crash between the upload and the transaction only writes the same file again.
 */
export function dataExportBuildJob(deps: DataExportJobDeps): JobHandler {
  const now = deps.now ?? (() => new Date())
  return async (event) => {
    const id = event.aggregateId
    const [row] = await deps.sql<{ userId: number; readyAt: Date | null }[]>`
      SELECT user_id, ready_at FROM data_exports WHERE id = ${id}
    `
    if (!row || row.readyAt) return
    if (!deps.files) throw new Error(`the worker has no file store settings`)
    const at = now()
    const bytes = await buildDataExport(deps.sql, row.userId, at)
    await deps.files.put(dataExportKey(id), bytes)
    const expiresAt = new Date(at.getTime() + DATA_EXPORT_KEEP_DAYS * DAY_MS)
    await deps.sql.begin(async (tx) => {
      const marked = await tx`
        UPDATE data_exports
        SET ready_at = ${at}, expires_at = ${expiresAt}, size_bytes = ${bytes.length}
        WHERE id = ${id} AND ready_at IS NULL
        RETURNING id
      `
      if (marked.length === 0) return
      await createNotification(tx, {
        userId: row.userId,
        kind: NotificationKind.DataExportReady,
        payload: { expiresAt: expiresAt.toISOString() },
        link: `/profile/account`,
      })
      await enqueueJob(tx, DATA_EXPORT_MAIL_JOB, id, { inMs: 0 })
      await enqueueJob(tx, DATA_EXPORT_EXPIRE_JOB, id, { at: expiresAt })
    })
  }
}

/** What the ready mail job needs. */
export interface DataExportMailDeps {
  sql: postgres.Sql
  /** `null` when mail is off: nothing is sent. */
  sender: EmailSender | null
  brand: MailBrand
  /** Told when a send fails or there is no proven address; gets no address. */
  log: (line: string) => void
}

/**
 * Mails the person's first proven address that their export is ready, while it still is. An
 * address nobody proved gets nothing, as for the account mails; the inbox notice still tells them.
 * A failed send throws, so the job is retried.
 */
export function dataExportMailJob(deps: DataExportMailDeps): JobHandler {
  return async (event) => {
    if (!deps.sender) return
    const [found] = await deps.sql<{ expiresAt: Date; email: string | null; userId: number }[]>`
      SELECT data_exports.expires_at, data_exports.user_id AS "userId", (
        SELECT auth_keys.proven_email FROM auth_keys
        WHERE auth_keys.user_id = data_exports.user_id AND auth_keys.proven_email IS NOT NULL
        ORDER BY auth_keys.id
        LIMIT 1
      ) AS email
      FROM data_exports
      WHERE data_exports.id = ${event.aggregateId} AND data_exports.expired_at IS NULL
        AND data_exports.expires_at > now()
    `
    if (!found) return
    if (!found.email) {
      deps.log(`warn: a data export mail was not sent: the account has no proven address`)
      return
    }
    const result = await deps.sender.send(
      dataExportReadyMail(deps.brand, {
        to: found.email,
        expiresAt: found.expiresAt,
        reader: await readMailReader(deps.sql, found.userId),
      }),
    )
    if (!result.ok) {
      deps.log(`error: a data export mail was not sent and will be retried`)
      throw new Error(`data export mail not sent`)
    }
  }
}

/**
 * Deletes the export's file and marks the row expired. The key is deleted even when the row is
 * gone, so a deleted account's file goes on time too.
 */
export function dataExportExpireJob(deps: DataExportJobDeps): JobHandler {
  return async (event) => {
    if (!deps.files) throw new Error(`the worker has no file store settings`)
    await deps.files.delete(dataExportKey(event.aggregateId))
    await deps.sql`
      UPDATE data_exports SET expired_at = now()
      WHERE id = ${event.aggregateId} AND expired_at IS NULL
    `
  }
}

/**
 * The nightly safety net: deletes every export file older than its days and a day more, and marks
 * the rows past `expires_at` expired. It catches a file whose expiry job was lost, such as after
 * the public demo's wipe. Without a file store it does nothing.
 */
export async function removeExpiredDataExports(
  sql: postgres.Sql,
  files: ServerFiles | null,
  now: Date = new Date(),
): Promise<number> {
  if (!files) return 0
  const removed = await files.deleteOlderThan(
    DATA_EXPORT_PREFIX,
    new Date(now.getTime() - (DATA_EXPORT_KEEP_DAYS + 1) * DAY_MS),
  )
  await sql`
    UPDATE data_exports SET expired_at = now()
    WHERE expired_at IS NULL AND expires_at <= ${now}
  `
  return removed
}
