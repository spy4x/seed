import type postgres from "postgres"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"

/**
 * The public demo (docs/demo.md): one shared account whose password is printed on the product's
 * sign-in page, a database full of fake data, and a nightly wipe. Off unless `DEMO_MODE` is `true`, so a
 * product started from the template never runs it by accident.
 */

/** The shared product account. Addresses are on a domain reserved for examples (RFC 2606). */
export const DEMO_USER_EMAIL = `demo@example.com`
/**
 * An administrator for the admin app, seeded in development only (`deno task db:seed`). The
 * public demo has none: the admin panel is not part of it.
 */
export const DEV_ADMIN_EMAIL = `admin@example.com`

/** Whether the public demo is on: `DEMO_MODE=true`, and nothing else. */
export function isDemoMode(env: Record<string, string | undefined>): boolean {
  return env.DEMO_MODE === `true`
}

/**
 * The ids among `userIds` of the shared demo account, looked up by its password key. Ids are
 * never cached: the nightly wipe creates the accounts again with new ids.
 */
export async function demoAccountIds(
  sql: postgres.Sql,
  userIds: readonly number[],
): Promise<Set<number>> {
  if (userIds.length === 0) return new Set()
  const rows = await sql<{ userId: number }[]>`
    SELECT user_id AS "userId" FROM auth_keys
    WHERE method = ${PASSWORD_METHOD} AND subject = ${DEMO_USER_EMAIL}
      AND user_id IN ${sql(userIds)}
  `
  return new Set(rows.map((row) => row.userId))
}
