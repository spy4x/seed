import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { type AdminUserFilter, type AdminUserRow, UserRole } from "@domain/identity"
import type { UserSignedOutEvent } from "@api/cqrs/events.ts"
import {
  type AdminActInput,
  AdminActionKind,
  AdminActOutcome,
  type AdminService,
} from "@api/services/admin.ts"
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
  ADMIN_EXPORT_CROSS_SITE,
  ADMIN_NO_PASSWORD,
  ADMIN_NO_PICTURE,
  ADMIN_NOT_ADMINISTRATOR,
  ADMIN_ROLE_TOO_HIGH,
  ADMIN_SAME_ROLE,
  ADMIN_SESSION_NOT_FOUND,
  ADMIN_TOO_MANY_RESETS,
  createAdminUsersRoutes,
} from "./users.ts"
import { apiError } from "../../_testing/api-error.ts"

/**
 * The people actions of #425 behind the real operator gate: one session, a role, a reset link and
 * the CSV export. The service is a fake; what it decides is tested against Postgres in
 * `tests/integration/admin-users.integration.test.ts`.
 */

const person: AdminUserRow = {
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

const administrator = () => buildAuthData({ user: { id: 7, role: UserRole.ADMIN } })

function buildApp(
  auth: APIContext["Variables"]["auth"] = administrator(),
  {
    outcome = AdminActOutcome.Done,
    retryAfterMs = undefined as number | undefined,
    rows = [[person]] as AdminUserRow[][],
    exportError = undefined as Error | undefined,
    pictures = new Map<string, { contentType: string; bytes: Uint8Array }>(),
  } = {},
) {
  const calls: unknown[][] = []
  const emitted: UserSignedOutEvent[] = []
  const admin: AdminService = {
    list: () => Promise.reject(new Error("not used")),
    detail: () => Promise.resolve(null),
    act: (_c, actor, id, action, input?: AdminActInput) => (
      calls.push(["act", actor.user.id, id, action, input]),
        Promise.resolve({
          outcome,
          retryAfterMs,
          user: outcome === AdminActOutcome.Done ? person : undefined,
        })
    ),
    export: (_c, actor, filter: AdminUserFilter) => {
      calls.push(["export", actor.user.id, filter])
      return Promise.resolve((async function* () {
        // The database refuses the first read, after the audit row is written.
        if (exportError) throw exportError
        for (const batch of rows) yield batch
      })())
    },
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminUsersRoutes({
        limit: passThrough,
        admin,
        emit: (event) => emitted.push(event),
        now: () => new Date("2026-10-16T09:00:00.000Z"),
        dataExports: (userId) => (calls.push(["dataExports", userId]), Promise.resolve([])),
        picture: (id) => {
          const stored = pictures.get(id)
          return Promise.resolve(stored ? { id, contentType: stored.contentType } : null)
        },
        readFile: (key) =>
          Promise.resolve(pictures.get(key.replace(/^pictures\//, ""))?.bytes ?? null),
      }),
    ],
  })
  return { app: mountRoute("/admin", route, auth), calls, emitted }
}

const PICTURE = "0190a000-0000-7000-8000-0000000000a1"
/** A WebP's first bytes, as the store would answer them. */
const PICTURE_BYTES = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])

/** Every path #425 adds, and the profile picture's (#228). */
const ROUTES = [
  { method: "POST", path: "/admin/users/42/sessions/9/end" },
  { method: "POST", path: "/admin/users/42/role", body: { role: UserRole.OPERATOR } },
  { method: "POST", path: "/admin/users/42/password-reset" },
  { method: "GET", path: "/admin/users/export.csv?q=ada" },
  { method: "GET", path: "/admin/users/42/data-exports" },
  { method: "POST", path: "/admin/users/42/picture/remove" },
  { method: "GET", path: `/admin/users/pictures/${PICTURE}` },
]

