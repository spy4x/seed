import type postgres from "postgres"
import { assertRoomFor, PlanError } from "@domain/billing"
import {
  assertCanWriteNotes,
  type Attachment,
  ATTACHMENT_EVENTS,
  ATTACHMENT_UPLOAD_HOURS,
  type AttachmentCaps,
  AttachmentError,
  type AttachmentRepository,
  type AttachmentUploadBudget,
  NoteError,
  type PendingAttachmentUpload,
} from "@domain/notes"
import { canManageBilling, type GroupRole, OPERATOR_DETAIL } from "@domain/groups"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { writeAuditEvent } from "@server/groups/audit.ts"
import {
  countPendingUploads,
  reserveUpload,
  settleUpload,
  uploadsInLastHour,
} from "@server/files/upload-ledger.ts"

interface AttachmentRow extends postgres.Row, Attachment {
  objectKey: string
}

const COLUMNS = `note_attachments.id, note_attachments.note_id, note_attachments.name,
  note_attachments.content_type, note_attachments.size_bytes AS size,
  note_attachments.created_by_user_id, note_attachments.created_at, note_attachments.object_key`

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    noteId: row.noteId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  }
}

/** The actor's role, read on the locked rows of the write's own transaction. */
async function lockWriter(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole> {
  try {
    const role = await lockActorRole(sql, groupId, actorId)
    assertCanWriteNotes(role)
    return role as GroupRole
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new NoteError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/**
 * Note attachments in Postgres. A file belongs to a note and is in the note's group; every read
 * joins the note, so a file of another group, or of a deleted note, is never found.
 *
 * `add` counts before its insert, in the transaction that holds the group's row locked
 * (`lockActorRole`), so two confirms into one group wait for each other and the second counts the
 * first. Deleting a row, here or through a note's or group's delete, queues its object in
 * `file_deletions` (a trigger), which the worker empties.
 */
export class PostgresAttachmentRepository implements AttachmentRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async hasLiveNote(groupId: string, noteId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1 FROM notes WHERE id = ${noteId} AND group_id = ${groupId} AND deleted_at IS NULL
    `
    return rows.length > 0
  }

  async list(groupId: string, noteId: string): Promise<Attachment[]> {
    const rows = await this.sql<AttachmentRow[]>`
      SELECT ${this.sql.unsafe(COLUMNS)} FROM note_attachments
      JOIN notes ON notes.id = note_attachments.note_id
      WHERE note_attachments.note_id = ${noteId} AND notes.group_id = ${groupId}
        AND notes.deleted_at IS NULL
      ORDER BY note_attachments.created_at, note_attachments.id
    `
    return rows.map(toAttachment)
  }

  async get(groupId: string, id: string): Promise<(Attachment & { objectKey: string }) | null> {
    const row = (
      await this.sql<AttachmentRow[]>`
        SELECT ${this.sql.unsafe(COLUMNS)} FROM note_attachments
        JOIN notes ON notes.id = note_attachments.note_id
        WHERE note_attachments.id = ${id} AND notes.group_id = ${groupId}
          AND notes.deleted_at IS NULL
      `
    )[0]
    return row ? { ...toAttachment(row), objectKey: row.objectKey } : null
  }

  /** Counts deleted notes' files too: they keep their room until the notes are purged. */
  async usage(groupId: string): Promise<{ files: number; bytes: number }> {
    const [row] = await this.sql<{ files: number; bytes: string }[]>`
      SELECT count(*)::int AS files, coalesce(sum(note_attachments.size_bytes), 0)::text AS bytes
      FROM note_attachments JOIN notes ON notes.id = note_attachments.note_id
      WHERE notes.group_id = ${groupId}
    `
    return { files: row.files, bytes: Number(row.bytes) }
  }

  async countForNote(noteId: string): Promise<number> {
    const [{ count }] = await this.sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM note_attachments WHERE note_id = ${noteId}
    `
    return count
  }

  /** See {@link countPendingUploads}: every feature's waiting uploads count. */
  async countPending(userId: number): Promise<number> {
    return await countPendingUploads(this.sql, userId)
  }

  /** See {@link uploadsInLastHour}: every feature's uploads count. */
  async signedInLastHour(userId: number): Promise<{ files: number; bytes: number }> {
    return await uploadsInLastHour(this.sql, userId)
  }

  async releaseUpload(id: string, userId: number): Promise<void> {
    await settleUpload(this.sql, id, userId, `attachment`)
  }

  async createUpload(
    upload: PendingAttachmentUpload,
    budget: AttachmentUploadBudget,
  ): Promise<void> {
    const refusal = await reserveUpload(this.sql, upload, budget)
    if (refusal === `UPLOADS_PENDING`) {
      throw new AttachmentError("UPLOADS_PENDING", "Finish the uploads already started first")
    }
    if (refusal === `UPLOAD_BUDGET`) {
      throw new AttachmentError(
        "UPLOAD_BUDGET",
        "You have uploaded as much as an hour allows. Try again later",
      )
    }
  }

  async claimUpload(id: string, userId: number): Promise<PendingAttachmentUpload | null> {
    const upload = await settleUpload(this.sql, id, userId, `attachment`)
    return upload && { ...upload, noteId: upload.noteId! }
  }

  async add(
    groupId: string,
    upload: PendingAttachmentUpload,
    objectKey: string,
    caps: AttachmentCaps,
    actorId: number,
  ): Promise<Attachment> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      const role = await lockWriter(tx, groupId, actorId)
      const note = (
        await tx<{ title: string }[]>`
          SELECT title FROM notes
          WHERE id = ${upload.noteId} AND group_id = ${groupId} AND deleted_at IS NULL
          FOR NO KEY UPDATE
        `
      )[0]
      if (!note) throw new NoteError("NOTE_NOT_FOUND", "Note not found")
      const repository = new PostgresAttachmentRepository(tx)
      const before = await repository.usage(groupId)
      const onNote = await repository.countForNote(upload.noteId)
      if (onNote >= caps.maxPerNote) {
        throw new AttachmentError(
          "NOTE_FULL",
          `A note holds up to ${caps.maxPerNote} files`,
          caps.maxPerNote,
        )
      }
      assertRoomFor("maxAttachments", caps.maxFiles, before.files, role)
      if (caps.maxBytes !== null && before.bytes + upload.size > caps.maxBytes) {
        throw new PlanError(
          "PLAN_LIMIT_REACHED",
          "storageBytes",
          caps.maxBytes,
          canManageBilling(role),
          "The group has reached its plan's limit",
        )
      }
      const [row] = await tx<AttachmentRow[]>`
        INSERT INTO note_attachments (
          id, note_id, object_key, name, content_type, size_bytes, created_by_user_id
        ) VALUES (
          ${upload.id}, ${upload.noteId}, ${objectKey}, ${upload.name}, ${upload.contentType},
          ${upload.size}, ${actorId}
        )
        RETURNING ${tx.unsafe(COLUMNS)}
      `
      await recordGroupChange(tx, groupId, actorId, ATTACHMENT_EVENTS.added)
      await writeAuditEvent(tx, {
        eventKind: ATTACHMENT_EVENTS.added,
        actorId,
        groupId,
        entityType: "note",
        entityId: upload.noteId,
        details: { name: upload.name.slice(0, 100), title: note.title.slice(0, 100) },
      })
      return toAttachment(row)
    })
  }

  async remove(groupId: string, id: string, actorId: number, requestId?: string): Promise<string> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      await lockWriter(tx, groupId, actorId)
      const key = await removeAttachmentRow(tx, groupId, id, actorId, { requestId })
      if (key === null) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "File not found")
      return key
    })
  }

  async forgetDeletion(objectKey: string): Promise<void> {
    await this.sql`DELETE FROM file_deletions WHERE object_key = ${objectKey}`
  }

  /** Up to `limit` queued deletions, oldest first. */
  async queuedDeletions(limit: number): Promise<string[]> {
    const rows = await this.sql<{ objectKey: string }[]>`
      SELECT object_key FROM file_deletions ORDER BY queued_at, object_key LIMIT ${limit}
    `
    return rows.map((row) => row.objectKey)
  }

  /**
   * Deletes uploads signed more than {@link ATTACHMENT_UPLOAD_HOURS} hours before `now`, settled or
   * not, and returns their staging keys.
   */
  async removeStaleUploads(now: Date = new Date()): Promise<string[]> {
    const rows = await this.sql<{ stagingKey: string }[]>`
      DELETE FROM file_uploads
      WHERE created_at < ${now}::timestamptz - make_interval(hours => ${ATTACHMENT_UPLOAD_HOURS})
      RETURNING staging_key
    `
    return rows.map((row) => row.stagingKey)
  }
}

