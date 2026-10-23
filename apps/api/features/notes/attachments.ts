import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { Operations } from "@spy4x/realtime/operations"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type AttachmentRules, type Entitlements, PlanError } from "@domain/billing"
import { canManageBilling, type GroupRole } from "@domain/groups"
import type { Actor } from "@domain/identity"
import {
  assertCanReadNotes,
  assertCanWriteNotes,
  type Attachment,
  ATTACHMENT_TYPES,
  AttachmentCancelCommand,
  attachmentCancelPayloadSchema,
  AttachmentConfirmCommand,
  attachmentConfirmPayloadSchema,
  attachmentDownloadPayloadSchema,
  AttachmentDownloadQuery,
  AttachmentError,
  attachmentListPayloadSchema,
  AttachmentListQuery,
  type AttachmentListResult,
  attachmentObjectKey,
  AttachmentRemoveCommand,
  attachmentRemovePayloadSchema,
  type AttachmentRepository,
  AttachmentSignCommand,
  attachmentSignPayloadSchema,
  type AttachmentUploadBudget,
  type GroupRoleLookup,
  NoteError,
  parseAttachmentRequest,
  type SignedAttachmentUpload,
} from "@domain/notes"
import { FileRefusal, fileRule, type FileStore } from "@server/files/files.ts"

/** The group's plan, as the attachment handlers need it. */
export interface AttachmentPlans {
  /** The plan's caps (`limits.maxAttachments`, `limits.storageBytes`) and its file rules. */
  of(groupId: string): Promise<{ limits: Entitlements["limits"]; rules: AttachmentRules }>
}

export interface AttachmentHandlerDependencies {
  attachments: AttachmentRepository
  groups: GroupRoleLookup
  files: FileStore
  plans: AttachmentPlans
  /** What one person may sign per hour, whatever the plan. */
  budget: AttachmentUploadBudget
}

/** The file store's refusal, as the attachment's error. */
function refusalError(refusal: FileRefusal, rules: AttachmentRules): AttachmentError {
  switch (refusal) {
    case FileRefusal.Type:
      return new AttachmentError(
        "FILE_TYPE",
        "Only JPEG, PNG, WebP, GIF and PDF files can be attached",
      )
    case FileRefusal.Size:
      return new AttachmentError(
        "FILE_TOO_LARGE",
        `Each file can be up to ${rules.maxFileBytes} bytes`,
        rules.maxFileBytes,
      )
    case FileRefusal.Missing:
      return new AttachmentError("FILE_MISSING", "Nothing was uploaded")
    case FileRefusal.Content:
      return new AttachmentError("FILE_CONTENT", "The file is not the type its name says")
  }
}

/**
 * `attachment.sign`: an editor asks to upload one file to a live note. The type, the size, the
 * note's count and the group's caps are checked before anything is signed; the confirm checks them
 * all again, on the stored bytes and under the group's lock. The person's waiting uploads and
 * hourly budget are checked as the upload is kept, under the person's lock.
 */
export function createAttachmentSignHandler(
  { attachments, groups, files, plans, budget }: AttachmentHandlerDependencies,
): CommandHandler<AttachmentSignCommand> {
  return async ({ data }): Promise<SignedAttachmentUpload> => {
    const role = await groups.roleOf(data.groupId, data.actor.userId)
    assertCanWriteNotes(role)
    if (!await attachments.hasLiveNote(data.groupId, data.noteId)) {
      throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    }
    const { limits, rules } = await plans.of(data.groupId)
    const rule = fileRule(ATTACHMENT_TYPES, rules.maxFileBytes)
    if (await attachments.countForNote(data.noteId) >= rules.maxPerNote) {
      throw new AttachmentError(
        "NOTE_FULL",
        `A note holds up to ${rules.maxPerNote} files`,
        rules.maxPerNote,
      )
    }
    const usage = await attachments.usage(data.groupId)
    const room = { maxFiles: limits.maxAttachments, maxBytes: limits.storageBytes }
    // Refused here with the same answer the confirm would give, so no upload is spent on it.
    if (room.maxFiles !== null && usage.files >= room.maxFiles) {
      throw planRefusal(role as GroupRole, "maxAttachments", room.maxFiles)
    }
    if (room.maxBytes !== null && usage.bytes + data.size > room.maxBytes) {
      throw planRefusal(role as GroupRole, "storageBytes", room.maxBytes)
    }
    const upload = await files.signUpload(rule, { contentType: data.contentType, size: data.size })
    if (!upload.success) throw refusalError(upload.error, rules)
    const id = uuidV7()
    // Refused past the person's waiting uploads or hourly budget. The plan caps what a group keeps;
    // the budget caps how fast one person writes to the store, with billing on or off, so nobody
    // fills the server's disk with uploads (the public demo included).
    await attachments.createUpload({
      id,
      noteId: data.noteId,
      userId: data.actor.userId,
      stagingKey: upload.output.stagingKey,
      name: data.name,
      contentType: data.contentType,
      size: data.size,
    }, budget)
    return { id, url: upload.output.url, headers: upload.output.headers }
  }
}

