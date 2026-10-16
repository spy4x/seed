/**
 * The audit log screen (#429), driven in a browser DOM (happy-dom): what the filter form sends,
 * where each person links, what each view shows and how older entries are asked for.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  accountAuditEvent,
  activityAuditEvent,
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_JOB_RETRIED_KIND,
  type AdminAuditEntry,
  type AdminAuditFilter,
  AuthAuditEventType,
} from "@domain/identity"
import { BILLING_AUDIT_EVENTS } from "@domain/billing"
import {
  AdminAuditScreen,
  type AdminAuditScreenProps,
  auditEventLabel,
} from "./admin-audit-screen.tsx"

const window = new Window({ url: "http://admin.localhost/audit" })
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

/** Types into a field, or picks a select's option, as a person would. */
async function fill(selector: string, value: string): Promise<void> {
  const field = find<HTMLInputElement>(selector)
  field.value = value
  const kind = field.tagName === "SELECT" ? "change" : "input"
  await act(() => {
    field.dispatchEvent(new window.Event(kind, { bubbles: true }) as unknown as Event)
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

const ada = { id: 11, name: "Ada Lovelace", email: "ada@example.com" }
const grace = { id: 7, name: "Grace Hopper", email: "grace@example.com" }

const signedIn: AdminAuditEntry = {
  key: "account-3",
  source: "account",
  event: accountAuditEvent(AuthAuditEventType.SIGNED_IN),
  at: "2026-10-15T08:00:00.000Z",
  person: ada,
  actor: ada,
  byOperator: false,
  group: null,
  identifier: "ada@example.com",
  ip: "192.0.2.10",
  userAgent: "Firefox on Linux",
  jobKind: null,
}

const blocked: AdminAuditEntry = {
  ...signedIn,
  key: "account-4",
  event: accountAuditEvent(AuthAuditEventType.USER_BLOCKED),
  at: "2026-10-15T09:00:00.000Z",
  actor: grace,
  byOperator: true,
  identifier: null,
  ip: "203.0.113.5",
}

const retried: AdminAuditEntry = {
  ...signedIn,
  key: "activity-9",
  source: "activity",
  event: activityAuditEvent(ADMIN_JOB_RETRIED_KIND),
  at: "2026-10-15T10:00:00.000Z",
  person: null,
  actor: grace,
  byOperator: true,
  identifier: null,
  ip: null,
  userAgent: null,
  jobKind: "mail.password_reset",
}

function props(
  calls: unknown[][],
  overrides: Partial<AdminAuditScreenProps> = {},
): AdminAuditScreenProps {
  return {
    filter: ADMIN_AUDIT_NO_FILTER,
    operators: [grace],
    view: "table",
    entries: [retried, blocked, signedIn],
    hasMore: false,
    pending: false,
    loadingMore: false,
    error: null,
    exportHref: "/api/admin/audit/export.csv",
    onFilter: (filter) => calls.push(["filter", filter]),
    onView: (view) => calls.push(["view", view]),
    onMore: () => calls.push(["more"]),
    ...overrides,
  }
}

describe("audit log screen", () => {
  it("sends every typed filter together when the operator applies them", async () => {
    const calls: unknown[][] = []
    await mount(<AdminAuditScreen {...props(calls)} />)
    await fill("[data-e2e=admin-audit-event]", accountAuditEvent(AuthAuditEventType.SIGNED_IN))
    await fill("[data-e2e=admin-audit-person]", "  ada  ")
    await fill("[data-e2e=admin-audit-operator]", "7")
    await fill("[data-e2e=admin-audit-from]", "2026-10-01")
    await fill("[data-e2e=admin-audit-to]", "2026-10-15")
    await fill("[data-e2e=admin-audit-ip]", " 192.0.2. ")
    expect(calls).toEqual([])
    await submit("[data-e2e=admin-audit-apply]")

    const expected: AdminAuditFilter = {
      event: accountAuditEvent(AuthAuditEventType.SIGNED_IN),
      person: "ada",
      operator: 7,
      from: "2026-10-01",
      to: "2026-10-15",
      ip: "192.0.2.",
    }
    expect(calls).toEqual([["filter", expected]])
  })

  it("starts the form from the address's filter and clears it in one press", async () => {
    const calls: unknown[][] = []
    const filter = { ...ADMIN_AUDIT_NO_FILTER, person: "ada", operator: 7 }
    await mount(<AdminAuditScreen {...props(calls, { filter })} />)

    expect(find<HTMLInputElement>("[data-e2e=admin-audit-person]").value).toBe("ada")
    expect(find<HTMLSelectElement>("[data-e2e=admin-audit-operator]").value).toBe("7")
    await click("[data-e2e=admin-audit-clear]")
    expect(calls).toEqual([["filter", ADMIN_AUDIT_NO_FILTER]])
  })

  it("offers no Clear button while nothing is filtered", async () => {
    await mount(<AdminAuditScreen {...props([])} />)

    expect(has("[data-e2e=admin-audit-clear]")).toBe(false)
  })

  it("links each person to their page and names who did an operator's action", async () => {
    await mount(<AdminAuditScreen {...props([])} />)
    const rows = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]

    expect(rows.map((row) => row.querySelector("[data-e2e=admin-audit-event-label]")?.textContent))
      .toEqual([
        "Job run again by an operator",
        "Blocked by an operator",
        "Signed in",
      ])
    expect(rows[1].querySelector("[data-e2e=admin-audit-person-11]")?.getAttribute("href")).toBe(
      "/users/11",
    )
    expect(rows[1].querySelector("[data-e2e=admin-audit-person-7]")?.getAttribute("href")).toBe(
      "/users/7",
    )
    expect(rows[1].textContent).toContain("Operator")
    expect(rows[2].textContent).toContain("Themselves")
    expect(rows[2].textContent).toContain("192.0.2.10")
    expect(rows[0].textContent).toContain("Job mail.password_reset")
  })

  it("calls a missing person deleted only on a person's own trail", async () => {
    const gone = { ...signedIn, key: "account-5", person: null, actor: null }
    await mount(<AdminAuditScreen {...props([], { entries: [retried, gone] })} />)
    const rows = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]

    expect(rows[0].textContent).not.toContain("Deleted account")
    expect(rows[1].textContent).toContain("Deleted account")
  })

  it("names a person's address once when they set no name", async () => {
    const plain = { id: 12, name: "lin@example.com", email: "lin@example.com" }
    const entry = { ...signedIn, key: "account-6", person: plain, actor: plain }
    await mount(<AdminAuditScreen {...props([], { entries: [entry] })} />)
    const about = find("[data-e2e=admin-audit-table] tbody tr td:nth-child(3)").textContent ?? ""

    expect(about.split("lin@example.com")).toHaveLength(2)
  })

  it("shows the same entries on a timeline, people still linked", async () => {
    await mount(<AdminAuditScreen {...props([], { view: "timeline" })} />)
    const timeline = find("[data-e2e=admin-audit-timeline]")

    expect(has("[data-e2e=admin-audit-table]")).toBe(false)
    expect(timeline.querySelectorAll("li")).toHaveLength(3)
    expect(find("[data-e2e=admin-audit-entry-account-4]").textContent).toContain(
      "Blocked by an operator",
    )
    expect(
      find("[data-e2e=admin-audit-entry-account-4] [data-e2e=admin-audit-person-7]").getAttribute(
        "href",
      ),
    ).toBe("/users/7")
  })

  it("asks for the other view when its chip is pressed", async () => {
    const calls: unknown[][] = []
    await mount(<AdminAuditScreen {...props(calls)} />)
    const chip = [...find("[data-e2e=admin-audit-view]").querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Timeline")!
    await act(() => {
      chip.dispatchEvent(
        new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
      )
    })

    expect(calls).toEqual([["view", "timeline"]])
  })

  it("asks for older entries only while there are more", async () => {
    const calls: unknown[][] = []
    await mount(<AdminAuditScreen {...props(calls)} />)
    expect(has("[data-e2e=admin-audit-more]")).toBe(false)

    await mount(<AdminAuditScreen {...props(calls, { hasMore: true })} />)
    expect(find("[data-e2e=admin-audit-count]").textContent).toBe("3+ entries")
    await click("[data-e2e=admin-audit-more]")
    expect(calls).toEqual([["more"]])
  })

  it("downloads the CSV of the filter the page shows", async () => {
    const href = "/api/admin/audit/export.csv?person=ada"
    await mount(<AdminAuditScreen {...props([], { exportHref: href })} />)

    expect(find("[data-e2e=admin-audit-export]").getAttribute("href")).toBe(href)
  })

  it("tells an empty log from a filter that matches nothing", async () => {
    await mount(<AdminAuditScreen {...props([], { entries: [] })} />)
    expect(find("[data-e2e=admin-audit-empty]").textContent).toContain("Nothing recorded yet")

    await mount(
      <AdminAuditScreen
        {...props([], { entries: [], filter: { ...ADMIN_AUDIT_NO_FILTER, ip: "10." } })}
      />,
    )
    expect(find("[data-e2e=admin-audit-empty]").textContent).toContain("Nothing matches")
  })

  it("shows a loading state, then the error when the log could not be read", async () => {
    await mount(<AdminAuditScreen {...props([], { entries: null })} />)
    expect(has("[data-e2e=admin-audit-loading]")).toBe(true)

    await mount(<AdminAuditScreen {...props([], { entries: null, error: "The log is down." })} />)
    expect(has("[data-e2e=admin-audit-loading]")).toBe(false)
    expect(find("[data-e2e=admin-audit-error]").textContent).toContain("The log is down.")
  })

  it("names each event, and shows the code of one it does not know", () => {
    expect(auditEventLabel(accountAuditEvent(AuthAuditEventType.SIGNED_UP))).toBe("Signed up")
    expect(auditEventLabel(activityAuditEvent("note.created"))).toBe("Note added")
    expect(auditEventLabel(activityAuditEvent("billing.paid"))).toBe("billing.paid")
    expect(auditEventLabel(accountAuditEvent(999))).toBe("Account event 999")
  })

  it("names an operator's billing action, and offers it as a filter", async () => {
    expect(auditEventLabel(accountAuditEvent(BILLING_AUDIT_EVENTS.paymentRefunded))).toBe(
      "Payment refunded by an operator",
    )
    await mount(<AdminAuditScreen {...props([])} />)
    const options = [...document.querySelectorAll("[data-e2e=admin-audit-event] option")]
    expect(options.map((option) => option.textContent)).toContain(
      "Operator: Cancellation undone by an operator",
    )
  })
})
