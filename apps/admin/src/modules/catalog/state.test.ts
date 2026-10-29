import { expect } from "@std/expect"
import { it } from "@std/testing/bdd"
import { createToastStore } from "@spy4x/preact-signals/toast"
import type { AdminCatalogResponse, CatalogItem } from "@domain/catalog"
import type { AdminApiResult, AdminFetch } from "../../state.ts"
import { CATALOG_PREPARING_READS, createCatalogState } from "./state.ts"
import { languages } from "../../i18n.ts"

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
  sources: [],
  tracking: true,
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
function build(
  answers: Record<string, () => AdminApiResult<unknown>> = {},
  copied: string[] | null = [],
) {
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
  const toasts = createToastStore()
  // `null` stands for a clipboard that refuses.
  const copy = (text: string) => Promise.resolve(copied ? (copied.push(text), true) : false)
  const state = createCatalogState(request, toasts, () => NEW, copy)
  return { state, calls, toasts }
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

it(`keeps reading past a minute while photos keep becoming ready`, async () => {
  const photo = (id: string, ready: boolean) =>
    ({ id, colourId: null, alt: {}, state: ready ? `ready` : `preparing` }) as const
  const ids = Array.from({ length: 4 }, (_, i) => `0195f0b4-3c1e-7a00-8000-00000000010${i}`)
  let read = 0
  const { state, calls } = build({
    // One more photo is ready every 20 reads: the batch takes longer than a minute.
    [`GET /api/admin/catalog/items/${ID}`]: () => {
      const ready = Math.floor(read++ / 20)
      return ok({ item: { ...ITEM, photos: ids.map((id, i) => photo(id, i < ready)) } })
    },
  })
  await state.openItem(ID)
  calls.length = 0
  let reads = 0
  while (await state.readWhilePreparing()) reads++

  // The last photo is ready on the 80th read again, well past the 30 a minute allows.
  expect(state.itemEditor.value.item!.photos.every((one) => one.state === `ready`)).toBe(true)
  expect(reads).toBe(80)
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

const SOURCE = `0195f0b4-3c1e-7a00-8000-0000000000e1`
const LINK = `https://shop.example/s/AbCdEfGh_-1`

it(`copies an item's link for a source and keeps it in its row`, async () => {
  const copied: string[] = []
  const { state, calls } = build({
    [`POST /api/admin/catalog/items/${ID}/links`]: () =>
      ok({ link: { sourceId: SOURCE, url: LINK, createdAt: NOW } }),
  }, copied)
  await state.openItem(ID)
  calls.length = 0
  expect(await state.copyLink(SOURCE)).toBe(true)
  expect(calls).toEqual([`POST /api/admin/catalog/items/${ID}/links {"sourceId":"${SOURCE}"}`])
  expect(copied).toEqual([LINK])
  expect(state.itemEditor.value.links).toEqual({ [SOURCE]: LINK })
  expect(state.itemEditor.value.copying).toBeNull()
})

it(`shows the link in its row when the clipboard refuses it`, async () => {
  const { state, toasts } = build({
    [`POST /api/admin/catalog/items/${ID}/links`]: () =>
      ok({ link: { sourceId: SOURCE, url: LINK, createdAt: NOW } }),
  }, null)
  await state.openItem(ID)
  expect(await state.copyLink(SOURCE)).toBe(false)
  expect(state.itemEditor.value.links).toEqual({ [SOURCE]: LINK })
  expect(toasts.list.value.at(-1)?.title).toBe(`Could not copy the link`)
})

it(`asks for one link at a time, and says why one was refused`, async () => {
  const { state, calls, toasts } = build({
    [`POST /api/admin/catalog/items/${ID}/links`]: () => fail(409, `Set MPA_DOMAIN and deploy.`),
  })
  await state.openItem(ID)
  calls.length = 0
  const [first, second] = await Promise.all([state.copyLink(SOURCE), state.copyLink(SOURCE)])
  expect([first, second]).toEqual([false, false])
  expect(calls).toHaveLength(1)
  expect(toasts.list.value.at(-1)?.body).toBe(`Set MPA_DOMAIN and deploy.`)
  expect(state.itemEditor.value.copying).toBeNull()
})

it(`reads an item's links with the item`, async () => {
  const { state } = build({
    [`GET /api/admin/catalog/items/${ID}`]: () =>
      ok({ item: ITEM, links: [{ sourceId: SOURCE, url: LINK, createdAt: NOW }] }),
  })
  await state.openItem(ID)
  expect(state.itemEditor.value.links).toEqual({ [SOURCE]: LINK })
})

it(`adds a source with a client-made id after checking it, and names a refused field`, async () => {
  const { state, calls } = build()
  await state.load()
  state.openSource(null)
  state.editSource({ name: `Zalo group A`, slug: `Zalo A`, slugEdited: true })
  calls.length = 0
  expect(await state.saveSource()).toBe(false)
  expect(calls).toEqual([])
  expect(Object.keys(state.sourceEditor.value.errors)).toEqual([`slug`])

  state.editSource({ name: `Zalo group A`, slug: `zalo-a`, slugEdited: true })
  expect(await state.saveSource()).toBe(true)
  expect(calls[0]).toBe(
    `POST /api/admin/catalog/sources {"id":"${NEW}","name":"Zalo group A","slug":"zalo-a"}`,
  )
})

it(`says a refusal of its own checks in the operator's language, under the field`, async () => {
  const { state, calls } = build()
  try {
    expect(await languages.use(`ru`)).toBe(true)
    await state.openItem(null)
    const size = {
      id: `s1`,
      label: `M`,
      heightMin: `160`,
      heightMax: ``,
      weightMin: ``,
      weightMax: ``,
    }
    state.editItem({
      ...state.itemEditor.value.value,
      slug: `ao`,
      price: 1,
      name: { vi: `Áo` },
      sizes: [size],
    })
    expect(await state.saveItem()).toBeNull()
    expect(state.itemEditor.value.errors).toEqual({
      "size:s1": `Укажите оба края роста или ни одного.`,
    })

    await state.load()
    state.openSource(null)
    state.editSource({ name: `Zalo`, slug: `Zalo A`, slugEdited: true })
    calls.length = 0
    expect(await state.saveSource()).toBe(false)
    expect(state.sourceEditor.value.errors).toEqual({
      slug: `Используйте только строчные латинские буквы, цифры и дефисы.`,
    })
    expect(calls).toEqual([])
  } finally {
    await languages.use(`en`)
  }
})
