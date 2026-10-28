/**
 * The catalog's admin pages (#466), driven in a browser DOM (happy-dom): the list and its empty
 * states, the categories' menus and editor, the tracking link sources' menus and editor (#483),
 * and the item editor's language tabs, address, stock grid, sizes, publishing, photos and share
 * links, with where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { useState } from "preact/hooks"
import { act } from "preact/test-utils"
import type {
  AdminCatalogResponse,
  CatalogCategory,
  CatalogItem,
  CatalogItemRow,
  CatalogLinkSource,
} from "@domain/catalog"
import {
  ADMIN_CATALOG_NO_FILTER,
  AdminCatalogCategoriesScreen,
  type AdminCatalogCategoriesScreenProps,
  AdminCatalogCategoryEditorScreen,
  type AdminCatalogFilter,
  AdminCatalogScreen,
  catalogSettingsLine,
  filterCatalogItems,
} from "./admin-catalog.tsx"
import {
  AdminCatalogItemScreen,
  type AdminCatalogItemScreenProps,
  type CatalogItemDraft,
  catalogItemDraft,
  catalogItemFields,
  type CatalogShareLinksState,
} from "./admin-catalog-item.tsx"
import {
  AdminCatalogSourceEditorScreen,
  AdminCatalogSourcesScreen,
  type AdminCatalogSourcesScreenProps,
  TRACKING_OFF_NOTICE,
} from "./admin-catalog-sources.tsx"
import { ADMIN_ENGLISH, ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"
import { I18nContext } from "@spy4x/preact-ui/i18n"

const window = new Window({ url: "http://admin.localhost/catalog" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The button whose text starts with `text`; inside the open dialog if any. */
function button(text: string): HTMLButtonElement {
  const scope = document.querySelector("dialog[open]") ?? document
  const found = [...scope.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim().startsWith(text))
  if (!found) throw new Error(`no button "${text}"`)
  return found as unknown as HTMLButtonElement
}

