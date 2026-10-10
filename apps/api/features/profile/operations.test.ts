import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type User, UserMFAStatus } from "@domain/identity"
import type { UserProfileUpdateCommand } from "../../cqrs/commands.ts"
import type { UserProfileGetQuery } from "../../cqrs/queries.ts"
import { createProfileOperations } from "./operations.ts"

const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal
const user = { id: 7, firstName: "Ada", lastName: "Lovelace" } as User

function harness() {
  const seen: { update: UserProfileUpdateCommand | null; get: UserProfileGetQuery | null } = {
    update: null,
    get: null,
  }
  const requests = createProfileOperations({
    get(query) {
      seen.get = query
      return Promise.resolve({ user })
    },
    update(command) {
      seen.update = command
      return Promise.resolve({ user })
    },
  })
  return { requests, seen }
}

describe("profile socket requests", () => {
  it("declares update as a command and get as a query", () => {
    const { requests } = harness()

    expect(requests["profile.update"].kind).toBe("command")
    expect(requests["profile.get"].kind).toBe("query")
  })

  it("dispatches update with the actor, request id and idempotency key of the call", async () => {
    const { requests, seen } = harness()

    const result = await requests["profile.update"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { firstName: "Ada", lastName: "Lovelace" },
    })

    expect(result).toEqual({ user })
    expect(seen.update?.data).toEqual({
      actor,
      firstName: "Ada",
      lastName: "Lovelace",
      request: { requestId: "req-1" },
      idempotencyKey: "key-1",
    })
  })

  it("refuses an update with an empty name as bad_request and does not dispatch it", async () => {
    const { requests, seen } = harness()

    const failure = await Promise.resolve(requests["profile.update"].handle({
      actor,
      requestId: "req-1",
      signal,
      idempotencyKey: "key-1",
      payload: { firstName: "", lastName: "Lovelace" },
    })).catch((error) => error)

    expect(failure).toBeInstanceOf(RealtimeRequestError)
    expect((failure as RealtimeRequestError).code).toBe("bad_request")
    expect(seen.update).toBe(null)
  })

  it("reads the profile of the actor", async () => {
    const { requests, seen } = harness()

    const result = await requests["profile.get"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: undefined,
    })

    expect(result).toEqual({ user })
    expect(seen.get?.data).toEqual({ actor })
  })

  it("refuses a get that names a payload", async () => {
    const { requests, seen } = harness()

    const failure = await Promise.resolve(requests["profile.get"].handle({
      actor,
      requestId: "req-2",
      signal,
      payload: { userId: 8 },
    })).catch((error) => error)

    expect(failure).toBeInstanceOf(RealtimeRequestError)
    expect(seen.get).toBe(null)
  })
})
