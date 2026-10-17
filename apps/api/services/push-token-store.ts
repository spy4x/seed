import type { Sql } from "@spy4x/server/db"
import { createPostgresSessionStore } from "@spy4x/server/auth/postgres"
import { SessionStatus } from "@spy4x/server/sign-in"
import type { PushSubscriptionStore } from "@spy4x/integrations/push"

/** One stored Web Push subscription: a single browser on a single device of one user. */
export interface PushTokenRecord {
  id: number
  userId: number
  deviceId: string
  endpoint: string
  auth: string
  p256dh: string
  createdAt: Date
  updatedAt: Date
}

/** One subscription to store: whose, which device, and what the browser handed over. */
export interface PushTokenInput {
  userId: number
  deviceId: string
  endpoint: string
  auth: string
  p256dh: string
}

/**
 * What `WebPushService` needs from storage. `deleteByEndpoint` is the half of the library's
 * `PushSubscriptionStore` the sender calls for a subscription the push service reports gone.
 */
export interface PushTokenStore extends Pick<PushSubscriptionStore, "deleteByEndpoint"> {
  /** Live subscriptions of one user, newest first. */
  listByUser(userId: number): Promise<PushTokenRecord[]>
  /** Creates the user's subscription for this device, or replaces the one already there. */
  upsert(input: PushTokenInput): Promise<PushTokenRecord>
  /**
   * {@link upsert}, but only while session `sessionId` of the user is live; `null`, and nothing
   * stored, when it has ended. A request that authenticated before a password reset and stores
   * after it is refused here (#409).
   */
  upsertForSession(input: PushTokenInput & { sessionId: number }): Promise<PushTokenRecord | null>
  /** Marks the user's subscription for this device deleted. Other users' rows are never touched. */
  remove(input: { userId: number; deviceId: string }): Promise<void>
}

/** Creates the user's subscription for this device, or replaces the one already there. */
async function upsertWith(
  sql: Sql,
  { userId, deviceId, endpoint, auth, p256dh }: PushTokenInput,
): Promise<PushTokenRecord> {
  const rows = await sql<PushTokenRecord[]>`
    INSERT INTO user_push_tokens (user_id, device_id, endpoint, auth, p256dh)
    VALUES (${userId}, ${deviceId}, ${endpoint}, ${auth}, ${p256dh})
    ON CONFLICT (user_id, device_id) WHERE deleted_at IS NULL
    DO UPDATE SET endpoint = EXCLUDED.endpoint, auth = EXCLUDED.auth,
      p256dh = EXCLUDED.p256dh, updated_at = NOW()
    RETURNING id, user_id, device_id, endpoint, auth, p256dh, created_at, updated_at`
  return rows[0]
}

/**
 * The store over `user_push_tokens`. Needs a client built with `postgres.camel` (as `db.ts` does),
 * so columns come back as `userId`, `deviceId` and so on. Reads and writes go straight to
 * Postgres, never through a cache: a subscription that was removed must not be sent to.
 */
export function createPushTokenStore(sql: Sql): PushTokenStore {
  return {
    async listByUser(userId) {
      return await sql<PushTokenRecord[]>`
        SELECT id, user_id, device_id, endpoint, auth, p256dh, created_at, updated_at
        FROM user_push_tokens
        WHERE deleted_at IS NULL AND user_id = ${userId}
        ORDER BY created_at DESC, id DESC`
    },
    upsert: (input) => upsertWith(sql, input),
    async upsertForSession({ sessionId, ...input }) {
      return await sql.begin(async (tx) => {
        // The lock a password reset takes (`AppDbBase.lockUser`): this write either commits
        // before the reset removes every subscription, or runs after it and finds the session
        // ended. The session is read in a statement of its own, after the lock: one statement's
        // snapshot is taken before it waits, and would still see the session live.
        await tx`SELECT 1 FROM users WHERE id = ${input.userId} FOR UPDATE`
        const session = await createPostgresSessionStore(tx as unknown as Sql).findById(sessionId)
        const live = session !== null && session.userId === input.userId &&
          session.status === SessionStatus.Active && session.expiresAt.getTime() > Date.now()
        return live ? await upsertWith(tx as unknown as Sql, input) : null
      })
    },
    async remove({ userId, deviceId }) {
      await sql`
        UPDATE user_push_tokens
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE deleted_at IS NULL AND user_id = ${userId} AND device_id = ${deviceId}`
    },
    async deleteByEndpoint(userId, endpoint) {
      await sql`
        UPDATE user_push_tokens
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE deleted_at IS NULL AND user_id = ${userId} AND endpoint = ${endpoint}`
    },
  }
}

/**
 * Marks every stored subscription of `userId` deleted, so no browser of the account gets its
 * notifications any more. A password reset calls it inside its transaction (#409): whoever had
 * the account before the owner took it back keeps no browser that the account pushes to. Other
 * users' rows are never touched.
 */
export async function removeAllPushTokensOf(sql: Sql, userId: number): Promise<void> {
  await sql`
    UPDATE user_push_tokens
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE deleted_at IS NULL AND user_id = ${userId}`
}
