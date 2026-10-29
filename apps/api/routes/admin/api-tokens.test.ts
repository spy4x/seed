import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import { type AdminApiToken, ApiTokenAccess } from "@domain/api-tokens"
import type { PushDevicesUpdatedEvent, UserSignedOutEvent } from "@api/cqrs/events.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_DEVICE_NOT_FOUND,
  ADMIN_TOKEN_ALREADY_REVOKED,
  ADMIN_TOKEN_NOT_FOUND,
  AdminApiTokensOutcome,
  type AdminApiTokensService,
  createAdminApiTokensRoutes,
} from "./api-tokens.ts"
import { ADMIN_OUTRANKED, ADMIN_SELF, ADMIN_USER_NOT_FOUND } from "./users.ts"
import { ADMIN_API_MODULES } from "./registry.ts"
import { CATALOG_DEFAULT_SETTINGS } from "@domain/catalog"
import type { AdminModuleContext } from "./module.ts"
import { apiError } from "../../_testing/api-error.ts"

const TOKEN_ID = "01920000-0000-7000-8000-000000000001"

const token: AdminApiToken = {
  id: TOKEN_ID,
  name: "CI",
  groupId: "01920000-0000-7000-8000-0000000000aa",
  groupName: "Family",
  access: ApiTokenAccess.WRITE,
  state: "live",
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  owner: { id: 42, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/** The whole operator area, with this module's service faked and every call to it recorded. */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  { outcome = AdminApiTokensOutcome.Done, person = true } = {},
) {
  const calls: unknown[][] = []
  const emitted: (PushDevicesUpdatedEvent | UserSignedOutEvent)[] = []
  const service: AdminApiTokensService = {
    list: (filter) => (calls.push(["list", filter]),
      Promise.resolve({
        tokens: [token],
        total: 1,
        page: filter.page,
        pageSize: 25,
        counts: { live: 1, expired: 0, revoked: 0 },
      })),
    userTokens: (
      id,
    ) => (calls.push(["userTokens", id]), Promise.resolve(person ? { tokens: [token] } : null)),
    devices: (
      id,
    ) => (calls.push(["devices", id]), Promise.resolve(person ? { devices: [] } : null)),
    notifications: (
      id,
    ) => (calls.push(["notifications", id]),
      Promise.resolve(person ? { notifications: [], total: 0, unread: 0 } : null)),
    revoke: (
      _c,
      actor,
      id,
    ) => (calls.push(["revoke", actor.user.id, id]), Promise.resolve(outcome)),
    removeDevice: (_c, actor, userId, deviceId) => (
      calls.push(["removeDevice", actor.user.id, userId, deviceId]),
        Promise.resolve({
          outcome,
          devices: outcome === AdminApiTokensOutcome.Done ? [] : undefined,
        })
    ),
  }
  const context = {
    limit: passThrough,
    emit: (event: PushDevicesUpdatedEvent | UserSignedOutEvent) => emitted.push(event),
    now: () => new Date("2026-10-16T09:00:00.000Z"),
    catalog: { on: true, settings: CATALOG_DEFAULT_SETTINGS },
    websiteStats: { setup: null, missing: [], itemPath: `/{slug}` },
  }
  // The real registry, with this module's service faked; the other modules never reach a database
  // in these requests.
  const modules = ADMIN_API_MODULES.map((module) =>
    module.id === `api-tokens`
      ? createAdminApiTokensRoutes({ ...context, service })
      : module.routes({ ...context, db: null } as unknown as AdminModuleContext)
  )
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules,
  })
  return { app: mountRoute("/admin", route, auth), calls, emitted }
}

