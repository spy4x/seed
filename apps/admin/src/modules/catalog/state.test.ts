import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { AdminCatalogResponse, CatalogItem } from "@domain/catalog"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { CATALOG_PREPARING_READS, createCatalogState } from "./state.ts"

const ok = <T>(data: T) => ({ ok: true, status: 200, data }) as AdminApiResult<T>
const fail = (status: number, message: string, details?: unknown) =>
  ({ ok: false, status, error: { status, message, details } }) as AdminApiResult<never>

const ID = `0195f0b4-3c1e-7a00-8000-0000000000a1`
const NEW = `0195f0b4-3c1e-7a00-8000-0000000000c3`
const NOW = `2026-10-28T10:00:00.000Z`

const CATALOG: AdminCatalogResponse = {
  settings: { currency: `VND`, languages: [`vi`, `en`] },
  categories: [],
  items: [],
}

const ITEM: CatalogItem = {
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
  version: 2,
}

/** A state over a fake API that answers each `METHOD path` from `answers`, recording every call. */
function build(answers: Record<string, () => AdminApiResult<unknown>> = {}) {
  const calls: string[] = []
  const request = ((path: string, init?: RequestInit) => {
    const key = `${init?.method ?? `GET`} ${path.split(`?`)[0]}`
    // A JSON body is recorded as is; a photo's bytes by the type they are sent as.
    const body = typeof init?.body === `string`
      ? init.body
      : init?.body && new Headers(init.headers).get(`content-type`)
    calls.push(`${key}${body ? ` ${body}` : ``}`)
    const answer = answers[key] ??
      (() =>
        key === `GET /api/admin/catalog`
          ? ok(CATALOG)
          : key === `GET /api/admin/catalog/items/${ID}`
          ? ok({ item: ITEM })
          : ok({ item: { ...ITEM, version: 3 } }))
    return Promise.resolve(answer())
  }) as AdminFetch
  const state = createCatalogState(request, createToastStore(), () => NEW)
  return { state, calls }
}

it(`refuses an item without a name in the default language before it asks the API`, async () => {
  const { state, calls } = build()
  await state.openItem(null)
  state.editItem({ ...state.itemEditor.value.value, slug: `x`, price: 100, name: { en: `Tee` } })
  calls.length = 0

  expect(await state.saveItem()).toBeNull()
  expect(Object.keys(state.itemEditor.value.errors)).toEqual([`name:vi`])
  expect(calls).toEqual([])
})

it(`saves an item at the version it read, with nothing left unsaved`, async () => {
  const { state, calls } = build()
  await state.openItem(ID)
  state.editItem({ ...state.itemEditor.value.value, price: 300_000 })
  expect(state.itemUnsaved()).toBe(true)
  calls.length = 0

  expect(await state.saveItem()).toBe(ID)
  expect(calls[0]).toMatch(new RegExp(`^POST /api/admin/catalog/items/${ID} .*"price":300000`))
  expect(calls[0]).toContain(`"version":2`)
  expect(state.itemEditor.value.item?.version).toBe(3)
  expect(state.itemUnsaved()).toBe(false)
})

it(`shows the API's refusal on the field it names`, async () => {
  const { state } = build({
    [`POST /api/admin/catalog/items`]: () => fail(409, `This address is taken.`, { field: `slug` }),
  })
  await state.openItem(null)
  state.editItem({ ...state.itemEditor.value.value, slug: `ao`, price: 1, name: { vi: `Áo` } })

  expect(await state.saveItem()).toBeNull()
  expect(state.itemEditor.value.errors).toEqual({ slug: `This address is taken.` })
})

it(`saves unsaved changes before it publishes`, async () => {
  const { state, calls } = build()
  await state.openItem(ID)
  state.editItem({ ...state.itemEditor.value.value, price: 1 })
  calls.length = 0

  expect(await state.publish()).toBe(true)
  const writes = calls.filter((call) => call.startsWith(`POST`))
  expect(writes.map((call) => call.split(` `).slice(0, 2).join(` `))).toEqual([
    `POST /api/admin/catalog/items/${ID}`,
    `POST /api/admin/catalog/items/${ID}/status`,
  ])
  expect(writes[1]).toContain(`"version":3,"status":"published"`)
})

it(`uploads each photo with its own type, and refuses a file it does not take in words`, async () => {
  const { state, calls } = build()
  await state.openItem(ID)
  calls.length = 0
  const photo = new File([new Uint8Array([1])], `IMG_1.HEIC`, { type: `` })
  const text = new File([`hi`], `notes.txt`, { type: `text/plain` })

  await state.upload([photo, text])
  expect(calls.filter((call) => call.startsWith(`POST`))).toEqual([
    `POST /api/admin/catalog/items/${ID}/photos image/heic`,
  ])
  expect(state.itemEditor.value.photos).toEqual({
    uploading: 0,
    busy: false,
    error: `notes.txt is not a JPEG, PNG, WebP or HEIC photo.`,
  })
})

it(`reads an item with a photo being prepared again, but not forever`, async () => {
  const preparing = { ...ITEM, photos: [{ id: NEW, colourId: null, alt: {}, state: `preparing` }] }
  const { state, calls } = build({
    [`GET /api/admin/catalog/items/${ID}`]: () => ok({ item: preparing }),
  })
  await state.openItem(ID)
  calls.length = 0
  let reads = 0
  while (await state.readWhilePreparing()) reads++
  expect(reads).toBe(CATALOG_PREPARING_READS)
  expect(calls).toHaveLength(CATALOG_PREPARING_READS)
})

it(`makes a photo the cover by sending it first in the order`, async () => {
  const photos = [`a`, `b`, `c`].map((id) => ({ id, colourId: null, alt: {}, state: `ready` }))
  const { state, calls } = build({
    [`GET /api/admin/catalog/items/${ID}`]: () => ok({ item: { ...ITEM, photos } }),
  })
  await state.openItem(ID)
  calls.length = 0

  expect(await state.movePhoto(2, 0)).toBe(true)
  expect(calls[0]).toBe(`POST /api/admin/catalog/items/${ID}/photos/order {"ids":["c","a","b"]}`)
})
