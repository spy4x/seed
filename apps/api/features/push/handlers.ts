import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import { AccessError, type UserPushTokenPublic } from "@domain/identity"
import type { PushRegisterCommand, PushRemoveCommand } from "../../cqrs/commands.ts"
import { PushDevicesUpdatedEvent } from "../../cqrs/events.ts"
import type { PushListQuery } from "../../cqrs/queries.ts"
import type { WebPushService } from "../../services/web-push-service.ts"

/**
 * What the push handlers need from the app. The files in `cqrs/command-handlers/` and
 * `cqrs/query-handlers/` pass the real ones; tests pass fakes.
 */
export interface PushHandlerDependencies {
  webPush(): Promise<Pick<WebPushService, "subscribe" | "unsubscribe" | "deviceList">>
  emit(event: PushDevicesUpdatedEvent): void
}

/** Stores the subscription for the actor, then announces the new device list. */
export function createPushRegisterHandler(
  { webPush, emit }: PushHandlerDependencies,
): CommandHandler<PushRegisterCommand> {
  return async ({ data: { actor, subscription, deviceId, request } }) => {
    // Only a session stores a browser: the store checks under a lock that it is still live.
    if (actor.sessionId === undefined) throw new AccessError("AUTH_REQUIRED", "No session")
    const service = await webPush()
    const userPushToken = await service.subscribe(
      subscription,
      deviceId,
      actor.userId,
      actor.sessionId,
    )
    const devices = await service.deviceList(actor.userId)
    emit(new PushDevicesUpdatedEvent({ userId: actor.userId, devices, request }))
    return { userPushToken }
  }
}

/** Removes the actor's device, then announces the new device list. */
export function createPushRemoveHandler(
  { webPush, emit }: PushHandlerDependencies,
): CommandHandler<PushRemoveCommand> {
  return async ({ data: { actor, deviceId, request } }) => {
    const service = await webPush()
    await service.unsubscribe(deviceId, actor.userId)
    const devices = await service.deviceList(actor.userId)
    emit(new PushDevicesUpdatedEvent({ userId: actor.userId, devices, request }))
    return { isSuccess: true }
  }
}

/** The actor's devices, and nobody else's. */
export function createPushListHandler(
  { webPush }: Pick<PushHandlerDependencies, "webPush">,
): QueryHandler<PushListQuery> {
  return async ({ data: { actor } }): Promise<{ devices: UserPushTokenPublic[] }> => ({
    devices: await (await webPush()).deviceList(actor.userId),
  })
}
