import type postgres from "postgres"
import { PlanError, UNLIMITED } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  assertCanSeeImport,
  IMPORT_EVENTS,
  IMPORT_LIST_MAX,
  ImportError,
  type ImportMapping,
  ImportStatus,
  type ImportSummary,
} from "@domain/imports"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { enqueueJob } from "@server/jobs/jobs.ts"
import { type ImportKind, kindOf } from "./import-kind.ts"

/** The job that reads an uploaded file. Its row's `aggregateId` is the import's id. */
export const IMPORT_READ_JOB = "imports.read"

/** The job that saves an import's rows. Its row's `aggregateId` is the import's id. */
export const IMPORT_COMMIT_JOB = "imports.commit"

/** Every column of an import but the file, as {@link toSummary} reads them. */
interface ImportRow extends postgres.Row {
  id: string
  groupId: string
  kind: string
  status: ImportStatus
  userId: number
  fileName: string
  fileSize: number
  columnsJson: string | null
  sampleJson: string | null
  mappingJson: string | null
  rowCount: number | null
  savedCount: number | null
  errorCount: number | null
  failure: string | null
  createdAt: Date
  readAt: Date | null
  failedAt: Date | null
  commitRequestedAt: Date | null
  committedAt: Date | null
  undoneAt: Date | null
}

/** What an upload stores. */
export interface ImportCreateInput {
  id: string
  groupId: string
  kind: string
  fileName: string
  file: Uint8Array
}

/**
 * The columns {@link ImportRow} names. The JSON columns are read as text: the pool's camel-case
 * transform would rename the keys inside them, and a field key is the kind's, not ours.
 */
function columns(sql: postgres.Sql) {
  return sql`
    imports.id, imports.group_id AS "groupId", imports.kind, imports.status,
    imports.user_id AS "userId", imports.file_name AS "fileName", imports.file_size AS "fileSize",
    imports.columns::text AS "columnsJson", imports.sample::text AS "sampleJson",
    imports.mapping::text AS "mappingJson", imports.row_count AS "rowCount",
    imports.saved_count AS "savedCount", imports.error_count AS "errorCount", imports.failure,
    imports.created_at AS "createdAt", imports.read_at AS "readAt", imports.failed_at AS "failedAt",
    imports.commit_requested_at AS "commitRequestedAt", imports.committed_at AS "committedAt",
    imports.undone_at AS "undoneAt"
  `
}

/** An import as the API answers it, with the kind's fields; the preview only when asked for. */
export function toSummary(
  row: ImportRow,
  kinds: readonly ImportKind[],
  withPreview = true,
): ImportSummary {
  const kind = kinds.find((one) => one.id === row.kind)
  return {
    id: row.id,
    groupId: row.groupId,
    kind: row.kind,
    status: row.status,
    userId: row.userId,
    fileName: row.fileName,
    fileSize: row.fileSize,
    fields: kind ? kind.fields.map((field) => ({ ...field })) : [],
    preview: withPreview && row.mappingJson !== null
      ? {
        columns: JSON.parse(row.columnsJson ?? `null`),
        sample: JSON.parse(row.sampleJson ?? `[]`),
        mapping: JSON.parse(row.mappingJson),
      }
      : null,
    rowCount: row.rowCount,
    savedCount: row.savedCount,
    errorCount: row.errorCount,
    failure: row.failure,
    createdAt: row.createdAt,
    readAt: row.readAt,
    failedAt: row.failedAt,
    commitRequestedAt: row.commitRequestedAt,
    committedAt: row.committedAt,
    undoneAt: row.undoneAt,
  }
}

/**
 * Records an import's step on its group's change log, so every member's socket gets a hint and
 * the import's screen reads it again. A deleted group takes no change, and nobody is left to tell.
 */
export async function announceImport(
  tx: postgres.TransactionSql,
  groupId: string,
  actorId: number,
  eventKind: string,
): Promise<string | null> {
  try {
    return await recordGroupChange(tx, groupId, actorId, eventKind)
  } catch (error) {
    if (error instanceof GroupNotActiveError) return null
    throw error
  }
}

