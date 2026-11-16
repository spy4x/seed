/**
 * The "Keyboard shortcuts" dialog in a browser DOM (happy-dom): it lists exactly the rows of the
 * app's registry that work now, and its footer switch turns the single keys off.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render } from "preact"
import { act } from "preact/test-utils"
import {
  commandRows,
  type PaletteCommandRow,
  SHORTCUT_GROUPS,
  type ShortcutRow,
  ShortcutsList,
} from "./shortcuts.tsx"
import { shortcutsMenuItems } from "./frame.tsx"
import { paletteCommands } from "./palette-commands.ts"
import { paletteContext } from "./search-palette.tsx"
import { adminPaletteCommands } from "./admin-palette-commands.ts"
import { adminPaletteContext } from "./admin-palette.tsx"
import { ADMIN_ENGLISH, ENGLISH } from "./i18n-testing.ts"

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
  { keys: "?", description: `Shortcuts.show`, group: SHORTCUT_GROUPS.general, run },
  { keys: "mod+k", description: `Shortcuts.search`, group: SHORTCUT_GROUPS.general },
  { keys: "/", description: `Shortcuts.search`, group: SHORTCUT_GROUPS.general },
  { keys: "esc", description: `Shortcuts.close`, group: SHORTCUT_GROUPS.general },
  { keys: "g n", description: `Frame.notes`, group: SHORTCUT_GROUPS.goTo, run },
  { keys: "mod+enter", description: `Shortcuts.addAndOpen`, group: SHORTCUT_GROUPS.newNote },
]

/** The dialog open over `rows`; returns the switch's reports. */
async function mount(
  singleKeys: boolean,
  rows = ROWS,
  open = true,
  commands?: readonly PaletteCommandRow[],
): Promise<boolean[]> {
  const toggled: boolean[] = []
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() =>
    render(
      <ShortcutsList
        rows={rows}
        commands={commands}
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
      "Search or run a command: Ctrl+K",
      "Search or run a command: /",
      "Close a dialog or menu: Esc",
      "Notes: G then N",
      "Add and open: Ctrl+Enter",
    ])
    const headings = [...document.querySelectorAll("dialog h3")].map((h) => h.textContent)
    expect(headings).toEqual(["General", "Go to", "In New note"])
    expect(document.querySelector("dialog h2")?.textContent).toBe("Keyboard shortcuts")
  })

  it("leaves out the single keys while they are off, and keeps Ctrl K, Escape and Ctrl Enter", async () => {
    await mount(false)
    expect(listed()).toEqual([
      "Search or run a command: Ctrl+K",
      "Close a dialog or menu: Esc",
      "Add and open: Ctrl+Enter",
    ])
    expect(document.querySelector("[data-e2e=shortcuts-footer]")?.textContent).toContain(
      "Single-key shortcuts are off on this device.",
    )
  })

  it("says shortcuts skip fields, and its switch reports off", async () => {
    const toggled = await mount(true)
    const footer = document.querySelector("[data-e2e=shortcuts-footer]")!
    expect(footer.textContent).toContain("Shortcuts don't work while you type in a field.")
    const toggle = footer.querySelector<HTMLButtonElement>("[role=switch]")!
    expect(toggle.getAttribute("aria-checked")).toBe("true")
    expect(document.getElementById(toggle.getAttribute("aria-labelledby")!)?.textContent)
      .toBe("Single-key shortcuts")
    await act(() => toggle.click())
    expect(toggled).toEqual([false])
  })
})

/** The rows under the "Palette commands" heading, each as its `dt` and `dd`. */
function commandList(): { dt: Element; dd: Element | null }[] {
  const heading = [...document.querySelectorAll("dialog h3")].find((h) =>
    h.textContent === "Palette commands"
  )
  const list = heading?.parentElement?.querySelector("dl")
  if (!list) throw new Error(`no Palette commands group`)
  return [...list.children].map((row) => ({
    dt: row.querySelector("dt")!,
    dd: row.querySelector("dd"),
  }))
}

/** A product's own command, such as Financy's, with words in English and Russian. */
const PRODUCT_COMMAND: PaletteCommandRow = {
  label: `Record payment`,
  aliases: [`Record payment`, `pay`, `add expense`, `оплата`, `pay`],
  shortcut: `mod+shift+p`,
}

/** The SPA's palette registry, over the shortcut rows above. */
const spaCommands = () =>
  paletteCommands(
    paletteContext(ENGLISH, `en`, {
      groups: [],
      currentGroup: { id: `0190a000-0000-7000-8000-000000000001`, name: `Home`, canWrite: true },
      online: true,
      shortcuts: ROWS,
    }),
    run,
  )

