/**
 * The routes of account deletion. Not `@api/services/account-deletion.ts`, which holds the
 * flow these routes call.
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import type { AuthRouteDependencies } from "./auth.ts"
import { accountDeleteSchema, UserMFAStatus } from "@domain/identity"
import { checkUnderFailureCount, PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"

/** The answer when groups stop the account from being deleted. */
export const ACCOUNT_DELETE_BLOCKED =
  "You own groups other people still use or pay for. Deal with them first."

/** The answer when the account has two-factor on and the request carries no code. */
export const ACCOUNT_DELETE_CODE_REQUIRED = "Enter the code from your authenticator app"

/** The account-deletion routes, mounted by `createAuthRoute`. */
export function createAccountDeletionRoutes(
  {
    signIn,
    emit,
    rateLimits,
    totpFailures,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .get(`/account/deletion`, rateLimits.normal, async (c) => {
      return c.json({ blockers: await signIn.accountDeletionBlockers(c.get("auth")!) })
    })
    // Asks again for what a stolen session lacks: the password, and the authenticator code when
    // two-factor is on, as the sign-in does. An account with no password has signed in with
    // Google or GitHub a moment ago instead (#384). Groups that stop it are named before anything is
    // checked, so the person learns what to do first without typing the password in vain.
    .post(`/account/delete`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(accountDeleteSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password, otp } = validationResult.data
      const blockers = await signIn.accountDeletionBlockers(authData)
      if (blockers.length > 0) {
        return errorResponse(c, `conflict`, {
          message: ACCOUNT_DELETE_BLOCKED,
          details: { blockers },
        })
      }
      if (await signIn.hasPassword(authData.user.id)) {
        if (
          password === undefined || !(await signIn.checkPassword(authData.user.id, password))
        ) {
          return errorResponse(c, `bad_request`, { message: "Invalid password" })
        }
      } else if (!(await signIn.confirmedByProvider(authData))) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
        if (otp === undefined) {
          return errorResponse(c, `bad_request`, { message: ACCOUNT_DELETE_CODE_REQUIRED })
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (outcome !== true) return outcome
      }
      const result = await signIn.deleteAccount(c, authData)
      if (result.blockers) {
        if (result.blockers.length === 0) {
          return errorResponse(c, `unauthorized`, { message: "User not signed in" })
        }
        return errorResponse(c, `conflict`, {
          message: ACCOUNT_DELETE_BLOCKED,
          details: { blockers: result.blockers },
        })
      }
      emit(
        new UserSignedOutEvent({
          userId: authData.user.id,
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ success: true, deleteAfter: result.deleteAfter.toISOString() })
    })
}
