/**
 * What more than one auth route file shares: the answers several flows give, the 429 answer,
 * the guarded one-time-code check and the sign-out announcement.
 *
 * @module
 */
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { Lockout } from "@spy4x/server/lockout"
import { errorResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import type { User } from "@domain/identity"

/** The answer to a wrong code, while the request still takes guesses. */
export const MAILED_CODE_WRONG = "That code isn't right. Check the latest email and try again."

/**
 * The answer when no request waits in this browser, it expired, its guesses ran out, or the
 * account is blocked or gone: one answer for all.
 */
export const MAILED_CODE_DEAD = "This code no longer works. Send a new one."

/** The answer to an e-mail code that cannot be used: wrong, expired or used up alike. */
export const EMAIL_CODE_REFUSED = "This code is wrong or has expired. Ask for a new one."

/**
 * The answer when an account with no password asks for a step that the others confirm with their
 * password, and its session is no sign-in with Google or GitHub of a moment ago.
 */
export const PROVIDER_PROOF_REQUIRED =
  "Sign in with Google or GitHub again, then repeat this within a few minutes."

/** Sets `Retry-After` and answers 429 with `error`. */
export function tooMany(c: Context<APIContext>, retryAfterMs: number, error: string): Response {
  c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
  return errorResponse(c, `rate_limited`, { message: error })
}

/**
 * Runs one one-time-code check under the failure counter. While the user is locked the check does
 * not run at all, so not even a correct code gets through, and the answer is 429 with
 * `Retry-After`. A wrong code is recorded, a correct one gives its slot back.
 */
export async function checkUnderFailureCount(
  c: Context<APIContext>,
  totpFailures: Lockout,
  userId: number,
  check: () => Promise<boolean>,
  wrongAnswer: () => Response,
): Promise<Response | true> {
  const waitMs = await totpFailures.begin(userId)
  if (waitMs > 0) {
    c.header("Retry-After", String(Math.ceil(waitMs / 1000)))
    return errorResponse(c, `rate_limited`, { message: "Too many wrong codes, try again later." })
  }
  if (!(await check())) {
    await totpFailures.fail(userId)
    return wrongAnswer()
  }
  await totpFailures.refund(userId)
  return true
}

/**
 * The body of a sign-in answer. A session that still owes its one-time code gets 202 and only
 * `{ secondFactor: "Pending" }`: the profile stays behind the second factor, like `/users/me`.
 */
export function signInAnswer(
  c: Context<APIContext>,
  { user, session }: { user: User; session: { secondFactor: SecondFactorStatus } },
) {
  if (session.secondFactor === SecondFactorStatus.Pending) {
    return c.json({ secondFactor: "Pending" }, 202)
  }
  return c.json(user, 200)
}

/** Announces that sessions of `userId` ended, so the realtime hub closes their sockets. */
export function signOutEmitter(emit: AuthRouteDependencies["emit"]) {
  return (c: Context<APIContext>, userId: number) =>
    emit(
      new UserSignedOutEvent({
        userId,
        // trustedProxy: true trusts X-Forwarded-For / X-Real-IP: Traefik overwrites them.
        request: requestInfoFromContext(c, { trustedProxy: true }),
      }),
    )
}
