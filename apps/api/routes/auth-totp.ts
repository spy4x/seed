/**
 * The routes of the authenticator app: check, connect and disconnect. Not
 * `@api/services/totp.ts`, which holds the flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import { authOTPSchema, authTotpDisconnectSchema, signInMethodProofSchema } from "@domain/identity"
import { checkUnderFailureCount, PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"

/** The answer when turning two-factor off is asked for with neither a password nor a code. */
export const TOTP_DISCONNECT_PROOF_REQUIRED =
  "Enter your password or the code from your authenticator app"

/** Checking and connecting, mounted by `createAuthRoute` behind the first factor. */
export function createTotpRoutes(
  {
    signIn,
    rateLimits,
    totpFailures,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .post(`/totp/check`, rateLimits.otpByUser, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return errorResponse(c, `unauthorized`, { message: "User not signed in" })
      }
      const body = await readApiJson(c)
      try {
        const validationResult = validate(authOTPSchema, body)
        if (validationResult.error) {
          return validationResponse(c, validationResult.error.details)
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.checkTotp(c, authData, validationResult.data.otp),
          () => errorResponse(c, `unauthorized`, { message: "Invalid token" }),
        )
        return outcome === true ? c.json(authData.user) : outcome
      } catch (_error) {
        return errorResponse(c, `bad_request`, { message: "Invalid request format" })
      }
    })
    // Asks for what the deletion asks (#406): the password, or for an account without one a
    // sign-in with Google or GitHub a moment ago. Finishing the set-up signs every other session
    // out, so a session left open must not be able to lock its owner out with an app of its own.
    .post(`/totp/connect/start`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(signInMethodProofSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password } = validationResult.data
      if (await signIn.hasPassword(authData.user.id)) {
        if (
          password === undefined || !(await signIn.checkPassword(authData.user.id, password))
        ) {
          return errorResponse(c, `bad_request`, { message: "Invalid password" })
        }
      } else if (!(await signIn.confirmedByProvider(authData))) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      const { error, qrcode, secret } = await signIn.connectTotpStart(authData)
      if (error) {
        return errorResponse(c, `bad_request`, { message: error })
      }
      return c.json({ qrcode, secret })
    })
    .post(`/totp/connect/finish`, rateLimits.otpByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authOTPSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const outcome = await checkUnderFailureCount(
        c,
        totpFailures,
        authData.user.id,
        () => signIn.connectTotpFinish(authData, validationResult.data.otp),
        () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
      )
      return outcome === true ? c.json({ success: true }) : outcome
    })
}

/** Disconnecting, mounted by `createAuthRoute` behind the second factor. */
export function createTotpDisconnectRoutes(
  {
    signIn,
    rateLimits,
    totpFailures,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    // Asks again for what a session left open on a shared machine lacks: the password, or a
    // current authenticator code. An account with no password proves itself with the code.
    .post(`/totp/disconnect`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authTotpDisconnectSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password, otp } = validationResult.data
      if (otp !== undefined) {
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (outcome !== true) return outcome
      } else if (password === undefined) {
        return errorResponse(c, `bad_request`, { message: TOTP_DISCONNECT_PROOF_REQUIRED })
      } else if (!(await signIn.checkPassword(authData.user.id, password))) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      const isSuccess = await signIn.disconnectTotp(authData)
      if (!isSuccess) {
        return errorResponse(c, `bad_request`, { message: "OTP already disabled for your account" })
      }
      return c.json({ success: true })
    })
}
