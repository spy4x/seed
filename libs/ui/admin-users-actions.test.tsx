/**
 * The people actions of #425 on the admin screens, driven in a browser DOM (happy-dom): the "You"
 * row, a person without a name shown once, the CSV export link, the role picker, the reset link
 * and ending one session from the Sessions tab.
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
  DEFAULT_PREFERENCES,
  UserRole,
} from "@domain/identity"
import { AdminUsersScreen, type AdminUsersScreenProps } from "./admin-users-screen.tsx"
import { AdminUserScreen, type AdminUserScreenProps } from "./admin-user-screen.tsx"

import { I18nContext } from "@spy4x/preact-ui/i18n"
import { ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"
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

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** How often `text` occurs in the text of `selector`. */
function occurrences(selector: string, text: string): number {
  return (find(selector).textContent ?? "").split(text).length - 1
}

const ada: AdminUserRow = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: UserRole.VIEWER,
  blockedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: null,
}
const nameless: AdminUserRow = { ...ada, id: 44, firstName: "", lastName: "", email: "x@a.test" }
const me: AdminUserRow = { ...ada, id: 7, firstName: "Olga", lastName: "Ops", email: "o@a.test" }

function listProps(props: Partial<AdminUsersScreenProps> = {}) {
  return {
    filter: ADMIN_NO_FILTER,
    list: { users: [ada, nameless, me], total: 3, page: 1, pageSize: 25 },
    pending: false,
    error: null,
    onSearch: () => {},
    onPage: () => {},
    ...props,
  } satisfies AdminUsersScreenProps
}

