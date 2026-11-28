import type postgres from "postgres"
import { assertRoomFor, PlanError } from "@domain/billing"
import {
  type Attachment,
  type AttachmentCaps,
  AttachmentError,
  attachmentEvents,
  type AttachmentRepository,
  type AttachmentUploadBudget,
  type PendingAttachmentUpload,
} from "@domain/attachments"
import {
  type AuditEntityType,
  canManageBilling,
  type GroupRole,
  OPERATOR_DETAIL,
} from "@domain/groups"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { writeAuditEvent } from "@server/groups/audit.ts"
import { reserveUpload, settleUpload } from "@server/files/upload-ledger.ts"
import { attachmentFiles, type AttachmentKind } from "./kind.ts"

interface AttachmentRow extends postgres.Row {
  id: string
  recordId: string
  name: string
  contentType: string
  size: number
  createdByUserId: number | null
  createdAt: Date
  objectKey: string
}

/** The columns every read returns, from the kind's table as `a`. */
function columns(sql: postgres.Sql, kind: AttachmentKind) {
  return sql`a.id, a.${sql(kind.records.key)} AS record_id, a.name, a.content_type,
    a.size_bytes AS size, a.created_by_user_id, a.created_at, a.object_key`
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    recordId: row.recordId,
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
  kind: AttachmentKind,
  groupId: string,
  actorId: number,
): Promise<GroupRole> {
  let role: GroupRole | null
  try {
    role = await lockActorRole(sql, groupId, actorId)
  } catch (error) {
    if (!(error instanceof GroupNotActiveError)) throw error
    // A group that is gone is answered as for a stranger: the kind's own "group not found".
    role = null
  }
  kind.assertCanWrite(role)
  return role as GroupRole
}

/**
 * The group's files of every kind in `kinds` and their bytes. Counts deleted records' files too:
 * they keep their room until the records are purged.
 */
export async function groupAttachmentUsage(
  sql: postgres.Sql,
  kinds: readonly AttachmentKind[],
  groupId: string,
): Promise<{ files: number; bytes: number }> {
  const [row] = await sql<{ files: number; bytes: string }[]>`
    SELECT count(*)::int AS files, coalesce(sum(f.size_bytes), 0)::text AS bytes
    FROM (${attachmentFiles(sql, kinds)}) f
    WHERE f.group_id = ${groupId}
  `
  return { files: row.files, bytes: Number(row.bytes) }
}

/**
 * One kind's attachments in Postgres. A file belongs to a record and is in the record's group;
 * every read joins the record, so a file of another group, or of a deleted record, is never
 * found. The table and column names come from the kind, which code registers; no request names
 * one.
 *
 * `add` counts before its insert, in the transaction that holds the group's row locked
 * (`lockActorRole`), so two confirms into one group wait for each other and the second counts the
 * first, whatever their kinds. The group's caps count the files of every kind in `kinds`.
 * Deleting a row, here or through its record's or group's delete, queues its object in
 * `file_deletions` (the trigger `queue_attachment_deletion`), which the worker empties.
 */
