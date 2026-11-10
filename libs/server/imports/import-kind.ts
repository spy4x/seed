import type postgres from "postgres"
import type { LimitKey } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  IMPORT_CHECK_ROWS_MAX,
  IMPORT_FILE_MAX_BYTES,
  IMPORT_ROW_ERRORS_MAX,
  type ImportCheckResult,
  ImportError,
  type ImportField,
  type ImportMapping,
} from "@domain/imports"
import type { Result } from "@spy4x/platform/universal/result"

/** One row of a file: its cells as text, in column order. */
export type ImportRow = readonly string[]

/** What a kind read from a file: the header's cells or `null`, every row, and a guessed mapping. */
export interface ImportRead {
  columns: string[] | null
  rows: ImportRow[]
  mapping: ImportMapping
}

/** What a kind's `commit` and `undo` need, in the flow's own transaction. */
export interface ImportContext {
  importId: string
  groupId: string
  /** The person who acts: the uploader on a save, the person who asked on an undo. */
  actorId: number
  /** Their role, read again in this transaction. */
  role: GroupRole
  /** The group change recorded for this step; stamp every written row with it. */
  changeSequence: string
  /**
   * The group plan's caps, `null` for none: a kind whose records a plan counts checks its own. An
   * undo adds nothing and gets none.
   */
  allowances: Readonly<Record<LimitKey, number | null>>
}

/**
 * An import kind: what one kind of file becomes in a group (`docs/imports.md`). The flow owns the
 * upload, the jobs, the records, who may see what, the preview, the save and the undo; a kind says
 * only which files it takes, the fields a row maps to, and how a row is read, checked, written and
 * removed. A product adds one by writing it and listing it in `importKinds` (`./registry.ts`).
 *
 * `V` is one checked row, as `commit` writes it.
 */
export interface ImportKind<V = unknown> {
  /** Its id in the upload and on the stored import, such as `notes`. Never rename it. */
  id: string
  /** What the screens call the records, such as "Notes". */
  label: string
  /** File name endings it takes, lower case with the dot, as `<input accept>` reads them. */
  accept: readonly string[]
  /** The largest file it takes, at most {@link IMPORT_FILE_MAX_BYTES}. */
  maxBytes: number
  /** The fields a row can map to. A required one must be mapped before a check or a save. */
  fields: readonly ImportField[]
  /** Whether a member with `role` may create these records in the group. */
  canCreate(role: GroupRole): boolean
  /**
   * Reads the file: its header, its rows and a guessed mapping, or why it cannot be read, in words
   * the person can act on. The bytes are a stranger's: refuse what is past the kind's limits.
   */
  read(bytes: Uint8Array): Result<ImportRead, string> | Promise<Result<ImportRead, string>>
  /** Checks one row under `mapping`: the value to write, or each problem in words. */
  check(row: ImportRow, mapping: ImportMapping): Result<V, string[]>
  /**
   * Writes every value, in the flow's transaction, and answers the new records' ids. Throwing
   * rolls the whole save back, so a batch is saved whole or not at all.
   */
  commit(
    tx: postgres.TransactionSql,
    values: readonly V[],
    context: ImportContext,
  ): Promise<string[]>
  /**
   * Removes the records the save made, through the kind's own delete (to the trash where it has
   * one). An id already gone is skipped.
   */
  undo(tx: postgres.TransactionSql, ids: readonly string[], context: ImportContext): Promise<void>
}

const KIND_ID = /^[a-z][a-z0-9-]{0,63}$/
const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/

/**
 * A kind, checked: its id is lower case words joined by `-`, it accepts at least one ending, its
 * size cap is a whole number up to {@link IMPORT_FILE_MAX_BYTES}, and its field keys are unique.
 *
 * @throws RangeError naming what is wrong.
 */
export function importKind<V>(kind: ImportKind<V>): ImportKind {
  if (!KIND_ID.test(kind.id)) throw new RangeError(`import kind id is not valid: ${kind.id}`)
  if (kind.accept.length === 0 || kind.accept.some((ending) => !/^\.[a-z0-9]+$/.test(ending))) {
    throw new RangeError(`import kind ${kind.id}: accept must list endings such as ".csv"`)
  }
  if (
    !Number.isSafeInteger(kind.maxBytes) || kind.maxBytes < 1 ||
    kind.maxBytes > IMPORT_FILE_MAX_BYTES
  ) {
    throw new RangeError(`import kind ${kind.id}: maxBytes must be 1 to ${IMPORT_FILE_MAX_BYTES}`)
  }
  const keys = kind.fields.map((field) => field.key)
  if (
    keys.length === 0 || new Set(keys).size !== keys.length ||
    !keys.every((key) => FIELD_KEY.test(key))
  ) {
    throw new RangeError(`import kind ${kind.id}: fields need unique keys such as "title"`)
  }
  return Object.freeze({ ...kind }) as ImportKind
}

/** The kind of `id` in `kinds`, or `INVALID_REQUEST`. */
export function kindOf(kinds: readonly ImportKind[], id: string): ImportKind {
  const kind = kinds.find((one) => one.id === id)
  if (!kind) throw new ImportError("INVALID_REQUEST", `Nothing can be imported as ${id}`)
  return kind
}

/** The cell of `row` that `mapping` gives `key`, trimmed; `""` for an unmapped field or a short row. */
export function cellOf(row: ImportRow, mapping: ImportMapping, key: string): string {
  const column = mapping[key]
  return column === undefined ? `` : (row[column] ?? ``).trim()
}

/**
 * Refuses a mapping that names a field the kind lacks or a column past the file's widest row, or
 * leaves a required field unmapped, with `INVALID_REQUEST` in words.
 */
export function assertMapping(kind: ImportKind, mapping: ImportMapping, columns: number): void {
  for (const [key, column] of Object.entries(mapping)) {
    if (!kind.fields.some((field) => field.key === key)) {
      throw new ImportError("INVALID_REQUEST", `${kind.label} have no field "${key}"`)
    }
    if (column >= columns) {
      throw new ImportError("INVALID_REQUEST", `The file has no column ${column + 1}`)
    }
  }
  const missing = kind.fields.find((field) => field.required && mapping[field.key] === undefined)
  if (missing) {
    throw new ImportError("INVALID_REQUEST", `Choose the column that holds ${missing.label}`)
  }
}

/** The number of columns of the widest row or of the header. */
export function columnCount(read: Pick<ImportRead, "columns" | "rows">): number {
  return read.rows.reduce((widest, row) => Math.max(widest, row.length), read.columns?.length ?? 0)
}

/**
 * Checks every row with the kind's `check`: the values a save writes, in file order, and what the
 * person is shown, with at most {@link IMPORT_CHECK_ROWS_MAX} refused rows of at most
 * {@link IMPORT_ROW_ERRORS_MAX} errors each.
 */
export function checkRows(
  kind: ImportKind,
  rows: readonly ImportRow[],
  mapping: ImportMapping,
): { values: unknown[]; result: ImportCheckResult } {
  const values: unknown[] = []
  const refused: ImportCheckResult["rows"] = []
  let withErrors = 0
  rows.forEach((row, index) => {
    const checked = kind.check(row, mapping)
    if (checked.ok) {
      values.push(checked.value)
      return
    }
    withErrors++
    if (refused.length < IMPORT_CHECK_ROWS_MAX) {
      refused.push({ row: index + 1, errors: checked.error.slice(0, IMPORT_ROW_ERRORS_MAX) })
    }
  })
  return {
    values,
    result: { rowCount: rows.length, valid: values.length, withErrors, rows: refused },
  }
}
