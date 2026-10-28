import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  type MutationCase,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { MALFORMED_JSON, oversizedJson } from "../_testing/json-bodies.ts"
import { apiError } from "../_testing/api-error.ts"
import { createPushNotificationRoute } from "./pushNotification.ts"
import { PUSH_SUBSCRIPTION_LIMITS } from "@spy4x/platform/model"

function buildApp(auth: APIContext["Variables"]["auth"] = buildAuthData()) {
  const calls: string[] = []
  const actors: number[] = []
  const route = createPushNotificationRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    getPublicKey: () => "public-key",
    list: ({ data }) => (actors.push(data.actor.userId), Promise.resolve({ devices: [] })),
    register: ({ data }) => {
      actors.push(data.actor.userId)
      calls.push("subscribe")
      const now = new Date("2026-09-26T10:00:00.000Z")
      return Promise.resolve({
        userPushToken: {
          id: 1,
          userId: data.actor.userId,
          deviceId: data.deviceId,
          createdAt: now,
          updatedAt: now,
        },
      })
    },
    remove: ({ data }) => (
      actors.push(data.actor.userId),
        calls.push("unsubscribe"),
        Promise.resolve({ isSuccess: true as const })
    ),
  })
  return { app: mountRoute("/push", route, auth), calls, actors }
}

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: MutationCase,
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...headers },
    body: JSON.stringify(body),
  })
}

const routes: (MutationCase & { operation: string })[] = [
  {
    method: "POST",
    path: "/push",
    body: {
      deviceId: "device-1",
      subscription: {
        endpoint: "https://push.example/endpoint",
        keys: { auth: "auth-key", p256dh: "p256dh-key" },
      },
    },
    operation: "subscribe",
  },
  { method: "DELETE", path: "/push", body: { deviceId: "device-1" }, operation: "unsubscribe" },
]

describe("push routes", () => {
  for (const route of routes) {
    it(`refuses a cross-site ${route.method} ${route.path} with 403`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
    })

    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(200)
      expect(calls).toEqual([route.operation])
    })

    it(`answers ${route.method} ${route.path} without a session with 401, not 403`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }
})

describe("push routes act for the signed-in user", () => {
  for (const route of routes) {
    it(`dispatches ${route.method} ${route.path} for the session's user`, async () => {
      const { app, actors } = buildApp(buildAuthData({ user: { id: 42 } }))

      await send(app, route, sameOriginHeaders)

      expect(actors).toEqual([42])
    })
  }

  it("lists the devices of the session's user", async () => {
    const { app, actors } = buildApp(buildAuthData({ user: { id: 42 } }))

    const response = await app.request(`${API_URL}/push/devices`, { headers: sameOriginHeaders })

    expect(response.status).toBe(200)
    expect(actors).toEqual([42])
  })
})

describe("push routes cap the JSON body", () => {
  for (const route of routes) {
    for (
      const [name, body, status] of [
        ["an oversized body", oversizedJson(route.body), 413],
        ["malformed JSON", MALFORMED_JSON, 400],
      ] as const
    ) {
      it(`answers ${name} on ${route.method} ${route.path} with ${status}`, async () => {
        const { app, calls } = buildApp()
        const response = await app.request(`${API_URL}${route.path}`, {
          method: route.method,
          headers: { ...sameOriginHeaders },
          body,
        })

        expect(response.status).toBe(status)
        expect(calls).toEqual([])
      })
    }
  }
})

describe("push routes hold the push address to its limit", () => {
  const subscribe = (endpointLength: number) => ({
    method: "POST",
    path: "/push",
    body: {
      deviceId: "device-1",
      subscription: {
        endpoint: "https://push.example/".padEnd(endpointLength, "a"),
        keys: { auth: "auth-key", p256dh: "p256dh-key" },
      },
    },
  })

  it("answers a longer push address with 400 and a message that names the field", async () => {
    const { app, calls } = buildApp()
    const response = await send(
      app,
      subscribe(PUSH_SUBSCRIPTION_LIMITS.endpoint + 1),
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    const error = await apiError(response)
    // The limit is a narrow on the schema, so arktype names its code `predicate`.
    expect(error.fields).toEqual({ "subscription.endpoint": { code: "predicate" } })
    expect(error.message).toContain(
      `subscription.endpoint must be at most ${PUSH_SUBSCRIPTION_LIMITS.endpoint} characters (was`,
    )
    expect(calls).toEqual([])
  })
})