async function type(field: HTMLInputElement, value: string): Promise<void> {
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Lets effects that wait a task run. */
async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

const NOW = "2026-10-28T10:00:00.000Z"
const TOPS = "0195f0b4-3c1e-7a00-8000-0000000000c1"
const ITEM = "0195f0b4-3c1e-7a00-8000-0000000000a1"
const RED = "0195f0b4-3c1e-7a00-8000-0000000000b1"
const SMALL = "0195f0b4-3c1e-7a00-8000-0000000000b2"
const PHOTOS = ["0195f0b4-3c1e-7a00-8000-0000000000d1", "0195f0b4-3c1e-7a00-8000-0000000000d2"]
const SETTINGS = { currency: "VND", languages: ["vi", "en"] }

function categoryOf(overrides: Partial<CatalogCategory> = {}): CatalogCategory {
  return {
    id: TOPS,
    slug: "ao",
    name: { vi: "Áo", en: "Tops" },
    position: 0,
    itemCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  }
}

const ROW: CatalogItemRow = {
  id: ITEM,
  slug: "ao-thun",
  name: { vi: "Áo thun" },
  categoryId: TOPS,
  price: 250_000,
  status: "published",
  stock: "sold-out",
  coverId: null,
  photoCount: 2,
  publishedAt: NOW,
  updatedAt: NOW,
}

/** The list screen over its own filter. */
function ListScreen({ catalog }: { catalog: AdminCatalogResponse }) {
  const [filter, setFilter] = useState<AdminCatalogFilter>(ADMIN_CATALOG_NO_FILTER)
  return (
    <AdminCatalogScreen
      catalog={catalog}
      error={null}
      onRetry={() => {}}
      filter={filter}
      onFilter={setFilter}
    />
  )
}

/** Three items: a sold-out tee on the website, a draft hat with no category, a hidden jacket. */
const ROWS: CatalogItemRow[] = [
  ROW,
  {
    ...ROW,
    id: RED,
    slug: "mu-len",
    name: { vi: "Mũ len", en: "Wool hat" },
    categoryId: null,
    status: "draft",
    stock: "in-stock",
  },
  {
    ...ROW,
    id: SMALL,
    slug: "jacket",
    name: { vi: "Áo khoác" },
    status: "hidden",
    stock: "some-sold-out",
  },
]

describe("the catalog list", () => {
  const catalog = (patch: Partial<AdminCatalogResponse> = {}): AdminCatalogResponse => ({
    settings: SETTINGS,
    categories: [categoryOf()],
    items: [ROW],
    sources: [],
    tracking: true,
    ...patch,
  })

  it("names each item's category, price, photos and stock, and its status", async () => {
    await mount(<ListScreen catalog={catalog()} />)
    const row = find("[data-e2e=catalog-row]")
    expect(row.textContent).toContain("Áo thun")
    expect(row.textContent).toContain("Áo · ₫250,000 · 2 photos · Sold out")
    expect(row.textContent).toContain("On the website")
  })

  it("sends a new catalog to its categories first", async () => {
    await mount(
      <ListScreen catalog={catalog({ categories: [], items: [] })} />,
    )
    expect(document.body.textContent).toContain("Start with a category")
    expect(find("a[href='/catalog/categories/new']").textContent).toBe("Add category")
  })

  it("filters by status, sold-out sizes and a search that ignores accents, case and word order", () => {
    const all = catalog({ items: ROWS })
    const ids = (filter: Partial<AdminCatalogFilter>) =>
      filterCatalogItems(all, { ...ADMIN_CATALOG_NO_FILTER, ...filter }).items.map((one) =>
        one.slug
      )

    expect(filterCatalogItems(all, ADMIN_CATALOG_NO_FILTER).counts).toEqual({
      all: 3,
      draft: 1,
      published: 1,
      hidden: 1,
      soldOut: 2,
    })
    expect(ids({ query: "AO" })).toEqual(["ao-thun", "jacket"])
    expect(ids({ query: "thun ao" })).toEqual(["ao-thun"])
    expect(ids({ query: "khoac" })).toEqual(["jacket"])
    expect(ids({ query: "wool" })).toEqual(["mu-len"])
    expect(ids({ query: "tops" })).toEqual(["ao-thun", "jacket"])
    expect(ids({ query: "mu-len" })).toEqual(["mu-len"])
    expect(ids({ status: "draft" })).toEqual(["mu-len"])
    expect(ids({ soldOut: true })).toEqual(["ao-thun", "jacket"])
    // Each chip counts what it would show beside the other filters.
    expect(filterCatalogItems(all, { ...ADMIN_CATALOG_NO_FILTER, soldOut: true }).counts.draft)
      .toBe(0)
    expect(filterCatalogItems(all, { ...ADMIN_CATALOG_NO_FILTER, status: "hidden" }).counts.soldOut)
      .toBe(1)
  })

  it("counts on its chips, and clears filters that match nothing", async () => {
    await mount(<ListScreen catalog={catalog({ items: ROWS })} />)
    expect(find("[data-e2e=catalog-status]").textContent).toContain("On the website 1")
    expect(find("[data-e2e=catalog-sold-out]").textContent).toContain("Sold-out sizes 2")
    expect(find("[data-e2e=catalog-filters]").getAttribute("role")).toBe("search")

    await type(find("[data-e2e=catalog-search]"), "nothing like this")
    expect(find("[data-e2e=catalog-count]").textContent).toBe("0 items")
    await clickOn(find("[data-e2e=catalog-clear]"))
    expect(document.querySelectorAll("[data-e2e=catalog-row]")).toHaveLength(3)
    expect(find<HTMLInputElement>("[data-e2e=catalog-search]").value).toBe("")
  })

  it("says the catalog's currency and languages in words", () => {
    expect(catalogSettingsLine(ADMIN_ENGLISH, SETTINGS)).toBe(
      "Prices in VND · Texts in Tiếng Việt and English",
    )
  })
})

describe("the categories list", () => {
  function props(calls: unknown[][]): AdminCatalogCategoriesScreenProps {
    return {
      categories: [
        categoryOf(),
        categoryOf({ id: ITEM, slug: "mu", name: { vi: "Mũ" }, itemCount: 0 }),
      ],
      languages: SETTINGS.languages,
      error: null,
      busy: false,
      onRetry: () => {},
      onMove: (id, by) => calls.push(["move", id, by]),
      onDelete: (category) => calls.push(["delete", category.id]),
    }
  }
  const row = (index: number) => document.querySelectorAll("[data-e2e=catalog-category-row]")[index]

  it("offers no deletion of a category that holds items", async () => {
    await mount(<AdminCatalogCategoriesScreen {...props([])} />)
    await clickOn(row(0).querySelector("[data-e2e=catalog-category-menu]")!)
    const remove = row(0).querySelector<HTMLButtonElement>("[data-e2e=catalog-category-delete]")!
    expect(remove.textContent).toBe("Move its items to delete it")
    expect(remove.getAttribute("aria-disabled") ?? String(remove.disabled)).toBe("true")
  })

  it("deletes an empty category only after the dialog that names it is confirmed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminCatalogCategoriesScreen {...props(calls)} />)
    await clickOn(row(1).querySelector("[data-e2e=catalog-category-menu]")!)
    await clickOn(row(1).querySelector("[data-e2e=catalog-category-delete]")!)
    expect(document.body.textContent).toContain(`Delete "Mũ"?`)
    expect(calls).toEqual([])
    await clickOn(button("Delete category"))
    expect(calls).toEqual([["delete", ITEM]])
  })
})

