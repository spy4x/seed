// deno-lint-ignore-file ui-text/no-literal
/**
 * The admin app's screens (#146), driven in a browser DOM (happy-dom): what the search sends, what
 * the list and the person's page offer, what the action dialog sends and where focus goes.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  ADMIN_NO_FILTER,
  type AdminStats,
  type AdminUserDetail,
  type AdminUserFilter,
  type AdminUserRow,
  AuthAuditEventType,
  UserRole,
} from "@domain/identity"
import { ADMIN_PATHS, AdminSignInScreen } from "./admin-frame.tsx"
import { AdminUsersScreen, type AdminUsersScreenProps } from "./admin-users-screen.tsx"
import { AdminUserScreen, type AdminUserScreenProps, auditTone } from "./admin-user-screen.tsx"
import {
  AdminDashboardScreen,
  changeText,
  changeTone,
  countAxisTop,
} from "./admin-dashboard-screen.tsx"

const window = new Window({ url: "http://admin.localhost/" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
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

/** Renders `node`, into the same root when one is mounted already, as a prop change would. */
async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function type(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  await act(() => {
    field.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event)
  })
}

/** Presses the button whose text is `text` inside `scope`. */
async function press(scope: string, text: string): Promise<void> {
  const button = [...find(scope).querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`no button "${text}" in ${scope}`)
  await act(() => {
    button.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function focused(): string | null | undefined {
  const element = document.activeElement
  return element?.getAttribute("data-e2e") ?? element?.tagName
}

const ada: AdminUserRow = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: UserRole.VIEWER,
  blockedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: "2026-10-14T10:00:00.000Z",
}
const grace: AdminUserRow = {
  ...ada,
  id: 43,
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@example.com",
  role: UserRole.OPERATOR,
  blockedAt: "2026-10-12T10:00:00.000Z",
}

function listProps(calls: unknown[][], props: Partial<AdminUsersScreenProps> = {}) {
  return {
    filter: ADMIN_NO_FILTER,
    list: { users: [ada, grace], total: 30, page: 1, pageSize: 25 },
    pending: false,
    error: null,
    onSearch: (filter) => void calls.push(["search", filter]),
    onPage: (page) => void calls.push(["page", page]),
    ...props,
  } satisfies AdminUsersScreenProps
}

describe("the admin user list", () => {
  it("sends the typed words back on page 1, keeping the filters and the sort", async () => {
    const calls: unknown[][] = []
    const filter = { ...ADMIN_NO_FILTER, role: UserRole.OPERATOR, blocked: "blocked", page: 2 }
    await mount(
      <AdminUsersScreen {...listProps(calls, { filter: filter as AdminUserFilter })} />,
    )
    await type("[data-e2e=admin-users-search]", "  ada love ")
    await submit("[data-e2e=admin-users-submit]")

    expect(calls).toEqual([["search", { ...filter, query: "ada love", page: 1 }]])
  })

  it("filters at once when a status or role chip is pressed, back on page 1", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminUsersScreen {...listProps(calls, { filter: { ...ADMIN_NO_FILTER, page: 3 } })} />,
    )
    await press("[data-e2e=admin-users-blocked]", "Blocked")
    await press("[data-e2e=admin-users-role]", "Operator")

    expect(calls).toEqual([
      ["search", { ...ADMIN_NO_FILTER, blocked: "blocked", page: 1 }],
      ["search", { ...ADMIN_NO_FILTER, role: UserRole.OPERATOR, page: 1 }],
    ])
  })

  it("drops a chip's filter when its pressed chip is pressed again", async () => {
    const calls: unknown[][] = []
    const filter: AdminUserFilter = { ...ADMIN_NO_FILTER, role: UserRole.OPERATOR }
    await mount(<AdminUsersScreen {...listProps(calls, { filter })} />)
    expect(find("[data-e2e=admin-users-role] [aria-pressed=true]").textContent).toBe("Operator")
    await press("[data-e2e=admin-users-role]", "Operator")

    expect(calls).toEqual([["search", { ...filter, role: null, page: 1 }]])
  })

  it("clears every filter but keeps the sort, and offers Clear only while one is set", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUsersScreen {...listProps(calls)} />)
    expect(has("[data-e2e=admin-users-clear]")).toBe(false)

    const filter: AdminUserFilter = {
      ...ADMIN_NO_FILTER,
      query: "ada",
      blocked: "active",
      sort: [{ key: "role", direction: "asc" }],
    }
    await mount(<AdminUsersScreen {...listProps(calls, { filter })} />)
    await click("[data-e2e=admin-users-clear]")

    expect(calls).toEqual([["search", {
      ...ADMIN_NO_FILTER,
      sort: [{ key: "role", direction: "asc" }],
    }]])
  })

  it("sorts by a pressed column alone while the list is in its default order, on page 1", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminUsersScreen {...listProps(calls, { filter: { ...ADMIN_NO_FILTER, page: 2 } })} />,
    )
    expect(find("th[aria-sort]").textContent).toBe("Created")
    await press("[data-e2e=admin-users-list] thead", "Last seen")

    expect(calls).toEqual([["search", {
      ...ADMIN_NO_FILTER,
      sort: [{ key: "lastSeenAt", direction: "asc" }],
      page: 1,
    }]])
  })

  it("adds a pressed column after a sort the operator chose, as the least significant", async () => {
    const calls: unknown[][] = []
    const filter: AdminUserFilter = {
      ...ADMIN_NO_FILTER,
      sort: [{ key: "role", direction: "asc" }],
    }
    await mount(<AdminUsersScreen {...listProps(calls, { filter })} />)
    await press("[data-e2e=admin-users-list] thead", "Last seen")

    expect(calls).toEqual([["search", {
      ...filter,
      sort: [{ key: "role", direction: "asc" }, { key: "lastSeenAt", direction: "asc" }],
    }]])
  })

  it("offers no sorting by status, which the server cannot sort by", async () => {
    await mount(<AdminUsersScreen {...listProps([])} />)
    const status = [...document.querySelectorAll("th")]
      .find((th) => th.textContent?.trim() === "Status")
    expect(status?.querySelector("button")).toBe(null)
  })

  it("links each person to their page and marks who is blocked", async () => {
    await mount(<AdminUsersScreen {...listProps([])} />)

    expect(find("[data-e2e=admin-user-42]").getAttribute("href")).toBe(ADMIN_PATHS.user(42))
    expect(find("[data-e2e=admin-user-42]").textContent).toBe("Ada Lovelace")
    const row = (id: number) => find(`[data-e2e=admin-user-${id}]`).closest("tr")!
    expect(row(43).querySelector("[data-e2e=admin-user-blocked]")).not.toBe(null)
    expect(row(42).querySelector("[data-e2e=admin-user-blocked]")).toBe(null)
  })

  it("asks the app for the next page and then moves focus to the list's heading", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUsersScreen {...listProps(calls)} />)
    const next = [...document.querySelectorAll("nav button")]
      .find((button) => button.textContent?.trim() === "2")
    if (!next) throw new Error("the pagination has no page 2")
    await act(() => {
      next.dispatchEvent(new window.MouseEvent("click", { bubbles: true }) as unknown as Event)
    })
    expect(calls).toEqual([["page", 2]])

    await mount(
      <AdminUsersScreen
        {...listProps(calls, { list: { users: [ada], total: 30, page: 2, pageSize: 25 } })}
      />,
    )
    expect(focused()).toBe("admin-users-count")
  })

  it("leaves focus where it was when the first page arrives after loading", async () => {
    await mount(<AdminUsersScreen {...listProps([], { list: null })} />)
    find("[data-e2e=admin-users-search]").focus()
    await mount(<AdminUsersScreen {...listProps([])} />)
    expect(focused()).toBe("admin-users-search")
  })

  it("says so when nobody matches, without a dashed box", async () => {
    await mount(
      <AdminUsersScreen
        {...listProps([], { list: { users: [], total: 0, page: 1, pageSize: 25 } })}
      />,
    )
    expect(find("[data-e2e=admin-users-list]").textContent).toContain("Nobody matches")
    expect(has("[data-e2e^=admin-user-4]")).toBe(false)
    expect(has(".border-dashed")).toBe(false)
  })

  it("keeps each chip row on one line that scrolls sideways on a phone, and caps the search", async () => {
    await mount(<AdminUsersScreen {...listProps([])} />)

    for (const row of ["[data-e2e=admin-users-blocked]", "[data-e2e=admin-users-role]"]) {
      expect(find(row).className).toContain("overflow-x-auto")
      expect(find(row).className).toContain("sm:flex-wrap")
      expect(find(`${row} [role=group]`).className).toContain("flex-nowrap")
    }
    expect(find("[data-e2e=admin-users-search]").closest(".basis-60")?.className).toContain(
      "sm:max-w-md",
    )
  })

  it("shows a loading state until the list comes, and the API's message when it fails", async () => {
    await mount(<AdminUsersScreen {...listProps([], { list: null })} />)
    expect(has("[role=status][aria-label='Loading people']")).toBe(true)

    await mount(<AdminUsersScreen {...listProps([], { list: null, error: "The list is down" })} />)
    expect(has("[role=status][aria-label='Loading people']")).toBe(false)
    expect(document.body.textContent).toContain("The list is down")
  })
})

