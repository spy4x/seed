import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type AdminUserRow, UserMFAStatus, UserRole } from "@domain/identity"
import type { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { AdminActionKind, AdminActOutcome, type AdminService } from "@api/services/admin.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { ADMIN_OUTRANKED, ADMIN_SELF, createAdminRoute } from "./admin.ts"

const target: AdminUserRow = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: UserRole.VIEWER,
  blockedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: null,
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  { outcome = AdminActOutcome.Done } = {},
) {
  const calls: unknown[][] = []
  const emitted: UserSignedOutEvent[] = []
  const admin: AdminService = {
    list: (
      filter,
    ) => (calls.push(["list", filter]),
      Promise.resolve({ users: [target], total: 1, page: filter.page, pageSize: 25 })),
    detail: (id) => (calls.push(["detail", id]),
      Promise.resolve(
        id === target.id
          ? { user: target, methods: [], sessions: [], groups: [], audits: [] }
          : null,
      )),
    act: (
      _c,
      actor,
      id,
      action,
    ) => (calls.push(["act", actor.user.id, id, action]),
      Promise.resolve({
        outcome,
        user: outcome === AdminActOutcome.Done ? target : undefined,
      })),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    limit: passThrough,
    admin,
    emit: (event) => emitted.push(event),
  })
  return { app: mountRoute("/admin", route, auth), calls, emitted }
}

/** Every path of the area, and one it does not have. */
const ROUTES = [
  { method: "GET", path: "/admin/users" },
  { method: "GET", path: "/admin/users?q=ada&role=2&blocked=blocked&page=2" },
  { method: "GET", path: "/admin/users/42" },
  { method: "POST", path: "/admin/users/42/block" },
  { method: "POST", path: "/admin/users/42/unblock" },
  { method: "POST", path: "/admin/users/42/sessions/end" },
  { method: "GET", path: "/admin" },
  { method: "GET", path: "/admin/no-such-page" },
  { method: "DELETE", path: "/admin/users/42" },
]

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path }: { method: string; path: string },
  headers: Record<string, string> = sameOriginHeaders,
) {
  // An action carries no body: it asks for no password or code (owner's decision, 2026-10-15).
  return app.request(`${API_URL}${path}`, { method, headers: { ...headers } })
}

describe("operator area routes", () => {
  // A viewer is the only role below operator.
  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and does nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls, emitted } = buildApp(viewer)
      const response = await send(app, route)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
      expect(emitted).toEqual([])
    })
  }

  it("answers 404 to a viewer's cross-site post, telling the area apart from nothing", async () => {
    const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
    const { app, calls } = buildApp(viewer)
    const response = await send(app, ROUTES[3], crossSiteHeaders)

    expect(response.status).toBe(404)
    expect(calls).toEqual([])
  })

  for (const route of ROUTES) {
    it(`answers 401 without a session on ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  it("answers 401 to an operator whose session still owes its authenticator code", async () => {
    const owing = buildAuthData({
      user: { id: 7, role: UserRole.ADMIN, mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Pending },
    })
    const { app, calls } = buildApp(owing)
    const response = await send(app, ROUTES[0])

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("lists people for an operator, with the filter read from the query", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[1])

    expect(response.status).toBe(200)
    expect((await response.json()).users).toEqual([target])
    expect(calls).toEqual([["list", {
      query: "ada",
      role: UserRole.OPERATOR,
      blocked: "blocked",
      page: 2,
    }]])
  })

  it("shows one person to an operator, and 404 for an id that is no user", async () => {
    const { app } = buildApp()
    expect((await send(app, ROUTES[2])).status).toBe(200)
    expect((await send(app, { method: "GET", path: "/admin/users/43" })).status).toBe(404)
    expect((await send(app, { method: "GET", path: "/admin/users/abc" })).status).toBe(404)
  })

  it("answers 404 to an operator on a path the area does not have", async () => {
    const { app } = buildApp()
    expect((await send(app, ROUTES[7])).status).toBe(404)
  })

  it("blocks a person with no password asked, then closes their sockets", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[3])

    expect(response.status).toBe(200)
    expect((await response.json()).user).toEqual(target)
    expect(calls).toEqual([["act", 7, 42, AdminActionKind.Block]])
    expect(emitted.map((event) => event.data.userId)).toEqual([42])
  })

  it("ends a person's sessions, then closes their sockets", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[5])

    expect(response.status).toBe(200)
    expect(calls.at(-1)).toEqual(["act", 7, 42, AdminActionKind.EndSessions])
    expect(emitted.map((event) => event.data.userId)).toEqual([42])
  })

  it("unblocks a person and closes nothing", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[4])

    expect(response.status).toBe(200)
    expect(calls.at(-1)).toEqual(["act", 7, 42, AdminActionKind.Unblock])
    expect(emitted).toEqual([])
  })

  it("refuses an operator's cross-site action with 403 and does nothing", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[3], crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("answers 403 when the service refuses an action on oneself, and closes nothing", async () => {
    const { app, emitted } = buildApp(operator(), { outcome: AdminActOutcome.Self })
    const response = await send(app, ROUTES[3])

    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(ADMIN_SELF)
    expect(emitted).toEqual([])
  })

  it("answers 403 when the person's role is the operator's or higher, and closes nothing", async () => {
    const { app, emitted } = buildApp(operator(), { outcome: AdminActOutcome.Outranked })
    const response = await send(app, ROUTES[5])

    expect(response.status).toBe(403)
    expect((await response.json()).error).toBe(ADMIN_OUTRANKED)
    expect(emitted).toEqual([])
  })

  it("answers 409 to blocking someone already blocked", async () => {
    const { app, emitted } = buildApp(operator(), { outcome: AdminActOutcome.Unchanged })
    expect((await send(app, ROUTES[3])).status).toBe(409)
    expect(emitted).toEqual([])
  })
})
