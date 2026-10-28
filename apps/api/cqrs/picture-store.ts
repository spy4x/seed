import { AuthAuditEventType } from "@domain/identity"
import { PICTURE_AUDIT_IDENTIFIER, type PictureStore } from "../features/profile/picture.ts"
import type { AppDbBase } from "../services/db-base.ts"

/**
 * The profile picture handlers' store over `db`: the `users` row and the upload ledger. A change of
 * picture and the person's audit row are written in one transaction; a removal with no picture to
 * remove writes neither.
 */
export function createPictureStore(db: AppDbBase): PictureStore {
  return {
    reserve: (upload, budget) => db.pictures.reserve(upload, budget),
    claim: (id, userId) => db.pictures.claim(id, userId),
    release: (id, userId) => db.pictures.release(id, userId),
    forgetDeletion: (objectKey) => db.attachment.forgetDeletion(objectKey),
    set: (userId, picture, request) =>
      db.begin(async (tx) => {
        const result = await tx.pictures.set(userId, picture)
        if (!result) return null
        if (!picture && result.previous === null) return result
        await tx.authAudit.insert({
          userId,
          eventType: AuthAuditEventType.PROFILE_UPDATED,
          identifier: PICTURE_AUDIT_IDENTIFIER,
          ip: request.ip || null,
          userAgent: request.userAgent || null,
        })
        return result
      }),
  }
}
