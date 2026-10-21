/**
 * The New note dialog in a browser DOM (happy-dom): where focus goes when it opens, after an
 * error and after an add; what Enter and Ctrl Enter ask for; and what it shows with no group, one
 * group or several.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import {
  NEW_NOTE_TEXT,
  type NewNoteAdded,
  NewNoteDialog,
  type NewNoteDialogProps,
  type NewNoteGroup,
} from "./new-note-dialog.tsx"
import { GROUP_PATHS, NOTE_PATHS } from "./progressive.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // EnhancedForm reads a form with the DOM's own FormData; a link is routed only on the page's
  // own origin (`location`); a dialog reads the page's style to lock its scroll.
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
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

const ACME: NewNoteGroup = { id: "0190a000-0000-7000-8000-000000000001", name: "Acme" }
const HOME: NewNoteGroup = { id: "0190a000-0000-7000-8000-000000000002", name: "Home" }

interface Calls {
  adds: boolean[]
  opened: string[]
  navigated: string[]
  closed: number
}

/** Draws the dialog open with `props` over sensible defaults, and records its callbacks. */
async function draw(props: Partial<NewNoteDialogProps> = {}, calls?: Calls): Promise<Calls> {
  const record = calls ?? { adds: [], opened: [], navigated: [], closed: 0 }
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() =>
    render(
      <NewNoteDialog
        open
        onClose={() => void record.closed++}
        groups={[ACME]}
        groupId={ACME.id}
        onGroupChange={() => {}}
        title="Buy milk"
        onTitleChange={() => {}}
        pending={false}
        errors={{}}
        added={null}
        onAdd={(openAfter) => void record.adds.push(openAfter)}
        onOpenNote={(id) => void record.opened.push(id)}
        navigate={(href) => void record.navigated.push(href)}
        {...props}
      />,
      root!,
    )
  )
  return record
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function focused(): string | null | undefined {
  return document.activeElement?.getAttribute("data-e2e")
}

/** Presses `key` in the title field, with Control held when `ctrl`. */
async function pressInTitle(key: string, ctrl = false): Promise<void> {
  const field = find("[data-e2e=new-note-title]")
  await act(async () => {
    field.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        ctrlKey: ctrl,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Submits the form the way Enter in the field does. */
async function submit(): Promise<void> {
  const form = find("[data-e2e=new-note-title]").closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const ADDED: NewNoteAdded = {
  noteId: "0190a000-0000-7000-8000-0000000000aa",
  groupId: ACME.id,
  title: "Buy milk",
  groupName: "Acme",
  onDevice: false,
}

describe("the New note dialog", () => {
  it("opens with the title focused and names the one group in a hint", async () => {
    await draw()
    expect(focused()).toBe("new-note-title")
    expect(document.querySelector("[data-e2e=new-note-group]")).toBeNull()
    expect(find("dialog").textContent).toContain("In Acme")
    expect(find<HTMLInputElement>("[data-e2e=new-note-title]").value).toBe("Buy milk")
  })

  it("focuses the title when the groups arrive after the dialog opened", async () => {
    const calls = await draw({ groups: [], groupId: null })
    await draw({}, calls)
    expect(focused()).toBe("new-note-title")
  })

  it("adds on Enter, and adds and opens on Ctrl Enter", async () => {
    const calls = await draw()
    await submit()
    await pressInTitle("Enter", true)
    expect(calls.adds).toEqual([false, true])
  })

  it("ignores a second submit while an add is on its way", async () => {
    const calls = await draw({ pending: true })
    await submit()
    expect(calls.adds).toEqual([])
    expect(find<HTMLButtonElement>("[data-e2e=new-note-submit]").getAttribute("aria-busy"))
      .toBe("true")
  })

  it("shows a title error under the field, tied to it, and focuses the field", async () => {
    const calls = await draw()
    find<HTMLButtonElement>("[data-e2e=new-note-submit]").focus()
    await draw({ errors: { title: "Enter a title." }, title: "" }, calls)
    const field = find("[data-e2e=new-note-title]")
    expect(focused()).toBe("new-note-title")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    const text = describedBy.split(" ").map((id) => document.getElementById(id)?.textContent)
    expect(text).toContain("Enter a title.")
  })

  it("starts several groups on the chosen one, and focuses the select when only it is wrong", async () => {
    const calls = await draw({ groups: [ACME, HOME], groupId: HOME.id })
    expect(find<HTMLSelectElement>("[data-e2e=new-note-group]").value).toBe(HOME.id)
    expect(find("dialog").textContent).not.toContain("In Home")
    await draw(
      { groups: [ACME, HOME], groupId: null, errors: { group: NEW_NOTE_TEXT.chooseGroupError } },
      calls,
    )
    expect(focused()).toBe("new-note-group")
    expect(find("dialog").textContent).toContain(NEW_NOTE_TEXT.chooseGroupError)
  })

  it("says what it added in a live region, with a link that opens the note", async () => {
    const calls = await draw()
    await draw({ title: "", added: ADDED }, calls)
    const status = find("[data-e2e=new-note-added]")
    expect(status.getAttribute("role")).toBe("status")
    expect(status.textContent).toContain("Added “Buy milk” to Acme.")
    expect(status.textContent).not.toContain(NEW_NOTE_TEXT.onDevice)
    expect(focused()).toBe("new-note-title")
    const link = find<HTMLAnchorElement>("[data-e2e=new-note-open]")
    expect(link.getAttribute("href")).toBe(NOTE_PATHS.note(ADDED.noteId))
    await act(() => {
      link.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }) as unknown as Event,
      )
    })
    expect(calls.opened).toEqual([ADDED.noteId])
  })

  it("says a note made offline is saved on this device", async () => {
    await draw({ added: { ...ADDED, onDevice: true } })
    expect(find("[data-e2e=new-note-added]").textContent).toContain(NEW_NOTE_TEXT.onDevice)
  })

  it("offers New group instead of the form when the person can write to no group", async () => {
    const calls = await draw({ groups: [], groupId: null })
    expect(document.querySelector("[data-e2e=new-note-title]")).toBeNull()
    expect(find("[data-e2e=new-note-no-group]").textContent).toBe(NEW_NOTE_TEXT.noGroup)
    const button = find<HTMLAnchorElement>("[data-e2e=new-note-new-group]")
    expect(button.getAttribute("href")).toBe(GROUP_PATHS.new)
    await act(() => {
      button.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }) as unknown as Event,
      )
    })
    expect(calls.closed).toBe(1)
    expect(calls.navigated).toEqual([GROUP_PATHS.new])
  })
})
