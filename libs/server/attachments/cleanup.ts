import type postgres from "postgres"
import { ATTACHMENT_UPLOAD_HOURS } from "@domain/attachments"
import { type ServerFiles, STAGING_PREFIX } from "@server/files/files.ts"

/** What one clean-up run did. */
export interface AttachmentCleanupResult {
  /** Uploads signed and never confirmed, forgotten. */
  uploads: number
  /** Staging objects deleted from the store. */
  staging: number
  /** Removed files' objects deleted from the store. */
  deleted: number
}

/** How many queued deletions one batch takes. */
const DELETION_BATCH = 500

/** Up to `limit` queued deletions, oldest first. */
async function queuedDeletions(sql: postgres.Sql, limit: number): Promise<string[]> {
  const rows = await sql<{ objectKey: string }[]>`
    SELECT object_key FROM file_deletions ORDER BY queued_at, object_key LIMIT ${limit}
  `
  return rows.map((row) => row.objectKey)
}

/**
 * Deletes uploads signed more than {@link ATTACHMENT_UPLOAD_HOURS} hours before `now`, settled or
 * not, whatever their kind, and returns their staging keys.
 */
async function removeStaleUploads(sql: postgres.Sql, now: Date): Promise<string[]> {
  const rows = await sql<{ stagingKey: string }[]>`
    DELETE FROM file_uploads
    WHERE created_at < ${now}::timestamptz - make_interval(hours => ${ATTACHMENT_UPLOAD_HOURS})
    RETURNING staging_key
  `
  return rows.map((row) => row.stagingKey)
}

/**
 * The nightly clean-up of uploaded files, of every attachment kind and the profile pictures. It
 * forgets uploads that were signed over {@link ATTACHMENT_UPLOAD_HOURS} hours before `now`,
 * confirmed or not, deletes staging objects older than that, and deletes the objects of removed
 * files (`file_deletions`, filled by the database whenever a file's row goes, a record's or
 * group's purge and an account's deletion included). Running it twice deletes nothing more.
 *
 * `now` is a parameter so a test sets the clock. The worker passes the current time.
 */
export async function cleanUpAttachments(
  sql: postgres.Sql,
  files: Pick<ServerFiles, "delete" | "deleteOlderThan">,
  now: Date = new Date(),
): Promise<AttachmentCleanupResult> {
  const uploads = (await removeStaleUploads(sql, now)).length
  const staging = await files.deleteOlderThan(
    STAGING_PREFIX,
    new Date(now.getTime() - ATTACHMENT_UPLOAD_HOURS * 60 * 60_000),
  )
  let deleted = 0
  while (true) {
    const keys = await queuedDeletions(sql, DELETION_BATCH)
    if (keys.length === 0) break
    for (const key of keys) {
      await files.delete(key)
      await sql`DELETE FROM file_deletions WHERE object_key = ${key}`
      deleted++
    }
  }
  return { uploads, staging, deleted }
}
