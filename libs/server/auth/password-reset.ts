/**
 * Password reset by e-mail link: the codes, their lifetime and the link that carries them.
 *
 * The code lives in `auth_challenges` (`@spy4x/server/auth`), which stores only its SHA-256 hash,
 * keeps one live code per address, counts wrong guesses and deletes the code when it matches, so a
 * link works once. The worker issues the code and mails it in the same step, so the raw code is
 * never written anywhere: not in Postgres, not in the job queue, not in a log.
 *
 * A code is 256 random bits. The store compares hashes with SQL `=`; the time that takes tells a
 * guesser nothing about the code, since they would need a preimage of the hash (the store's own
 * note on `attemptChallenge` says the same).
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import { type AuthStore, ChallengeOutcome, normalizeEmail } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"

/** The challenge purpose of a reset code. Not the package's own: its codes are never sent here. */
export const PASSWORD_RESET_PURPOSE = "app.password-reset"

/** How long a reset link works. */
export const PASSWORD_RESET_TTL_MINUTES = 30

/**
 * Wrong codes one address's live link survives: the largest count the auth stores accept (their
 * `attempts` column is a Postgres `integer`), so in practice no limit. A small cap would let anyone
 * who knows an address lock its reset: a new link keeps the old one's count while the old one is
 * unexpired, so each request would push the lock out again. A cap buys nothing against 256 random
 * bits, and the per-IP limit of the reset route already stops a flood of guesses.
 */
export const PASSWORD_RESET_MAX_GUESSES = 2_147_483_647

/** The page a reset link opens, in both apps. */
export const PASSWORD_RESET_PATH = "/reset-password"

/** Random bytes in a code: 256 bits, 43 base64url characters. */
const CODE_BYTES = 32

/** A code to mail to `email`. The raw code exists only in this value: send it, then drop it. */
export interface IssuedPasswordReset {
  /** The normalised address the code belongs to and must be sent to. */
  email: string
  /** The account the code resets, whose saved language the mail is written in. */
  userId: number
  code: string
  expiresAt: Date
}

/**
 * Issues a reset code for the account that signs in with this address, replacing any earlier code
 * for it. `null`, and nothing issued, when no live account signs in with this address: the caller
 * sends nothing then. A username account whose username happens to look like an address gets no
 * code either: that name was never claimed as an address, so its owner may not hold the mailbox.
 *
 * An account waiting to be deleted gets a code (#388): a deletion request soft-deletes the `users`
 * profile, never the sign-in record read here, and the completed reset restores the account.
 */
export async function issuePasswordReset(
  store: AuthStore,
  rawEmail: unknown,
  now = new Date(),
): Promise<IssuedPasswordReset | null> {
  const email = normalizeEmail(rawEmail)
  if (email === null) return null
  const key = await store.findKey(PASSWORD_METHOD, email)
  if (!key || key.email === null) return null
  const user = await store.findUser(key.userId)
  if (!user || user.deletedAt !== null) return null
  const code = randomBase64Url(CODE_BYTES)
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000)
  await store.issueChallenge({
    purpose: PASSWORD_RESET_PURPOSE,
    subject: email,
    secretHash: await sha256Hex(code),
    expiresAt,
    now,
  })
  return { email, userId: key.userId, code, expiresAt }
}

/**
 * Spends a reset code. `true` once, when the code is the live one for this address; the code is
 * deleted then, so the same link never works again. Expired, already used, replaced by a newer
 * link, or wrong: `false`.
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

/** The link a reset mail carries: the app's reset page with the address and the code. */
export function passwordResetLink(webAppUrl: string, reset: IssuedPasswordReset): string {
  const url = new URL(PASSWORD_RESET_PATH, webAppUrl)
  url.searchParams.set("email", reset.email)
  url.searchParams.set("code", reset.code)
  return url.href
}
