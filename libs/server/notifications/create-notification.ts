import type postgres from "postgres"
import { safeRedirectPath } from "@spy4x/net/redirect-path"
import { NotificationError, type NotificationPayload } from "@domain/notifications"
import { announceNotificationChange } from "./notification-hint.ts"

/** What a notification is made of. */
export interface NotificationInput {
  userId: number
  kind: string
  payload: NotificationPayload
  /** An in-app path: one leading `/`, no scheme, no second slash, no backslash. */
  link: string
}

/**
 * Writes one notification and announces the new unread count's change, in the caller's
 * transaction: the row exists exactly when the change it tells about does, and the announcement,
 * which Postgres delivers at commit, is never sent for a change that rolled back.
 *
 * A link that leaves the app is a programming error here, not a request error: it throws before it
 * writes, so no row ever sends a person off the site.
 */
export async function createNotification(
  sql: postgres.Sql,
  input: NotificationInput,
): Promise<void> {
  // Stored as the checked path: spaces are encoded and `..` segments are resolved.
  const link = safeRedirectPath(input.link, { fallback: `` })
  if (link === ``) {
    throw new NotificationError("INVALID_REQUEST", "A notification links to a page of the app")
  }
  await sql`
    INSERT INTO notifications (user_id, kind, payload, link)
    VALUES (${input.userId}, ${input.kind}, ${sql.json(input.payload)}, ${link})
  `
  await announceNotificationChange(sql, input.userId)
}