/** The plan's refusal of a file the group has no room for, as the confirm would give it. */
function planRefusal(role: GroupRole, limit: "maxAttachments" | "storageBytes", max: number) {
  return new PlanError(
    "PLAN_LIMIT_REACHED",
    limit,
    max,
    canManageBilling(role),
    "The group has reached its plan's limit",
  )
}

/**
 * `attachment.confirm`: the uploader says the PUT is done. The waiting upload is taken first, so
 * it confirms once however many confirms arrive, and only for the person who signed it. The store
 * then moves the bytes to a key no browser can write and checks them (`FileStore.confirmUpload`),
 * and the row is added under the group's lock, which counts the caps again. A file refused at any
 * step is deleted.
 */
export function createAttachmentConfirmHandler(
  { attachments, groups, files, plans }: AttachmentHandlerDependencies,
): CommandHandler<AttachmentConfirmCommand> {
  return async ({ data }): Promise<{ attachment: Attachment }> => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const upload = await attachments.claimUpload(data.id, data.actor.userId)
    if (!upload) throw new AttachmentError("UPLOAD_NOT_FOUND", "Upload not found")
    const { limits, rules } = await plans.of(data.groupId)
    const key = attachmentObjectKey(upload.id)
    const confirmed = await files.confirmUpload(upload.stagingKey, key, {
      contentType: upload.contentType,
      size: upload.size,
    })
    if (!confirmed.success) throw refusalError(confirmed.error, rules)
    try {
      const attachment = await attachments.add(data.groupId, upload, key, {
        maxFiles: limits.maxAttachments,
        maxBytes: limits.storageBytes,
        maxPerNote: rules.maxPerNote,
      }, data.actor.userId)
      return { attachment }
    } catch (error) {
      // Nothing points at the moved file now, so it goes; the error says why.
      await files.delete(key).catch(() => {})
      throw error
    }
  }
}

/** `attachment.remove`: an editor removes a file. Its object is deleted now, or by the worker. */
export function createAttachmentRemoveHandler(
  { attachments, groups, files }: AttachmentHandlerDependencies,
): CommandHandler<AttachmentRemoveCommand> {
  return async ({ data }) => {
    assertCanWriteNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const key = await attachments.remove(data.groupId, data.id, data.actor.userId, data.requestId)
    await deleteStored(attachments, files, key)
    return { id: data.id }
  }
}

/**
 * Deletes a removed file's object and its queued deletion. A store that does not answer leaves the
 * queue row, and the worker tries again.
 */
export async function deleteStored(
  attachments: Pick<AttachmentRepository, "forgetDeletion">,
  files: Pick<FileStore, "delete">,
  key: string,
): Promise<void> {
  try {
    await files.delete(key)
    await attachments.forgetDeletion(key)
  } catch {
    // The queue row stays for the worker.
  }
}

