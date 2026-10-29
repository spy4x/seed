import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import { UserRole } from "@domain/identity"
import {
  CATALOG_PHOTO_MAX_BYTES,
  CatalogError,
  type CatalogItem,
  type CatalogPhoto,
  CatalogVersionConflictError,
} from "@domain/catalog"
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
import { type AdminCatalogService, createAdminCatalogRoutes } from "./catalog.ts"
import { apiError } from "../../_testing/api-error.ts"

const ID = `019a2f6c-0c00-7000-8000-00000000c001`
const PHOTO = `019a2f6c-0c00-7000-8000-00000000c002`
const SIZE = `019a2f6c-0c00-7000-8000-00000000c003`
const NOW = `2026-10-28T10:00:00.000Z`
const SETTINGS = { currency: `VND`, languages: [`vi`, `en`] }

const item: CatalogItem = {
  id: ID,
  slug: `ao-thun`,
  categoryId: null,
  name: { vi: `Áo thun` },
  description: {},
  material: {},
  fit: {},
  care: {},
  price: 250_000,
  colours: [],
  sizes: [],
  soldOut: [],
  status: `draft`,
  publishedAt: null,
  photos: [],
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
}
const photo: CatalogPhoto = { id: PHOTO, colourId: null, alt: {}, state: `preparing` }
const category = {
  id: ID,
  slug: `tops`,
  name: { vi: `Áo` },
  position: 0,
  itemCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
}

const SOURCE = `019a2f6c-0c00-7000-8000-00000000c004`
const source = {
  id: SOURCE,
  name: `Zalo group A`,
  slug: `zalo-a`,
  position: 0,
  linkCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
}
const link = { sourceId: SOURCE, url: `https://shop.example/s/AbCdEfGhIjK`, createdAt: NOW }

/** The operator of every test, with the request id the test session gives. */
const ACTOR = { userId: 7, requestId: `req-test-1` }

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

const operator = () => buildAuthData({ user: { id: 7, role: UserRole.OPERATOR } })

/** A PNG's first bytes: what the sniffer looks for. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

/** The operator area with this module over a fake service that records every call. */
function buildApp(
  auth: APIContext["Variables"]["auth"] = operator(),
  fail: Error | null = null,
  { tracking = true, linkAnswer = link as typeof link | null } = {},
) {
  const calls: unknown[][] = []
  const record = <T>(name: string, answer: T) => (...args: unknown[]) => {
    calls.push([name, ...args])
    return fail ? Promise.reject(fail) : Promise.resolve(answer)
  }
  const catalog: AdminCatalogService = {
    settings: SETTINGS,
    tracking,
    read: record(`read`, { categories: [category], items: [], sources: [source] }),
    getItem: record(`getItem`, item),
    itemLinks: record(`itemLinks`, [link]),
    trackingLink: record(`trackingLink`, linkAnswer),
    createItem: record(`createItem`, item),
    updateItem: record(`updateItem`, item),
    setStatus: record(`setStatus`, item),
    deleteItem: record(`deleteItem`, undefined),
    addPhoto: (...args) => record(`addPhoto`, photo)(args[0], args[1], args[2].length, args[3]),
    updatePhoto: record(`updatePhoto`, photo),
    reorderPhotos: record(`reorderPhotos`, [photo]),
    removePhoto: record(`removePhoto`, undefined),
    photoFile: (photoId, size) =>
      record(`photoFile`, { bytes: PNG, contentType: `image/webp`, final: size === `thumbnail` })(
        photoId,
        size,
      ),
    createCategory: record(`createCategory`, category),
    updateCategory: record(`updateCategory`, category),
    deleteCategory: record(`deleteCategory`, undefined),
    reorderCategories: record(`reorderCategories`, [category]),
    createSource: record(`createSource`, source),
    updateSource: record(`updateSource`, source),
    deleteSource: record(`deleteSource`, undefined),
    reorderSources: record(`reorderSources`, [source]),
  }
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [createAdminCatalogRoutes({ limit: passThrough, catalog })],
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
  return app.request(`${API_URL}/admin/catalog${path}`, {
    method,
    headers: { ...headers },
    body: body === undefined
      ? undefined
      : body instanceof Uint8Array
      ? body as Uint8Array<ArrayBuffer>
      : JSON.stringify(body),
  })
}

/** The headers of a photo upload of `type`. */
const photoHeaders = (type: string) => ({ ...sameOriginHeaders, "content-type": type })

const itemBody = {
  slug: `ao-thun`,
  categoryId: null,
  name: { vi: `Áo thun` },
  description: {},
  material: {},
  fit: {},
  care: {},
  price: 250_000,
  colours: [],
  sizes: [],
  soldOut: [],
}

