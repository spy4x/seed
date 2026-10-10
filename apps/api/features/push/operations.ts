import { pushSubscribeRequestSchema, pushUnsubscribeRequestSchema } from "@spy4x/platform/model"
import type { PushSubscribeRequest, PushUnsubscribeRequest } from "@spy4x/platform/model"
import { PushRegisterCommand, PushRemoveCommand } from "../../cqrs/commands.ts"
import type { PushRegisterResult, PushRemoveResult } from "../../cqrs/commands.ts"
import { PushListQuery } from "../../cqrs/queries.ts"
import type { PushListResult } from "../../cqrs/queries.ts"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { expectNoPayload, parsePayload } from "../../services/socket-payload.ts"

/** What the push socket requests need from the app. */
export interface PushOperationDependencies {
  register(command: PushRegisterCommand): Promise<PushRegisterResult>
  remove(command: PushRemoveCommand): Promise<PushRemoveResult>
  list(query: PushListQuery): Promise<PushListResult>
}

/**
 * `push.register`, `push.remove` and `push.list`: the person's own devices. Payloads are parsed with
 * the schemas the REST route uses, and the commands run on the same bus, so a retry with the same
 * idempotency key registers or removes a device once.
 */
export function createPushOperations(dependencies: PushOperationDependencies): Operations<Actor> {
  return {
    "push.register": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { subscription, deviceId } = parsePayload<PushSubscribeRequest>(
          pushSubscribeRequestSchema,
          payload,
        )
        return await dependencies.register(
          new PushRegisterCommand({
            actor,
            subscription,
            deviceId,
            request: { requestId },
            idempotencyKey,
          }),
        )
      },
    },
    "push.remove": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { deviceId } = parsePayload<PushUnsubscribeRequest>(
          pushUnsubscribeRequestSchema,
          payload,
        )
        return await dependencies.remove(
          new PushRemoveCommand({ actor, deviceId, request: { requestId }, idempotencyKey }),
        )
      },
    },
    "push.list": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        expectNoPayload(payload)
        return await dependencies.list(new PushListQuery({ actor }))
      },
    },
  }
}
