/**
 * The routes of the account's e-mail address: its status, its code and a change. Not
 * `@api/services/email-change.ts`, which holds the flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { normalizeEmail } from "@spy4x/server/auth"
import { EmailChangeOutcome, EmailVerifyOutcome } from "@api/services/email-change.ts"
import { APIContext } from "../_types.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import type { RateLimitDecision } from "@spy4x/platform/rate-limit"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import { authEmailChangeSchema, authEmailCodeSchema, emailToVerify } from "@domain/identity"
import {
  EMAIL_CODE_REFUSED,
  PROVIDER_PROOF_REQUIRED,
  signOutEmitter,
  tooMany,
} from "./auth-answers.ts"

/**
 * The answer when an account with no password asks to move to an address another of its sign-in
 * methods carries: the change would change nothing.
 */
export const EMAIL_ALREADY_CARRIED =
  "Your account already has this address through another sign-in method."

/** The answer when the address is proven and no change waits, so no code is due. */
export const EMAIL_NOTHING_TO_VERIFY = "Your e-mail address is already verified."

/** The answer when a right code proves an address another account owns. */
export const EMAIL_TAKEN = "Another account already uses this address."

/**
 * The answer when a code mail to an address the account wants to move to is refused. One wording
 * for both budgets, so it tells nothing about who owns the address.
 */
export const EMAIL_CHANGE_TOO_MANY = "Too many address changes, try again later."

/**
 * Spends a code mail to `email`, an address the account wants to move to: first from the
 * account's budget, then from the address's change budget. The owner's own code budget stays
 * untouched, since the address may be someone else's.
 */
async function spendChangeMail(
  rateLimits: AuthRateLimits,
  userId: number,
  email: string,
): Promise<RateLimitDecision> {
  const byUser = await rateLimits.emailChangeByUser(userId)
  return byUser.allowed ? await rateLimits.emailChangeByAddress(email) : byUser
}

/** The address routes, mounted by `createAuthRoute`. */
export function createEmailChangeRoutes(
  {
    signIn,
    emit,
    rateLimits,
    emailCodeFailures,
    requestEmailCode,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const emitSignOut = signOutEmitter(emit)
  return new Hono<APIContext>()
    .get(`/email`, rateLimits.normal, async (c) => {
      return c.json(await signIn.emailStatus(c.get("auth")!))
    })
    // The normal limit, and an hourly mail budget: the account's own address spends its own, an
    // address the account wants to move to spends the change budgets, as `/email/change` does.
    .post(`/email/send`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const status = await signIn.emailStatus(authData)
      const email = emailToVerify(status)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: EMAIL_NOTHING_TO_VERIFY })
      }
      if (status.pending !== null) {
        const decision = await spendChangeMail(rateLimits, authData.user.id, email)
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, EMAIL_CHANGE_TOO_MANY)
      } else {
        const decision = await rateLimits.emailCodeByAddress(email)
        if (!decision.allowed) {
          return tooMany(
            c,
            decision.retryAfterMs,
            "Too many codes for this address, try again later.",
          )
        }
      }
      await requestEmailCode(authData.user.id, email)
      return c.json({ success: true, message: `A new code is on its way to ${email}.` })
    })
    .post(`/email/verify`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authEmailCodeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const waitMs = await emailCodeFailures.begin(authData.user.id)
      if (waitMs > 0) return tooMany(c, waitMs, "Too many wrong codes, try again later.")
      const outcome = await signIn.verifyEmail(c, authData, validationResult.data.code)
      if (outcome === EmailVerifyOutcome.WrongCode) {
        await emailCodeFailures.fail(authData.user.id)
        return errorResponse(c, `bad_request`, { message: EMAIL_CODE_REFUSED })
      }
      await emailCodeFailures.refund(authData.user.id)
      if (outcome === EmailVerifyOutcome.Taken) {
        return errorResponse(c, `conflict`, { message: EMAIL_TAKEN })
      }
      if (outcome === EmailVerifyOutcome.NothingToVerify) {
        return errorResponse(c, `bad_request`, { message: EMAIL_NOTHING_TO_VERIFY })
      }
      // A new address signed the other devices out: their sockets close now. Proving the
      // address the account has ends none, and the hub then finds nothing to close.
      emitSignOut(c, authData.user.id)
      return c.json({ success: true })
    })
    .post(`/email/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authEmailChangeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { email: rawEmail, password } = validationResult.data
      const email = normalizeEmail(rawEmail)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      const outcome = await signIn.requestEmailChange(authData, password, email)
      if (outcome === EmailChangeOutcome.WrongPassword) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      if (outcome === EmailChangeOutcome.ProofRequired) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      if (outcome === EmailChangeOutcome.InvalidEmail) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      if (outcome === EmailChangeOutcome.AlreadyCarried) {
        return errorResponse(c, `bad_request`, { message: EMAIL_ALREADY_CARRIED })
      }
      if (outcome === EmailChangeOutcome.Kept) {
        return c.json({ success: true, message: "Your address stays as it is." })
      }
      // The change waits either way; a refused mail is asked for again later with /email/send.
      const decision = await spendChangeMail(rateLimits, authData.user.id, email)
      if (!decision.allowed) return tooMany(c, decision.retryAfterMs, EMAIL_CHANGE_TOO_MANY)
      await requestEmailCode(authData.user.id, email)
      return c.json({
        success: true,
        message: `A code is on its way to ${email}. Your address changes once you enter it.`,
      })
    })
}
