/**
 * The routes of password reset by a mailed code (#752). Not
 * `@api/services/password-reset.ts`, which holds the flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { normalizeEmail } from "@spy4x/server/auth"
import { PasswordResetOutcome } from "@api/services/password-reset.ts"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import {
  authEmailCodeSchema,
  authPasswordForgotSchema,
  authPasswordResetSchema,
  type PasswordResetVerified,
  type WaitingCodeResponse,
} from "@domain/identity"
import { MAILED_CODE_DEAD, MAILED_CODE_WRONG, tooMany } from "./auth-answers.ts"

/** The answer to a reset request that was accepted, whether or not the address has an account. */
export const PASSWORD_RESET_REQUESTED = {
  success: true,
  message: "If an account uses this address, a code to reset its password is on its way.",
}

/** The answer when the address's reset budget is spent; the same for every address. */
export const PASSWORD_RESET_TOO_MANY = "Too many reset codes for this address, try again later."

/** The answer to a reset token that cannot be used, or a reset no browser of this one waits for. */
export const PASSWORD_RESET_REFUSED = "This reset no longer works. Ask for a new code."

/** The password-reset routes, mounted by `createAuthRoute`. */
export function createPasswordResetRoutes(
  {
    signIn,
    mutationGuards,
    rateLimits,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    // Password reset by code (#752). The same work and answer for every well-formed address; the
    // worker mails the code only when an account signs in with a password and that address.
    .post(`/password/forgot`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordForgotSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account.
      const decision = await rateLimits.resetByAddress(email)
      if (!decision.allowed) return tooMany(c, decision.retryAfterMs, PASSWORD_RESET_TOO_MANY)
      await signIn.requestPasswordReset(c, email)
      return c.json(PASSWORD_RESET_REQUESTED)
    })
    .get(`/password/reset`, rateLimits.normal, async (c) => {
      const answer: WaitingCodeResponse = {
        email: (await signIn.waitingPasswordReset(c))?.email ?? null,
      }
      return c.json(answer)
    })
    .post(
      `/password/reset/verify`,
      mutationGuards.anonymous,
      rateLimits.strictByIp,
      async (c) => {
        const body = await readApiJson(c)
        const validationResult = validate(authEmailCodeSchema, body)
        if (validationResult.error) {
          return validationResponse(c, validationResult.error.details)
        }
        const result = await signIn.verifyPasswordReset(c, validationResult.data.code)
        switch (result.outcome) {
          case PasswordResetOutcome.Verified: {
            const answer: PasswordResetVerified = { token: result.token }
            return c.json(answer)
          }
          case PasswordResetOutcome.WrongCode:
            return errorResponse(c, `bad_request`, { message: MAILED_CODE_WRONG })
          case PasswordResetOutcome.Expired:
            return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
        }
      },
    )
    // The normal limit: the address's reset budget is what stops a flood of mails.
    .post(
      `/password/reset/resend`,
      mutationGuards.anonymous,
      rateLimits.normal,
      async (c) => {
        const waiting = await signIn.waitingPasswordReset(c)
        if (waiting === null) {
          return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
        }
        const decision = await rateLimits.resetByAddress(waiting.email)
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, PASSWORD_RESET_TOO_MANY)
        if (!(await signIn.resendPasswordReset(c))) {
          return errorResponse(c, `not_found`, { message: MAILED_CODE_DEAD, status: 410 })
        }
        return c.json({ success: true })
      },
    )
    .post(`/password/reset/cancel`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      await signIn.cancelPasswordReset(c)
      return c.json({ success: true })
    })
    // The token from `/password/reset/verify` and the new password; the address is the one this
    // browser's request names, so the token never travels with it in a URL.
    .post(`/password/reset`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordResetSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { token, newPassword } = validationResult.data
      if (!(await signIn.finishPasswordReset(c, token, newPassword))) {
        return errorResponse(c, `bad_request`, { message: PASSWORD_RESET_REFUSED })
      }
      return c.json({ success: true })
    })
}
