/// <reference lib="deno.ns" />
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { createPushTokenStore } from "../../apps/api/services/push-token-store.ts"

/**
 * Switches notifications on in the browser that last signed in as `userId`, as `POST /push` stores
 * them: tied to that browser's session. Answers the device id, and the session it is tied to.
 */
export async function subscribeNewest(
  sql: postgres.Sql,
  userId: number,
): Promise<{ deviceId: string; sessionId: number }> {
  const [session] = await sql<{ id: number }[]>`
    SELECT id FROM auth_sessions WHERE user_id = ${userId} ORDER BY id DESC LIMIT 1`
  if (!session) throw new Error(`user ${userId} has no session`)
  const deviceId = uuidV7()
  const stored = await createPushTokenStore(sql).upsertForSession({
    sessionId: session.id,
    userId,
    deviceId,
    endpoint: `https://push.example/${deviceId}`,
    auth: "auth",
    p256dh: "p256dh",
  })
  if (!stored) throw new Error("the session had ended")
  return { deviceId, sessionId: session.id }
}

/** The devices of `userId` that still get the account's notifications, sorted. */
export async function notified(sql: postgres.Sql, userId: number): Promise<string[]> {
  return (await createPushTokenStore(sql).listByUser(userId)).map((row) => row.deviceId).sort()
}

/** The session each live subscription of `userId` is tied to, by device id. */
export async function sessionsOfRows(
  sql: postgres.Sql,
  userId: number,
): Promise<Record<string, number>> {
  const rows = await sql<{ deviceId: string; sessionId: number }[]>`
    SELECT device_id, session_id FROM user_push_tokens
    WHERE deleted_at IS NULL AND user_id = ${userId}`
  return Object.fromEntries(rows.map((row) => [row.deviceId, row.sessionId]))
}
