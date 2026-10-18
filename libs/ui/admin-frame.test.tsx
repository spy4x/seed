/**
 * The admin app's frames, driven in a browser DOM (happy-dom): what the rail holds,
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
import { AdminFrame, adminPageTitle, AdminShell, ComingSoonPanel } from "./admin-frame.tsx"

const window = new Window({ url: "http://admin.localhost/" })
const own = {
  document: globalThis.document,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
}

beforeAll(() => {
  // Preact draws into `document`; a link is routed only when it points at the page's own origin
  // (`location`), and a dialog locks the page's scroll after reading its style (`getComputedStyle`), and the rail
  // places a tooltip only on an element it recognises (`HTMLElement`).
  Object.assign(globalThis, {
    document: window.document,
    location: window.location,
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

/** The labels of the rail's entries, without their tooltip copies. */
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

/** The operator's account trigger in the rail, `AccountMenu`'s default hook. */
const ACCOUNT = "[data-e2e=rail-shell-bottom] [data-e2e=account-menu-button]"
/** The account section of the phone's sheet. */
const SHEET_ACCOUNT = "[data-e2e=rail-shell-dialog] [data-e2e=app-shell-sheet-account]"

/** The button inside `container` whose text is `label`, or a failure naming both. */
function button(container: string, label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`${container} button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`${container} has no ${label} button`)
  return found
}

describe("AdminShell", () => {
  it("has no header, brand or switcher: the rail starts with Dashboard and the page sits in the wide column", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        <p id="page">page</p>
      </AdminShell>,
    )
    expect(document.querySelector("header")).toBe(null)
    expect(document.querySelector("[data-e2e=rail-shell-top]")).toBe(null)
    expect(document.querySelector("[data-e2e=admin-mark]")).toBe(null)
    expect(document.querySelector("[data-e2e=rail-shell-column]")!.textContent).not.toContain(
      "Seed",
    )
    expect(entryLabels("[data-e2e=rail-shell-rail]")[0]).toBe("Dashboard")
    expect(find("#page").closest("main")).not.toBe(null)
    expect(find("#page").closest("[data-e2e=app-shell-content]")!.className).toContain(
      "max-w-5xl",
    )
  })

  it("marks the account cell with a neutral Admin badge and names the operator's button with it", async () => {
    await mount(
      <AdminShell navItems={modules} currentPath="/" operator={operator} onSignOut={() => {}}>
        page
      </AdminShell>,
    )
    const trigger = find(ACCOUNT)
    expect(trigger.getAttribute("aria-label")).toBe("Account: Olga Ops, Admin")
    const badge = [...trigger.querySelectorAll("span")].find((span) => span.textContent === "Admin")
    expect(badge).not.toBe(undefined)
    // Gray, never the accent: the badge must not read as a second brand colour.
    expect(badge!.className).toContain("text-foreground")
    expect(badge!.className).not.toMatch(/accent|primary/)
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
    expect(nav.querySelector("[aria-current]:not([aria-current=false])")?.getAttribute("href"))
      .toBe("/users")
  })

  it("keeps the first four modules as phone tabs and ends the bar with Admin, whose sheet holds the rest", async () => {
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
    expect(find("[data-e2e=rail-shell-more]").textContent).toContain("Admin")
    expect(find("[data-e2e=rail-shell-dialog] h2").textContent).toBe("Admin")
    expect(entryLabels("[data-e2e=rail-shell-dialog]")).toEqual([
      "Newsletter",
      "Audit log",
      "System",
      "API tokens",
    ])
    const header = find(`${SHEET_ACCOUNT} [data-e2e=app-shell-sheet-account-header]`).textContent
    expect(header).toContain("Olga Ops")
    expect(header).toMatch(/Admin$/)
  })

  it("shows an operator known only by the address once, in the cell, its menu and the sheet", async () => {
    const address = "ops@example.com"
    await mount(
      <AdminShell
        navItems={modules}
        currentPath="/"
        operator={{ name: address, email: address }}
        onSignOut={() => {}}
      >
        page
      </AdminShell>,
    )
    const times = (text: string) => text.split(address).length - 1
    expect(find(ACCOUNT).getAttribute("aria-label")).toBe(`Account: ${address}, Admin`)
    expect(times(find(ACCOUNT).parentElement!.querySelector("[role=menu]")!.textContent!)).toBe(1)
    expect(times(find(SHEET_ACCOUNT).textContent!)).toBe(1)
  })

  it("offers the theme and Sign out in the operator's menu and in the phone's sheet", async () => {
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
    const menu = find(ACCOUNT).parentElement!.querySelector("[role=menu]")!
    expect(
      [...menu.querySelectorAll("[role=menuitem], [role=menuitemradio]")]
        .map((item) => item.textContent?.trim()),
    ).toEqual(["System", "Light", "Dark", "Sign out"])

    await click(ACCOUNT)
    await act(() => {
      menu.querySelector("[data-e2e=account-menu-theme-dark]")!.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, button: 0 }) as never,
      )
    })
    await act(() => {
      button("[data-e2e=app-shell-account] [role=menu]", "Sign out").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }) as never,
      )
    })
    await click("[data-e2e=rail-shell-more]")
    await act(() => {
      button(SHEET_ACCOUNT, "Sign out").dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }) as never,
      )
    })

    expect(theme.chosen).toEqual(["dark"])
    expect(signedOut).toEqual([true, true])
  })
})

describe("adminPageTitle", () => {
  it("names the page's section, then Admin, then the product", () => {
    expect(adminPageTitle(modules, "/")).toBe("Dashboard · Admin · Seed")
    expect(adminPageTitle(modules, "/users")).toBe("Users · Admin · Seed")
    expect(adminPageTitle(modules, "/users/42")).toBe("Users · Admin · Seed")
    expect(adminPageTitle(modules, "/nowhere")).toBe("Admin · Seed")
  })
})

describe("AdminFrame", () => {
  it("shows the product's name with the same neutral Admin badge above the sign-in", async () => {
    await mount(
      <AdminFrame operatorName={null} canSignOut={false} onSignOut={() => {}} wide={false}>
        page
      </AdminFrame>,
    )
    const brand = find("header [data-e2e=admin-mark]").closest("a")!
    expect(brand.getAttribute("href")).toBe("/")
    expect(brand.textContent).toBe("SeedAdmin")
    expect(find("[data-e2e=admin-mark] span").className).not.toMatch(/accent|primary/)
  })
})

describe("ComingSoonPanel", () => {
  it("shows its message without a dashed box", async () => {
    await mount(<ComingSoonPanel title="Reports is coming soon" description="Soon." />)
    const panel = find(`[data-e2e="admin-coming-soon"]`)

    expect(panel.textContent).toContain("Reports is coming soon")
    expect(panel.textContent).toContain("Coming soon")
    expect(document.querySelector(".border-dashed") === null).toBe(true)
  })
})