describe("the Keyboard shortcuts dialog's palette commands", () => {
  it("lists every command of the palette once, with the other words that find it", async () => {
    const commands = spaCommands()
    await mount(true, ROWS, true, commands)
    const rows = commandList()
    expect(rows.map(({ dt }) => dt.firstChild?.textContent)).toEqual(
      commands.map((command) => command.label),
    )
    for (const [index, command] of commands.entries()) {
      const detail = rows[index].dt.querySelector("span")?.textContent ?? ``
      for (const alias of command.aliases ?? []) {
        const shown = [command.label, command.detail].map((text) => text?.toLocaleLowerCase())
        if (shown.includes(alias.toLocaleLowerCase())) continue
        expect(detail).toContain(alias)
      }
    }
    const headings = [...document.querySelectorAll("dialog h3")].map((h) => h.textContent)
    expect(headings.at(-1)).toBe("Palette commands")
  })

  it("reads a command's name before its other words, in the same term", async () => {
    await mount(true, ROWS, true, [PRODUCT_COMMAND])
    const [{ dt }] = commandList()
    expect(dt.childNodes[0].nodeType).toBe(3)
    expect(dt.childNodes[0].textContent).toBe(`Record payment`)
    expect(dt.childNodes[1].textContent).toBe(`pay, add expense, оплата`)
  })

  it("shows a command's keys, and none for a command without them", async () => {
    const commands = spaCommands()
    await mount(true, ROWS, true, commands)
    const rows = commandList()
    const notes = commands.findIndex((command) => command.shortcut === `g n`)
    expect(rows[notes].dd?.textContent).toBe(`G then N`)
    const signOut = commands.findIndex((command) => command.id === `action-sign-out`)
    expect(signOut).toBeGreaterThan(-1)
    expect(rows[signOut].dd).toBeNull()
  })

  it("lists a product's own command with no code of its own", async () => {
    await mount(true, ROWS, true, [PRODUCT_COMMAND])
    const [{ dt, dd }] = commandList()
    expect(dt.textContent).toBe(`Record paymentpay, add expense, оплата`)
    expect(dd?.textContent).toBe(`Ctrl+Shift+P`)
  })

  it("keeps a single-key command listed, without its key, while single keys are off", async () => {
    const single = { label: `Open inbox`, aliases: [`mail`], shortcut: `i` }
    await mount(false, ROWS, true, [single, PRODUCT_COMMAND])
    const rows = commandList()
    expect(rows.map(({ dt }) => dt.firstChild?.textContent)).toEqual([
      `Open inbox`,
      `Record payment`,
    ])
    expect(rows[0].dd).toBeNull()
    expect(rows[1].dd?.textContent).toBe(`Ctrl+Shift+P`)
  })

  it("lists the admin palette's commands the same way", async () => {
    const commands = adminPaletteCommands(
      adminPaletteContext(ADMIN_ENGLISH, {
        goTo: [{ id: `users`, key: `AdminNav.users`, href: `/users`, keys: `g u` }],
        listFilter: false,
        theme: `system`,
        singleKeys: true,
      }),
      () => {},
    )
    await mount(true, ROWS, true, commands)
    const rows = commandList()
    expect(rows.map(({ dt }) => dt.firstChild?.textContent)).toEqual(
      commands.map((command) => command.label),
    )
    const users = commands.findIndex((command) => command.shortcut === `g u`)
    expect(rows[users].dt.querySelector("span")?.textContent).toContain(`people`)
    expect(rows[users].dd?.textContent).toBe(`G then U`)
  })
})

describe("commandRows", () => {
  it("drops an alias that repeats the label, the detail or another alias, whatever its case", () => {
    const notes = {
      label: `Notes`,
      detail: `In Home`,
      aliases: [`notes`, `in home`, `List`, `list`],
    }
    expect(commandRows([notes], `H`, true))
      .toEqual([{ description: `Notes`, detail: `List`, keys: undefined, group: `H` }])
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
    expect(shortcutsMenuItems({ ...base, inMenu: true }, "Keyboard shortcuts")[0]).toMatchObject({
      label: "Keyboard shortcuts",
      onClick: run,
      keyshortcuts: ["?"],
    })
    expect(shortcutsMenuItems({ ...base, singleKeys: false, inMenu: true }, "")[0].keyshortcuts)
      .toBeUndefined()
  })

  it("is left out on a device without a fine pointer", () => {
    expect(shortcutsMenuItems({ ...base, inMenu: false }, "")).toEqual([])
    expect(shortcutsMenuItems(undefined, "")).toEqual([])
  })
})
