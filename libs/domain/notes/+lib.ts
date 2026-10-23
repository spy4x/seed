import { type Type, type } from "arktype"
import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { canMutateNotes, canRead, GroupRole, plainEntryProblem } from "@domain/groups"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"

export * from "./overview.ts"
export * from "./attachments.ts"

/**
 * Notes: the reference aggregate. A note belongs to one group; every member of the group reads it,
 * and an editor or above writes it. `docs/aggregates.md` walks through every file it needs.
 */

/** The longest title, in characters, after trimming. */
export const NOTE_TITLE_MAX_LENGTH = 200
/** The longest body, in characters. */
export const NOTE_BODY_MAX_LENGTH = 10_000

/**
 * The outbox event kinds a note change is recorded under. Each rides on the group's change log:
 * its outbox row's aggregate is the group and its version the group's change sequence, so the
 * worker and the socket announce it exactly like a group change.
 */
export const NOTE_EVENTS = {
  created: "note.created",
  updated: "note.updated",
  deleted: "note.deleted",
  restored: "note.restored",
  /** Written on the group a move takes notes out of. */
  movedOut: "note.moved_out",
  /** Written on the group a move puts notes into. */
  movedIn: "note.moved_in",
} as const

/** The most tags one note carries: a request for more is refused, not cut short. */
export const NOTE_TAG_MAX = 20

/**
 * How long a deleted note waits to be restored: the worker removes it for good once it has been
 * deleted for more days than this.
 */
export const NOTE_RESTORE_DAYS = 30

/** The most notes one move takes: a request for more is refused, not cut short. */
export const NOTE_MOVE_MAX = 100

/** The fewest characters a note search needs, after trimming: one letter matches too much. */
export const NOTE_SEARCH_MIN_LENGTH = 2

/** The most characters a note search takes, after trimming: a request for more is refused. */
export const NOTE_SEARCH_MAX_LENGTH = 200

/** The most notes one search answers, best first. There is no next page: typing more narrows it. */
export const NOTE_SEARCH_LIMIT = 20

export type NoteErrorCode =
  | "GROUP_NOT_FOUND"
  | "ID_ALREADY_EXISTS"
  | "INVALID_CURSOR"
  | "INVALID_REQUEST"
  | "NOTE_NOT_FOUND"
  | "SAME_GROUP"
  | "ROLE_INSUFFICIENT"
  | "SEARCH_RATE_LIMITED"
  | "VERSION_CONFLICT"

export class NoteError extends Error {
  constructor(
    public readonly code: NoteErrorCode,
    message: string,
    /** Each failed field's code and rule, when a schema refused the request. */
    public readonly fields?: FieldErrors,
  ) {
    super(message)
    this.name = "NoteError"
  }
}

/**
 * An update or delete named a version the note has moved past. It carries the version the note
 * is at now, so the client can reread it and decide, instead of overwriting a change it never saw.
 */
export class NoteVersionConflictError extends NoteError {
  constructor(public readonly currentVersion: number) {
    super("VERSION_CONFLICT", "The note was changed by someone else")
    this.name = "NoteVersionConflictError"
  }
}

/** One note as the API returns it. */
export interface Note {
  id: string
  groupId: string
  title: string
  body: string
  /** The ids of the group's tags the note carries, in id order. Only tags that exist appear. */
  tagIds: string[]
  /** Starts at 1 and grows by one with every update; an update or delete must name it. */
  version: number
  /** The group's change sequence this note was last written at, as a decimal string (BIGINT). */
  changeSequence: string
  /** `null` once the author deleted their account; shown as `DELETED_USER_NAME`. */
  createdByUserId: number | null
  /** `null` once the last editor deleted their account; shown as `DELETED_USER_NAME`. */
  updatedByUserId: number | null
  createdAt: Date
  updatedAt: Date
}

/** What a delete leaves: the note's id, its last version and the group's change sequence. */
export interface DeletedNote {
  id: string
  groupId: string
  version: number
  changeSequence: string
}

// #region Request schemas
// The bodies of the REST requests and the fields of the forms that post without JavaScript. The
// group and the note are named by the path; the socket payloads add them as `groupId` and `id`.

