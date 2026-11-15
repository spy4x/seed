import { type Type, type } from "arktype"
import { encodeHex } from "@std/encoding/hex"
import type { Command, Query } from "@spy4x/platform/cqrs"
import { hasUnsafeTextCharacters } from "@spy4x/platform/universal/text"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"
import type { Actor } from "@domain/identity"
import { canRead, GroupRole } from "@domain/groups"

/**
 * Imports: records brought into a group from a file a person uploads (`docs/imports.md`). The
 * person uploads the file, a job reads it, the person maps its columns to the kind's fields and
 * checks every row, then saves the valid rows as one batch that one undo removes. What a file holds
 * and what a row becomes is the import kind's, registered on the server; this module holds what the
 * API and the apps share.
 */

/** Where an import is. Stored as a number in `imports.status`. */
export enum ImportStatus {
  /** Uploaded; the read job has not finished. */
  READING = 1,
  /** Read: the columns, a sample and a guessed mapping are there to check and save. */
  READY = 2,
  /** The file could not be read, or saving failed; `failure` says why. */
  FAILED = 3,
  /** The person saved it; the commit job is writing the records. */
  COMMITTING = 4,
  /** The records are written, as one batch. */
  COMMITTED = 5,
  /** The batch was undone: its records went the way the kind removes them. */
  UNDONE = 6,
}

/** The largest file any kind may accept: the API reads no more than this. */
export const IMPORT_FILE_MAX_BYTES = 5 * 1024 * 1024

/** The longest file name kept, in characters. */
export const IMPORT_FILE_NAME_MAX_LENGTH = 255

/** How many rows of the file the preview holds. */
export const IMPORT_SAMPLE_ROWS = 20

/** How many rows with errors one check answers; the counts cover every row. */
export const IMPORT_CHECK_ROWS_MAX = 100

/** The most errors one row reports. */
export const IMPORT_ROW_ERRORS_MAX = 10

/** How many of a person's imports the list answers, newest first. */
export const IMPORT_LIST_MAX = 50

/** How many valid rows one check reviews and answers, for a kind with a `review`. */
export const IMPORT_REVIEW_ROWS_MAX = 5000

/** The longest upload options, in bytes of their JSON text. */
export const IMPORT_OPTIONS_MAX_BYTES = 2048

/** The most upload options. */
export const IMPORT_OPTIONS_MAX_KEYS = 20

/** The most choice fields one row of a save may set. */
export const IMPORT_CHOICE_FIELDS_MAX = 20

/** The longest value of one choice, in characters. */
export const IMPORT_CHOICE_MAX_LENGTH = 200

/**
 * The outbox event kinds an import's steps are recorded under. Each rides on the group's change
 * log, like a note's, so the import's screen hears of every step through the change feed.
 */
export const IMPORT_EVENTS = {
  created: "import.created",
  read: "import.read",
  failed: "import.failed",
  committing: "import.committing",
  committed: "import.committed",
  undone: "import.undone",
} as const

/**
 * What the apps know of a kind before a file is chosen: its id and the files it takes. The server
 * kind reads its own limits from the same value, so the picker refuses exactly what the API
 * would.
 */
export interface ImportKindLimits {
  /** The kind's id in the upload, such as `notes`. */
  id: string
  /** File name endings it takes, lower case with the dot, as `<input accept>` reads them. */
  accept: readonly string[]
  /** The largest file it takes, in bytes, at most {@link IMPORT_FILE_MAX_BYTES}. */
  maxBytes: number
  /** The most rows a file may hold, the header not counted. */
  maxRows: number
}

/** One field a row of a kind can map to. */
export interface ImportField {
  /** The field's key in a mapping, such as `title`. */
  key: string
  /** What the screen calls it, such as "Title". */
  label: string
  /** A row without it is refused. */
  required?: boolean
  /**
   * The person may set it per row at the save (`choices`), mapped to a column or not. A required
   * field cannot be one.
   */
  choice?: boolean
}

/** Which column of the file each field takes its value from: field key to zero-based column. */
export type ImportMapping = Record<string, number>

/**
 * The person's per-row choices at the save: the row's number among the file's rows (1 is the
 * first, as a string key) to the values of the kind's choice fields.
 */
export type ImportChoices = Record<string, Record<string, string>>

/** What the read job found in the file. */
export interface ImportPreview {
  /** The header's cells, or `null` when the file has none. */
  columns: string[] | null
  /** The first {@link IMPORT_SAMPLE_ROWS} rows, as text cells. */
  sample: string[][]
  /** The guessed mapping, or the one the person saved. */
  mapping: ImportMapping
}

