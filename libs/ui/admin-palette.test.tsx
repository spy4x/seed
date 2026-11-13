/**
 * `AdminSearchPalette` in a browser DOM (happy-dom), alone and inside `AdminShell`: how it opens,
 * which commands it lists for the operator's state, the words that find them, and what picking a
 * row asks the admin app to do.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { IconHome, IconUsers } from "@spy4x/preact-icons"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.ts"
import appRu from "@i18n/app/ru.ts"
import admin from "@i18n/admin/en.ts"
import adminRu from "@i18n/admin/ru.ts"
import { ADMIN_ENGLISH } from "./i18n-testing.ts"
import {
  type AdminGoTo,
  type AdminSearchChoice,
  AdminSearchPalette,
  type AdminSearchPaletteProps,
} from "./admin-palette.tsx"
import { AdminShell } from "./admin-frame.tsx"

/** The operator area's catalogs in Russian, as the admin app reads them for a Russian operator. */
const RU = createTranslator({
  language: `ru`,
  catalogs: [{ source: app, translation: appRu }, { source: admin, translation: adminRu }],
})

const window = new Window({ url: "http://admin.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  Element: globalThis.Element,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  // The palette locks the page's scroll after reading its style; its hotkey listener tests its
  // target with `instanceof Element` and `HTMLElement`, and the rail places a tooltip only on an
  // element it recognises.
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    Element: window.Element,
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

/** Dashboard, Users and Groups shown; the blog, the catalog and the rest are off. */
const GO_TO: readonly AdminGoTo[] = [
  { id: `dashboard`, key: `AdminNav.dashboard`, href: `/`, keys: `g d` },
  { id: `users`, key: `AdminNav.users`, href: `/users`, keys: `g u` },
  { id: `groups`, key: `AdminNav.groups`, href: `/groups`, keys: `g g` },
]

function palette(picked: AdminSearchChoice[], overrides: Partial<AdminSearchPaletteProps> = {}) {
  return (
    <AdminSearchPalette
      goTo={GO_TO}
      listFilter={false}
      theme="system"
      singleKeys
      onSelect={(choice) => void picked.push(choice)}
      {...overrides}
    />
  )
}

async function mount(node: VNode, t = ADMIN_ENGLISH): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(<I18nContext.Provider value={t}>{node}</I18nContext.Provider>, root!))
}

/** The palette alone, with what it hands the app. */
async function mountPalette(
  overrides: Partial<AdminSearchPaletteProps> = {},
  t = ADMIN_ENGLISH,
): Promise<AdminSearchChoice[]> {
  const picked: AdminSearchChoice[] = []
  await mount(palette(picked, overrides), t)
  return picked
}

async function settle(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 260)))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function dialog(): HTMLDialogElement {
  return find<HTMLDialogElement>("dialog[data-e2e=search]")
}

async function pressCtrlK(target: Element = document.body): Promise<void> {
  await act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        ctrlKey: true,
        bubbles: true,
      }) as unknown as Event,
    )
  })
  await settle()
}

async function type(value: string): Promise<void> {
  const field = find<HTMLInputElement>("[data-e2e=search] input")
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
  await settle()
}

/** The list as an operator reads it: each heading, then its rows' words. */
function listed(): string[] {
  return [...document.querySelectorAll("[data-e2e=search] [role=listbox] > li")].flatMap(
    (item) => {
      const group = item.querySelector("[role=group]")
      if (!group) return [text(item)]
      const heading = group.querySelector("[role=presentation]")?.textContent?.trim() ?? ""
      return [`# ${heading}`, ...[...group.querySelectorAll("[role=option]")].map(text)]
    },
  )
}

function text(row: Element): string {
  return [...row.querySelectorAll("span, div")]
    .filter((part) => part.children.length === 0)
    .map((part) => part.textContent?.trim())
    .filter(Boolean)
    .join(" | ")
}

/** The `aria-keyshortcuts` of the row whose label starts with `label`. */
function keysOf(label: string): string | null | undefined {
  return [...document.querySelectorAll("[data-e2e=search] [role=option]")]
    .find((candidate) => text(candidate).startsWith(label))?.getAttribute("aria-keyshortcuts")
}

