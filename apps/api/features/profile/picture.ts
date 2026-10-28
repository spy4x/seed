import type { CommandHandler } from "@spy4x/platform/cqrs"
import type { Operations } from "@spy4x/realtime/operations"
import type { RequestInfo } from "@spy4x/platform/request-info"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectNoPayload } from "@spy4x/realtime"
import {
  type Actor,
  parsePictureRequest,
  PICTURE_AUDIT,
  PICTURE_MAX_BYTES,
  PICTURE_TYPES,
  PictureCancelCommand,
  PictureConfirmCommand,
  PictureError,
  pictureObjectKey,
  PictureRemoveCommand,
  PictureSignCommand,
  pictureSignPayloadSchema,
  pictureUploadPayloadSchema,
  type SignedPictureUpload,
  type User,
} from "@domain/identity"
import type { AttachmentUploadBudget } from "@domain/notes"
import type { StoredPicture } from "@server/auth/profile-pictures.ts"
import { FileRefusal, fileRule, type FileStore } from "@server/files/files.ts"
import type { LedgerUpload, UploadRefusal } from "@server/files/upload-ledger.ts"
import { UserProfileUpdatedEvent } from "../../cqrs/events.ts"

/** The `users` rows and signed uploads the picture handlers write (`AppDbBase.pictures`). */
export interface PictureStore {
  reserve(upload: LedgerUpload, budget: AttachmentUploadBudget): Promise<UploadRefusal | null>
  claim(id: string, userId: number): Promise<LedgerUpload | null>
  release(id: string, userId: number): Promise<void>
  /**
   * Sets or clears the picture and writes the person's `auth_audits` row, in one transaction.
   * `null` when the person is gone.
   */
  set(
    userId: number,
    picture: StoredPicture | null,
    request: RequestInfo,
  ): Promise<{ user: User; previous: string | null } | null>
  /** Forgets the replaced picture's queued deletion once its object is gone. */
  forgetDeletion(objectKey: string): Promise<void>
}

export interface PictureHandlerDependencies {
  pictures: PictureStore
  files: FileStore
  /** What one person may sign per hour, attachments and pictures together. */
  budget: AttachmentUploadBudget
  emit(event: UserProfileUpdatedEvent): void
}

const RULE = fileRule(PICTURE_TYPES, PICTURE_MAX_BYTES)

/** The ledger's `name` for a picture's upload. */
export const PICTURE_AUDIT_IDENTIFIER = PICTURE_AUDIT.changed

/** The audit row's `identifier` for the person's own change of picture: a new one, or none. */
export function pictureAuditIdentifier(picture: StoredPicture | null): string {
  return picture === null ? PICTURE_AUDIT.removed : PICTURE_AUDIT.changed
}

/** The file store's refusal, as the picture's error. */
function refusalError(refusal: FileRefusal): PictureError {
  switch (refusal) {
    case FileRefusal.Type:
      return new PictureError(`FILE_TYPE`, `A picture is a JPEG, PNG, WebP or HEIC image`)
    case FileRefusal.Size:
      return new PictureError(`FILE_TOO_LARGE`, `A picture can be up to ${PICTURE_MAX_BYTES} bytes`)
    case FileRefusal.Missing:
      return new PictureError(`FILE_MISSING`, `Nothing was uploaded`)
    case FileRefusal.Content:
      return new PictureError(`FILE_CONTENT`, `The file is not the image its type says`)
  }
}

/** The ledger's refusal, as the picture's error. */
function ledgerError(refusal: UploadRefusal): PictureError {
  return refusal === `UPLOADS_PENDING`
    ? new PictureError(`UPLOADS_PENDING`, `Finish the uploads already started first`)
    : new PictureError(
      `UPLOAD_BUDGET`,
      `You have uploaded as much as an hour allows. Try again later`,
    )
}

/**
 * Deletes a replaced picture's object and its queued deletion. A store that does not answer leaves
 * the queue row, and the worker tries again.
 */
async function deleteReplaced(
  { pictures, files }: Pick<PictureHandlerDependencies, `pictures` | `files`>,
  previous: string | null,
): Promise<void> {
  if (previous === null) return
  const key = pictureObjectKey(previous)
  try {
    await files.delete(key)
    await pictures.forgetDeletion(key)
  } catch {
    // The queue row stays for the worker.
  }
}

/**
 * `picture.sign`: the person asks to upload a picture of their own. The type and size are checked
 * before anything is signed, and again on the stored bytes at the confirm. The upload is kept in
 * the ledger every feature shares, under the person's lock, so their waiting uploads and hourly
 * budget count note attachments and pictures together.
 */
