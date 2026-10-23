import type postgres from "postgres"
import { ATTACHMENT_UPLOAD_HOURS } from "@domain/notes"
import { type ServerFiles, STAGING_PREFIX } from "@server/files/files.ts"
import { PostgresAttachmentRepository } from "./postgres-attachment-repository.ts"

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

/**
 * The nightly clean-up of note attachments. It forgets uploads that were signed over
 * {@link ATTACHMENT_UPLOAD_HOURS} hours before `now`, confirmed or not, deletes staging objects
 * older than that, and deletes the objects of removed files (`file_deletions`, filled by the
 * database whenever a file's row goes, a note's or group's purge and an account's deletion
 * included). Running it twice deletes nothing more.
 *
 * `now` is a parameter so a test sets the clock. The worker passes the current time.
 */
export async function cleanUpAttachments(
  sql: postgres.Sql,
  files: Pick<ServerFiles, "delete" | "deleteOlderThan">,
  now: Date = new Date(),
): Promise<AttachmentCleanupResult> {
  const repository = new PostgresAttachmentRepository(sql)
  const uploads = (await repository.removeStaleUploads(now)).length
  const staging = await files.deleteOlderThan(
    STAGING_PREFIX,
    new Date(now.getTime() - ATTACHMENT_UPLOAD_HOURS * 60 * 60_000),
  )
  let deleted = 0
  while (true) {
    const keys = await repository.queuedDeletions(DELETION_BATCH)
    if (keys.length === 0) break
    for (const key of keys) {
      await files.delete(key)
      await repository.forgetDeletion(key)
      deleted++
    }
  }
  return { uploads, staging, deleted }
}
