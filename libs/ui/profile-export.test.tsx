/**
 * The profile's "Your data" row and the admin's "Data exports" tab (#229), driven in a browser DOM
 * (happy-dom): what each state says, what the one action does, and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import { type DataExportJson, DataExportStatus, type DataExportView } from "@domain/identity"
import {
  DATA_EXPORT_ANCHOR,
  type DataExportError,
  DataExportErrorState,
  DataExportRow,
  type DataExportRowProps,
} from "./profile-export.tsx"
import { AdminPersonDataExportsPanel } from "./admin-person-data-exports.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, HTMLElement: globalThis.HTMLElement }

beforeAll(() => {
  Object.assign(globalThis, { document: window.document, HTMLElement: window.HTMLElement })
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

/** One region format for every date, whatever the host's locale: "30 Oct 2026". */
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement(`div`)
  document.body.append(root)
  await act(() =>
    render(<FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>, root!)
  )
  return root
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() =>
    render(<FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>, root!)
  )
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent(`click`, { bubbles: true }) as unknown as Event,
    )
  })
}

const text = (selector: string) => find(selector).textContent?.replace(/\s+/g, ` `).trim()

const NOW = Date.parse(`2026-10-23T12:00:00.000Z`)
const HOUR = 3_600_000

function view(status: DataExportStatus, overrides: Partial<DataExportView> = {}): DataExportView {
  const ready = status === DataExportStatus.Ready || status === DataExportStatus.Expired
  return {
    id: `019a1b2c-0000-7000-8000-000000000001`,
    status,
    requestedAt: new Date(NOW - 2 * HOUR),
    readyAt: ready ? new Date(NOW - HOUR) : null,
    expiresAt: ready ? new Date(`2026-10-30T10:00:00.000Z`) : null,
    sizeBytes: ready ? 2_400_000 : null,
    nextRequestAt: new Date(NOW + 22 * HOUR),
    ...overrides,
  }
}

function row(props: Partial<DataExportRowProps> = {}) {
  const requests: number[] = []
  const node = (
    <DataExportRow
      exportState={null}
      pending={false}
      error={null}
      onRequest={() => requests.push(1)}
      downloadHref="/api/account/data-export/download"
      now={NOW}
      {...props}
    />
  )
  return { node, requests }
}

describe(`DataExportRow`, () => {
  it(`offers Download my data to a person who never asked, and asks once per click`, async () => {
    const { node, requests } = row()
    await mount(node)
    expect(text(`[data-e2e=data-export-state]`)).toBe(
      `A ZIP of your profile, groups and notes, as JSON and CSV files. It takes a few minutes, ` +
        `and we e-mail you when it is ready.`,
    )
    expect(find(`[data-e2e=data-export-request]`).id).toBe(DATA_EXPORT_ANCHOR)
    await click(`[data-e2e=data-export-request]`)
    expect(requests).toEqual([1])
  })

  it(`does not ask again while a request is on its way`, async () => {
    const { node, requests } = row({ pending: true })
    await mount(node)
    const button = find<HTMLButtonElement>(`[data-e2e=data-export-request]`)
    expect(button.getAttribute(`aria-busy`) === `true` || button.disabled).toBe(true)
    await click(`[data-e2e=data-export-request]`)
    expect(requests).toEqual([])
  })

  it(`keeps Prepare a new file focusable but asks nothing while a request is on its way`, async () => {
    const ready = view(DataExportStatus.Ready, { nextRequestAt: new Date(NOW - 1) })
    const { node, requests } = row({ exportState: ready, pending: true })
    await mount(node)
    const again = find<HTMLButtonElement>(`[data-e2e=data-export-again]`)
    // A disabled button drops focus to the page in a browser; aria-disabled keeps it in place.
    expect([again.disabled, again.getAttribute(`aria-disabled`)]).toEqual([false, `true`])
    await click(`[data-e2e=data-export-again]`)
    expect(requests).toEqual([])
  })

  it(`keeps focus on the row when a keyboard request takes its button away`, async () => {
    const { node } = row()
    await mount(node)
    find(`[data-e2e=data-export-request]`).focus()
    await click(`[data-e2e=data-export-request]`)
    await rerender(row({ pending: true }).node)
    await rerender(row({ exportState: view(DataExportStatus.Preparing) }).node)

    expect(document.activeElement === find(`[data-e2e=data-export-state]`)).toBe(true)
  })

  it(`keeps focus on the row when Prepare a new file takes the ready file's actions away`, async () => {
    const ready = view(DataExportStatus.Ready, { nextRequestAt: new Date(NOW - 1) })
    await mount(row({ exportState: ready }).node)
    find(`[data-e2e=data-export-again]`).focus()
    await click(`[data-e2e=data-export-again]`)
    await rerender(row({ exportState: ready, pending: true }).node)
    await rerender(row({ exportState: view(DataExportStatus.Preparing) }).node)

    expect(document.activeElement === find(`[data-e2e=data-export-state]`)).toBe(true)
  })

  it(`leaves focus alone when a refused request keeps its button`, async () => {
    const { node } = row()
    await mount(node)
    find(`[data-e2e=data-export-request]`).focus()
    await click(`[data-e2e=data-export-request]`)
    await rerender(row({ pending: true }).node)
    await rerender(row({ error: { kind: `network` } }).node)

    expect(document.activeElement === find(`[data-e2e=data-export-request]`)).toBe(true)
  })

  it(`announces a file in preparation in a live region and offers no action`, async () => {
    const { node } = row({ exportState: view(DataExportStatus.Preparing) })
    await mount(node)
    const state = find(`[data-e2e=data-export-state]`)
    expect(state.getAttribute(`role`)).toBe(`status`)
    expect(state.textContent).toContain(`Preparing your file.`)
    // The row's anchor moves to the state itself, so a link to `#your-data` still lands here.
    expect(state.id).toBe(DATA_EXPORT_ANCHOR)
    expect(document.querySelectorAll(`[data-e2e=data-export-request]`)).toHaveLength(0)
  })

  it(`links a ready file to the download address with its size and last day`, async () => {
    const { node } = row({ exportState: view(DataExportStatus.Ready) })
    await mount(node)
    const link = find<HTMLAnchorElement>(`[data-e2e=data-export-download]`)
    expect(link.getAttribute(`href`)).toBe(`/api/account/data-export/download`)
    expect(link.hasAttribute(`download`)).toBe(true)
    expect(link.id).toBe(DATA_EXPORT_ANCHOR)
    expect(text(`[data-e2e=data-export-state]`)).toMatch(
      /^Your file is ready\. Ready: 2\.3 MB, until 30 Oct 2026\.$/,
    )
    // Within the day the person asked, they cannot ask again.
    expect(document.querySelectorAll(`[data-e2e=data-export-again]`)).toHaveLength(0)
  })

  it(`offers a new file beside a ready one once a day has passed`, async () => {
    const { node, requests } = row({
      exportState: view(DataExportStatus.Ready, { nextRequestAt: new Date(NOW - 1) }),
    })
    await mount(node)
    await click(`[data-e2e=data-export-again]`)
    expect(requests).toEqual([1])
  })

  it(`says when the last file expired and offers a new one`, async () => {
    const { node, requests } = row({ exportState: view(DataExportStatus.Expired) })
    await mount(node)
    expect(text(`[data-e2e=data-export-state]`)).toMatch(/^Your last file expired on .*30/)
    expect(text(`[data-e2e=data-export-request]`)).toBe(`Prepare a new file`)
    await click(`[data-e2e=data-export-request]`)
    expect(requests).toEqual([1])
  })

  it(`says a file failed and offers Try again`, async () => {
    const { node } = row({ exportState: view(DataExportStatus.Failed) })
    await mount(node)
    expect(text(`[data-e2e=data-export-state]`)).toBe(`We could not prepare your file.`)
    expect(text(`[data-e2e=data-export-request]`)).toBe(`Try again`)
  })
})