function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: { method: string; path: string; body?: unknown },
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("the people actions of the operator area", () => {
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

  for (const route of ROUTES) {
    it(`answers 401 without a session on ${route.method} ${route.path}`, async () => {
      const { app, calls, emitted } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
      expect(emitted).toEqual([])
    })
  }

  for (const route of ROUTES.filter((route) => route.method === "POST")) {
    it(`refuses a cross-site ${route.path} with 403 and does nothing`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
    })
  }

  it("lists the person's data exports, and answers 404 for an id that is no number", async () => {
    const { app, calls } = buildApp()
    const listed = await send(app, { method: "GET", path: "/admin/users/42/data-exports" })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ exports: [] })
    const bad = await send(app, { method: "GET", path: "/admin/users/abc/data-exports" })
    expect(bad.status).toBe(404)
    expect(calls).toEqual([["dataExports", 42]])
  })

  it("ends one session of the person, then closes their sockets", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[0])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["act", 7, 42, AdminActionKind.EndSession, { sessionId: 9 }]])
    expect(emitted.map((event) => event.data.userId)).toEqual([42])
  })

  it("answers 404 for a session id that is no number, and for one the person does not have", async () => {
    const { app, calls } = buildApp()
    const bad = await send(app, { method: "POST", path: "/admin/users/42/sessions/x/end" })
    expect(bad.status).toBe(404)
    expect(calls).toEqual([])

    const missing = buildApp(administrator(), { outcome: AdminActOutcome.SessionNotFound })
    const response = await send(missing.app, ROUTES[0])
    expect(response.status).toBe(404)
    expect((await apiError(response)).message).toBe(ADMIN_SESSION_NOT_FOUND)
    expect(missing.emitted).toEqual([])
  })

  it("passes a valid role to the service and closes no socket", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[1])

    expect(response.status).toBe(200)
    expect((await response.json()).user).toEqual(person)
    expect(calls).toEqual([["act", 7, 42, AdminActionKind.ChangeRole, { role: UserRole.OPERATOR }]])
    expect(emitted).toEqual([])
  })

  it("refuses a role that is no role's number with 400, before the service", async () => {
    const { app, calls } = buildApp()
    for (const body of [{ role: 5 }, { role: "operator" }, { role: "2" }, {}, { role: 0 }]) {
      const response = await send(app, { method: "POST", path: "/admin/users/42/role", body })
      expect([body, response.status]).toEqual([body, 400])
    }
    expect(calls).toEqual([])
  })

  it("answers each refusal of a role change with its own status and message", async () => {
    const cases = [
      [AdminActOutcome.NotAdministrator, 403, ADMIN_NOT_ADMINISTRATOR],
      [AdminActOutcome.RoleTooHigh, 403, ADMIN_ROLE_TOO_HIGH],
      [AdminActOutcome.Unchanged, 409, ADMIN_SAME_ROLE],
    ] as const
    for (const [outcome, status, error] of cases) {
      const { app } = buildApp(administrator(), { outcome })
      const response = await send(app, ROUTES[1])
      expect([outcome, response.status, (await apiError(response)).message]).toEqual([
        outcome,
        status,
        error,
      ])
    }
  })

  it("removes the person's profile picture through the service and closes no socket", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[5])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["act", 7, 42, AdminActionKind.RemovePicture, undefined]])
    expect(emitted).toEqual([])
  })

  it("answers 409 to a picture removal for someone with no picture", async () => {
    const { app } = buildApp(administrator(), { outcome: AdminActOutcome.Unchanged })
    const response = await send(app, ROUTES[5])

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({ code: `conflict`, message: ADMIN_NO_PICTURE })
  })

  it("answers a picture's bytes as its type, never as a page, and 404 for one that is not there", async () => {
    const pictures = new Map([[PICTURE, { contentType: "image/webp", bytes: PICTURE_BYTES }]])
    const { app } = buildApp(administrator(), { pictures })
    const response = await send(app, ROUTES[6])

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PICTURE_BYTES)
    expect(response.headers.get("content-type")).toBe("image/webp")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'")
    for (const id of ["0190a000-0000-7000-8000-0000000000a2", "abc"]) {
      const missing = await send(app, { method: "GET", path: `/admin/users/pictures/${id}` })
      expect([id, missing.status]).toEqual([id, 404])
    }
  })

  it("sends a reset link through the service and closes no socket", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, ROUTES[2])

    expect(response.status).toBe(200)
    expect(calls).toEqual([["act", 7, 42, AdminActionKind.SendPasswordReset, undefined]])
    expect(emitted).toEqual([])
  })

  it("answers 409 to a reset for someone with no password address", async () => {
    const { app } = buildApp(administrator(), { outcome: AdminActOutcome.NoPassword })
    const response = await send(app, ROUTES[2])

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(ADMIN_NO_PASSWORD)
  })

  it("answers 429 with Retry-After when the address has had its reset links for now", async () => {
    const { app } = buildApp(administrator(), {
      outcome: AdminActOutcome.TooManyResets,
      retryAfterMs: 61_500,
    })
    const response = await send(app, ROUTES[2])

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("62")
    expect((await apiError(response)).message).toBe(ADMIN_TOO_MANY_RESETS)
  })

  it("answers 500, not a file of headers only, when the export's first read fails", async () => {
    const { app } = buildApp(administrator(), { exportError: new Error("database gone") })
    const response = await send(app, ROUTES[3])

    expect(response.status).toBe(500)
    expect(response.headers.get("content-disposition")).toBeNull()
  })

  it("exports the filtered rows of every batch as a CSV download, every page and no secret", async () => {
    const grace = { ...person, id: 43, firstName: "Grace", lastName: "Hopper", email: null }
    const { app, calls } = buildApp(administrator(), { rows: [[person], [grace]] })
    const response = await send(app, {
      method: "GET",
      path: "/admin/users/export.csv?q=ada&role=1&blocked=active&page=3",
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="users-2026-10-16.csv"`,
    )
    expect(calls).toEqual([["export", 7, {
      query: "ada",
      role: UserRole.VIEWER,
      blocked: "active",
      sort: [{ key: "createdAt", direction: "desc" }],
      page: 3,
    }]])
    const bytes = new Uint8Array(await response.arrayBuffer())
    // The UTF-8 byte-order mark first, which tells Excel the file is UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes)).toBe(
      "ID,First name,Last name,Address,Role,Status,Created,Last seen,Blocked at\r\n" +
        "42,Ada,Lovelace,ada@example.com,viewer,active,2026-10-01T10:00:00.000Z,,\r\n" +
        "43,Grace,Hopper,,viewer,active,2026-10-01T10:00:00.000Z,,\r\n",
    )
  })

  it("refuses an export another site starts, or one with no Sec-Fetch-Site, before it is audited", async () => {
    const { "sec-fetch-site": _, ...noFetchSite } = sameOriginHeaders
    for (const headers of [crossSiteHeaders, noFetchSite]) {
      const { app, calls } = buildApp()
      const response = await send(app, ROUTES[3], headers)

      expect(response.status).toBe(403)
      expect((await apiError(response)).message).toBe(ADMIN_EXPORT_CROSS_SITE)
      // The service writes the audit row, so no call means no row.
      expect(calls).toEqual([])
    }
  })

  it("keeps the export out of every cache", async () => {
    const { app } = buildApp()
    const response = await send(app, ROUTES[3])

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await response.body?.cancel()
  })

  it("writes a cell that would open as a formula as text, with a quote before it", async () => {
    const attacker = {
      ...person,
      firstName: '=HYPERLINK("http://x.test")',
      lastName: "+1",
      email: "@evil",
    }
    const { app } = buildApp(administrator(), { rows: [[attacker, { ...person, lastName: "-2" }]] })
    const lines = (await (await send(app, ROUTES[3])).text()).split("\r\n")

    expect(lines[1]).toBe(
      `42,"'=HYPERLINK(""http://x.test"")",'+1,'@evil,viewer,active,2026-10-01T10:00:00.000Z,,`,
    )
    expect(lines[2]).toBe(`42,Ada,'-2,ada@example.com,viewer,active,2026-10-01T10:00:00.000Z,,`)
  })
})