/**
 * Deletes one file of the group's live notes (the trigger queues its object), records the change
 * and writes the audit row. An operator's removal (`operator`) also reaches a note in the trash and
 * marks the row as the operator's. Returns the stored key, or `null` when there is no such file.
 * The caller has locked the group and checked who may act.
 */
export async function removeAttachmentRow(
  tx: postgres.TransactionSql,
  groupId: string,
  id: string,
  actorId: number,
  options: { requestId?: string; operator?: boolean } = {},
): Promise<string | null> {
  const operator = options.operator === true
  const row = (
    await tx<{ objectKey: string; name: string; noteId: string; title: string }[]>`
      DELETE FROM note_attachments USING notes
      WHERE note_attachments.id = ${id} AND notes.id = note_attachments.note_id
        AND notes.group_id = ${groupId} AND (notes.deleted_at IS NULL OR ${operator})
      RETURNING note_attachments.object_key, note_attachments.name, note_attachments.note_id,
        notes.title
    `
  )[0]
  if (!row) return null
  try {
    await recordGroupChange(tx, groupId, actorId, ATTACHMENT_EVENTS.removed)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new NoteError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
  await writeAuditEvent(tx, {
    eventKind: ATTACHMENT_EVENTS.removed,
    actorId,
    groupId,
    requestId: options.requestId,
    entityType: "note",
    entityId: row.noteId,
    details: {
      name: row.name.slice(0, 100),
      title: row.title.slice(0, 100),
      ...(operator ? { [OPERATOR_DETAIL]: 1 } : {}),
    },
  })
  return row.objectKey
}