/** `attachment.list`: a live note's files and the group's room, for every member. */
export function createAttachmentListHandler(
  { attachments, groups, plans }: AttachmentHandlerDependencies,
): QueryHandler<AttachmentListQuery> {
  return async ({ data }): Promise<AttachmentListResult> => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    if (!await attachments.hasLiveNote(data.groupId, data.noteId)) {
      throw new NoteError("NOTE_NOT_FOUND", "Note not found")
    }
    const [list, usage, plan] = await Promise.all([
      attachments.list(data.groupId, data.noteId),
      attachments.usage(data.groupId),
      plans.of(data.groupId),
    ])
    return {
      attachments: list,
      usage: {
        ...usage,
        maxFiles: plan.limits.maxAttachments,
        maxBytes: plan.limits.storageBytes,
        maxFileBytes: plan.rules.maxFileBytes,
        maxPerNote: plan.rules.maxPerNote,
      },
    }
  }
}

/**
 * `attachment.download`: a five-minute link to one file of a live note, for every member. The
 * store answers with the confirmed type, an image in place and a PDF as an attachment.
 */
export function createAttachmentDownloadHandler(
  { attachments, groups, files }: AttachmentHandlerDependencies,
): QueryHandler<AttachmentDownloadQuery> {
  return async ({ data }) => {
    assertCanReadNotes(await groups.roleOf(data.groupId, data.actor.userId))
    const attachment = await attachments.get(data.groupId, data.id)
    if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "File not found")
    const url = await files.signDownload(attachment.objectKey, {
      contentType: attachment.contentType,
      filename: attachment.name,
    })
    return { url }
  }
}

/**
 * `attachment.cancel`: the person drops an upload they signed, so it stops counting as waiting.
 * Only their own, and only while it waits; anything else is left as it is.
 */
export function createAttachmentCancelHandler(
  { attachments }: Pick<AttachmentHandlerDependencies, "attachments">,
): CommandHandler<AttachmentCancelCommand> {
  return async ({ data }): Promise<{ id: string }> => {
    await attachments.releaseUpload(data.id, data.actor.userId)
    return { id: data.id }
  }
}

/** What the attachment operations need from the app: the buses. */
export interface AttachmentOperationDependencies {
  sign(command: AttachmentSignCommand): Promise<SignedAttachmentUpload>
  confirm(command: AttachmentConfirmCommand): Promise<{ attachment: Attachment }>
  cancel(command: AttachmentCancelCommand): Promise<{ id: string }>
  remove(command: AttachmentRemoveCommand): Promise<{ id: string }>
  list(query: AttachmentListQuery): Promise<AttachmentListResult>
  download(query: AttachmentDownloadQuery): Promise<{ url: string }>
}

/** The attachment operations, listed once for the socket and `POST /api/call/<name>`. */
export function createAttachmentOperations(
  dependencies: AttachmentOperationDependencies,
): Operations<Actor> {
  return {
    "attachment.sign": {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parseAttachmentRequest(attachmentSignPayloadSchema, payload)
        return await dependencies.sign(
          new AttachmentSignCommand({ actor, ...input, idempotencyKey }),
        )
      },
    },
    "attachment.confirm": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseAttachmentRequest(attachmentConfirmPayloadSchema, payload)
        return await dependencies.confirm(
          new AttachmentConfirmCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "attachment.cancel": {
      kind: "command",
      handle: async ({ actor, payload }) => {
        const input = parseAttachmentRequest(attachmentCancelPayloadSchema, payload)
        return await dependencies.cancel(new AttachmentCancelCommand({ actor, ...input }))
      },
    },
    "attachment.remove": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseAttachmentRequest(attachmentRemovePayloadSchema, payload)
        return await dependencies.remove(
          new AttachmentRemoveCommand({ actor, ...input, requestId, idempotencyKey }),
        )
      },
    },
    "attachment.list": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseAttachmentRequest(attachmentListPayloadSchema, payload)
        return await dependencies.list(new AttachmentListQuery({ actor, ...input }))
      },
    },
    "attachment.download": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parseAttachmentRequest(attachmentDownloadPayloadSchema, payload)
        return await dependencies.download(new AttachmentDownloadQuery({ actor, ...input }))
      },
    },
  }
}
