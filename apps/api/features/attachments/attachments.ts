import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { Operations } from "@spy4x/realtime/operations"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type AttachmentRules, type Entitlements, PlanError } from "@domain/billing"
import { canManageBilling, type GroupRole } from "@domain/groups"
import type { Actor } from "@domain/identity"
import {
  type Attachment,
  ATTACHMENT_TYPES,
  AttachmentCancelCommand,
  attachmentCancelPayloadSchema,
  AttachmentConfirmCommand,
  attachmentConfirmPayloadSchema,
  attachmentDownloadPayloadSchema,
  AttachmentDownloadQuery,
  AttachmentError,
  type AttachmentKindRules,
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
  parseAttachmentRequest,
  type SignedAttachmentUpload,
} from "@domain/attachments"
import { FileRefusal, fileRule, type FileStore } from "@server/files/files.ts"

/** The group's plan, as the attachment handlers need it. */
export interface AttachmentPlans {
  /** The plan's caps (`limits.maxAttachments`, `limits.storageBytes`) and its file rules. */
  of(groupId: string): Promise<{ limits: Entitlements["limits"]; rules: AttachmentRules }>
}

export interface AttachmentHandlerDependencies {
  /** Every kind the product serves; a command names one of them. */
  kinds: readonly AttachmentKindRules[]
  /** Where the kind `kind` keeps its files. */
  attachments(kind: string): AttachmentRepository
  groups: GroupRoleLookup
  files: FileStore
  plans: AttachmentPlans
  /** What one person may sign per hour, whatever the plan. */
  budget: AttachmentUploadBudget
}

/**
 * The kind a command names, and its repository. The operations set the name from their own
 * registration, so an unknown one is a server bug; it is refused all the same.
 */
