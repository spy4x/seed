/**
 * The persistent count of wrong passwords per sign-in name, with a short lock (#387).
 *
 * The rate limit on sign-in counts per network address (`middlewares/auth-rate-limits.ts`), so a
 * guesser who spreads the guesses over many addresses is not slowed for one account. This counter
 * is keyed by the name that was typed, whatever address the guess comes from. It is
 * `@spy4x/server/lockout` over the `password_failures` table, with a policy of its own
 * ({@link PASSWORD_LOCK_POLICY}): the library's default locks for up to a day, and here a stranger
 * who knows an address can set the lock off, so it stays a matter of minutes.
 *
 * The key is the name, not the account, and a name no account uses is counted and locked like any
 * other: a lock tells nothing about whether an account exists. The table stores the SHA-256 of
 * the normalised name ({@link passwordFailureSubject}), never what a person typed into the field.
 *
 * A right password gives back the one check it took and ends a running lock; it does not set the
 * count back to 0, which the library does on purpose. The count starts again after
 * {@link PASSWORD_LOCK_POLICY}`.quietResetMs` without a wrong password.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { normalizeEmail } from "@spy4x/server/auth"
import { createLockout, type Lockout } from "@spy4x/server/lockout"
import { createPostgresLockoutStore } from "@spy4x/server/lockout/postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import type { Clock } from "@spy4x/platform/universal/time"
import { normalizeUsername } from "./sign-in.ts"
import { PASSWORD_LOCK_POLICY } from "./password-locked.ts"

// Defined beside the signed-in account's count (#406), which shares it.
export { PASSWORD_LOCK_POLICY }

/** Options for {@link createPasswordFailures}. */
export interface PasswordFailuresOptions {
  sql: Sql
  /** Defaults to the host clock; tests inject their own. */
  clock?: Clock
}

/** Builds the counter over `password_failures`, one row per name, made on the first check. */
export function createPasswordFailures({ sql, clock }: PasswordFailuresOptions): Lockout {
  const store = createPostgresLockoutStore({ sql, table: "password_failures" })
  return createLockout({ store, clock, ...PASSWORD_LOCK_POLICY })
}

/**
 * The counter's key for what was typed as the sign-in name: the SHA-256 of the address or username
 * as the sign-in itself normalises it, so "Ada@Example.com " and "ada@example.com" share a count.
 * Text that is neither is hashed as typed; no account signs in with it.
 */
export async function passwordFailureSubject(login: string): Promise<string> {
  return await sha256Hex(normalizeEmail(login) ?? normalizeUsername(login) ?? login)
}

/**
 * Deletes the rows that decide nothing any more: no lock runs, and the last wrong password is
 * older than the quiet reset, or none was ever counted. Every name a stranger types adds a row, so
 * the API runs this on a schedule. Returns how many rows went.
 */
export async function prunePasswordFailures(sql: Sql, now: Date = new Date()): Promise<number> {
  const quietSince = new Date(now.getTime() - PASSWORD_LOCK_POLICY.quietResetMs)
  const deleted = await sql`
    DELETE FROM password_failures
    WHERE (last_failure_at IS NULL OR last_failure_at < ${quietSince})
      AND (locked_until IS NULL OR locked_until < ${now})
  `
  return deleted.count
}
