import type postgres from "postgres"

/**
 * Deletes the codes whose time is up: sign-up, e-mail and reset codes nobody entered (#494). An
 * expired code is refused anyway, and issuing a new one replaces its row, so nothing reads them;
 * without this, every abandoned sign-up leaves its row for good. Returns how many.
 */
export async function removeExpiredAuthChallenges(sql: postgres.Sql): Promise<number> {
  const removed = await sql`DELETE FROM auth_challenges WHERE expires_at <= now()`
  return removed.count
}
