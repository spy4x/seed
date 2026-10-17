/**
 * The admin app's signed-in frame, driven in a browser DOM (happy-dom): what the sidebar holds,
 * what the operator's menu offers and what reaches the app's callbacks.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  IconCreditCard,
  IconFolder,
  IconHome,
  IconKey,
  IconMail,
  IconServer,
  IconShieldCheck,
  IconUsers,
} from "@spy4x/preact-icons"
import { AdminShell } from "./admin-frame.tsx"
import { MENU_TOOLTIP_CLASS } from "./group-picker.tsx"

const window = new Window({ url: "http://admin.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  // Preact draws into `document`; a link is routed only when it points at the page's own origin
  // (`location`), and a dialog locks the page's scroll after reading its style (`getComputedStyle`).
  Object.assign(globalThis, {
    document: window.document,
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

async function mount(node: VNode): Promise<void> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
}

/** The one element `selector` finds, or a failure naming it. */
function find(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }) as never,
    )
  })
}

/** The labels of the sidebar's entries, without the rail's tooltip copies. */
function entryLabels(selector: string): string[] {
  return [...document.querySelectorAll(`${selector} [data-e2e="rail-shell-entry"]`)]
    .map((entry) => entry.querySelector("span:not([aria-hidden])")?.textContent ?? "")
}

const modules = [
  { name: "Dashboard", href: "/", Icon: IconHome },
  { name: "Users", href: "/users", Icon: IconUsers },
  { name: "Groups", href: "/groups", Icon: IconFolder },
  { name: "Billing", href: "/billing", Icon: IconCreditCard },
  { name: "Newsletter", href: "/newsletter", Icon: IconMail },
  { name: "Audit log", href: "/audit", Icon: IconShieldCheck },
  { name: "System", href: "/system", Icon: IconServer },
  { name: "API tokens", href: "/api-tokens", Icon: IconKey },
]

function themeSpy() {
  const chosen: string[] = []
  return {
    chosen,
    preference: { value: "light" as const },
    set: (value: string) => void chosen.push(value),
  }
}

const operator = { name: "Olga Ops", email: null }

describe("AdminShell", () => {
  it("has no header bar: the Admin badge with the product's name tops the sidebar, without the S mark", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        <p id="page">page</p>
      </AdminShell>,
    )
    expect(document.querySelector("header")).toBe(null)
    const brand = find("[data-e2e=rail-shell-top] [data-e2e=admin-mark]").closest("a")!
    expect(brand.getAttribute("href")).toBe("/")
    expect(brand.textContent).toBe("AdminSeed")
    expect(brand.querySelector(".text-muted")?.textContent).toBe("Seed")
    expect(find("#page").closest("main")).not.toBe(null)
    expect(find("#page").parentElement!.className).toContain("max-w-6xl")
  })

  it("tops the phone's More sheet with the Admin badge and the product's name, as a heading row", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        page
      </AdminShell>,
    )
    const top = find("[data-e2e=rail-shell-dialog] [data-e2e=rail-shell-overlay-top]")
    expect(top.querySelector("[data-e2e=admin-mark-overlay]")?.textContent).toBe("Admin")
    expect(top.textContent).toBe("AdminSeed")
    expect(top.querySelector("a")?.outerHTML).toBe(undefined)
  })

  it("lists every module under Admin sections and marks the one whose page is shown", async () => {
    await mount(
      <AdminShell
        navItems={modules}
        currentPath="/users/42"
        operator={operator}
        onSignOut={() => {}}
      >
        page
      </AdminShell>,
    )
    const nav = find("[data-e2e=rail-shell-rail]")
    expect(nav.getAttribute("aria-label")).toBe("Admin sections")
    expect(entryLabels("[data-e2e=rail-shell-rail]")).toEqual(modules.map((module) => module.name))
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/users")
  })

  it("keeps the first four modules as phone tabs and the rest in More", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        page
      </AdminShell>,
    )
    expect(entryLabels("[data-e2e=rail-shell-tabbar]")).toEqual([
      "Dashboard",
      "Users",
      "Groups",
      "Billing",
    ])
    expect(find("[data-e2e=rail-shell-more]").textContent).toContain("More")
    expect(entryLabels("[data-e2e=rail-shell-dialog]")).toEqual([
      "Newsletter",
      "Audit log",
      "System",
      "API tokens",
    ])
    expect(find("[data-e2e=rail-shell-dialog] [data-e2e=admin-operator-overlay]")).not.toBe(null)
  })

  it("offers the theme and Sign out in the operator's menu at the bottom of the sidebar", async () => {
    const theme = themeSpy()
    const signedOut: true[] = []
    await mount(
      <AdminShell
        navItems={modules}
        currentPath="/"
        operator={operator}
        theme={theme}
        onSignOut={() => void signedOut.push(true)}
      >
        page
      </AdminShell>,
    )
    const trigger = find("[data-e2e=rail-shell-bottom] [data-e2e=admin-operator]")
    expect(trigger.getAttribute("aria-label")).toBe("Account: Olga Ops")
    const menu = trigger.parentElement!.querySelector("[role=menu]")!
    expect(
      [...menu.querySelectorAll("[role=menuitem], [role=menuitemradio]")]
        .map((item) => item.textContent?.trim()),
    ).toEqual(["System", "Light", "Dark", "Sign out"])

    await click("[data-e2e=admin-operator]")
    await act(() => {
      menu.querySelector("[data-e2e=account-menu-theme-dark]")!.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, button: 0 }) as never,
      )
    })
    await click("[data-e2e=admin-signout]")

    expect(theme.chosen).toEqual(["dark"])
    expect(signedOut).toEqual([true])
  })

  it("signs out from the rail's avatar menu and from the phone's More sheet", async () => {
    const signedOut: true[] = []
    await mount(
      <AdminShell
        navItems={modules}
        currentPath="/"
        operator={operator}
        onSignOut={() => void signedOut.push(true)}
      >
        page
      </AdminShell>,
    )
    await click("[data-e2e=admin-operator-rail]")
    await click("[data-e2e=admin-signout-rail]")
    await click("[data-e2e=rail-shell-more]")
    await click("[data-e2e=admin-operator-overlay]")
    await click("[data-e2e=admin-signout-overlay]")
    expect(signedOut).toEqual([true, true])
  })

  it("names the operator's avatar in the rail and shows the same words as its tooltip, hidden while the menu is open", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        page
      </AdminShell>,
    )
    const trigger = find("[data-e2e=admin-operator-rail]")
    expect(trigger.getAttribute("aria-label")).toBe("Account: Olga Ops")
    expect(trigger.closest("[role=group]")?.querySelector("[role=tooltip]")?.textContent).toBe(
      "Account: Olga Ops",
    )
    // The tooltip hides while the operator's menu is open, so it never sits beside it.
    expect(trigger.closest("[role=group]")!.querySelector("[role=tooltip]")!.className)
      .toContain(MENU_TOOLTIP_CLASS)
  })
})