export class PostgresAttachmentRepository implements AttachmentRepository {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly kind: AttachmentKind,
    /** Every kind the product serves, this one included: the group's caps count them all. */
    private readonly kinds: readonly AttachmentKind[],
  ) {}

  async hasLiveRecord(groupId: string, recordId: string): Promise<boolean> {
    const sql = this.sql
    const rows = await sql`
      SELECT 1 FROM ${sql(this.kind.records.table)}
      WHERE id = ${recordId} AND group_id = ${groupId} AND deleted_at IS NULL
    `
    return rows.length > 0
  }

  async list(groupId: string, recordId: string): Promise<Attachment[]> {
    const sql = this.sql
    const rows = await sql<AttachmentRow[]>`
      SELECT ${columns(sql, this.kind)} FROM ${sql(this.kind.table)} a
      JOIN ${sql(this.kind.records.table)} r ON r.id = a.${sql(this.kind.records.key)}
      WHERE a.${sql(this.kind.records.key)} = ${recordId} AND r.group_id = ${groupId}
        AND r.deleted_at IS NULL
      ORDER BY a.created_at, a.id
    `
    return rows.map(toAttachment)
  }

  async get(groupId: string, id: string): Promise<(Attachment & { objectKey: string }) | null> {
    const sql = this.sql
    const row = (
      await sql<AttachmentRow[]>`
        SELECT ${columns(sql, this.kind)} FROM ${sql(this.kind.table)} a
        JOIN ${sql(this.kind.records.table)} r ON r.id = a.${sql(this.kind.records.key)}
        WHERE a.id = ${id} AND r.group_id = ${groupId} AND r.deleted_at IS NULL
      `
    )[0]
    return row ? { ...toAttachment(row), objectKey: row.objectKey } : null
  }

  async usage(groupId: string): Promise<{ files: number; bytes: number }> {
    return await groupAttachmentUsage(this.sql, this.kinds, groupId)
  }

  async countForRecord(recordId: string): Promise<number> {
    const sql = this.sql
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ${sql(this.kind.table)}
      WHERE ${sql(this.kind.records.key)} = ${recordId}
    `
    return count
  }

  async releaseUpload(id: string, userId: number): Promise<void> {
    await settleUpload(this.sql, id, userId, { recordKind: this.kind.name })
  }

  async createUpload(
    upload: PendingAttachmentUpload,
    budget: AttachmentUploadBudget,
  ): Promise<void> {
    const refusal = await reserveUpload(this.sql, {
      ...upload,
      recordKind: this.kind.name,
    }, budget)
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
    const upload = await settleUpload(this.sql, id, userId, { recordKind: this.kind.name })
    if (!upload) return null
    const { recordKind: _, recordId, ...rest } = upload
    return { ...rest, recordId: recordId! }
  }

  async add(
    groupId: string,
    upload: PendingAttachmentUpload,
    objectKey: string,
    caps: AttachmentCaps,
    actorId: number,
  ): Promise<Attachment> {
    const kind = this.kind
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      const role = await lockWriter(tx, kind, groupId, actorId)
      const record = (
        await tx<{ title: string }[]>`
          SELECT ${tx(kind.records.title)}::text AS title FROM ${tx(kind.records.table)}
          WHERE id = ${upload.recordId} AND group_id = ${groupId} AND deleted_at IS NULL
          FOR NO KEY UPDATE
        `
      )[0]
      if (!record) throw kind.recordNotFound()
      const repository = new PostgresAttachmentRepository(tx, kind, this.kinds)
      const before = await repository.usage(groupId)
      const onRecord = await repository.countForRecord(upload.recordId)
      if (onRecord >= caps.maxPerRecord) {
        throw new AttachmentError(
          "RECORD_FULL",
          `A record holds up to ${caps.maxPerRecord} files`,
          caps.maxPerRecord,
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
        INSERT INTO ${tx(kind.table)} AS a (
          id, ${tx(kind.records.key)}, object_key, name, content_type, size_bytes,
          created_by_user_id
        ) VALUES (
          ${upload.id}, ${upload.recordId}, ${objectKey}, ${upload.name}, ${upload.contentType},
          ${upload.size}, ${actorId}
        )
        RETURNING ${columns(tx, kind)}
      `
      const events = attachmentEvents(kind.name)
      await recordGroupChange(tx, groupId, actorId, events.added)
      await writeAuditEvent(tx, {
        eventKind: events.added,
        actorId,
        groupId,
        entityType: kind.name as AuditEntityType,
        entityId: upload.recordId,
        details: { name: upload.name.slice(0, 100), title: record.title.slice(0, 100) },
      })
      return toAttachment(row)
    })
  }

  async remove(groupId: string, id: string, actorId: number, requestId?: string): Promise<string> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      await lockWriter(tx, this.kind, groupId, actorId)
      const key = await removeAttachmentRow(tx, this.kind, groupId, id, actorId, { requestId })
      if (key === null) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "File not found")
      return key
    })
  }

  async forgetDeletion(objectKey: string): Promise<void> {
    await this.sql`DELETE FROM file_deletions WHERE object_key = ${objectKey}`
  }
}

/**
 * Deletes one file of `kind` on the group's live records (the trigger queues its object), records
 * the change and writes the audit row. An operator's removal (`operator`) also reaches a record in
 * the trash and marks the row as the operator's. Returns the stored key, or `null` when the kind
 * has no such file in the group. The caller has locked the group and checked who may act.
 */
export async function removeAttachmentRow(
  tx: postgres.TransactionSql,
  kind: AttachmentKind,
  groupId: string,
  id: string,
  actorId: number,
  options: { requestId?: string; operator?: boolean } = {},
): Promise<string | null> {
  const operator = options.operator === true
  const key = tx(kind.records.key)
  const row = (
    await tx<{ objectKey: string; name: string; recordId: string; title: string }[]>`
      DELETE FROM ${tx(kind.table)} a USING ${tx(kind.records.table)} r
      WHERE a.id = ${id} AND r.id = a.${key}
        AND r.group_id = ${groupId} AND (r.deleted_at IS NULL OR ${operator})
      RETURNING a.object_key, a.name, a.${key} AS record_id,
        r.${tx(kind.records.title)}::text AS title
    `
  )[0]
  if (!row) return null
  const events = attachmentEvents(kind.name)
  try {
    await recordGroupChange(tx, groupId, actorId, events.removed)
  } catch (error) {
    if (error instanceof GroupNotActiveError) kind.assertCanWrite(null)
    throw error
  }
  await writeAuditEvent(tx, {
    eventKind: events.removed,
    actorId,
    groupId,
    requestId: options.requestId,
    entityType: kind.name as AuditEntityType,
    entityId: row.recordId,
    details: {
      name: row.name.slice(0, 100),
      title: row.title.slice(0, 100),
      ...(operator ? { [OPERATOR_DETAIL]: 1 } : {}),
    },
  })
  return row.objectKey
}