/** One import, as its starter and the group's admins see it. Never the file's bytes. */
export interface ImportSummary {
  id: string
  groupId: string
  kind: string
  status: ImportStatus
  /** Who uploaded it. */
  userId: number
  fileName: string
  fileSize: number
  /** The fields a row can map to, from the kind. */
  fields: ImportField[]
  /** `null` until the file is read. */
  preview: ImportPreview | null
  /** Rows in the file without the header; `null` until it is read. */
  rowCount: number | null
  /** Records saved; `null` until saved. */
  savedCount: number | null
  /** Rows left out because they had errors; `null` until saved. */
  errorCount: number | null
  /** Valid rows the kind's review left out, such as rows saved before; `null` without a review. */
  skippedCount: number | null
  /** What the kind's `readOptions` made of the upload's options; `null` for none. */
  options: unknown
  /** Why reading or saving failed, in words. */
  failure: string | null
  createdAt: Date
  readAt: Date | null
  failedAt: Date | null
  commitRequestedAt: Date | null
  committedAt: Date | null
  undoneAt: Date | null
}

/** One row a check refused: its number among the file's rows (1 is the first) and why. */
export interface ImportRowErrors {
  row: number
  errors: string[]
}

/** What a check of every row found, saving nothing. */
export interface ImportCheckResult {
  rowCount: number
  /** Rows a save would write. */
  valid: number
  /** Rows a save would leave out. */
  withErrors: number
  /** The first {@link IMPORT_CHECK_ROWS_MAX} rows with errors, in file order. */
  rows: ImportRowErrors[]
  /**
   * Only for a kind with a `review`: the first {@link IMPORT_REVIEW_ROWS_MAX} valid rows, in file
   * order, with what the review said of each.
   */
  reviews?: ImportRowReview[]
}

/** What a kind's review said of one valid row, with the row's cells. */
export interface ImportRowReview {
  /** Its number among the file's rows; 1 is the first. */
  row: number
  cells: string[]
  /** Why a save leaves it out, in words, or `null` when it is saved. */
  skip: string | null
  /** Values the kind proposes for its choice fields; the person's choices override them. */
  suggestions: Record<string, string>
}

// #region Errors
export type ImportErrorCode =
  | "GROUP_NOT_FOUND"
  | "ITEM_NOT_FOUND"
  | "INVALID_REQUEST"
  | "IMPORT_REFUSED"
  | "FILE_TOO_LARGE"
  | "VERSION_CONFLICT"
  | "ROLE_INSUFFICIENT"

export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    /** Each failed field's code and rule, when a schema refused the request. */
    public readonly fields?: FieldErrors,
  ) {
    super(message)
    this.name = "ImportError"
  }
}
// #endregion Errors

// #region Requests
/** The query of an upload: the kind and the file's name. The body is the file itself. */
export const importUploadQuerySchema = type({
  kind: `/^[a-z][a-z0-9-]{0,63}$/`,
  name: `string > 0`,
})

const FIELD_KEY = `/^[a-zA-Z][a-zA-Z0-9_]*$/`

/** At most `max` keys, and never an array, which arktype takes for an object. */
function keysAtMost(max: number) {
  return (value: object, ctx: { mustBe(expected: string): false }) =>
    (!Array.isArray(value) && Object.keys(value).length <= max) ||
    ctx.mustBe(`an object of at most ${max} fields`)
}

/**
 * An upload's options: field-key names to text, at most {@link IMPORT_OPTIONS_MAX_KEYS}. What
 * they mean is the kind's `readOptions`.
 */
export const importOptionsSchema = type({ [`[${FIELD_KEY}]`]: `string`, "+": `reject` })
  .narrow(keysAtMost(IMPORT_OPTIONS_MAX_KEYS))

/** The body of a check: the mapping. */
export const importMappingBodySchema = type({
  mapping: { "[string]": `0 <= number.integer < 10000` },
})

/**
 * The body of a save: the mapping and, optionally, the person's choices per row
 * ({@link ImportChoices}). Which fields may be chosen and which rows exist is checked against the
 * kind and the file.
 */
export const importCommitBodySchema = importMappingBodySchema.and({
  "choices?": type({
    "[/^[1-9][0-9]{0,8}$/]": type({
      [`[${FIELD_KEY}]`]: `string <= ${IMPORT_CHOICE_MAX_LENGTH}`,
      "+": `reject`,
    }).narrow(keysAtMost(IMPORT_CHOICE_FIELDS_MAX)),
    "+": `reject`,
  }),
})

