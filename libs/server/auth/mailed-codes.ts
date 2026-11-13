/**
 * A code mailed to an address for one request a browser waits on: sign-in and password
 * reset both use it.
 *
 * The code is a challenge of `@spy4x/server/auth`: 48 random bits as 8 base64url characters, as
 * the sign-up code is, stored only as a SHA-256 of the purpose, the request, the address and the
 * code. Each request has one challenge; a new code of the same request replaces the old one and
 * keeps its guess count, so asking again never buys guesses. The challenge subject starts with a
 * hash of the address, so the challenge table never holds the address and every code of one
 * address can be deleted together.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import { type AuthStore, ChallengeOutcome } from "@spy4x/server/auth"
import { DEFAULT_CODE_MAX_ATTEMPTS, EMAIL_CODE_BYTES } from "@spy4x/server/auth/email-code"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { mailedCodeOf } from "@domain/identity"

/** Wrong codes one request survives, over all its codes together. */
export const MAILED_CODE_MAX_GUESSES = DEFAULT_CODE_MAX_ATTEMPTS

/** The request a mailed code belongs to. */
export interface MailedCodeRequest {
  /** A UUID version 7. */
  id: string
  /** The normalised address the code goes to. */
  email: string
}

/** The codes of one challenge `purpose`. */
export interface MailedCodes {
  /**
   * Issues a new code for `request`, working until `expiresAt`, and returns it. The raw code
   * exists only in the value returned: send it, then drop it.
   */
  issue(store: AuthStore, request: MailedCodeRequest, expiresAt: Date, now?: Date): Promise<string>
  /**
   * Checks one guess at the request's code and counts it. `Matched` once, and the code is gone
   * then. Whitespace in `code` is ignored. A value that cannot be a code is `WrongGuess` without a
   * guess counted: the caller refuses it before calling, so this is only a guard.
   */
  attempt(
    store: AuthStore,
    request: MailedCodeRequest,
    code: string,
    now?: Date,
  ): Promise<ChallengeOutcome>
  /** Deletes every code of the address `email`: none of its requests works any more. */
  forget(store: AuthStore, email: string): Promise<void>
}

/** The mailed codes of the challenge purpose `purpose`. */
export function mailedCodes(purpose: string): MailedCodes {
  const prefix = async (email: string) => `${await sha256Hex(email)}:`
  const subject = async (request: MailedCodeRequest) =>
    `${await prefix(request.email)}${request.id}`
  const hash = (request: MailedCodeRequest, code: string) =>
    sha256Hex(`${purpose}\n${request.id}\n${request.email}\n${code}`)
  return {
    async issue(store, request, expiresAt, now = new Date()) {
      const code = randomBase64Url(EMAIL_CODE_BYTES)
      await store.issueChallenge({
        purpose,
        subject: await subject(request),
        secretHash: await hash(request, code),
        expiresAt,
        now,
      })
      return code
    },
    async attempt(store, request, raw, now = new Date()) {
      const code = mailedCodeOf(raw)
      if (code === null) return ChallengeOutcome.WrongGuess
      return await store.attemptChallenge({
        purpose,
        subject: await subject(request),
        secretHash: await hash(request, code),
        maxAttempts: MAILED_CODE_MAX_GUESSES,
        now,
      })
    },
    async forget(store, email) {
      await store.deleteChallenges?.(purpose, await prefix(email))
    },
  }
}
