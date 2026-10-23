/**
 * The note's attachments section, `NoteAttachments`, driven in a browser DOM (happy-dom): choosing
 * and dropping files, removing one (asked first for a stored file), where focus goes, the quota
 * line and the viewer's read-only list.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { AttachmentItem } from "@spy4x/preact-ui/attachment-list"
import {
  ATTACH_BUTTON_ID,
  NoteAttachments,
  type NoteAttachmentsProps,
  quotaLine,
} from "./note-attachments.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
  })
  // A browser's elements have `ondrop` and the other drag handlers; happy-dom's lack them, and
  // Preact then listens for `Drop` instead of `drop`. Giving them the properties makes Preact
  // listen for the events a browser fires.
  for (const name of [`ondrop`, `ondragover`, `ondragleave`]) {
    if (!(name in window.HTMLElement.prototype)) {
      Object.defineProperty(window.HTMLElement.prototype, name, { value: null, writable: true })
    }
  }
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
  await act(() => render(node, root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

const has = (selector: string) => root?.querySelector(selector) != null

/** Lets queued microtasks and timers run inside `act`. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

async function clickOn(target: Element): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const click = (selector: string) => clickOn(find(selector))

async function clickText(label: string): Promise<void> {
  const target = [...document.querySelectorAll("button, a, [role=menuitem]")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!target) throw new Error(`no control reads ${label}`)
  await clickOn(target as unknown as Element)
}

/** Records the calls a callback gets. */
function spy<A extends unknown[], R = void>(result?: R) {
  const calls: A[] = []
  return { calls, fn: (...args: A) => (calls.push(args), result as R) }
}

const MB = 1024 * 1024
const pdf: AttachmentItem = {
  id: `0199c3a0-0000-7000-8000-000000000101`,
  name: `scan.pdf`,
  size: MB,
  type: `application/pdf`,
  status: `ready`,
}
const png: AttachmentItem = {
  id: `0199c3a0-0000-7000-8000-000000000102`,
  name: `tickets.png`,
  size: 820 * 1024,
  type: `image/png`,
  status: `ready`,
}

const base: NoteAttachmentsProps = {
  groupId: `0199c3a0-0000-7000-8000-000000000001`,
  groupName: `Family`,
  items: [],
  usage: {
    files: 37,
    bytes: 41 * MB,
    maxFiles: 100,
    maxBytes: 200 * MB,
    maxFileBytes: 2 * MB,
    maxPerNote: 10,
  },
  refusals: [],
  plan: null,
  announcement: ``,
}

