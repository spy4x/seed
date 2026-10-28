/**
 * The newsletter page of the operator area (#428), driven in a browser DOM (happy-dom): what the
 * search and the chips send, what each row offers, what the dialog confirms, where focus goes, and
 * the empty, loading and error states.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { createFormatters } from "@spy4x/time/format"
import {
  ADMIN_SUBSCRIBERS_NO_FILTER,
  type AdminNewsletterSend,
  type AdminNewsletterStats,
  type AdminSubscriberRow,
} from "@domain/subscribers"
import {
  AdminNewsletterScreen,
  type AdminNewsletterScreenProps,
} from "./admin-newsletter-screen.tsx"

/** A day as the screens write it on this device: the default formatter, with no person's settings. */
const day = (at: string) => createFormatters().date(at)

import { I18nContext } from "@spy4x/preact-ui/i18n"
import { ADMIN_PSEUDO, englishLeft } from "./admin-pseudo.ts"
const window = new Window({ url: "http://admin.localhost/newsletter" })
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

function findAll(selector: string): HTMLElement[] {
  return [...document.querySelectorAll(selector)] as unknown as HTMLElement[]
}

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
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

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest("form")!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent("submit", { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Presses the button whose text is `text` inside `scope`. */
async function press(scope: string, text: string): Promise<void> {
  const button = [...find(scope).querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`no button "${text}" in ${scope}`)
  await clickOn(button)
}

const ann: AdminSubscriberRow = {
  email: "ann@example.com",
  status: "confirmed",
  requestedAt: null,
  confirmedAt: "2026-10-01T10:00:00.000Z",
}
const cat: AdminSubscriberRow = {
  email: "cat@example.com",
  status: "pending",
  requestedAt: "2026-10-15T10:00:00.000Z",
  confirmedAt: null,
}
const stats: AdminNewsletterStats = {
  generatedAt: "2026-10-16T09:00:00.000Z",
  confirmed: 1,
  pending: 1,
  joined: { current: 1, previous: 0 },
  subscribersPerDay: [{ day: "2026-10-15", count: 0 }, { day: "2026-10-16", count: 1 }],
  issues: 1,
}
const issue: AdminNewsletterSend = {
  issue: "2026-10-first",
  subject: "First issue",
  startedAt: "2026-10-10T12:00:00.000Z",
  completedAt: null,
  recipients: 2,
  sent: 1,
  failed: 1,
}

/** The page with two addresses and one issue; every callback records itself in `calls`. */
function props(
  calls: unknown[][],
  overrides: Partial<AdminNewsletterScreenProps> = {},
): AdminNewsletterScreenProps {
  return {
    tab: "subscribers",
    onTab: (tab) => calls.push(["tab", tab]),
    stats,
    statsError: null,
    filter: ADMIN_SUBSCRIBERS_NO_FILTER,
    list: { subscribers: [cat, ann], total: 2, page: 1, pageSize: 25 },
    pending: false,
    error: null,
    onSearch: (filter) => calls.push(["search", filter]),
    onPage: (page) => calls.push(["page", page]),
    sends: [issue],
    sendsError: null,
    onRetry: () => calls.push(["retry"]),
    dialog: null,
    dialogError: null,
    dialogPending: false,
    onOpenDialog: (dialog) => calls.push(["open", dialog]),
    onCloseDialog: () => calls.push(["close"]),
    onConfirm: () => calls.push(["confirm"]),
    done: 0,
    exporting: false,
    onExport: () => calls.push(["export"]),
    ...overrides,
  }
}

describe("operator area: newsletter page", () => {
  it("shows the counts, the growth over 30 days and the chart", async () => {
    await mount(<AdminNewsletterScreen {...props([])} />)

    const numbers = find("[data-e2e=admin-newsletter-stats]").textContent
    expect(numbers).toContain("Subscribers")
    expect(numbers).toContain("+1 vs previous 30 days")
    expect(find("[data-e2e=admin-newsletter-chart]").textContent).toContain("+1 in 2 days")
  })

  it("searches the typed address from page 1, keeping the status", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminNewsletterScreen
        {...props(calls, { filter: { query: "", status: "pending", page: 3 } })}
      />,
    )

    await type("[data-e2e=admin-newsletter-search]", "  cat@ ")
    await submit("[data-e2e=admin-newsletter-submit]")
    expect(calls).toEqual([["search", { query: "cat@", status: "pending", page: 1 }]])
  })

  it("filters by status with a chip, and clears every filter", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls)} />)

    await press("[data-e2e=admin-newsletter-status]", "Confirmed")
    expect(calls).toEqual([["search", { query: "", status: "confirmed", page: 1 }]])
    expect(has("[data-e2e=admin-newsletter-clear]")).toBe(false)

    calls.length = 0
    await mount(
      <AdminNewsletterScreen
        {...props(calls, { filter: { query: "x", status: "pending", page: 2 } })}
      />,
    )
    await clickOn(find("[data-e2e=admin-newsletter-clear]"))
    expect(calls).toEqual([["search", ADMIN_SUBSCRIBERS_NO_FILTER]])
  })

  it("offers Resend only to a pending address and Remove to every one", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls)} />)

    expect(findAll("[data-e2e=admin-subscriber-resend]").map((b) => b.getAttribute("aria-label")))
      .toEqual(["Resend the confirm mail to cat@example.com"])
    const removes = findAll("[data-e2e=admin-subscriber-remove]")
    expect(removes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove cat@example.com",
      "Remove ann@example.com",
    ])

    await clickOn(removes[1])
    await clickOn(find("[data-e2e=admin-subscriber-resend]"))
    expect(calls).toEqual([
      ["open", { action: "remove", email: "ann@example.com" }],
      ["open", { action: "resend", email: "cat@example.com" }],
    ])
  })

  it("confirms a removal in a dialog that names the address and asks no password", async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminNewsletterScreen
        {...props(calls, { dialog: { action: "remove", email: "ann@example.com" } })}
      />,
    )

    const dialog = find("[data-e2e=admin-newsletter-dialog]")
    expect(dialog.textContent).toContain("Remove this subscriber?")
    expect(dialog.textContent).toContain("ann@example.com")
    expect(has("[data-e2e=admin-newsletter-dialog] input")).toBe(false)
    expect(find("[data-e2e=admin-newsletter-confirm]").textContent).toContain("Remove")
    await submit("[data-e2e=admin-newsletter-confirm]")
    expect(calls).toEqual([["confirm"]])
  })

  it("shows why the API refused the action inside its dialog", async () => {
    const message = "This address is not on the list"
    await mount(
      <AdminNewsletterScreen
        {...props([], {
          dialog: { action: "resend", email: "cat@example.com" },
          dialogError: message,
        })}
      />,
    )

    expect(find("[data-e2e=admin-newsletter-dialog]").textContent).toContain(message)
  })

  it("moves focus to the list's heading after an action went through", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls)} />)
    expect(document.activeElement?.getAttribute("data-e2e")).not.toBe("admin-newsletter-count")

    await mount(
      <AdminNewsletterScreen
        {...props(calls, {
          done: 1,
          list: { subscribers: [cat], total: 1, page: 1, pageSize: 25 },
        })}
      />,
    )
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("admin-newsletter-count")
    expect(find("[data-e2e=admin-newsletter-count]").textContent).toBe("1 address")
  })

  it("exports from the header's one primary action, which waits while a file is on its way", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls)} />)

    await clickOn(find("[data-e2e=admin-newsletter-export]"))
    expect(calls).toEqual([["export"]])

    await mount(<AdminNewsletterScreen {...props(calls, { exporting: true })} />)
    const button = find<HTMLButtonElement>("[data-e2e=admin-newsletter-export]")
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain("Exporting…")
  })

  it("says why the list is empty: nobody yet, or nobody matching", async () => {
    const empty = { subscribers: [], total: 0, page: 1, pageSize: 25 }
    await mount(<AdminNewsletterScreen {...props([], { list: empty })} />)
    expect(find("[data-e2e=admin-newsletter-list]").textContent).toContain("No subscribers yet")

    await mount(
      <AdminNewsletterScreen
        {...props([], { list: empty, filter: { query: "zz", status: "any", page: 1 } })}
      />,
    )
    expect(find("[data-e2e=admin-newsletter-list]").textContent).toContain("Nobody matches")
  })

  it("shows loading placeholders, then the error with a way to try again", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls, { stats: null, list: null })} />)
    expect(find("[role=status][aria-label='Loading the numbers']")).toBeTruthy()
    expect(find("[data-e2e=admin-newsletter-count]").textContent).toBe("Loading addresses")

    await mount(
      <AdminNewsletterScreen
        {...props(calls, { stats: null, statsError: "Database is down", list: null })}
      />,
    )
    expect(find("[data-e2e=admin-newsletter-stats-error]").textContent).toContain(
      "Database is down",
    )
    await press("main, body", "Try again")
    expect(calls).toEqual([["retry"]])
  })

  it("lists each sent issue with its recipients, deliveries and failures", async () => {
    await mount(<AdminNewsletterScreen {...props([], { tab: "sends" })} />)

    const row = find("[data-e2e=admin-newsletter-sends] tbody tr")
    const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent?.trim())
    expect(cells).toEqual([
      "First issue2026-10-first",
      day("2026-10-10T12:00:00.000Z"),
      "2",
      "1",
      "1",
      "Needs a rerun",
    ])
  })

  it("switches tabs through the callback, so the open tab lives in the address", async () => {
    const calls: unknown[][] = []
    await mount(<AdminNewsletterScreen {...props(calls)} />)

    const tab = findAll("[data-e2e=admin-newsletter-tab]")
      .find((element) => element.textContent?.includes("Sent issues"))!
    await clickOn(tab)
    expect(calls).toEqual([["tab", "sends"]])
  })
})

describe("the newsletter screen in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminNewsletterScreen
          {...props([], { dialog: { action: "remove", email: "ann@example.com" } })}
        />
        <AdminNewsletterScreen {...props([], { tab: "sends" })} />
      </I18nContext.Provider>,
    )
    expect(
      englishLeft(document.body, [
        `ann@example.com`,
        `cat@example.com`,
        `First issue`,
        `2026-10-first`,
      ]),
    ).toEqual([])
  })
})
