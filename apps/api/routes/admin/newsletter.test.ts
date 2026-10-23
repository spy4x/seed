import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type AuthAuditBase, AuthAuditEventType, UserMFAStatus, UserRole } from "@domain/identity"
import type {
  AdminNewsletterSend,
  AdminNewsletterStats,
  AdminSubscriberRow,
} from "@domain/subscribers"
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
import { ADMIN_API_MODULES } from "./registry.ts"
import {
  type AdminNewsletterService,
  createAdminNewsletterRoutes,
  NEWSLETTER_ALREADY_CONFIRMED,
  NEWSLETTER_INVALID_ADDRESS,
  NEWSLETTER_INVALID_SEARCH,
  NEWSLETTER_NOT_LISTED,
  NEWSLETTER_OFF,
} from "./newsletter.ts"
import { apiError } from "../../_testing/api-error.ts"

const confirmed: AdminSubscriberRow = {
  email: `ada@example.com`,
  status: `confirmed`,
  requestedAt: null,
  confirmedAt: `2026-10-01T10:00:00.000Z`,
}
const pending: AdminSubscriberRow = {
  email: `bob@example.com`,
  status: `pending`,
  requestedAt: `2026-10-15T10:00:00.000Z`,
  confirmedAt: null,
}
/** An address a spreadsheet would run as a formula if the CSV did not guard it. */
const formula: AdminSubscriberRow = {
  email: `=HYPERLINK("http://evil.example")@example.com`,
  status: `confirmed`,
  requestedAt: null,
  confirmedAt: `2026-10-02T10:00:00.000Z`,
}

const stats: AdminNewsletterStats = {
  generatedAt: `2026-10-16T09:00:00.000Z`,
  confirmed: 2,
  pending: 1,
  joined: { current: 2, previous: 0 },
  subscribersPerDay: [{ day: `2026-10-16`, count: 2 }],
  issues: 1,
}

const send: AdminNewsletterSend = {
  issue: `2026-10-issue`,
  subject: `October`,
  startedAt: `2026-10-10T08:00:00.000Z`,
  completedAt: `2026-10-10T08:01:00.000Z`,
  recipients: 2,
  sent: 1,
  failed: 1,
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/** The operator area with the newsletter module over a fake service that records every call. */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  { enabled = true, rows = [confirmed, pending], removeFails = false } = {},
) {
  const calls: unknown[][] = []
  const audits: AuthAuditBase[] = []
  const newsletter: AdminNewsletterService = {
    enabled,
    stats: () => (calls.push([`stats`]), Promise.resolve(stats)),
    list: (
      filter,
    ) => (calls.push([`list`, filter]),
      Promise.resolve({ subscribers: rows, total: rows.length, page: filter.page, pageSize: 25 })),
    sends: () => (calls.push([`sends`]), Promise.resolve({ sends: [send] })),
    find: (
      email,
    ) => (calls.push([`find`, email]),
      Promise.resolve(rows.find((row) => row.email === email) ?? null)),
    all: () => (calls.push([`all`]), Promise.resolve(rows)),
    remove: (
      email,
    ) => (calls.push([`remove`, email]),
      removeFails ? Promise.reject(new Error(`database is down`)) : Promise.resolve()),
    resend: (email) => (calls.push([`resend`, email]), Promise.resolve()),
    audit: (row) => (audits.push(row), Promise.resolve()),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminNewsletterRoutes({
        limit: passThrough,
        newsletter,
        list: `news`,
        now: () => new Date(stats.generatedAt),
      }),
    ],
  })
  return { app: mountRoute(`/admin`, route, auth), calls, audits }
}

const ACTION_BODY = JSON.stringify({ email: pending.email })
const SEARCH_BODY = JSON.stringify({ q: `ada`, status: `pending`, page: `2` })

/** Every path of the newsletter module. */
const ROUTES = [
  { method: `GET`, path: `/admin/newsletter/stats` },
  { method: `POST`, path: `/admin/newsletter/subscribers/search`, body: SEARCH_BODY },
  { method: `GET`, path: `/admin/newsletter/sends` },
  { method: `POST`, path: `/admin/newsletter/subscribers/remove`, body: ACTION_BODY },
  { method: `POST`, path: `/admin/newsletter/subscribers/resend`, body: ACTION_BODY },
  { method: `POST`, path: `/admin/newsletter/subscribers/export` },
]

