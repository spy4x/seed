import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import {
  ContactLinkError,
  type ContactLinkRecord,
  ContactLinkVersionConflictError,
} from "@domain/contact-links"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import { ADMIN_API_MODULES } from "./registry.ts"
import { type AdminContactLinksService, createAdminContactLinksRoutes } from "./contact-links.ts"
import { apiError } from "../../_testing/api-error.ts"

const ID = `019a2f6c-0c00-7000-8000-00000000c001`
const OTHER = `019a2f6c-0c00-7000-8000-00000000c002`
const NOW = `2026-10-28T10:00:00.000Z`

const link: ContactLinkRecord = {
  id: ID,
  kind: `telegram`,
  value: `my_shop`,
  label: null,
  position: 0,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
}

/** The operator of every test, with the request id the test session gives. */
const ACTOR = { userId: 7, requestId: `req-test-1` }

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/** The operator area with this module over a fake service that records every call. */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  fail: Error | null = null,
) {
  const calls: unknown[][] = []
  const record = <T>(name: string, answer: T) => (...args: unknown[]) => {
    calls.push([name, ...args])
    return fail ? Promise.reject(fail) : Promise.resolve(answer)
  }
  const links: AdminContactLinksService = {
    list: record(`list`, [link]),
    create: record(`create`, link),
    update: record(`update`, link),
    delete: record(`delete`, undefined),
    reorder: record(`reorder`, [link]),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [createAdminContactLinksRoutes({ limit: passThrough, links })],
  })
  return { app: mountRoute(`/admin`, route, auth), calls }
}

function request(
  app: ReturnType<typeof buildApp>[`app`],
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin/contact-links${path}`, {
    method,
    headers: { ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Every path of the module, each with a body it accepts. */
const ROUTES: { method: string; path: string; body?: unknown }[] = [
  { method: `GET`, path: `` },
  { method: `POST`, path: ``, body: { id: ID, kind: `telegram`, value: `my_shop` } },
  { method: `POST`, path: `/order`, body: { ids: [ID] } },
  { method: `POST`, path: `/${ID}`, body: { version: 1, kind: `email`, value: `a@example.com` } },
  { method: `POST`, path: `/${ID}/delete`, body: { version: 1 } },
]

describe(`operator area: contact-link routes`, () => {
  it(`is in the registry after the blog, so the API mounts it in the rail's order`, () => {
    const ids = ADMIN_API_MODULES.map((module) => module.id)
    expect(ids.indexOf(`contact-links`)).toBe(ids.indexOf(`blog`) + 1)
  })

  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and calls nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls } = buildApp(viewer)
      const response = await request(app, route.method, route.path, route.body)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers an operator on ${route.method} ${route.path}`, async () => {
      const { app } = buildApp()
      const response = await request(app, route.method, route.path, route.body)

      expect(response.status).toBeLessThan(300)
    })
  }

  it(`refuses an operator's cross-site write with 403 and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/${ID}/delete`, { version: 1 }, {
      ...crossSiteHeaders,
    })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it(`adds a link with the value normalised, the label trimmed and the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, ``, {
      id: ID,
      kind: `telegram`,
      value: ` https://t.me/my_shop `,
      label: `  `,
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[
      `create`,
      ID,
      { kind: `telegram`, value: `my_shop`, label: null },
      ACTOR,
    ]])
  })

  it(`answers 400 naming the value for a Telegram username with spaces, and saves nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/${ID}`, {
      version: 1,
      kind: `telegram`,
      value: `my shop`,
    })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      reason: `INVALID_REQUEST`,
      details: { field: `value` },
    })
    expect(calls).toEqual([])
  })

  it(`answers 400 naming the value for a phone number with letters`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, ``, { id: ID, kind: `phone`, value: `+84 9abc` })

    expect(response.status).toBe(400)
    expect((await apiError(response)).details).toEqual({ field: `value` })
    expect(calls).toEqual([])
  })

  it(`answers 400 to a kind the website does not know`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, ``, { id: ID, kind: `skype`, value: `me` })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`answers 409 with the current version when the link moved on`, async () => {
    const { app } = buildApp(operator(), new ContactLinkVersionConflictError(4))
    const response = await request(app, `POST`, `/${ID}/delete`, { version: 2 })

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      reason: `VERSION_CONFLICT`,
      details: { currentVersion: 4 },
    })
  })

  it(`answers 404 for a link that is gone and for an id that is no UUID`, async () => {
    const { app, calls } = buildApp(operator(), new ContactLinkError(`LINK_NOT_FOUND`, `gone`))
    expect((await request(app, `POST`, `/${ID}/delete`, { version: 1 })).status).toBe(404)
    expect((await request(app, `POST`, `/x/delete`, { version: 1 })).status).toBe(404)
    expect(calls.map((call) => call[0])).toEqual([`delete`])
  })

  it(`reorders by the ids given, and answers 409 when the set of links changed`, async () => {
    const ok = buildApp()
    await request(ok.app, `POST`, `/order`, { ids: [OTHER, ID] })
    expect(ok.calls).toEqual([[`reorder`, [OTHER, ID], ACTOR]])

    const stale = buildApp(operator(), new ContactLinkError(`ORDER_STALE`, `stale`))
    const response = await request(stale.app, `POST`, `/order`, { ids: [ID] })
    expect(response.status).toBe(409)
    expect((await apiError(response)).reason).toBe(`ORDER_STALE`)
  })
})
