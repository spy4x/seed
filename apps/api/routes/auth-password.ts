/**
 * The routes of a password change and a first password. Not `@api/services/password.ts`, which
 * holds the flow these routes call, nor JSR's `@spy4x/server/auth/password`.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { PasswordSetOutcome } from "@api/services/password.ts"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import {
  authPasswordChangeSchema,
  authPasswordSetSchema,
  hasPasswordAddress,
  UserMFAStatus,
} from "@domain/identity"
import { checkUnderFailureCount, PROVIDER_PROOF_REQUIRED, signOutEmitter } from "./auth-answers.ts"
import { ACCOUNT_DELETE_CODE_REQUIRED } from "./auth-account-deletion.ts"

/** The same answer for a first password: with two-factor on, it needs the code too. */
export const PASSWORD_SET_CODE_REQUIRED = ACCOUNT_DELETE_CODE_REQUIRED

/** The answer when a first password is asked for by an account that has one. */
export const PASSWORD_ALREADY_SET = "This account has a password already. Change it instead."

/** The answer when a first password is asked for by an account with no address to sign in with. */
export const PASSWORD_NEEDS_ADDRESS = "Add an email address first: you sign in with it."

/** The answer when a first password cannot be stored. */
export const PASSWORD_SET_REFUSED = "This password cannot be set. Try another one."

/** The password routes, mounted by `createAuthRoute`. */
export function createPasswordRoutes(
  {
    signIn,
    emit,
    rateLimits,
    totpFailures,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const emitSignOut = signOutEmitter(emit)
  return new Hono<APIContext>()
    .post(`/password/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordChangeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { password, newPassword, signOutOthers = true } = validationResult.data
      const authData = c.get("auth")!
      const changed = await signIn.changePassword(
        c,
        authData,
        password,
        newPassword,
        signOutOthers,
      )
      if (!changed) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      // The other devices' sockets close now rather than at the next periodic check.
      if (signOutOthers) emitSignOut(c, authData.user.id)
      // How many API tokens the change revoked, so the page can say so.
      return c.json({ success: true, revokedTokens: changed.revokedTokens })
    })
    // The first password of an account made with Google or GitHub. There is no password to ask
    // for, so the session itself must be a provider sign-in of a moment ago.
    .post(`/password/set`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordSetSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { newPassword, otp } = validationResult.data
      // With two-factor on, the code is asked as the deletion asks it: the new password is
      // accepted as proof to turn two-factor off, so it must not cost less than the code.
      if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
        if (otp === undefined) {
          return errorResponse(c, `bad_request`, { message: PASSWORD_SET_CODE_REQUIRED })
        }
        // The cheap refusals first, so a code is not spent on a request that sets nothing.
        if (await signIn.hasPassword(authData.user.id)) {
          return errorResponse(c, `bad_request`, { message: PASSWORD_ALREADY_SET })
        }
        // No address: `setPassword` would refuse it after the code was spent.
        if (!hasPasswordAddress(await signIn.emailStatus(authData))) {
          return errorResponse(c, `bad_request`, { message: PASSWORD_NEEDS_ADDRESS })
        }
        if (!(await signIn.confirmedByProvider(authData))) {
          return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
        }
        const checked = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (checked !== true) return checked
      }
      const outcome = await signIn.setPassword(c, authData, newPassword)
      if (outcome === PasswordSetOutcome.Set) {
        // The other devices were signed out: their sockets close now.
        emitSignOut(c, authData.user.id)
        return c.json({ success: true })
      }
      const refusals = {
        [PasswordSetOutcome.AlreadySet]: PASSWORD_ALREADY_SET,
        [PasswordSetOutcome.ProofRequired]: PROVIDER_PROOF_REQUIRED,
        [PasswordSetOutcome.NoAddress]: PASSWORD_NEEDS_ADDRESS,
        [PasswordSetOutcome.Refused]: PASSWORD_SET_REFUSED,
      }
      return errorResponse(c, `bad_request`, { message: refusals[outcome] })
    })
}
