import { userProfileBaseSchema } from "@domain/identity"
import type { UserProfileBase } from "@domain/identity"
import { UserProfileUpdateCommand } from "../../cqrs/commands.ts"
import type { UserProfileUpdateResult } from "../../cqrs/commands.ts"
import { UserProfileGetQuery } from "../../cqrs/queries.ts"
import type { UserProfileGetResult } from "../../cqrs/queries.ts"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { expectNoPayload, parsePayload } from "../../services/socket-payload.ts"

/** What the profile socket requests need from the app. */
export interface ProfileOperationDependencies {
  get(query: UserProfileGetQuery): Promise<UserProfileGetResult>
  update(command: UserProfileUpdateCommand): Promise<UserProfileUpdateResult>
}

/**
 * `profile.get` and `profile.update`. Like the REST route they parse the payload with the profile
 * schema and dispatch on the same bus; the person is always the session's, never named in the
 * payload.
 */
export function createProfileOperations(
  dependencies: ProfileOperationDependencies,
): Operations<Actor> {
  return {
    "profile.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        expectNoPayload(payload)
        return await dependencies.get(new UserProfileGetQuery({ actor }))
      },
    },
    "profile.update": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { firstName, lastName } = parsePayload<UserProfileBase>(
          userProfileBaseSchema,
          payload,
        )
        return await dependencies.update(
          new UserProfileUpdateCommand({
            actor,
            firstName,
            lastName,
            request: { requestId },
            idempotencyKey,
          }),
        )
      },
    },
  }
}