describe("the category editor", () => {
  it("fills the address from the default name until it is typed, and focuses a refused field", async () => {
    function Harness({ errors }: { errors: Record<string, string> }) {
      const [value, setValue] = useState({ name: {}, slug: "", slugEdited: false })
      return (
        <AdminCatalogCategoryEditorScreen
          category={null}
          languages={SETTINGS.languages}
          loading={false}
          notFound={false}
          value={value}
          onChange={setValue}
          errors={errors}
          saving={false}
          onSave={() => {}}
        />
      )
    }
    await mount(<Harness errors={{}} />)
    const [vi, en] = [
      ...document.querySelectorAll<HTMLInputElement>("[data-e2e=catalog-category-name]"),
    ]
    await type(vi, "Áo khoác")
    await type(en, "Jackets")
    expect(find<HTMLInputElement>("[data-e2e=catalog-category-slug]").value).toBe("ao-khoac")
    await mount(<Harness errors={{ "name:en": "Keep it shorter." }} />)
    expect(document.activeElement).toBe(en)
  })
})

const ITEM_SAVED: CatalogItem = {
  id: ITEM,
  slug: "ao-thun",
  categoryId: TOPS,
  name: { vi: "Áo thun", en: "T-shirt" },
  description: {},
  material: {},
  fit: {},
  care: {},
  price: 250_000,
  colours: [{ id: RED, name: { vi: "Đỏ" }, swatch: "#aa0000" }],
  sizes: [{ id: SMALL, label: "S", heightCm: null, weightKg: null }],
  soldOut: [],
  status: "draft",
  publishedAt: null,
  photos: PHOTOS.map((id) => ({ id, colourId: null, alt: {}, state: "ready" as const })),
  createdAt: NOW,
  updatedAt: NOW,
  version: 3,
}

/** The item editor over its own state, recording every call but `onChange`. */
function ItemEditor(
  { calls, item = null, errors = {}, draft, reorder = false, shareLinks }: {
    calls: unknown[][]
    item?: CatalogItem | null
    errors?: Record<string, string>
    draft?: (value: CatalogItemDraft) => void
    /** Moves the photos as the app does, instead of only recording the move. */
    reorder?: boolean
    shareLinks?: CatalogShareLinksState
  },
) {
  const [value, setValue] = useState(catalogItemDraft(item))
  const [current, setCurrent] = useState(item)
  const [busy, setBusy] = useState(false)
  const props: AdminCatalogItemScreenProps = {
    item: current,
    settings: SETTINGS,
    categories: [categoryOf()],
    loading: false,
    notFound: false,
    value,
    onChange: (next) => {
      draft?.(next)
      setValue(next)
    },
    errors,
    saving: false,
    onSave: () => calls.push(["save"]),
    onPublish: () => calls.push(["publish"]),
    onHide: () => calls.push(["hide"]),
    onDelete: () => calls.push(["delete"]),
    photos: { uploading: 0, busy, error: null },
    onUpload: (files) => calls.push(["upload", files.length]),
    onPhotoMove: (from, to) => {
      calls.push(["move", from, to])
      if (!reorder || !current) return
      // As the app does: busy while the API answers, then the new order. A browser drops focus
      // from a node it moves, so the moved row loses it here too.
      setBusy(true)
      setTimeout(() => {
        ;(document.activeElement as HTMLElement | null)?.blur()
        const photos = [...current.photos]
        photos.splice(to, 0, ...photos.splice(from, 1))
        setCurrent({ ...current, photos })
        setBusy(false)
      })
    },
    onPhotoSave: (id, change) => calls.push(["photo", id, change]),
    onPhotoRemove: (id) => calls.push(["remove", id]),
    shareLinks,
  }
  return <AdminCatalogItemScreen {...props} />
}

