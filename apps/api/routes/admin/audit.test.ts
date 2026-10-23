import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import {
  ADMIN_AUDIT_EXPORT_MAX,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_AUDIT_PAGE_SIZE,
  type AdminAuditEntry,
  type AdminAuditFilter,
  UserRole,
} from "@domain/identity"
import { BILLING_AUDIT_EVENT_TYPES } from "@domain/billing"
import type { AdminAuditPageKey } from "@server/auth/admin-audit.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_AUDIT_BAD_CURSOR,
  auditEventName,
  createAdminAuditCursor,
  createAdminAuditRoutes,
} from "./audit.ts"
import { ADMIN_EXPORT_CROSS_SITE } from "./users.ts"
import { apiError } from "../../_testing/api-error.ts"

const SECRET = "test-only-cursor-secret-0123456789abcdef"
const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const entry: AdminAuditEntry = {
  key: "account-12",
  source: "account",
  event: "account:2",
  at: "2026-10-16T09:00:00.000Z",
  person: { id: 42, name: "Ada Lovelace", email: "ada@example.com" },
  actor: { id: 42, name: "Ada Lovelace", email: "ada@example.com" },
  byOperator: false,
  group: null,
  identifier: "ada@example.com",
  ip: "192.0.2.10",
  userAgent: "Firefox",
  jobKind: null,
}

const nextKey: AdminAuditPageKey = {
  at: "2026-10-16T08:59:59.123456Z",
  source: "account",
  id: "11",
}

function buildApp(
  {
    role = UserRole.OPERATOR,
    userId = 7,
    entries = [entry],
    next = nextKey as AdminAuditPageKey | null,
    signedIn = true,
  } = {},
) {
  const calls: unknown[][] = []
  const route = createAdminAuditRoutes({
    limit: passThrough,
    now: () => new Date("2026-10-16T09:30:00.000Z"),
    cursor: createAdminAuditCursor(SECRET),
    audit: {
      list: (filter: AdminAuditFilter, limit: number, after: AdminAuditPageKey | null) => (
        calls.push(["list", filter, limit, after]), Promise.resolve({ entries, next })
      ),
      operators:
        () => (calls.push(["operators"]),
          Promise.resolve([{ id: 7, name: "Grace Hopper", email: "grace@example.com" }])),
      recordExport: (operatorId, rows, requestId) => (
        calls.push(["recordExport", operatorId, rows, requestId]), Promise.resolve()
      ),
    },
  })
  const app = mountRoute(
    "/admin",
    createAdminRoute({
      auth: testSessionGuards(),
      mutationGuards: testMutationGuards,
      modules: [route],
    }),
    signedIn ? buildAuthData({ user: { id: userId, role } }) : null,
  )
  return { app, calls }
}

