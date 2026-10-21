/**
 * The admin app's billing screens (#196), driven in a browser DOM (happy-dom): what the list's
 * figures, chips and rows show, what a customer's page offers to whom, what each confirmed action
 * sends, and what a dialog says when the result is unknown.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { createFormatters } from "@spy4x/time/format"
import {
  ADMIN_BILLING_NO_FILTER,
  type AdminBillingCustomer,
  type AdminBillingDetail,
  type AdminBillingFigures,
  type AdminBillingListResponse,
  BILLING_AUDIT_EVENTS,
  BillingStatus,
  PRO_PLAN_ID,
} from "@domain/billing"
import { UserRole } from "@domain/identity"
import {
  ADMIN_BILLING_LIST_ERROR,
  ADMIN_BILLING_SETUP_URL,
  AdminBillingListScreen,
  type AdminBillingListScreenProps,
} from "./admin-billing-list.tsx"
import {
  AdminBillingCustomerScreen,
  type AdminBillingCustomerScreenProps,
} from "./admin-billing-detail.tsx"

/** A day as the screens write it on this device: the default formatter, with no person's settings. */
const day = (at: string) => createFormatters().date(at)

const window = new Window({ url: `http://admin.localhost/` })
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
  document.body.innerHTML = ``
  root = null
})