/** Clicks the row whose label starts with `label`. */
async function pick(label: string): Promise<void> {
  const row = [...document.querySelectorAll("[data-e2e=search] [role=option]")]
    .find((candidate) => text(candidate).startsWith(label))
  if (!row) throw new Error(`no row starts with ${label}: ${listed().join(", ")}`)
  await act(() => {
    row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
  await settle()
}

describe("AdminSearchPalette", () => {
  it("opens on Ctrl K with focus in its field, and not on /, which a list's search takes", async () => {
    await mountPalette()
    await act(() => {
      document.body.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "/", code: "Slash", bubbles: true }) as never,
      )
    })
    await settle()
    expect(dialog().open).toBe(false)

    await pressCtrlK()

    expect(dialog().open).toBe(true)
    expect(document.activeElement).toBe(find("[data-e2e=search] input"))
  })

  it("lists Go to for the modules shown, then Settings and Account, before anything is typed", async () => {
    await mountPalette()
    await pressCtrlK()

    expect(listed()).toEqual([
      "# Go to",
      "Dashboard",
      "Users",
      "Groups",
      "# Settings",
      "Theme | System",
      "Single-key shortcuts | On",
      "Keyboard shortcuts",
      "# Account",
      "Sign out",
    ])
  })

  it('shows no "> for commands" hint, since every row is a command', async () => {
    await mountPalette()
    await pressCtrlK()

    expect(dialog().textContent).not.toContain("for commands")
  })

  it("adds Search this list with its / key on a list page", async () => {
    await mountPalette({ listFilter: true })
    await pressCtrlK()

    expect(keysOf("Search this list")).toBe("/")
    expect(keysOf("Keyboard shortcuts")).toBe("?")
    await pick("Search this list")
    expect(dialog().open).toBe(false)
  })

  it("finds a command by an English word, a typo, Russian and the wrong keyboard layout", async () => {
    await mountPalette({}, RU)
    await pressCtrlK()
    const top = () => listed()[1]

    for (const query of ["users", "usres", "пользователи", "гыукы"]) {
      await type(query)
      expect(top(), query).toBe(RU.t(`AdminNav.users`))
    }
    await type("logout")
    expect(top()).toBe(RU.t(`AdminFrame.signOut`))
  })

  it("offers Find user and Find group for part of an e-mail, and opens the filtered users list", async () => {
    const picked = await mountPalette()
    await pressCtrlK()

    await type("  ann@exa ")

    expect(listed()).toEqual([
      "# Quick find",
      "Find user “ann@exa”",
      "Find group “ann@exa”",
    ])
    await pick("Find user")
    expect(picked).toEqual([{ kind: "page", href: "/users?q=ann%40exa" }])
  })

  it("opens the filtered groups list from Find group", async () => {
    const picked = await mountPalette()
    await pressCtrlK()
    await type("acme")

    await pick("Find group")

    expect(picked).toEqual([{ kind: "page", href: "/groups?q=acme" }])
  })

  it("offers no Find user while the users module is off", async () => {
    await mountPalette({ goTo: GO_TO.filter((entry) => entry.id !== `users`) })
    await pressCtrlK()

    await type("ann@exa")

    expect(listed()).toEqual(["# Quick find", "Find group “ann@exa”"])
  })

  it("changes the theme from its submenu at once and stays open", async () => {
    const picked = await mountPalette()
    await pressCtrlK()

    await pick("Theme")
    await pick("Dark")

    expect(picked).toEqual([{ kind: "theme", theme: "dark" }])
    expect(dialog().open).toBe(true)
  })

  it("turns the single-key shortcuts off and on, and stays open", async () => {
    const picked = await mountPalette()
    await pressCtrlK()
    await pick("Single-key shortcuts")
    expect([picked, dialog().open]).toEqual([[{ kind: "single-keys", on: false }], true])

    const again = await mountPalette({ singleKeys: false })
    await pressCtrlK()
    await pick("Single-key shortcuts | Off")
    expect(again).toEqual([{ kind: "single-keys", on: true }])
  })

  it("asks for the shortcuts dialog and for sign-out after closing", async () => {
    const picked = await mountPalette()
    await pressCtrlK()
    await pick("Keyboard shortcuts")
    expect(dialog().open).toBe(false)
    await pressCtrlK()
    await pick("Sign out")

    expect(picked).toEqual([{ kind: "shortcuts" }, { kind: "sign-out" }])
  })
})

/** A stand-in for a page's content: data to the shell, so never translated. */
const PAGE = `page`

describe("AdminShell's Search entry", () => {
  const shell = (search?: VNode) => (
    <AdminShell
      navItems={[
        { name: `Dashboard`, href: `/`, Icon: IconHome },
        { name: `Users`, href: `/users`, Icon: IconUsers },
      ]}
      currentPath="/"
      operator={{ name: `Ann`, email: null }}
      onSignOut={() => {}}
      search={search}
    >
      <p>{PAGE}</p>
    </AdminShell>
  )

  it("opens the palette from the rail, naming Ctrl K only", async () => {
    await mount(shell(palette([])))
    const entry = find("[data-e2e=shell-search-rail] [aria-keyshortcuts]")
    expect(entry.getAttribute("aria-keyshortcuts")).toBe("Control+K")

    await act(() => {
      entry.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }) as never,
      )
    })
    await settle()

    expect(dialog().open).toBe(true)
  })

  it("draws no Search entry without a palette", async () => {
    await mount(shell())
    expect(document.querySelector("[data-e2e=shell-search-rail]")).toBeNull()
  })
})
