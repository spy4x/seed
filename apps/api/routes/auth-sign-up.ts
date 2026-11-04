/**
 * The routes of sign-up by password and a mailed code (#142). Not `@api/services/sign-up.ts`,
 * which holds the flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { normalizeEmail } from "@spy4x/server/auth"
import { SignUpOutcome } from "@api/services/sign-up.ts"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import {
  authEmailCodeSchema,
  authSignUpSchema,
  type SignUpAccountExistsResponse,
  type SignUpGuestTakenResponse,
  type WaitingPasswordSignUpResponse,
} from "@domain/identity"
import { EMAIL_CODE_REFUSED, signInAnswer, signOutEmitter, tooMany } from "./auth-answers.ts"

/**
 * The answer to a sign-up that was accepted: a code is on its way to the address. The same for
 * every address, whether or not an account uses it (#142).
 */
export const SIGN_UP_REQUESTED = { success: true }

/** The answer when no sign-up waits for a code: it took too long, or its code was guessed at. */
export const SIGN_UP_EXPIRED = "This sign-up expired. Start again."

/** The answer when the address's code budget is spent; the same for every address. */
export const SIGN_UP_CODES_TOO_MANY = "Too many codes for this address, try again later."

/** The sign-up routes, mounted by `createAuthRoute`. */
export function createSignUpRoutes(
  {
    signIn,
    emit,
    mutationGuards,
    rateLimits,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const emitSignOut = signOutEmitter(emit)
  return new Hono<APIContext>()
    // Proves the address before anything is created (#142). The same work and the same answer
    // for every well-formed address: nothing here asks whether an account uses it, so neither the
    // answer nor its timing tells a stranger which addresses have accounts.
    .post(`/password/sign-up`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignUpSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account. The
      // sign-up budgets, not the account's own: a stranger's sign-ups must not lock its owner out.
      const decision = await rateLimits.signUpCode(c, email)
      if (!decision.allowed) return tooMany(c, decision.retryAfterMs, SIGN_UP_CODES_TOO_MANY)
      // A guest's sign-up keeps the guest account instead of making a new one (#224).
      const state = c.get("auth")
      const guestUserId = state?.user.guestSince ? state.user.id : null
      const { password, language = null } = validationResult.data
      if (!(await signIn.requestSignUp(c, email, password, guestUserId, language))) {
        return errorResponse(c, `bad_request`, {
          message: "This password cannot be used. Try another one.",
        })
      }
      return c.json(SIGN_UP_REQUESTED)
    })
    .get(`/password/sign-up`, rateLimits.normal, async (c) => {
      const waiting = await signIn.waitingSignUp(c)
      const answer: WaitingPasswordSignUpResponse = {
        pending: waiting && { email: waiting.email, expiresAt: waiting.expiresAt.toISOString() },
      }
      return c.json(answer)
    })
    .post(
      `/password/sign-up/verify`,
      mutationGuards.anonymous,
      rateLimits.strictByIp,
      async (c) => {
        const body = await readApiJson(c)
        const validationResult = validate(authEmailCodeSchema, body)
        if (validationResult.error) {
          return validationResponse(c, validationResult.error.details)
        }
        const result = await signIn.completeSignUp(c, validationResult.data.code)
        switch (result.outcome) {
          case SignUpOutcome.GuestKept:
            // Every guest session ended with the keep (#374): their sockets close.
            emitSignOut(c, result.signedIn.user.id)
            return signInAnswer(c, result.signedIn)
          case SignUpOutcome.Created:
            return signInAnswer(c, result.signedIn)
          case SignUpOutcome.GuestTaken: {
            const answer: SignUpGuestTakenResponse = { guestTaken: true }
            return c.json(answer)
          }
          case SignUpOutcome.AccountExists: {
            const { password, providers } = result.account
            const answer: SignUpAccountExistsResponse = {
              accountExists: { email: result.email, password, providers },
            }
            return c.json(answer)
          }
          case SignUpOutcome.WrongCode:
            return errorResponse(c, `bad_request`, { message: EMAIL_CODE_REFUSED })
          case SignUpOutcome.Expired:
            return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
      },
    )
    // The normal limit: the address's sign-up code budgets are what stop a flood of mails.
    .post(
      `/password/sign-up/resend`,
      mutationGuards.anonymous,
      rateLimits.normal,
      async (c) => {
        const waiting = await signIn.waitingSignUp(c)
        if (waiting === null) {
          return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
        const decision = await rateLimits.signUpCode(c, waiting.email)
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, SIGN_UP_CODES_TOO_MANY)
        if (!(await signIn.resendSignUpCode(c))) {
          return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
        return c.json({ success: true })
      },
    )
    .post(`/password/sign-up/cancel`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      await signIn.cancelSignUp(c)
      return c.json({ success: true })
    })
}
