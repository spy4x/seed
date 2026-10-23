/**
 * The app frame and the account screens (profile, e-mail address, sign-in) driven in a browser DOM
 * (happy-dom): what opens, what the app's callbacks receive, and where focus goes.
 *
 * A form's native post is never sent here: a submit is dispatched as an event, and the helper
 * reports whether the app's callback cancelled it.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import {
  AccountDeletionBlockReason,
  type EmailStatus,
  UserMFAStatus,
  type UserPushTokenPublic,
} from "@domain/identity"
import { GroupRole } from "@domain/groups"
import type { AccountDeleteProps } from "./account-delete.tsx"
import { AuthScreen } from "./auth-screen.tsx"
import { EmailBanner, type EmailChangeProps, showsEmailBanner } from "./email-screen.tsx"
import { AccountSection } from "./profile-account.tsx"
import type { ProviderProof } from "./provider-proof.tsx"
import { createFormatters } from "@spy4x/time/format"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { railFocusRing } from "@spy4x/preact-system/rail"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { GROUP_PATHS, NOTE_PATHS, profilePath, SCREEN_PATHS } from "./progressive.tsx"
import { TwoFactorProof } from "./two-factor.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
  CSS: globalThis.CSS,
}

beforeAll(() => {
  // Preact draws into `document`; EnhancedForm reads a form with `new FormData(form)`, which only
  // the DOM's own FormData can do. A link is routed only when it points at the page's own origin
  // (`location`), and a dialog locks the page's scroll after reading its style (`getComputedStyle`), and the rail
  // places a tooltip only on an element it recognises (`HTMLElement`).
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    location: window.location,
    getComputedStyle: window.getComputedStyle.bind(window),
    HTMLElement: window.HTMLElement,
    // The settings layout finds the item to focus with `CSS.escape`.
    CSS: window.CSS,
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

/** Renders `node` into a fresh element in the page, effects run. */
async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

/** Renders `node` in place of what `mount` drew, the way an app re-renders with new props. */
async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

