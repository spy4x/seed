/**
 * When a person was last active, on this app's `users` row. Everything about the sessions
 * themselves (the device a session remembers, when it was last used, the list of signed-in devices
 * and ending them) is the session store of `@spy4x/server/auth` behind `SessionManager` of
 * `@spy4x/server/sign-in`.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"

/** How stale `users.last_seen_at` may get before activity writes it again: five minutes. */
export const LAST_SEEN_RESOLUTION_MS = 5 * 60_000

/**
 * Records that the user was active at `now`, unless it was already recorded within
 * {@link LAST_SEEN_RESOLUTION_MS}. The check is in the `UPDATE`'s own condition, so it holds per
 * person across every session, socket and API instance, and most calls match no row and write
 * nothing. `now` is a parameter so a test can move the clock.
 */
export async function touchUserSeen(
  sql: postgres.Sql,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  await sql`
    UPDATE users SET last_seen_at = ${now}
    WHERE id = ${userId}
      AND (last_seen_at IS NULL
        OR last_seen_at <= ${new Date(now.getTime() - LAST_SEEN_RESOLUTION_MS)})
  `
}
