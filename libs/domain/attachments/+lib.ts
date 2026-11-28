import { type Type, type } from "arktype"
import type { Command, Query } from "@spy4x/platform/cqrs"
import { hasUnsafeTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import type { GroupRole } from "@domain/groups"
import type { Actor } from "@domain/identity"

/**
 * Attachments (docs/attachments-and-pictures.md): images and PDFs kept on a record of any
 * registered kind, such as a note. A kind says who may read and add them (the notes' kind uses
 * `assertCanReadNotes` and `assertCanWriteNotes`). The limits come from the group's plan: the file
 * rules (`AttachmentRules`) and the caps `maxAttachments` and `storageBytes` of `@domain/billing`,
 * which count the group's files of every kind together.
 */

/** The types a record accepts: those whose first bytes the store can check, minus text. */
export const ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const

/** The longest file name kept, in characters. */
export const ATTACHMENT_NAME_MAX_LENGTH = 255

/**
 * The most uploads one person may have waiting at once: signed in the last
 * {@link ATTACHMENT_PENDING_MINUTES} minutes, and neither confirmed nor cancelled. A signed upload
 * takes room in the store before any quota counts it; this keeps one person from filling the
 * staging area until the nightly clean-up.
 */
export const ATTACHMENT_PENDING_MAX = 20

/**
 * How long a signed upload counts as waiting: its URL's five minutes and five more for a slow
 * confirm. An older one can no longer be uploaded, so it never locks its person out.
 */
export const ATTACHMENT_PENDING_MINUTES = 10

/**
 * What one person may sign per hour, whatever the group's plan: `files` uploads and `bytes` in
 * all, counting every signed upload, confirmed or not. Plans cap a group's stored files; this caps
 * how fast anyone, a guest of the public demo included, can write to the store. Each server sets
 * its own with `ATTACHMENT_UPLOAD_FILES_PER_HOUR` and `ATTACHMENT_UPLOAD_BYTES_PER_HOUR`.
 */
export interface AttachmentUploadBudget {
  files: number
  bytes: number
}

/** The budget a server has unless its settings say otherwise: 50 files or 50 MiB an hour. */
export const ATTACHMENT_UPLOAD_BUDGET: AttachmentUploadBudget = {
  files: 50,
  bytes: 50 * 1024 * 1024,
}

/** How long an unconfirmed upload is kept before the worker deletes it: one day. */
export const ATTACHMENT_UPLOAD_HOURS = 24

/** Where a confirmed file is kept, whatever its kind. No browser is ever given a URL to write it. */
export function attachmentObjectKey(id: string): string {
  return `attachments/${id}`
}

/**
 * The outbox event kinds an attachment change of `kind` is recorded under, on the group's change
 * log: `note.attachment.added` for a note's file.
 */
export function attachmentEvents(kind: string): { added: string; removed: string } {
  return { added: `${kind}.attachment.added`, removed: `${kind}.attachment.removed` }
}

export type AttachmentErrorCode =
  | "ATTACHMENT_NOT_FOUND"
  | "FILE_CONTENT"
  | "FILE_MISSING"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE"
  | "INVALID_REQUEST"
  | "RECORD_FULL"
  | "UPLOADS_PENDING"
  | "UPLOAD_BUDGET"
  | "UPLOAD_NOT_FOUND"

/**
 * Why an attachment was refused or not found. A refusal by the group's plan (its file or byte
 * cap) is a `PlanError` instead, and who may act and a missing record are answered with the kind's
 * own errors (a `NoteError` for a note).
 */
export class AttachmentError extends Error {
  constructor(
    public readonly code: AttachmentErrorCode,
    message: string,
    /** The limit that refused it, for the message the screen shows. */
    public readonly limit: number | null = null,
  ) {
    super(message)
    this.name = "AttachmentError"
  }
}

/** One file on a record, as the API returns it. */
export interface Attachment {
  id: string
  /** The record it is on: a note's id for a note's file. */
  recordId: string
  name: string
  contentType: string
  size: number
  createdByUserId: number | null
  createdAt: Date
}

/** How much of the group's room its files of every kind take, and what its plan allows. */
export interface AttachmentUsage {
  files: number
  bytes: number
  /** The plan's caps, `null` for none. */
  maxFiles: number | null
  maxBytes: number | null
  maxFileBytes: number
  maxPerRecord: number
}

/** A signed upload: PUT the file to `url` with `headers`, then confirm `id`. */
export interface SignedAttachmentUpload {
  id: string
  url: string
  headers: { "content-type": string }
}

/**
 * What every kind's handlers ask of it: who may read and add files, and the error for a record
 * that is not live in the group. The notes' kind answers with `NoteError`, as the notes do.
 */
export interface AttachmentKindRules {
  /** The kind's name, as `file_uploads.record_kind` and the audit rows keep it: `note`. */
  name: string
  /** Throws unless `role` may list and download the kind's files. */
  assertCanRead(role: GroupRole | null): void
  /** Throws unless `role` may add and remove them. */
  assertCanWrite(role: GroupRole | null): void
  /** The error for a record that is missing, deleted or another group's. */
  recordNotFound(): Error
}

// #region Request schemas
const groupIdField = { groupId: UUID_PATTERN } as const

/** `<prefix>.sign`: the file the browser is about to upload to a record. */
export const attachmentSignPayloadSchema = type({
  ...groupIdField,
  recordId: UUID_PATTERN,
  name: "string",
  contentType: "string <= 100",
  size: "number.integer >= 1",
  "+": "reject",
})
/** `<prefix>.confirm`: the upload `<prefix>.sign` answered, once the PUT is done. */
export const attachmentConfirmPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `<prefix>.cancel`: the person drops an upload they signed and will not confirm. */
export const attachmentCancelPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `<prefix>.remove`. */
export const attachmentRemovePayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `<prefix>.download`: a short-lived link to one file. */
export const attachmentDownloadPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `<prefix>.list`: a record's files and the group's usage. */
export const attachmentListPayloadSchema = type({
  ...groupIdField,
  recordId: UUID_PATTERN,
  "+": "reject",
})

/**
 * Validates `value` against `schema`, then trims a file name and checks its length in characters.
 * A name with a control or invisible character is refused: it would read differently in a header
 * than on screen. Throws `AttachmentError("INVALID_REQUEST")`.
 *
 * `recordField` is the payload's name for the record's id when it is not `recordId` (`noteId` for
 * a note): that field is read as `recordId`, and a payload that sends `recordId` is refused.
 */
export function parseAttachmentRequest<S extends Type<object>>(
  schema: S,
  value: unknown,
  recordField = `recordId`,
): S["infer"] {
  const result = schema(renameRecordField(value, recordField))
  if (result instanceof type.errors) throw new AttachmentError("INVALID_REQUEST", result.summary)
  const parsed = result as S["infer"] & { name?: string }
  if (parsed.name === undefined) return parsed
  const name = parsed.name.trim()
  const length = Array.from(name).length
  if (length < 1 || length > ATTACHMENT_NAME_MAX_LENGTH || hasUnsafeTextCharacters(name)) {
    throw new AttachmentError(
      "INVALID_REQUEST",
      `A file name must hold 1 to ${ATTACHMENT_NAME_MAX_LENGTH} visible characters`,
    )
  }
  return { ...parsed, name }
}

/** `value` with its `recordField` read as `recordId`; anything else is left for the schema. */
function renameRecordField(value: unknown, recordField: string): unknown {
  if (recordField === `recordId` || typeof value !== `object` || value === null) return value
  if (Object.hasOwn(value, `recordId`)) {
    throw new AttachmentError("INVALID_REQUEST", `Name the record with ${recordField}`)
  }
  if (!Object.hasOwn(value, recordField)) return value
  const { [recordField]: recordId, ...rest } = value as Record<string, unknown>
  return { ...rest, recordId }
}
// #endregion Request schemas

// #region Commands and queries
/** What every attachment command and query carries: the kind it is for, by name. */
interface KindPayload {
  /** The registered kind's name (`note`); the operations set it, never the payload. */
  kind: string
}

export interface AttachmentSignPayload extends KindPayload {
  actor: Actor
  groupId: string
  recordId: string
  name: string
  contentType: string
  size: number
  idempotencyKey?: string
}

export class AttachmentSignCommand
  implements Command<AttachmentSignPayload, SignedAttachmentUpload> {
  __resultType?: SignedAttachmentUpload
  constructor(public data: AttachmentSignPayload) {}
}

export interface AttachmentIdPayload extends KindPayload {
  actor: Actor
  groupId: string
  id: string
  requestId?: string
  idempotencyKey?: string
}

export class AttachmentConfirmCommand
  implements Command<AttachmentIdPayload, { attachment: Attachment }> {
  __resultType?: { attachment: Attachment }
  constructor(public data: AttachmentIdPayload) {}
}

/** Releases the person's own waiting upload, so it no longer counts as waiting. */
export class AttachmentCancelCommand implements Command<AttachmentIdPayload, { id: string }> {
  __resultType?: { id: string }
  constructor(public data: AttachmentIdPayload) {}
}

export class AttachmentRemoveCommand implements Command<AttachmentIdPayload, { id: string }> {
  __resultType?: { id: string }
  constructor(public data: AttachmentIdPayload) {}
}

export class AttachmentDownloadQuery implements Query<AttachmentIdPayload, { url: string }> {
  __resultType?: { url: string }
  constructor(public data: AttachmentIdPayload) {}
}

export interface AttachmentListPayload extends KindPayload {
  actor: Actor
  groupId: string
  recordId: string
}

export interface AttachmentListResult {
  attachments: Attachment[]
  usage: AttachmentUsage
}

export class AttachmentListQuery implements Query<AttachmentListPayload, AttachmentListResult> {
  __resultType?: AttachmentListResult
  constructor(public data: AttachmentListPayload) {}
}
// #endregion Commands and queries

// #region Ports
/** An upload waiting for its confirm, on a record of the repository's kind. */
export interface PendingAttachmentUpload {
  id: string
  recordId: string
  userId: number
  stagingKey: string
  name: string
  contentType: string
  size: number
}

/** What a confirmed file may not pass: the plan's caps (`null` for none) and the record's cap. */
export interface AttachmentCaps {
  maxFiles: number | null
  maxBytes: number | null
  maxPerRecord: number
}

/**
 * Where one kind's attachments are kept. The handlers check who may act before they call it; a
 * write checks again inside its transaction, on the locked membership row, as a role can change
 * in between. The group's usage counts the files of every registered kind.
 */
export interface AttachmentRepository {
  /** Whether the record is live in the group: a deleted record and another group's are not. */
  hasLiveRecord(groupId: string, recordId: string): Promise<boolean>
  /** The record's files, oldest first; empty for a record that is not live in the group. */
  list(groupId: string, recordId: string): Promise<Attachment[]>
  /** One file of a live record of the group, with its stored key, or `null`. */
  get(groupId: string, id: string): Promise<(Attachment & { objectKey: string }) | null>
  /** The group's files of every kind and their bytes. */
  usage(groupId: string): Promise<{ files: number; bytes: number }>
  /** How many files the record holds. */
  countForRecord(recordId: string): Promise<number>
  /** Settles the person's waiting upload of this kind without a file: it stops counting as waiting. */
  releaseUpload(id: string, userId: number): Promise<void>
  /**
   * Keeps the person's new waiting upload. It locks the person first and counts after the lock, so
   * signs sent at once wait for each other and each counts the ones before it.
   * @throws {AttachmentError} `UPLOADS_PENDING` when {@link ATTACHMENT_PENDING_MAX} uploads wait,
   * `UPLOAD_BUDGET` when this one would pass `budget`.
   */
  createUpload(upload: PendingAttachmentUpload, budget: AttachmentUploadBudget): Promise<void>
  /**
   * Takes the person's waiting upload of this kind, so a second confirm of it finds nothing: the
   * row is settled as it is read, and kept for the hourly budget. `null` when it is not there, is
   * settled already, is another person's or is another kind's or a picture's.
   */
  claimUpload(id: string, userId: number): Promise<PendingAttachmentUpload | null>
  /**
   * Adds a confirmed file under `objectKey`, in one transaction that checks the actor's role and
   * the record on the locked rows, counts the caps before the insert, under the group's lock, and
   * records the change. Throws the kind's errors (role, `recordNotFound`), a `GroupError`
   * (`GROUP_NOT_FOUND`), `AttachmentError` (`RECORD_FULL`) or a `PlanError` (`maxAttachments`,
   * `storageBytes`), and adds nothing then.
   */
  add(
    groupId: string,
    upload: PendingAttachmentUpload,
    objectKey: string,
    caps: AttachmentCaps,
    actorId: number,
  ): Promise<Attachment>
  /**
   * Removes one file of the group and queues its object for deletion. Throws the kind's role error
   * and `ATTACHMENT_NOT_FOUND`. Returns the stored key.
   */
  remove(groupId: string, id: string, actorId: number, requestId?: string): Promise<string>
  /** Forgets a queued deletion once its object is gone. */
  forgetDeletion(objectKey: string): Promise<void>
}

/** The actor's role in a group, read where it decides who may act. */
export interface GroupRoleLookup {
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
}
// #endregion Ports
