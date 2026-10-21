/**
 * The "Keyboard shortcuts" dialog in a browser DOM (happy-dom): it lists exactly the rows of the
 * app's registry that work now, and its footer switch turns the single keys off.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import { SHORTCUT_GROUPS, SHORTCUT_TEXT, type ShortcutRow, ShortcutsList } from "./shortcuts.tsx"
import { shortcutsMenuItems } from "./frame.tsx"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  // A dialog locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
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

const run = () => {}
const ROWS: ShortcutRow[] = [
  { keys: "?", description: "Show keyboard shortcuts", group: SHORTCUT_GROUPS.general, run },
  { keys: "mod+k", description: "Search notes and groups", group: SHORTCUT_GROUPS.general },
  { keys: "/", description: "Search notes and groups", group: SHORTCUT_GROUPS.general },
  { keys: "esc", description: "Close a dialog or menu", group: SHORTCUT_GROUPS.general },
  { keys: "g n", description: "Notes", group: SHORTCUT_GROUPS.goTo, run },
  { keys: "mod+enter", description: "Add and open", group: SHORTCUT_GROUPS.newNote },
]

/** The dialog open over `rows`; returns the switch's reports. */
async function mount(singleKeys: boolean, rows = ROWS, open = true): Promise<boolean[]> {
  const toggled: boolean[] = []
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() =>
    render(
      <ShortcutsList
        rows={rows}
        open={open}
        onOpen={() => {}}
        onClose={() => {}}
        singleKeys={singleKeys}
        onSingleKeys={(on) => void toggled.push(on)}
      />,
      root!,
    )
  )
  return toggled
}

/** Each listed row as "description: keys as read", in order. */
function listed(): string[] {
  return [...document.querySelectorAll("dialog dl > div")].map((row) =>
    `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`
  )
}

describe("the Keyboard shortcuts dialog", () => {
  it("lists exactly the registry's rows, under their headings", async () => {
    await mount(true)
    expect(listed()).toEqual([
      "Show keyboard shortcuts: ?",
      "Search notes and groups: Ctrl+K",
      "Search notes and groups: /",
      "Close a dialog or menu: Esc",
      "Notes: G then N",
      "Add and open: Ctrl+Enter",
    ])
    const headings = [...document.querySelectorAll("dialog h3")].map((h) => h.textContent)
    expect(headings).toEqual(["General", "Go to", "In New note"])
    expect(document.querySelector("dialog h2")?.textContent).toBe(SHORTCUT_TEXT.title)
  })

  it("leaves out the single keys while they are off, and keeps Ctrl K, Escape and Ctrl Enter", async () => {
    await mount(false)
    expect(listed()).toEqual([
      "Search notes and groups: Ctrl+K",
      "Close a dialog or menu: Esc",
      "Add and open: Ctrl+Enter",
    ])
    expect(document.querySelector("[data-e2e=shortcuts-footer]")?.textContent).toContain(
      SHORTCUT_TEXT.off,
    )
  })

  it("says shortcuts skip fields, and its switch reports off", async () => {
    const toggled = await mount(true)
    const footer = document.querySelector("[data-e2e=shortcuts-footer]")!
    expect(footer.textContent).toContain(SHORTCUT_TEXT.inFields)
    const toggle = footer.querySelector<HTMLButtonElement>("[role=switch]")!
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(document.getElementById(toggle.getAttribute("aria-labelledby")!)?.textContent)
      .toBe(SHORTCUT_TEXT.switchLabel)
    await act(() => toggle.click())
    expect(toggled).toEqual([false])
  })
})

describe("the Keyboard shortcuts dialog's height", () => {
  it("is pinned when the switch is pressed, so the switch stays put, and freed once it closes", async () => {
    await mount(true)
    const dialog = document.querySelector<HTMLDialogElement>("dialog")!
    expect(dialog.style.minHeight).toBe("")
    await act(() => document.querySelector<HTMLButtonElement>("[role=switch]")!.click())
    expect(dialog.style.minHeight).toMatch(/^\d+px$/)
    await mount(false, ROWS, false)
    expect(dialog.style.minHeight).toBe("")
  })
})

describe("the account menu's Keyboard shortcuts entry", () => {
  const base = {
    rows: ROWS,
    open: false,
    onOpen: run,
    onClose: run,
    singleKeys: true,
    onSingleKeys: run,
  }

  it("names ? as its key while single keys are on, and no key while they are off", () => {
    expect(shortcutsMenuItems({ ...base, inMenu: true })[0]).toMatchObject({
      label: SHORTCUT_TEXT.menuEntry,
      onClick: run,
      keyshortcuts: ["?"],
    })
    expect(shortcutsMenuItems({ ...base, singleKeys: false, inMenu: true })[0].keyshortcuts)
      .toBeUndefined()
  })

  it("is left out on a device without a fine pointer", () => {
    expect(shortcutsMenuItems({ ...base, inMenu: false })).toEqual([])
    expect(shortcutsMenuItems(undefined)).toEqual([])
  })
})
