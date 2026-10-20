import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"

/**
 * The public demo (docs/demo.md): two shared accounts whose password is printed on the sign-in
 * pages, a database full of fake data, and a nightly wipe. Off unless `DEMO_MODE` is `true`, so a
 * product started from the template never runs it by accident.
 */

/** The shared product account. Addresses are on a domain reserved for examples (RFC 2606). */
export const DEMO_USER_EMAIL = `demo@example.com`
/** The shared operator account, an administrator, which signs in to the admin app. */
export const DEMO_ADMIN_EMAIL = `admin@example.com`
/** Both shared accounts. */
export const DEMO_EMAILS: readonly string[] = [DEMO_USER_EMAIL, DEMO_ADMIN_EMAIL]

/** Whether the public demo is on: `DEMO_MODE=true`, and nothing else. */
export function isDemoMode(env: Record<string, string | undefined>): boolean {
  return env.DEMO_MODE === `true`
}

/**
 * The ids of the shared demo accounts among `userIds`, looked up by their password key. Ids are
 * never cached: the nightly wipe creates the accounts again with new ids.
 */
export async function demoAccountIds(
  sql: postgres.Sql,
  userIds: readonly number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set()
  const rows = await sql<{ userId: number }[]>`
    SELECT user_id AS "userId" FROM auth_keys
    WHERE method = ${PASSWORD_METHOD} AND subject IN ${sql(DEMO_EMAILS)}
      AND user_id IN ${sql(userIds)}
  `
  return new Set(rows.map((row) => row.userId))
}

/**
 * The ids among `userIds` of real people: anyone with a sign-in key whose address is outside
 * example.com, the domain of the demo's own made-up people, proven or not. The demo operator may
 * not act on them.
 */
export async function realPersonIds(
  sql: postgres.Sql,
  userIds: readonly number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set()
  const rows = await sql<{ userId: number }[]>`
    SELECT DISTINCT user_id AS "userId" FROM auth_keys
    WHERE user_id IN ${sql(userIds)} AND email IS NOT NULL
      AND email NOT LIKE '%@example.com'
  `
  return new Set(rows.map((row) => row.userId))
}
