import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { OperationCall, Operations } from "@spy4x/realtime/operations"
import { GroupError } from "@domain/groups"
import type { Actor } from "@domain/identity"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import { toRequestError } from "../services/realtime.ts"
import { createCallRoute } from "./call.ts"
import { apiError } from "../_testing/api-error.ts"

const USER = 7

function buildApp(
  auth = buildAuthData({ user: { id: USER }, session: { userId: USER } }) as
    | ReturnType<typeof buildAuthData>
    | null,
  overrides: Operations<Actor> = {},
) {
  const calls: OperationCall<Actor>[] = []
  const logged: unknown[][] = []
  const route = createCallRoute({
    operations: {
      "group.create": {
        kind: "command",
        handle: (call) => {
          calls.push(call)
          return { created: true }
        },
      },
      "group.list": {
        kind: "query",
        handle: (call) => {
          calls.push(call)
          return { groups: [] }
        },
      },
      ...overrides,
    },
    mapError: toRequestError,
    log: (...data) => logged.push(data),
    expectedOrigin: WEB_APP_URL,
  })
  return { app: mountRoute("/call", route, auth), calls, logged }
}

/** A call as the page's HTTP calls module sends it, for the user the page was started for. */
function call(
  name: string,
  payload: unknown,
  headers: Record<string, string> = {},
  base: Readonly<Record<string, string>> = sameOriginHeaders,
): [string, RequestInit] {
  return [`${API_URL}/call/${name}`, {
    method: "POST",
    headers: { ...base, "x-realtime-user": String(USER), ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }]
}

describe("call route", () => {
  it("runs a command as the session's user and answers with its result", async () => {
    const { app, calls } = buildApp()

    const response = await app.request(
      ...call("group.create", { name: "Team" }, { "idempotency-key": "key-1" }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ result: { created: true } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      actor: { userId: USER },
      payload: { name: "Team" },
      idempotencyKey: "key-1",
    })
  })

  it("runs a query without an idempotency key", async () => {
    const { app, calls } = buildApp()

    const response = await app.request(...call("group.list", undefined))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ result: { groups: [] } })
    expect(calls).toHaveLength(1)
  })

  it("refuses a call whose page names another user than the session's, and runs nothing", async () => {
    const { app, calls } = buildApp()

    const responses = [
      await app.request(
        ...call("group.create", { name: "Team" }, {
          "idempotency-key": "key-1",
          "x-realtime-user": "8",
        }),
      ),
      await app.request(...call("group.list", undefined, { "x-realtime-user": "8" })),
      await app.request(...call("group.list", undefined, { "x-realtime-user": "" })),
    ]

    for (const response of responses) {
      expect(response.status).toBe(401)
      expect((await apiError(response)).code).toBe("unauthorized")
    }
    expect(calls).toEqual([])
  })

  it("refuses a call without a session as unauthorized", async () => {
    const { app, calls } = buildApp(null)

    const response = await app.request(
      ...call("group.create", { name: "Team" }, { "idempotency-key": "key-1" }),
    )

    expect(response.status).toBe(401)
    expect((await apiError(response)).code).toBe("unauthorized")
    expect(calls).toEqual([])
  })

  it("answers a caller whose cookie is gone as unauthorized, which signs its page out", async () => {
    const { app, calls } = buildApp(null)

    const response = await app.request(
      ...call(
        "group.create",
        { name: "Team" },
        { "idempotency-key": "key-1" },
        sameOriginWithoutCookieHeaders,
      ),
    )

    expect(response.status).toBe(401)
    expect((await apiError(response)).code).toBe("unauthorized")
    expect(calls).toEqual([])
  })

  it("refuses a command without an idempotency key and does not run it", async () => {
    const { app, calls } = buildApp()

    const response = await app.request(...call("group.create", { name: "Team" }))

    expect(response.status).toBe(400)
    expect((await apiError(response)).code).toBe("bad_request")
    expect(calls).toEqual([])
  })

  it("refuses a call from another site before anything runs", async () => {
    const { app, calls } = buildApp()

    const responses = [
      await app.request(
        ...call("group.create", { name: "Team" }, { "idempotency-key": "key-1" }, crossSiteHeaders),
      ),
      await app.request(...call("group.list", undefined, {}, crossSiteHeaders)),
    ]

    for (const response of responses) {
      expect(response.status).toBe(403)
      expect((await apiError(response)).code).toBe("forbidden")
    }
    expect(calls).toEqual([])
  })

  it("answers a domain error with the socket's code and details, and hides any other failure", async () => {
    const failures = [
      new GroupError("ID_ALREADY_EXISTS", "Group id is already in use"),
      new Error("connection to 10.0.0.5 refused"),
    ]
    const { app, logged } = buildApp(undefined, {
      "group.create": { kind: "command", handle: () => Promise.reject(failures.shift()) },
    })
    const send = () =>
      app.request(...call("group.create", { name: "Team" }, { "idempotency-key": "key-1" }))

    const known = await send()
    const unknown = await send()

    expect(known.status).toBe(409)
    expect(await known.json()).toEqual({
      error: {
        code: "conflict",
        message: "Group id is already in use",
        reason: "ID_ALREADY_EXISTS",
        details: { code: "ID_ALREADY_EXISTS" },
      },
    })
    expect(unknown.status).toBe(500)
    expect(await unknown.json()).toEqual({ error: { code: "internal", message: "internal error" } })
    expect(JSON.stringify(logged.map((entry) => entry.map(String)))).toContain("10.0.0.5")
  })
})