/** The one element `selector` finds, or a failure naming it. */
function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** Types `value` into a field the way a person does: the value changes, then `input` fires. */
async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/**
 * Submits the form that holds the element `selector` finds, from its submit button, and lets
 * EnhancedForm's callback run. Returns whether the native post was cancelled.
 */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")!
  form.querySelector<HTMLButtonElement>("button[type=submit]")?.focus()
  const event = new window.SubmitEvent("submit", { bubbles: true, cancelable: true })
  await act(async () => {
    form.dispatchEvent(event as unknown as Event)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return event.defaultPrevented
}

/** Clicks an element and returns whether its default action was cancelled. */
async function click(selector: string, init: { ctrlKey?: boolean } = {}): Promise<boolean> {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  await act(() => {
    find(selector).dispatchEvent(event as unknown as Event)
  })
  return event.defaultPrevented
}

/** Clicks the button labelled `label` inside the dialog `dialog` names by its `data-e2e`. */
async function clickInDialog(dialog: string, label: string): Promise<void> {
  const button = [...document.querySelectorAll(`[data-e2e=${dialog}] button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`the ${dialog} dialog has no ${label} button`)
  await act(() => {
    button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
  })
}

/** Whether the dialog `data-e2e` names is open. */
function isOpen(dialog: string): boolean {
  return document.querySelector<HTMLDialogElement>(`dialog[data-e2e=${dialog}]`)?.open === true
}

/**
 * What has focus: its `data-e2e`, or its tag name when it has none. A string, so a failed check
 * prints two names instead of diffing two DOM nodes, which never finishes.
 */
function focused(): string | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

/** Records every call made to the function it hands out. */
function spy<A extends unknown[]>(): { calls: A[]; fn: (...args: A) => void } {
  const calls: A[] = []
  return { calls, fn: (...args: A) => void calls.push(args) }
}

const ada = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" }

/** Presses `key` on whatever has focus, the way the keyboard does: the event starts there. */
async function press(key: string): Promise<void> {
  const target = document.activeElement ?? document.body
  await act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      }) as unknown as Event,
    )
  })
}

/** Activates the focused control as Enter does on a button or a link: it is clicked. */
async function enter(): Promise<void> {
  const target = document.activeElement as HTMLElement | null
  if (!target) throw new Error("nothing has focus")
  await act(() => {
    target.dispatchEvent(
      new window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }) as unknown as Event,
    )
  })
}

/**
 * The texts of every element `selector` finds, trimmed, without the parts hidden from assistive
 * technology (`aria-hidden`), such as the rail's tooltip that repeats an entry's label.
 */
function texts(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((element) => {
    const copy = element.cloneNode(true) as Element
    copy.querySelectorAll(`[aria-hidden="true"]`).forEach((hidden) => hidden.remove())
    return copy.textContent?.trim() ?? ""
  })
}

/** The labels of the rail's navigation entries, without their tooltip copies. */
function railLabels(): string[] {
  return texts('[data-e2e=rail-shell-rail] a[data-e2e="rail-shell-entry"]')
}

/** The menu panel of the dropdown whose trigger `selector` finds: the trigger's sibling. */
function menuOf(selector: string): HTMLElement {
  const menu = find(selector).parentElement!.querySelector<HTMLElement>("[role=menu]")
  if (!menu) throw new Error(`${selector} has no menu`)
  return menu
}

/** The texts of the items in the menu `selector`'s trigger opens. */
function menuItems(selector: string): string[] {
  return [...menuOf(selector).querySelectorAll("[role=menuitem], [role=menuitemradio]")]
    .map((item) => item.textContent?.trim() ?? "")
}

/** The link or button inside `container` whose text is `label`, or a failure naming both. */
function control(container: string, label: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`${container} a, ${container} button`)]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`${container} has no ${label}`)
  return found
}

/** Clicks the control `control` finds and returns whether its default action was cancelled. */
async function clickControl(
  container: string,
  label: string,
  init: { ctrlKey?: boolean } = {},
): Promise<boolean> {
  const event = new window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  })
  await act(() => {
    control(container, label).dispatchEvent(event as unknown as Event)
  })
  return event.defaultPrevented
}

/** The account menu's header row as its text reads: the portrait's initials, the name, the address. */
const HEADER = "ALAda Lovelaceada@example.com"
/** The rail's account trigger, which `AppShell` draws with `AccountMenu`'s default hook. */
const ACCOUNT = "[data-e2e=rail-shell-bottom] [data-e2e=account-menu-button]"
/** The account section of the phone's sheet. */
const SHEET_ACCOUNT = "[data-e2e=rail-shell-dialog] [data-e2e=app-shell-sheet-account]"

describe("AppFrame", () => {
  const groups = [
    { id: "g-1", name: "Home", role: GroupRole.OWNER },
    { id: "g-2", name: "Team", role: GroupRole.VIEWER },
  ]

  it("has no header bar or brand: the rail holds the switcher, the bell and the account", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        unreadCount={0}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
      >
        <p id="page">page</p>
      </AppFrame>,
    )

    expect(document.querySelector("header")).toBe(null)
    expect(document.body.textContent).not.toContain("Seed")
    expect(find("[data-e2e=rail-shell-top] [data-e2e=group-picker]")).not.toBe(null)
    expect(find('[data-e2e=rail-shell-bottom] a[href="/notifications"]')).not.toBe(null)
    expect(find(ACCOUNT)).not.toBe(null)
    expect(find("#page").closest("main")).not.toBe(null)
  })

  it("leaves the bell out while the unread count is unknown", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}}>page</AppFrame>)
    expect(document.querySelector('a[href="/notifications"]')).toBe(null)
  })

  it("puts every page in the one centred 48 rem column, and a wide page in 64 rem", async () => {
    await mount(
      <AppFrame user={ada} onSignOut={() => {}}>
        <p id="page">page</p>
      </AppFrame>,
    )
    const column = () => find("#page").closest("[data-e2e=app-shell-content]")!.className
    expect(column()).toContain("mx-auto")
    expect(column()).toContain("max-w-3xl")

    await rerender(
      <AppFrame user={ada} onSignOut={() => {}} wide>
        <p id="page">page</p>
      </AppFrame>,
    )
    expect(column()).toContain("max-w-5xl")
    expect(column()).not.toContain("max-w-3xl")
  })

  it("lists Overview, Notes, Activity and Groups, with Activity pointing at the selected group", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
      >
        page
      </AppFrame>,
    )
    const rail = '[data-e2e=rail-shell-rail] a[data-e2e="rail-shell-entry"]'
    expect(railLabels()).toEqual(["Overview", "Notes", "Activity", "Groups"])
    expect([...document.querySelectorAll(rail)].map((link) => link.getAttribute("href")))
      .toEqual(["/overview", "/notes", "/groups/g-1/activity", "/groups"])
    expect(texts('[data-e2e=rail-shell-tabbar] [data-e2e="rail-shell-entry"]')).toHaveLength(4)
  })

  it("ends the phone bar with Account, counting the unread notifications in its name", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}} unreadCount={3}>page</AppFrame>)
    const more = find("[data-e2e=rail-shell-more]")
    expect(more.textContent).toContain("Account")
    expect(more.getAttribute("aria-label")).toBe("Account, 3 unread")
    expect(find("[data-e2e=rail-shell-dialog] h2").textContent).toBe("Account")
  })

  it("leaves Activity out with no selected group, and for a group whose log the person may not read", async () => {
    const frame = (selectedId: string | null) => (
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId, onSelect: () => {} }}
      >
        page
      </AppFrame>
    )
    await mount(frame(null))
    expect(railLabels()).toEqual(["Overview", "Notes", "Groups"])
    await rerender(frame("g-2"))
    expect(railLabels()).toEqual(["Overview", "Notes", "Groups"])
  })

  it("follows a plain click on a navigation entry through navigate, and leaves a Ctrl-click to the browser", async () => {
    const navigate = spy<[string]>()
    await mount(
      <AppFrame user={ada} onSignOut={() => {}} navigate={navigate.fn}>page</AppFrame>,
    )
    const notes = '[data-e2e=rail-shell-rail] a[data-e2e="rail-shell-entry"][href="/notes"]'

    expect(await click(notes)).toBe(true)
    expect(await click(notes, { ctrlKey: true })).toBe(false)
    expect(navigate.calls).toEqual([["/notes"]])
  })

  it("marks a list as the page, a note inside it as its section, and nothing for the account's pages", async () => {
    const at = (path: string) => (
      <AppFrame user={ada} onSignOut={() => {}} currentPath={path}>page</AppFrame>
    )
    const marked = (value: string) =>
      [...document.querySelectorAll(`[data-e2e=rail-shell-rail] [aria-current="${value}"]`)]
        .map((link) => link.getAttribute("href"))

    // preact-components 8 writes `aria-current="false"` on the entries that are not current.
    const current = "[aria-current]:not([aria-current=false])"
    await mount(at(profilePath("account")))
    expect(document.querySelectorAll(current)).toHaveLength(0)
    await rerender(at(SCREEN_PATHS.profile))
    expect(document.querySelectorAll(current)).toHaveLength(0)

    await rerender(at(NOTE_PATHS.list))
    expect(marked("page")).toEqual(["/notes"])
    await rerender(at("/notes/abc"))
    expect(marked("page")).toEqual([])
    expect(marked("true")).toEqual(["/notes"])
    await rerender(at("/groups/abc/pricing"))
    expect(marked("true")).toEqual(["/groups"])
  })

  it("says the connection in one live region always, and shows it only while it is down", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}} connection="open">page</AppFrame>)
    const status = () => document.querySelectorAll("[data-e2e=shell-ws-status]")
    expect(status()).toHaveLength(1)
    expect(status()[0].textContent).toBe("Online")
    expect(status()[0].getAttribute("role")).toBe("status")
    expect(document.querySelector("[data-e2e=app-shell-connection]")).toBe(null)

    await rerender(<AppFrame user={ada} onSignOut={() => {}} connection="closed">page</AppFrame>)
    expect(status()).toHaveLength(1)
    expect(status()[0].textContent).toBe("Offline")
    expect(find("[data-e2e=rail-shell-bottom] [data-e2e=app-shell-connection]")).not.toBe(null)
    expect(find("[data-e2e=app-shell-offline-strip]").textContent).toBe("Offline")
  })

  /** A stand-in for `SearchPalette`: its root and hidden trigger, noting each time it opens. */
  function StubSearch({ opened }: { opened: string[] }) {
    return (
      <div data-e2e="search-root">
        <button
          type="button"
          aria-haspopup="dialog"
          class="hidden"
          onClick={() => {
            const sheet = document.querySelector<HTMLDialogElement>(
              "dialog[data-e2e=rail-shell-dialog]",
            )
            opened.push(`sheet ${sheet?.open ? "open" : "closed"}`)
          }}
        />
      </div>
    )
  }

  it("puts Search under the group switcher in the rail, names its keys, and opens the one palette after the page", async () => {
    const opened: string[] = []
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
        search={<StubSearch opened={opened} />}
        banner={<p id="banner">b</p>}
      >
        <p id="page">page</p>
      </AppFrame>,
    )

    const cell = find("[data-e2e=rail-shell-top] [data-e2e=shell-search-rail]")
    const picker = find("[data-e2e=rail-shell-top] [data-e2e^=group-picker]")
    // The switcher comes first, then the search.
    expect(picker.compareDocumentPosition(cell) & 4).toBe(4)
    expect(cell.querySelector("button")?.textContent?.trim()).toBe("Search")
    // It names the palette's keys, in the tooltip and to a screen reader.
    expect(cell.querySelector("[data-e2e=rail-shell-tooltip]")?.textContent).toBe("Search (Ctrl K)")
    expect(cell.querySelector("button")?.getAttribute("aria-keyshortcuts")).toBe("Control+K /")
    // One palette, after the page: a signed-in page still starts with the banner, then its own.
    expect(document.querySelectorAll("[data-e2e=search-root]").length).toBe(1)
    const column = find("[data-e2e=app-shell-content]")
    expect(column.firstElementChild?.querySelector("#banner")).not.toBe(null)
    expect(find("#page").compareDocumentPosition(find("[data-e2e=search-root]")) & 4).toBe(4)

    await act(() => {
      cell.querySelector("button")!.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true }) as unknown as Event,
      )
    })
    expect(opened).toEqual(["sheet closed"])
  })

  it("offers Search first in the phone's Account sheet, which closes the sheet and then opens the palette", async () => {
    const opened: string[] = []
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
        search={<StubSearch opened={opened} />}
      >
        <p id="page">page</p>
      </AppFrame>,
    )
    const sheet = find<HTMLDialogElement>("dialog[data-e2e=rail-shell-dialog]")
    const entry = find("[data-e2e=rail-shell-overlay-top] [data-e2e=shell-search-sheet] button")
    expect(entry.textContent?.trim()).toBe("Search")
    expect(entry.className).toContain("min-h-11")
    const groupSheet = find(
      "[data-e2e=rail-shell-overlay-top] [aria-labelledby=group-sheet-heading]",
    )
    expect(entry.compareDocumentPosition(groupSheet) & 4).toBe(4)

    await act(() => sheet.showModal())
    await act(async () => {
      entry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(sheet.open).toBe(false)
    expect(opened).toEqual(["sheet closed"])
  })

  it("draws the banner at the top of the page's own column on every page", async () => {
    const frame = (path: string) => (
      <AppFrame user={ada} onSignOut={() => {}} currentPath={path} banner={<p id="banner">b</p>}>
        <p id="page">page</p>
      </AppFrame>
    )
    const atTop = () => {
      const column = find("#page").closest("[data-e2e=app-shell-content]")!
      expect(column.closest("main")).not.toBeNull()
      expect(column.firstElementChild?.querySelector("#banner")).not.toBeNull()
    }
    await mount(frame(SCREEN_PATHS.profile))
    atTop()
    await rerender(frame(NOTE_PATHS.list))
    atTop()
  })

  it("names the account entry after the person, heads its menu with their name and address, and offers Tags and Sign out with no Profile or Theme item", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}}>page</AppFrame>)
    expect(find(ACCOUNT).getAttribute("aria-label")).toBe("Account: Ada Lovelace")
    expect(find("[data-e2e=account-menu-header]").textContent).toContain(
      "Ada Lovelaceada@example.com",
    )
    expect(menuItems(ACCOUNT)).toEqual([HEADER, "Tags", "Sign out"])
    expect(document.querySelector("[data-e2e=app-shell-sheet-theme]")).toBe(null)
  })

  it("names a person with no name by their e-mail address, written once", async () => {
    await mount(
      <AppFrame
        user={{ firstName: "", lastName: "", email: "ada@example.com" }}
        onSignOut={() => {}}
      >
        page
      </AppFrame>,
    )
    expect(find(ACCOUNT).getAttribute("aria-label")).toBe("Account: ada@example.com")
    expect(find("[data-e2e=account-menu-header]").textContent?.split("ada@example.com"))
      .toHaveLength(2)
  })

  it("signs out from the rail's account menu and from the phone's Account sheet", async () => {
    const signOut = spy<[]>()
    await mount(<AppFrame user={ada} onSignOut={signOut.fn}>page</AppFrame>)

    await click(ACCOUNT)
    await clickControl("[data-e2e=app-shell-account] [role=menu]", "Sign out")
    expect(signOut.calls).toHaveLength(1)

    await click("[data-e2e=rail-shell-more]")
    await clickControl(SHEET_ACCOUNT, "Sign out")
    expect(signOut.calls).toHaveLength(2)
  })

  it("opens the profile from the name and portrait in the account menu and the sheet through navigate, and leaves a Ctrl-click to the browser", async () => {
    const navigate = spy<[string]>()
    await mount(<AppFrame user={ada} onSignOut={() => {}} navigate={navigate.fn}>page</AppFrame>)
    const menu = "[data-e2e=app-shell-account] [role=menu]"

    expect(control(menu, HEADER).getAttribute("href")).toBe(SCREEN_PATHS.profile)
    expect(await clickControl(menu, HEADER)).toBe(true)
    expect(await clickControl(menu, HEADER, { ctrlKey: true })).toBe(false)
    expect(await clickControl(SHEET_ACCOUNT, HEADER)).toBe(true)
    expect(navigate.calls).toEqual([[SCREEN_PATHS.profile], [SCREEN_PATHS.profile]])
  })

  it("shows the current group as a 40 px tile with its initial, named for a screen reader, with its role in the rail's own tooltip and the rail's focus ring", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
      >
        page
      </AppFrame>,
    )
    const trigger = find("[data-e2e=group-picker]")
    expect(trigger.tagName).toBe("BUTTON")
    expect(trigger.getAttribute("aria-label")).toBe("Group: Home")
    // A 48 px cell holding a 40 px tile, like every other cell of the rail.
    expect(trigger.classList.contains("size-12")).toBe(true)
    const tile = trigger.querySelector("span[aria-hidden=true]")!
    expect(tile.classList.contains("size-10")).toBe(true)
    expect(tile.textContent).toBe("H")
    // The rail's own tooltip, hidden from a screen reader: the button's name already says it.
    const tip = trigger.closest("[data-rail-cell]")!.querySelector("[data-e2e=rail-shell-tooltip]")!
    expect(tip.textContent).toBe("Home · Owner")
    expect(tip.getAttribute("aria-hidden")).toBe("true")
    // The rail's keyboard focus ring, not the browser's.
    for (const name of railFocusRing.split(" ")) expect(trigger.classList.contains(name)).toBe(true)
  })

  it("asks to choose a group while none is chosen, in words its name contains", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: null, onSelect: () => {} }}
      >
        page
      </AppFrame>,
    )
    expect(find("[data-e2e=group-picker]").getAttribute("aria-label")).toBe("Choose a group")
  })

  it("switches group from the keyboard: the arrow keys move through the groups, the checked one is current", async () => {
    const select = spy<[string]>()
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: select.fn }}
      >
        page
      </AppFrame>,
    )
    find<HTMLButtonElement>("[data-e2e=group-picker]").focus()
    await enter()

    const radios = [...menuOf("[data-e2e=group-picker]").querySelectorAll("[role=menuitemradio]")]
    expect(radios.map((item) => item.textContent)).toEqual(["HHome Owner", "TTeam Viewer"])
    expect(radios.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"])
    expect(document.activeElement).toBe(radios[0])
    await press("ArrowDown")
    expect(document.activeElement).toBe(radios[1])
    await enter()

    expect(select.calls).toEqual([["g-2"]])
  })

  it("does not select the group that is already current again", async () => {
    const select = spy<[string]>()
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: select.fn }}
      >
        page
      </AppFrame>,
    )
    await click("[data-e2e=group-picker]")
    await click("[data-e2e=group-picker-g-1]")
    expect(select.calls).toEqual([])
  })

  it("lists the groups in the phone's Account sheet, switches on a tap and closes the sheet", async () => {
    const select = spy<[string]>()
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        unreadCount={0}
        groupPicker={{ groups, selectedId: "g-1", onSelect: select.fn }}
      >
        page
      </AppFrame>,
    )
    const sheet = "[data-e2e=rail-shell-dialog]"
    await click("[data-e2e=rail-shell-more]")
    expect(find<HTMLDialogElement>(sheet).open).toBe(true)

    expect(find("[data-e2e=group-sheet-g-1]").getAttribute("aria-current")).toBe("true")
    expect(find("[data-e2e=group-sheet-g-2]").getAttribute("aria-current")).toBe(null)
    expect(find("[data-e2e=group-sheet-all]").getAttribute("href")).toBe("/groups")
    expect(find("[data-e2e=group-sheet-new]").getAttribute("href")).toBe("/groups/new")
    expect(find(`${sheet} a[href="/notifications"]`)).not.toBe(null)
    expect(find(SHEET_ACCOUNT)).not.toBe(null)

    await click("[data-e2e=group-sheet-g-2]")
    expect(select.calls).toEqual([["g-2"]])
    expect(find<HTMLDialogElement>(sheet).open).toBe(false)
  })

  it("draws All groups and New group in the phone's sheet as rows with an icon, like its other entries", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
      >
        page
      </AppFrame>,
    )
    for (const row of ["group-sheet-all", "group-sheet-new"]) {
      const link = find(`[data-e2e=${row}]`)
      expect({
        row,
        listed: link.parentElement?.tagName,
        icon: link.querySelector("svg") !== null,
        centred: link.classList.contains("justify-center"),
        accent: link.classList.contains("text-accent"),
        weight: link.classList.contains("font-medium"),
      }).toEqual({ row, listed: "LI", icon: true, centred: false, accent: false, weight: true })
    }
  })

  it("makes every group row of the phone's Account sheet at least 44 px tall", async () => {
    await mount(
      <AppFrame
        user={ada}
        onSignOut={() => {}}
        groupPicker={{ groups, selectedId: "g-1", onSelect: () => {} }}
      >
        page
      </AppFrame>,
    )
    for (
      const row of ["group-sheet-g-1", "group-sheet-g-2", "group-sheet-all", "group-sheet-new"]
    ) {
      expect({ row, tall: find(`[data-e2e=${row}]`).classList.contains("min-h-11") })
        .toEqual({ row, tall: true })
    }
  })
})

describe("PublicFrame", () => {
  it("signs out through the app's callback", async () => {
    const signOut = spy<[]>()
    await mount(<PublicFrame canSignOut onSignOut={signOut.fn}>page</PublicFrame>)
    expect(await submit("[data-e2e=signout]")).toBe(true)
    expect(signOut.calls).toHaveLength(1)
  })

  it("follows the brand link through navigate instead of loading the page", async () => {
    const navigate = spy<[string]>()
    await mount(
      <PublicFrame canSignOut={false} onSignOut={() => {}} navigate={navigate.fn}>
        page
      </PublicFrame>,
    )

    expect(await click('a[href="/"]')).toBe(true)
    expect(navigate.calls).toEqual([["/"]])
  })
  it("shows the product's sprout mark above the signed-out pages, named by its text", async () => {
    await mount(<PublicFrame canSignOut={false} onSignOut={() => {}}>page</PublicFrame>)

    const mark = find('a[href="/"] [data-e2e=brand-mark]')
    expect(mark.textContent).toBe("Seed")
    expect(mark.querySelector("[aria-hidden=true] svg")).not.toBeNull()
  })
})

describe("AuthScreen", () => {
  it("links to the other mode under the card, keeping the page to return to", () => {
    const html = renderToString(
      <AuthScreen
        screen="sign-up"
        isSignedIn={false}
        isMfaRequired={false}
        busy={false}
        error={null}
        next="/notes"
      />,
    )
    expect(html).toMatch(/Already have an account\? <a [^>]*href="\/sign-in\?next=%2Fnotes"/)
    expect(html).not.toContain("auth-form-mode-switch")
  })
})

const device = {
  id: 1,
  deviceId: "device-0123456789",
  createdAt: new Date("2026-01-02T03:04:05Z"),
} as unknown as UserPushTokenPublic

const profileDefaults: ProfileScreenProps = {
  section: "security",
  onRemovePush: () => {},
  user: { mfa: UserMFAStatus.NOT_CONFIGURED, ...ada },
  isMfaRequired: false,
  email: { email: "ada@example.com", proven: true, pending: null },
  values: {
    ...ada,
    currentPassword: "",
    newPassword: "",
    passwordOtp: "",
    otp: "",
    totpPassword: "",
    twoFactorProof: "",
  },
  onValueChange: () => {},
  errors: { fields: {}, profile: null, password: null, totp: null, push: null },
  pending: { profile: false, password: false, totp: false, push: false },
  enrolment: null,
  pushDevices: [device],
}

describe("ProfileScreen", () => {
  const twoFactorOn = { ...profileDefaults.user!, mfa: UserMFAStatus.CONFIGURED }
  /** The text of what `aria-describedby` ties to the field `selector` finds. */
  const describedBy = (selector: string) =>
    (find(selector).getAttribute("aria-describedby") ?? "").split(" ")
      .map((id) => document.getElementById(id)?.textContent)

  const google = { id: 2, kind: "google", email: null, current: true, canUnlink: false } as const
  /** The sign-in methods of an account with no password, which signs in with Google only. */
  const googleOnly = {
    methods: [google],
    available: [],
    pending: false,
    error: null,
    onLink: () => {},
    onUnlink: () => {},
  }

  it("shows the name and the address with its state as rows, with no form open", async () => {
    await mount(<ProfileScreen {...profileDefaults} section="account" emailChange={emailChange} />)

    expect(find("[data-e2e=profile-name]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=email-current]").textContent).toBe("ada@example.com")
    expect(document.body.textContent).toContain("Verified")
    expect(document.body.textContent).not.toContain("Not verified")
    expect(isOpen("profile-dialog")).toBe(false)
    expect(isOpen("password-dialog")).toBe(false)
  })

  it("links every section at its own address and marks the open one", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    const links = [...document.querySelectorAll<HTMLAnchorElement>("[data-e2e=settings-nav] a")]
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/profile/account",
      "/profile/security",
      "/profile/region",
      "/profile/appearance",
      "/profile/notifications",
      "/profile/api-tokens",
      "/profile/danger-zone",
    ])
    expect(find("[aria-current=page]").getAttribute("href")).toBe("/profile/security")
    expect(find("[data-e2e=settings-heading]").textContent).toBe("Sign-in and security")
  })

  it("shows only the open section, and on the list's own address Account, headed, where a phone hides it", async () => {
    const has = (selector: string) => document.querySelector(selector) !== null
    await mount(<ProfileScreen {...profileDefaults} section="security" emailChange={emailChange} />)
    expect(has("[data-e2e=password-open]")).toBe(true)
    expect(has("[data-e2e=profile-edit]")).toBe(false)

    await rerender(<ProfileScreen {...profileDefaults} section={null} />)
    expect(has("[data-e2e=password-open]")).toBe(false)
    expect(has("[data-e2e=settings-section].max-md\\:hidden [data-e2e=profile-edit]")).toBe(true)
    expect(
      find("[data-e2e=settings-section].max-md\\:hidden [data-e2e=settings-heading]").textContent,
    )
      .toBe("Account")
    expect(has("[aria-current=page]")).toBe(false)
  })

  it("says in the list whether two-factor is on", async () => {
    await mount(<ProfileScreen {...profileDefaults} section={null} />)
    expect(find("[data-e2e=settings-nav-security]").textContent).toContain("Two-factor off")

    await rerender(<ProfileScreen {...profileDefaults} section={null} user={twoFactorOn} />)
    expect(find("[data-e2e=settings-nav-security]").textContent).toContain("Two-factor on")
  })

  it("names each row action after its setting, so a screen reader can tell them apart", async () => {
    const name = (hook: string) => find(`[data-e2e=${hook}]`).textContent
    await mount(<ProfileScreen {...profileDefaults} section="account" emailChange={emailChange} />)
    expect(name("profile-edit")).toBe("Edit name")
    expect(name("email-change-open")).toBe("Change e-mail address")

    await rerender(<ProfileScreen {...profileDefaults} />)
    expect(name("password-open")).toBe("Change password")
    expect(name("totp-start")).toBe("Turn on two-factor sign-in")
  })

  it("gives each row action a 44 px touch target below the sm breakpoint", async () => {
    const target = (
      hook: string,
    ) => [hook, find(`[data-e2e=${hook}]`).classList.contains("min-h-11")]
    await mount(<ProfileScreen {...profileDefaults} section="account" emailChange={emailChange} />)
    for (const hook of ["profile-edit", "email-change-open"]) {
      expect(target(hook)).toEqual([hook, true])
    }

    await rerender(<ProfileScreen {...profileDefaults} />)
    for (const hook of ["password-open", "totp-start"]) expect(target(hook)).toEqual([hook, true])
  })

  it("lists the password once, among the ways to sign in, with its Change button", async () => {
    const password = {
      id: 1,
      kind: "password",
      email: "ada@example.com",
      current: true,
      canUnlink: false,
    } as const
    await mount(
      <ProfileScreen
        {...profileDefaults}
        methods={{ ...googleOnly, methods: [password, google] }}
      />,
    )

    expect(texts("[data-e2e=sign-in-methods] dt").filter((label) => label === "Password"))
      .toHaveLength(1)
    expect(find("[data-e2e=sign-in-method-password] [data-e2e=password-open]").textContent)
      .toBe("Change password")
  })

  it("gives an account with no password a Password row with Set, among the ways to sign in", async () => {
    await mount(<ProfileScreen {...profileDefaults} methods={googleOnly} />)

    const row = find("[data-e2e=sign-in-method-password]")
    expect(row.textContent).toContain("None. You sign in with Google.")
    expect(row.querySelector("[data-e2e=password-open]")?.textContent).toBe("Set password")
  })

  it("shows an empty push device list inside the section's own card, not in a dashed box", async () => {
    await mount(
      <ProfileScreen
        {...profileDefaults}
        section="notifications"
        pushDevices={[]}
        onRegisterPush={() => {}}
      />,
    )

    const empty = find("[data-e2e=push-devices] [role=status]")
    expect(empty.textContent).toContain("No devices yet")
    expect(empty.closest(".pc-card")).not.toBeNull()
    expect(document.querySelectorAll(".border-dashed").length).toBe(0)
  })

  it("names the open section and each of its groups by an h2, under the page's one h1", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    const names = [...document.querySelectorAll("section[aria-labelledby]")].map((section) =>
      document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent
    )
    expect(names).toEqual(["Sign-in and security", "Two-factor sign-in"])
    expect([...document.querySelectorAll("h1, h2")].map((h) => h.tagName)).toEqual(
      ["H1", "H2", "H2"],
    )
  })

  it("edits the name in a dialog, saves it through the app's callback and closes once it is saved", async () => {
    const change = spy<[string, string]>()
    const save = spy<[]>()
    const props = {
      ...profileDefaults,
      section: "account",
      onValueChange: change.fn,
      onSaveProfile: save.fn,
    } as const
    await mount(<ProfileScreen {...props} />)

    await click("[data-e2e=profile-edit]")
    expect(isOpen("profile-dialog")).toBe(true)
    await type("[data-e2e=profile-first-name]", "Grace")
    expect(change.calls).toEqual([["firstName", "Grace"]])
    expect(await submit("[data-e2e=profile-first-name]")).toBe(true)
    expect(save.calls).toHaveLength(1)

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, profile: true }} />)
    expect(isOpen("profile-dialog")).toBe(true)
    await rerender(<ProfileScreen {...props} />)
    expect(isOpen("profile-dialog")).toBe(false)
  })

  it("keeps the password dialog open with the refusal tied to its field", async () => {
    const props = { ...profileDefaults, onChangePassword: () => {} }
    await mount(<ProfileScreen {...props} />)
    await click("[data-e2e=password-open]")
    expect(isOpen("password-dialog")).toBe(true)

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, password: true }} />)
    await rerender(
      <ProfileScreen
        {...props}
        errors={{ ...props.errors, fields: { newPassword: "must be at least 8 long" } }}
      />,
    )

    expect(isOpen("password-dialog")).toBe(true)
    const field = find("[data-e2e=password-new]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("must be at least 8 long")
    expect(focused()).toBe("password-new")
  })

  it("closes the password dialog once the change went through", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    await click("[data-e2e=password-open]")

    const pending = { ...profileDefaults.pending, password: true }
    await rerender(<ProfileScreen {...profileDefaults} pending={pending} />)
    await rerender(<ProfileScreen {...profileDefaults} />)

    expect(isOpen("password-dialog")).toBe(false)
  })

  it("refuses a second save while the first is pending", async () => {
    const save = spy<[]>()
    const pending = { ...profileDefaults.pending, profile: true }
    await mount(
      <ProfileScreen
        {...profileDefaults}
        section="account"
        pending={pending}
        onSaveProfile={save.fn}
      />,
    )
    await click("[data-e2e=profile-edit]")

    expect(await submit("[data-e2e=profile-first-name]")).toBe(true)
    expect(save.calls).toEqual([])
  })

  it("opens a dialog for the first code of an enrolment, focused on the code, and cancels the enrolment from it", async () => {
    const start = spy<[]>()
    const cancel = spy<[]>()
    const props = { ...profileDefaults, onStartTotp: start.fn, onCancelTotp: cancel.fn }
    await mount(<ProfileScreen {...props} />)
    expect(document.querySelector("[data-e2e=totp-dialog]")).toBe(null)

    await click("[data-e2e=totp-start]")
    expect(await submit("[data-e2e=totp-start-password]")).toBe(true)
    expect(start.calls).toHaveLength(1)
    await rerender(<ProfileScreen {...props} enrolment={{ qrcode: "<svg/>", secret: "ABC" }} />)

    expect(isOpen("totp-dialog")).toBe(true)
    expect(focused()).toBe("totp-connect-otp")
    expect(find("[data-e2e=totp-dialog]").textContent).toContain("ABC")
    await clickInDialog("totp-dialog", "Cancel")
    expect(cancel.calls).toHaveLength(1)
  })

  it("marks the enrolment code as required, so the browser refuses an empty submit", async () => {
    const enrolling = { qrcode: "<svg/>", secret: "ABC" }
    await mount(<ProfileScreen {...profileDefaults} enrolment={enrolling} />)

    expect(find<HTMLInputElement>("[data-e2e=totp-connect-otp]").required).toBe(true)
  })

  for (
    const [opener, dialog, callback] of [
      ["profile-edit", "profile-dialog", "onCancelProfile"],
      ["password-open", "password-dialog", "onCancelPassword"],
    ] as const
  ) {
    it(`asks the app to drop what was typed when the ${dialog} is cancelled or closed`, async () => {
      const cancel = spy<[]>()
      const section = dialog === "profile-dialog" ? "account" : "security"
      await mount(
        <ProfileScreen {...profileDefaults} section={section} {...{ [callback]: cancel.fn }} />,
      )

      await click(`[data-e2e=${opener}]`)
      await clickInDialog(dialog, "Cancel")
      expect(isOpen(dialog)).toBe(false)
      await click(`[data-e2e=${opener}]`)
      await click(`[data-e2e=${dialog}] button[aria-label=Close]`)
      expect(isOpen(dialog)).toBe(false)
      expect(cancel.calls).toHaveLength(2)
    })
  }

  it("turns two-factor on only once the person typed the password and submitted, and nothing when the dialog is cancelled (#406)", async () => {
    const start = spy<[]>()
    const cancel = spy<[]>()
    const change = spy<[string, string]>()
    const props = {
      ...profileDefaults,
      onStartTotp: start.fn,
      onCancelStartTotp: cancel.fn,
      onValueChange: change.fn,
    }
    await mount(<ProfileScreen {...props} />)

    await click("[data-e2e=totp-start]")
    expect(isOpen("totp-start-confirm")).toBe(true)
    expect(start.calls).toEqual([])
    await clickInDialog("totp-start-confirm", "Cancel")
    expect(isOpen("totp-start-confirm")).toBe(false)
    expect(cancel.calls).toHaveLength(1)
    expect(start.calls).toEqual([])

    await click("[data-e2e=totp-start]")
    const field = find<HTMLInputElement>("[data-e2e=totp-start-password]")
    expect(field.type).toBe("password")
    expect(field.required).toBe(true)
    expect(field.getAttribute("autocomplete")).toBe("current-password")
    expect(field.labels?.[0]?.textContent).toContain("Password")
    await type("[data-e2e=totp-start-password]", "correct-horse")
    expect(change.calls).toEqual([["totpPassword", "correct-horse"]])
    expect(await submit("[data-e2e=totp-start-password]")).toBe(true)
    expect(start.calls).toHaveLength(1)
  })

  it("ties a refused password for turning two-factor on to its field and moves focus there (#406)", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    await click("[data-e2e=totp-start]")
    find("[data-e2e=totp-start-submit]").focus()

    await rerender(
      <ProfileScreen
        {...profileDefaults}
        errors={{ ...profileDefaults.errors, fields: { totpPassword: "must be at least 8 long" } }}
      />,
    )

    expect(isOpen("totp-start-confirm")).toBe(true)
    expect(find("[data-e2e=totp-start-password]").getAttribute("aria-invalid")).toBe("true")
    expect(describedBy("[data-e2e=totp-start-password]")).toContain("must be at least 8 long")
    expect(focused()).toBe("totp-start-password")
  })

  it("keeps the turn-on dialog open with the refusal under its form, once (#406)", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)
    await click("[data-e2e=totp-start]")

    await rerender(
      <ProfileScreen {...profileDefaults} pending={{ ...profileDefaults.pending, totp: true }} />,
    )
    await rerender(
      <ProfileScreen
        {...profileDefaults}
        errors={{ ...profileDefaults.errors, totp: "Invalid password" }}
      />,
    )

    expect(isOpen("totp-start-confirm")).toBe(true)
    expect(find("[data-e2e=totp-start-confirm] form").textContent).toContain("Invalid password")
    expect(document.body.textContent?.split("Invalid password")).toHaveLength(2)
  })

  it("refuses a second turn-on while the first is pending (#406)", async () => {
    const start = spy<[]>()
    await mount(<ProfileScreen {...profileDefaults} onStartTotp={start.fn} />)
    await click("[data-e2e=totp-start]")
    await rerender(
      <ProfileScreen
        {...profileDefaults}
        pending={{ ...profileDefaults.pending, totp: true }}
        onStartTotp={start.fn}
      />,
    )

    expect(await submit("[data-e2e=totp-start-password]")).toBe(true)
    expect(start.calls).toEqual([])
  })

  it("sends an account with no password to its provider before two-factor goes on, with no form (#406)", async () => {
    const start = spy<[]>()
    await mount(
      <ProfileScreen {...profileDefaults} methods={googleOnly} onStartTotp={start.fn} />,
    )

    await click("[data-e2e=totp-start]")

    expect(isOpen("totp-start-confirm")).toBe(true)
    expect(find("[data-e2e=totp-start-confirm] [data-e2e=provider-proof-needed]")).toBeTruthy()
    expect(find("[data-e2e=provider-proof-google]").getAttribute("href")).toContain("google")
    expect(document.querySelector("[data-e2e=totp-start-confirm] form")).toBe(null)
    expect(start.calls).toEqual([])
  })

  it("turns two-factor on for an account with no password after a provider sign-in a moment ago, without a password field (#406)", async () => {
    const start = spy<[]>()
    await mount(
      <ProfileScreen
        {...profileDefaults}
        methods={googleOnly}
        providerProofFresh
        onStartTotp={start.fn}
      />,
    )

    await click("[data-e2e=totp-start]")

    expect(find("[data-e2e=totp-start-confirm] [data-e2e=provider-proof-fresh]")).toBeTruthy()
    expect(document.querySelector("[data-e2e=totp-start-password]")).toBe(null)
    expect(await submit("[data-e2e=totp-start-submit]")).toBe(true)
    expect(start.calls).toHaveLength(1)
  })

  it("moves focus to Turn off when two-factor comes on", async () => {
    const enrolling = { qrcode: "<svg/>", secret: "ABC" }
    await mount(<ProfileScreen {...profileDefaults} enrolment={enrolling} />)
    await rerender(<ProfileScreen {...profileDefaults} user={twoFactorOn} />)

    expect(focused()).toBe("totp-disable")
  })

  it("turns two-factor off only once the person typed the password and submitted, and nothing when the dialog is cancelled", async () => {
    const disable = spy<[TwoFactorProof]>()
    const cancel = spy<[]>()
    const change = spy<[string, string]>()
    const props = {
      ...profileDefaults,
      user: twoFactorOn,
      onDisableTotp: disable.fn,
      onCancelDisableTotp: cancel.fn,
      onValueChange: change.fn,
    }
    await mount(<ProfileScreen {...props} />)

    await click("[data-e2e=totp-disable]")
    expect(isOpen("totp-disable-confirm")).toBe(true)
    await clickInDialog("totp-disable-confirm", "Cancel")
    expect(isOpen("totp-disable-confirm")).toBe(false)
    expect(cancel.calls).toHaveLength(1)
    expect(disable.calls).toEqual([])

    await click("[data-e2e=totp-disable]")
    const field = find<HTMLInputElement>("[data-e2e=totp-disable-proof]")
    expect(field.type).toBe("password")
    expect(field.required).toBe(true)
    expect(field.labels?.[0]?.textContent).toContain("Password")
    await type("[data-e2e=totp-disable-proof]", "correct-horse")
    expect(change.calls).toEqual([["twoFactorProof", "correct-horse"]])
    expect(await submit("[data-e2e=totp-disable-proof]")).toBe(true)
    expect(disable.calls).toEqual([[TwoFactorProof.Password]])
  })

  it("asks an account with no password for a code from the authenticator app instead", async () => {
    const disable = spy<[TwoFactorProof]>()
    await mount(
      <ProfileScreen
        {...profileDefaults}
        user={twoFactorOn}
        methods={googleOnly}
        onDisableTotp={disable.fn}
      />,
    )

    await click("[data-e2e=totp-disable]")
    const field = find<HTMLInputElement>("[data-e2e=totp-disable-proof]")
    expect(field.type).toBe("text")
    expect(field.getAttribute("autocomplete")).toBe("one-time-code")
    expect(field.labels?.[0]?.textContent).toContain("Code from your app")
    expect(await submit("[data-e2e=totp-disable-proof]")).toBe(true)
    expect(disable.calls).toEqual([[TwoFactorProof.Code]])
  })

  it("keeps the turn-off dialog open with the refusal under its form, once", async () => {
    const props = { ...profileDefaults, user: twoFactorOn }
    await mount(<ProfileScreen {...props} />)
    await click("[data-e2e=totp-disable]")

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, totp: true }} />)
    await rerender(
      <ProfileScreen {...props} errors={{ ...props.errors, totp: "Invalid password" }} />,
    )

    expect(isOpen("totp-disable-confirm")).toBe(true)
    expect(find("[data-e2e=totp-disable-confirm] form").textContent).toContain("Invalid password")
    expect(document.body.textContent?.split("Invalid password")).toHaveLength(2)
  })

  it("ties a refused proof to its field and moves focus there", async () => {
    const props = { ...profileDefaults, user: twoFactorOn }
    await mount(<ProfileScreen {...props} />)
    await click("[data-e2e=totp-disable]")
    find("[data-e2e=totp-disable-submit]").focus()

    await rerender(
      <ProfileScreen
        {...props}
        errors={{ ...props.errors, fields: { twoFactorProof: "must be at least 8 long" } }}
      />,
    )

    expect(isOpen("totp-disable-confirm")).toBe(true)
    expect(find("[data-e2e=totp-disable-proof]").getAttribute("aria-invalid")).toBe("true")
    expect(describedBy("[data-e2e=totp-disable-proof]")).toContain("must be at least 8 long")
    expect(focused()).toBe("totp-disable-proof")
  })

  it("refuses a second turn-off while the first is pending", async () => {
    const disable = spy<[TwoFactorProof]>()
    const pending = { ...profileDefaults.pending, totp: true }
    await mount(
      <ProfileScreen {...profileDefaults} user={twoFactorOn} onDisableTotp={disable.fn} />,
    )
    await click("[data-e2e=totp-disable]")
    await rerender(
      <ProfileScreen
        {...profileDefaults}
        user={twoFactorOn}
        pending={pending}
        onDisableTotp={disable.fn}
      />,
    )

    expect(await submit("[data-e2e=totp-disable-proof]")).toBe(true)
    expect(disable.calls).toEqual([])
  })

  it("closes the turn-off dialog once two-factor went off, and does not open it when it comes on again", async () => {
    const props = { ...profileDefaults, user: twoFactorOn }
    await mount(<ProfileScreen {...props} />)
    await click("[data-e2e=totp-disable]")

    await rerender(<ProfileScreen {...props} pending={{ ...props.pending, totp: true }} />)
    await rerender(<ProfileScreen {...profileDefaults} />)
    expect(isOpen("totp-disable-confirm")).toBe(false)

    await rerender(<ProfileScreen {...props} />)
    expect(isOpen("totp-disable-confirm")).toBe(false)
  })

  it("moves no focus when the page first draws a two-factor step", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    expect(focused()).toBe("BODY")
  })

  it("labels two devices added in the same minute differently", async () => {
    // Version 7 ids made close together start with the same time, so the label is their end.
    const first = { ...device, id: 1, deviceId: "0199d1c2-5a10-7b3c-8f21-6d0e4a9b1c35" }
    const second = { ...device, id: 2, deviceId: "0199d1c2-5a11-7e4d-9a32-0c7f5b8e2d46" }
    await mount(
      <ProfileScreen {...profileDefaults} section="notifications" pushDevices={[first, second]} />,
    )

    const text = (id: string) => find(`[data-e2e=push-device-${id}]`).textContent
    expect(text(first.deviceId)).toContain("Device 4a9b1c35")
    expect(text(second.deviceId)).toContain("Device 5b8e2d46")
  })

  it("offers Add this device in an empty list, and removes a device with its id", async () => {
    const remove = spy<[string]>()
    const props = { ...profileDefaults, section: "notifications" } as const
    await mount(<ProfileScreen {...props} onRemovePush={remove.fn} />)
    expect(await submit(`[data-e2e=push-remove-${device.deviceId}]`)).toBe(true)
    expect(remove.calls).toEqual([[device.deviceId]])

    const register = spy<[]>()
    await rerender(
      <ProfileScreen {...props} pushDevices={[]} onRegisterPush={register.fn} />,
    )
    expect(document.body.textContent).toContain("No devices yet")
    await click("[data-e2e=push-register]")
    expect(register.calls).toHaveLength(1)
  })

  it("points a signed-out visitor to sign-in, and a session owing its code to the code page", () => {
    const signedOut = renderToString(<ProfileScreen {...profileDefaults} user={null} />)
    expect(signedOut).toContain(`data-e2e="signin-required"`)
    expect(signedOut).toContain(`href="/sign-in"`)
    expect(renderToString(<ProfileScreen {...profileDefaults} isMfaRequired />))
      .toContain(`href="/totp"`)
  })
})

const deletionDefaults: Omit<AccountDeleteProps, "twoFactor" | "navigate"> = {
  blockers: [],
  values: { password: "", otp: "" },
  onValueChange: () => {},
  errors: { form: null },
  pending: false,
}

/** The profile page with its danger zone, built from `deletion` over the defaults. */
function withDeletion(
  deletion: Partial<AccountDeleteProps> = {},
  props: Partial<ProfileScreenProps> = {},
): VNode {
  return (
    <ProfileScreen
      {...profileDefaults}
      section="danger-zone"
      {...props}
      accountDeletion={{ ...deletionDefaults, ...deletion }}
    />
  )
}

/** Opens the deletion dialog. */
async function openDeletion(): Promise<void> {
  await click("[data-e2e=account-delete-open]")
}

describe("the Your data row on the Account section", () => {
  const dataExport = {
    exportState: null,
    pending: false,
    error: null,
    onRequest: () => {},
    downloadHref: "/api/account/data-export/download",
  }

  it("lists Your data last in the Account section, and leaves it out without the app's wiring", async () => {
    await mount(
      <ProfileScreen
        {...profileDefaults}
        section="account"
        emailChange={emailChange}
        dataExport={dataExport}
      />,
    )
    const rows = [...document.querySelectorAll("[data-e2e=data-export-row]")]
    expect(rows).toHaveLength(1)
    // The last row of the same list as the name.
    const list = find("[data-e2e=profile-name]").closest("dl")
    expect(list?.lastElementChild === rows[0]).toBe(true)

    await rerender(
      <ProfileScreen {...profileDefaults} section="account" emailChange={emailChange} />,
    )
    expect(document.querySelectorAll("[data-e2e=data-export-row]")).toHaveLength(0)
  })

  it("shows a refused request under the list", async () => {
    await mount(
      <ProfileScreen
        {...profileDefaults}
        section="account"
        emailChange={emailChange}
        dataExport={{ ...dataExport, error: { kind: "network" } }}
      />,
    )
    expect(find("[data-e2e=data-export-error]").textContent).toContain(
      "Could not ask for your file.",
    )
  })
})

describe("deleting the account from the profile", () => {
  it("shows Delete account as a section of its own, and leaves it empty without the app's wiring", async () => {
    await mount(withDeletion())

    expect(find("[data-e2e=settings-heading]").textContent).toBe("Delete account")
    expect(find("[data-e2e=danger-zone]").textContent).toContain("Delete my account")
    expect(isOpen("account-delete-dialog")).toBe(false)

    await rerender(<ProfileScreen {...profileDefaults} section="danger-zone" />)
    expect(document.querySelector("[data-e2e=danger-zone]")).toBeNull()
  })

  it("offers a copy of the person's data before they delete, linking to the Account section's row", async () => {
    await mount(withDeletion())

    const link = find<HTMLAnchorElement>("[data-e2e=account-delete-export-link]")
    expect(link.textContent).toBe("Download your data")
    expect(link.getAttribute("href")).toBe(`${profilePath("account")}#your-data`)
  })

  it("sets the danger zone apart as a card with a danger-coloured border", async () => {
    await mount(withDeletion())

    const zone = find("[data-e2e=danger-zone]")
    expect(zone.classList.contains("pc-card")).toBe(true)
    expect(zone.classList.contains("border-danger")).toBe(true)
    expect(zone.querySelector(".pc-card")).toBeNull()
  })

  it("names the delete button for a screen reader and gives it a 44 px touch target", async () => {
    await mount(withDeletion())

    const button = find("[data-e2e=account-delete-open]")
    expect(button.textContent).toBe("Delete my account")
    expect(button.classList.contains("min-h-11")).toBe(true)
  })

  it("asks the app for the blockers on opening and says it is checking until they arrive", async () => {
    const opened = spy<[]>()
    await mount(withDeletion({ blockers: null, onOpen: opened.fn }))

    await openDeletion()

    expect(opened.calls).toHaveLength(1)
    expect(isOpen("account-delete-dialog")).toBe(true)
    expect(find("[data-e2e=account-delete-dialog] [role=status]").textContent)
      .toBe("Checking your groups…")
    expect(document.querySelector("[data-e2e=account-delete-password]")).toBeNull()
  })

  it("lists each blocking group as a link to the tab that deals with it, with what it needs, and asks for no password", async () => {
    const navigate = spy<[string]>()
    const blockers = [
      { groupId: "g-1", name: "Family", reason: AccountDeletionBlockReason.Members, endsAt: null },
      {
        groupId: "g-2",
        name: "Shop",
        reason: AccountDeletionBlockReason.Subscription,
        endsAt: null,
      },
      {
        groupId: "g-3",
        name: "Club",
        reason: AccountDeletionBlockReason.PlanEnding,
        endsAt: "2026-11-20T12:00:00.000Z",
      },
    ]
    await mount(withDeletion({ blockers }, { navigate: navigate.fn }))
    await openDeletion()

    const items = [...document.querySelectorAll("[data-e2e=account-delete-blockers] li")]
    expect(items.map((item) => item.querySelector("a")?.getAttribute("href"))).toEqual([
      GROUP_PATHS.members("g-1"),
      GROUP_PATHS.billing("g-2"),
      GROUP_PATHS.billing("g-3"),
    ])
    expect(items.map((item) => item.textContent)).toEqual([
      "FamilyOther people still use it. Hand it over or remove them.",
      "ShopIts plan is still paid. Cancel the plan first.",
      `ClubIts plan is cancelled and runs until ${
        createFormatters().date("2026-11-20T12:00:00.000Z", "long")
      }. Wait until the plan ends.`,
    ])
    // A tap target of 44 px on a phone.
    expect(items.map((item) => item.querySelector("a")!.classList.contains("min-h-11")))
      .toEqual([true, true, true])
    expect(document.querySelector("[data-e2e=account-delete-password]")).toBeNull()
    expect(document.querySelector("[data-e2e=account-delete-submit]")).toBeNull()

    expect(await click("[data-e2e=account-delete-blocker-g-1]")).toBe(true)
    expect(navigate.calls).toEqual([[GROUP_PATHS.members("g-1")]])
  })

  it("asks for the password alone while two-factor is off, and for the code as well once it is on", async () => {
    await mount(withDeletion())
    await openDeletion()
    expect(find<HTMLInputElement>("[data-e2e=account-delete-password]").name).toBe("password")
    expect(document.querySelector("[data-e2e=account-delete-otp]")).toBeNull()

    const on = { ...profileDefaults.user!, mfa: UserMFAStatus.CONFIGURED }
    await rerender(withDeletion({}, { user: on }))
    expect(find<HTMLInputElement>("[data-e2e=account-delete-otp]").name).toBe("otp")
  })

  it("hands what is typed and the submit to the app, and refuses a second submit while pending", async () => {
    const change = spy<[string, string]>()
    const remove = spy<[]>()
    await mount(withDeletion({ onValueChange: change.fn, onDelete: remove.fn }))
    await openDeletion()

    await type("[data-e2e=account-delete-password]", "secret-pass")
    expect(change.calls).toEqual([["password", "secret-pass"]])
    expect(await submit("[data-e2e=account-delete-password]")).toBe(true)
    expect(remove.calls).toHaveLength(1)

    await rerender(withDeletion({ onDelete: remove.fn, pending: true }))
    expect(await submit("[data-e2e=account-delete-password]")).toBe(true)
    expect(remove.calls).toHaveLength(1)
  })

  it("ties a refused code to its field and moves focus there, and keeps a message for no field under the form", async () => {
    const on = { ...profileDefaults.user!, mfa: UserMFAStatus.CONFIGURED }
    await mount(withDeletion({}, { user: on }))
    await openDeletion()

    await rerender(withDeletion({ errors: { form: null, otp: "Enter the code" } }, { user: on }))
    const field = find("[data-e2e=account-delete-otp]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("Enter the code")
    expect(focused()).toBe("account-delete-otp")

    await rerender(withDeletion({ errors: { form: "Invalid password" } }, { user: on }))
    expect(find("[data-e2e=account-delete-dialog] form").textContent).toContain("Invalid password")
  })

  it("tells the app to drop what was typed when the dialog is closed", async () => {
    const cancel = spy<[]>()
    await mount(withDeletion({ onCancel: cancel.fn }))
    await openDeletion()

    await clickInDialog("account-delete-dialog", "Cancel")

    expect(isOpen("account-delete-dialog")).toBe(false)
    expect(cancel.calls).toHaveLength(1)
  })
})

const emailDefaults: EmailChangeProps = {
  values: { code: "", email: "", password: "" },
  onValueChange: () => {},
  errors: { verify: null, send: null, change: null },
  notices: { send: null },
  pending: { verify: false, send: false, change: false },
}

/** What the API says of an address that waits for its code. */
const unproven = { email: "ann@example.com", proven: false, pending: null }
/** A proven address with no change waiting. */
const proven = { email: "ann@example.com", proven: true, pending: null }

/** The e-mail dialog's wiring as the profile passes it, for the profile tests. */
const emailChange = emailDefaults

/** The Account section with its e-mail address and dialog, built over the defaults. */
function account(
  props: Partial<EmailChangeProps> & {
    /** `null` while the address has not been read yet. */
    status?: EmailStatus | null
    providerProof?: ProviderProof | null
    openEmailCode?: boolean
  } = {},
): VNode {
  const { status = unproven, providerProof, openEmailCode, ...change } = props
  return (
    <AccountSection
      name="Ann Lee"
      nameEdit={{
        firstName: "Ann",
        lastName: "Lee",
        onValueChange: () => {},
        fieldErrors: {},
        error: null,
        pending: false,
      }}
      email={status}
      providerOnly={null}
      emailChange={{ ...emailDefaults, ...change }}
      providerProof={providerProof}
      openEmailCode={openEmailCode}
    />
  )
}

/** The e-mail dialog while its change request is on its way. */
const changePending = { ...emailDefaults.pending, change: true }

describe("the e-mail address on the Account section", () => {
  it("opens at the code when asked, reports the typed code and checks it through the app's callback", async () => {
    const change = spy<[string, string]>()
    const verify = spy<[]>()
    await mount(account({ openEmailCode: true, onValueChange: change.fn, onVerify: verify.fn }))

    expect(isOpen("email-change-dialog")).toBe(true)
    await type("[data-e2e=email-code]", "Ab3_x-9Q")

    expect(change.calls).toEqual([["code", "Ab3_x-9Q"]])
    expect(await submit("[data-e2e=email-code]")).toBe(true)
    expect(verify.calls).toHaveLength(1)
  })

  it("opens at the code once the address arrives, when the ask came before it", async () => {
    await mount(account({ status: null, openEmailCode: true }))

    await rerender(account({ status: unproven, openEmailCode: true }))

    expect(isOpen("email-change-dialog")).toBe(true)
  })

  it("offers Enter code on the row while the address waits for one, opening the dialog at the code", async () => {
    await mount(account())
    expect(isOpen("email-change-dialog")).toBe(false)

    await click("[data-e2e=email-code-open]")

    expect(isOpen("email-change-dialog")).toBe(true)
    expect(find("[data-e2e=email-verify-card]").textContent).toContain("ann@example.com")
    expect(document.querySelector("[data-e2e=email-send]")).not.toBeNull()
    expect(document.querySelector("[data-e2e=email-new]")).toBeNull()
  })

  it("opens nothing for a proven address, even when asked for the code", async () => {
    await mount(account({ status: proven, openEmailCode: true }))

    expect(isOpen("email-change-dialog")).toBe(false)
    expect(document.querySelector("[data-e2e=email-code-open]")).toBeNull()
    expect(find("[data-e2e=email-current]").textContent).toBe("ann@example.com")
    expect(find("[data-e2e=email-state]").textContent).toBe("Verified")
  })

  it("refuses a second check while the first is pending", async () => {
    const verify = spy<[]>()
    const pending = { ...emailDefaults.pending, verify: true }
    await mount(account({ openEmailCode: true, pending, onVerify: verify.fn }))

    await submit("[data-e2e=email-code]")

    expect(verify.calls).toHaveLength(0)
  })

  it("ties a refused code to the code field and moves focus there", async () => {
    await mount(account({ openEmailCode: true }))
    find("[data-e2e=email-verify]").focus()

    const errors = { ...emailDefaults.errors, verify: "This code is wrong" }
    await rerender(account({ openEmailCode: true, errors }))

    const field = find("[data-e2e=email-code]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("This code is wrong")
    expect(focused()).toBe("email-code")
  })

  it("closes the dialog once the code went through", async () => {
    await mount(account({ openEmailCode: true }))

    await rerender(
      account({ openEmailCode: true, pending: { ...emailDefaults.pending, verify: true } }),
    )
    await rerender(account({ openEmailCode: true, status: proven }))

    expect(isOpen("email-change-dialog")).toBe(false)
  })

  it("changes the address of an account with no password after a Google sign-in a moment ago", async () => {
    const changeAddress = spy<[]>()
    const values = { code: "", email: "new@example.com", password: "" }
    await mount(
      account({
        status: proven,
        values,
        onChange: changeAddress.fn,
        providerProof: { providers: ["google"], fresh: true },
      }),
    )

    await click("[data-e2e=email-change-open]")

    expect(document.querySelectorAll("[data-e2e=email-password]").length).toBe(0)
    expect(find("[data-e2e=provider-proof-fresh]").textContent).toContain("Google")
    expect(find("[data-e2e=email-change-dialog]").textContent)
      .toContain("You keep signing in with Google.")
    const form = find<HTMLFormElement>("[data-e2e=email-new]").closest("form")!
    expect(Object.fromEntries(new FormData(form))).toEqual({ email: "new@example.com" })
    expect(await submit("[data-e2e=email-new]")).toBe(true)
    expect(changeAddress.calls).toHaveLength(1)
  })

  it("sends an account with no password to Google before a change when the sign-in is not recent", async () => {
    await mount(
      account({ status: proven, providerProof: { providers: ["google", "github"], fresh: false } }),
    )

    await click("[data-e2e=email-change-open]")

    // Plain links out of the app, which come back to the Account section.
    expect(find("[data-e2e=provider-proof-google]").getAttribute("href"))
      .toBe("/api/auth/google/start?next=%2Fprofile%2Faccount")
    expect(find("[data-e2e=provider-proof-github]").getAttribute("href"))
      .toBe("/api/auth/github/start?next=%2Fprofile%2Faccount")
    expect(document.querySelectorAll("[data-e2e=email-new]").length).toBe(0)
    expect(document.querySelectorAll("[data-e2e=email-change]").length).toBe(0)
  })

  it("asks for the new address and the password, then for the code in the same dialog", async () => {
    const changeAddress = spy<[]>()
    const values = { code: "", email: "new@example.com", password: "Passw0rd!" }
    const props = { status: proven, values, onChange: changeAddress.fn }
    await mount(account(props))
    expect(isOpen("email-change-dialog")).toBe(false)

    await click("[data-e2e=email-change-open]")
    expect(isOpen("email-change-dialog")).toBe(true)
    const form = find<HTMLFormElement>("[data-e2e=email-new]").closest("form")!
    expect(Object.fromEntries(new FormData(form))).toEqual({
      email: "new@example.com",
      password: "Passw0rd!",
    })
    expect(find("[data-e2e=email-change]").textContent).toBe("Send code")
    expect(await submit("[data-e2e=email-new]")).toBe(true)
    expect(changeAddress.calls).toHaveLength(1)

    await rerender(account({ ...props, pending: changePending }))
    await rerender(account({ ...props, status: { ...proven, pending: "new@example.com" } }))
    expect(isOpen("email-change-dialog")).toBe(true)
    expect(focused()).toBe("email-code")
    const step = find("[data-e2e=email-verify-card]").textContent
    expect(step).toContain("new@example.com")
    expect(step).toContain("You keep signing in with ann@example.com until you enter it.")
    expect(find("[data-e2e=email-verify]").textContent).toBe("Confirm address")
  })

  it("asks the app to drop what was typed when the dialog is closed, by Cancel or by the dialog itself", async () => {
    const close = spy<[]>()
    await mount(account({ status: proven, onClose: close.fn }))

    await click("[data-e2e=email-change-open]")
    await clickInDialog("email-change-dialog", "Cancel")
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(close.calls).toHaveLength(1)

    await click("[data-e2e=email-change-open]")
    await click("[data-e2e=email-change-dialog] button[aria-label=Close]")
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(close.calls).toHaveLength(2)
  })

  it("keeps the dialog at the address and moves focus there when a change is refused", async () => {
    await mount(account({ status: proven }))
    await click("[data-e2e=email-change-open]")

    const errors = { ...emailDefaults.errors, change: "Invalid password" }
    await rerender(account({ status: proven, pending: changePending }))
    await rerender(account({ status: proven, errors }))

    expect(isOpen("email-change-dialog")).toBe(true)
    expect(focused()).toBe("email-new")
    expect(find("[data-e2e=email-change-dialog]").textContent).toContain("Invalid password")
  })

  it("names the change action after the address and gives the actions a 44 px target on a phone", async () => {
    await mount(account({ openEmailCode: true }))

    expect(find("[data-e2e=email-change-open]").textContent).toBe("Change e-mail address")
    for (const hook of ["email-change-open", "email-code-open", "email-send"]) {
      const classes = find(`[data-e2e=${hook}]`).classList
      expect([hook, classes.contains("min-h-11")]).toEqual([hook, true])
    }
  })

  it("tells a username account that the address replaces the username for sign-in", async () => {
    await mount(account({ status: { email: null, proven: false, pending: null } }))
    expect(find("[data-e2e=email-current]").textContent).toContain(
      "You sign in with your username.",
    )

    await click("[data-e2e=email-change-open]")
    expect(find("[data-e2e=email-change-dialog]").textContent)
      .toContain("Once you enter it, you sign in with that address.")
  })

  it("claims no mail was sent, since mail may be off", async () => {
    await mount(account({ openEmailCode: true }))
    const banner = renderToString(<EmailBanner status={unproven} />)
    for (const text of [document.body.textContent ?? "", banner]) {
      expect(text.toLowerCase()).not.toMatch(/\b(sent|mailed)\b/)
    }
  })
})

describe("EmailBanner", () => {
  it("warns with a link to the e-mail page while an address waits for its code", () => {
    const html = renderToString(<EmailBanner status={unproven} />)
    expect(html).toMatch(/<a [^>]*href="\/profile\/account\?verify"[^>]*>Enter the code<\/a>/)
    expect(html.replaceAll("<wbr/>", "")).toContain("ann@example.com")
  })

  it("lets a narrow screen wrap the address only after its @ and before its dots", () => {
    const status = { email: "ann.lee@mail.example.com", proven: false, pending: null }
    const html = renderToString(<EmailBanner status={status} />)
    expect(html).toContain(
      '<strong class="wrap-anywhere">ann<wbr/>.lee@<wbr/>mail<wbr/>.example<wbr/>.com</strong>',
    )
  })

  it("gives its link a 44 px touch target on a phone", () => {
    const html = renderToString(<EmailBanner status={unproven} />)
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Enter the code<\/a>/)
  })

  it("draws nothing once the address is proven, or before its state is known", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(renderToString(<EmailBanner status={proven} />)).toBe("")
    expect(renderToString(<EmailBanner status={null} />)).toBe("")
  })

  it("is said to show only while an address waits for its code, as it draws", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(showsEmailBanner(unproven)).toBe(true)
    expect(showsEmailBanner(proven)).toBe(false)
    expect(showsEmailBanner(null)).toBe(false)
  })
})