/** Renders `node`, into the same root when one is mounted already, as a prop change would. */
async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement(`div`)
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
      new window.MouseEvent(`click`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** Presses the button whose text is `text` inside `scope`. */
async function press(scope: string, text: string): Promise<void> {
  const button = [...find(scope).querySelectorAll(`button`)]
    .find((candidate) => candidate.textContent?.trim() === text)
  if (!button) throw new Error(`no button "${text}" in ${scope}`)
  await act(() => {
    button.dispatchEvent(
      new window.MouseEvent(`click`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

async function submit(selector: string): Promise<void> {
  const form = find(selector).closest(`form`)!
  await act(async () => {
    form.dispatchEvent(
      new window.SubmitEvent(`submit`, { bubbles: true, cancelable: true }) as unknown as Event,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const GROUP_ID = `0199c3a0-0000-7000-8000-000000000001`
const OTHER_ID = `0199c3a0-0000-7000-8000-000000000002`
const NOW = new Date(`2026-10-17T12:00:00.000Z`)

function customer(overrides: Partial<AdminBillingCustomer> = {}): AdminBillingCustomer {
  return {
    groupId: GROUP_ID,
    groupName: `Acme Studio`,
    groupDeletedAt: null,
    owner: { id: 7, name: `Ada Lovelace`, email: `ada@acme.test` },
    planId: PRO_PLAN_ID,
    status: BillingStatus.Active,
    quantity: 4,
    currentPeriodEnd: `2026-11-12T12:00:00.000Z`,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    pastDueSince: null,
    everActive: true,
    updatedAt: `2026-10-12T12:00:00.000Z`,
    ...overrides,
  }
}

const figures: AdminBillingFigures = {
  monthlyRevenue: [{ amount: 122400, currency: `EUR` }, { amount: 1800, currency: `USD` }],
  paying: 31,
  pastDue: 3,
  trials: 7,
  trialsEndingSoon: 2,
  ending: 2,
  lastEventAt: `2026-10-17T11:58:00.000Z`,
}

const counts = { paying: 38, trial: 7, past_due: 3, ending: 2, cancelled: 9, all: 56 }

function page(
  customers: AdminBillingCustomer[],
): Extract<AdminBillingListResponse, { enabled: true }> {
  return {
    enabled: true,
    customers,
    total: customers.length,
    page: 1,
    pageSize: 25,
    counts,
    graceDays: 7,
    pricingUrl: `https://www.example.com/pricing`,
  }
}

function listProps(calls: unknown[][], props: Partial<AdminBillingListScreenProps> = {}) {
  return {
    filter: ADMIN_BILLING_NO_FILTER,
    figures,
    figuresError: null,
    list: page([customer()]),
    pending: false,
    error: null,
    now: NOW,
    onSearch: (filter) => void calls.push([`search`, filter]),
    onPage: (page) => void calls.push([`page`, page]),
    onRetry: () => void calls.push([`retry`]),
    ...props,
  } satisfies AdminBillingListScreenProps
}

describe(`the admin billing list`, () => {
  it(`shows revenue per currency, never added up, and where the figures come from`, async () => {
    await mount(<AdminBillingListScreen {...listProps([])} />)
    const text = find(`[data-e2e=admin-billing-figures]`).textContent
    expect(text).toContain(`€1,224.00 · $18.00`)
    expect(text).toContain(`3 past due`)
    expect(text).toContain(`2 end in the next 7 days`)
    expect(find(`[data-e2e=admin-billing-source]`).textContent).toContain(
      `once its webhook arrives`,
    )
  })

  it(`shows each chip's count and filters by a pressed chip on page 1`, async () => {
    const calls: unknown[][] = []
    const third = { ...ADMIN_BILLING_NO_FILTER, page: 3 }
    await mount(<AdminBillingListScreen {...listProps(calls, { filter: third })} />)
    await press(`[data-e2e=admin-billing-status]`, `Past due 3`)
    find<HTMLInputElement>(`[data-e2e=admin-billing-search]`).value = `  ada  `
    await submit(`[data-e2e=admin-billing-submit]`)
    expect(calls).toEqual([
      [`search`, { ...ADMIN_BILLING_NO_FILTER, status: `past_due`, page: 1 }],
      [`search`, { ...ADMIN_BILLING_NO_FILTER, query: `ada`, page: 1 }],
    ])
  })

  it(`links each customer to its page with its status, date, amount and seats`, async () => {
    const trial = customer({
      groupId: OTHER_ID,
      groupName: `Northwind`,
      status: BillingStatus.Trialing,
      quantity: 2,
      trialEnd: `2026-10-30T12:00:00.000Z`,
      groupDeletedAt: `2026-10-15T12:00:00.000Z`,
    })
    await mount(<AdminBillingListScreen {...listProps([], { list: page([customer(), trial]) })} />)

    expect(find(`[data-e2e=admin-billing-${GROUP_ID}]`).getAttribute(`href`)).toBe(
      `/billing/${GROUP_ID}`,
    )
    const rows = document.querySelectorAll(`[data-e2e=admin-billing-list] tbody tr`)
    expect(rows[0].querySelector(`[data-e2e=admin-billing-row-status]`)?.textContent).toBe(
      `ActiveRenews ${day(`2026-11-12T12:00:00.000Z`)}`,
    )
    expect(rows[0].querySelector(`[data-e2e=admin-billing-row-amount]`)?.textContent).toBe(
      `€36.004 × €9.00`,
    )
    expect(rows[0].querySelector(`[data-e2e=admin-billing-deleted]`) === null).toBe(true)
    expect(rows[1].querySelector(`[data-e2e=admin-billing-row-status]`)?.textContent).toBe(
      `TrialEnds ${day(`2026-10-30T12:00:00.000Z`)}`,
    )
    expect(rows[1].querySelector(`[data-e2e=admin-billing-row-amount]`)?.textContent).toBe(
      `€0.00would be €18.00`,
    )
    expect(rows[1].querySelector(`[data-e2e=admin-billing-deleted]`) !== null).toBe(true)
  })

  it(`says billing is off instead of showing an empty table`, async () => {
    await mount(<AdminBillingListScreen {...listProps([], { list: { enabled: false } })} />)
    expect(find(`[data-e2e=admin-billing-off]`).textContent).toContain(`Billing is off`)
    const setup = find(`[data-e2e=admin-billing-setup]`)
    expect(setup.getAttribute(`href`)).toBe(ADMIN_BILLING_SETUP_URL)
    expect(setup.getAttribute(`target`)).toBe(`_blank`)
    expect(has(`[data-e2e=admin-billing-search]`)).toBe(false)
    expect(has(`[data-e2e=admin-billing-figures]`)).toBe(false)
  })

  it(`says no group pays yet, with nothing to search, before the first customer`, async () => {
    const none = { ...page([]), counts: { ...counts, paying: 0, all: 0 } }
    await mount(<AdminBillingListScreen {...listProps([], { list: none })} />)
    expect(find(`[data-e2e=admin-billing-none]`).textContent).toContain(`No paid groups yet`)
    expect(has(`[data-e2e=admin-billing-search]`)).toBe(false)
    const pricing = find(`[data-e2e=admin-billing-pricing]`)
    expect(pricing.getAttribute(`href`)).toBe(`https://www.example.com/pricing`)
    expect(pricing.getAttribute(`target`)).toBe(`_blank`)

    await mount(
      <AdminBillingListScreen {...listProps([], { list: { ...none, pricingUrl: null } })} />,
    )
    expect(has(`[data-e2e=admin-billing-pricing]`)).toBe(false)
  })

  it(`shows a failed count and a failed list apart in plain words, each with a retry`, async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBillingListScreen
        {...listProps(calls, { figures: null, figuresError: `Server error.` })}
      />,
    )
    const figuresError = find(`[data-e2e=admin-billing-figures-error]`).textContent
    expect(figuresError).toContain(`Could not count revenue.`)
    expect(figuresError).not.toContain(`Server error.`)
    expect(has(`[data-e2e=admin-billing-list]`)).toBe(true)
    await press(`[data-e2e=admin-billing-figures-error]`, `Try again`)

    await mount(
      <AdminBillingListScreen {...listProps(calls, { list: null, error: `Server error.` })} />,
    )
    expect(has(`[data-e2e=admin-billing-figures]`)).toBe(true)
    const listError = find(`[data-e2e=admin-billing-error]`).textContent
    expect(listError).toContain(ADMIN_BILLING_LIST_ERROR)
    expect(listError).not.toContain(`Server error.`)
    expect(has(`[data-e2e=admin-billing-count]`)).toBe(false)
    expect(calls).toEqual([[`retry`]])
  })

  it(`says "Searching…" only while its own search runs, not while the first list loads`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminBillingListScreen {...listProps(calls, { list: null, pending: true })} />)
    const button = () => find(`[data-e2e=admin-billing-submit]`).textContent?.trim()
    expect(button()).toBe(`Search`)

    await mount(<AdminBillingListScreen {...listProps(calls)} />)
    await submit(`[data-e2e=admin-billing-submit]`)
    await mount(<AdminBillingListScreen {...listProps(calls, { pending: true })} />)
    expect(button()).toBe(`Searching…`)
  })

  it(`moves focus to the count once the list of a search or a chip arrives`, async () => {
    const calls: unknown[][] = []
    const count = () => find(`[data-e2e=admin-billing-count]`)
    await mount(<AdminBillingListScreen {...listProps(calls, { list: null, pending: true })} />)
    await mount(<AdminBillingListScreen {...listProps(calls)} />)
    expect(document.activeElement === count()).toBe(false)

    await submit(`[data-e2e=admin-billing-submit]`)
    await mount(<AdminBillingListScreen {...listProps(calls, { pending: true })} />)
    await mount(<AdminBillingListScreen {...listProps(calls, { list: page([]) })} />)
    expect(document.activeElement === count()).toBe(true)
    expect(count().textContent).toBe(`0 groups`)

    find<HTMLElement>(`[data-e2e=admin-billing-search]`).focus()
    await press(`[data-e2e=admin-billing-status]`, `Trial 7`)
    await mount(<AdminBillingListScreen {...listProps(calls, { list: page([customer()]) })} />)
    expect(document.activeElement === count()).toBe(true)
  })
})

const operator = { id: 1, role: UserRole.OPERATOR }
const supervisor = { id: 1, role: UserRole.SUPERVISOR }

function detail(overrides: Partial<AdminBillingDetail> = {}): AdminBillingDetail {
  return {
    customer: customer(),
    customerSince: `2026-03-03T12:00:00.000Z`,
    providerUrl: `https://dashboard.stripe.com/test/customers/cus_1`,
    history: [{
      id: 1,
      event: BILLING_AUDIT_EVENTS.paymentRefunded,
      at: `2026-10-16T12:00:00.000Z`,
      operator: `Grace Hopper`,
      amount: { amount: 3600, currency: `EUR`, decimals: 2 },
      until: null,
      note: `Charged twice`,
    }],
    operatorIsMember: false,
    graceDays: 7,
    ...overrides,
  }
}

const payment = {
  id: `pi_1`,
  amount: 3600,
  currency: `EUR`,
  decimals: 2,
  paidAt: `2026-10-12T12:00:00.000Z`,
  amountRefunded: 0,
  refunded: false,
}

function customerProps(
  calls: unknown[][],
  props: Partial<AdminBillingCustomerScreenProps> = {},
): AdminBillingCustomerScreenProps {
  return {
    detail: detail(),
    error: null,
    payment: { payment, error: null },
    operator,
    now: NOW,
    onRetry: () => void calls.push([`retry`]),
    onRetryPayment: () => void calls.push([`retry payment`]),
    dialog: null,
    onOpenDialog: (dialog) => void calls.push([`open`, dialog]),
    onCloseDialog: () => void calls.push([`close`]),
    actionError: null,
    pending: false,
    onAction: (action) => void calls.push([`action`, action]),
    waiting: null,
    navigate: undefined,
    ...props,
  }
}

function item(dialog: string): HTMLButtonElement {
  return find<HTMLButtonElement>(`[data-e2e=admin-billing-open-${dialog}]`)
}

describe(`one customer in the admin app`, () => {
  it(`shows the stored subscription, the last payment and the operator history`, async () => {
    await mount(<AdminBillingCustomerScreen {...customerProps([])} />)
    const summary = find(`[data-e2e=admin-billing-summary]`).textContent
    expect(summary).toContain(`Pro, 4 members`)
    expect(summary).toContain(`4 × €9.00 = €36.00`)
    expect(summary).toContain(day(`2026-03-03T12:00:00.000Z`))
    // The page header keeps one line, so the address lives in the summary, where it wraps.
    expect(find(`[data-e2e=admin-billing-owner-email]`).textContent).toBe(`ada@acme.test`)
    expect(find(`[data-e2e=admin-billing-payment]`).textContent).toBe(
      `€36.00 on ${day(`2026-10-12T12:00:00.000Z`)}`,
    )
    const history = find(`[data-e2e=admin-billing-history]`).textContent
    expect(history).toContain(`€36.00 refunded`)
    expect(history).toContain(`By Grace Hopper. Note: Charged twice`)
    expect(find(`[data-e2e=admin-billing-stripe]`).getAttribute(`target`)).toBe(`_blank`)
  })

  it(`offers an operator the reversible actions and shows the supervisor's ones disabled`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminBillingCustomerScreen {...customerProps(calls)} />)
    expect(item(`refund`).disabled).toBe(true)
    expect(item(`refund`).textContent).toContain(`Needs a supervisor`)
    expect(item(`time`).disabled).toBe(false)
    // Cancelling at the period's end is an operator's; only "now" needs a supervisor.
    expect(item(`cancel`).disabled).toBe(false)
    expect(has(`[data-e2e=admin-billing-open-undo]`)).toBe(false)

    await mount(<AdminBillingCustomerScreen {...customerProps(calls, { operator: supervisor })} />)
    expect(item(`refund`).disabled).toBe(false)
    await click(`[data-e2e=admin-billing-open-refund]`)
    expect(calls).toEqual([[`open`, `refund`]])
  })

  it(`offers undo only while a cancellation waits, and nothing to an operator who belongs`, async () => {
    const ending = detail({ customer: customer({ cancelAtPeriodEnd: true }) })
    await mount(<AdminBillingCustomerScreen {...customerProps([], { detail: ending })} />)
    expect(item(`undo`).disabled).toBe(false)
    // Already ending: only "now" is left, and that needs a supervisor.
    expect(item(`cancel`).disabled).toBe(true)

    await mount(
      <AdminBillingCustomerScreen
        {...customerProps([], { operator: supervisor, detail: detail({ operatorIsMember: true }) })}
      />,
    )
    for (const dialog of [`refund`, `time`, `cancel`]) expect(item(dialog).disabled).toBe(true)
    expect(has(`[data-e2e=admin-billing-member]`)).toBe(true)
  })

  it(`names the amount in the refund's title and button, and sends the payment it showed`, async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps(calls, { operator: supervisor, dialog: `refund` })}
      />,
    )
    const dialog = find(`[data-e2e=admin-billing-dialog]`)
    expect(dialog.textContent).toContain(`Refund €36.00 to Acme Studio?`)
    expect(find(`[data-e2e=admin-billing-action-submit]`).textContent).toBe(`Refund €36.00`)
    find<HTMLInputElement>(`[data-e2e=admin-billing-note]`).value = ` ticket 4411 `
    await submit(`[data-e2e=admin-billing-action-submit]`)
    expect(calls).toEqual([[`action`, { kind: `refund`, paymentId: `pi_1`, note: `ticket 4411` }]])
  })

  it(`cancels at the period's end by default, and keeps "now" from an operator`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminBillingCustomerScreen {...customerProps(calls, { dialog: `cancel` })} />)
    const now = find<HTMLInputElement>(`[data-e2e=admin-billing-dialog] input[value=now]`)
    expect(now.disabled).toBe(true)
    expect(find(`[data-e2e=admin-billing-dialog]`).textContent).toContain(
      `At the end of the period, on ${day(`2026-11-12T12:00:00.000Z`)}`,
    )
    await submit(`[data-e2e=admin-billing-action-submit]`)
    expect(calls).toEqual([[`action`, { kind: `cancel`, when: `period_end`, note: `` }]])
  })

  it(`promises a past-due group its plan only until the grace end the status line shows`, async () => {
    const calls: unknown[][] = []
    // Past due since Oct 13 with 7 days of grace: Pro until Oct 20, long before the period's end.
    const pastDue = customer({
      status: BillingStatus.PastDue,
      pastDueSince: `2026-10-13T12:00:00.000Z`,
    })
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps(calls, { dialog: `cancel`, detail: detail({ customer: pastDue }) })}
      />,
    )
    const graceEnd = day(`2026-10-20T12:00:00.000Z`)
    expect(find(`[data-e2e=admin-billing-status]`).textContent).toContain(
      `Plan kept until ${graceEnd}`,
    )
    const dialog = find(`[data-e2e=admin-billing-dialog]`).textContent
    expect(dialog).toContain(`Acme Studio keeps Pro until ${graceEnd} and is not charged again.`)
    expect(dialog).not.toContain(`keeps Pro until then`)
  })

  it(`says a group past its grace period is already on Free, not that it keeps Pro`, async () => {
    const calls: unknown[][] = []
    const lapsed = customer({
      status: BillingStatus.PastDue,
      pastDueSince: `2026-10-01T12:00:00.000Z`,
    })
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps(calls, { dialog: `cancel`, detail: detail({ customer: lapsed }) })}
      />,
    )
    expect(find(`[data-e2e=admin-billing-status]`).textContent).toContain(`On Free since`)
    const dialog = find(`[data-e2e=admin-billing-dialog]`).textContent
    expect(dialog).toContain(`Acme Studio is already on Free and is not charged again.`)
    expect(dialog).not.toContain(`keeps Pro`)
  })

  it(`shows the new end as the length changes, and sends the picked length`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminBillingCustomerScreen {...customerProps(calls, { dialog: `time` })} />)
    // Active until Nov 12: the time at no charge starts after the paid period.
    expect(find(`[data-e2e=admin-billing-until]`).textContent).toContain(
      `until ${day(`2026-12-12T12:00:00.000Z`)}`,
    )
    const week = find<HTMLInputElement>(`[data-e2e=admin-billing-dialog] input[value='7d']`)
    await act(() => {
      week.checked = true
      week.dispatchEvent(new window.Event(`change`, { bubbles: true }) as unknown as Event)
    })
    expect(find(`[data-e2e=admin-billing-until]`).textContent).toContain(
      `until ${day(`2026-11-19T12:00:00.000Z`)}`,
    )
    await submit(`[data-e2e=admin-billing-action-submit]`)
    expect(calls).toEqual([[`action`, { kind: `time`, length: `7d`, note: `` }]])
  })

  it(`says the result is unknown when no clear answer came, and never that nothing changed`, async () => {
    const message = `Could not reach the server, so we cannot tell whether this happened.`
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps([], {
          operator: supervisor,
          dialog: `refund`,
          actionError: { message, unknown: true },
        })}
      />,
    )
    const error = find(`[data-e2e=admin-billing-dialog-error]`).textContent
    expect(error).toContain(`Result unknown`)
    expect(error).toContain(message)
    expect(find(`[data-e2e=admin-billing-dialog]`).textContent).not.toContain(`Nothing changed`)
  })

  it(`waits for Stripe after an action, then points to Stripe`, async () => {
    await mount(
      <AdminBillingCustomerScreen {...customerProps([], { waiting: { timedOut: false } })} />,
    )
    expect(find(`[data-e2e=admin-billing-waiting]`).textContent).toContain(
      `waiting for confirmation`,
    )
    await mount(
      <AdminBillingCustomerScreen {...customerProps([], { waiting: { timedOut: true } })} />,
    )
    expect(find(`[data-e2e=admin-billing-waiting]`).textContent).toContain(
      `Stripe has not confirmed yet`,
    )
  })

  it(`still shows the stored subscription when Stripe gives no payment, with a retry`, async () => {
    const calls: unknown[][] = []
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps(calls, {
          payment: { payment: undefined, error: `Stripe did not answer.` },
        })}
      />,
    )
    expect(find(`[data-e2e=admin-billing-summary]`).textContent).toContain(`Pro, 4 members`)
    await press(`[data-e2e=admin-billing-payment-error]`, `Try again`)
    expect(calls).toEqual([[`retry payment`]])
  })

  it(`shows a loading state, then the API's message with a retry when it fails`, async () => {
    const calls: unknown[][] = []
    await mount(<AdminBillingCustomerScreen {...customerProps(calls, { detail: null })} />)
    expect(has(`[role=status][aria-label="Loading the group's billing"]`)).toBe(true)
    await mount(
      <AdminBillingCustomerScreen
        {...customerProps(calls, { detail: null, error: `This group has no subscription` })}
      />,
    )
    expect(find(`[data-e2e=admin-billing-customer-error]`).textContent).toContain(
      `This group has no subscription`,
    )
    await press(`[data-e2e=admin-billing-customer-error]`, `Try again`)
    expect(calls).toEqual([[`retry`]])
  })
})
