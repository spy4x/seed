import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AccessError, UserMFAStatus, type UserPushTokenPublic } from "@domain/identity"
import { PushRegisterCommand, PushRemoveCommand } from "../../cqrs/commands.ts"
import { PushDevicesUpdatedEvent } from "../../cqrs/events.ts"
import { PushListQuery } from "../../cqrs/queries.ts"
import {
  createPushListHandler,
  createPushRegisterHandler,
  createPushRemoveHandler,
} from "./handlers.ts"

const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
  sessionId: 70,
}
const request = { requestId: "req-1" }
const subscription = {
  endpoint: "https://push.example/endpoint",
  expirationTime: null,
  keys: { auth: "auth-key", p256dh: "p256dh-key" },
}
const device = (userId: number, deviceId: string) =>
  ({ id: 1, userId, deviceId }) as UserPushTokenPublic

function harness() {
  const calls: string[] = []
  const events: PushDevicesUpdatedEvent[] = []
  const deps = {
    webPush: () =>
      Promise.resolve({
        subscribe: (_sub: unknown, deviceId: string, userId: number, sessionId: number) => {
          calls.push(`subscribe ${deviceId} for ${userId} in session ${sessionId}`)
          return Promise.resolve(device(userId, deviceId))
        },
        unsubscribe: (deviceId: string, userId: number) => {
          calls.push(`unsubscribe ${deviceId} for ${userId}`)
          return Promise.resolve()
        },
        deviceList: (userId: number) => {
          calls.push(`list for ${userId}`)
          return Promise.resolve([device(userId, "listed")])
        },
      }),
    emit: (event: PushDevicesUpdatedEvent) => events.push(event),
  }
  return { deps, calls, events }
}

describe("push handlers", () => {
  it("registers the device for the actor and announces that user's devices", async () => {
    const { deps, calls, events } = harness()

    const result = await createPushRegisterHandler(deps)(
      new PushRegisterCommand({ actor, deviceId: "phone", subscription, request }),
    )

    expect(result.userPushToken.userId).toBe(7)
    expect(calls).toEqual(["subscribe phone for 7 in session 70", "list for 7"])
    expect(events).toHaveLength(1)
    expect(events[0].data.userId).toBe(7)
    expect(events[0].data.devices.map((d) => d.deviceId)).toEqual(["listed"])
    expect(events[0].data.request).toEqual(request)
  })

  it("refuses to register a device for an actor without a session, and stores nothing", async () => {
    const { deps, calls, events } = harness()
    const { sessionId: _, ...tokenActor } = actor

    const refused = createPushRegisterHandler(deps)(
      new PushRegisterCommand({ actor: tokenActor, deviceId: "phone", subscription, request }),
    )

    await expect(refused).rejects.toThrow(AccessError)
    expect(calls).toEqual([])
    expect(events).toHaveLength(0)
  })

  it("removes the device of the actor and announces that user's devices", async () => {
    const { deps, calls, events } = harness()

    const result = await createPushRemoveHandler(deps)(
      new PushRemoveCommand({ actor, deviceId: "phone", request }),
    )

    expect(result).toEqual({ isSuccess: true })
    expect(calls).toEqual(["unsubscribe phone for 7", "list for 7"])
    expect(events).toHaveLength(1)
    expect(events[0].data.userId).toBe(7)
  })

  it("lists only the devices of the actor and announces nothing", async () => {
    const { deps, calls, events } = harness()

    const result = await createPushListHandler(deps)(new PushListQuery({ actor }))

    expect(result.devices.map((d) => d.userId)).toEqual([7])
    expect(calls).toEqual(["list for 7"])
    expect(events).toEqual([])
  })
})
