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
  type AdminUserDetail,
  type AdminUserRow,
  AuthAuditEventType,
  UserRole,
} from "@domain/identity"
import { ADMIN_PATHS, AdminSignInScreen } from "./admin-frame.tsx"
import { AdminUsersScreen, type AdminUsersScreenProps } from "./admin-users-screen.tsx"
import { AdminUserScreen, type AdminUserScreenProps } from "./admin-user-screen.tsx"

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

async function choose(selector: string, value: string): Promise<void> {
  const select = find<HTMLSelectElement>(selector)
  select.value = value
  await act(() => {
    select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
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
  it("sends the typed words, the role and the blocked filter, back on page 1", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminUsersScreen {...listProps(calls, { filter: { ...ADMIN_NO_FILTER, page: 2 } })} />,
    )
    await type("[data-e2e=admin-users-search]", "  ada love ")
    await choose("[data-e2e=admin-users-role]", String(UserRole.OPERATOR))
    await choose("[data-e2e=admin-users-blocked]", "blocked")
    await submit("[data-e2e=admin-users-submit]")

    expect(calls).toEqual([["search", {
      query: "ada love",
      role: UserRole.OPERATOR,
      blocked: "blocked",
      page: 1,
    }]])
  })

  it("sends no role when any role is chosen", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUsersScreen {...listProps(calls)} />)
    await submit("[data-e2e=admin-users-submit]")

    expect(calls).toEqual([["search", { query: "", role: null, blocked: "any", page: 1 }]])
  })

  it("links each person to their page and marks who is blocked", async () => {
    await mount(<AdminUsersScreen {...listProps([])} />)

    expect(find("[data-e2e=admin-user-42]").getAttribute("href")).toBe(ADMIN_PATHS.user(42))
    expect(find("[data-e2e=admin-user-42]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=admin-user-43]").closest("li")!.textContent).toContain("Blocked")
    expect(find("[data-e2e=admin-user-42]").closest("li")!.textContent).not.toContain("Blocked")
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

  it("says so when nobody matches", async () => {
    await mount(
      <AdminUsersScreen
        {...listProps([], { list: { users: [], total: 0, page: 1, pageSize: 25 } })}
      />,
    )
    expect(document.body.textContent).toContain("Nobody matches")
    expect(has("[data-e2e=admin-users-list]")).toBe(false)
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
}

const operator = { id: 7, role: UserRole.OPERATOR }

function userProps(calls: unknown[][], props: Partial<AdminUserScreenProps> = {}) {
  return {
    detail,
    error: null,
    operator,
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
  it("shows the account, sign-in methods, sessions, groups and audit trail", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)

    expect(find("[data-e2e=admin-user-title]").textContent).toBe("Ada Lovelace")
    expect(find("[data-e2e=admin-user-methods]").textContent).toContain("Password")
    expect(find("[data-e2e=admin-user-sessions]").textContent).toContain("Firefox on Linux")
    expect(find("[data-e2e=admin-user-groups]").textContent).toContain("Owner")
    expect(find("[data-e2e=admin-user-audits]").textContent).toContain("Unblocked by an operator")
    expect(find("[data-e2e=admin-user-audits]").textContent).toContain("operator:7")
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

  it("offers no action on the operator's own account or on an equal role", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], {
          detail: { ...detail, user: { ...ada, id: 7, role: UserRole.OPERATOR } },
        })}
      />,
    )
    expect(has("[data-e2e=admin-block-open]")).toBe(false)
    expect(find("[data-e2e=admin-user-no-actions]").textContent).toContain("your own account")

    await mount(
      <AdminUserScreen {...userProps([], { detail: { ...detail, user: grace } })} />,
    )
    expect(has("[data-e2e=admin-unblock-open]")).toBe(false)
    expect(has("[data-e2e=admin-end-sessions-open]")).toBe(false)
    expect(find("[data-e2e=admin-user-no-actions]").textContent).toContain("yours or higher")
  })

  it("confirms the open action without asking for a password", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls, { dialog: "block" })} />)

    expect(has("[data-e2e=admin-action-dialog] input")).toBe(false)
    await submit("[data-e2e=admin-action-submit]")
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