describe(`DataExportErrorState`, () => {
  async function shown(error: DataExportError | null) {
    await mount(<DataExportErrorState error={error} />)
    return document.querySelector<HTMLElement>(`[data-e2e=data-export-error]`)
  }

  it(`tells a refused person when they may ask again, and takes focus`, async () => {
    const retryAt = new Date(Date.now() + 25 * HOUR)
    const element = await shown({ kind: `too-soon`, retryAt })
    expect(element?.textContent).toMatch(
      /^You can ask for one file a day\. Ask again after .+ tomorrow\.$/,
    )
    expect(document.activeElement === element || element!.contains(document.activeElement)).toBe(
      true,
    )
  })

  it(`names a failed request`, async () => {
    const element = await shown({ kind: `network` })
    expect(element?.textContent).toBe(
      `Could not ask for your file. Check your connection and try again.`,
    )
  })

  it(`shows nothing without an error`, async () => {
    expect(await shown(null)).toBeNull()
  })
})

describe(`AdminPersonDataExportsPanel`, () => {
  const json = (status: DataExportStatus, id: string): DataExportJson => ({
    id,
    status,
    requestedAt: `2026-10-23T10:00:00.000Z`,
    readyAt: status === DataExportStatus.Preparing ? null : `2026-10-23T10:05:00.000Z`,
    expiresAt: status === DataExportStatus.Preparing ? null : `2026-10-30T10:05:00.000Z`,
    sizeBytes: status === DataExportStatus.Preparing ? null : 1024,
    nextRequestAt: `2026-10-24T10:00:00.000Z`,
  })

  it(`lists each export with its state and size, and offers the operator no download`, async () => {
    await mount(
      <AdminPersonDataExportsPanel
        exports={[json(DataExportStatus.Ready, `b`), json(DataExportStatus.Preparing, `a`)]}
        error={null}
      />,
    )
    expect(text(`[data-e2e=admin-person-data-export-b]`)).toMatch(
      /^Requested .+Ready\s?1 KB\s?Expires 30 Oct 2026$/,
    )
    expect(text(`[data-e2e=admin-person-data-export-a]`)).toMatch(/^Requested .+Preparing$/)
    expect(document.querySelectorAll(`[data-e2e=admin-person-data-exports] a`)).toHaveLength(0)
  })

  it(`says when the person never asked for one`, async () => {
    await mount(<AdminPersonDataExportsPanel exports={[]} error={null} />)
    expect(text(`[data-e2e=admin-person-data-exports]`)).toBe(`No data exports.`)
  })

  it(`shows the read's error`, async () => {
    await mount(<AdminPersonDataExportsPanel exports={null} error="Could not load." />)
    expect(document.body.textContent).toContain(`Could not load.`)
  })
})
