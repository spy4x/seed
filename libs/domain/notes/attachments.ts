import { type Type, type } from "arktype"
import type { Command, Query } from "@spy4x/platform/cqrs"
import { hasUnsafeTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import type { Actor } from "@domain/identity"

/**
 * Note attachments (#225, docs/files.md): images and PDFs kept on a note. Every member of the
 * group reads them and an editor or above adds and removes them, as for the note itself, so the
 * role checks are the notes' (`assertCanReadNotes`, `assertCanWriteNotes`). The limits come from
 * the group's plan: the file rules (`AttachmentRules`) and the caps `maxAttachments` and
 * `storageBytes` of `@domain/billing`.
 */

/** The types a note accepts: those whose first bytes the store can check, minus text. */
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

/** Where a confirmed file is kept. No browser is ever given a URL to write it. */
export function attachmentObjectKey(id: string): string {
  return `attachments/${id}`
}

/** The outbox event kinds an attachment change is recorded under, on the group's change log. */
export const ATTACHMENT_EVENTS = {
  added: "note.attachment.added",
  removed: "note.attachment.removed",
} as const

export type AttachmentErrorCode =
  | "ATTACHMENT_NOT_FOUND"
  | "FILE_CONTENT"
  | "FILE_MISSING"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE"
  | "INVALID_REQUEST"
  | "NOTE_FULL"
  | "UPLOADS_PENDING"
  | "UPLOAD_BUDGET"
  | "UPLOAD_NOT_FOUND"

/**
 * Why an attachment was refused or not found. A refusal by the group's plan (its file or byte
 * cap) is a `PlanError` instead, and who may act is answered with a `NoteError`.
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

/** One file on a note, as the API returns it. */
export interface Attachment {
  id: string
  noteId: string
  name: string
  contentType: string
  size: number
  createdByUserId: number | null
  createdAt: Date
}

/** How much of the group's room its files take, and what its plan allows. */
export interface AttachmentUsage {
  files: number
  bytes: number
  /** The plan's caps, `null` for none. */
  maxFiles: number | null
  maxBytes: number | null
  maxFileBytes: number
  maxPerNote: number
}

/** A signed upload: PUT the file to `url` with `headers`, then confirm `id`. */
export interface SignedAttachmentUpload {
  id: string
  url: string
  headers: { "content-type": string }
}

// #region Request schemas
const groupIdField = { groupId: UUID_PATTERN } as const

/** `attachment.sign`: the file the browser is about to upload to a note. */
export const attachmentSignPayloadSchema = type({
  ...groupIdField,
  noteId: UUID_PATTERN,
  name: "string",
  contentType: "string <= 100",
  size: "number.integer >= 1",
  "+": "reject",
})
/** `attachment.confirm`: the upload `attachment.sign` answered, once the PUT is done. */
export const attachmentConfirmPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `attachment.cancel`: the person drops an upload they signed and will not confirm. */
export const attachmentCancelPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `attachment.remove`. */
export const attachmentRemovePayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `attachment.download`: a short-lived link to one file. */
export const attachmentDownloadPayloadSchema = type({
  ...groupIdField,
  id: UUID_PATTERN,
  "+": "reject",
})
/** `attachment.list`: a note's files and the group's usage. */
export const attachmentListPayloadSchema = type({
  ...groupIdField,
  noteId: UUID_PATTERN,
  "+": "reject",
})

/**
 * Validates `value` against `schema`, then trims a file name and checks its length in characters.
 * A name with a control or invisible character is refused: it would read differently in a header
 * than on screen. Throws `AttachmentError("INVALID_REQUEST")`.
 */
export function parseAttachmentRequest<S extends Type<object>>(
  schema: S,
  value: unknown,
): S["infer"] {
  const result = schema(value)
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
// #endregion Request schemas

// #region Commands and queries
export interface AttachmentSignPayload {
  actor: Actor
  groupId: string
  noteId: string
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

export interface AttachmentIdPayload {
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

export interface AttachmentListPayload {
  actor: Actor
  groupId: string
  noteId: string
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
/** An upload waiting for its confirm. */
export interface PendingAttachmentUpload {
  id: string
  noteId: string
  userId: number
  stagingKey: string
  name: string
  contentType: string
  size: number
}

/** What a confirmed file may not pass: the plan's caps (`null` for none) and the note's cap. */
export interface AttachmentCaps {
  maxFiles: number | null
  maxBytes: number | null
  maxPerNote: number
}

/**
 * Where attachments are kept. The handlers check who may act before they call it; a write checks
 * again inside its transaction, on the locked membership row, as a role can change in between.
 */
export interface AttachmentRepository {
  /** Whether the note is live in the group: a deleted note and another group's are not. */
  hasLiveNote(groupId: string, noteId: string): Promise<boolean>
  /** The note's files, oldest first; empty for a note that is not live in the group. */
  list(groupId: string, noteId: string): Promise<Attachment[]>
  /** One file of a live note of the group, with its stored key, or `null`. */
  get(groupId: string, id: string): Promise<(Attachment & { objectKey: string }) | null>
  /** The group's files and their bytes. */
  usage(groupId: string): Promise<{ files: number; bytes: number }>
  /** How many files the note holds. */
  countForNote(noteId: string): Promise<number>
  /** Settles the person's waiting upload without a file: it stops counting as waiting. */
  releaseUpload(id: string, userId: number): Promise<void>
  /**
   * Keeps the person's new waiting upload. It locks the person first and counts after the lock, so
   * signs sent at once wait for each other and each counts the ones before it.
   * @throws {AttachmentError} `UPLOADS_PENDING` when {@link ATTACHMENT_PENDING_MAX} uploads wait,
   * `UPLOAD_BUDGET` when this one would pass `budget`.
   */
  createUpload(upload: PendingAttachmentUpload, budget: AttachmentUploadBudget): Promise<void>
  /**
   * Takes the person's waiting upload, so a second confirm of it finds nothing: the row is settled
   * as it is read, and kept for the hourly budget. `null` when it is not there, is settled already
   * or is another person's.
   */
  claimUpload(id: string, userId: number): Promise<PendingAttachmentUpload | null>
  /**
   * Adds a confirmed file under `objectKey`, in one transaction that checks the actor's role and
   * the note on the locked rows, counts the caps before the insert, under the group's lock, and
   * records the change. Throws
   * `NoteError` (`GROUP_NOT_FOUND`, `ROLE_INSUFFICIENT`, `NOTE_NOT_FOUND`), `AttachmentError`
   * (`NOTE_FULL`) or a `PlanError` (`maxAttachments`, `storageBytes`), and adds nothing then.
   */
  add(
    groupId: string,
    upload: PendingAttachmentUpload,
    objectKey: string,
    caps: AttachmentCaps,
    actorId: number,
  ): Promise<Attachment>
  /**
   * Removes one file of the group and queues its object for deletion. Throws `NoteError` for the
   * role and `ATTACHMENT_NOT_FOUND`. Returns the stored key.
   */
  remove(groupId: string, id: string, actorId: number, requestId?: string): Promise<string>
  /** Forgets a queued deletion once its object is gone. */
  forgetDeletion(objectKey: string): Promise<void>
}
// #endregion Ports