/** Every path of the module, each with a body it accepts. */
const ROUTES: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[] =
  [
    { method: `GET`, path: `` },
    { method: `GET`, path: `/items/${ID}` },
    { method: `POST`, path: `/items`, body: { id: ID, ...itemBody } },
    { method: `POST`, path: `/items/${ID}`, body: { version: 1, ...itemBody } },
    { method: `POST`, path: `/items/${ID}/status`, body: { version: 1, status: `published` } },
    { method: `POST`, path: `/items/${ID}/delete`, body: { version: 1 } },
    {
      method: `POST`,
      path: `/items/${ID}/photos?id=${PHOTO}`,
      body: PNG,
      headers: photoHeaders(`image/png`),
    },
    { method: `POST`, path: `/items/${ID}/photos/order`, body: { ids: [PHOTO] } },
    { method: `POST`, path: `/items/${ID}/photos/${PHOTO}`, body: { alt: {}, colourId: null } },
    { method: `POST`, path: `/items/${ID}/photos/${PHOTO}/delete` },
    { method: `GET`, path: `/photos/${PHOTO}/thumbnail` },
    { method: `GET`, path: `/photos/${PHOTO}/full` },
    { method: `POST`, path: `/categories`, body: { id: ID, slug: `tops`, name: { vi: `Áo` } } },
    { method: `POST`, path: `/categories/order`, body: { ids: [ID] } },
    {
      method: `POST`,
      path: `/categories/${ID}`,
      body: { version: 1, slug: `t`, name: { vi: `Á` } },
    },
    { method: `POST`, path: `/categories/${ID}/delete`, body: { version: 1 } },
    { method: `POST`, path: `/items/${ID}/links`, body: { sourceId: SOURCE } },
    { method: `POST`, path: `/sources`, body: { id: SOURCE, name: `Zalo`, slug: `zalo-a` } },
    { method: `POST`, path: `/sources/order`, body: { ids: [SOURCE] } },
    { method: `POST`, path: `/sources/${SOURCE}`, body: { version: 1, name: `Z`, slug: `z` } },
    { method: `POST`, path: `/sources/${SOURCE}/delete`, body: { version: 1 } },
  ]

