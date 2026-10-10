import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import type { PushRegisterCommand, PushRemoveCommand } from "../../cqrs/commands.ts"
import type { PushListQuery } from "../../cqrs/queries.ts"
import { createPushOperations } from "./operations.ts"

const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal
const subscription = {
  endpoint: "https://push.example/endpoint",
  expirationTime: null,
  keys: { auth: "auth-key", p256dh: "p256dh-key" },
}
const device = {
  id: 1,
  userId: 7,
  deviceId: "device-1",
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

function harness() {
  const seen: {
    register: PushRegisterCommand | null
    remove: PushRemoveCommand | null
    list: PushListQuery | null
  } = { register: null, remove: null, list: null }
  const requests = createPushOperations({
    register(command) {
      seen.register = command
      return Promise.resolve({ userPushToken: device })
    },
    remove(command) {
      seen.remove = command
      return Promise.resolve({ isSuccess: true })
    },
    list(query) {
      seen.list = query
      return Promise.resolve({ devices: [device] })
    },
  })
  return { requests, seen }
}

describe("push socket requests", () => {
  it("declares register and remove as commands and list as a query", () => {
    const { requests } = harness()

    expect(requests["push.register"].kind).toBe("command")
    expect(requests["push.remove"].kind).toBe("command")
    expect(requests["push.list"].kind).toBe("query")
  })

  it("dispatches register with the actor, request id and idempotency key of the call", async () => {
    const { requests, seen } = harness()

    const result = await requests["push.register"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { deviceId: "device-1", subscription },
    })

    expect(result).toEqual({ userPushToken: device })
    expect(seen.register?.data).toEqual({
      actor,
      deviceId: "device-1",
      subscription,
      request: { requestId: "req-1" },
      idempotencyKey: "key-1",
    })
  })

  it("refuses a register without a subscription as bad_request and does not dispatch it", async () => {
    const { requests, seen } = harness()

    const failure = await Promise.resolve(requests["push.register"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { deviceId: "device-1" },
    })).catch((error) => error)

    expect(failure).toBeInstanceOf(RealtimeRequestError)
    expect((failure as RealtimeRequestError).code).toBe("bad_request")
    expect(seen.register).toBe(null)
  })

  it("dispatches remove with the actor and idempotency key of the call", async () => {
    const { requests, seen } = harness()

    const result = await requests["push.remove"].handle({
      actor,
      requestId: "req-2",
      signal,
      idempotencyKey: "key-2",
      payload: { deviceId: "device-1" },
    })

    expect(result).toEqual({ isSuccess: true })
    expect(seen.remove?.data).toEqual({
      actor,
      deviceId: "device-1",
      request: { requestId: "req-2" },
      idempotencyKey: "key-2",
    })
  })

  it("refuses a remove that names another field", async () => {
    const { requests, seen } = harness()

    const failure = await Promise.resolve(requests["push.remove"].handle({
      actor,
      requestId: "req-2",
      signal,
      idempotencyKey: "key-2",
      payload: { deviceId: "device-1", userId: 8 },
    })).catch((error) => error)

    expect(failure).toBeInstanceOf(RealtimeRequestError)
    expect(seen.remove).toBe(null)
  })

  it("lists the devices of the actor", async () => {
    const { requests, seen } = harness()

    const result = await requests["push.list"].handle({
      actor,
      requestId: "req-3",
      signal,
      payload: undefined,
    })

    expect(result).toEqual({ devices: [device] })
    expect(seen.list?.data).toEqual({ actor })
  })
})
