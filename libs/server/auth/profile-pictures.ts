import type postgres from "postgres"
import { pictureObjectKey, PictureState, type User } from "@domain/identity"
import { queueImage } from "../files/images.ts"

/** The person's picture as the store keeps it, or `null` when they have none. */
export interface StoredPicture {
  id: string
  contentType: string
}

/** A picture as it is shown: the object to serve and its type. */
export interface ShownPicture extends StoredPicture {
  objectKey: string
}

/**
 * The columns of a shown picture, for `FROM users AS owner`: the narrowest WebP variant once the
 * worker made it (#464). A picture kept before images were processed has no `images` row and is
 * served as it was stored. One whose row has no variant yet, or was refused, is not served, so
 * its original, which may say where it was taken, never is.
 */
const shown = (sql: postgres.Sql) =>
  sql`
  owner.picture_id AS id,
  coalesce(variant.content_type, owner.picture_type) AS content_type,
  coalesce(variant.object_key, 'pictures/' || owner.picture_id) AS object_key
  FROM users AS owner
  LEFT JOIN images ON images.id = owner.picture_id
  LEFT JOIN LATERAL (
    SELECT object_key, content_type FROM image_variants
    WHERE image_id = images.id AND content_type = 'image/webp'
    ORDER BY width LIMIT 1
  ) AS variant ON true
`

/** Whether the joined picture may be served: kept before #464, or processed into a variant. */
const servable = (sql: postgres.Sql) => sql`(images.id IS NULL OR variant.object_key IS NOT NULL)`

/**
 * Sets the live person's picture (#228), or clears it with `null`, and answers the person and the
 * id of the picture it replaced. A new picture is queued for processing (#464) and stays
 * `PictureState.Preparing` until the worker is done. The `users` trigger queues the replaced
 * picture's object and image for deletion. `null` when there is no live person. Inside a transaction: the row is locked first, so two changes at once each see the
 * picture the other left.
 */
export async function setUserPicture(
  sql: postgres.Sql,
  userId: number,
  picture: StoredPicture | null,
): Promise<{ user: User; previous: string | null } | null> {
  const [before] = await sql<{ pictureId: string | null }[]>`
    SELECT picture_id FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE
  `
  if (!before) return null
  const [user] = await sql<User[]>`
    UPDATE users SET
      picture_id = ${picture?.id ?? null},
      picture_type = ${picture?.contentType ?? null},
      picture_state = ${picture ? PictureState.Preparing : null},
      updated_at = now()
    WHERE id = ${userId}
    RETURNING *
  `
  if (picture) await queueImage(sql, picture.id, pictureObjectKey(picture.id))
  return { user, previous: before.pictureId }
}

/**
 * The picture `pictureId`, the object and type it is served as, when `viewerId` may see it: it is their
 * own, or they share a group with its live owner. `null` otherwise, for a picture that is not
 * there too, so the answer tells nothing apart.
 */
export async function readablePicture(
  sql: postgres.Sql,
  pictureId: string,
  viewerId: number,
): Promise<ShownPicture | null> {
  const [row] = await sql<ShownPicture[]>`
    SELECT ${shown(sql)}
    WHERE owner.picture_id = ${pictureId} AND owner.deleted_at IS NULL AND ${servable(sql)}
      AND (
        owner.id = ${viewerId}
        OR EXISTS (
          SELECT 1 FROM group_members AS theirs
          INNER JOIN group_members AS mine
            ON mine.group_id = theirs.group_id AND mine.user_id = ${viewerId}
          INNER JOIN groups ON groups.id = theirs.group_id AND groups.deleted_at IS NULL
          WHERE theirs.user_id = owner.id
        )
      )
  `
  return row ?? null
}

/** The picture `pictureId` of a live person, whoever it is: for the operator area only. */
export async function anyPicture(
  sql: postgres.Sql,
  pictureId: string,
): Promise<ShownPicture | null> {
  const [row] = await sql<ShownPicture[]>`
    SELECT ${shown(sql)}
    WHERE owner.picture_id = ${pictureId} AND owner.deleted_at IS NULL AND ${servable(sql)}
  `
  return row ?? null
}
