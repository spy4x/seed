/**
 * The persistent count of wrong e-mail codes per user, with a lock that grows per failure:
 * `@spy4x/server/lockout`'s defaults, as for the authenticator app (`totp-failures.ts`), over the
 * `email_code_failures` table.
 *
 * Each code allows 5 guesses itself, and a new code keeps the old one's count while it is live. This
 * counter adds the account's own lock on top, so asking for code after code buys a guesser nothing
 * either: past 5 wrong codes in a row the account waits 15 minutes, doubling up to a day.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { createLockout, type Lockout } from "@spy4x/server/lockout"
import { createPostgresLockoutStore } from "@spy4x/server/lockout/postgres"
import type { Clock } from "@spy4x/platform/universal/time"

/** Builds the counter over `email_code_failures`, one row per user, made on the first check. */
export function createEmailCodeFailures({ sql, clock }: { sql: Sql; clock?: Clock }): Lockout {
  const store = createPostgresLockoutStore({
    sql,
    table: "email_code_failures",
    columns: { subject: "user_id" },
  })
  return createLockout({ store, clock })
}