function request(
  app: ReturnType<typeof buildApp>[`app`],
  { method, path, body }: { method: string; path: string; body?: string },
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}${path}`, { method, headers: { ...headers }, body })
}

function post(app: ReturnType<typeof buildApp>[`app`], path: string, body: unknown) {
  return request(app, {
    method: `POST`,
    path: `/admin/newsletter/subscribers/${path}`,
    body: JSON.stringify(body),
  })
}

describe(`operator area: newsletter routes`, () => {
  it(`is in the registry, so the API mounts it`, () => {
    expect(ADMIN_API_MODULES.map((module) => module.id)).toContain(`newsletter`)
  })

  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and does nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls, audits } = buildApp(viewer)
      const response = await request(app, route)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
      expect(audits).toEqual([])
    })

    it(`answers 401 without a session on ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(null)
      const response = await request(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }

  it(`answers 401 to an operator whose session still owes its authenticator code`, async () => {
    const owing = buildAuthData({
      user: { id: 7, role: UserRole.OPERATOR, mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Pending },
    })
    const { app, calls } = buildApp(owing)
    const response = await request(app, ROUTES[0])

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  for (const route of ROUTES.filter((route) => route.method === `POST`)) {
    it(`refuses an operator's cross-site ${route.path} without acting`, async () => {
      const { app, calls, audits } = buildApp()
      const response = await request(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
      expect(audits).toEqual([])
    })
  }

  it(`lists subscribers with the search read from the body`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, ROUTES[1])

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      subscribers: [confirmed, pending],
      total: 2,
      page: 2,
      pageSize: 25,
    })
    expect(calls).toEqual([[`list`, { query: `ada`, status: `pending`, page: 2 }]])
  })

  it(`ignores a search put in the URL`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, {
      method: `POST`,
      path: `/admin/newsletter/subscribers/search?q=eve&status=pending&page=3`,
      body: `{}`,
    })

    expect(response.status).toBe(200)
    expect(calls).toEqual([[`list`, { query: ``, status: `any`, page: 1 }]])
  })

  it(`no longer lists subscribers on a GET, which would carry the search in its URL`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, {
      method: `GET`,
      path: `/admin/newsletter/subscribers?q=ada`,
    })

    expect(response.status).toBe(404)
    expect(calls).toEqual([])
  })

  for (const body of [`"ada"`, `null`, JSON.stringify({ q: 42 }), JSON.stringify({ page: 2 })]) {
    it(`answers 400 to the search body ${body}`, async () => {
      const { app, calls } = buildApp()
      const response = await request(app, {
        method: `POST`,
        path: `/admin/newsletter/subscribers/search`,
        body,
      })

      expect(response.status).toBe(400)
      expect((await apiError(response)).message).toBe(NEWSLETTER_INVALID_SEARCH)
      expect(calls).toEqual([])
    })
  }

  it(`answers the numbers and the sent issues with their counts`, async () => {
    const { app } = buildApp()

    expect(await (await request(app, ROUTES[0])).json()).toEqual(stats)
    expect(await (await request(app, ROUTES[2])).json()).toEqual({ sends: [send] })
  })

  it(`removes a listed address and audits it on the operator with the address masked`, async () => {
    const { app, calls, audits } = buildApp()
    const response = await post(app, `remove`, { email: ` ${pending.email} ` })

    expect(response.status).toBe(200)
    expect(calls).toEqual([[`find`, pending.email], [`remove`, pending.email]])
    expect(audits).toEqual([{
      userId: 7,
      eventType: AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED,
      identifier: `news:b***@e***.com`,
      ip: null,
      userAgent: null,
    }])
  })

  it(`keeps the audit row when the removal itself throws`, async () => {
    const { app, calls, audits } = buildApp(operator(), { removeFails: true })
    const response = await post(app, `remove`, { email: pending.email })

    expect(response.status).toBe(500)
    expect(calls).toEqual([[`find`, pending.email], [`remove`, pending.email]])
    expect(audits.map((row) => [row.userId, row.eventType, row.identifier])).toEqual([
      [7, AuthAuditEventType.NEWSLETTER_SUBSCRIBER_REMOVED, `news:b***@e***.com`],
    ])
  })

  it(`answers 404 to removing an address that is not on the list, writing nothing`, async () => {
    const { app, calls, audits } = buildApp()
    const response = await post(app, `remove`, { email: `nobody@example.com` })

    expect(response.status).toBe(404)
    expect((await apiError(response)).message).toBe(NEWSLETTER_NOT_LISTED)
    expect(calls).toEqual([[`find`, `nobody@example.com`]])
    expect(audits).toEqual([])
  })

  for (
    const body of [{ email: `not an address` }, { email: 42 }, {}, { email: `a@b.c`.repeat(80) }]
  ) {
    it(`answers 400 to the action body ${JSON.stringify(body).slice(0, 40)}`, async () => {
      const { app, calls, audits } = buildApp()
      const response = await post(app, `remove`, body)

      expect(response.status).toBe(400)
      expect((await apiError(response)).message).toBe(NEWSLETTER_INVALID_ADDRESS)
      expect(calls).toEqual([])
      expect(audits).toEqual([])
    })
  }

  it(`answers 503 to every action while mail subscriptions are off`, async () => {
    const { app, calls, audits } = buildApp(operator(), { enabled: false })

    for (const path of [`remove`, `resend`]) {
      const response = await post(app, path, { email: pending.email })
      expect(response.status).toBe(503)
      expect((await apiError(response)).message).toBe(NEWSLETTER_OFF)
    }
    expect(calls).toEqual([])
    expect(audits).toEqual([])
  })

  it(`queues a new confirm mail to a pending address and audits it`, async () => {
    const { app, calls, audits } = buildApp()
    const response = await post(app, `resend`, { email: pending.email })

    expect(response.status).toBe(202)
    expect(calls).toEqual([[`find`, pending.email], [`resend`, pending.email]])
    expect(audits.map((row) => [row.userId, row.eventType, row.identifier])).toEqual([
      [7, AuthAuditEventType.NEWSLETTER_CONFIRMATION_RESENT, `news:b***@e***.com`],
    ])
  })

  it(`answers 409 to resending a confirmed address's confirm mail, writing nothing`, async () => {
    const { app, calls, audits } = buildApp()
    const response = await post(app, `resend`, { email: confirmed.email })

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(NEWSLETTER_ALREADY_CONFIRMED)
    expect(calls).toEqual([[`find`, confirmed.email]])
    expect(audits).toEqual([])
  })

  it(`answers 404 to resending to an address that is not on the list`, async () => {
    const { app, calls, audits } = buildApp()
    const response = await post(app, `resend`, { email: `nobody@example.com` })

    expect(response.status).toBe(404)
    expect(calls).toEqual([[`find`, `nobody@example.com`]])
    expect(audits).toEqual([])
  })

  it(`exports every address as a CSV download that a spreadsheet opens as text`, async () => {
    const { app, audits } = buildApp(operator(), { rows: [confirmed, formula] })
    const response = await request(app, ROUTES[5])

    expect(response.status).toBe(200)
    expect(response.headers.get(`content-type`)).toBe(`text/csv; charset=utf-8`)
    expect(response.headers.get(`content-disposition`)).toBe(
      `attachment; filename="newsletter-news-2026-10-16.csv"`,
    )
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    const text = new TextDecoder().decode(await response.arrayBuffer())
    const lines = text.replace(/^﻿/, ``).trim().split(/\r?\n/)
    expect(lines[0]).toBe(`Address,Status,Requested at,Confirmed at`)
    expect(lines[1]).toBe(`ada@example.com,confirmed,,2026-10-01T10:00:00.000Z`)
    // The guard puts a quote in front, so the cell starts with text, never with `=`.
    expect(lines[2].startsWith(`"'=HYPERLINK`)).toBe(true)
    expect(audits.map((row) => [row.userId, row.eventType, row.identifier])).toEqual([
      [7, AuthAuditEventType.NEWSLETTER_SUBSCRIBERS_EXPORTED, `news:2`],
    ])
  })
})
