import { type Type, type } from "arktype"
import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import {
  canMutateNotes,
  canRead,
  GroupRole,
  legacyExportColor,
  plainEntryProblem,
} from "@domain/groups"
import { hasUnsafeTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { hexColor } from "@spy4x/platform/universal/color"
import { type FieldErrors, fieldErrors } from "@spy4x/validation"

/**
 * Tags: the second reference aggregate, and the parent of notes. A tag belongs to one group, has a
 * name and a colour, and any number of the group's notes carry it. Every member reads a group's
 * tags and an editor or above writes them, as for notes. `docs/aggregates.md` ("Relations between
 * aggregates") walks through the files.
 */

/** The longest tag name, in characters, after trimming. */
export const TAG_NAME_MAX_LENGTH = 40

/**
 * The most tags one group holds. A group's tags are read as one page with no cursor, so without a
 * cap one editor could make that read as large as they like for every member. It is the same for
 * every plan: it bounds a read, it is not something a plan sells.
 */
export const TAG_MAX_PER_GROUP = 100

/**
 * A tag's colour: any `#rrggbb`, kept in lower case. The screens draw the tag's name on it in black
 * or white, whichever reads better (`readableTextColor`), so no colour makes a name unreadable.
 */
export type TagColor = string

/** The colour a new tag has when the person picks none: the gray of the colour picker's presets. */
export const DEFAULT_TAG_COLOR: TagColor = "#4b5563"

/**
 * The outbox event kinds a tag change is recorded under. Each rides on the group's change log, like
 * a note's, so the worker and the socket announce it as a group change.
 */
export const TAG_EVENTS = {
  created: "tag.created",
  updated: "tag.updated",
  deleted: "tag.deleted",
} as const

export type TagErrorCode =
  | "GROUP_NOT_FOUND"
  | "ID_ALREADY_EXISTS"
  | "INVALID_REQUEST"
  | "ROLE_INSUFFICIENT"
  | "TAG_LIMIT_REACHED"
  | "TAG_NAME_TAKEN"
  | "TAG_NOT_FOUND"
  | "VERSION_CONFLICT"

export class TagError extends Error {
  constructor(
    public readonly code: TagErrorCode,
    message: string,
    /** Each failed field's code and rule, when a schema refused the request. */
    public readonly fields?: FieldErrors,
  ) {
    super(message)
    this.name = "TagError"
  }
}

/**
 * Throws `TAG_LIMIT_REACHED` when a group that just gained a tag holds more than
 * {@link TAG_MAX_PER_GROUP}. `count` is the group's tags after the write, counted in the write's
 * own transaction; the caller's transaction takes the write back.
 */
export function assertTagRoom(count: number): void {
  if (count > TAG_MAX_PER_GROUP) {
    throw new TagError(
      "TAG_LIMIT_REACHED",
      `A group can hold at most ${TAG_MAX_PER_GROUP} tags`,
    )
  }
}

/**
 * A rename, recolour or delete named a version the tag has moved past. It carries the version the
 * tag is at now, so the client can reread it instead of overwriting a change it never saw.
 */
export class TagVersionConflictError extends TagError {
  constructor(public readonly currentVersion: number) {
    super("VERSION_CONFLICT", "The tag was changed by someone else")
    this.name = "TagVersionConflictError"
  }
}

/** One tag as the API returns it. */
export interface Tag {
  id: string
  groupId: string
  name: string
  color: TagColor
  /** Starts at 1 and grows by one with every change; a change or delete must name it. */
  version: number
  /** The group's change sequence this tag was last written at, as a decimal string (BIGINT). */
  changeSequence: string
  createdByUserId: number | null
  updatedByUserId: number | null
  createdAt: Date
  updatedAt: Date
}

/** A tag in its group's list, with how many of the group's notes carry it; deleted notes do not count. */
export interface ListedTag extends Tag {
  noteCount: number
}

/** What a delete leaves: the tag's id, the version it had and the group's change sequence. */
export interface DeletedTag {
  id: string
  groupId: string
  version: number
  changeSequence: string
}

// #region Request schemas
/** A `#rrggbb` in either case, stored in lower case so the same colour is always the same text. */
const colorField = hexColor.pipe((color) => color.toLowerCase())
const versionField = { version: "number.integer >= 1" } as const
const tagFields = { name: "string", color: colorField } as const
const groupIdField = { groupId: UUID_PATTERN } as const
const tagIdField = { id: UUID_PATTERN } as const

/** The `tag.create` payload: a client-made id, so a retry cannot create a second tag. */
export const tagCreatePayloadSchema = type({
  ...groupIdField,
  ...tagIdField,
  ...tagFields,
  "+": "reject",
})
/** The `tag.update` payload: the new name and colour, and the version edited. */
export const tagUpdatePayloadSchema = type({
  ...groupIdField,
  ...tagIdField,
  ...tagFields,
  ...versionField,
  "+": "reject",
})
/** The `tag.delete` payload: the version the person saw when deleting. */
export const tagDeletePayloadSchema = type({
  ...groupIdField,
  ...tagIdField,
  ...versionField,
  "+": "reject",
})
/** The `tag.get` payload. */
export const tagGetPayloadSchema = type({ ...groupIdField, ...tagIdField, "+": "reject" })
/** The `tag.list` payload: a group's tags are one page, so there is no cursor. */
export const tagListPayloadSchema = type({ ...groupIdField, "+": "reject" })

/**
 * Validates `value` against `schema`, then trims the name and checks its length in characters, so
 * an emoji counts as one. A name that holds a control character (NUL, a tab, a line break) or an
 * invisible or text-direction character is refused: Postgres cannot store the first, and the others
 * make two tags look the same. Throws `TagError("INVALID_REQUEST")`.
 */
export function parseTagRequest<S extends Type<object>>(schema: S, value: unknown): S["infer"] {
  const result = schema(value)
  if (result instanceof type.errors) {
    throw new TagError("INVALID_REQUEST", result.summary, fieldErrors(result))
  }
  const parsed = result as S["infer"] & { name?: string }
  if (parsed.name === undefined) return parsed
  const name = parsed.name.trim()
  const length = Array.from(name).length
  if (length < 1 || length > TAG_NAME_MAX_LENGTH) {
    throw new TagError(
      "INVALID_REQUEST",
      `Tag name must contain 1 to ${TAG_NAME_MAX_LENGTH} characters`,
    )
  }
  if (hasUnsafeTextCharacters(name)) {
    throw new TagError(
      "INVALID_REQUEST",
      "Tag name must not contain control or invisible characters",
    )
  }
  return { ...parsed, name }
}
// #endregion Request schemas

// #region Authorization
/**
 * Throws unless `role` may read the group's tags. `null` means the actor is not a member, which
 * answers "group not found" so a stranger cannot tell a group exists.
 */
export function assertCanReadTags(role: GroupRole | null): void {
  if (role === null || !canRead(role)) throw new TagError("GROUP_NOT_FOUND", "Group not found")
}

/** Throws unless `role` may create, change or delete the group's tags: editor or above. */
export function assertCanWriteTags(role: GroupRole | null): void {
  assertCanReadTags(role)
  if (!canMutateNotes(role!)) {
    throw new TagError("ROLE_INSUFFICIENT", "Only an editor can change tags")
  }
}
// #endregion Authorization

// #region Commands and queries
export interface TagCreatePayload {
  actor: Actor
  groupId: string
  id: string
  name: string
  color: TagColor
  /** The request this came from, kept on the audit event. */
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

export interface TagWriteResult {
  tag: Tag
  /** `false` when the same tag was already created by an earlier try of the same request. */
  created: boolean
}

export class TagCreateCommand implements Command<TagCreatePayload, TagWriteResult> {
  __resultType?: TagWriteResult
  constructor(public data: TagCreatePayload) {}
}

export interface TagUpdatePayload {
  actor: Actor
  groupId: string
  id: string
  name: string
  color: TagColor
  /** The version the person edited; a tag at any other version is not changed. */
  version: number
  requestId?: string
  idempotencyKey?: string
}

export class TagUpdateCommand implements Command<TagUpdatePayload, { tag: Tag }> {
  __resultType?: { tag: Tag }
  constructor(public data: TagUpdatePayload) {}
}

export interface TagDeletePayload {
  actor: Actor
  groupId: string
  id: string
  version: number
  requestId?: string
  idempotencyKey?: string
}

/**
 * Deletes a tag for good. Its links to notes go with it; the notes stay, and their version does
 * not change (ADR 003, section 5, rule 3).
 */
export class TagDeleteCommand implements Command<TagDeletePayload, { tag: DeletedTag }> {
  __resultType?: { tag: DeletedTag }
  constructor(public data: TagDeletePayload) {}
}

export interface TagListPayload {
  actor: Actor
  groupId: string
}

export class TagListQuery implements Query<TagListPayload, { tags: ListedTag[] }> {
  __resultType?: { tags: ListedTag[] }
  constructor(public data: TagListPayload) {}
}

export interface TagGetPayload {
  actor: Actor
  groupId: string
  id: string
}

export class TagGetQuery implements Query<TagGetPayload, { tag: Tag }> {
  __resultType?: { tag: Tag }
  constructor(public data: TagGetPayload) {}
}
// #endregion Commands and queries

// #region Ports
export interface TagCreateInput {
  groupId: string
  id: string
  name: string
  color: TagColor
  requestId?: string
}

export interface TagUpdateInput {
  groupId: string
  id: string
  name: string
  color: TagColor
  expectedVersion: number
  requestId?: string
}

export interface TagDeleteInput {
  groupId: string
  id: string
  expectedVersion: number
  requestId?: string
}

/**
 * Where tags are kept. Every write records a change on the group in its own transaction (the
 * group's sequence, an outbox row and an audit event). The handlers check who may write before
 * they call it; a write checks again inside its transaction, as a role can change in between.
 */
export interface TagRepository {
  /** The group's tags, by name, each with its note count. */
  list(groupId: string): Promise<ListedTag[]>
  get(groupId: string, id: string): Promise<Tag | null>
  /**
   * Throws `ID_ALREADY_EXISTS` when the id holds a different tag, `TAG_NAME_TAKEN` when another
   * tag of the group has the name (compared without regard to case), and `TAG_LIMIT_REACHED` when
   * the group already holds {@link TAG_MAX_PER_GROUP} tags. A retry of a create that landed is
   * answered with its tag, full group or not.
   */
  create(input: TagCreateInput, actorId: number): Promise<TagWriteResult>
  /** Throws `TAG_NOT_FOUND`, `TAG_NAME_TAKEN`, or {@link TagVersionConflictError}. */
  update(input: TagUpdateInput, actorId: number): Promise<Tag>
  /** Throws `TAG_NOT_FOUND`, or {@link TagVersionConflictError} for a stale version. */
  delete(input: TagDeleteInput, actorId: number): Promise<DeletedTag>
}
// #endregion Ports

// #region Export file
/**
 * One tag in a group's export file: its id in the file, which the file's notes name it by, its
 * name and colour, and when it was written.
 */
export const tagExportEntrySchema = type({
  id: UUID_PATTERN,
  ...tagFields,
  createdAt: "string.date.iso.parse",
  updatedAt: "string.date.iso.parse",
  "+": "reject",
})
export type TagExportEntry = typeof tagExportEntrySchema.infer

/**
 * Checks one tag of a file with the rules of a create, reading an old colour name as its hex.
 * Throws `TagError("INVALID_REQUEST")`.
 */
export function parseTagExportEntry(entry: unknown): TagExportEntry {
  const value = typeof entry === "object" && entry !== null && "color" in entry
    ? { ...entry, color: legacyExportColor(entry.color) }
    : entry
  const shape = tagExportEntrySchema(value)
  if (shape instanceof type.errors) {
    throw new TagError("INVALID_REQUEST", plainEntryProblem(shape, "tag", TAG_EXPORT_LABELS))
  }
  return parseTagRequest(tagExportEntrySchema, value) as TagExportEntry
}

/** What a refusal calls each field of a tag in a file. */
const TAG_EXPORT_LABELS = {
  id: "id",
  name: "name",
  color: "colour",
  createdAt: "creation date",
  updatedAt: "last change date",
}

/**
 * What is wrong across a file's tags, by index: a name another tag already has, compared without
 * regard to case as the group's unique index does, and more than {@link TAG_MAX_PER_GROUP} tags
 * (index `null`: the tags as a whole).
 */
export function tagExportProblems(
  tags: readonly Pick<TagExportEntry, "name">[],
): { index: number | null; problem: string }[] {
  const problems: { index: number | null; problem: string }[] = []
  if (tags.length > TAG_MAX_PER_GROUP) {
    problems.push({
      index: null,
      problem: `the file holds ${tags.length} tags, and a group holds at most ${TAG_MAX_PER_GROUP}`,
    })
  }
  const names = new Set<string>()
  tags.forEach((tag, index) => {
    const name = tag.name.toLowerCase()
    if (names.has(name)) problems.push({ index, problem: `another tag in the file is called this` })
    names.add(name)
  })
  return problems
}
// #endregion Export file