const ZALO = "0195f0b4-3c1e-7a00-8000-0000000000e1"
const FRIENDS = "0195f0b4-3c1e-7a00-8000-0000000000e2"

function sourceOf(overrides: Partial<CatalogLinkSource> = {}): CatalogLinkSource {
  return {
    id: ZALO,
    name: "Zalo group A",
    slug: "zalo-a",
    position: 0,
    linkCount: 3,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    ...overrides,
  }
}

describe("the link sources list", () => {
  function props(calls: unknown[][], patch: Partial<AdminCatalogSourcesScreenProps> = {}) {
    return {
      sources: [
        sourceOf(),
        sourceOf({ id: FRIENDS, name: "Friends", slug: "friends", position: 1, linkCount: 0 }),
      ],
      tracking: true,
      error: null,
      busy: false,
      onRetry: () => {},
      onMove: (id: string, by: -1 | 1) => calls.push(["move", id, by]),
      onDelete: (source: CatalogLinkSource) => calls.push(["delete", source.id]),
      ...patch,
    }
  }
  const row = (index: number) => document.querySelectorAll("[data-e2e=catalog-source-row]")[index]

  it("names each source's utm_source and how many links it has", async () => {
    await mount(<AdminCatalogSourcesScreen {...props([])} />)
    expect(row(0).textContent).toContain("Zalo group A")
    expect(row(0).textContent).toContain("utm_source=zalo-a · 3 links")
    expect(row(1).textContent).toContain("utm_source=friends · 0 links")
    expect(document.body.textContent).not.toContain(ADMIN_ENGLISH.t(TRACKING_OFF_NOTICE))
  })

  it("deletes a source only after the dialog says its shared links stop working", async () => {
    const calls: unknown[][] = []
    await mount(<AdminCatalogSourcesScreen {...props(calls)} />)
    await clickOn(row(0).querySelector("[data-e2e=catalog-source-menu]")!)
    await clickOn(row(0).querySelector("[data-e2e=catalog-source-delete]")!)
    expect(find("dialog[open]").textContent).toContain(`Delete "Zalo group A"?`)
    expect(find("dialog[open]").textContent).toContain("Its 3 links stop working")
    expect(calls).toEqual([])
    await clickOn(button("Delete source"))
    expect(calls).toEqual([["delete", ZALO]])
  })

  it("moves a source down from its menu", async () => {
    const calls: unknown[][] = []
    await mount(<AdminCatalogSourcesScreen {...props(calls)} />)
    await clickOn(row(0).querySelector("[data-e2e=catalog-source-menu]")!)
    expect(row(0).querySelector("[data-e2e=catalog-source-up]")).toBeNull()
    await clickOn(row(0).querySelector("[data-e2e=catalog-source-down]")!)
    expect(calls).toEqual([["move", ZALO, 1]])
  })

  it("says what to set while items get no links, and offers a first source", async () => {
    await mount(<AdminCatalogSourcesScreen {...props([], { tracking: false, sources: [] })} />)
    expect(find("[data-e2e=catalog-sources-tracking-off]").textContent).toBe(
      ADMIN_ENGLISH.t(TRACKING_OFF_NOTICE),
    )
    expect(document.body.textContent).toContain("No sources yet")
  })
})