const detail: AdminUserDetail = {
  user: ada,
  methods: [{
    method: "password",
    email: "ada@example.com",
    provenAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
  }],
  sessions: [{
    id: 9,
    deviceName: "Firefox on Linux",
    ipHint: "203.0.113.x",
    createdAt: "2026-10-01T10:00:00.000Z",
    lastUsedAt: "2026-10-14T10:00:00.000Z",
  }],
  groups: [{ id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002", name: "Personal", role: 4 }],
  audits: [{
    id: 1,
    eventType: AuthAuditEventType.USER_UNBLOCKED,
    identifier: "operator:7",
    ip: "203.0.113.9",
    createdAt: "2026-10-13T10:00:00.000Z",
  }],
  trialUsedAt: null,
  preferences: {
    value: {
      theme: "dark",
      language: null,
      locale: "en-GB",
      timeZone: "Europe/Berlin",
      hourCycle: null,
      overview: [],
    },
    version: 3,
    updatedAt: "2026-10-12T10:00:00.000Z",
    firstTimeZone: "Europe/Berlin",
    firstLocale: "de-DE",
  },
}

const operator = { id: 7, role: UserRole.OPERATOR }

function userProps(calls: unknown[][], props: Partial<AdminUserScreenProps> = {}) {
  return {
    detail,
    error: null,
    operator,
    tab: "overview",
    onTab: (tab) => void calls.push(["tab", tab]),
    dialog: null,
    onOpenDialog: (action) => void calls.push(["open", action]),
    onCloseDialog: () => void calls.push(["close"]),
    actionError: null,
    pending: false,
    onAction: (action) => void calls.push(["action", action]),
    ...props,
  } satisfies AdminUserScreenProps
}

describe("one person in the admin app", () => {
  it("shows the person in a header card and their account on the Overview tab", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)

    expect(find("[data-e2e=admin-user-title]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=admin-user-card]").textContent).toContain("Viewer")
    expect(find("[role=tab][aria-selected=true]").textContent).toBe("Overview")
    expect(find("[role=tabpanel]").textContent).toContain("ada@example.com")
  })

  it("says on the Overview whether the person has used their billing trial", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)
    expect(find("[role=tabpanel]").textContent).toContain("Billing trialNot used")

    const trialUsedAt = "2026-10-12T10:00:00.000Z"
    await mount(<AdminUserScreen {...userProps([], { detail: { ...detail, trialUsedAt } })} />)
    const panel = find("[role=tabpanel]")
    expect(panel.textContent).toContain("Billing trialUsed ")
    expect(panel.querySelector(`time[datetime="${trialUsedAt}"]`)).not.toBeNull()
  })

  it("shows the person's language and region read-only on the Overview, with their time now", async () => {
    const now = new Date("2026-10-17T12:05:00.000Z")
    await mount(<AdminUserScreen {...userProps([], { now })} />)

    const panel = find("[role=tabpanel]")
    expect(panel.textContent).toContain("Language and region")
    expect(find("[data-e2e=admin-user-preferences-theme]").textContent).toContain("Dark")
    expect(find("[data-e2e=admin-user-preferences-time-zone]").textContent).toContain(
      "Berlin, Europe · GMT+2",
    )
    expect(find("[data-e2e=admin-user-preferences-time-zone]").textContent).toMatch(
      /(14:05|2:05\spm) there now/i,
    )
    expect(panel.querySelector("[data-e2e=admin-user-preferences-time-zone] button")).toBeNull()
  })

  it("shows each tab's own content: sign-in methods, sessions, groups and activity", async () => {
    const shown = async (tab: string, selector: string) => {
      await mount(<AdminUserScreen {...userProps([], { tab })} />)
      return find(`[role=tabpanel] ${selector}`).textContent
    }
    expect(await shown("methods", "[data-e2e=admin-user-methods]")).toContain("Password")
    expect(await shown("sessions", "[data-e2e=admin-user-sessions]")).toContain(
      "Firefox on Linux",
    )
    expect(await shown("groups", "[data-e2e=admin-user-groups]")).toContain("Owner")
    const activity = await shown("activity", "[data-e2e=admin-user-audits]")
    expect(activity).toContain("Unblocked by an operator")
    expect(activity).toContain("operator:7")
  })

  it("lists a passkey read-only by its name and dates, with no proof badge", async () => {
    const passkey = {
      method: "passkey",
      email: null,
      provenAt: null,
      createdAt: "2026-10-02T10:00:00.000Z",
      passkey: { name: "Chrome on macOS", lastUsedAt: "2026-10-14T10:00:00.000Z" },
    }
    await mount(
      <AdminUserScreen
        {...userProps([], { tab: "methods", detail: { ...detail, methods: [passkey] } })}
      />,
    )

    const row = find("[role=tabpanel] [data-e2e=admin-user-methods] li")
    expect(row.textContent).toContain("Passkey")
    expect(find("[data-e2e=admin-user-passkey]").textContent).toMatch(
      /^Chrome on macOS · Added .+ · Last used .+/,
    )
    expect(row.textContent).not.toMatch(/proven/i)
    expect(row.querySelector("button")).toBeNull()
  })

  it("reads a passkey rename in the activity as from the old name to the new one", async () => {
    const renamed = {
      id: 2,
      eventType: AuthAuditEventType.SIGN_IN_METHOD_RENAMED,
      identifier: "passkey name=MacBook Air from=Work laptop",
      ip: "203.0.113.5",
      createdAt: "2026-10-14T10:00:00.000Z",
    }
    const signedIn = {
      ...renamed,
      id: 3,
      eventType: AuthAuditEventType.SIGNED_IN,
      identifier: "passkey name=MacBook Air",
      ip: null,
    }
    const linked = {
      ...signedIn,
      id: 4,
      eventType: AuthAuditEventType.SIGN_IN_METHOD_LINKED,
      identifier: "google ada@example.com",
    }
    // Only a rename's identifier names an old name: any other passkey row reads as one name.
    const removed = {
      ...signedIn,
      id: 5,
      eventType: AuthAuditEventType.SIGN_IN_METHOD_UNLINKED,
      identifier: "passkey name=Desk from=home",
    }
    await mount(
      <AdminUserScreen
        {...userProps([], {
          tab: "activity",
          detail: { ...detail, audits: [renamed, signedIn, linked, removed] },
        })}
      />,
    )

    const entry = find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGN_IN_METHOD_RENAMED}]`)
    expect(entry.textContent).toContain("Passkey renamed")
    expect(entry.textContent).toContain('From "Work laptop" to "MacBook Air" · from 203.0.113.5')
    expect(find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGNED_IN}]`).textContent)
      .toContain('Passkey "MacBook Air"')
    // An identifier of another shape is shown as stored.
    expect(find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGN_IN_METHOD_LINKED}]`).textContent)
      .toContain("google ada@example.com")
    expect(find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGN_IN_METHOD_UNLINKED}]`).textContent)
      .toContain('Passkey "Desk from=home"')
  })

  it("lists the e-mail link as when it was last used, with no proof badge (#391)", async () => {
    const link = {
      method: "email-link",
      email: null,
      provenAt: null,
      createdAt: "2026-10-02T10:00:00.000Z",
      lastUsedAt: "2026-10-14T10:00:00.000Z",
    }
    await mount(
      <AdminUserScreen
        {...userProps([], { tab: "methods", detail: { ...detail, methods: [link] } })}
      />,
    )

    const row = find("[role=tabpanel] [data-e2e=admin-user-methods] li")
    expect(row.textContent).toContain("E-mail link")
    expect(find("[data-e2e=admin-user-email-link]").textContent).toMatch(/^Last used .+/)
    expect(row.textContent).not.toMatch(/proven/i)
  })

  it("names a sign-in and a sign-up by e-mail link in the activity's titles (#391)", async () => {
    const signedUp = {
      id: 2,
      eventType: AuthAuditEventType.SIGNED_UP,
      identifier: "email-link",
      ip: "203.0.113.5",
      createdAt: "2026-10-14T10:00:00.000Z",
    }
    const signedIn = { ...signedUp, id: 3, eventType: AuthAuditEventType.SIGNED_IN }
    await mount(
      <AdminUserScreen
        {...userProps([], { tab: "activity", detail: { ...detail, audits: [signedUp, signedIn] } })}
      />,
    )

    const up = find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGNED_UP}]`).textContent
    const into = find(`[data-e2e=admin-audit-${AuthAuditEventType.SIGNED_IN}]`).textContent
    expect(up).toContain("Signed up with an e-mail link")
    expect(into).toContain("Signed in with an e-mail link")
    // The title names the method, so the stored identifier is not repeated under it.
    expect(into).not.toContain("email-link")
    expect(into).toContain("from 203.0.113.5")
  })

  it("colours each activity entry by what happened, the block alone as a danger", async () => {
    const tones = {
      neutral: [AuthAuditEventType.SIGNED_IN, AuthAuditEventType.API_TOKEN_USED],
      success: [AuthAuditEventType.SIGNED_UP, AuthAuditEventType.USER_UNBLOCKED],
      warning: [
        AuthAuditEventType.SESSIONS_ENDED,
        AuthAuditEventType.API_TOKEN_REFUSED,
        AuthAuditEventType.UNCONFIRMED_ADDRESS_TAKEN,
      ],
      danger: [AuthAuditEventType.USER_BLOCKED],
    }
    for (const [tone, events] of Object.entries(tones)) {
      for (const event of events) expect([event, auditTone(event)]).toEqual([event, tone])
    }
    const everyEvent = Object.values(AuthAuditEventType).filter((value) =>
      typeof value === "number"
    )
    expect(everyEvent.filter((event) => auditTone(event) === "danger")).toEqual([
      AuthAuditEventType.USER_BLOCKED,
    ])
    expect(auditTone(999 as AuthAuditEventType)).toBe("neutral")

    await mount(<AdminUserScreen {...userProps([], { tab: "activity" })} />)
    const entry = find(`[data-e2e=admin-audit-${AuthAuditEventType.USER_UNBLOCKED}]`)
    expect(entry.querySelector("[data-timeline-dot]")?.getAttribute("data-timeline-dot"))
      .toBe("success")
    expect(entry.textContent).toContain("operator:7 · from 203.0.113.9")
  })

  it("says so on an empty tab, without a dashed box", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], { tab: "sessions", detail: { ...detail, sessions: [] } })}
      />,
    )

    expect(find("[role=tabpanel] [data-e2e=admin-user-sessions]").textContent).toContain(
      "Signed in nowhere.",
    )
    expect(has(".border-dashed")).toBe(false)
  })

  it("asks the app to open a tab when it is pressed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls)} />)
    await press("[role=tablist]", "Activity")

    expect(calls).toEqual([["tab", "activity"]])
  })

  it("adds a module's tab after the page's own and opens it from the address", async () => {
    const extraTabs = [{ id: "devices", label: "Devices", content: <p>Two phones</p> }]
    await mount(<AdminUserScreen {...userProps([], { extraTabs, tab: "devices" })} />)

    const labels = [...document.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)
    expect(labels[0]).toBe("Overview")
    expect(labels.at(-1)).toBe("Devices")
    expect(labels.filter((label) => label === "Devices")).toHaveLength(1)
    expect(find("[role=tabpanel]").textContent).toBe("Two phones")
  })

  it("opens the Overview for a tab the page does not have", async () => {
    await mount(<AdminUserScreen {...userProps([], { tab: "no-such-tab" })} />)
    expect(find("[role=tab][aria-selected=true]").textContent).toBe("Overview")
  })

  it("offers Block and End all sessions for a lower role, and opens the chosen dialog", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls)} />)

    expect(has("[data-e2e=admin-unblock-open]")).toBe(false)
    await click("[data-e2e=admin-block-open]")
    await click("[data-e2e=admin-end-sessions-open]")
    expect(calls).toEqual([["open", "block"], ["open", "end-sessions"]])
  })

  it("offers Unblock, not Block, for a blocked person", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], { detail: { ...detail, user: { ...ada, blockedAt: grace.blockedAt } } })}
      />,
    )
    expect(has("[data-e2e=admin-unblock-open]")).toBe(true)
    expect(has("[data-e2e=admin-block-open]")).toBe(false)
    expect(has("[data-e2e=admin-user-blocked-notice]")).toBe(true)
  })

  it("offers no action on the operator's own account, without a line saying so, or on an equal role", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], {
          detail: { ...detail, user: { ...ada, id: 7, role: UserRole.OPERATOR } },
        })}
      />,
    )
    expect(has("[data-e2e=admin-block-open]")).toBe(false)
    // The "You" badge says whose page it is; a sentence on what cannot happen is left out.
    expect(has("[data-e2e=admin-user-no-actions]")).toBe(false)
    expect(find("[data-e2e=admin-user-card]").textContent).not.toContain("your own account")

    await mount(
      <AdminUserScreen {...userProps([], { detail: { ...detail, user: grace } })} />,
    )
    expect(has("[data-e2e=admin-unblock-open]")).toBe(false)
    expect(has("[data-e2e=admin-end-sessions-open]")).toBe(false)
    expect(find("[data-e2e=admin-user-no-actions]").textContent).toContain("yours or higher")
  })

  it("confirms a block in a confirm dialog that names the person and the consequence, without a password", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls, { dialog: "block" })} />)

    const dialog = find("[data-e2e=admin-action-dialog]")
    expect(dialog.getAttribute("role")).toBe("alertdialog")
    const titleId = dialog.getAttribute("aria-labelledby")!
    expect(document.getElementById(titleId)!.textContent).toBe("Block Ada Lovelace")
    const question = document.getElementById(dialog.getAttribute("aria-describedby")!)!
    expect(question.textContent).toContain("every way in is refused")
    expect(has("[data-e2e=admin-action-dialog] input")).toBe(false)
    expect(find("[data-e2e=admin-action-submit]").textContent).toBe("Block")
    await click("[data-e2e=admin-action-submit]")
    expect(calls).toEqual([["action", "block"]])
  })

  it("shows why the API refused the action inside its dialog", async () => {
    const message = "You cannot do this to someone whose role is yours or higher"
    await mount(
      <AdminUserScreen {...userProps([], { dialog: "end-sessions", actionError: message })} />,
    )
    expect(find("[data-e2e=admin-action-dialog]").textContent).toContain(message)
  })
})

const days = (count: (index: number) => number) =>
  Array.from({ length: 30 }, (_, index) => ({
    day: `2026-09-${String(index + 1).padStart(2, "0")}`,
    count: count(index),
  }))

const stats: AdminStats = {
  generatedAt: "2026-09-30T12:00:00.000Z",
  people: 1234,
  blocked: 3,
  newThisWeek: { current: 12, previous: 9 },
  activeToday: { current: 40, previous: 41 },
  activeThisWeek: { current: 300, previous: 300 },
  groups: 77,
  notes: 5678,
  signUpsPerDay: days((index) => index % 3),
  activePerDay: days((index) => index === 7 ? 45 : 40),
}

describe("the admin dashboard", () => {
  it("says a change as its sign and size against the period before", () => {
    expect(changeText({ current: 12, previous: 9 }, "previous 7 days")).toBe(
      "+3 vs previous 7 days",
    )
    expect(changeText({ current: 1040, previous: 2041 }, "yesterday")).toBe(
      "−1,001 vs yesterday",
    )
    expect(changeText({ current: 5, previous: 5 }, "yesterday")).toBe("No change vs yesterday")
  })

  it("colours growth as good, a drop as a warning and no change as neutral", () => {
    expect(changeTone({ current: 2, previous: 1 })).toBe("positive")
    expect(changeTone({ current: 1, previous: 2 })).toBe("warning")
    expect(changeTone({ current: 1, previous: 1 })).toBe("neutral")
  })

  it("ends a count chart's axis on a round top, also for a count that is no number", () => {
    expect([[], [0, 1, 2], [5], [6, 3], [9], [11], [40], [51], [1_200]].map(countAxisTop))
      .toEqual([5, 5, 5, 10, 10, 20, 50, 100, 2_000])
    expect(countAxisTop([Number.NaN])).toBe(5)
  })

  it("labels both charts' axes with whole numbers from 0 to the round top", async () => {
    await mount(<AdminDashboardScreen stats={stats} error={null} onRetry={() => {}} />)

    const axis = (chart: string) =>
      [...document.querySelectorAll(`[data-e2e=${chart}] [aria-hidden=true] > span`)]
        .map((label) => label.textContent ?? ``)
        .filter((label) => /^[\d,.]+$/.test(label))
    expect(axis(`admin-chart-sign-ups`)).toEqual([`0`, `1`, `2`, `3`, `4`, `5`])
    expect(axis(`admin-chart-active`)).toEqual([`0`, `10`, `20`, `30`, `40`, `50`])
  })

  it("shows every stat card, the sign-ups total and the busiest day of active people", async () => {
    await mount(<AdminDashboardScreen stats={stats} error={null} onRetry={() => {}} />)

    const cards = find("[data-e2e=admin-dashboard-stats]").textContent
    for (const text of ["1,234", "3 blocked", "+3 vs previous 7 days", "5,678", "77"]) {
      expect(cards).toContain(text)
    }
    expect(find("[data-e2e=admin-chart-sign-ups]").textContent).toContain("30 in 30 days")
    // Active people are no sum: the same person is active on many days.
    const active = find("[data-e2e=admin-chart-active]").textContent
    expect(active).toContain("Busiest day: 45")
    expect(active).not.toContain("in 30 days")
    expect(has("[data-e2e=admin-chart-active] svg")).toBe(true)
  })

  it("shows a loading state, then the API's message with a Try again that reads again", async () => {
    const calls: string[] = []
    await mount(<AdminDashboardScreen stats={null} error={null} onRetry={() => {}} />)
    expect(has("[data-e2e=admin-dashboard-loading]")).toBe(true)

    await mount(
      <AdminDashboardScreen
        stats={null}
        error="The numbers are down"
        onRetry={() => void calls.push("retry")}
      />,
    )
    expect(has("[data-e2e=admin-dashboard-loading]")).toBe(false)
    expect(find("[data-e2e=admin-dashboard-error]").textContent).toContain("The numbers are down")
    await press("main, body", "Try again")
    expect(calls).toEqual(["retry"])
  })
})

describe("the admin sign-in", () => {
  it("sends the login and password, with no sign-up and no provider", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminSignInScreen
        step="credentials"
        busy={false}
        error={null}
        onSignIn={(credentials) => void calls.push(["sign-in", credentials])}
        onOneTimeCode={(code) => void calls.push(["code", code])}
      />,
    )
    expect(document.querySelectorAll("[data-e2e=auth-form-mode-switch]").length).toBe(0)
    expect(document.body.textContent).not.toContain("Sign up")
    expect(document.body.textContent).not.toContain("Google")
    await type("input[name=login]", "ops@example.com")
    await type("input[name=password]", "correct-horse")
    await submit("input[name=password]")

    expect(calls).toEqual([["sign-in", { login: "ops@example.com", password: "correct-horse" }]])
  })

  it("sends the authenticator code on the code step", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminSignInScreen
        step="one-time-code"
        busy={false}
        error={null}
        onSignIn={() => void calls.push(["sign-in"])}
        onOneTimeCode={(code) => void calls.push(["code", code])}
      />,
    )
    await type("input[name=otp]", "123456")
    await submit("input[name=otp]")

    expect(calls).toEqual([["code", "123456"]])
  })
})
