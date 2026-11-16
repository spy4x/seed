import type postgres from "postgres"
import {
  ADMIN_IMPORT_FILTER_STATUS,
  ADMIN_IMPORT_STATUS_FILTERS,
  ADMIN_IMPORTS_PAGE_SIZE,
  type AdminImportFilter,
  type AdminImportRow,
  type AdminImportStatusFilter,
  ImportStatus,
} from "@domain/imports"

/** One page of the operator area's import list, and the count of each chip. */
export interface AdminImportPage {
  imports: AdminImportRow[]
  counts: Record<AdminImportStatusFilter, number>
  total: number
}

interface Raw {
  id: string
  groupId: string
  groupName: string
  kind: string
  status: ImportStatus
  uploaderId: number
  rowCount: number | null
  savedCount: number | null
  errorCount: number | null
  skippedCount: number | null
  failure: string | null
  createdAt: Date
  readAt: Date | null
  failedAt: Date | null
  commitRequestedAt: Date | null
  committedAt: Date | null
  undoneAt: Date | null
}

const iso = (at: Date | null) => at?.toISOString() ?? null
const between = (from: Date | null, to: Date | null) =>
  from && to ? to.getTime() - from.getTime() : null

/** A row as the admin list shows it: the read and the save each timed. */
export function toAdminImportRow(raw: Raw): AdminImportRow {
  const saving = raw.commitRequestedAt !== null
  return {
    id: raw.id,
    group: { id: raw.groupId, name: raw.groupName },
    kind: raw.kind,
    status: raw.status,
    uploaderId: raw.uploaderId,
    rowCount: raw.rowCount,
    savedCount: raw.savedCount,
    errorCount: raw.errorCount,
    skippedCount: raw.skippedCount,
    failure: raw.failure,
    createdAt: raw.createdAt.toISOString(),
    readAt: iso(raw.readAt),
    failedAt: iso(raw.failedAt),
    commitRequestedAt: iso(raw.commitRequestedAt),
    committedAt: iso(raw.committedAt),
    undoneAt: iso(raw.undoneAt),
    // A read that failed ends at its failure; a save that failed, at its own. A save needs a read
    // import, so a save always has `readAt`.
    readMs: between(raw.createdAt, raw.readAt ?? raw.failedAt),
    saveMs: saving ? between(raw.commitRequestedAt, raw.committedAt ?? raw.failedAt) : null,
  }
}

/**
 * One page of every group's imports, newest first, with the count of each status chip. It selects
 * no file, file name, cells, options, choices or kept rows: the columns below are all an operator gets.
 * The counts read the whole table, which keeps saved and undone imports until their group or
 * uploader goes: one row per file a person brought in, the same scan the Jobs list's counts make.
 */
export async function listAdminImports(
  sql: postgres.Sql,
  filter: AdminImportFilter,
): Promise<AdminImportPage> {
  const byStatus = await sql<{ status: ImportStatus; count: number }[]>`
    SELECT status, count(*)::int AS count FROM imports GROUP BY status
  `
  const counts = Object.fromEntries(ADMIN_IMPORT_STATUS_FILTERS.map((name) => {
    const wanted = ADMIN_IMPORT_FILTER_STATUS[name]
    const count = byStatus
      .filter((row) => wanted === null || row.status === wanted)
      .reduce((sum, row) => sum + row.count, 0)
    return [name, count]
  })) as Record<AdminImportStatusFilter, number>
  const wanted = ADMIN_IMPORT_FILTER_STATUS[filter.status]
  const rows = await sql<Raw[]>`
    SELECT imports.id, imports.group_id::text AS group_id, groups.name AS group_name,
      imports.kind, imports.status, imports.user_id AS uploader_id, imports.row_count,
      imports.saved_count, imports.error_count, imports.skipped_count, imports.failure,
      imports.created_at, imports.read_at, imports.failed_at, imports.commit_requested_at,
      imports.committed_at, imports.undone_at
    FROM imports JOIN groups ON groups.id = imports.group_id
    WHERE ${wanted === null ? sql`TRUE` : sql`imports.status = ${wanted}`}
    ORDER BY imports.created_at DESC, imports.id DESC
    LIMIT ${ADMIN_IMPORTS_PAGE_SIZE} OFFSET ${(filter.page - 1) * ADMIN_IMPORTS_PAGE_SIZE}
  `
  return { imports: rows.map(toAdminImportRow), counts, total: counts[filter.status] }
}
