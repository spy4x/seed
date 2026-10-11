import type postgres from "postgres"
import { type } from "arktype"
import { announceJson, listenJson } from "@spy4x/server/db/notify"

/**
 * The Postgres channel a change to a person's inbox is announced on. It is sent from inside the
 * transaction of that change, so Postgres delivers it only once the change has committed and never
 * for one that rolled back. The API listens and tells the person's open sockets.
 */
export const USER_NOTIFICATION_CHANNEL = "user_notification"

/** The inbox of `userId` changed: a notification arrived, or some were read. */
export interface UserNotificationChange {
  userId: number
}

/** Announces a change to `userId`'s inbox. Call it in the transaction of the change. */
export async function announceNotificationChange(
  sql: postgres.Sql,
  userId: number,
): Promise<void> {
  const change: UserNotificationChange = { userId }
  await announceJson(sql, USER_NOTIFICATION_CHANNEL, change)
}

/** What a payload on {@link USER_NOTIFICATION_CHANNEL} must look like; anything else is dropped. */
export const notificationChangeSchema = type({ userId: "number.integer & number.safe >= 1" })

/**
 * Calls `onChange` for every inbox change announced on {@link USER_NOTIFICATION_CHANNEL}. Returns a
 * function that stops listening.
 */
export async function listenForNotificationChanges(
  sql: postgres.Sql,
  onChange: (change: UserNotificationChange) => void,
): Promise<() => Promise<void>> {
  return await listenJson(sql, USER_NOTIFICATION_CHANNEL, {
    schema: notificationChangeSchema,
    onMessage: ({ userId }) => onChange({ userId }),
  })
}
