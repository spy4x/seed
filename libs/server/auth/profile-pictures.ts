import type postgres from "postgres"
import type { User } from "@domain/identity"

/** The person's picture as the store keeps it, or `null` when they have none. */
export interface StoredPicture {
  id: string
  contentType: string
}

/**
 * Sets the live person's picture (#228), or clears it with `null`, and answers the person and the
 * id of the picture it replaced. The `users` trigger queues the replaced picture's object for
 * deletion. `null` when there is no live person. Inside a transaction: the row is locked first,
 * so two changes at once each see the picture the other left.
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
      updated_at = now()
    WHERE id = ${userId}
    RETURNING *
  `
  return { user, previous: before.pictureId }
}

/**
 * The picture `pictureId` and the type it is served as, when `viewerId` may see it: it is their
 * own, or they share a group with its live owner. `null` otherwise, for a picture that is not
 * there too, so the answer tells nothing apart.
 */
export async function readablePicture(
  sql: postgres.Sql,
  pictureId: string,
  viewerId: number,
): Promise<StoredPicture | null> {
  const [row] = await sql<StoredPicture[]>`
    SELECT owner.picture_id AS id, owner.picture_type AS content_type
    FROM users AS owner
    WHERE owner.picture_id = ${pictureId} AND owner.deleted_at IS NULL
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
): Promise<StoredPicture | null> {
  const [row] = await sql<StoredPicture[]>`
    SELECT picture_id AS id, picture_type AS content_type FROM users
    WHERE picture_id = ${pictureId} AND deleted_at IS NULL
  `
  return row ?? null
}
