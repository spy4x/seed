import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import {
  ADMIN_DEFAULT_SORT,
  type AdminStats,
  type AdminUserRow,
  DEFAULT_PREFERENCES,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import type { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { AdminActionKind, AdminActOutcome, type AdminService } from "@api/services/admin.ts"
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
import { ADMIN_OUTRANKED, ADMIN_SELF, createAdminUsersRoutes } from "./users.ts"
import { createAdminStatsRoutes } from "./dashboard.ts"
import { ADMIN_API_MODULES } from "./registry.ts"
import { CATALOG_DEFAULT_SETTINGS } from "@domain/catalog"
import type { AdminModuleContext } from "./module.ts"
import { apiError } from "../../_testing/api-error.ts"

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

const stats: AdminStats = {
  generatedAt: "2026-10-16T09:00:00.000Z",
  people: 12,
  blocked: 1,
  newThisWeek: { current: 3, previous: 2 },
  activeToday: { current: 4, previous: 5 },
  activeThisWeek: { current: 9, previous: 7 },
  groups: 2,
  notes: 30,
  signUpsPerDay: [{ day: "2026-10-16", count: 1 }],
  activePerDay: [{ day: "2026-10-16", count: 4 }],
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
          ? {
            user: target,
            methods: [],
            sessions: [],
            groups: [],
            audits: [],
            trialUsedAt: null,
            preferences: {
              value: DEFAULT_PREFERENCES,
              version: 0,
              updatedAt: null,
              firstTimeZone: null,
              firstLocale: null,
            },
          }
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
    export: () => Promise.reject(new Error("not used")),
  }
  const context = {
    limit: passThrough,
    emit: (event: UserSignedOutEvent) => emitted.push(event),
    now: () => new Date(stats.generatedAt),
    catalog: { on: true, settings: CATALOG_DEFAULT_SETTINGS },
  }
  // The real registry, with the two modules that read data swapped for fakes of their services.
  const modules = ADMIN_API_MODULES.map((module) => {
    switch (module.id) {
      case `users`:
        return createAdminUsersRoutes({
          ...context,
          admin,
          dataExports: () => Promise.resolve([]),
          picture: () => Promise.resolve(null),
          readFile: () => Promise.resolve(null),
        })
      case `dashboard`:
        return createAdminStatsRoutes({
          limit: passThrough,
          stats: () => (calls.push(["stats"]), Promise.resolve(stats)),
        })
      default:
        // The empty modules read nothing, so they never touch the database.
        return module.routes({ ...context, db: null } as unknown as AdminModuleContext)
    }
  })
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules,
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
  { method: "GET", path: "/admin/stats" },
  { method: "GET", path: "/admin/users?sort=name:asc,lastSeenAt:desc" },
  { method: "GET", path: "/admin" },
  { method: "GET", path: "/admin/groups" },
  { method: "GET", path: "/admin/no-such-page" },
  { method: "DELETE", path: "/admin/users/42" },
  { method: "GET", path: "/admin/billing/figures" },
  { method: "GET", path: "/admin/billing/customers?status=all" },
  { method: "GET", path: "/admin/billing/0199f0a0-0000-7000-8000-000000000001" },
  { method: "GET", path: "/admin/billing/0199f0a0-0000-7000-8000-000000000001/payment" },
  { method: "POST", path: "/admin/billing/0199f0a0-0000-7000-8000-000000000001/refund" },
  { method: "GET", path: "/admin/jobs?state=failed" },
  { method: "GET", path: "/admin/jobs/repeating" },
  { method: "GET", path: "/admin/jobs/0199f0a0-0000-7000-8000-000000000002" },
  { method: "POST", path: "/admin/jobs/0199f0a0-0000-7000-8000-000000000002/retry" },
  { method: "POST", path: "/admin/jobs/0199f0a0-0000-7000-8000-000000000002/run-now" },
  { method: "POST", path: "/admin/jobs/0199f0a0-0000-7000-8000-000000000002/cancel" },
  { method: "POST", path: "/admin/jobs/repeating/outbox.cleanup/run-now" },
  { method: "POST", path: "/admin/jobs/retry-failed" },
  { method: "GET", path: "/admin/blog/posts" },
  { method: "POST", path: "/admin/blog/posts/0199f0a0-0000-7000-8000-000000000001/publish" },
  { method: "POST", path: "/admin/blog/preview" },
  { method: "GET", path: "/admin/contact-links" },
  { method: "POST", path: "/admin/contact-links/order" },
  { method: "POST", path: "/admin/contact-links/0199f0a0-0000-7000-8000-000000000001/delete" },
  { method: "GET", path: "/admin/catalog" },
  { method: "POST", path: "/admin/catalog/items" },
  { method: "POST", path: "/admin/catalog/items/0199f0a0-0000-7000-8000-000000000001/status" },
  { method: "POST", path: "/admin/catalog/items/0199f0a0-0000-7000-8000-000000000001/photos" },
  { method: "GET", path: "/admin/catalog/photos/0199f0a0-0000-7000-8000-000000000001/thumbnail" },
  { method: "GET", path: "/admin/catalog/photos/0199f0a0-0000-7000-8000-000000000001/full" },
  { method: "POST", path: "/admin/catalog/categories/order" },
  { method: "GET", path: "/admin/groups/0199f0a0-0000-7000-8000-000000000001/files" },
  {
    method: "POST",
    path:
      "/admin/groups/0199f0a0-0000-7000-8000-000000000001/files/0199f0a0-0000-7000-8000-000000000002/remove",
  },
  ...[`thumbnail`, `open`, `download`].map((access) => ({
    method: "GET",
    path:
      `/admin/groups/0199f0a0-0000-7000-8000-000000000001/files/0199f0a0-0000-7000-8000-000000000002/${access}`,
  })),
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
      sort: ADMIN_DEFAULT_SORT,
      page: 2,
    }]])
  })

  it("passes the list's sort from the query to the service, most significant rule first", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[7])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["list", {
      query: "",
      role: null,
      blocked: "any",
      sort: [{ key: "name", direction: "asc" }, { key: "lastSeenAt", direction: "desc" }],
      page: 1,
    }]])
  })

  it("answers the dashboard's numbers to an operator", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, ROUTES[6])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(stats)
    expect(calls).toEqual([["stats"]])
  })

  it("registers every module once, in the sidebar's order", () => {
    expect(ADMIN_API_MODULES.map((module) => module.id)).toEqual([
      "dashboard",
      "users",
      "groups",
      "billing",
      "newsletter",
      "blog",
      "contact-links",
      "catalog",
      "audit",
      "jobs",
      "system",
      "api-tokens",
    ])
  })

  it("shows one person to an operator, and 404 for an id that is no user", async () => {
    const { app } = buildApp()
    expect((await send(app, ROUTES[2])).status).toBe(200)
    expect((await send(app, { method: "GET", path: "/admin/users/43" })).status).toBe(404)
    expect((await send(app, { method: "GET", path: "/admin/users/abc" })).status).toBe(404)
  })

  it("answers 404 to an operator on a path the area does not have", async () => {
    const { app } = buildApp()
    expect((await send(app, ROUTES[8])).status).toBe(404)
    expect((await send(app, ROUTES[10])).status).toBe(404)
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
    expect((await apiError(response)).message).toBe(ADMIN_SELF)
    expect(emitted).toEqual([])
  })

  it("answers 403 when the person's role is the operator's or higher, and closes nothing", async () => {
    const { app, emitted } = buildApp(operator(), { outcome: AdminActOutcome.Outranked })
    const response = await send(app, ROUTES[5])

    expect(response.status).toBe(403)
    expect((await apiError(response)).message).toBe(ADMIN_OUTRANKED)
    expect(emitted).toEqual([])
  })

  it("answers 409 to blocking someone already blocked", async () => {
    const { app, emitted } = buildApp(operator(), { outcome: AdminActOutcome.Unchanged })
    expect((await send(app, ROUTES[3])).status).toBe(409)
    expect(emitted).toEqual([])
  })
})