/** Every path of the module. */
const ROUTES = [
  { method: "GET", path: "/admin/api-tokens" },
  { method: "GET", path: "/admin/api-tokens?state=revoked&page=2" },
  { method: "POST", path: `/admin/api-tokens/${TOKEN_ID}/revoke` },
  { method: "GET", path: "/admin/users/42/api-tokens" },
  { method: "GET", path: "/admin/users/42/devices" },
  { method: "GET", path: "/admin/users/42/notifications" },
  { method: "POST", path: "/admin/users/42/devices/5/remove" },
]

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path }: { method: string; path: string },
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}${path}`, { method, headers: { ...headers } })
}

describe("the api-tokens module's routes", () => {
  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and does nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls, emitted } = buildApp(viewer)
      const response = await send(app, route)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
      expect(emitted).toEqual([])
    })

    it(`answers 401 without a session on ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  it("lists every token with the state and page read from the query", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[1])

    expect(response.status).toBe(200)
    expect((await response.json()).tokens).toEqual([token])
    expect(calls).toEqual([["list", { state: "revoked", page: 2 }]])
  })

  it("reads a state it does not know as every token, on page 1", async () => {
    const { app, calls } = buildApp()
    await send(app, { method: "GET", path: "/admin/api-tokens?state=stolen&page=-3" })

    expect(calls).toEqual([["list", { state: null, page: 1 }]])
  })

  it("answers one person's tokens, devices and notifications", async () => {
    const { app, calls } = buildApp()
    for (const route of ROUTES.slice(3, 6)) expect((await send(app, route)).status).toBe(200)

    expect(calls).toEqual([["userTokens", 42], ["devices", 42], ["notifications", 42]])
  })

  it("answers 404 for a person who is not there, or an id that is no user id", async () => {
    const { app, calls } = buildApp(operator(), { person: false })
    for (const route of ROUTES.slice(3, 6)) {
      const response = await send(app, route)
      expect(response.status).toBe(404)
      expect((await apiError(response)).message).toBe(ADMIN_USER_NOT_FOUND)
    }
    const bad = await send(app, { method: "GET", path: "/admin/users/abc/devices" })
    expect(bad.status).toBe(404)
    expect(calls.length).toBe(3)
  })

  it("revokes a token on behalf of the signed-in operator", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[2])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["revoke", 7, TOKEN_ID]])
  })

  it("answers 404 to a revoke of an id that is no UUID, without asking the service", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, { method: "POST", path: "/admin/api-tokens/42/revoke" })

    expect(response.status).toBe(404)
    expect((await apiError(response)).message).toBe(ADMIN_TOKEN_NOT_FOUND)
    expect(calls).toEqual([])
  })

  const refusals = [
    { outcome: AdminApiTokensOutcome.UserNotFound, status: 404, error: ADMIN_TOKEN_NOT_FOUND },
    { outcome: AdminApiTokensOutcome.Self, status: 403, error: ADMIN_SELF },
    { outcome: AdminApiTokensOutcome.Outranked, status: 403, error: ADMIN_OUTRANKED },
    { outcome: AdminApiTokensOutcome.Unchanged, status: 409, error: ADMIN_TOKEN_ALREADY_REVOKED },
  ]
  for (const { outcome, status, error } of refusals) {
    it(`answers ${status} "${error}" when the service refuses a revoke`, async () => {
      const { app } = buildApp(operator(), { outcome })
      const response = await send(app, ROUTES[2])

      expect(response.status).toBe(status)
      expect((await apiError(response)).message).toBe(error)
    })
  }

  it("removes a device, then tells the person's open tabs their devices changed", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[6])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["removeDevice", 7, 42, 5]])
    expect(emitted.map((event) => [event.constructor.name, event.data.userId])).toEqual([
      ["PushDevicesUpdatedEvent", 42],
    ])
  })

  const deviceRefusals = [
    { outcome: AdminApiTokensOutcome.UserNotFound, status: 404, error: ADMIN_USER_NOT_FOUND },
    { outcome: AdminApiTokensOutcome.Self, status: 403, error: ADMIN_SELF },
    { outcome: AdminApiTokensOutcome.Outranked, status: 403, error: ADMIN_OUTRANKED },
    { outcome: AdminApiTokensOutcome.Unchanged, status: 404, error: ADMIN_DEVICE_NOT_FOUND },
  ]
  for (const { outcome, status, error } of deviceRefusals) {
    it(`answers ${status} "${error}" to a refused device removal and tells no tab`, async () => {
      const { app, emitted } = buildApp(operator(), { outcome })
      const response = await send(app, ROUTES[6])

      expect(response.status).toBe(status)
      expect((await apiError(response)).message).toBe(error)
      expect(emitted).toEqual([])
    })
  }

  it("refuses an operator's cross-site revoke or removal with 403 and does nothing", async () => {
    const { app, calls, emitted } = buildApp()
    expect((await send(app, ROUTES[2], crossSiteHeaders)).status).toBe(403)
    expect((await send(app, ROUTES[6], crossSiteHeaders)).status).toBe(403)

    expect(calls).toEqual([])
    expect(emitted).toEqual([])
  })
})
