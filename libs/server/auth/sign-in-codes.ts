/**
 * Sign-in and sign-up by an e-mailed code: the request a code answers, and the code.
 *
 * A request is one row of `sign_in_code_requests`: the address, the page to open after sign-in
 * and when the request stops working. The API writes it for every well-formed address, known or
 * not, queues the mail job and names the request in a signed cookie of the browser that asked, so
 * only that browser can enter the code. The worker makes the code and mails it in the same step,
 * so the raw code exists only in the mail. The code is a {@link mailedCodes} challenge: a new code
 * of the request ends the old one and keeps its guesses; the right code deletes every code and
 * request of the address.
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type { Sql } from "@spy4x/server/db"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"
import { isLanguage, SIGN_IN_CODE_MINUTES } from "@domain/identity"
import { mailedCodes } from "./mailed-codes.ts"

export const SIGN_IN_CODES = mailedCodes("app.sign-in-code")

/** How long a request and its latest code work, in minutes. A new code starts it again. */
export const SIGN_IN_CODE_TTL_MINUTES = SIGN_IN_CODE_MINUTES

/** A request nobody finished is removed this long after it was made. */
export const SIGN_IN_CODE_REQUEST_RETENTION_HOURS = 24

/** When a request asked for at `now`, or given a new code at `now`, stops working. */
export function signInCodeExpiry(now: Date): Date {
  return new Date(now.getTime() + SIGN_IN_CODE_TTL_MINUTES * 60_000)
}

/** One code someone asked for. */
export interface SignInCodeRequest {
  /** A UUID version 7. */
  id: string
  /** The normalised address the code goes to. */
  email: string
  /** The page to open after sign-in, already checked, or `null`. */
  next: string | null
  /**
   * The guest account that asked, or `null`. Only that guest keeps its account through the code;
   * the browser that asked holds the cookie, so another guest never reaches the request.
   */
  requestedBy: number | null
  /**
   * The language of the page that asked, which the mail is written in when the address
   * has no account or its account saved none. Only a language the apps offer, else `null`.
   */
  language?: string | null
  expiresAt: Date
}

/** The `sign_in_code_requests` table over `sql`, a pool or a transaction. */
export function signInCodeRequests(sql: Sql) {
  return {
    /** Writes a new request. */
    create: async (request: SignInCodeRequest): Promise<void> => {
      await sql`
        INSERT INTO sign_in_code_requests
          (id, email, next, requested_by_user_id, language, expires_at)
        VALUES (
          ${request.id}, ${request.email}, ${request.next}, ${request.requestedBy},
          ${isLanguage(request.language) ? request.language : null}, ${request.expiresAt}
        )
      `
    },
    /** The request with this id while it works, or `null`. Any other id is `null`. */
    find: async (id: string, now = new Date()): Promise<SignInCodeRequest | null> => {
      if (!UUID_PATTERN.test(id)) return null
      const [row] = await sql<SignInCodeRequest[]>`
        SELECT id, email, next, requested_by_user_id AS "requestedBy", language,
          expires_at AS "expiresAt"
        FROM sign_in_code_requests WHERE id = ${id} AND expires_at > ${now}
      `
      return row ?? null
    },
    /** Moves the end of a request that still works to `expiresAt`. `false` when none. */
    extend: async (id: string, expiresAt: Date, now = new Date()): Promise<boolean> => {
      if (!UUID_PATTERN.test(id)) return false
      const updated = await sql`
        UPDATE sign_in_code_requests SET expires_at = ${expiresAt}
        WHERE id = ${id} AND expires_at > ${now}
      `
      return updated.count > 0
    },
    /** Deletes the request with this id. */
    remove: async (id: string): Promise<void> => {
      if (!UUID_PATTERN.test(id)) return
      await sql`DELETE FROM sign_in_code_requests WHERE id = ${id}`
    },
    /** Deletes every request of the address `email`. */
    removeFor: async (email: string): Promise<void> => {
      await sql`DELETE FROM sign_in_code_requests WHERE email = ${email}`
    },
  }
}