/** `value` checked against `schema`, or `INVALID_REQUEST` with each failed field. */
export function parseImportRequest<S extends Type<object>>(schema: S, value: unknown): S["infer"] {
  const result = schema(value)
  if (result instanceof type.errors) {
    throw new ImportError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  return result as S["infer"]
}

/**
 * The file name an upload gives, trimmed and cut to {@link IMPORT_FILE_NAME_MAX_LENGTH}
 * characters. A name with control or direction characters is refused: the admin and the screen
 * print it.
 */
export function parseImportFileName(value: string): string {
  const name = Array.from(value.trim()).slice(0, IMPORT_FILE_NAME_MAX_LENGTH).join(``)
  if (name === `` || hasUnsafeTextCharacters(name)) {
    throw new ImportError("INVALID_REQUEST", `The file name is not valid`, {
      name: { code: `unsafeCharacters` },
    })
  }
  return name
}

/**
 * The `options` query of an upload, or `undefined` when there is none: a JSON object of at most
 * {@link IMPORT_OPTIONS_MAX_BYTES} bytes ({@link importOptionsSchema}), else `INVALID_REQUEST`.
 * The length is checked before the text is parsed.
 */
export function parseImportOptions(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined) return undefined
  const refuse = (message: string) =>
    new ImportError("INVALID_REQUEST", message, { options: { code: `invalid` } })
  if (new TextEncoder().encode(raw).byteLength > IMPORT_OPTIONS_MAX_BYTES) {
    throw refuse(`The options are longer than ${IMPORT_OPTIONS_MAX_BYTES} bytes`)
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw refuse(`The options are not JSON`)
  }
  const result = importOptionsSchema(value)
  if (result instanceof type.errors) throw refuse(`The options ${result.summary}`)
  return result
}

/** An uploaded file: its bytes, fingerprinted by their SHA-256 so a retried upload is told apart. */
export interface ImportUpload {
  bytes: Uint8Array
  sha256: string
  /** What the idempotency fingerprint reads: the digest, never 5 MiB of numbers. */
  toJSON(): string
}

/** Wraps uploaded bytes as an {@link ImportUpload}. */
export async function importUpload(bytes: Uint8Array): Promise<ImportUpload> {
  const digest = await crypto.subtle.digest(`SHA-256`, bytes as Uint8Array<ArrayBuffer>)
  const sha256 = encodeHex(new Uint8Array(digest))
  return { bytes, sha256, toJSON: () => sha256 }
}
// #endregion Requests

// #region Authorization
/**
 * Throws unless the person may see this import: they started it, or they are an admin or the owner
 * of its group. Anyone else, members of another group included, is told it does not exist, the
 * same answer as for an id nobody holds.
 */
export function assertCanSeeImport(
  role: GroupRole | null,
  importUserId: number,
  userId: number,
): void {
  if (role === null || !canRead(role)) throw new ImportError("GROUP_NOT_FOUND", "Group not found")
  if (importUserId !== userId && role < GroupRole.ADMIN) {
    throw new ImportError("ITEM_NOT_FOUND", "Import not found")
  }
}
// #endregion Authorization

