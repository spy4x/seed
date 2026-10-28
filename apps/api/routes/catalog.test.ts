import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { PublicCatalogResponse } from "@domain/catalog"
import { createPublicCatalogRoute, type PublicCatalogReads } from "./catalog.ts"

const PHOTO = `019a2f6c-0c00-7000-8000-00000000c002`
const BYTES = new Uint8Array([1, 2, 3])
const CODE = `AbCdEfGh_-1`
const ITEM_URL = `https://shop.example/shirts/linen?utm_source=zalo-a`
const catalog: PublicCatalogResponse = {
  settings: { currency: `USD`, languages: [`en`] },
  categories: [],
  items: [],
}

/** The route over fake reads that know one photo width and no item. */
function app() {
  const asked: unknown[][] = []
  const reads: PublicCatalogReads = {
    catalog: () => Promise.resolve(catalog),
    item: (slug) => (asked.push([`item`, slug]), Promise.resolve(null)),
    photo: (id, file) => {
      asked.push([`photo`, id, file])
      return Promise.resolve(
        id === PHOTO && file === `480.webp` ? { bytes: BYTES, contentType: `image/webp` } : null,
      )
    },
    link: (code, counted) => {
      asked.push([`link`, code, counted])
      return Promise.resolve(code === CODE ? ITEM_URL : null)
    },
  }
  return { route: createPublicCatalogRoute(reads), asked }
}

describe(`public catalog routes`, () => {
  it(`answers the published catalog`, async () => {
    const response = await app().route.request(`/`)
    expect(await response.json()).toEqual(catalog)
  })

  it(`answers 404 for an item that is not published`, async () => {
    const { route, asked } = app()
    expect((await route.request(`/items/ao-thun`)).status).toBe(404)
    expect(asked).toEqual([[`item`, `ao-thun`]])
  })

  it(`serves a photo width that no page can run as a document`, async () => {
    const response = await app().route.request(`/photos/${PHOTO}/480.webp`)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
    expect(response.headers.get(`x-content-type-options`)).toBe(`nosniff`)
    expect(response.headers.get(`content-security-policy`)).toContain(`sandbox`)
    expect(response.headers.get(`cache-control`)).toBe(`public, max-age=86400`)
  })

  it(`answers 404 for a photo id that is no UUID without reading anything`, async () => {
    const { route, asked } = app()
    expect((await route.request(`/photos/..%2Fsecret/480.webp`)).status).toBe(404)
    expect(asked).toEqual([])
  })

  it(`answers where a tracking link leads, never cached`, async () => {
    const { route, asked } = app()
    const response = await route.request(`/links/${CODE}?counted=1`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ location: ITEM_URL })
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(asked).toEqual([[`link`, CODE, true]])
  })

  it(`answers 404 for an unknown code, and for one of another shape without reading`, async () => {
    const { route, asked } = app()
    expect((await route.request(`/links/ZZZZZZZZZZZ`)).status).toBe(404)
    expect((await route.request(`/links/short`)).status).toBe(404)
    expect((await route.request(`/links/${encodeURIComponent(`https://evil.example`)}`)).status)
      .toBe(404)
    expect(asked).toEqual([[`link`, `ZZZZZZZZZZZ`, false]])
  })
})
