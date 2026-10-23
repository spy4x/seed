import type postgres from "postgres"
import {
  ATTACHMENT_PENDING_MAX,
  ATTACHMENT_PENDING_MINUTES,
  type AttachmentUploadBudget,
} from "@domain/notes"

/**
 * One signed upload in `file_uploads`, the ledger every feature's uploads share (docs/files.md), so
 * one person's waiting uploads and hourly budget count them all. `noteId` names a note
 * attachment's note; a profile picture's is `null`.
 */
export interface LedgerUpload {
  id: string
  noteId: string | null
  userId: number
  stagingKey: string
  name: string
  contentType: string
  size: number
}

/** Why {@link reserveUpload} kept nothing: too many uploads wait, or the hour's budget is spent. */
export type UploadRefusal = `UPLOADS_PENDING` | `UPLOAD_BUDGET`

/** Which feature's uploads a settle may take: a note attachment's or a profile picture's. */
export type UploadPurpose = `attachment` | `picture`

/**
 * How many uploads the person signed in the last {@link ATTACHMENT_PENDING_MINUTES} minutes and
 * neither confirmed nor cancelled.
 */
export async function countPendingUploads(sql: postgres.Sql, userId: number): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM file_uploads
    WHERE user_id = ${userId} AND settled_at IS NULL
      AND created_at > now() - make_interval(mins => ${ATTACHMENT_PENDING_MINUTES})
  `
  return count
}

/** The uploads the person signed in the last hour, settled or not, and their declared bytes. */
export async function uploadsInLastHour(
  sql: postgres.Sql,
  userId: number,
): Promise<{ files: number; bytes: number }> {
  const [row] = await sql<{ files: number; bytes: string }[]>`
    SELECT count(*)::int AS files, coalesce(sum(size_bytes), 0)::text AS bytes
    FROM file_uploads
    WHERE user_id = ${userId} AND created_at > now() - interval '1 hour'
  `
  return { files: row.files, bytes: Number(row.bytes) }
}

/**
 * Keeps the person's new signed upload, or answers why not. It locks the person's row first and
 * counts after the lock, so signs sent at once wait for each other and each counts the ones before
 * it. Nothing is written when it refuses.
 */
export async function reserveUpload(
  sql: postgres.Sql,
  upload: LedgerUpload,
  budget: AttachmentUploadBudget,
): Promise<UploadRefusal | null> {
  return await sql.begin(async (tx: postgres.TransactionSql) => {
    await tx`SELECT 1 FROM users WHERE id = ${upload.userId} FOR NO KEY UPDATE`
    if (await countPendingUploads(tx, upload.userId) >= ATTACHMENT_PENDING_MAX) {
      return `UPLOADS_PENDING` as const
    }
    const signed = await uploadsInLastHour(tx, upload.userId)
    if (signed.files >= budget.files || signed.bytes + upload.size > budget.bytes) {
      return `UPLOAD_BUDGET` as const
    }
    await tx`
      INSERT INTO file_uploads (
        id, note_id, user_id, staging_key, name, content_type, size_bytes
      ) VALUES (
        ${upload.id}, ${upload.noteId}, ${upload.userId}, ${upload.stagingKey}, ${upload.name},
        ${upload.contentType}, ${upload.size}
      )
    `
    return null
  })
}

/**
 * Settles the person's waiting upload of `purpose` and answers it, so a second confirm or cancel
 * finds nothing. The row stays for the hourly budget. `null` when it is not there, is settled
 * already, is another person's or is another feature's.
 */
export async function settleUpload(
  sql: postgres.Sql,
  id: string,
  userId: number,
  purpose: UploadPurpose,
): Promise<LedgerUpload | null> {
  const ofPurpose = purpose === `picture` ? sql`note_id IS NULL` : sql`note_id IS NOT NULL`
  const [row] = await sql<LedgerUpload[]>`
    UPDATE file_uploads SET settled_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND settled_at IS NULL AND ${ofPurpose}
    RETURNING id, note_id, user_id, staging_key, name, content_type, size_bytes AS size
  `
  return row ?? null
}