describe("the admin user list, with the people actions", () => {
  it("shows a person who set no name by their address once, and a named one with both", async () => {
    await mount(<AdminUsersScreen {...listProps()} />)

    expect(find("[data-e2e=admin-user-44]").textContent).toBe("x@a.test")
    expect(occurrences("[data-e2e=admin-users-list]", "x@a.test")).toBe(1)
    expect(occurrences("[data-e2e=admin-users-list]", "ada@example.com")).toBe(1)
    expect(find("[data-e2e=admin-user-42]").textContent).toBe("Ada Lovelace")
  })

  it("marks the operator's own row as You, and no other row", async () => {
    await mount(<AdminUsersScreen {...listProps({ operatorId: 7 })} />)

    const marks = [...document.querySelectorAll("[data-e2e=admin-user-you]")]
    expect(marks.map((mark) => mark.closest("tr")?.textContent?.includes("Olga Ops"))).toEqual([
      true,
    ])

    await mount(<AdminUsersScreen {...listProps({ operatorId: undefined })} />)
    expect(has("[data-e2e=admin-user-you]")).toBe(false)
  })

  it("offers the filtered list as a CSV download, and no button without a link", async () => {
    const href = "/api/admin/users/export.csv?q=ada"
    await mount(<AdminUsersScreen {...listProps({ exportHref: href })} />)

    const link = find<HTMLAnchorElement>("[data-e2e=admin-users-export]")
    expect(link.tagName).toBe("A")
    expect(link.getAttribute("href")).toBe(href)
    expect(link.hasAttribute("download")).toBe(true)

    await mount(<AdminUsersScreen {...listProps({ exportHref: undefined })} />)
    expect(has("[data-e2e=admin-users-export]")).toBe(false)
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
  sessions: [
    {
      id: 9,
      deviceName: "Firefox on Linux",
      ipHint: "203.0.113.x",
      createdAt: "2026-10-01T10:00:00.000Z",
      lastUsedAt: "2026-10-14T10:00:00.000Z",
    },
    {
      id: 10,
      deviceName: "Safari on iPhone",
      ipHint: null,
      createdAt: "2026-10-02T10:00:00.000Z",
      lastUsedAt: "2026-10-15T10:00:00.000Z",
    },
  ],
  groups: [],
  audits: [],
  trialUsedAt: null,
  preferences: {
    value: DEFAULT_PREFERENCES,
    version: 0,
    updatedAt: null,
    firstTimeZone: null,
    firstLocale: null,
  },
}

const operator = { id: 7, role: UserRole.OPERATOR }
const administrator = { id: 7, role: UserRole.ADMIN }

function userProps(calls: unknown[][], props: Partial<AdminUserScreenProps> = {}) {
  return {
    detail,
    error: null,
    operator,
    tab: "overview",
    onTab: () => {},
    dialog: null,
    onOpenDialog: (action, sessionId) =>
      void calls.push(sessionId === undefined ? ["open", action] : ["open", action, sessionId]),
    onCloseDialog: () => void calls.push(["close"]),
    actionError: null,
    pending: false,
    onAction: (action, input) => void calls.push(["action", action, input]),
    ...props,
  } satisfies AdminUserScreenProps
}

describe("one person in the admin app, with the people actions", () => {
  it("shows the address under the name only when the person has a name", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)
    expect(occurrences("[data-e2e=page-header]", "ada@example.com")).toBe(1)

    await mount(
      <AdminUserScreen
        {...userProps([], {
          detail: { ...detail, user: { ...nameless, email: "ada@example.com" } },
        })}
      />,
    )
    expect(find("[data-e2e=admin-user-title]").textContent).toBe("ada@example.com")
    expect(occurrences("[data-e2e=page-header]", "ada@example.com")).toBe(1)
  })

  it("offers Change role to an administrator only, and opens its dialog", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)
    expect(has("[data-e2e=admin-change-role-open]")).toBe(false)

    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls, { operator: administrator })} />)
    await click("[data-e2e=admin-change-role-open]")
    expect(calls).toEqual([["open", "change-role"]])
  })

  it("picks only a role below the administrator's own, and sends the one picked", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminUserScreen
        {...userProps(calls, { operator: administrator, dialog: "change-role" })}
      />,
    )
    const radios = [...document.querySelectorAll<HTMLInputElement>("[name=role]")]
    expect(radios.map((radio) => [radio.value, radio.checked])).toEqual([
      [String(UserRole.VIEWER), true],
      [String(UserRole.OPERATOR), false],
      [String(UserRole.SUPERVISOR), false],
    ])
    // The role the person has already changes nothing, so the button waits for another.
    expect(find<HTMLButtonElement>("[data-e2e=admin-action-submit]").disabled).toBe(true)

    await act(() => {
      radios[2].click()
    })
    expect(find<HTMLButtonElement>("[data-e2e=admin-action-submit]").disabled).toBe(false)
    await submit("[data-e2e=admin-action-submit]")
    expect(calls).toEqual([["action", "change-role", { role: UserRole.SUPERVISOR }]])
  })

  it("offers a reset link to a person with a password address, naming where it goes", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls)} />)
    await click("[data-e2e=admin-password-reset-open]")
    expect(calls).toEqual([["open", "password-reset"]])

    await mount(<AdminUserScreen {...userProps(calls, { dialog: "password-reset" })} />)
    expect(find("[data-e2e=admin-action-dialog]").textContent).toContain("ada@example.com")
    await click("[data-e2e=admin-action-submit]")
    expect(calls.at(-1)).toEqual(["action", "password-reset", undefined])
  })

  it("offers to remove a profile picture only when there is one, and sends the removal", async () => {
    await mount(<AdminUserScreen {...userProps([])} />)
    expect(has("[data-e2e=admin-remove-picture-open]")).toBe(false)
    expect(find("[data-e2e=admin-user-picture]").textContent).toContain("None")

    const calls: unknown[][] = []
    const pictured = {
      ...detail,
      user: { ...ada, pictureId: "0190a000-0000-7000-8000-0000000000a1" },
    }
    await mount(<AdminUserScreen {...userProps(calls, { detail: pictured })} />)
    // happy-dom loads no image, so the Avatar falls back to initials: the row stops saying None.
    expect(find("[data-e2e=admin-user-picture]").textContent).not.toContain("None")
    await click("[data-e2e=admin-remove-picture-open]")
    expect(calls).toEqual([["open", "remove-picture"]])

    await mount(
      <AdminUserScreen {...userProps(calls, { detail: pictured, dialog: "remove-picture" })} />,
    )
    const dialog = find("[data-e2e=admin-action-dialog]").textContent
    expect(dialog).toContain("Remove their profile picture?")
    expect(dialog).toContain("Their initials show instead, everywhere. They can upload a new one.")
    await click("[data-e2e=admin-action-submit]")
    expect(calls.at(-1)).toEqual(["action", "remove-picture", undefined])
  })

  it("disables the reset link, saying why, for a person with no password address", async () => {
    const noPassword = {
      ...detail,
      methods: [{ ...detail.methods[0], method: "oauth:github" }],
    }
    await mount(<AdminUserScreen {...userProps([], { detail: noPassword })} />)

    const item = find<HTMLButtonElement>("[data-e2e=admin-password-reset-open]")
    expect(item.disabled || item.getAttribute("aria-disabled") === "true").toBe(true)
    expect(item.textContent).toContain("No password with an address")
  })

  it("ends one session from its row, or all of them, from the Sessions tab", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls, { tab: "sessions" })} />)

    const ends = [...document.querySelectorAll("[data-e2e=admin-session-end-open]")]
    expect(ends.map((end) => end.getAttribute("aria-label"))).toEqual([
      "End the session on Firefox on Linux",
      "End the session on Safari on iPhone",
    ])
    await click("[data-e2e=admin-session-10] [data-e2e=admin-session-end-open]")
    await click("[data-e2e=admin-sessions-end-all-open]")
    expect(calls).toEqual([["open", "end-session", 10], ["open", "end-sessions"]])
  })

  it("offers no session's end on the operator's own account", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], { tab: "sessions", detail: { ...detail, user: { ...ada, id: 7 } } })}
      />,
    )
    expect(has("[data-e2e=admin-user-sessions]")).toBe(true)
    expect(has("[data-e2e=admin-session-end-open]")).toBe(false)
    expect(has("[data-e2e=admin-sessions-end-all-open]")).toBe(false)
  })

  it("names the device in the dialog that ends one session, and sends its id", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminUserScreen {...userProps(calls, { dialog: "end-session", dialogSessionId: 9 })} />,
    )
    expect(find("[data-e2e=admin-action-session]").textContent).toBe(
      "Firefox on Linux · 203.0.113.x",
    )
    await click("[data-e2e=admin-action-submit]")
    expect(calls).toEqual([["action", "end-session", { sessionId: 9 }]])
  })

  it("titles the new audit events on the Activity tab and names who acted", async () => {
    const audits = [
      [AuthAuditEventType.USER_ROLE_CHANGED, "operator:7 from viewer to operator"],
      [AuthAuditEventType.PASSWORD_RESET_SENT, "operator:7"],
      [AuthAuditEventType.USERS_EXPORTED, "operator:7 q=ada"],
      [AuthAuditEventType.PICTURE_REMOVED_BY_OPERATOR, "operator:7"],
    ] as const
    await mount(
      <AdminUserScreen
        {...userProps([], {
          tab: "activity",
          detail: {
            ...detail,
            audits: audits.map(([eventType, identifier], index) => ({
              id: index + 1,
              eventType,
              identifier,
              ip: null,
              createdAt: "2026-10-13T10:00:00.000Z",
            })),
          },
        })}
      />,
    )
    const text = find("[data-e2e=admin-user-audits]").textContent
    for (
      const title of [
        "Role changed",
        "operator:7 from viewer to operator",
        "Password-reset link sent by an operator",
        "Exported the user list",
        "Profile picture removed by an operator",
        "operator:7 q=ada",
      ]
    ) {
      expect([title, text?.includes(title)]).toEqual([title, true])
    }
  })
})

describe("the person's actions in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminUserScreen {...userProps([], { dialog: "password-reset" })} />
        <AdminUserScreen {...userProps([], { operator: administrator, dialog: "change-role" })} />
        <AdminUserScreen {...userProps([], { dialog: "end-session", dialogSessionId: 9 })} />
        <AdminUserScreen {...userProps([], { dialog: "block" })} />
        <AdminUserScreen {...userProps([], { dialog: "end-sessions" })} />
      </I18nContext.Provider>,
    )
    expect(
      englishLeft(document.body, [`Ada Lovelace`, `AL`, `ada@example.com`, `Firefox on Linux`]),
    ).toEqual([])
  })
})