function get(
  app: ReturnType<typeof buildApp>["app"],
  path: string,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin${path}`, { headers: { ...headers } })
}

describe("audit log routes", () => {
  for (
    const path of [
      "/audit",
      "/audit?event=account:2&cursor=x",
      "/audit/operators",
      "/audit/export.csv",
    ]
  ) {
    it(`answers 404 to a viewer on GET ${path} and reads nothing`, async () => {
      const { app, calls } = buildApp({ role: UserRole.VIEWER })
      const response = await get(app, path)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers 401 without a session on GET ${path} and reads nothing`, async () => {
      const { app, calls } = buildApp({ signedIn: false })
      const response = await get(app, path, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  it("lists the first page with the filter read from the query and a cursor for the next", async () => {
    const { app, calls } = buildApp()
    const response = await get(
      app,
      "/audit?event=account:16&person=ada&operator=7&from=2026-10-01&to=2026-10-16&ip=192.0.2",
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.entries).toEqual([entry])
    expect(typeof body.next).toBe("string")
    expect(calls).toEqual([[
      "list",
      {
        event: "account:16",
        person: "ada",
        operator: 7,
        from: "2026-10-01",
        to: "2026-10-16",
        ip: "192.0.2",
      },
      ADMIN_AUDIT_PAGE_SIZE,
      null,
    ]])
  })

  it("reads the next page from the key its cursor carries", async () => {
    const { app, calls } = buildApp()
    const first = await (await get(app, "/audit?person=ada")).json()
    const response = await get(app, `/audit?person=ada&cursor=${encodeURIComponent(first.next)}`)

    expect(response.status).toBe(200)
    expect(calls[1]).toEqual(["list", { ...ADMIN_AUDIT_NO_FILTER, person: "ada" }, 50, nextKey])
  })

  it("answers next null on the oldest page", async () => {
    const { app } = buildApp({ next: null })
    expect((await (await get(app, "/audit")).json()).next).toBeNull()
  })

  it("refuses a cursor under another filter than the one it was issued for", async () => {
    const { app, calls } = buildApp()
    const first = await (await get(app, "/audit?person=ada")).json()
    const response = await get(app, `/audit?person=bob&cursor=${encodeURIComponent(first.next)}`)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(ADMIN_AUDIT_BAD_CURSOR)
    expect(calls).toHaveLength(1)
  })

  it("refuses a cursor that another operator was given", async () => {
    const mine = buildApp({ userId: 7 })
    const first = await (await get(mine.app, "/audit")).json()
    const theirs = buildApp({ userId: 8 })
    const response = await get(theirs.app, `/audit?cursor=${encodeURIComponent(first.next)}`)

    expect(response.status).toBe(400)
    expect(theirs.calls).toEqual([])
  })

  it("refuses an altered cursor", async () => {
    const { app } = buildApp()
    const first = await (await get(app, "/audit")).json()
    const altered = `${first.next.slice(0, -2)}${first.next.endsWith("A") ? "B" : "A"}A`
    const response = await get(app, `/audit?cursor=${encodeURIComponent(altered)}`)

    expect(response.status).toBe(400)
  })

  it("lists the operators for the filter", async () => {
    const { app } = buildApp()
    const response = await get(app, "/audit/operators")

    expect(response.status).toBe(200)
    expect((await response.json()).operators).toEqual([
      { id: 7, name: "Grace Hopper", email: "grace@example.com" },
    ])
  })

  it("exports the filtered log as a CSV file and records who downloaded it", async () => {
    const { app, calls } = buildApp()
    const response = await get(app, "/audit/export.csv?event=account:2")

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8")
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="audit-log-2026-10-16.csv"`,
    )
    expect(response.headers.get("cache-control")).toBe("no-store")
    const text = (await response.text()).replace(/^﻿/, "")
    const [header, row] = text.split("\r\n")
    expect(header.startsWith("Time (UTC),Event,Person id,Person")).toBe(true)
    expect(row).toBe(
      "2026-10-16T09:00:00.000Z,signed_in,42,Ada Lovelace,ada@example.com,42,Ada Lovelace,no,," +
        "ada@example.com,192.0.2.10,Firefox,",
    )
    expect(calls).toEqual([
      ["list", { ...ADMIN_AUDIT_NO_FILTER, event: "account:2" }, ADMIN_AUDIT_EXPORT_MAX, null],
      ["recordExport", 7, 1, "req-test-1"],
    ])
  })

  for (
    const [name, headers] of [
      ["a link on another site", {
        cookie: sameOriginHeaders.cookie,
        "sec-fetch-site": "cross-site",
        "sec-fetch-mode": "navigate",
      }],
      ["a page on a sibling subdomain", {
        cookie: sameOriginHeaders.cookie,
        "sec-fetch-site": "same-site",
        "sec-fetch-mode": "navigate",
      }],
      ["a request with no Sec-Fetch-Site", { cookie: sameOriginHeaders.cookie }],
    ] as const
  ) {
    it(`refuses an export started by ${name} before it reads or records anything`, async () => {
      const { app, calls } = buildApp()
      const response = await app.request(`${API_URL}/admin/audit/export.csv`, { headers })

      expect(response.status).toBe(403)
      expect((await apiError(response)).message).toBe(ADMIN_EXPORT_CROSS_SITE)
      // The service lists and writes the audit row, so no call means no read and no export row.
      expect(calls).toEqual([])
    })
  }

  it("guards every text cell of the export against spreadsheet formulas", async () => {
    const { app } = buildApp({
      entries: [{
        ...entry,
        person: { id: 42, name: '=HYPERLINK("http://evil.example")', email: null },
        identifier: "+cmd|' /C calc'!A0",
        userAgent: "@SUM(1+1)",
      }],
    })
    const text = (await (await get(app, "/audit/export.csv")).text()).replace(/^﻿/, "")
    const row = text.split("\r\n")[1]

    expect(row).not.toMatch(/(^|,)[=+\-@]/)
    expect(row).toContain(`'=HYPERLINK`)
    expect(row).toContain(`'+cmd`)
    expect(row).toContain(`'@SUM`)
  })
})

describe("auditEventName", () => {
  it("names a person's event after its type and group activity after its kind", () => {
    expect(auditEventName("account:2")).toBe("signed_in")
    expect(auditEventName("account:16")).toBe("user_blocked")
    expect(auditEventName("activity:note.created")).toBe("note.created")
  })

  it("names every billing event after its key, never by its number", () => {
    expect(BILLING_AUDIT_EVENT_TYPES.map((type) => auditEventName(`account:${type}`))).toEqual([
      "payment_refunded",
      "time_given",
      "cancelled_at_period_end",
      "cancelled_now",
      "cancellation_undone",
    ])
  })
})
