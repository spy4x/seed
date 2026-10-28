/**
 * The Telegram link of #269 in a browser DOM (happy-dom): the profile's row and its code dialog,
 * and the admin user screen's Telegram row, unlink action and audit titles.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  type AdminUserDetail,
  AuthAuditEventType,
  DEFAULT_PREFERENCES,
  TELEGRAM_METHOD,
  type TelegramLinkCodeResponse,
  type TelegramStatusResponse,
  UserRole,
} from "@domain/identity"
import { AdminUserScreen, type AdminUserScreenProps } from "./admin-user-screen.tsx"
import { TelegramLink, type TelegramLinkProps } from "./profile-telegram.tsx"

const window = new Window({ url: "http://app.localhost/" })
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

async function mount(node: VNode): Promise<void> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

const has = (selector: string) => document.querySelector(selector) !== null

/** What has focus, by its `data-e2e` hook: an element would not print in a failed assertion. */
const focused = () =>
  document.activeElement?.getAttribute("data-e2e") ?? document.activeElement?.tagName

async function click(selector: string): Promise<void> {
  await act(() => {
    find(selector).dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

const ON: TelegramStatusResponse = { enabled: true, botUsername: "seed_bot", linkedAt: null }
const LINKED: TelegramStatusResponse = { ...ON, linkedAt: "2026-12-04T10:00:00Z" }
const CODE: TelegramLinkCodeResponse = {
  code: `7_${"c".repeat(32)}`,
  expiresAt: "2026-12-04T10:10:00.000Z",
  url: `https://t.me/seed_bot?start=7_${"c".repeat(32)}`,
}

function linkProps(calls: string[], props: Partial<TelegramLinkProps> = {}) {
  return {
    status: ON,
    code: null,
    error: null,
    pending: false,
    onLink: () => void calls.push("link"),
    onCloseCode: () => void calls.push("close"),
    onUnlink: () => void calls.push("unlink"),
    ...props,
  } satisfies TelegramLinkProps
}

describe("the profile's Telegram row", () => {
  it("draws nothing while the bot is off and nothing is linked", async () => {
    await mount(<TelegramLink {...linkProps([], { status: { ...ON, enabled: false } })} />)
    expect(has("[data-e2e=telegram]")).toBe(false)
  })

  it("asks for a code with Link Telegram, and shows it with a one-tap link to the bot", async () => {
    const calls: string[] = []
    await mount(<TelegramLink {...linkProps(calls)} />)
    expect(find("[data-e2e=telegram-status]").textContent).toContain("Not linked")
    await click("[data-e2e=telegram-link]")
    expect(calls).toEqual(["link"])

    await mount(<TelegramLink {...linkProps(calls, { code: CODE })} />)
    expect(find("[data-e2e=telegram-open]").getAttribute("href")).toBe(CODE.url)
    expect(find("[data-e2e=telegram-code]").textContent).toContain(`/link ${CODE.code}`)
  })

  it("returns focus to Link Telegram when the code dialog closes", async () => {
    await mount(<TelegramLink {...linkProps([])} />)
    find("[data-e2e=telegram-link]").focus()
    await click("[data-e2e=telegram-link]")

    await mount(<TelegramLink {...linkProps([], { code: CODE })} />)
    await mount(<TelegramLink {...linkProps([])} />)

    expect(focused()).toBe("telegram-link")
  })

  it("moves focus to Unlink once the bot has linked the account", async () => {
    await mount(<TelegramLink {...linkProps([])} />)
    find("[data-e2e=telegram-link]").focus()
    await mount(<TelegramLink {...linkProps([], { code: CODE })} />)

    await mount(<TelegramLink {...linkProps([], { status: LINKED })} />)

    expect(focused()).toBe("telegram-unlink")
  })

  it("leaves focus alone when the first status arrives already linked", async () => {
    await mount(<TelegramLink {...linkProps([], { status: null })} />)
    await mount(<TelegramLink {...linkProps([], { status: LINKED })} />)

    expect(focused()).toBe("BODY")
  })

  it("asks before unlinking, sends the unlink only once confirmed, and refocuses Link Telegram", async () => {
    const calls: string[] = []
    await mount(<TelegramLink {...linkProps(calls, { status: LINKED })} />)
    expect(has("[data-e2e=telegram-link]")).toBe(false)

    await click("[data-e2e=telegram-unlink]")
    expect(calls).toEqual([])
    expect(find("[data-e2e=telegram-unlink-dialog]").textContent).toContain("Unlink Telegram?")
    await click("[data-e2e=telegram-unlink-confirm]")
    expect(calls).toEqual(["unlink"])

    await mount(<TelegramLink {...linkProps(calls)} />)
    expect(has("[data-e2e=telegram-unlink-dialog]")).toBe(false)
    expect(focused()).toBe("telegram-link")
  })

  it("keeps the person's link when they cancel the unlink", async () => {
    const calls: string[] = []
    await mount(<TelegramLink {...linkProps(calls, { status: LINKED })} />)
    await click("[data-e2e=telegram-unlink]")

    await click("[data-e2e=telegram-unlink-dialog] button:not([data-e2e=telegram-unlink-confirm])")

    expect(calls).toEqual([])
    expect(has("[data-e2e=telegram-unlink-dialog]")).toBe(false)
  })

  it("still lets a linked person unlink after the bot was turned off", async () => {
    await mount(
      <TelegramLink
        {...linkProps([], {
          status: { enabled: false, botUsername: null, linkedAt: "2026-12-04T10:00:00Z" },
        })}
      />,
    )
    expect(has("[data-e2e=telegram-unlink]")).toBe(true)
  })
})

const user = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  role: UserRole.VIEWER,
  blockedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  lastSeenAt: null,
}
const password = {
  method: "password",
  email: "ada@example.com",
  provenAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
}
const telegram = {
  method: TELEGRAM_METHOD,
  email: null,
  provenAt: null,
  createdAt: "2026-12-04T10:00:00.000Z",
}

function detail(linked: boolean): AdminUserDetail {
  return {
    user,
    methods: linked ? [password, telegram] : [password],
    sessions: [],
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
}

function userProps(calls: unknown[][], props: Partial<AdminUserScreenProps> = {}) {
  return {
    detail: detail(true),
    error: null,
    operator: { id: 7, role: UserRole.OPERATOR },
    tab: "overview",
    onTab: () => {},
    dialog: null,
    onOpenDialog: (action) => void calls.push(["open", action]),
    onCloseDialog: () => void calls.push(["close"]),
    actionError: null,
    pending: false,
    onAction: (action, input) => void calls.push(["action", action, input]),
    ...props,
  } satisfies AdminUserScreenProps
}

describe("a person's Telegram link in the admin app", () => {
  it("shows the link on the Overview and unlinks it after the dialog", async () => {
    const calls: unknown[][] = []
    await mount(<AdminUserScreen {...userProps(calls)} />)
    expect(find("[data-e2e=admin-user-telegram]").textContent).toContain("Linked")
    await click("[data-e2e=admin-unlink-telegram-open]")
    expect(calls).toEqual([["open", "unlink-telegram"]])

    await mount(<AdminUserScreen {...userProps(calls, { dialog: "unlink-telegram" })} />)
    await click("[data-e2e=admin-action-submit]")
    expect(calls.at(-1)).toEqual(["action", "unlink-telegram", undefined])
  })

  it("offers no unlink to a person with nothing linked, and says so", async () => {
    await mount(<AdminUserScreen {...userProps([], { detail: detail(false) })} />)
    expect(find("[data-e2e=admin-user-telegram]").textContent).toContain("Not linked")
    expect(has("[data-e2e=admin-unlink-telegram-open]")).toBe(false)
  })

  it("leaves Telegram out of the sign-in methods, since it is no way in", async () => {
    await mount(<AdminUserScreen {...userProps([], { tab: "methods" })} />)
    expect(find("[data-e2e=admin-user-methods]").children).toHaveLength(1)
  })

  it("titles a link and an unlink on the Activity tab", async () => {
    await mount(
      <AdminUserScreen
        {...userProps([], {
          tab: "activity",
          detail: {
            ...detail(true),
            audits: [AuthAuditEventType.TELEGRAM_LINKED, AuthAuditEventType.TELEGRAM_UNLINKED].map((
              eventType,
              index,
            ) => ({
              id: index + 1,
              eventType,
              identifier: "telegram:7001",
              ip: null,
              createdAt: "2026-12-04T10:00:00.000Z",
            })),
          },
        })}
      />,
    )
    const text = find("[data-e2e=admin-user-audits]").textContent ?? ""
    expect(text).toContain("Telegram account linked")
    expect(text).toContain("Telegram account unlinked")
  })
})