describe(`note attachments section`, () => {
  it(`hands a choice's accepted and refused files to onAdd as one batch`, async () => {
    const add = spy<[File[]]>()
    await mount(<NoteAttachments {...base} onAdd={add.fn} />)
    const input = find<HTMLInputElement>(`#${ATTACH_BUTTON_ID}-input`)
    const scan = new File([`x`], `scan.pdf`, { type: `application/pdf` })
    const heic = new File([`x`], `photo.heic`, { type: `image/heic` })
    Object.defineProperty(input, `files`, { configurable: true, value: [scan, heic] })
    await act(() => {
      input.dispatchEvent(new window.Event(`change`, { bubbles: true }) as unknown as Event)
    })
    await settle()
    expect(add.calls.map(([files]) => files.map((file) => file.name))).toEqual([
      [`scan.pdf`, `photo.heic`],
    ])
  })

  it(`attaches files dropped anywhere on the section`, async () => {
    const add = spy<[File[]]>()
    await mount(<NoteAttachments {...base} items={[pdf]} onAdd={add.fn} />)
    const scan = new File([`x`], `map.jpg`, { type: `image/jpeg` })
    const event = new window.Event(`drop`, { bubbles: true, cancelable: true })
    Object.defineProperty(event, `dataTransfer`, {
      value: { files: [scan], types: [`Files`] },
    })
    await act(() => {
      find(`[data-e2e=note-attachments]`).dispatchEvent(event as unknown as Event)
    })
    await settle()
    expect(add.calls.map(([files]) => files.map((file) => file.name))).toEqual([[`map.jpg`]])
  })

  it(`asks before removing a stored file, names the group, then moves focus to Attach files`, async () => {
    const remove = spy<[string], Promise<string | null>>(Promise.resolve(null))
    const props = { ...base, items: [pdf], onRemove: remove.fn }
    await mount(<NoteAttachments {...props} />)

    await click(`[aria-label="Actions for scan.pdf"]`)
    await clickText(`Remove`)
    expect(remove.calls).toEqual([])
    const dialog = find(`[data-e2e=note-attachment-remove-dialog]`)
    expect(dialog.textContent).toContain(`Remove this file?`)
    expect(dialog.textContent).toContain(
      `"scan.pdf" will be removed from this note for everyone in Family.`,
    )

    await clickText(`Remove file`)
    expect(remove.calls).toEqual([[pdf.id]])
    // The app drops the row once the server removed it.
    await act(() => render(<NoteAttachments {...props} items={[]} />, root!))
    await settle()
    expect(document.activeElement?.id).toBe(ATTACH_BUTTON_ID)
  })

  it(`shows why a removal failed`, async () => {
    const sentence = `Could not remove scan.pdf. Check your connection and try again.`
    const remove = spy<[string], Promise<string | null>>(Promise.resolve(sentence))
    await mount(<NoteAttachments {...base} items={[pdf]} onRemove={remove.fn} />)
    await click(`[aria-label="Actions for scan.pdf"]`)
    await clickText(`Remove`)
    await clickText(`Remove file`)
    expect(find(`[data-e2e=note-attachments]`).textContent).toContain(sentence)
    expect(has(`[aria-label="Actions for scan.pdf"]`)).toBe(true)
  })

  it(`forgets a waiting file at once, with no question, as nothing of it is stored`, async () => {
    const cancel = spy<[string]>()
    const waiting = { ...pdf, status: `waiting` as const }
    await mount(<NoteAttachments {...base} items={[waiting]} onCancel={cancel.fn} />)
    await click(`[aria-label="Remove scan.pdf"]`)
    expect(cancel.calls).toEqual([[pdf.id]])
    expect(has(`[data-e2e=note-attachment-remove-dialog]`)).toBe(false)
  })

  it(`says a file chosen on a new note uploads when the note is created`, async () => {
    const waiting = { ...pdf, status: `waiting` as const }
    await mount(<NoteAttachments {...base} creating items={[waiting]} />)
    expect(find(`[data-e2e=note-attachments]`).textContent).toContain(
      `Uploads when you create the note`,
    )
  })

  it(`counts the note's files without the failed ones, against the plan's per-note limit`, async () => {
    const failed = { ...png, status: `failed` as const }
    await mount(<NoteAttachments {...base} items={[pdf, failed]} />)
    expect(find(`[data-e2e=note-attachments-count]`).textContent).toBe(`1 of 10`)
  })

  it(`shows the drop zone with the rules when the note has no files`, async () => {
    await mount(<NoteAttachments {...base} />)
    const empty = find(`[data-e2e=note-attachments-empty]`).textContent
    expect(empty).toContain(`Attach images or PDFs: drop them here or choose files.`)
    expect(empty).toContain(`JPEG, PNG, WebP, GIF or PDF, up to 2 MB each.`)
  })

  it(`gives a viewer the list only, and nothing when the note has no files`, async () => {
    await mount(
      <NoteAttachments {...base} readOnly items={[pdf]} onDownload={() => Promise.resolve(null)} />,
    )
    expect(has(`#${ATTACH_BUTTON_ID}`)).toBe(false)
    expect(has(`[data-e2e=note-attachments-quota]`)).toBe(false)
    expect(has(`[aria-label="Download scan.pdf"]`)).toBe(true)
    await click(`[aria-label="Actions for scan.pdf"]`)
    await expect(clickText(`Remove`)).rejects.toThrow(`no control reads Remove`)

    await act(() => render(<NoteAttachments {...base} readOnly />, root!))
    expect(has(`[data-e2e=note-attachments]`)).toBe(false)
  })

  it(`says in words, not only in colour, that the group's room is almost full`, async () => {
    await mount(<NoteAttachments {...base} usage={{ ...base.usage!, files: 90 }} />)
    expect(find(`[data-e2e=note-attachments-quota]`).textContent).toBe(
      `Almost full. Family uses 90 of 100 files and 41 MB of 200 MB.`,
    )
    await act(() => render(<NoteAttachments {...base} />, root!))
    expect(find(`[data-e2e=note-attachments-quota]`).textContent?.trim()).toBe(
      `Family uses 37 of 100 files and 41 MB of 200 MB.`,
    )
  })

  it(`names each refused file and announces a finished upload`, async () => {
    await mount(
      <NoteAttachments
        {...base}
        items={[pdf]}
        refusals={[`photo.heic cannot be attached.`]}
        announcement={`scan.pdf uploaded`}
      />,
    )
    expect(find(`[data-e2e=note-attachments-refusals]`).textContent).toContain(`photo.heic`)
    expect(find(`[role=status]`).textContent).toBe(`scan.pdf uploaded`)
  })
})

describe(`quota line`, () => {
  it(`names the group, its files and its bytes against the plan's caps`, () => {
    expect(quotaLine(`Family`, base.usage!)).toEqual({
      text: `Family uses 37 of 100 files and 41 MB of 200 MB.`,
      warn: false,
    })
  })

  it(`turns to the warning tone from 90 % of either cap`, () => {
    expect(quotaLine(`Family`, { ...base.usage!, files: 90 }).warn).toBe(true)
    expect(quotaLine(`Family`, { ...base.usage!, bytes: 180 * MB }).warn).toBe(true)
    expect(quotaLine(`Family`, { ...base.usage!, files: 89, bytes: 179 * MB }).warn).toBe(false)
  })

  it(`leaves out a cap the plan does not set`, () => {
    expect(quotaLine(`Family`, { ...base.usage!, maxFiles: null, maxBytes: null }).text).toBe(
      `Family uses 37 files and 41 MB.`,
    )
  })
})
