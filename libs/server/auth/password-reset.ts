/**
 * Password reset by an e-mailed code: the request a browser waits on, its code, and the
 * token the right code buys.
 *
 * A request is one row of `password_reset_requests`, named by a signed cookie of the browser that
 * asked, so only that browser can enter the code. The worker issues a {@link PASSWORD_RESET_CODES}
 * code for every request, known address or not, so a wrong guess answers the same for every
 * address, and mails it only when an account signs in with a password and that address. The right
 * code then buys a reset token (`issuePasswordReset`), which the page holds in memory and sends with
 * the new password; it never appears in an address.
 *
 * The token lives in `auth_challenges` (`@spy4x/server/auth`), which stores only its SHA-256 hash,
 * keeps one live token per address and deletes it when it matches, so a token works once. It is
 * 256 random bits; the store compares hashes with SQL `=`, and the time that takes tells a guesser
 * nothing, since they would need a preimage of the hash.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import { type AuthStore, ChallengeOutcome, normalizeEmail } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import type { Sql } from "@spy4x/server/db"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { PASSWORD_RESET_CODE_MINUTES } from "@domain/identity"
import { mailedCodes } from "./mailed-codes.ts"

export const PASSWORD_RESET_CODES = mailedCodes("app.password-reset-code")

/** When a reset request asked for at `now`, or given a new code at `now`, stops working. */
export function passwordResetExpiry(now: Date): Date {
  return new Date(now.getTime() + PASSWORD_RESET_CODE_MINUTES * 60_000)
}

/** One reset someone asked for. */
export interface PasswordResetRequest {
  /** A UUID version 7. */
  id: string
  /** The normalised address the code goes to. */
  email: string
  expiresAt: Date
  /**
   * An operator asked for it in the admin panel. No browser waits for it, so its mail
   * carries no code and tells the person to ask for one.
   */
  byOperator: boolean
}

/** The `password_reset_requests` table over `sql`, a pool or a transaction. */
export function passwordResetRequests(sql: Sql) {
  return {
    /** Writes a new request. */
    create: async (request: PasswordResetRequest): Promise<void> => {
      await sql`
        INSERT INTO password_reset_requests (id, email, expires_at, by_operator)
        VALUES (${request.id}, ${request.email}, ${request.expiresAt}, ${request.byOperator})
      `
    },
    /** The request with this id while it works, or `null`. Any other id is `null`. */
    find: async (id: string, now = new Date()): Promise<PasswordResetRequest | null> => {
      if (!UUID_PATTERN.test(id)) return null
      const [row] = await sql<PasswordResetRequest[]>`
        SELECT id, email, expires_at AS "expiresAt", by_operator AS "byOperator"
        FROM password_reset_requests WHERE id = ${id} AND expires_at > ${now}
      `
      return row ?? null
    },
    /** Moves the end of a request that still works to `expiresAt`. `false` when none. */
    extend: async (id: string, expiresAt: Date, now = new Date()): Promise<boolean> => {
      if (!UUID_PATTERN.test(id)) return false
      const updated = await sql`
        UPDATE password_reset_requests SET expires_at = ${expiresAt}
        WHERE id = ${id} AND expires_at > ${now} AND NOT by_operator
      `
      return updated.count > 0
    },
    /** Deletes the request with this id. */
    remove: async (id: string): Promise<void> => {
      if (!UUID_PATTERN.test(id)) return
      await sql`DELETE FROM password_reset_requests WHERE id = ${id}`
    },
    /** Deletes every request of the address `email`. */
    removeFor: async (email: string): Promise<void> => {
      await sql`DELETE FROM password_reset_requests WHERE email = ${email}`
    },
  }
}

/** The challenge purpose of a reset token. Not the package's own: its codes are never sent here. */
export const PASSWORD_RESET_PURPOSE = "app.password-reset"

/** How long a reset request, its code and the token the code buys work, in minutes. */
export const PASSWORD_RESET_TTL_MINUTES = PASSWORD_RESET_CODE_MINUTES

/**
 * Wrong tokens one address's live token survives: the largest count the auth stores accept (their
 * `attempts` column is a Postgres `integer`), so in practice no limit. A small cap would let anyone
 * who knows an address lock its reset: a new token keeps the old one's count while the old one is
 * unexpired. A cap buys nothing against 256 random bits, and the per-IP limit of the reset route
 * already stops a flood of guesses.
 */
export const PASSWORD_RESET_MAX_GUESSES = 2_147_483_647

/** The page where someone asks for a reset code, in the app. An operator's reset mail links it. */
export const PASSWORD_FORGOT_PATH = "/forgot-password"

/**
 * The account a reset reaches through `email`, already normalised: a live one whose password key
 * signs in with that address, or `null`. A username account whose username happens to look like an
 * address is none: that name was never claimed as an address, so its owner may not hold the
 * mailbox. An account waiting to be deleted is one: its reset restores it.
 */
export async function resettableAccount(store: AuthStore, email: string): Promise<number | null> {
  const key = await store.findKey(PASSWORD_METHOD, email)
  if (!key || key.email === null) return null
  const user = await store.findUser(key.userId)
  return user && user.deletedAt === null ? key.userId : null
}

/** Random bytes in a token: 256 bits, 43 base64url characters. */
const TOKEN_BYTES = 32

/**
 * A reset token for `email`. The raw token (`code`) exists only in this value: hand it to the
 * browser that proved the mailbox, then drop it.
 */
export interface IssuedPasswordReset {
  /** The normalised address the code belongs to and must be sent to. */
  email: string
  /** The account the code resets, whose saved language the mail is written in. */
  userId: number
  code: string
  expiresAt: Date
}

/**
 * Issues a reset token for the account that signs in with this address, replacing any earlier one
 * for it. `null`, and nothing issued, when no live account signs in with this address: the caller
 * refuses then. A username account whose username happens to look like an address gets no
 * code either: that name was never claimed as an address, so its owner may not hold the mailbox.
 *
 * An account waiting to be deleted gets a code: a deletion request soft-deletes the `users`
 * profile, never the sign-in record read here, and the completed reset restores the account.
 */
export async function issuePasswordReset(
  store: AuthStore,
  rawEmail: unknown,
  now = new Date(),
): Promise<IssuedPasswordReset | null> {
  const email = normalizeEmail(rawEmail)
  if (email === null) return null
  const userId = await resettableAccount(store, email)
  if (userId === null) return null
  const code = randomBase64Url(TOKEN_BYTES)
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000)
  await store.issueChallenge({
    purpose: PASSWORD_RESET_PURPOSE,
    subject: email,
    secretHash: await sha256Hex(code),
    expiresAt,
    now,
  })
  return { email, userId, code, expiresAt }
}

/**
 * Spends a reset token. `true` once, when the token is the live one for this address; it is
 * deleted then, so the same token never works again. Expired, already used, replaced by a newer
 * one, or wrong: `false`.
 */
export async function consumePasswordReset(
  store: AuthStore,
  email: string,
  code: unknown,
  now = new Date(),
): Promise<boolean> {
  if (typeof code !== "string" || code.length === 0) return false
  const outcome = await store.attemptChallenge({
    purpose: PASSWORD_RESET_PURPOSE,
    subject: email,
    secretHash: await sha256Hex(code),
    maxAttempts: PASSWORD_RESET_MAX_GUESSES,
    now,
  })
  return outcome === ChallengeOutcome.Matched
}
