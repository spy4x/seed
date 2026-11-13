/**
 * The routes of sign-in and sign-up by a mailed code. Not
 * `@api/services/sign-in-codes.ts`, which holds the flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { normalizeEmail } from "@spy4x/server/auth"
import { SignInCodeOutcome } from "@api/services/sign-in-codes.ts"
import { pageOrNull } from "@api/services/oauth-sign-in.ts"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import {
  authSignInCodeSchema,
  authSignUpCodeSchema,
  type SignInCodeAnswer,
  type SignUpGuestTakenResponse,
  type WaitingCodeResponse,
} from "@domain/identity"
import { MAILED_CODE_DEAD, MAILED_CODE_WRONG, signOutEmitter, tooMany } from "./auth-answers.ts"

/** The answer to a code request that was accepted: the same for every address. */
export const SIGN_IN_CODE_REQUESTED = { success: true }

/** The answer to an address `normalizeEmail` refuses, on the code request. */
export const SIGN_IN_CODE_BAD_ADDRESS = "Enter an e-mail address, such as name@example.com."

/** The answer when the address's code budget is spent; the same for every address. */
export function signInCodesTooMany(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return `Too many codes were asked for this address. Try again in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`
}

/**
 * The answer when an account signs in with the code's address by password but never confirmed
 * it: the code proved the mailbox, not that account. Told only to whoever holds the mailbox.
 */
export const SIGN_IN_CODE_UNCONFIRMED =
  "An account uses this address but never confirmed it. Reset its password to sign in."

/** The sign-in code routes, mounted by `createAuthRoute`. */
export function createSignInCodeRoutes(
  {
    signIn,
    emit,
    mutationGuards,
    rateLimits,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const emitSignOut = signOutEmitter(emit)
  return new Hono<APIContext>()
    // Sign-in and sign-up by an e-mailed code. The same work and answer for every
    // well-formed address, as for a sign-up: whether an account uses it is decided only when the
    // right code comes back, from the browser that asked.
    .post(`/code`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInCodeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: SIGN_IN_CODE_BAD_ADDRESS })
      }
      // Spent for every address, known or not; a stranger spends only their own share.
      const decision = await rateLimits.signInCode(c, email)
      if (!decision.allowed) {
        return tooMany(c, decision.retryAfterMs, signInCodesTooMany(decision.retryAfterMs))
      }
      await signIn.requestSignInCode(
        c,
        email,
        pageOrNull(validationResult.data.next),
        validationResult.data.language ?? null,
      )
      return c.json(SIGN_IN_CODE_REQUESTED)
    })
    .get(`/code`, rateLimits.normal, async (c) => {
      const answer: WaitingCodeResponse = {
        email: (await signIn.waitingSignInCode(c))?.email ?? null,
      }
      return c.json(answer)
    })
    .post(`/code/verify`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignUpCodeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      // A code that would make an account the sign-up gate refuses throws `SignUpClosedError`,
      // which `createAuthRoute` answers.
      const { code, invitation = null } = validationResult.data
      const result = await signIn.completeSignInCode(c, code, invitation)
      switch (result.outcome) {
        case SignInCodeOutcome.SignedIn:
        case SignInCodeOutcome.Created:
        case SignInCodeOutcome.GuestKept: {
          // Every guest session ended with the keep: their sockets close.
          if (result.outcome === SignInCodeOutcome.GuestKept) {
            emitSignOut(c, result.signedIn.user.id)
          }
          const answer: SignInCodeAnswer = {
            email: result.email,
            next: pageOrNull(result.next),
            created: result.outcome !== SignInCodeOutcome.SignedIn,
            secondFactorPending:
              result.signedIn.session.secondFactor === SecondFactorStatus.Pending,
          }
          return c.json(answer)
        }
        case SignInCodeOutcome.GuestTaken: {
          const answer: SignUpGuestTakenResponse = { guestTaken: true }
          return c.json(answer)
        }
        case SignInCodeOutcome.WrongCode:
          return errorResponse(c, `bad_request`, { message: MAILED_CODE_WRONG })
        case SignInCodeOutcome.Unconfirmed:
          return errorResponse(c, `conflict`, { message: SIGN_IN_CODE_UNCONFIRMED })
        case SignInCodeOutcome.Refused:
          return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
      }
    })
    // The normal limit: the address's code budgets are what stop a flood of mails.
    .post(`/code/resend`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      const waiting = await signIn.waitingSignInCode(c)
      if (waiting === null) {
        return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
      }
      const decision = await rateLimits.signInCode(c, waiting.email)
      if (!decision.allowed) {
        return tooMany(c, decision.retryAfterMs, signInCodesTooMany(decision.retryAfterMs))
      }
      if (!(await signIn.resendSignInCode(c))) {
        return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
      }
      return c.json({ success: true })
    })
    .post(`/code/cancel`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      await signIn.cancelSignInCode(c)
      return c.json({ success: true })
    })
}
