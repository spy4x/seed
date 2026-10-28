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
import { FormatContext } from "@spy4x/preact-ui/format"
import { createFormatters } from "@spy4x/time/format"
import {
  AdminAuditScreen,
  type AdminAuditScreenProps,
  auditEventLabel,
} from "./admin-audit-screen.tsx"
import { ADMIN_ENGLISH as T, ADMIN_PSEUDO, englishLeft } from "./i18n-testing.ts"

import { I18nContext } from "@spy4x/preact-ui/i18n"
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
  fileName: null,
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
  fileName: null,
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

  it("writes each entry's exact moment in UTC, in the operator's region format", async () => {
    // An operator in Berlin with German formats: 08:00 UTC is 10:00 there, yet the log says UTC.
    await mount(
      <FormatContext.Provider
        value={createFormatters({ locale: "de-DE", timeZone: "Europe/Berlin" })}
      >
        <AdminAuditScreen {...props([])} />
      </FormatContext.Provider>,
    )
    const rows = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]

    expect(rows[2].textContent).toContain("15.10.2026, 08:00:00 UTC")
  })

  it("calls a missing person deleted only on a person's own trail", async () => {
    const gone = { ...signedIn, key: "account-5", person: null, actor: null }
    await mount(<AdminAuditScreen {...props([], { entries: [retried, gone] })} />)
    const rows = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]

    expect(rows[0].textContent).not.toContain("Deleted account")
    expect(rows[1].textContent).toContain("Deleted account")
  })

  it("names the group, not a deleted account, as what an operator's billing action is about", async () => {
    const refunded: AdminAuditEntry = {
      ...blocked,
      key: "account-7",
      event: accountAuditEvent(BILLING_AUDIT_EVENTS.paymentRefunded),
      person: null,
      group: { id: "0199c3a0-0000-7000-8000-000000000001", name: "Acme Studio" },
    }
    await mount(<AdminAuditScreen {...props([], { entries: [refunded] })} />)
    const [row] = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]
    const about = row.querySelectorAll("td")[2]

    expect(about.textContent).toBe("Acme Studio")
    expect(about.querySelector("a")?.getAttribute("href")).toBe(
      "/groups/0199c3a0-0000-7000-8000-000000000001",
    )
    expect(row.textContent).not.toContain("Deleted account")
    expect(find("[data-e2e=admin-audit-people-phone]").textContent).toBe(
      "About Acme Studio · by Grace Hopper",
    )
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

  it("names the people inside the event cell for a phone, and hides their columns there", async () => {
    await mount(<AdminAuditScreen {...props([])} />)
    const rows = [...find("[data-e2e=admin-audit-table]").querySelectorAll("tbody tr")]
    const phone = (row: Element) =>
      row.querySelector("td:nth-child(2) [data-e2e=admin-audit-people-phone]")

    expect(phone(rows[1])?.textContent).toBe("About Ada Lovelace · by Grace Hopper")
    expect(phone(rows[1])?.className).toContain("sm:hidden")
    expect(phone(rows[2])?.textContent).toBe("About Ada Lovelace")
    const table = find("[data-e2e=admin-audit-table]").querySelector(`[class*="hidden"]`)!
    expect(table.className).toContain("max-sm:[&_:is(th,td):nth-child(n+3)]:hidden")
  })

  it("keeps a long address on one line, with the whole address in its tooltip", async () => {
    await mount(<AdminAuditScreen {...props([])} />)
    const address = [...find("[data-e2e=admin-audit-table]").querySelectorAll("td span")]
      .find((span) => span.textContent === "ada@example.com")!

    expect(address.className).toContain("truncate")
    expect(address.className).not.toContain("wrap-anywhere")
    expect(address.getAttribute("title")).toBe("ada@example.com")
  })

  it("fits the detail in a narrow column on two lines, the whole detail in its tooltip", async () => {
    const token = "01a1486e-38d4-74c2-a049-94b2bdd90d1d group=01a1486e-35ed access=write name=CI"
    const created = { ...signedIn, key: "account-5", identifier: token }
    await mount(<AdminAuditScreen {...props([], { entries: [created] })} />)
    const detail = find("[data-e2e=admin-audit-detail]")
    const text = detail.firstElementChild!

    expect(detail.className).toContain("sm:w-28")
    expect(text.textContent).toBe(token)
    expect(text.className).toContain("line-clamp-2")
    expect(text.getAttribute("title")).toBe(token)
    const table = find("[data-e2e=admin-audit-table]").firstElementChild!
    expect(table.className.split(" ")).toContain("[&_:is(th,td)]:px-3")
  })

  it("reads a passkey rename as from the old name to the new one, in the table and the timeline", async () => {
    const renamed = {
      ...signedIn,
      key: "account-6",
      event: accountAuditEvent(AuthAuditEventType.SIGN_IN_METHOD_RENAMED),
      identifier: "passkey name=MacBook Air from=Work laptop",
    }
    const passkeySignIn = { ...signedIn, key: "account-7", identifier: "passkey name=MacBook Air" }
    const entries = [renamed, passkeySignIn, signedIn]
    const mounted = await mount(<AdminAuditScreen {...props([], { entries })} />)
    const details = () =>
      [...document.querySelectorAll("[data-e2e=admin-audit-detail]")].map((cell) =>
        cell.firstElementChild!.textContent
      )

    expect(details()).toEqual([
      'From "Work laptop" to "MacBook Air"',
      'Passkey "MacBook Air"',
      "ada@example.com",
    ])

    await act(() =>
      render(<AdminAuditScreen {...props([], { entries, view: "timeline" })} />, mounted)
    )
    expect(find("[data-e2e=admin-audit-entry-account-6]").textContent)
      .toContain('From "Work laptop" to "MacBook Air"')
  })

  it("tells an empty log from a filter that matches nothing, without a dashed box", async () => {
    await mount(<AdminAuditScreen {...props([], { entries: [] })} />)
    expect(find("[data-e2e=admin-audit-empty]").textContent).toContain("Nothing recorded yet")

    await mount(
      <AdminAuditScreen
        {...props([], { entries: [], filter: { ...ADMIN_AUDIT_NO_FILTER, ip: "10." } })}
      />,
    )
    expect(find("[data-e2e=admin-audit-empty]").textContent).toContain("Nothing matches")
    expect(document.querySelector(".border-dashed") === null).toBe(true)
  })

  it("shows a loading state, then the error when the log could not be read", async () => {
    await mount(<AdminAuditScreen {...props([], { entries: null })} />)
    expect(has("[data-e2e=admin-audit-loading]")).toBe(true)

    await mount(<AdminAuditScreen {...props([], { entries: null, error: "The log is down." })} />)
    expect(has("[data-e2e=admin-audit-loading]")).toBe(false)
    expect(find("[data-e2e=admin-audit-error]").textContent).toContain("The log is down.")
  })

  it("names each event, and shows the code of one it does not know", () => {
    expect(auditEventLabel(T, accountAuditEvent(AuthAuditEventType.SIGNED_UP))).toBe("Signed up")
    expect(auditEventLabel(T, accountAuditEvent(AuthAuditEventType.SIGNED_IN), "email-link")).toBe(
      "Signed in with an e-mail link",
    )
    expect(auditEventLabel(T, activityAuditEvent("note.created"))).toBe("Note added")
    expect(auditEventLabel(T, activityAuditEvent("billing.paid"))).toBe("billing.paid")
    expect(auditEventLabel(T, accountAuditEvent(999))).toBe("Account event 999")
  })

  it("names an operator's billing action, and offers it as a filter", async () => {
    expect(auditEventLabel(T, accountAuditEvent(BILLING_AUDIT_EVENTS.paymentRefunded))).toBe(
      "Payment refunded by an operator",
    )
    await mount(<AdminAuditScreen {...props([])} />)
    const options = [...document.querySelectorAll("[data-e2e=admin-audit-event] option")]
    expect(options.map((option) => option.textContent)).toContain(
      "Operator: Cancellation undone by an operator",
    )
  })
})

describe("the audit log in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminAuditScreen {...props([])} />
        <AdminAuditScreen {...props([], { view: "timeline" })} />
      </I18nContext.Provider>,
    )
    expect(
      englishLeft(document.body, [
        `Ada Lovelace`,
        `Grace Hopper`,
        `ada@example.com`,
        `Firefox on Linux`,
      ]),
    ).toEqual([])
  })
})
