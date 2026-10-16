/**
 * The operator area's reads and writes over a person's push devices (`user_push_tokens`) and
 * notifications (#427). Who may call them is the API's business
 * (`apps/api/routes/admin/api-tokens.ts`); nothing here checks it.
 *
 * Every statement names its columns: a device's `endpoint`, `auth` and `p256dh` (what lets anyone
 * push to it) and a notification's `payload` (what the person was told) are never read.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import type { AdminPushDevice, UserPushTokenPublic } from "@domain/identity"
import type { AdminNotification, AdminNotificationsResponse } from "@domain/notifications"

/** How many characters of a device id name it, as the person's own profile shows it. */
const DEVICE_LABEL_LENGTH = 8

interface DeviceRaw {
  id: number
  userId: number
  deviceId: string
  createdAt: Date
  updatedAt: Date
}

/** The live devices of `userId`, newest first, without anything that can push to them. */
async function liveDevices(sql: postgres.Sql, userId: number): Promise<DeviceRaw[]> {
  return await sql<DeviceRaw[]>`
    SELECT id, user_id, device_id, created_at, updated_at
    FROM user_push_tokens
    WHERE user_id = ${userId} AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC
  `
}

/** The live push devices of the person `userId`, newest first. */
export async function listAdminPushDevices(
  sql: postgres.Sql,
  userId: number,
): Promise<AdminPushDevice[]> {
  return (await liveDevices(sql, userId)).map((row) => ({
    id: row.id,
    label: row.deviceId.slice(-DEVICE_LABEL_LENGTH),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/**
 * Marks the live device `deviceRowId` of the person `userId` deleted, as the person's own remove
 * does, and answers the devices left in the shape the push events carry. `null` when the person has
 * no such live device: another person's device gets the same answer.
 */
export async function removeAdminPushDevice(
  sql: postgres.Sql,
  userId: number,
  deviceRowId: number,
): Promise<UserPushTokenPublic[] | null> {
  const removed = await sql`
    UPDATE user_push_tokens
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${deviceRowId} AND user_id = ${userId} AND deleted_at IS NULL
    RETURNING id
  `
  if (removed.length === 0) return null
  return await liveDevices(sql, userId)
}

/**
 * The newest `limit` notifications of the person `userId`: kind and read state only, with how many
 * they hold in all and how many of those are unread.
 */
export async function listAdminNotifications(
  sql: postgres.Sql,
  userId: number,
  limit: number,
): Promise<AdminNotificationsResponse> {
  const rows = await sql<{ id: string; kind: string; createdAt: Date; readAt: Date | null }[]>`
    SELECT id::text AS id, kind, created_at, read_at
    FROM notifications
    WHERE user_id = ${userId}
    ORDER BY id DESC
    LIMIT ${limit}
  `
  const [{ total, unread }] = await sql<{ total: number; unread: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE read_at IS NULL)::int AS unread
    FROM notifications
    WHERE user_id = ${userId}
  `
  const notifications: AdminNotification[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  }))
  return { notifications, total, unread }
}
