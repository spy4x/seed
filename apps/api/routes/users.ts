import { Hono } from "hono"
import { actorFromAuth } from "../cqrs/actor.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { validate } from "@spy4x/validation"
import { AccessError, userProfileBaseSchema } from "@domain/identity"
import { UserProfileGetQuery, UserProfileGetResult } from "@api/cqrs/queries.ts"
import { UserProfileUpdateCommand, UserProfileUpdateResult } from "@api/cqrs/commands.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { NOT_AUTHENTICATED, SECOND_FACTOR_REQUIRED } from "@spy4x/server/sign-in"
import type { ErrorHandler } from "hono"
import { readApiJson } from "@api/services/json-body.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** What the users routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface UsersRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  getProfile(query: UserProfileGetQuery): Promise<UserProfileGetResult>
  updateProfile(command: UserProfileUpdateCommand): Promise<UserProfileUpdateResult>
}

export function createUsersRoute(dependencies: UsersRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .onError(accessErrorAs401)
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .get(`/me`, async (c) => {
      const authData = c.get("auth")!
      const result = await dependencies.getProfile(
        new UserProfileGetQuery({ actor: actorFromAuth(authData) }),
      )
      return c.json({ user: result.user })
    })
    .patch(`/me`, async (c) => {
      const authData = c.get("auth")!
      const body = await readApiJson(c)
      const validationResult = validate(userProfileBaseSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const result = await dependencies.updateProfile(
        new UserProfileUpdateCommand({
          actor: actorFromAuth(authData),
          firstName: validationResult.data.firstName,
          lastName: validationResult.data.lastName,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP —
          // the template's production compose runs behind Traefik, which overwrites these headers.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ user: result.user })
    })
}

/**
 * A dispatch the session gate refuses answers 401 with the same body `isAuthenticated2FA` uses,
 * rather than surfacing as a 500. Any other error goes on to the default handler.
 */
const accessErrorAs401: ErrorHandler<APIContext> = (error, c) => {
  if (error instanceof AccessError) {
    const message = error.code === "MFA_REQUIRED" ? SECOND_FACTOR_REQUIRED : NOT_AUTHENTICATED
    return errorResponse(c, `unauthorized`, { message: message })
  }
  throw error
}
