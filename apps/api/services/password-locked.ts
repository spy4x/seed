/**
 * Wrong passwords typed by a signed-in account (#406), and the refusal every locked password check
 * gives. The sign-in page's own count per name is in `password-failures.ts`; both share
 * {@link PASSWORD_LOCK_POLICY}.
 *
 * Every step a signed-in person confirms with the password (turning two-factor on or off, a new
 * password or address, deleting the account, linking a provider, an API token, handing a group
 * over) checks it through `SignIn.checkPassword` or its siblings, and they all count in
 * `password_check_failures`, keyed by the user id. Without it a session left open could guess at
 * those steps as fast as the per-user rate limit lets it, about 43,200 times a day, where the
 * sign-in page allows about 100 per name. The policy is the sign-in page's, so a session gets no
 * more guesses than the page gives. Only a signed-in caller reaches the count, so a stranger cannot
 * use it to lock anybody out.
 *
 * Imports nothing of the app, so the database service and the sign-in can both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { createLockout, type Lockout, type LockoutPolicy } from "@spy4x/server/lockout"
import { createPostgresLockoutStore } from "@spy4x/server/lockout/postgres"
import type { Clock } from "@spy4x/platform/universal/time"

const MINUTE_MS = 60_000

/**
 * 5 wrong passwords cost no wait. The 6th locks for 1 minute, and each one after doubles the lock
 * up to 15 minutes. An hour without a wrong password sets the count back to 0. The quiet hour is
 * longer than the longest lock, so waiting a lock out does not buy a fresh count.
 */
export const PASSWORD_LOCK_POLICY: Readonly<LockoutPolicy> = Object.freeze({
  freeFailures: 5,
  firstLockMs: MINUTE_MS,
  maxLockMs: 15 * MINUTE_MS,
  quietResetMs: 60 * MINUTE_MS,
})

/**
 * Builds the signed-in account's count over `password_check_failures`, one row per user, made on
 * the first check. `sql` is a pool: each update runs in a transaction of its own.
 */
export function createPasswordCheckFailures(
  { sql, clock }: { sql: Sql; clock?: Clock },
): Lockout {
  const store = createPostgresLockoutStore({
    sql,
    table: "password_check_failures",
    columns: { subject: "user_id" },
  })
  return createLockout({ store, clock, ...PASSWORD_LOCK_POLICY })
}

/**
 * Thrown by a password check of a signed-in account while its lock runs: the password was not
 * looked at, right or wrong. The routes answer 429 with `Retry-After` from {@link retryAfterMs}.
 */
export class PasswordLockedError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`the account's password checks are locked for ${retryAfterMs} ms`)
    this.name = "PasswordLockedError"
  }
}

/**
 * The answer while a password is locked after too many wrong ones, saying when to try again. On
 * the sign-in page it is the same for a name no account uses, so it tells nothing about an account.
 */
export function passwordLockedMessage(waitMs: number): string {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000))
  return `Too many wrong passwords. Try again in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`
}