function kindOf(
  { kinds, attachments }: Pick<AttachmentHandlerDependencies, "kinds" | "attachments">,
  name: string,
): { kind: AttachmentKindRules; repository: AttachmentRepository } {
  const kind = kinds.find((candidate) => candidate.name === name)
  if (!kind) throw new AttachmentError("INVALID_REQUEST", `No attachment kind ${name}`)
  return { kind, repository: attachments(kind.name) }
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

/** The refusal of a record that holds as many files as its plan allows. */
function recordFull(max: number): AttachmentError {
  return new AttachmentError("RECORD_FULL", `A record holds up to ${max} files`, max)
}

/**
 * `<prefix>.sign`: an editor asks to upload one file to a live record. The type, the size, the
 * record's count and the group's caps (every kind's files together) are checked before anything
 * is signed; the confirm checks them all again, on the stored bytes and under the group's lock.
 * The person's waiting uploads and hourly budget are checked as the upload is kept, under the
 * person's lock.
 */
export function createAttachmentSignHandler(
  dependencies: AttachmentHandlerDependencies,
): CommandHandler<AttachmentSignCommand> {
  const { groups, files, plans, budget } = dependencies
  return async ({ data }): Promise<SignedAttachmentUpload> => {
    const { kind, repository } = kindOf(dependencies, data.kind)
    const role = await groups.roleOf(data.groupId, data.actor.userId)
    kind.assertCanWrite(role)
    if (!await repository.hasLiveRecord(data.groupId, data.recordId)) throw kind.recordNotFound()
    const { limits, rules } = await plans.of(data.groupId)
    const rule = fileRule(ATTACHMENT_TYPES, rules.maxFileBytes)
    if (await repository.countForRecord(data.recordId) >= rules.maxPerRecord) {
      throw recordFull(rules.maxPerRecord)
    }
    const usage = await repository.usage(data.groupId)
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
    await repository.createUpload({
      id,
      recordId: data.recordId,
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
 * `<prefix>.confirm`: the uploader says the PUT is done. The waiting upload is taken first, so it
 * confirms once however many confirms arrive, only for the person who signed it, and only through
 * the kind it was signed for. The store then moves the bytes to a key no browser can write and
 * checks them (`FileStore.confirmUpload`), and the row is added under the group's lock, which
 * checks the record is still live and counts the caps again. A file refused at any step is
 * deleted.
 */
export function createAttachmentConfirmHandler(
  dependencies: AttachmentHandlerDependencies,
): CommandHandler<AttachmentConfirmCommand> {
  const { groups, files, plans } = dependencies
  return async ({ data }): Promise<{ attachment: Attachment }> => {
    const { kind, repository } = kindOf(dependencies, data.kind)
    kind.assertCanWrite(await groups.roleOf(data.groupId, data.actor.userId))
    const upload = await repository.claimUpload(data.id, data.actor.userId)
    if (!upload) throw new AttachmentError("UPLOAD_NOT_FOUND", "Upload not found")
    const { limits, rules } = await plans.of(data.groupId)
    const key = attachmentObjectKey(upload.id)
    const confirmed = await files.confirmUpload(upload.stagingKey, key, {
      contentType: upload.contentType,
      size: upload.size,
    })
    if (!confirmed.success) throw refusalError(confirmed.error, rules)
    try {
      const attachment = await repository.add(data.groupId, upload, key, {
        maxFiles: limits.maxAttachments,
        maxBytes: limits.storageBytes,
        maxPerRecord: rules.maxPerRecord,
      }, data.actor.userId)
      return { attachment }
    } catch (error) {
      // Nothing points at the moved file now, so it goes; the error says why.
      await files.delete(key).catch(() => {})
      throw error
    }
  }
}

/** `<prefix>.remove`: an editor removes a file. Its object is deleted now, or by the worker. */
export function createAttachmentRemoveHandler(
  dependencies: AttachmentHandlerDependencies,
): CommandHandler<AttachmentRemoveCommand> {
  const { groups, files } = dependencies
  return async ({ data }) => {
    const { kind, repository } = kindOf(dependencies, data.kind)
    kind.assertCanWrite(await groups.roleOf(data.groupId, data.actor.userId))
    const key = await repository.remove(data.groupId, data.id, data.actor.userId, data.requestId)
    await deleteStored(repository, files, key)
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

/** `<prefix>.list`: a live record's files and the group's room, for every member. */
export function createAttachmentListHandler(
  dependencies: AttachmentHandlerDependencies,
): QueryHandler<AttachmentListQuery> {
  const { groups, plans } = dependencies
  return async ({ data }): Promise<AttachmentListResult> => {
    const { kind, repository } = kindOf(dependencies, data.kind)
    kind.assertCanRead(await groups.roleOf(data.groupId, data.actor.userId))
    if (!await repository.hasLiveRecord(data.groupId, data.recordId)) throw kind.recordNotFound()
    const [list, usage, plan] = await Promise.all([
      repository.list(data.groupId, data.recordId),
      repository.usage(data.groupId),
      plans.of(data.groupId),
    ])
    return {
      attachments: list,
      usage: {
        ...usage,
        maxFiles: plan.limits.maxAttachments,
        maxBytes: plan.limits.storageBytes,
        maxFileBytes: plan.rules.maxFileBytes,
        maxPerRecord: plan.rules.maxPerRecord,
      },
    }
  }
}

/**
 * `<prefix>.download`: a five-minute link to one file of a live record, for every member. The
 * store answers with the confirmed type, an image in place and a PDF as an attachment.
 */
export function createAttachmentDownloadHandler(
  dependencies: AttachmentHandlerDependencies,
): QueryHandler<AttachmentDownloadQuery> {
  const { groups, files } = dependencies
  return async ({ data }) => {
    const { kind, repository } = kindOf(dependencies, data.kind)
    kind.assertCanRead(await groups.roleOf(data.groupId, data.actor.userId))
    const attachment = await repository.get(data.groupId, data.id)
    if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "File not found")
    const url = await files.signDownload(attachment.objectKey, {
      contentType: attachment.contentType,
      filename: attachment.name,
    })
    return { url }
  }
}

/**
 * `<prefix>.cancel`: the person drops an upload they signed, so it stops counting as waiting.
 * Only their own, of this kind, and only while it waits; anything else is left as it is.
 */
export function createAttachmentCancelHandler(
  dependencies: Pick<AttachmentHandlerDependencies, "kinds" | "attachments">,
): CommandHandler<AttachmentCancelCommand> {
  return async ({ data }): Promise<{ id: string }> => {
    const { repository } = kindOf(dependencies, data.kind)
    await repository.releaseUpload(data.id, data.actor.userId)
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

/** What the operations read of a kind: its name, its prefix and its payload's record field. */
export interface AttachmentOperationKind {
  name: string
  prefix: string
  recordField: string
}

/**
 * Every kind's attachment operations, listed once for the socket and `POST /api/call/<name>`:
 * `<prefix>.sign`, `.confirm`, `.cancel`, `.remove`, `.list` and `.download` per kind. The
 * commands name the kind from this registration, never from the payload.
 */
export function createAttachmentOperations(
  kinds: readonly AttachmentOperationKind[],
  dependencies: AttachmentOperationDependencies,
): Operations<Actor> {
  return Object.assign({}, ...kinds.map((kind) => kindOperations(kind, dependencies)))
}

/** One kind's six operations. */
function kindOperations(
  { name: kind, prefix, recordField }: AttachmentOperationKind,
  dependencies: AttachmentOperationDependencies,
): Operations<Actor> {
  const parse = <S extends Parameters<typeof parseAttachmentRequest>[0]>(
    schema: S,
    payload: unknown,
  ) => parseAttachmentRequest(schema, payload, recordField)
  return {
    [`${prefix}.sign`]: {
      kind: "command",
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parse(attachmentSignPayloadSchema, payload)
        return await dependencies.sign(
          new AttachmentSignCommand({ actor, ...input, kind, idempotencyKey }),
        )
      },
    },
    [`${prefix}.confirm`]: {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parse(attachmentConfirmPayloadSchema, payload)
        return await dependencies.confirm(
          new AttachmentConfirmCommand({ actor, ...input, kind, requestId, idempotencyKey }),
        )
      },
    },
    [`${prefix}.cancel`]: {
      kind: "command",
      handle: async ({ actor, payload }) => {
        const input = parse(attachmentCancelPayloadSchema, payload)
        return await dependencies.cancel(new AttachmentCancelCommand({ actor, ...input, kind }))
      },
    },
    [`${prefix}.remove`]: {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parse(attachmentRemovePayloadSchema, payload)
        return await dependencies.remove(
          new AttachmentRemoveCommand({ actor, ...input, kind, requestId, idempotencyKey }),
        )
      },
    },
    [`${prefix}.list`]: {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parse(attachmentListPayloadSchema, payload)
        return await dependencies.list(new AttachmentListQuery({ actor, ...input, kind }))
      },
    },
    [`${prefix}.download`]: {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const input = parse(attachmentDownloadPayloadSchema, payload)
        return await dependencies.download(new AttachmentDownloadQuery({ actor, ...input, kind }))
      },
    },
  }
}
