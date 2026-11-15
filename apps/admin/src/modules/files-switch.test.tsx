/**
 * The catalog item editor wired as `app.tsx` wires it, with the API's module list naming `files`,
 * leaving it out (`FILES=false`) and not read yet: with files off there is no store, so the editor
 * draws no photo upload and no upload rule, and keeps the item's photos. Until the list is read it
 * draws as with files on, as the notes pages do (`notes-switch.test.tsx`). The group page's Files
 * tab is checked in `groups/module.test.tsx`.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { signal } from "@preact/signals"
import { Route, Router } from "wouter-preact"
import { memoryLocation } from "wouter-preact/memory-location"
import { createToastStore } from "@spy4x/preact-signals/toast"
import { createLeaveGuard } from "@spy4x/preact-ui/unsaved-guard"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import type { AdminCatalogResponse, CatalogItem } from "@domain/catalog"
import { type User, UserRole } from "@domain/identity"
import type { AdminApiResult, AdminFetch } from "../state.ts"
import type { AdminContext } from "./types.ts"
import { catalogModule } from "./catalog/module.tsx"

const window = new Window({ url: `http://admin.localhost/` })
const own = { document: globalThis.document, window: globalThis.window }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document, window })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ``
  root = null
})

const ID = `0195f0b4-3c1e-7a00-8000-0000000000a1`
const NOW = `2026-10-28T10:00:00.000Z`

const CATALOG: AdminCatalogResponse = {
  settings: { currency: `USD`, languages: [`en`] },
  categories: [],
  items: [],
  sources: [],
  tracking: false,
}

/** A saved item with one ready photo, which stays on screen whatever the switch says. */
const ITEM: CatalogItem = {
  id: ID,
  slug: `t-shirt`,
  categoryId: null,
  name: { en: `T-shirt` },
  description: {},
  material: {},
  fit: {},
  care: {},
  price: 2500,
  colours: [],
  sizes: [],
  soldOut: [],
  status: `draft`,
  publishedAt: null,
  photos: [{
    id: `0195f0b4-3c1e-7a00-8000-0000000000b1`,
    state: `ready`,
    alt: {},
    colourId: null,
    width: 800,
    height: 600,
  }],
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
} as unknown as CatalogItem

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

/** Opens the catalog item editor on `path` with `moduleIds` as the API's list (`null`: not read). */
async function open(path: string, moduleIds: ReadonlySet<string> | null, item = ITEM) {
  const request = ((asked: string) => {
    const data = asked === `/api/admin/catalog`
      ? CATALOG
      : asked === `/api/admin/catalog/items/${ID}`
      ? { item }
      : null
    return Promise.resolve(
      data
        ? { ok: true, status: 200, data }
        : { ok: false, status: 500, error: { message: `not in this test` } },
    ) as Promise<AdminApiResult<unknown>>
  }) as AdminFetch
  const memory = memoryLocation({ path })
  const context: AdminContext = {
    request,
    signedOut: () => {},
    toasts: createToastStore(),
    operator: { id: 7, role: UserRole.OPERATOR } as User,
    navigate: memory.navigate,
    leaveGuard: createLeaveGuard(),
    personTabs: [],
    moduleIds: signal(moduleIds),
    format: () => ({}) as Formatters,
  }
  const View = catalogModule.routes.find((route) => route.path === `/catalog/:id`)!.View
  root = document.createElement(`div`)
  document.body.append(root)
  await act(() =>
    render(
      <FormatContext.Provider
        value={createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })}
      >
        <Router hook={memory.hook}>
          <Route path="/catalog/:id">
            {(params) => <View context={context} params={params as Record<string, string>} />}
          </Route>
        </Router>
      </FormatContext.Provider>,
      root!,
    )
  )
  await settle()
  await settle()
}

const ON = new Set([`catalog`, `files`])
const OFF = new Set([`catalog`])

/** What the editor draws of the photos: the upload, its rule, the photos and the new item's line. */
const photos = () => ({
  upload: document.querySelector(`#catalog-item-photos`) !== null,
  rule: document.body.textContent?.includes(`JPEG, PNG, WebP or HEIC`) ?? false,
  shown: document.querySelectorAll(`[data-e2e=catalog-item-photo-menu]`).length,
  later: document.querySelector(`[data-e2e=catalog-item-photos-later]`) !== null,
})

describe(`the catalog item editor with files on, off and not known yet`, () => {
  it(`offers the photo upload and its rule with files on or not known yet`, async () => {
    for (const moduleIds of [ON, null]) {
      await open(`/catalog/${ID}`, moduleIds)
      expect(photos()).toEqual({ upload: true, rule: true, shown: 1, later: false })
      await act(() => render(null, root!))
    }
  })

  it(`offers no photo upload or upload rule with files off, and still shows the item's photos`, async () => {
    await open(`/catalog/${ID}`, OFF)
    expect(photos()).toEqual({ upload: false, rule: false, shown: 1, later: false })
  })

  it(`draws no Photos card for an item without photos with files off`, async () => {
    const card = async (moduleIds: ReadonlySet<string> | null) => {
      await open(`/catalog/${ID}`, moduleIds, { ...ITEM, photos: [] })
      const shown = document.querySelector(`[data-e2e=catalog-item-no-photos]`) !== null
      await act(() => render(null, root!))
      return shown
    }

    expect([await card(ON), await card(null), await card(OFF)]).toEqual([true, true, false])
  })

  it(`says a new item gets photos once saved only while files are on or not known yet`, async () => {
    const later = async (moduleIds: ReadonlySet<string> | null) => {
      await open(`/catalog/new`, moduleIds)
      const shown = photos().later
      await act(() => render(null, root!))
      return shown
    }

    expect([await later(ON), await later(null), await later(OFF)]).toEqual([true, true, false])
  })
})
