import { Hono } from "hono"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { actorFromAuth } from "../cqrs/actor.ts"
import { PushRegisterCommand, PushRemoveCommand } from "@api/cqrs/commands.ts"
import type { PushRegisterResult, PushRemoveResult } from "@api/cqrs/commands.ts"
import { PushListQuery } from "@api/cqrs/queries.ts"
import type { PushListResult } from "@api/cqrs/queries.ts"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { pushSubscribeRequestSchema, pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import { validate } from "@spy4x/validation"
import { readApiJson } from "@api/services/json-body.ts"
import { AccessError } from "@domain/identity"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** What the push routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface PushNotificationRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  getPublicKey(): string
  register(command: PushRegisterCommand): Promise<PushRegisterResult>
  remove(command: PushRemoveCommand): Promise<PushRemoveResult>
  list(query: PushListQuery): Promise<PushListResult>
}

export function createPushNotificationRoute(
  { auth, mutationGuards, getPublicKey, register, remove, list }: PushNotificationRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .use(auth.isAuthenticated2FA)
    .use(mutationGuards.signedIn)
    .get(`/public-key`, (c) => c.json({ publicKey: getPublicKey() }))
    .get(`/devices`, async (c) => {
      const { devices } = await list(new PushListQuery({ actor: actorFromAuth(c.get("auth")!) }))
      return c.json({ data: devices })
    })
    .post(`/`, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(pushSubscribeRequestSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { subscription, deviceId } = validationResult.data
      try {
        const { userPushToken } = await register(
          new PushRegisterCommand({
            actor: actorFromAuth(c.get("auth")!),
            subscription,
            deviceId,
            // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
        return c.json({ userPushToken })
      } catch (error) {
        // The session ended while the body was on its way, as at a password reset (#409).
        if (error instanceof AccessError) {
          return errorResponse(c, `unauthorized`, { message: "Not authenticated" })
        }
        throw error
      }
    })
    .delete("/", async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(pushUnsubscribeRequestSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { deviceId } = validationResult.data
      await remove(
        new PushRemoveCommand({
          actor: actorFromAuth(c.get("auth")!),
          deviceId,
          // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ isSuccess: true })
    })
}
