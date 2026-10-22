/**
 * Sign-in and sign-up by e-mail link (#391): the request a link answers, the link's secret, and
 * the one step that spends it.
 *
 * A request is one row of `sign_in_link_requests`: the address and the page to open after sign-in.
 * The API writes it for every well-formed address, known or not, and queues the mail job; the
 * worker makes the secret and mails it in the same step, so the raw secret exists only in the
 * mail. The secret is a challenge of `@spy4x/server/auth`: 256 random bits as base64url, stored only
 * as a SHA-256, {@link SIGN_IN_LINK_TTL_MINUTES} minutes, deleted when it matches, so a link works
 * once. Each request has a challenge of its own, so a second link leaves the first one working;
 * spending any link of an address deletes every other link of that address with it.
 *
 * The link carries the request's id next to the secret (`<id>.<secret>`): the id finds the request
 * and its address, which the link itself never names. The id is no secret; without the secret it
 * opens nothing.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { type AuthStore, ChallengeOutcome } from "@spy4x/server/auth"
import { DEFAULT_CODE_MAX_ATTEMPTS } from "@spy4x/server/auth/email-code"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { SIGN_IN_LINK_MINUTES } from "@domain/identity"

/** The challenge purpose of a link's secret. */
export const SIGN_IN_LINK_PURPOSE = "app.sign-in-link"

/** How long a link works, in minutes. */
export const SIGN_IN_LINK_TTL_MINUTES = SIGN_IN_LINK_MINUTES

/**
 * Wrong secrets one link survives. A guess needs the request's id, which only the mail carries, so
 * a stranger cannot spend them; the cap only stops a holder of the id from trying for ever.
 */
export const SIGN_IN_LINK_MAX_GUESSES = DEFAULT_CODE_MAX_ATTEMPTS

/** The page a link opens in the app. The token rides in the fragment, never in the query. */
export const SIGN_IN_LINK_PATH = "/sign-in/link/open"

/** A request whose link nobody used is removed after this long. */
export const SIGN_IN_LINK_REQUEST_RETENTION_HOURS = 24

/** Random bytes in a secret: 256 bits, 43 base64url characters. */
const SECRET_BYTES = 32

/** One link someone asked for. */
export interface SignInLinkRequest {
  /** A UUID version 7. */
  id: string
  /** The normalised address the link goes to. */
  email: string
  /** The page to open after sign-in, already checked, or `null`. */
  next: string | null
  /**
   * The guest account that asked for the link, or `null`. Only that guest keeps its account through
   * the link; another guest who opens it is refused, and a browser with no guest gets the address's
   * own account.
   */
  requestedBy: number | null
}

/** The `sign_in_link_requests` table over `sql`, a pool or a transaction. */
export function signInLinkRequests(sql: Sql) {
  return {
    /** Writes a new request. */
    create: async (request: SignInLinkRequest): Promise<void> => {
      await sql`
        INSERT INTO sign_in_link_requests (id, email, next, requested_by_user_id)
        VALUES (${request.id}, ${request.email}, ${request.next}, ${request.requestedBy})
      `
    },
    /** The request with this id, or `null`. Any other id is `null`. */
    find: async (id: string): Promise<SignInLinkRequest | null> => {
      if (!UUID_PATTERN.test(id)) return null
      const [row] = await sql<SignInLinkRequest[]>`
        SELECT id, email, next, requested_by_user_id AS "requestedBy"
        FROM sign_in_link_requests WHERE id = ${id}
      `
      return row ?? null
    },
    /** Deletes every request of the address `email`: its links stop working with it. */
    removeFor: async (email: string): Promise<void> => {
      await sql`DELETE FROM sign_in_link_requests WHERE email = ${email}`
    },
  }
}

/**
 * The challenge subject of one request: a hash of the address, so the challenge table never holds
 * it, then the request's id. Every link of one address shares the prefix before the colon.
 */
async function subjectPrefix(email: string): Promise<string> {
  return `${await sha256Hex(email)}:`
}

/** The stored form of a secret: SHA-256 of the purpose, the request and the secret. */
function hashSecret(request: Pick<SignInLinkRequest, "id" | "email">, secret: string) {
  return sha256Hex(`${SIGN_IN_LINK_PURPOSE}\n${request.id}\n${request.email}\n${secret}`)
}

/** A link to mail: the raw token exists only in this value. Send it, then drop it. */
export interface IssuedSignInLink {
  /** `<request id>.<secret>`, what the link's fragment carries. */
  token: string
  expiresAt: Date
}

/** Issues the secret of `request` and returns the token its link carries. */
export async function issueSignInLink(
  store: AuthStore,
  request: Pick<SignInLinkRequest, "id" | "email">,
  now = new Date(),
): Promise<IssuedSignInLink> {
  const secret = randomBase64Url(SECRET_BYTES)
  const expiresAt = new Date(now.getTime() + SIGN_IN_LINK_TTL_MINUTES * 60_000)
  await store.issueChallenge({
    purpose: SIGN_IN_LINK_PURPOSE,
    subject: `${await subjectPrefix(request.email)}${request.id}`,
    secretHash: await hashSecret(request, secret),
    expiresAt,
    now,
  })
  return { token: `${request.id}.${secret}`, expiresAt }
}

/**
 * Spends a link's token. The request once, when the token is a live link's; that link and every
 * other link of its address stop working then. Expired, used, malformed or wrong: `null`, one
 * answer for all.
 */
export async function consumeSignInLink(
  store: AuthStore,
  requests: Pick<ReturnType<typeof signInLinkRequests>, "find" | "removeFor">,
  token: unknown,
  now = new Date(),
): Promise<SignInLinkRequest | null> {
  if (typeof token !== "string") return null
  const dot = token.indexOf(".")
  if (dot < 0) return null
  const secret = token.slice(dot + 1)
  if (secret.length === 0) return null
  const request = await requests.find(token.slice(0, dot))
  if (request === null) return null
  const prefix = await subjectPrefix(request.email)
  const outcome = await store.attemptChallenge({
    purpose: SIGN_IN_LINK_PURPOSE,
    subject: `${prefix}${request.id}`,
    secretHash: await hashSecret(request, secret),
    maxAttempts: SIGN_IN_LINK_MAX_GUESSES,
    now,
  })
  if (outcome !== ChallengeOutcome.Matched) return null
  await store.deleteChallenges?.(SIGN_IN_LINK_PURPOSE, prefix)
  await requests.removeFor(request.email)
  return request
}

/** The link a mail carries: the app's link page with the token in the fragment. */
export function signInLinkUrl(webAppUrl: string, token: string): string {
  const url = new URL(SIGN_IN_LINK_PATH, webAppUrl)
  url.hash = new URLSearchParams({ token }).toString()
  return url.href
}