describe(`operator area: catalog routes`, () => {
  it(`is in the registry after the contact links, so the API mounts it in the rail's order`, () => {
    const ids = ADMIN_API_MODULES.map((module) => module.id)
    expect(ids.indexOf(`catalog`)).toBe(ids.indexOf(`contact-links`) + 1)
  })

  for (const route of ROUTES) {
    it(`answers 404 to a viewer on ${route.method} ${route.path} and calls nothing`, async () => {
      const viewer = buildAuthData({ user: { id: 7, role: UserRole.VIEWER } })
      const { app, calls } = buildApp(viewer)
      const response = await request(app, route.method, route.path, route.body, route.headers)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers an operator on ${route.method} ${route.path}`, async () => {
      const { app } = buildApp()
      const response = await request(app, route.method, route.path, route.body, route.headers)

      expect(response.status).toBeLessThan(300)
    })
  }

  it(`refuses an operator's cross-site photo upload with 403 and calls nothing`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/items/${ID}/photos?id=${PHOTO}`, PNG, {
      ...crossSiteHeaders,
      "content-type": `image/png`,
    })

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it(`answers the catalog's currency and languages with its lists`, async () => {
    const { app } = buildApp()
    const answer = await (await request(app, `GET`, ``)).json()
    expect(answer).toEqual({
      settings: SETTINGS,
      tracking: true,
      categories: [category],
      items: [],
      sources: [source],
    })
  })

  it(`answers an item with its tracking links`, async () => {
    const { app, calls } = buildApp()
    const answer = await (await request(app, `GET`, `/items/${ID}`)).json()
    expect(answer).toEqual({ item, links: [link] })
    expect(calls).toEqual([[`getItem`, ID], [`itemLinks`, ID]])
  })

  it(`answers the item's link for a source, with the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/items/${ID}/links`, {
      sourceId: SOURCE,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ link })
    expect(calls).toEqual([[`trackingLink`, ID, SOURCE, ACTOR]])
  })

  it(`answers 404 to a link for an item or a source that is gone`, async () => {
    const { app } = buildApp(operator(), null, { linkAnswer: null })
    const response = await request(app, `POST`, `/items/${ID}/links`, { sourceId: SOURCE })
    expect(response.status).toBe(404)
    expect((await apiError(response)).reason).toBe(`SOURCE_NOT_FOUND`)
  })

  it(`answers 409 TRACKING_OFF while the website has no address, and makes no link`, async () => {
    const { app, calls } = buildApp(operator(), null, { tracking: false })
    const response = await request(app, `POST`, `/items/${ID}/links`, { sourceId: SOURCE })
    expect(response.status).toBe(409)
    expect((await apiError(response)).reason).toBe(`TRACKING_OFF`)
    expect(calls).toEqual([])
  })

  it(`adds a source with its name trimmed and refuses one with no utm_source`, async () => {
    const { app, calls } = buildApp()
    const added = await request(app, `POST`, `/sources`, {
      id: SOURCE,
      name: `  Zalo group A `,
      slug: `zalo-a`,
    })
    expect(added.status).toBe(201)
    expect(calls).toEqual([[
      `createSource`,
      SOURCE,
      { name: `Zalo group A`, slug: `zalo-a` },
      ACTOR,
    ]])

    const refused = await request(app, `POST`, `/sources`, { id: SOURCE, name: `Zalo`, slug: `` })
    expect(refused.status).toBe(400)
    expect((await apiError(refused)).details).toEqual({ field: `slug` })
    expect(calls).toHaveLength(1)
  })

  it(`adds an item with its texts trimmed and the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/items`, {
      ...itemBody,
      id: ID,
      name: { vi: ` Áo thun `, en: `  ` },
      sizes: [{ id: SIZE, label: ` M `, heightCm: { min: 160, max: 170 } }],
    })

    expect(response.status).toBe(201)
    expect(calls).toEqual([[`createItem`, ID, {
      ...itemBody,
      name: { vi: `Áo thun` },
      sizes: [{ id: SIZE, label: `M`, heightCm: { min: 160, max: 170 }, weightKg: null }],
    }, ACTOR]])
  })

  it(`answers 400 naming the field for an item without a name in the default language`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `POST`, `/items/${ID}`, {
      ...itemBody,
      version: 1,
      name: { en: `T-shirt` },
    })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      reason: `INVALID_REQUEST`,
      details: { field: `name:vi` },
    })
    expect(calls).toEqual([])
  })

  it(`answers 409 with the current version when the item moved on`, async () => {
    const { app } = buildApp(operator(), new CatalogVersionConflictError(4))
    const response = await request(app, `POST`, `/items/${ID}/delete`, { version: 2 })

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      reason: `VERSION_CONFLICT`,
      details: { currentVersion: 4 },
    })
  })

  it(`answers 404 for an item that is gone and for an id that is no UUID`, async () => {
    const { app, calls } = buildApp(operator(), new CatalogError(`ITEM_NOT_FOUND`, `gone`))
    expect((await request(app, `POST`, `/items/${ID}/delete`, { version: 1 })).status).toBe(404)
    expect((await request(app, `POST`, `/items/x/delete`, { version: 1 })).status).toBe(404)
    expect(calls.map((call) => call[0])).toEqual([`deleteItem`])
  })

  it(`takes a photo's bytes with the operator as actor`, async () => {
    const { app, calls } = buildApp()
    const response = await request(
      app,
      `POST`,
      `/items/${ID}/photos?id=${PHOTO}`,
      PNG,
      photoHeaders(`image/png`),
    )

    expect(response.status).toBe(201)
    expect(calls).toEqual([[`addPhoto`, ID, PHOTO, PNG.length, ACTOR]])
  })

  it(`answers 415 to a photo of a type it does not take, and stores nothing`, async () => {
    const { app, calls } = buildApp()
    const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"/>`)
    const response = await request(
      app,
      `POST`,
      `/items/${ID}/photos?id=${PHOTO}`,
      svg,
      photoHeaders(`image/svg+xml`),
    )

    expect(response.status).toBe(415)
    expect((await apiError(response)).reason).toBe(`PHOTO_TYPE`)
    expect(calls).toEqual([])
  })

  it(`answers 400 to a file whose bytes are not the image its type says, and stores nothing`, async () => {
    const { app, calls } = buildApp()
    const html = new TextEncoder().encode(`<html><script>alert(1)</script></html>`)
    const response = await request(
      app,
      `POST`,
      `/items/${ID}/photos?id=${PHOTO}`,
      html,
      photoHeaders(`image/jpeg`),
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).reason).toBe(`PHOTO_CONTENT`)
    expect(calls).toEqual([])
  })

  it(`answers 413 to a photo past the limit, and stores nothing`, async () => {
    const { app, calls } = buildApp()
    const big = new Uint8Array(CATALOG_PHOTO_MAX_BYTES + 1)
    big.set(PNG)
    const response = await request(
      app,
      `POST`,
      `/items/${ID}/photos?id=${PHOTO}`,
      big,
      photoHeaders(`image/png`),
    )

    expect(response.status).toBe(413)
    expect(calls).toEqual([])
  })

  it(`answers 400 to an upload that names no photo id`, async () => {
    const { app, calls } = buildApp()
    const response = await request(
      app,
      `POST`,
      `/items/${ID}/photos`,
      PNG,
      photoHeaders(`image/png`),
    )

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`serves a thumbnail that no page can run as a document`, async () => {
    const { app } = buildApp()
    const response = await request(app, `GET`, `/photos/${PHOTO}/thumbnail`)

    expect(response.headers.get(`content-type`)).toBe(`image/webp`)
    expect(response.headers.get(`x-content-type-options`)).toBe(`nosniff`)
    expect(response.headers.get(`content-security-policy`)).toContain(`sandbox`)
  })

  it(`serves a photo's widest width for the lightbox, uncached while wider ones are made`, async () => {
    const { app, calls } = buildApp()
    const response = await request(app, `GET`, `/photos/${PHOTO}/full`)

    expect(response.status).toBe(200)
    expect(calls).toContainEqual([`photoFile`, PHOTO, `full`])
    expect(response.headers.get(`content-security-policy`)).toContain(`sandbox`)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    const thumbnail = await request(app, `GET`, `/photos/${PHOTO}/thumbnail`)
    expect(thumbnail.headers.get(`cache-control`)).toBe(`private, max-age=86400`)
    expect((await request(app, `GET`, `/photos/${PHOTO}/original`)).status).toBe(404)
  })
})
