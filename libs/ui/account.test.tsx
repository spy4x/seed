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
  UserMFAStatus,
  type UserPushTokenPublic,
} from "@domain/identity"
import { GroupRole } from "@domain/groups"
import type { AccountDeleteProps } from "./account-delete.tsx"
import { AuthScreen } from "./auth-screen.tsx"
import {
  EMAIL_FAILURES,
  EmailBanner,
  EmailScreen,
  type EmailScreenProps,
  EmailUnavailable,
  showsEmailBanner,
} from "./email-screen.tsx"
import { createFormatters } from "@spy4x/time/format"
import { AppFrame, PublicFrame } from "./frame.tsx"
import { railFocusRing } from "@spy4x/preact-system/rail"
import { ProfileScreen, type ProfileScreenProps } from "./profile-screen.tsx"
import { GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS } from "./progressive.tsx"
import { TwoFactorProof } from "./two-factor.ts"

const window = new Window({ url: "http://app.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  location: globalThis.location,
  getComputedStyle: globalThis.getComputedStyle,
  HTMLElement: globalThis.HTMLElement,
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

/** A theme store's slice, recording every choice. */
function themeSpy(preference: "system" | "light" | "dark" = "system") {
  const chosen: string[] = []
  return {
    chosen,
    preference: { value: preference },
    set: (value: string) => void chosen.push(value),
  }
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

  it("lists Notes, Tags, Activity and Groups, with Activity pointing at the selected group", async () => {
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
    expect(railLabels()).toEqual(["Notes", "Tags", "Activity", "Groups"])
    expect([...document.querySelectorAll(rail)].map((link) => link.getAttribute("href")))
      .toEqual(["/notes", "/tags", "/groups/g-1/activity", "/groups"])
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
    expect(railLabels()).toEqual(["Notes", "Tags", "Groups"])
    await rerender(frame("g-2"))
    expect(railLabels()).toEqual(["Notes", "Tags", "Groups"])
  })

  it("follows a plain click on a navigation entry through navigate, and leaves a Ctrl-click to the browser", async () => {
    const navigate = spy<[string]>()
    await mount(
      <AppFrame user={ada} onSignOut={() => {}} navigate={navigate.fn}>page</AppFrame>,
    )
    const tags = '[data-e2e=rail-shell-rail] a[data-e2e="rail-shell-entry"][href="/tags"]'

    expect(await click(tags)).toBe(true)
    expect(await click(tags, { ctrlKey: true })).toBe(false)
    expect(navigate.calls).toEqual([["/tags"]])
  })

  it("marks a list as the page, a note inside it as its section, and nothing for the account's pages", async () => {
    const at = (path: string) => (
      <AppFrame user={ada} onSignOut={() => {}} currentPath={path}>page</AppFrame>
    )
    const marked = (value: string) =>
      [...document.querySelectorAll(`[data-e2e=rail-shell-rail] [aria-current="${value}"]`)]
        .map((link) => link.getAttribute("href"))

    await mount(at(SCREEN_PATHS.email))
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0)
    await rerender(at(SCREEN_PATHS.profile))
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0)

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

  it("names the account entry after the person, shows their name and address, and offers Profile, Theme and Sign out", async () => {
    await mount(<AppFrame user={ada} onSignOut={() => {}} theme={themeSpy()}>page</AppFrame>)
    expect(find(ACCOUNT).getAttribute("aria-label")).toBe("Account: Ada Lovelace")
    expect(find("[data-e2e=account-menu-header]").textContent).toContain(
      "Ada Lovelaceada@example.com",
    )
    expect(menuItems(ACCOUNT)).toEqual(["Profile", "System", "Light", "Dark", "Sign out"])
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

  it("opens Profile from the account menu and the sheet through navigate, and leaves a Ctrl-click to the browser", async () => {
    const navigate = spy<[string]>()
    await mount(<AppFrame user={ada} onSignOut={() => {}} navigate={navigate.fn}>page</AppFrame>)
    const menu = "[data-e2e=app-shell-account] [role=menu]"

    expect(control(menu, "Profile").getAttribute("href")).toBe(SCREEN_PATHS.profile)
    expect(await clickControl(menu, "Profile")).toBe(true)
    expect(await clickControl(menu, "Profile", { ctrlKey: true })).toBe(false)
    expect(await clickControl(SHEET_ACCOUNT, "Profile")).toBe(true)
    expect(navigate.calls).toEqual([[SCREEN_PATHS.profile], [SCREEN_PATHS.profile]])
  })

  it("checks the current theme in the account menu and stores the one chosen", async () => {
    const theme = themeSpy("system")
    await mount(<AppFrame user={ada} onSignOut={() => {}} theme={theme}>page</AppFrame>)

    await click(ACCOUNT)
    const menu = menuOf(ACCOUNT)
    const checked = () =>
      [...menu.querySelectorAll("[data-e2e=account-menu-theme] [role=menuitemradio]")]
        .map((item) => item.getAttribute("aria-checked"))
    expect(checked()).toEqual(["true", "false", "false"])
    await act(() => {
      menu.querySelector("[data-e2e=account-menu-theme-dark]")!.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, button: 0 }) as unknown as Event,
      )
    })

    expect(theme.chosen).toEqual(["dark"])
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
  it("shows the name and the address with its state as rows, with no form open", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    expect(find("[data-e2e=profile-name]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=profile-email-link]").getAttribute("href")).toBe(SCREEN_PATHS.email)
    expect(document.body.textContent).toContain("ada@example.com")
    expect(document.body.textContent).toContain("Verified")
    expect(document.body.textContent).not.toContain("Not verified")
    expect(isOpen("profile-dialog")).toBe(false)
    expect(isOpen("password-dialog")).toBe(false)
  })

  it("gives the two-factor and the push settings the places the first-steps card links to", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    expect(find("#security").textContent).toContain("Two-factor")
    expect(find("#push-devices").textContent).toContain("Push devices")
  })

  it("names each row action after its setting, so a screen reader can tell them apart", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    const name = (hook: string) => find(`[data-e2e=${hook}]`).textContent
    expect(name("profile-edit")).toBe("Edit name")
    expect(name("profile-email-link")).toBe("Change e-mail address")
    expect(name("password-open")).toBe("Change password")
    expect(name("totp-start")).toBe("Turn on two-factor sign-in")
  })

  it("gives each row action a 44 px touch target below the sm breakpoint", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    for (const hook of ["profile-edit", "profile-email-link", "password-open", "totp-start"]) {
      const classes = find(`[data-e2e=${hook}]`).classList
      expect([hook, classes.contains("min-h-11")]).toEqual([hook, true])
    }
  })

  it("starts the page with its header and shows the first-steps card under it", async () => {
    await mount(
      <ProfileScreen
        {...profileDefaults}
        onboarding={<div data-e2e="onboarding">Get started</div>}
      />,
    )

    const heading = find("h1")
    const card = find("[data-e2e=onboarding]")
    expect(heading.textContent).toBe("Profile")
    expect(heading.compareDocumentPosition(card) & window.Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(
      card.compareDocumentPosition(find("#security")) & window.Node.DOCUMENT_POSITION_FOLLOWING,
    )
      .toBeTruthy()
  })

  it("shows an empty push device list inside the section's own card, not in a dashed box", async () => {
    await mount(<ProfileScreen {...profileDefaults} pushDevices={[]} onRegisterPush={() => {}} />)

    const empty = find("#push-devices [role=status]")
    expect(empty.textContent).toContain("No devices yet")
    expect(empty.closest(".pc-card")).not.toBeNull()
    expect(document.querySelectorAll(".border-dashed").length).toBe(0)
  })

  it("names each settings group by its own h2, under the page's one h1", async () => {
    await mount(<ProfileScreen {...profileDefaults} />)

    const names = [...document.querySelectorAll("section[aria-labelledby]")].map((section) =>
      document.getElementById(section.getAttribute("aria-labelledby") ?? "")?.textContent
    )
    expect(names).toEqual(["Account", "Security", "Push devices"])
    expect([...document.querySelectorAll("h1, h2")].map((h) => h.tagName)).toEqual(
      ["H1", "H2", "H2", "H2"],
    )
  })

  it("edits the name in a dialog, saves it through the app's callback and closes once it is saved", async () => {
    const change = spy<[string, string]>()
    const save = spy<[]>()
    const props = { ...profileDefaults, onValueChange: change.fn, onSaveProfile: save.fn }
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
    await mount(<ProfileScreen {...profileDefaults} pending={pending} onSaveProfile={save.fn} />)
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
      await mount(<ProfileScreen {...profileDefaults} {...{ [callback]: cancel.fn }} />)

      await click(`[data-e2e=${opener}]`)
      await clickInDialog(dialog, "Cancel")
      expect(isOpen(dialog)).toBe(false)
      await click(`[data-e2e=${opener}]`)
      await click(`[data-e2e=${dialog}] button[aria-label=Close]`)
      expect(isOpen(dialog)).toBe(false)
      expect(cancel.calls).toHaveLength(2)
    })
  }

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
    await mount(<ProfileScreen {...profileDefaults} pushDevices={[first, second]} />)

    const text = (id: string) => find(`[data-e2e=push-device-${id}]`).textContent
    expect(text(first.deviceId)).toContain("Device 4a9b1c35")
    expect(text(second.deviceId)).toContain("Device 5b8e2d46")
  })

  it("offers Add this device in an empty list, and removes a device with its id", async () => {
    const remove = spy<[string]>()
    await mount(<ProfileScreen {...profileDefaults} onRemovePush={remove.fn} />)
    expect(await submit(`[data-e2e=push-remove-${device.deviceId}]`)).toBe(true)
    expect(remove.calls).toEqual([[device.deviceId]])

    const register = spy<[]>()
    await rerender(
      <ProfileScreen {...profileDefaults} pushDevices={[]} onRegisterPush={register.fn} />,
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
      {...props}
      accountDeletion={{ ...deletionDefaults, ...deletion }}
    />
  )
}

/** Opens the danger zone's disclosure and then the deletion dialog. */
async function openDeletion(): Promise<void> {
  find<HTMLDetailsElement>("[data-e2e=danger-zone]").open = true
  await click("[data-e2e=account-delete-open]")
}

describe("deleting the account from the profile", () => {
  it("keeps the danger zone closed, last on the page, and leaves it out without the app's wiring", async () => {
    await mount(withDeletion())

    const zone = find<HTMLDetailsElement>("[data-e2e=danger-zone]")
    expect(zone.open).toBe(false)
    expect(zone.querySelector("summary")?.textContent).toBe("Danger zone")
    const blocks = [...zone.parentElement!.children].filter((child) => child.tagName !== "DIALOG")
    expect(blocks[blocks.length - 1]).toBe(zone)
    expect(isOpen("account-delete-dialog")).toBe(false)

    await rerender(<ProfileScreen {...profileDefaults} />)
    expect(document.querySelector("[data-e2e=danger-zone]")).toBeNull()
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
    expect(find("[data-e2e=danger-zone] summary").classList.contains("min-h-11")).toBe(true)
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

  it("lists each blocking group as a link to its settings with what it needs, and asks for no password", async () => {
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
      GROUP_PATHS.settings("g-1"),
      GROUP_PATHS.settings("g-2"),
      GROUP_PATHS.settings("g-3"),
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
    expect(navigate.calls).toEqual([[GROUP_PATHS.settings("g-1")]])
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

const emailDefaults: EmailScreenProps = {
  status: { email: "ann@example.com", proven: false, pending: null },
  values: { code: "", email: "", password: "" },
  onValueChange: () => {},
  errors: { verify: null, send: null, change: null },
  notices: { send: null, change: null },
  pending: { verify: false, send: false, change: false },
}

/** The e-mail page while its change request is on its way. */
const changePending = { ...emailDefaults.pending, change: true }

describe("EmailScreen", () => {
  it("reports the typed code and checks it through the app's callback", async () => {
    const change = spy<[string, string]>()
    const verify = spy<[]>()
    await mount(<EmailScreen {...emailDefaults} onValueChange={change.fn} onVerify={verify.fn} />)

    await type("[data-e2e=email-code]", "Ab3_x-9Q")

    expect(change.calls).toEqual([["code", "Ab3_x-9Q"]])
    expect(await submit("[data-e2e=email-code]")).toBe(true)
    expect(verify.calls).toHaveLength(1)
  })

  it("puts the code entry and the new-code request in one card under the section's heading", async () => {
    await mount(<EmailScreen {...emailDefaults} />)

    const card = find("[data-e2e=email-verify-card] .pc-card")
    expect(card.querySelector("[data-e2e=email-code]")).not.toBeNull()
    expect(card.querySelector("[data-e2e=email-send]")).not.toBeNull()
  })

  it("refuses a second check while the first is pending", async () => {
    const verify = spy<[]>()
    const pending = { ...emailDefaults.pending, verify: true }
    await mount(<EmailScreen {...emailDefaults} pending={pending} onVerify={verify.fn} />)

    await submit("[data-e2e=email-code]")

    expect(verify.calls).toHaveLength(0)
  })

  it("ties a refused code to the code field and moves focus there", async () => {
    await mount(<EmailScreen {...emailDefaults} />)
    find("[data-e2e=email-verify]").focus()

    const errors = { ...emailDefaults.errors, verify: "This code is wrong" }
    await rerender(<EmailScreen {...emailDefaults} errors={errors} />)

    const field = find("[data-e2e=email-code]")
    const describedBy = field.getAttribute("aria-describedby") ?? ""
    expect(describedBy.split(" ").map((id) => document.getElementById(id)?.textContent))
      .toContain("This code is wrong")
    expect(focused()).toBe("email-code")
  })

  it("shows the address with its state, and asks for no code once it is proven", async () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={proven} />)

    expect(find("[data-e2e=email-current]").textContent).toBe("ann@example.com")
    expect(find("[data-e2e=email-state]").textContent).toBe("Verified")
    expect(document.querySelector("[data-e2e=email-verify-card]")).toBe(null)
  })

  it("changes the address of an account with no password after a Google sign-in a moment ago", async () => {
    const changeAddress = spy<[]>()
    const proven = { email: "ann@example.com", proven: true, pending: null }
    const values = { code: "", email: "new@example.com", password: "" }
    await mount(
      <EmailScreen
        {...emailDefaults}
        status={proven}
        values={values}
        onChange={changeAddress.fn}
        providerProof={{ providers: ["google"], fresh: true }}
      />,
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
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(
      <EmailScreen
        {...emailDefaults}
        status={proven}
        providerProof={{ providers: ["google", "github"], fresh: false }}
      />,
    )

    await click("[data-e2e=email-change-open]")

    // Plain links out of the app, which come back to this page.
    expect(find("[data-e2e=provider-proof-google]").getAttribute("href"))
      .toBe("/api/auth/google/start?next=%2Femail")
    expect(find("[data-e2e=provider-proof-github]").getAttribute("href"))
      .toBe("/api/auth/github/start?next=%2Femail")
    expect(document.querySelectorAll("[data-e2e=email-new]").length).toBe(0)
    expect(document.querySelectorAll("[data-e2e=email-change]").length).toBe(0)
  })

  it("changes the address in a dialog, which closes and hands focus to the new address's code", async () => {
    const changeAddress = spy<[]>()
    const proven = { email: "ann@example.com", proven: true, pending: null }
    const values = { code: "", email: "new@example.com", password: "Passw0rd!" }
    const props = { ...emailDefaults, status: proven, values, onChange: changeAddress.fn }
    await mount(<EmailScreen {...props} />)
    expect(isOpen("email-change-dialog")).toBe(false)

    await click("[data-e2e=email-change-open]")
    expect(isOpen("email-change-dialog")).toBe(true)
    const form = find<HTMLFormElement>("[data-e2e=email-new]").closest("form")!
    expect(Object.fromEntries(new FormData(form))).toEqual({
      email: "new@example.com",
      password: "Passw0rd!",
    })
    expect(await submit("[data-e2e=email-new]")).toBe(true)
    expect(changeAddress.calls).toHaveLength(1)

    await rerender(<EmailScreen {...props} pending={changePending} />)
    await rerender(<EmailScreen {...props} status={{ ...proven, pending: "new@example.com" }} />)
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(focused()).toBe("email-code")
    expect(find("[data-e2e=email-verify-card]").textContent).toContain("new@example.com")
  })

  it("closes the change dialog when the address already waiting is asked for again", async () => {
    // The API answers a repeated request with the same address and the same notice.
    const waiting = { email: "ann@example.com", proven: true, pending: "new@example.com" }
    const notices = { send: null, change: "Enter the code we mailed to new@example.com." }
    const props = { ...emailDefaults, status: waiting, notices }
    await mount(<EmailScreen {...props} />)
    await click("[data-e2e=email-change-open]")

    await rerender(<EmailScreen {...props} pending={changePending} />)
    await rerender(<EmailScreen {...props} />)
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(focused()).toBe("email-code")
  })

  it("keeps the change dialog closed once the new address is proven", async () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={proven} />)
    await click("[data-e2e=email-change-open]")
    await rerender(<EmailScreen {...emailDefaults} status={proven} pending={changePending} />)
    await rerender(
      <EmailScreen {...emailDefaults} status={{ ...proven, pending: "new@example.com" }} />,
    )

    await rerender(
      <EmailScreen {...emailDefaults} status={{ ...proven, email: "new@example.com" }} />,
    )
    expect(isOpen("email-change-dialog")).toBe(false)
  })

  it("asks the app to drop the typed password when the change dialog is closed, by Cancel or by the dialog itself", async () => {
    const change = spy<[string, string]>()
    const values = { code: "", email: "new@example.com", password: "Passw0rd!" }
    const props = { ...emailDefaults, values, onValueChange: change.fn }
    await mount(<EmailScreen {...props} />)

    await click("[data-e2e=email-change-open]")
    await clickInDialog("email-change-dialog", "Cancel")
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(change.calls).toEqual([["password", ""]])

    await click("[data-e2e=email-change-open]")
    await click("[data-e2e=email-change-dialog] button[aria-label=Close]")
    expect(isOpen("email-change-dialog")).toBe(false)
    expect(change.calls).toEqual([["password", ""], ["password", ""]])
  })

  it("keeps the dialog open and moves focus to the new address when a change is refused", async () => {
    await mount(<EmailScreen {...emailDefaults} />)
    await click("[data-e2e=email-change-open]")

    const errors = { ...emailDefaults.errors, change: "Invalid password" }
    await rerender(<EmailScreen {...emailDefaults} pending={changePending} />)
    await rerender(<EmailScreen {...emailDefaults} errors={errors} />)

    expect(isOpen("email-change-dialog")).toBe(true)
    expect(focused()).toBe("email-new")
    expect(find("[data-e2e=email-change-dialog]").textContent).toContain("Invalid password")
  })

  it("names the change action after the address and gives the row actions a 44 px target on a phone", async () => {
    await mount(<EmailScreen {...emailDefaults} />)

    expect(find("[data-e2e=email-change-open]").textContent).toBe("Change e-mail address")
    for (const hook of ["email-change-open", "email-send"]) {
      const classes = find(`[data-e2e=${hook}]`).classList
      expect([hook, classes.contains("min-h-11")]).toEqual([hook, true])
    }
  })

  it("tells a username account that the address replaces the username for sign-in", async () => {
    const status = { email: null, proven: false, pending: null }
    await mount(<EmailScreen {...emailDefaults} status={status} />)
    expect(find("[data-e2e=email-current]").textContent).toContain(
      "You sign in with your username.",
    )

    await click("[data-e2e=email-change-open]")
    expect(find("[data-e2e=email-change-dialog]").textContent)
      .toContain("Once you enter it, you sign in with that address.")
  })

  it("claims no mail was sent, since mail may be off", () => {
    const page = renderToString(<EmailScreen {...emailDefaults} />)
    const banner = renderToString(<EmailBanner status={emailDefaults.status} />)
    for (const html of [page, banner]) expect(html.toLowerCase()).not.toMatch(/\b(sent|mailed)\b/)
  })

  it("retries an unread address through the app's callback, or reloads the page without it", async () => {
    const retry = spy<[]>()
    await mount(<EmailUnavailable onRetry={retry.fn} />)

    expect(find("[role=alert]").textContent).toBe(EMAIL_FAILURES.load)
    await click("[data-e2e=email-retry]")
    expect(retry.calls).toHaveLength(1)

    await mount(<EmailUnavailable />)
    expect(document.querySelectorAll("[data-e2e=email-retry]")[1].getAttribute("href"))
      .toBe(SCREEN_PATHS.email)
  })
})

describe("EmailBanner", () => {
  it("warns with a link to the e-mail page while an address waits for its code", () => {
    const html = renderToString(<EmailBanner status={emailDefaults.status} />)
    expect(html).toMatch(/<a [^>]*href="\/email"[^>]*>Enter the code<\/a>/)
    expect(html).toContain("ann@example.com")
  })

  it("gives its link a 44 px touch target on a phone", () => {
    const html = renderToString(<EmailBanner status={emailDefaults.status} />)
    expect(html).toMatch(/<a [^>]*class="[^"]*\bmin-h-11\b[^"]*"[^>]*>Enter the code<\/a>/)
  })

  it("draws nothing once the address is proven, or before its state is known", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(renderToString(<EmailBanner status={proven} />)).toBe("")
    expect(renderToString(<EmailBanner status={null} />)).toBe("")
  })

  it("is said to show only while an address waits for its code, as it draws", () => {
    const proven = { email: "ann@example.com", proven: true, pending: null }
    expect(showsEmailBanner(emailDefaults.status)).toBe(true)
    expect(showsEmailBanner(proven)).toBe(false)
    expect(showsEmailBanner(null)).toBe(false)
  })
})