// Lengths are checked in characters by `parseNoteRequest`, not here: arktype counts UTF-16 units.
const noteFields = {
  title: "string",
  body: "string",
  // The note's tags. Left out on an update, the tags stay; given, the set is replaced. Ids the
  // group has no tag for are ignored (ADR 003, section 5, rule 4).
  "tagIds?": type(UUID_PATTERN).array(),
} as const

const versionField = { version: "number.integer >= 1" } as const

/** `POST /api/groups/:groupId/notes`: a client-made id, so a retry cannot create a second note. */
export const noteCreateRequestSchema = type({ id: UUID_PATTERN, ...noteFields, "+": "reject" })
export type NoteCreateRequest = typeof noteCreateRequestSchema.infer

/** `PATCH /api/groups/:groupId/notes/:noteId`: the new title and body, and the version edited. */
export const noteUpdateRequestSchema = type({ ...noteFields, ...versionField, "+": "reject" })
export type NoteUpdateRequest = typeof noteUpdateRequestSchema.infer

/** `DELETE /api/groups/:groupId/notes/:noteId`: the version the person saw when deleting. */
export const noteDeleteRequestSchema = type({ ...versionField, "+": "reject" })
export type NoteDeleteRequest = typeof noteDeleteRequestSchema.infer

/**
 * `POST /api/groups/:groupId/notes/:noteId/restore`: takes no fields. The version of a deleted note
 * is not needed: nothing but a restore changes it, and a second restore finds no deleted note.
 */
export const noteRestoreRequestSchema = type({ "+": "reject" })
export type NoteRestoreRequest = typeof noteRestoreRequestSchema.infer

/**
 * `POST /api/groups/:groupId/notes/move`: the group to move to and the notes to move, all or none.
 * The form fields are the same: `toGroupId`, and one `noteIds` per ticked note.
 */
export const noteMoveRequestSchema = type({
  toGroupId: UUID_PATTERN,
  noteIds: type(UUID_PATTERN).array(),
  "+": "reject",
})
export type NoteMoveRequest = typeof noteMoveRequestSchema.infer

const groupIdField = { groupId: UUID_PATTERN } as const
const noteIdField = { id: UUID_PATTERN } as const

/** The `note.create` socket payload. */
export const noteCreatePayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  ...noteFields,
  "+": "reject",
})
/** The `note.update` socket payload. */
export const noteUpdatePayloadSchema = type({
  ...groupIdField,
  ...noteIdField,
  ...noteFields,
  ...versionField,
  "+": "reject",
})
/** The `note.delete` socket payload. */
export const noteDeletePayloadSchema = type({
  ...groupIdField,
  ...noteIdField,
  ...versionField,
  "+": "reject",
})
/** The `note.restore` socket payload. */
export const noteRestorePayloadSchema = type({ ...groupIdField, ...noteIdField, "+": "reject" })
/** The `note.move` socket payload. */
export const noteMovePayloadSchema = type({
  ...groupIdField,
  toGroupId: UUID_PATTERN,
  noteIds: type(UUID_PATTERN).array(),
  "+": "reject",
})
/** The `note.get` socket payload. */
export const noteGetPayloadSchema = type({ ...groupIdField, ...noteIdField, "+": "reject" })
/**
 * The `note.search` payload: the text, in the body of the socket frame or of `POST
 * /api/call/note.search`, never in a URL. See {@link parseNoteSearchRequest} for its length.
 */
export const noteSearchPayloadSchema = type({ q: "string", "+": "reject" })

/** The `note.locate` socket payload: a note id, with no group. */
export const noteLocatePayloadSchema = type({ ...noteIdField, "+": "reject" })
/** The `note.list` socket payload. */
export const noteListPayloadSchema = type({
  ...groupIdField,
  "limit?": "1 <= number.integer <= 100",
  "cursor?": "string > 0",
  /** `true` lists the group's deleted notes instead of its live ones. */
  "deleted?": "boolean",
  "+": "reject",
})

/**
 * Validates `value` against `schema`, then trims the title and checks both lengths in characters,
 * so an emoji counts as one. A title or body holding a character Postgres cannot store (NUL, half
 * of a surrogate pair) is refused; line breaks and tabs are fine. Throws
 * `NoteError("INVALID_REQUEST")`.
 */