describe("the link source editor", () => {
  it("fills the source tag from the name until it is typed, and focuses a refused field", async () => {
    function Harness({ errors }: { errors: Record<string, string> }) {
      const [value, setValue] = useState({ name: "", slug: "", slugEdited: false })
      return (
        <AdminCatalogSourceEditorScreen
          source={null}
          loading={false}
          notFound={false}
          value={value}
          onChange={setValue}
          errors={errors}
          saving={false}
          onSave={() => {}}
        />
      )
    }
    await mount(<Harness errors={{}} />)
    const name = find<HTMLInputElement>("[data-e2e=catalog-source-name]")
    const slug = find<HTMLInputElement>("[data-e2e=catalog-source-slug]")
    await type(name, "Nhóm Zalo A")
    expect(slug.value).toBe("nhom-zalo-a")
    await type(slug, "zalo-a")
    await type(name, "Zalo group A")
    expect(slug.value).toBe("zalo-a")
    await mount(<Harness errors={{ slug: "Another source has this utm_source. Pick another." }} />)
    expect(document.activeElement === slug).toBe(true)
  })

  it("says a used source's links keep their addresses, in the right number", async () => {
    const editor = (linkCount: number) => (
      <AdminCatalogSourceEditorScreen
        source={sourceOf({ linkCount })}
        loading={false}
        notFound={false}
        value={{ name: "Zalo group A", slug: "zalo-a", slugEdited: true }}
        onChange={() => {}}
        errors={{}}
        saving={false}
        onSave={() => {}}
      />
    )
    const note = () => document.querySelector("[data-e2e=catalog-source-links-note]")
    await mount(editor(1))
    expect(note()?.textContent).toContain("Its link keeps its address")
    await mount(editor(3))
    expect(note()?.textContent).toContain("Its 3 links keep their addresses")
    await mount(editor(0))
    expect(note() === null).toBe(true)
  })
})

describe("the item editor's share links", () => {
  const LINK = "https://shop.example/s/AbCdEfGh_-1"
  const share = (calls: unknown[][], patch: Partial<CatalogShareLinksState> = {}) => ({
    sources: [sourceOf(), sourceOf({ id: FRIENDS, name: "Friends", slug: "friends" })],
    links: { [ZALO]: LINK },
    copying: null,
    onCopy: (sourceId: string) => calls.push(["copy", sourceId]),
    ...patch,
  })
  const rows = () => [...document.querySelectorAll("[data-e2e=catalog-item-link]")]

  it("copies a source's link with its own named button, and shows a link once made", async () => {
    const calls: unknown[][] = []
    await mount(<ItemEditor calls={calls} item={ITEM_SAVED} shareLinks={share(calls)} />)
    const [zalo, friends] = rows()
    expect(zalo.querySelector("[data-e2e=catalog-item-link-url]")!.textContent).toBe(LINK)
    expect(friends.querySelector("[data-e2e=catalog-item-link-url]")!.textContent)
      .toBe("No link yet · utm_source=friends")
    const copy = friends.querySelector<HTMLButtonElement>("[data-e2e=catalog-item-link-copy]")!
    expect(copy.getAttribute("aria-label")).toBe("Copy link for Friends")
    expect(copy.type).toBe("button")
    await clickOn(copy)
    expect(calls).toEqual([["copy", FRIENDS]])
  })

  it("lets the other buttons wait while one link is being made", async () => {
    const calls: unknown[][] = []
    await mount(
      <ItemEditor calls={calls} item={ITEM_SAVED} shareLinks={share(calls, { copying: ZALO })} />,
    )
    const friends = rows()[1].querySelector<HTMLButtonElement>("[data-e2e=catalog-item-link-copy]")!
    expect(friends.disabled).toBe(true)
    expect(document.body.textContent).toContain(
      "The links open the item once it is on the website.",
    )
  })

  it("offers a first source when there are none, and shows nothing on a new item", async () => {
    await mount(<ItemEditor calls={[]} item={ITEM_SAVED} shareLinks={share([], { sources: [] })} />)
    expect(find("[data-e2e=catalog-item-source-new]").getAttribute("href"))
      .toBe("/catalog/sources/new")
    await act(() => render(null, root!))
    await mount(<ItemEditor calls={[]} item={null} shareLinks={share([])} />)
    expect(document.querySelector("[data-e2e=catalog-item-links]") === null).toBe(true)
  })
})

