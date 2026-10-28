import { AuthAuditEventType } from "@domain/identity"
import {
  pictureAuditIdentifier,
  type PictureHandlerDependencies,
} from "../features/profile/picture.ts"
import { config } from "../services/config.ts"
import { db } from "../services/db.ts"
import { eventBus } from "../services/eventBus.ts"
import { files } from "../services/files.ts"

/**
 * What the profile picture handlers run on: the `users` row and the upload ledger, the file store
 * and the hourly budget note attachments spend too. A change of picture and the person's audit
 * row are written in one transaction.
 */
export const pictureDependencies: PictureHandlerDependencies = {
  files,
  budget: config.attachmentUploadBudget,
  emit: (event) => eventBus.emit(event),
  pictures: {
    reserve: (upload, budget) => db.pictures.reserve(upload, budget),
    claim: (id, userId) => db.pictures.claim(id, userId),
    release: (id, userId) => db.pictures.release(id, userId),
    forgetDeletion: (objectKey) => db.attachment.forgetDeletion(objectKey),
    set: (userId, picture, request) =>
      db.begin(async (tx) => {
        const result = await tx.pictures.set(userId, picture)
        if (!result) return null
        await tx.authAudit.insert({
          userId,
          eventType: AuthAuditEventType.PROFILE_UPDATED,
          identifier: pictureAuditIdentifier(picture),
          ip: request.ip || null,
          userAgent: request.userAgent || null,
        })
        return result
      }),
  },
}