// #region Commands and queries
export interface ImportCreatePayload {
  actor: Actor
  groupId: string
  kind: string
  fileName: string
  file: ImportUpload
  /** The upload's options, for the kind's `readOptions`; a kind without one refuses any. */
  options?: Record<string, string>
  requestId?: string
  /** Makes a retry of this upload safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/** Uploads a file: stores it with a new import and queues its read. */
export class ImportCreateCommand implements Command<ImportCreatePayload, ImportSummary> {
  __resultType?: ImportSummary
  constructor(public data: ImportCreatePayload) {}
}

export interface ImportRef {
  actor: Actor
  groupId: string
  importId: string
}

export interface ImportMappingPayload extends ImportRef {
  mapping: ImportMapping
  requestId?: string
  idempotencyKey?: string
}

/** Checks every row under a mapping and answers their errors; saves nothing. */
export class ImportCheckQuery implements Query<ImportMappingPayload, ImportCheckResult> {
  __resultType?: ImportCheckResult
  constructor(public data: ImportMappingPayload) {}
}

export interface ImportCommitPayload extends ImportMappingPayload {
  /** The person's per-row choices; only the kind's choice fields, only rows the file has. */
  choices?: ImportChoices
}

/** Saves the import under a mapping: stores the mapping and choices and queues the commit job. */
export class ImportCommitCommand implements Command<ImportCommitPayload, ImportSummary> {
  __resultType?: ImportSummary
  constructor(public data: ImportCommitPayload) {}
}

export interface ImportUndoPayload extends ImportRef {
  requestId?: string
  idempotencyKey?: string
}

/** Removes every record a saved import made, through the kind's own delete. */
export class ImportUndoCommand implements Command<ImportUndoPayload, ImportSummary> {
  __resultType?: ImportSummary
  constructor(public data: ImportUndoPayload) {}
}

/** One import, its preview and counts. */
export class ImportGetQuery implements Query<ImportRef, ImportSummary> {
  __resultType?: ImportSummary
  constructor(public data: ImportRef) {}
}

export interface ImportListPayload {
  actor: Actor
  groupId: string
}

/** The person's own imports in the group, newest first, without their previews. */
export class ImportListQuery implements Query<ImportListPayload, { imports: ImportSummary[] }> {
  __resultType?: { imports: ImportSummary[] }
  constructor(public data: ImportListPayload) {}
}
// #endregion Commands and queries

// #region Operator area
/** A status chip of the admin list; `all` is every import. */
export type AdminImportStatusFilter =
  | `all`
  | `failed`
  | `reading`
  | `ready`
  | `committing`
  | `committed`
  | `undone`

/** The chips in their order: failures first, since they are what an operator looks for. */
export const ADMIN_IMPORT_STATUS_FILTERS: readonly AdminImportStatusFilter[] = [
  `all`,
  `failed`,
  `reading`,
  `ready`,
  `committing`,
  `committed`,
  `undone`,
]

/** The status each chip holds; `all` holds every one. */
export const ADMIN_IMPORT_FILTER_STATUS: Readonly<
  Record<AdminImportStatusFilter, ImportStatus | null>
> = {
  all: null,
  failed: ImportStatus.FAILED,
  reading: ImportStatus.READING,
  ready: ImportStatus.READY,
  committing: ImportStatus.COMMITTING,
  committed: ImportStatus.COMMITTED,
  undone: ImportStatus.UNDONE,
}

/** How many imports one page of the admin list holds. */
export const ADMIN_IMPORTS_PAGE_SIZE = 50

/** The admin list's chip and page, as the address and the API's query carry them. */
export interface AdminImportFilter {
  status: AdminImportStatusFilter
  /** 1-based. */
  page: number
}

/**
 * Reads the admin list's filter from query parameters (`status`, `page`). A value it does not
 * understand falls back to the default, so a hand-edited address still shows a list.
 */
export function parseAdminImportFilter(params: URLSearchParams): AdminImportFilter {
  const raw = params.get(`status`) as AdminImportStatusFilter | null
  const status = raw && ADMIN_IMPORT_STATUS_FILTERS.includes(raw) ? raw : `all`
  const page = Number(params.get(`page`))
  return { status, page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1 }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminImportFilterQuery(filter: AdminImportFilter): string {
  const params = new URLSearchParams()
  if (filter.status !== `all`) params.set(`status`, filter.status)
  if (filter.page > 1) params.set(`page`, String(filter.page))
  return params.toString()
}

/**
 * One import as an operator sees it: where it is, its counts and its timing. Never the file, its
 * name, its cells, or the options and choices a person gave: those are the group's data.
 */
export interface AdminImportRow {
  id: string
  group: { id: string; name: string }
  kind: string
  status: ImportStatus
  /** The person who uploaded it. */
  uploaderId: number
  rowCount: number | null
  savedCount: number | null
  errorCount: number | null
  skippedCount: number | null
  /** Why reading or saving failed, in the kind's words. */
  failure: string | null
  createdAt: string
  readAt: string | null
  failedAt: string | null
  commitRequestedAt: string | null
  committedAt: string | null
  undoneAt: string | null
  /** From upload to read (or to a failed read), in milliseconds; `null` while reading. */
  readMs: number | null
  /** From the save's start to its end (or its failure), in milliseconds; `null` until then. */
  saveMs: number | null
}

/** One page of the admin list and the count of each chip. */
export interface AdminImportListResponse {
  imports: AdminImportRow[]
  counts: Record<AdminImportStatusFilter, number>
  total: number
  page: number
  pageSize: number
}
// #endregion Operator area
