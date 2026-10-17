/**
 * The operator area's API tokens page and the person's tokens, devices and notifications tabs
 * (#427), driven in a browser DOM (happy-dom): what each shows, which actions they offer, and what
 * the confirm dialog sends.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { createFormatters } from "@spy4x/time/format"
import {
  type AdminApiToken,
  type AdminApiTokenFilter,
  type AdminApiTokenListResponse,
  ApiTokenAccess,
} from "@domain/api-tokens"
import {
  AdminApiTokensScreen,
  type AdminApiTokensScreenProps,
  type AdminTokensConfirm,
  type AdminTokensConfirmState,
} from "./admin-api-tokens-screen.tsx"
import {
  AdminPersonDevicesPanel,
  AdminPersonNotificationsPanel,
  AdminPersonTokensPanel,
} from "./admin-api-tokens-tabs.tsx"

/** A day as the screens write it on this device: the default formatter, with no person's settings. */
const day = (at: string) => createFormatters().date(at)

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

function text(selector: string): string {
  return find(selector).textContent?.replace(/\s+/g, " ").trim() ?? ""
}

async function click(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** Presses the button whose text is `label` inside `scope`. */
async function press(scope: string, label: string): Promise<void> {
  const button = [...find(scope).querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`no button "${label}" in ${scope}`)
  await click(button)
}

const OPERATOR_ID = 7

const live: AdminApiToken = {
  id: "01920000-0000-7000-8000-000000000001",
  name: "CI deploys",
  groupId: "01920000-0000-7000-8000-0000000000aa",
  groupName: "Family",
  access: ApiTokenAccess.WRITE,
  state: "live",
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  lastUsedAt: "2026-10-15T10:00:00.000Z",
  revokedAt: null,
  owner: { id: 42, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
}
const revoked: AdminApiToken = {
  ...live,
  id: "01920000-0000-7000-8000-000000000002",
  name: "Old script",
  access: ApiTokenAccess.READ,
  state: "revoked",
  lastUsedAt: null,
  revokedAt: "2026-10-10T10:00:00.000Z",
  groupName: null,
}
const mine: AdminApiToken = {
  ...live,
  id: "01920000-0000-7000-8000-000000000003",
  name: "My own",
  owner: { id: OPERATOR_ID, firstName: "", lastName: "", email: "ops@example.com" },
}

const page: AdminApiTokenListResponse = {
  tokens: [live, revoked, mine],
  total: 3,
  page: 1,
  pageSize: 25,
  counts: { live: 2, expired: 0, revoked: 1 },
}

const NO_CONFIRM: AdminTokensConfirmState = { target: null, error: null, pending: false }

/** The page with `overrides`, recording every filter, page, ask and confirm it reports. */
function tokensPage(overrides: Partial<AdminApiTokensScreenProps> = {}) {
  const events: unknown[][] = []
  const props: AdminApiTokensScreenProps = {
    filter: { state: null, page: 1 },
    list: page,
    pending: false,
    error: null,
    operatorId: OPERATOR_ID,
    onFilter: (filter: AdminApiTokenFilter) => events.push(["filter", filter]),
    onPage: (to: number) => events.push(["page", to]),
    confirm: NO_CONFIRM,
    onAsk: (target: AdminTokensConfirm) => events.push(["ask", target]),
    onCloseConfirm: () => events.push(["close"]),
    onConfirm: () => events.push(["confirm"]),
    ...overrides,
  }
  return { node: <AdminApiTokensScreen {...props} />, events }
}

describe("the API tokens page", () => {
  it("shows each token's owner, name, group and access, state and dates", async () => {
    await mount(tokensPage().node)
    const list = text(`[data-e2e="admin-api-tokens-list"]`)

    expect(text(`[data-e2e="admin-api-token-owner-42"]`)).toBe("Ada Lovelace")
    expect(find(`[data-e2e="admin-api-token-owner-42"]`).getAttribute("href")).toBe(
      "/users/42?tab=api-tokens",
    )
    for (
      const shown of [
        "ada@example.com",
        "CI deploys",
        "Family",
        "Read and write",
        "Read only",
        "Deleted group",
        day("2026-10-01T10:00:00.000Z"),
        day("2027-01-01T00:00:00.000Z"),
        "Never",
        `Revoked ${day("2026-10-10T10:00:00.000Z")}`,
      ]
    ) expect(list).toContain(shown)
    expect(has(`[data-e2e="admin-api-token-state-live"]`)).toBe(true)
    expect(has(`[data-e2e="admin-api-token-state-revoked"]`)).toBe(true)
    expect(text(`[data-e2e="admin-api-tokens-count"]`)).toBe("3 tokens")
  })

  it("offers revoke on someone else's live token only, never on a revoked one or the operator's", async () => {
    const { node, events } = tokensPage()
    await mount(node)

    expect(has(`[data-e2e="admin-api-token-revoke-${live.id}"]`)).toBe(true)
    expect(has(`[data-e2e="admin-api-token-revoke-${revoked.id}"]`)).toBe(false)
    expect(has(`[data-e2e="admin-api-token-revoke-${mine.id}"]`)).toBe(false)
    await click(find(`[data-e2e="admin-api-token-revoke-${live.id}"]`))
    expect(events).toEqual([["ask", { kind: "revoke", token: live }]])
  })

  it("filters by state on page 1, the chips counting each state", async () => {
    const { node, events } = tokensPage({ filter: { state: null, page: 3 } })
    await mount(node)

    expect(text(`[data-e2e="admin-api-tokens-state"]`)).toContain("Revoked (1)")
    await press(`[data-e2e="admin-api-tokens-state"]`, "Revoked (1)")
    expect(events).toEqual([["filter", { state: "revoked", page: 1 }]])
  })

  it("says loading, then shows an error in place of the list", async () => {
    await mount(tokensPage({ list: null }).node)
    expect(has(`[role="status"][aria-label="Loading tokens"]`)).toBe(true)

    await mount(tokensPage({ list: null, error: "Something went wrong. Try again." }).node)
    expect(has(`[role="status"]`)).toBe(false)
    expect(document.body.textContent).toContain("Something went wrong. Try again.")
  })

  it("explains an empty list by the state picked", async () => {
    const empty = { ...page, tokens: [], total: 0 }
    await mount(tokensPage({ list: empty, filter: { state: "expired", page: 1 } }).node)
    expect(document.body.textContent).toContain("No expired tokens")
  })

  it("confirms a revoke in a dialog naming the token and its owner, then sends it", async () => {
    const confirm = {
      target: { kind: "revoke", token: live },
      error: null,
      pending: false,
    } as const
    const { node, events } = tokensPage({ confirm })
    await mount(node)

    const dialog = text(`[data-e2e="admin-api-tokens-dialog"]`)
    expect(dialog).toContain("Revoke this API token")
    expect(dialog).toContain("CI deploys of Ada Lovelace stops working at once")
    await click(find(`[data-e2e="admin-api-tokens-confirm"]`))
    expect(events).toEqual([["confirm"]])
  })

  it("shows the API's refusal inside the dialog", async () => {
    const confirm = {
      target: { kind: "revoke", token: live },
      error: "You cannot do this to a person at or above your role",
      pending: false,
    } as const
    await mount(tokensPage({ confirm }).node)
    expect(text(`[data-e2e="admin-api-tokens-dialog"]`)).toContain(
      "You cannot do this to a person at or above your role",
    )
  })

  it("moves focus to the token count once a revoke goes through", async () => {
    const sending = { target: { kind: "revoke", token: live }, error: null, pending: true } as const
    await mount(tokensPage({ confirm: sending }).node)
    await mount(tokensPage({ confirm: NO_CONFIRM }).node)
    expect(document.activeElement === find(`[data-e2e="admin-api-tokens-count"]`)).toBe(true)
  })

  it("leaves focus alone when the revoke dialog is cancelled or refused", async () => {
    const asking = { target: { kind: "revoke", token: live }, error: null, pending: false } as const
    await mount(tokensPage({ confirm: asking }).node)
    await mount(tokensPage({ confirm: NO_CONFIRM }).node)
    expect(document.activeElement === find(`[data-e2e="admin-api-tokens-count"]`)).toBe(false)

    const sending = { ...asking, pending: true } as const
    const refused = { ...asking, error: "Something went wrong. Try again." } as const
    await mount(tokensPage({ confirm: sending }).node)
    await mount(tokensPage({ confirm: refused }).node)
    expect(document.activeElement === find(`[data-e2e="admin-api-tokens-count"]`)).toBe(false)
  })

  it("on a phone, shows the owner and state under the token name and a 44 px Revoke", async () => {
    await mount(tokensPage().node)
    const row = find(`[data-e2e="admin-api-token-revoke-${live.id}"]`).closest("tr")!
    const phone = row.querySelector(`[data-e2e="admin-api-token-phone"]`)!
    expect(phone.className).toContain("sm:hidden")
    expect(phone.textContent).toContain("Owner: Ada Lovelace")
    expect(phone.textContent).toContain("ada@example.com")
    expect(phone.textContent).toContain("Live")
    expect(find(`[data-e2e="admin-api-token-revoke-${live.id}"]`).className).toContain(
      "max-sm:min-h-11",
    )
    const table = find(`[data-e2e="admin-api-tokens-list"]`).querySelector(`[class*="hidden"]`)!
    expect(table.className).toContain(
      "max-sm:[&_:is(th,td):is(:nth-child(1),:nth-child(3),:nth-child(4),:nth-child(5))]:hidden",
    )
  })

  it("draws the empty list without a dashed box", async () => {
    const empty = { ...page, tokens: [], total: 0 }
    await mount(tokensPage({ list: empty }).node)
    expect(has(`.border-dashed`)).toBe(false)
  })
})

const actions = (events: unknown[][]) => ({
  operatorId: OPERATOR_ID,
  confirm: NO_CONFIRM,
  onAsk: (target: AdminTokensConfirm) => events.push(["ask", target]),
  onCloseConfirm: () => events.push(["close"]),
  onConfirm: () => events.push(["confirm"]),
})

describe("the person's tabs", () => {
  it("lists the person's tokens without an owner column, revoke on the live one", async () => {
    const events: unknown[][] = []
    await mount(
      <AdminPersonTokensPanel
        data={[live, revoked]}
        error={null}
        userId={42}
        {...actions(events)}
      />,
    )
    const panel = text(`[data-e2e="admin-person-api-tokens"]`)
    expect(panel).toContain("CI deploys")
    expect(panel).toContain("Old script")
    expect(panel).not.toContain("Owner")
    expect(has(`[data-e2e="admin-api-token-revoke-${revoked.id}"]`)).toBe(false)
    await click(find(`[data-e2e="admin-api-token-revoke-${live.id}"]`))
    expect(events).toEqual([["ask", { kind: "revoke", token: live }]])
  })

  it("says so when the person has no tokens, and loads before that", async () => {
    await mount(
      <AdminPersonTokensPanel data={null} error={null} userId={42} {...actions([])} />,
    )
    expect(has(`[aria-label="Loading API tokens"]`)).toBe(true)
    await mount(<AdminPersonTokensPanel data={[]} error={null} userId={42} {...actions([])} />)
    expect(text(`[data-e2e="admin-person-api-tokens"]`)).toBe("No API tokens.")
  })

  it("moves focus to the person's token count once a revoke goes through", async () => {
    const sending = { target: { kind: "revoke", token: live }, error: null, pending: true } as const
    const panel = (confirm: AdminTokensConfirmState) => (
      <AdminPersonTokensPanel
        data={[live, revoked]}
        error={null}
        userId={42}
        {...actions([])}
        confirm={confirm}
      />
    )
    await mount(panel(sending))
    await mount(panel(NO_CONFIRM))
    const count = find(`[data-e2e="admin-person-api-tokens-count"]`)
    expect(count.textContent).toBe("2 tokens")
    expect(document.activeElement === count).toBe(true)
  })

  it("moves focus to the person's device count once a removal goes through", async () => {
    const at = "2026-10-01T10:00:00.000Z"
    const sending = {
      target: { kind: "remove-device", userId: 42, deviceId: 5, label: "phone123" },
      error: null,
      pending: true,
    } as const
    const panel = (confirm: AdminTokensConfirmState) => (
      <AdminPersonDevicesPanel
        data={[{ id: 6, label: "laptop9", createdAt: at, updatedAt: at }]}
        error={null}
        userId={42}
        {...actions([])}
        confirm={confirm}
      />
    )
    await mount(panel(sending))
    await mount(panel(NO_CONFIRM))
    const count = find(`[data-e2e="admin-person-devices-count"]`)
    expect(count.textContent).toBe("1 device")
    expect(document.activeElement === count).toBe(true)
  })

  it("lists the person's devices by label and asks to remove one", async () => {
    const events: unknown[][] = []
    const device = {
      id: 5,
      label: "phone123",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    }
    await mount(
      <AdminPersonDevicesPanel data={[device]} error={null} userId={42} {...actions(events)} />,
    )
    expect(text(`[data-e2e="admin-person-device-5"]`)).toContain("Device phone123")
    await click(find(`[data-e2e="admin-person-device-remove-5"]`))
    expect(events).toEqual([[
      "ask",
      { kind: "remove-device", userId: 42, deviceId: 5, label: "phone123" },
    ]])
  })

  it("offers no remove on the operator's own devices", async () => {
    const at = "2026-10-01T10:00:00.000Z"
    await mount(
      <AdminPersonDevicesPanel
        data={[{ id: 5, label: "phone123", createdAt: at, updatedAt: at }]}
        error={null}
        userId={OPERATOR_ID}
        {...actions([])}
      />,
    )
    expect(has(`[data-e2e="admin-person-device-5"]`)).toBe(true)
    expect(has(`[data-e2e="admin-person-device-remove-5"]`)).toBe(false)
  })

  it("confirms a device removal in a dialog naming the device", async () => {
    const events: unknown[][] = []
    const confirm = {
      target: { kind: "remove-device", userId: 42, deviceId: 5, label: "phone123" },
      error: null,
      pending: false,
    } as const
    await mount(
      <AdminPersonDevicesPanel
        data={[]}
        error={null}
        userId={42}
        {...actions(events)}
        confirm={confirm}
      />,
    )
    expect(text(`[data-e2e="admin-person-devices"]`)).toBe("No device gets push notifications.")
    expect(text(`[data-e2e="admin-api-tokens-dialog"]`)).toContain("Device phone123")
    await click(find(`[data-e2e="admin-api-tokens-confirm"]`))
    expect(events).toEqual([["confirm"]])
  })

  it("lists notifications by kind with their read state and the counts", async () => {
    await mount(
      <AdminPersonNotificationsPanel
        data={{
          notifications: [
            { id: "2", kind: "group.removed", createdAt: "2026-10-15T10:00:00.000Z", readAt: null },
            {
              id: "1",
              kind: "some.future_kind",
              createdAt: "2026-10-14T10:00:00.000Z",
              readAt: "2026-10-14T11:00:00.000Z",
            },
          ],
          total: 60,
          unread: 1,
        }}
        error={null}
      />,
    )
    expect(text(`[data-e2e="admin-person-notifications-count"]`)).toBe(
      "60 notifications, 1 unread. The newest 2 are below.",
    )
    expect(text(`[data-e2e="admin-person-notification-2"]`)).toContain("Removed from a group")
    expect(text(`[data-e2e="admin-person-notification-2"]`)).toContain("Unread")
    expect(text(`[data-e2e="admin-person-notification-1"]`)).toContain("some.future_kind")
    expect(text(`[data-e2e="admin-person-notification-1"]`)).toContain("Read")
  })

  it("shows a tab's read error in place of its list", async () => {
    await mount(<AdminPersonNotificationsPanel data={null} error="User not found" />)
    expect(document.body.textContent).toContain("User not found")
    expect(has(`[role="status"]`)).toBe(false)
  })
})
