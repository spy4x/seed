/**
 * The persistent count of wrong one-time codes per user, with a lock that grows per failure (#73).
 *
 * The flow and the policy are `@spy4x/server/lockout`'s defaults: 5 free failures, then 15 minutes
 * doubling up to one day, and 7 quiet days set the count back to 0. Each check is counted before
 * the code is looked at and refunded when it was right, so parallel guesses cannot slip through.
 * This module only says where the counter lives: the `failed_attempts`, `locked_until` and
 * `last_failure_at` columns of the user's `user_totp` row.
 *
 * The per-user rate limit `otpByUser` in `middlewares/auth-rate-limits.ts` keeps its budget in
 * Valkey and stops a burst within its window. This counter lives in Postgres next to the
 * authenticator, and its lock grows with every failure. Together they cap a guesser at about 570 guesses a year for one user, a
 * chance of about 0.17% of hitting one of the 3 codes that are valid at any moment (arithmetic in
 * the pull request of #73).
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { createLockout, type Lockout } from "@spy4x/server/lockout"
import { createPostgresLockoutStore } from "@spy4x/server/lockout/postgres"
import type { Clock } from "@spy4x/platform/universal/time"

/** Options for {@link createTotpFailures}. */
export interface TotpFailuresOptions {
  sql: Sql
  /** Defaults to the host clock; tests inject their own. */
  clock?: Clock
}

/**
 * Builds the counter over the `user_totp` table. A user with no row has no enrolment and so
 * nothing to guess: every check runs and nothing is written.
 */
export function createTotpFailures({ sql, clock }: TotpFailuresOptions): Lockout {
  const store = createPostgresLockoutStore({
    sql,
    table: "user_totp",
    columns: { subject: "user_id" },
    // The row holds the enrolled secret, so the counter must never insert one.
    createMissing: false,
  })
  return createLockout({ store, clock })
}