/**
 * Locks the group for a write and reads the actor's role in it, in the write's own transaction
 * (`lockActorRole`). A deleted group is `GROUP_NOT_FOUND`; a person outside it gets `null`.
 */
export async function lockRole(
  tx: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole | null> {
  try {
    return await lockActorRole(tx, groupId, actorId)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new ImportError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
}

/**
 * Refuses unless the person with `role` may see the import (`assertCanSeeImport`) and create the
 * kind's records. Answers the role, known to be a member's.
 */
export function assertMayAct(
  role: GroupRole | null,
  kind: ImportKind,
  importUserId: number,
  actorId: number,
): GroupRole {
  assertCanSeeImport(role, importUserId, actorId)
  if (!kind.canCreate(role!)) {
    throw new ImportError("ROLE_INSUFFICIENT", `Your role cannot add ${kind.label.toLowerCase()}`)
  }
  return role!
}

/** Why a save or an undo stopped, in words, or `null` for a fault worth another try. */
export function refusalText(error: unknown, label: string): string | null {
  if (error instanceof PlanError) {
    return `The group's plan has no room for these ${label.toLowerCase()}` +
      (error.limit === null ? `.` : ` (it allows ${error.limit}).`)
  }
  if (error instanceof ImportError) return error.message
  return null
}

/**
 * Imports in Postgres: the uploads, their reads and their saves (`docs/imports.md`). Every write
 * checks the actor's role again in its own transaction and records the step on the group's change
 * log. The jobs are in `./import-jobs.ts`.
 */
export class PostgresImportRepository {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly kinds: readonly ImportKind[],
  ) {}

  /** Stores an upload with its file and queues its read. */
  async create(
    input: ImportCreateInput,
    actorId: number,
    kind: ImportKind,
  ): Promise<ImportSummary> {
    return await this.sql.begin(async (tx) => {
      assertMayAct(await lockRole(tx, input.groupId, actorId), kind, actorId, actorId)
      const [row] = await tx<ImportRow[]>`
        INSERT INTO imports (id, group_id, user_id, kind, status, file_name, file_size, file)
        VALUES (
          ${input.id}, ${input.groupId}, ${actorId}, ${input.kind}, ${ImportStatus.READING},
          ${input.fileName}, ${input.file.byteLength}, ${input.file}
        )
        RETURNING ${columns(tx)}
      `
      await enqueueJob(tx, IMPORT_READ_JOB, input.id, { inMs: 0 })
      await announceImport(tx, input.groupId, actorId, IMPORT_EVENTS.created)
      return toSummary(row, this.kinds)
    })
  }

  /** The import `id` of the group, or `null`. Never its file. */
  async get(groupId: string, id: string): Promise<ImportSummary | null> {
    const [row] = await this.sql<ImportRow[]>`
      SELECT ${columns(this.sql)} FROM imports WHERE id = ${id} AND group_id = ${groupId}
    `
    return row ? toSummary(row, this.kinds) : null
  }

  /** The person's own imports in the group, newest first, without previews. */
  async listForUser(groupId: string, userId: number): Promise<ImportSummary[]> {
    const rows = await this.sql<ImportRow[]>`
      SELECT ${columns(this.sql)} FROM imports
      WHERE group_id = ${groupId} AND user_id = ${userId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${IMPORT_LIST_MAX}
    `
    return rows.map((row) => toSummary(row, this.kinds, false))
  }

  /** The stored file of import `id`, or `null` once it is gone. */
  async file(id: string): Promise<Uint8Array | null> {
    const [row] = await this.sql<{ file: Uint8Array | null }[]>`
      SELECT file FROM imports WHERE id = ${id}
    `
    return row?.file ?? null
  }

  /**
   * Saves a read import under `mapping`: stores the mapping and queues the commit job. Asking again
   * while it saves, or once it is saved, changes nothing and answers the import as it is.
   */
  async requestCommit(
    groupId: string,
    id: string,
    actorId: number,
    mapping: ImportMapping,
  ): Promise<ImportSummary> {
    return await this.sql.begin(async (tx) => {
      const { row } = await this.lockVisible(tx, groupId, id, actorId)
      if (row.status === ImportStatus.COMMITTING || row.status === ImportStatus.COMMITTED) {
        return toSummary(row, this.kinds)
      }
      if (row.status !== ImportStatus.READY) throw notReady(row.status)
      const [updated] = await tx<ImportRow[]>`
        UPDATE imports SET status = ${ImportStatus.COMMITTING}, mapping = ${tx.json(mapping)},
          commit_requested_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING ${columns(tx)}
      `
      await enqueueJob(tx, IMPORT_COMMIT_JOB, id, { inMs: 0 })
      await announceImport(tx, groupId, actorId, IMPORT_EVENTS.committing)
      return toSummary(updated, this.kinds)
    })
  }

  /**
   * Removes every record a saved import made, through the kind's `undo`, in one transaction.
   * Undoing again answers the import as it is.
   */
  async undo(
    groupId: string,
    id: string,
    actorId: number,
  ): Promise<ImportSummary> {
    return await this.sql.begin(async (tx) => {
      const { row, role, kind } = await this.lockVisible(tx, groupId, id, actorId)
      if (row.status === ImportStatus.UNDONE) return toSummary(row, this.kinds)
      if (row.status !== ImportStatus.COMMITTED) throw notReady(row.status)
      const records = await tx<{ recordId: string }[]>`
        SELECT record_id AS "recordId" FROM import_records WHERE import_id = ${id} ORDER BY record_id
      `
      const sequence = await announceImport(tx, groupId, actorId, IMPORT_EVENTS.undone)
      if (sequence === null) throw new ImportError("GROUP_NOT_FOUND", "Group not found")
      await kind.undo(tx, records.map((record) => record.recordId), {
        importId: id,
        groupId,
        actorId,
        role,
        changeSequence: sequence,
        // An undo adds nothing, so no cap applies.
        allowances: UNLIMITED.limits,
      })
      const [updated] = await tx<ImportRow[]>`
        UPDATE imports SET status = ${ImportStatus.UNDONE}, undone_at = CURRENT_TIMESTAMP
        WHERE id = ${id}
        RETURNING ${columns(tx)}
      `
      return toSummary(updated, this.kinds)
    })
  }

  /**
   * Locks import `id` for a write after checking, on the locked group, that the actor may see it
   * and create its kind's records. A missing import and one the actor may not see read alike.
   */
  private async lockVisible(
    tx: postgres.TransactionSql,
    groupId: string,
    id: string,
    actorId: number,
  ): Promise<{ row: ImportRow; role: GroupRole; kind: ImportKind }> {
    // The group check comes first, so a stranger learns nothing about which ids exist.
    const role = await lockRole(tx, groupId, actorId)
    assertCanSeeImport(role, actorId, actorId)
    const [row] = await tx<ImportRow[]>`
      SELECT ${columns(tx)} FROM imports WHERE id = ${id} AND group_id = ${groupId} FOR UPDATE
    `
    if (!row) throw new ImportError("ITEM_NOT_FOUND", "Import not found")
    const kind = kindOf(this.kinds, row.kind)
    return { row, role: assertMayAct(role, kind, row.userId, actorId), kind }
  }
}

/** The refusal of a step the import's status does not allow. */
function notReady(status: ImportStatus): ImportError {
  const words: Record<ImportStatus, string> = {
    [ImportStatus.READING]: `The file is still being read`,
    [ImportStatus.READY]: `The import is not saved yet`,
    [ImportStatus.FAILED]: `The import failed`,
    [ImportStatus.COMMITTING]: `The import is being saved`,
    [ImportStatus.COMMITTED]: `The import is saved already`,
    [ImportStatus.UNDONE]: `The import was undone`,
  }
  return new ImportError("VERSION_CONFLICT", words[status])
}
