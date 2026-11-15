/**
 * The operator area's Imports list, driven in a browser DOM (happy-dom): the status chips with
 * their counts, what a row shows and leaves out, paging, the empty and failed states, and no
 * English left in another language.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { createFormatters } from "@spy4x/time/format"
import {
  type AdminImportFilter,
  type AdminImportListResponse,
  type AdminImportRow,
  ImportStatus,
} from "@domain/imports"
import { AdminImportsScreen, type AdminImportsScreenProps } from "./admin-imports-screen.tsx"
import { ADMIN_PSEUDO, englishLeft } from "./i18n-testing.ts"

const window = new Window({ url: "http://admin.localhost/" })
const own = { document: globalThis.document, FormData: globalThis.FormData }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document, FormData: window.FormData })
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

async function mount(node: VNode): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() =>
    render(
      <FormatContext.Provider
        value={createFormatters({ locale: "en-GB", timeZone: "UTC", hourCycle: null })}
      >
        {node}
      </FormatContext.Provider>,
      root!,
    )
  )
}

function find(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as HTMLElement
}

const text = (selector: string) => find(selector).textContent?.replace(/\s+/g, " ").trim() ?? ""

async function click(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

const GROUP = "01920000-0000-7000-8000-0000000000aa"

/** A saved import: 3 rows, 2 saved, 1 left out, read in 2 s and saved in 5.5 s. */
const saved: AdminImportRow = {
  id: "01920000-0000-7000-8000-000000000001",
  group: { id: GROUP, name: "Team Alpha" },
  kind: "notes",
  status: ImportStatus.COMMITTED,
  uploaderId: 42,
  rowCount: 3,
  savedCount: 2,
  errorCount: 1,
  skippedCount: null,
  failure: null,
  createdAt: "2026-11-15T10:00:00.000Z",
  readAt: "2026-11-15T10:00:02.000Z",
  failedAt: null,
  commitRequestedAt: "2026-11-15T10:01:00.000Z",
  committedAt: "2026-11-15T10:01:05.500Z",
  undoneAt: null,
  readMs: 2000,
  saveMs: 5500,
}

/** A file that could not be read. */
const failed: AdminImportRow = {
  ...saved,
  id: "01920000-0000-7000-8000-000000000002",
  status: ImportStatus.FAILED,
  rowCount: null,
  savedCount: null,
  errorCount: null,
  failure: "The file is not text.",
  readAt: null,
  failedAt: "2026-11-15T10:00:01.000Z",
  commitRequestedAt: null,
  committedAt: null,
  readMs: 1000,
  saveMs: null,
}

const LIST: AdminImportListResponse = {
  imports: [saved, failed],
  counts: { all: 2, failed: 1, reading: 0, ready: 0, committing: 0, committed: 1, undone: 0 },
  total: 2,
  page: 1,
  pageSize: 50,
}

function page(overrides: Partial<AdminImportsScreenProps> = {}) {
  const filters: AdminImportFilter[] = []
  const reloads: number[] = []
  const props: AdminImportsScreenProps = {
    filter: { status: `all`, page: 1 },
    list: LIST,
    pending: false,
    error: null,
    onFilter: (filter) => filters.push(filter),
    onReload: () => reloads.push(1),
    ...overrides,
  }
  return { node: <AdminImportsScreen {...props} />, filters, reloads }
}

describe("the admin imports list", () => {
  it("counts each status on its chip, and a chip asks for its status from the first page", async () => {
    const { node, filters } = page({ filter: { status: `all`, page: 3 } })
    await mount(node)
    expect(find(`[data-e2e="admin-imports-chip-failed"]`).closest("label")?.textContent)
      .toContain("Failed 1")
    expect(text(`[data-e2e="admin-imports-count"]`)).toBe("2 imports")
    await click(find(`[data-e2e="admin-imports-chip-failed"]`))
    expect(filters).toEqual([{ status: `failed`, page: 1 }])
  })

  it("says on its own line that file contents are never shown", async () => {
    await mount(page().node)
    expect(text(`[data-e2e="admin-imports-private"]`))
      .toBe("File contents and row values are never shown here.")
  })

  it("shows a row's group, kind, uploader, counts and timing, linking the group and the person", async () => {
    await mount(page().node)
    const row = find(`[data-e2e="admin-import-${saved.id}"]`).closest("tr")!
    const group = row.querySelector(`[data-e2e="admin-import-group"]`)!
    expect(group.textContent).toBe("Team Alpha")
    expect(group.getAttribute("href")).toBe(`/groups/${GROUP}`)
    expect(row.querySelector(`[data-e2e="admin-import-uploader"]`)?.getAttribute("href"))
      .toBe("/users/42")
    expect(row.textContent).toContain("notes")
    expect(row.querySelector(`[data-e2e="admin-import-status"]`)?.getAttribute("data-status"))
      .toBe("committed")
    expect(row.querySelector(`[data-e2e="admin-import-counts"]`)?.textContent)
      .toBe("3 rows · 2 saved · 1 left out")
    expect(row.querySelector(`[data-e2e="admin-import-timing"]`)?.textContent)
      .toBe("Read in 2s · saved in 5.5s")
  })

  it("says why an import failed, and shows no count it never had", async () => {
    await mount(page().node)
    const row = find(`[data-e2e="admin-import-${failed.id}"]`).closest("tr")!
    expect(row.querySelector(`[data-e2e="admin-import-failure"]`)?.textContent)
      .toBe("The file is not text.")
    expect(row.querySelector(`[data-e2e="admin-import-counts"]`)?.textContent).toBe("—")
    expect(row.querySelector(`[data-e2e="admin-import-timing"]`)?.textContent).toBe("Read in 1s")
  })

  it("offers every import again when a status has none", async () => {
    const empty = { ...LIST, imports: [], total: 0 }
    const { node, filters } = page({ filter: { status: `undone`, page: 1 }, list: empty })
    await mount(node)
    const showAll = [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Show all")!
    await click(showAll)
    expect(filters).toEqual([{ status: `all`, page: 1 }])
  })

  it("says the list could not load and reads it again on Try again", async () => {
    const { node, reloads } = page({ list: null, error: "offline" })
    await mount(node)
    expect(text(`[data-e2e="admin-imports-error"]`)).toContain("Couldn't load the imports")
    await click(find(`[data-e2e="admin-imports-error"] button`))
    expect(reloads).toEqual([1])
  })

  it("shows no English in another language: every word is the catalog's or data", async () => {
    await mount(<I18nContext.Provider value={ADMIN_PSEUDO}>{page().node}</I18nContext.Provider>)
    expect(englishLeft(document.body, [`Team Alpha`, `notes`, `The file is not text.`])).toEqual([])
  })
})