describe("the item editor", () => {
  it("keeps the name per language and fills the address from the default one", async () => {
    let last: CatalogItemDraft | null = null
    await mount(<ItemEditor calls={[]} draft={(value) => (last = value)} />)
    await type(find("[data-e2e=catalog-item-name]"), "Áo khoác zip")
    const tabs = [...document.querySelectorAll("[data-e2e=catalog-item-language]")]
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Tiếng Việt (default)", "English"])
    await clickOn(tabs[1])
    await type(find("[data-e2e=catalog-item-name]"), "Zip jacket")
    expect(last!.name).toEqual({ vi: "Áo khoác zip", en: "Zip jacket" })
    expect(last!.slug).toBe("ao-khoac-zip")
  })

  it("opens the tab of a refused text and puts focus on it", async () => {
    await mount(<ItemEditor calls={[]} errors={{ "description:en": "Keep it shorter." }} />)
    await settle()
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("catalog-item-description")
    expect(document.activeElement?.getAttribute("lang")).toBe("en")
  })

  it("marks a colour and size sold out when its box is unticked", async () => {
    let last: CatalogItemDraft | null = null
    await mount(<ItemEditor calls={[]} item={ITEM_SAVED} draft={(value) => (last = value)} />)
    const box = find<HTMLInputElement>("[data-e2e=catalog-item-in-stock]")
    expect(box.getAttribute("aria-label")).toBe("Đỏ, S: in stock")
    expect(box.checked).toBe(true)
    box.checked = false
    await act(() => {
      box.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
    })
    expect(last!.soldOut).toEqual([`${RED}/${SMALL}`])
  })

  it("puts focus on a new size's label", async () => {
    await mount(<ItemEditor calls={[]} item={ITEM_SAVED} />)
    await clickOn(find("[data-e2e=catalog-item-add-size]"))
    const labels = document.querySelectorAll("[data-e2e=catalog-item-size-label]")
    expect(labels).toHaveLength(2)
    expect(document.activeElement).toBe(labels[1])
  })

  it("asks for photos only once the item is saved", async () => {
    await mount(<ItemEditor calls={[]} />)
    expect(find("[data-e2e=catalog-item-photos-later]").textContent).toContain("Save the draft")
    expect(document.querySelector("[data-e2e=catalog-item-publish]")).toBeNull()
  })

  it("publishes a saved draft only after the dialog is confirmed", async () => {
    const calls: unknown[][] = []
    await mount(<ItemEditor calls={calls} item={ITEM_SAVED} />)
    await clickOn(find("[data-e2e=catalog-item-publish]"))
    expect(calls).toEqual([])
    await clickOn(button("Publish"))
    expect(calls).toEqual([["publish"]])
  })

  it("makes a photo the cover from its row's menu, named for the photo, and keeps focus on it", async () => {
    const calls: unknown[][] = []
    await mount(<ItemEditor calls={calls} item={ITEM_SAVED} reorder />)
    const menus = () => [...document.querySelectorAll("[data-e2e=catalog-item-photo-menu]")]
    expect(menus().map((menu) => menu.getAttribute("aria-label"))).toEqual([
      "More actions for Photo 1, the cover",
      "More actions for Photo 2",
    ])
    const second = menus()[1].closest("[data-e2e=catalog-item-photo]")!
    await clickOn(menus()[1])
    const cover = second.querySelector("[data-e2e=catalog-item-photo-cover]")!
    expect(cover.textContent).toBe("Make cover: Photo 2")
    expect(second.querySelector("[data-e2e=catalog-item-photo-remove]")?.textContent).toBe(
      "Remove: Photo 2",
    )
    await clickOn(cover)
    await settle()
    await settle()

    expect(calls).toEqual([["move", 1, 0]])
    const row = document.activeElement?.closest("[data-e2e=catalog-item-photo]")
    expect(document.activeElement).toBe(menus()[0])
    expect(row?.querySelector("img")?.getAttribute("src")).toContain(PHOTOS[1])
  })

  it("gives the stock boxes and the small buttons a 44px tap area on a phone", async () => {
    await mount(<ItemEditor calls={[]} item={ITEM_SAVED} />)
    const box = find("[data-e2e=catalog-item-in-stock]").closest("label")!
    expect(box.className).toContain("size-11")
    for (
      const hook of [
        "catalog-item-add-colour",
        "catalog-item-add-size",
        "catalog-item-remove-colour",
        "catalog-item-remove-size",
      ]
    ) {
      expect(find(`[data-e2e=${hook}]`).className).toContain("min-h-11")
    }
    expect(find("[data-e2e=catalog-item-photo-menu]").className).toContain("size-11")
  })

  it("shows the price as the website will, with its separators", async () => {
    await mount(<ItemEditor calls={[]} item={ITEM_SAVED} />)
    expect(document.body.textContent).toContain("Shown as ₫250,000")
  })
})