export function parseNoteRequest<S extends Type<object>>(schema: S, value: unknown): S["infer"] {
  const result = schema(value)
  if (result instanceof type.errors) {
    throw new NoteError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  const parsed = result as S["infer"] & { title?: string; body?: string; tagIds?: string[] }
  if (parsed.tagIds !== undefined && new Set(parsed.tagIds).size > NOTE_TAG_MAX) {
    throw new NoteError("INVALID_REQUEST", `A note can carry at most ${NOTE_TAG_MAX} tags`)
  }
  if (parsed.title === undefined) return parsed
  const title = parsed.title.trim()
  const titleLength = Array.from(title).length
  if (titleLength < 1 || titleLength > NOTE_TITLE_MAX_LENGTH) {
    throw new NoteError(
      "INVALID_REQUEST",
      `Note title must contain 1 to ${NOTE_TITLE_MAX_LENGTH} characters`,
    )
  }
  if (Array.from(parsed.body ?? "").length > NOTE_BODY_MAX_LENGTH) {
    throw new NoteError(
      "INVALID_REQUEST",
      `Note body must contain at most ${NOTE_BODY_MAX_LENGTH} characters`,
    )
  }
  if (hasUnstorableTextCharacters(title)) {
    throw new NoteError(
      "INVALID_REQUEST",
      "Note title must not contain a NUL or a broken character",
    )
  }
  if (hasUnstorableTextCharacters(parsed.body ?? "")) {
    throw new NoteError("INVALID_REQUEST", "Note body must not contain a NUL or a broken character")
  }
  return { ...parsed, title, ...(parsed.tagIds && { tagIds: [...new Set(parsed.tagIds)] }) }
}

/**
 * Validates a search: the schema, then the text trimmed to {@link NOTE_SEARCH_MIN_LENGTH} to
 * {@link NOTE_SEARCH_MAX_LENGTH} characters, an emoji counting as one. Throws
 * `NoteError("INVALID_REQUEST")`. The message never repeats the text, so a log of it holds none.
 */
export function parseNoteSearchRequest(value: unknown): { q: string } {
  const result = noteSearchPayloadSchema(value)
  if (result instanceof type.errors) {
    throw new NoteError("INVALID_REQUEST", "A search takes one text field, q")
  }
  const q = result.q.trim()
  const length = Array.from(q).length
  if (length < NOTE_SEARCH_MIN_LENGTH || length > NOTE_SEARCH_MAX_LENGTH) {
    throw new NoteError(
      "INVALID_REQUEST",
      `A search must contain ${NOTE_SEARCH_MIN_LENGTH} to ${NOTE_SEARCH_MAX_LENGTH} characters`,
    )
  }
  return { q }
}

/**
 * Validates a move request: the schema, then one to {@link NOTE_MOVE_MAX} distinct note ids, and a
 * group other than the one the notes are in (`groupId`, from the path or the payload). Throws
 * `NoteError("INVALID_REQUEST")`, or `SAME_GROUP` for a move to the same group.
 */
export function parseNoteMoveRequest<S extends Type<{ toGroupId: string; noteIds: string[] }>>(
  schema: S,
  value: unknown,
  fromGroupId: string,
): S["infer"] {
  const result = schema(value)
  if (result instanceof type.errors) {
    throw new NoteError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  const parsed = result as S["infer"]
  if (parsed.noteIds.length < 1 || parsed.noteIds.length > NOTE_MOVE_MAX) {
    throw new NoteError("INVALID_REQUEST", `Move 1 to ${NOTE_MOVE_MAX} notes at a time`)
  }
  if (new Set(parsed.noteIds).size !== parsed.noteIds.length) {
    throw new NoteError("INVALID_REQUEST", "A note is named twice")
  }
  if (parsed.toGroupId === fromGroupId) {
    throw new NoteError("SAME_GROUP", "The notes are in that group already")
  }
  return parsed
}
// #endregion Request schemas

// #region Authorization
/**
 * Throws unless `role` may read the group's notes. `null` means the actor is not a member, which
 * answers "group not found" so a stranger cannot tell a group exists.
 */
export function assertCanReadNotes(role: GroupRole | null): void {
  if (role === null || !canRead(role)) {
    throw new NoteError("GROUP_NOT_FOUND", "Group not found")
  }
}

/** Throws unless `role` may create, update or delete the group's notes: editor or above. */
export function assertCanWriteNotes(role: GroupRole | null): void {
  assertCanReadNotes(role)
  if (!canMutateNotes(role!)) {
    throw new NoteError("ROLE_INSUFFICIENT", "Only an editor can change notes")
  }
}
// #endregion Authorization

// #region Commands and queries
export interface NoteCreatePayload {
  actor: Actor
  groupId: string
  id: string
  title: string
  body: string
  /** The tags to attach; ids the group has no tag for are ignored. */
  tagIds?: string[]
  /** The request's id, kept on the audit event. */
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface NoteWriteResult {
  note: Note
  /** `false` when the same note was already created by an earlier try of the same request. */
  created: boolean
}

/** Counts against the plan's `maxNotes` (`docs/billing.md`, "Entitlements"). */
export class NoteCreateCommand implements Command<NoteCreatePayload, NoteWriteResult> {
  __resultType?: NoteWriteResult
  /**
   * The group's cap on notes, set by the entitlement gate on the command bus before the handler
   * runs (`null` for no cap). The write counts again under it, in its own transaction.
   */
  allowance?: number | null
  constructor(public data: NoteCreatePayload) {}
}

export interface NoteUpdatePayload {
  actor: Actor
  groupId: string
  id: string
  title: string
  body: string
  /** The new set of tags; left out, the note keeps its tags. Unknown ids are ignored. */
  tagIds?: string[]
  /** The version the person edited; a note at any other version is not changed. */
  version: number
  idempotencyKey?: string
}

export class NoteUpdateCommand implements Command<NoteUpdatePayload, { note: Note }> {
  __resultType?: { note: Note }
  constructor(public data: NoteUpdatePayload) {}
}

export interface NoteDeletePayload {
  actor: Actor
  groupId: string
  id: string
  version: number
  /** The request's id, kept on the audit event. */
  requestId?: string
  idempotencyKey?: string
}

export class NoteDeleteCommand implements Command<NoteDeletePayload, { note: DeletedNote }> {
  __resultType?: { note: DeletedNote }
  constructor(public data: NoteDeletePayload) {}
}

export interface NoteRestorePayload {
  actor: Actor
  groupId: string
  id: string
  requestId?: string
  idempotencyKey?: string
}

/**
 * Brings a deleted note back, as a change on the group like any other write: its `deleted_at` is
 * cleared and its version grows by one, so an edit queued on the version it had when it was deleted
 * conflicts instead of landing. Counts against the plan's `maxNotes` like a create does, as the
 * note is live again. Needs an editor's rights, the same as a delete.
 */
export class NoteRestoreCommand implements Command<NoteRestorePayload, { note: Note }> {
  __resultType?: { note: Note }
  /** The group's cap on notes, set by the entitlement gate; see {@link NoteCreateCommand}. */
  allowance?: number | null
  constructor(public data: NoteRestorePayload) {}
}

export interface NoteMovePayload {
  actor: Actor
  /** The group the notes are in now. */
  groupId: string
  /** The group they go to. The actor needs an editor's rights in both. */
  toGroupId: string
  noteIds: string[]
  requestId?: string
  idempotencyKey?: string
}

/**
 * Moves notes from one group to another, all or none. A note keeps its id, text, authors and
 * dates; its version grows by one, so an edit made on the old version conflicts instead of
 * landing silently. Counts against the target group's `maxNotes`.
 */
export class NoteMoveCommand implements Command<NoteMovePayload, { notes: Note[] }> {
  __resultType?: { notes: Note[] }
  /** The target group's cap on notes, set by the entitlement gate; see {@link NoteCreateCommand}. */
  allowance?: number | null
  constructor(public data: NoteMovePayload) {}
}

/** Where a page of notes starts: after this `updatedAt` and `id`, newest first. */
export interface NoteListPageKey {
  updatedAt: Date
  id: string
}

export interface NoteListPage {
  limit: number
  after?: NoteListPageKey
}

export interface NoteListResult {
  notes: Note[]
  nextPageKey: NoteListPageKey | null
}

export interface NoteListPayload {
  actor: Actor
  groupId: string
  page: NoteListPage
  /** List the group's deleted notes (newest deletion first) instead of its live ones. */
  deleted?: boolean
}

export class NoteListQuery implements Query<NoteListPayload, NoteListResult> {
  __resultType?: NoteListResult
  constructor(public data: NoteListPayload) {}
}

export interface NoteGetPayload {
  actor: Actor
  groupId: string
  id: string
}

export class NoteGetQuery implements Query<NoteGetPayload, { note: Note }> {
  __resultType?: { note: Note }
  constructor(public data: NoteGetPayload) {}
}

export interface NoteLocatePayload {
  actor: Actor
  id: string
}

/**
 * Finds the group of a note from its id alone, for a link to a note of another of the actor's
 * groups. It answers only when the actor is a member of that group: a note that does not exist and
 * a note in a group the actor is not in both fail with the same `NOTE_NOT_FOUND`.
 */
export class NoteLocateQuery implements Query<NoteLocatePayload, { groupId: string }> {
  __resultType?: { groupId: string }
  constructor(public data: NoteLocatePayload) {}
}
/** The longest snippet of a search hit, in characters, "…" included. */
export const NOTE_SNIPPET_MAX_LENGTH = 120

/**
 * A search hit's snippet: `text` with its whitespace folded, cut to {@link NOTE_SNIPPET_MAX_LENGTH}
 * characters on a word boundary, with "…" where it does not reach an end of the body. The server
 * passes the words around the match; the device, which searches its own copy, the body's start.
 */
export function trimNoteSnippet(text: string, startsBody: boolean, endsBody: boolean): string {
  const folded = text.replace(/\s+/g, " ").trim()
  if (folded === "") return ""
  const characters = Array.from(folded)
  let cut = folded
  let cutEnd = !endsBody
  if (characters.length > NOTE_SNIPPET_MAX_LENGTH - 2) {
    const head = characters.slice(0, NOTE_SNIPPET_MAX_LENGTH - 2).join("")
    const space = head.lastIndexOf(" ")
    cut = space > 0 ? head.slice(0, space) : head
    cutEnd = true
  }
  return `${startsBody ? "" : "…"}${cut}${cutEnd ? "…" : ""}`
}

/** One note a search found: enough to list it and open it, never its whole body. */
export interface NoteSearchHit {
  id: string
  groupId: string
  title: string
  /**
   * Plain text around the first match in the body, with "…" where it was cut; the start of the
   * body when only the title matched; empty for an empty body.
   */
  snippet: string
  updatedAt: Date
}

export interface NoteSearchPayload {
  actor: Actor
  /** The text, trimmed and of a valid length (`parseNoteSearchRequest`). */
  q: string
}

/**
 * The live notes, in every group the actor is a member of now, whose title or body hold every word
 * of the text, each as a word or the start of one; at most {@link NOTE_SEARCH_LIMIT}, best first.
 */
export class NoteSearchQuery implements Query<NoteSearchPayload, { notes: NoteSearchHit[] }> {
  __resultType?: { notes: NoteSearchHit[] }
  constructor(public data: NoteSearchPayload) {}
}
// #endregion Commands and queries

// #region Ports
export interface NoteCreateInput {
  groupId: string
  id: string
  title: string
  body: string
  tagIds?: string[]
  requestId?: string
}

export interface NoteUpdateInput {
  groupId: string
  id: string
  title: string
  body: string
  tagIds?: string[]
  expectedVersion: number
}

export interface NoteDeleteInput {
  groupId: string
  id: string
  expectedVersion: number
  requestId?: string
}

export interface NoteRestoreInput {
  groupId: string
  id: string
  requestId?: string
}

export interface NoteMoveInput {
  fromGroupId: string
  toGroupId: string
  noteIds: string[]
  requestId?: string
}

/**
 * Where notes are kept. Every write records a change on the group in its own transaction (the
 * group's sequence and an outbox row). The handlers check who may write before they call it; a
 * write checks again inside its transaction, as a role can change in between.
 */
export interface NoteRepository {
  /** The group's live notes, or with `deleted` its deleted ones, each newest change first. */
  list(groupId: string, page: NoteListPage, deleted?: boolean): Promise<NoteListResult>
  get(groupId: string, id: string): Promise<Note | null>
  /**
   * The group a live note is in, when the user is an active member of that group. `null` for a
   * note that does not exist, a deleted one and one in a group the user is not in alike, found by
   * one lookup in every case so that no case is slower than another.
   */
  groupIdOfForMember(id: string, userId: number): Promise<string | null>
  /**
   * The live notes matching `text` in the groups the user is an active member of, at most `limit`,
   * best first. Membership is part of the one query that finds them, never a filter after it.
   */
  searchForMember(userId: number, text: string, limit: number): Promise<NoteSearchHit[]>
  /**
   * Throws `ID_ALREADY_EXISTS` when the id holds a different note, and a `PlanError` when the group
   * already holds `allowance` notes (`null` for no cap), counted in the write's own transaction.
   */
  create(
    input: NoteCreateInput,
    actorId: number,
    allowance: number | null,
  ): Promise<NoteWriteResult>
  /** Throws `NOTE_NOT_FOUND`, or {@link NoteVersionConflictError} for a stale version. */
  update(input: NoteUpdateInput, actorId: number): Promise<Note>
  /** Throws `NOTE_NOT_FOUND`, or {@link NoteVersionConflictError} for a stale version. */
  delete(input: NoteDeleteInput, actorId: number): Promise<DeletedNote>
  /**
   * Clears `deleted_at`. Throws `NOTE_NOT_FOUND` for a note that is not deleted (never there, live
   * already, or removed for good), and a `PlanError` when the group would pass `allowance` notes
   * (`null` for no cap), counted in the write's own transaction.
   */
  restore(input: NoteRestoreInput, actorId: number, allowance: number | null): Promise<Note>
  /**
   * Throws `GROUP_NOT_FOUND` or `ROLE_INSUFFICIENT` unless the actor is an editor or above in both
   * groups (checked on the locked membership rows), `NOTE_NOT_FOUND` when any note is not live in
   * the source group, and a `PlanError` when the target would pass `allowance` notes (`null` for
   * no cap). Records one change on each group and one audit event in each.
   */
  move(input: NoteMoveInput, actorId: number, allowance: number | null): Promise<Note[]>
}

/** The actor's role in a group, or `null` when they are not an active member of an active group. */
export interface GroupRoleLookup {
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
}
// #endregion Ports

// #region Export file
/**
 * One note in a group's export file (`docs/aggregates.md`, "Making an aggregate exportable"): its
 * id in the file, its text, the ids of its tags in the file, and when it was written. Who wrote it
 * stays out: the file holds no person. The dates come back on import, so the list keeps its order.
 */
export const noteExportEntrySchema = type({
  id: UUID_PATTERN,
  title: "string",
  body: "string",
  tagIds: type(UUID_PATTERN).array(),
  createdAt: "string.date.iso.parse",
  updatedAt: "string.date.iso.parse",
  "+": "reject",
})
export type NoteExportEntry = typeof noteExportEntrySchema.infer

/**
 * Checks one note of a file with the rules of a create ({@link parseNoteRequest}): lengths, the
 * characters, at most {@link NOTE_TAG_MAX} tags. Throws `NoteError("INVALID_REQUEST")`.
 */
export function parseNoteExportEntry(value: unknown): NoteExportEntry {
  // The schema checks every item of a list, so a huge `tagIds` is refused before it runs.
  const tagIds = (value as { tagIds?: unknown } | null)?.tagIds
  if (Array.isArray(tagIds) && tagIds.length > NOTE_TAG_MAX) {
    throw new NoteError("INVALID_REQUEST", `A note can carry at most ${NOTE_TAG_MAX} tags`)
  }
  const shape = noteExportEntrySchema(value)
  if (shape instanceof type.errors) {
    throw new NoteError("INVALID_REQUEST", plainEntryProblem(shape, "note", NOTE_EXPORT_LABELS))
  }
  return parseNoteRequest(noteExportEntrySchema, value) as NoteExportEntry
}

/** What a refusal calls each field of a note in a file. */
const NOTE_EXPORT_LABELS = {
  id: "id",
  title: "title",
  body: "text",
  tagIds: "tags",
  "tagIds[]": "tag id",
  createdAt: "creation date",
  updatedAt: "last change date",
}
// #endregion Export file
