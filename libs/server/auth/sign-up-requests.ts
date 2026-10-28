/**
 * Sign-up that proves the address first (#142): the sign-up waiting for its code, the code itself,
 * and the one question asked only after the right code, whether an account already uses the
 * address.
 *
 * A sign-up with an address and a password writes one row to `sign_up_requests`, with the password
 * already hashed, and the worker mails a code to the address. The same row and the same mail for
 * every address, known or not: nothing here asks whether an account uses the address until the
 * code is entered, so neither the answer nor the work behind it tells a stranger anything. The
 * right code then either creates the account, its address proven, or tells the person who holds
 * the mailbox that an account already uses it, and creates nothing.
 *
 * The code is a challenge of `@spy4x/server/auth` with this module's own purpose, bound to the
 * waiting sign-up and its address: 48 random bits as 8 base64url characters, as the package's
 * e-mail codes are, stored only as a SHA-256 of the purpose, the sign-up, the address and the
 * code, {@link SIGN_UP_MAX_GUESSES} guesses, {@link SIGN_UP_TTL_MINUTES} minutes, deleted when it
 * matches. A new code keeps the guess count of the one it replaces, so asking again never buys
 * guesses. The package's `createEmailProof` cannot hold it: its codes belong to a user, and a
 * sign-up has none until its code is entered.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { type AuthStore, ChallengeOutcome } from "@spy4x/server/auth"
import { DEFAULT_CODE_MAX_ATTEMPTS, EMAIL_CODE_BYTES } from "@spy4x/server/auth/email-code"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import {
  isLanguage,
  type OAuthProviderId,
  oauthProviderId,
  SIGN_UP_CODE_MINUTES,
} from "@domain/identity"

/** The challenge purpose of a sign-up code. Not the package's own: its codes belong to a user. */
export const SIGN_UP_PURPOSE = "app.sign-up"

/** How long a waiting sign-up and its code work, in minutes. A new code starts it again. */
export const SIGN_UP_TTL_MINUTES = SIGN_UP_CODE_MINUTES

/** Guesses one waiting sign-up allows, over all its codes together. */
export const SIGN_UP_MAX_GUESSES = DEFAULT_CODE_MAX_ATTEMPTS

/** One sign-up waiting for its code. */
export interface SignUpRequest {
  /** A UUID version 7. */
  id: string
  /** The normalised address the code goes to. */
  email: string
  /** The password hash; the raw password is never stored. */
  secret: string
  expiresAt: Date
  /**
   * The guest keeping their account with this address (#224): the right code adds the password to
   * that guest instead of making a new account. `null` or left out for a plain sign-up.
   */
  guestUserId?: number | null
  /**
   * The language of the page that asked (#277), which the code mail is written in. Only a language
   * the apps offer; `null` or left out for English.
   */
  language?: string | null
}

/** When a sign-up asked for at `now`, or given a new code at `now`, stops working. */
export function signUpExpiry(now: Date): Date {
  return new Date(now.getTime() + SIGN_UP_TTL_MINUTES * 60_000)
}

/** The `sign_up_requests` table over `sql`, a pool or a transaction. */
export function signUpRequests(sql: Sql) {
  return {
    /** Writes a new waiting sign-up. */
    create: async (request: SignUpRequest): Promise<void> => {
      await sql`
        INSERT INTO sign_up_requests (id, email, secret, expires_at, guest_user_id, language)
        VALUES (
          ${request.id}, ${request.email}, ${request.secret}, ${request.expiresAt},
          ${request.guestUserId ?? null}, ${isLanguage(request.language) ? request.language : null}
        )
      `
    },
    /** The waiting sign-up with this id while it works, or `null`. Any other id is `null`. */
    find: async (id: string, now = new Date()): Promise<SignUpRequest | null> => {
      if (!UUID_PATTERN.test(id)) return null
      const [row] = await sql<SignUpRequest[]>`
        SELECT id, email, secret, expires_at AS "expiresAt", guest_user_id AS "guestUserId",
          language
        FROM sign_up_requests
        WHERE id = ${id} AND expires_at > ${now}
      `
      return row ?? null
    },
    /** Moves the end of a waiting sign-up that still works to `expiresAt`. `false` when none. */
    extend: async (id: string, expiresAt: Date, now = new Date()): Promise<boolean> => {
      if (!UUID_PATTERN.test(id)) return false
      const updated = await sql`
        UPDATE sign_up_requests SET expires_at = ${expiresAt}
        WHERE id = ${id} AND expires_at > ${now}
      `
      return updated.count > 0
    },
    /** Deletes the waiting sign-up, its password hash and its unsent code mails. */
    remove: async (id: string): Promise<void> => {
      if (!UUID_PATTERN.test(id)) return
      await sql`DELETE FROM sign_up_requests WHERE id = ${id}`
    },
  }
}

/** The stored form of a sign-up code: SHA-256 of the purpose, the sign-up, the address and code. */
function hashCode(request: Pick<SignUpRequest, "id" | "email">, code: string): Promise<string> {
  return sha256Hex(`${SIGN_UP_PURPOSE}\n${request.id}\n${request.email}\n${code}`)
}

/**
 * Issues a new code for the waiting sign-up, replacing any earlier one, and returns it. The raw
 * code exists only in the value returned: send it, then drop it.
 */
export async function issueSignUpCode(
  store: AuthStore,
  request: Pick<SignUpRequest, "id" | "email">,
  now = new Date(),
): Promise<string> {
  const code = randomBase64Url(EMAIL_CODE_BYTES)
  await store.issueChallenge({
    purpose: SIGN_UP_PURPOSE,
    subject: request.id,
    secretHash: await hashCode(request, code),
    expiresAt: signUpExpiry(now),
    now,
  })
  return code
}

/**
 * Checks one guess at the waiting sign-up's code and counts it. `Matched` once, and the code is
 * gone then. Surrounding whitespace in `code` is ignored, as a pasted code often carries some.
 */
export async function attemptSignUpCode(
  store: AuthStore,
  request: Pick<SignUpRequest, "id" | "email">,
  code: string,
  now = new Date(),
): Promise<ChallengeOutcome> {
  return await store.attemptChallenge({
    purpose: SIGN_UP_PURPOSE,
    subject: request.id,
    secretHash: await hashCode(request, code.trim()),
    maxAttempts: SIGN_UP_MAX_GUESSES,
    now,
  })
}

/** How an account that already uses an address signs in. */
export interface ExistingAccount {
  userId: number
  /** It has a password. */
  password: boolean
  /** The providers it signs in with, in the order they were linked. */
  providers: OAuthProviderId[]
}

/**
 * The account that already uses `email`, already normalised, or `null`: one whose password key
 * signs in with the address, proven or not, or one that owns the address because a code, a reset
 * link or a provider proved it. Ask this only after the right code: before it, the answer would
 * tell a stranger which addresses have accounts.
 */
export async function accountUsing(
  store: AuthStore,
  email: string,
): Promise<ExistingAccount | null> {
  const key = await store.findKey(PASSWORD_METHOD, email)
  const userId = key?.userId ?? await store.findUserIdByProvenEmail(email)
  if (userId === null) return null
  const keys = await store.listKeys(userId)
  const providers: OAuthProviderId[] = []
  for (const candidate of keys) {
    const provider = oauthProviderId(candidate.method)
    if (provider !== null && !providers.includes(provider)) providers.push(provider)
  }
  return {
    userId,
    password: keys.some((candidate) => candidate.method === PASSWORD_METHOD),
    providers,
  }
}