describe("the item editor's checks", () => {
  const draft = (patch: Partial<CatalogItemDraft>) => ({
    ...catalogItemDraft(ITEM_SAVED),
    ...patch,
  })

  it("takes a size's height range only with both ends", () => {
    const size = {
      id: SMALL,
      label: "S",
      heightMin: "150",
      heightMax: "",
      weightMin: "",
      weightMax: "",
    }
    expect(catalogItemFields(draft({ sizes: [size] }), SETTINGS.languages)).toEqual({
      ok: false,
      field: `size:${SMALL}`,
      message: "Enter both ends of the height, or neither.",
    })
    const whole = catalogItemFields(
      draft({ sizes: [{ ...size, heightMax: "162" }] }),
      SETTINGS.languages,
    )
    expect(whole.ok && whole.fields.sizes[0].heightCm).toEqual({ min: 150, max: 162 })
  })

  it("drops a sold-out mark of a colour that was removed", () => {
    const checked = catalogItemFields(
      draft({ colours: [], soldOut: [`${RED}/${SMALL}`] }),
      SETTINGS.languages,
    )
    expect(checked.ok && checked.fields.soldOut).toEqual([])
  })

  it("asks for a price", () => {
    expect(catalogItemFields(draft({ price: null }), SETTINGS.languages)).toMatchObject({
      ok: false,
      field: "price",
    })
  })
})

describe("the catalog in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    const categories = [categoryOf(), categoryOf({ id: ITEM, slug: "mu", name: { vi: "Mũ" } })]
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <ListScreen
          catalog={{ settings: SETTINGS, categories, items: ROWS, sources: [], tracking: true }}
        />
        <AdminCatalogCategoriesScreen
          categories={categories}
          languages={SETTINGS.languages}
          error={null}
          busy={false}
          onRetry={() => {}}
          onMove={() => {}}
          onDelete={() => {}}
        />
        <AdminCatalogCategoryEditorScreen
          category={null}
          languages={SETTINGS.languages}
          loading={false}
          notFound={false}
          value={{ name: {}, slug: "", slugEdited: false }}
          onChange={() => {}}
          errors={{}}
          saving={false}
          onSave={() => {}}
        />
      </I18nContext.Provider>,
    )
    await clickOn(document.querySelectorAll("[data-e2e=catalog-category-menu]")[1])
    const data = [`Áo thun`, `Mũ len`, `Áo khoác`, /\b(ao|mu)\b/g]
    expect(englishLeft(document.body, data)).toEqual([])
  })
})

describe("the link sources in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    const zalo = sourceOf()
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminCatalogSourcesScreen
          sources={[zalo, sourceOf({ id: FRIENDS, name: "Friends", slug: "friends" })]}
          tracking={false}
          error={null}
          busy={false}
          onRetry={() => {}}
          onMove={() => {}}
          onDelete={() => {}}
        />
        <AdminCatalogSourceEditorScreen
          source={zalo}
          loading={false}
          notFound={false}
          value={{ name: zalo.name, slug: zalo.slug, slugEdited: true }}
          onChange={() => {}}
          errors={{}}
          saving={false}
          onSave={() => {}}
        />
      </I18nContext.Provider>,
    )
    await clickOn(document.querySelectorAll("[data-e2e=catalog-source-menu]")[1])
    await clickOn(document.querySelectorAll("[data-e2e=catalog-source-delete]")[0])
    expect(document.querySelector("dialog[open]")).not.toBeNull()
    const data = [/Zalo group A/g, /Friends/g, /utm_source=[a-z-]+/g, /zalo-a/g, /MPA_DOMAIN/g]
    expect(englishLeft(document.body, data)).toEqual([])
  })
})