export function createPictureSignHandler(
  { pictures, files, budget }: PictureHandlerDependencies,
): CommandHandler<PictureSignCommand> {
  return async ({ data }): Promise<SignedPictureUpload> => {
    const upload = await files.signUpload(RULE, { contentType: data.contentType, size: data.size })
    if (!upload.success) throw refusalError(upload.error)
    const id = uuidV7()
    const refusal = await pictures.reserve({
      id,
      noteId: null,
      userId: data.actor.userId,
      stagingKey: upload.output.stagingKey,
      name: PICTURE_AUDIT_IDENTIFIER,
      contentType: data.contentType,
      size: data.size,
    }, budget)
    if (refusal) throw ledgerError(refusal)
    return { id, url: upload.output.url, headers: upload.output.headers }
  }
}

/**
 * `picture.confirm`: the PUT is done. The upload is taken first, so it confirms once however many
 * confirms arrive, and only for the person who signed it. The store moves the bytes to a key no
 * browser can write and checks them; then the picture replaces the person's old one, whose object
 * is deleted. A file refused at any step is deleted.
 */
export function createPictureConfirmHandler(
  dependencies: PictureHandlerDependencies,
): CommandHandler<PictureConfirmCommand> {
  const { pictures, files, emit } = dependencies
  return async ({ data }): Promise<{ user: User }> => {
    const upload = await pictures.claim(data.id, data.actor.userId)
    if (!upload) throw new PictureError(`UPLOAD_NOT_FOUND`, `Upload not found`)
    const key = pictureObjectKey(upload.id)
    const confirmed = await files.confirmUpload(upload.stagingKey, key, {
      contentType: upload.contentType,
      size: upload.size,
    })
    if (!confirmed.success) throw refusalError(confirmed.error)
    const result = await pictures.set(
      data.actor.userId,
      { id: upload.id, contentType: upload.contentType },
      data.request,
    ).catch(async (error) => {
      await files.delete(key).catch(() => {})
      throw error
    })
    if (!result) {
      // The account went away meanwhile: nothing points at the file.
      await files.delete(key).catch(() => {})
      throw new PictureError(`UPLOAD_NOT_FOUND`, `Upload not found`)
    }
    await deleteReplaced(dependencies, result.previous)
    emit(new UserProfileUpdatedEvent({ user: result.user, request: data.request }))
    return { user: result.user }
  }
}

/** `picture.cancel`: the person drops an upload they signed. Only their own, and only while it waits. */
export function createPictureCancelHandler(
  { pictures }: Pick<PictureHandlerDependencies, `pictures`>,
): CommandHandler<PictureCancelCommand> {
  return async ({ data }): Promise<{ id: string }> => {
    await pictures.release(data.id, data.actor.userId)
    return { id: data.id }
  }
}

/**
 * `picture.remove`: the person's initials show again. Their picture's object is deleted now, or by
 * the worker. Removing when there is none answers the person as they are.
 */
export function createPictureRemoveHandler(
  dependencies: PictureHandlerDependencies,
): CommandHandler<PictureRemoveCommand> {
  const { pictures, emit } = dependencies
  return async ({ data }): Promise<{ user: User }> => {
    const result = await pictures.set(data.actor.userId, null, data.request)
    if (!result) throw new PictureError(`PICTURE_NOT_FOUND`, `Picture not found`)
    await deleteReplaced(dependencies, result.previous)
    if (result.previous !== null) {
      emit(new UserProfileUpdatedEvent({ user: result.user, request: data.request }))
    }
    return { user: result.user }
  }
}

/** What the picture operations need from the app: the buses. */
export interface PictureOperationDependencies {
  sign(command: PictureSignCommand): Promise<SignedPictureUpload>
  confirm(command: PictureConfirmCommand): Promise<{ user: User }>
  cancel(command: PictureCancelCommand): Promise<{ id: string }>
  remove(command: PictureRemoveCommand): Promise<{ user: User }>
}

/**
 * The picture operations, listed once for the socket and `POST /api/call/<name>`. The person is
 * always the session's, never named in the payload.
 */
export function createPictureOperations(
  dependencies: PictureOperationDependencies,
): Operations<Actor> {
  return {
    "picture.sign": {
      kind: `command`,
      handle: async ({ actor, payload, idempotencyKey }) => {
        const input = parsePictureRequest(pictureSignPayloadSchema, payload)
        return await dependencies.sign(new PictureSignCommand({ actor, ...input, idempotencyKey }))
      },
    },
    "picture.confirm": {
      kind: `command`,
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parsePictureRequest(pictureUploadPayloadSchema, payload)
        return await dependencies.confirm(
          new PictureConfirmCommand({ actor, ...input, request: { requestId }, idempotencyKey }),
        )
      },
    },
    "picture.cancel": {
      kind: `command`,
      handle: async ({ actor, payload }) => {
        const input = parsePictureRequest(pictureUploadPayloadSchema, payload)
        return await dependencies.cancel(new PictureCancelCommand({ actor, ...input, request: {} }))
      },
    },
    "picture.remove": {
      kind: `command`,
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        expectNoPayload(payload)
        return await dependencies.remove(
          new PictureRemoveCommand({ actor, request: { requestId }, idempotencyKey }),
        )
      },
    },
  }
}
