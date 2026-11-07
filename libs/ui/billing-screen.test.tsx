/**
 * A group's Billing tab: what each billing state says and offers, and what a press of each
 * button hands the app, in a happy-dom page. Kept beside the screen rather than in
 * `screens.test.tsx`, so billing stays in its own files.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import {
  BillingNoticeKind,
  BillingPeriod,
  BillingStatus,
  FREE_PLAN_ID,
  type GroupBilling,
  type Plan,
  PRO_PLAN_ID,
} from "@domain/billing"
import { FormatContext } from "@spy4x/preact-ui/format"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { createFormatters } from "@spy4x/time/format"
import { PlanRefusalNotice } from "./plan-refusal.tsx"
import { englishLeft, PSEUDO } from "./i18n-testing.ts"
import {
  BILLING_MESSAGES,
  BillingState,
  billingState,
  GroupBillingPanel,
  type GroupBillingPanelProps,
  SeatPriceConfirm,
} from "./billing-screen.tsx"
import {
  TEST_FREE_PLAN,
  TEST_PLANS,
  TEST_PRO_PLAN,
  testLimits,
} from "../domain/billing/test-plans.ts"

const NOW = new Date("2026-10-21T12:00:00Z")

const FREE_OWNER: GroupBilling = {
  enabled: true,
  planId: FREE_PLAN_ID,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  notice: null,
  canManage: true,
  subscribed: false,
  hasCustomer: false,
  seatPrice: null,
  period: null,
}

const PRO_OWNER: GroupBilling = {
  ...FREE_OWNER,
  planId: PRO_PLAN_ID,
  status: BillingStatus.Active,
  currentPeriodEnd: new Date("2026-11-04T00:00:00Z"),
  subscribed: true,
  hasCustomer: true,
  seatPrice: { seats: 6, amount: 900, currency: "EUR", period: BillingPeriod.Monthly },
  period: BillingPeriod.Monthly,
}

/** What makes a subscription a trial ending on 31 October. */
const TRIAL_STATE = {
  status: BillingStatus.Trialing,
  trialEnd: new Date("2026-10-31T12:00:00Z"),
  currentPeriodEnd: new Date("2026-10-31T12:00:00Z"),
}

const TRIAL_OWNER: GroupBilling = { ...PRO_OWNER, ...TRIAL_STATE }

const ENDING_OWNER: GroupBilling = { ...PRO_OWNER, cancelAtPeriodEnd: true }

const PAST_DUE_OWNER: GroupBilling = {
  ...PRO_OWNER,
  status: BillingStatus.PastDue,
  notice: {
    kind: BillingNoticeKind.PaymentFailed,
    at: new Date("2026-10-28T00:00:00Z"),
    daysLeft: 7,
  },
}

/** The same billing as a member who is not the owner reads it: no notice, no way to change it. */
function asMember(billing: GroupBilling): GroupBilling {
  return { ...billing, canManage: false, notice: null }
}

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document }

let root: HTMLElement | null = null

/** The person's format, pinned, so dates and prices read the same whatever the machine's locale. */
const FORMAT = createFormatters({ locale: `en-GB`, timeZone: `UTC`, hourCycle: null })

const withFormat = (node: VNode) => (
  <FormatContext.Provider value={FORMAT}>{node}</FormatContext.Provider>
)

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(withFormat(node), root!))
  return root
}

async function rerender(node: VNode): Promise<void> {
  await act(() => render(withFormat(node), root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return root?.querySelector(selector) !== null
}

function text(): string {
  return (root?.textContent ?? "").replace(/\s+/g, " ")
}

async function click(selector: string): Promise<void> {
  await act(() => find(selector).click())
}

/** What the panel handed the app: each checkout's plan and period, each period picked, each portal open. */
function calls() {
  const checkouts: string[] = []
  const periods: BillingPeriod[] = []
  const picked: BillingPeriod[] = []
  let portals = 0
  return {
    checkouts,
    periods,
    picked,
    get portals() {
      return portals
    },
    props: {
      onCheckout: (planId: string, period: BillingPeriod) => {
        checkouts.push(planId)
        periods.push(period)
      },
      onPeriod: (period: BillingPeriod) => picked.push(period),
      onPortal: () => portals++,
    },
  }
}

/** The test catalog's Pro with a yearly price: €4.00 a member a month or €40.00 a year, €8.00 less. */
const YEARLY_PRO: Plan = { ...TEST_PRO_PLAN, amount: 400, yearlyAmount: 4000 }

const YEARLY_OWNER: GroupBilling = {
  ...PRO_OWNER,
  seatPrice: { seats: 6, amount: 4000, currency: "EUR", period: BillingPeriod.Yearly },
  period: BillingPeriod.Yearly,
}

/** A plan priced for the whole group, as a household product sells it: €4.00 a month for up to 6. */
const FLAT_PRO: Plan = {
  ...TEST_PRO_PLAN,
  amount: 400,
  perSeat: false,
  trialDays: 0,
  entitlements: {
    ...TEST_PRO_PLAN.entitlements,
    limits: { ...TEST_PRO_PLAN.entitlements.limits, maxMembers: 6 },
  },
}

/** A catalog whose free plan allows nothing, so a new owner starts by paying for {@link FLAT_PRO}. */
const PAID_FROM_SIGN_UP: Plan[] = [
  {
    ...TEST_FREE_PLAN,
    entitlements: {
      ...TEST_FREE_PLAN.entitlements,
      limits: testLimits(0, { maxMembers: 1 }),
    },
  },
  FLAT_PRO,
]

const GROUP_ID = "019a0000-0000-7000-8000-00000000000a"
const OTHER_GROUP_ID = "019a0000-0000-7000-8000-00000000000b"

function panel(billing: GroupBilling | null, props: Partial<GroupBillingPanelProps> = {}): VNode {
  return (
    <GroupBillingPanel
      groupId={GROUP_ID}
      groupName="Team"
      billing={billing}
      memberCount={6}
      ownerName="Maya Chen"
      trial={{ enabled: true, used: false, groupId: null, days: 14 }}
      now={NOW}
      plan={TEST_PRO_PLAN}
      plans={TEST_PLANS}
      {...props}
    />
  )
}

describe("billingState", () => {
  it("names the state each billing is drawn in", () => {
    expect(billingState({ ...FREE_OWNER, enabled: false })).toBe(BillingState.OFF)
    expect(billingState(FREE_OWNER)).toBe(BillingState.FREE)
    expect(billingState(TRIAL_OWNER)).toBe(BillingState.TRIAL)
    expect(billingState(PRO_OWNER)).toBe(BillingState.PRO)
    expect(billingState(ENDING_OWNER)).toBe(BillingState.ENDING)
    expect(billingState(PAST_DUE_OWNER)).toBe(BillingState.PAST_DUE)
    // A subscription that is paused or incomplete shows the free plan; it is no Pro.
    expect(billingState({ ...PRO_OWNER, planId: FREE_PLAN_ID, status: BillingStatus.Paused }))
      .toBe(BillingState.FREE)
  })
})

describe("GroupBillingPanel", () => {
  beforeAll(() => {
    Object.assign(globalThis, { document: window.document })
  })

  afterAll(async () => {
    Object.assign(globalThis, own)
    await window.happyDOM.close()
  })

  afterEach(async () => {
    if (root) await act(() => render(null, root!))
    document.body.innerHTML = ""
    root = null
  })

  it("titles the tab and says Stripe handles the billing", async () => {
    await mount(panel(FREE_OWNER))
    expect(find("[data-e2e=group-section-billing] h2").textContent).toBe("Billing")
    expect(text()).toContain("What Team pays. Stripe handles the billing.")
  })

  it("prices Pro for a free group's members and opens the 14-day trial's checkout for its owner", async () => {
    const app = calls()
    await mount(panel(FREE_OWNER, app.props))
    expect(find("[data-e2e=billing-plan-name]").textContent).toBe("Free")
    expect(text()).toContain(
      "Pro costs €9.00 per member a month. With 6 members, Team would pay €54.00 a month.",
    )
    expect(find("[data-e2e=billing-checkout]").textContent).toBe(
      "Start 14-day free trial (opens Stripe)",
    )
    expect(find("[data-e2e=billing-fine-print]").textContent).toBe(
      "Billed monthly per member. Cancel anytime and keep Pro until the period ends.",
    )
    expect(has("[data-e2e=billing-row-invoices]")).toBe(false)
    await click("[data-e2e=billing-checkout]")
    expect(app.checkouts).toEqual([PRO_PLAN_ID])
    expect(app.periods).toEqual([BillingPeriod.Monthly])
  })

  it("greets a new owner under a free plan that allows nothing with the price first and Continue to payment", async () => {
    const app = calls()
    await mount(panel(FREE_OWNER, { ...app.props, plan: FLAT_PRO, plans: PAID_FROM_SIGN_UP }))
    expect(find("h3").textContent?.trim()).toBe("Start with Pro")
    expect(find("[data-e2e=billing-amount]").textContent).toBe("€4.00")
    expect(find("[data-e2e=billing-price]").textContent).toBe(
      "€4.00a monthFor the whole group, up to 6 members.",
    )
    expect(find("[data-e2e=billing-checkout]").textContent).toBe(
      "Continue to payment (opens Stripe)",
    )
    expect(find("[data-e2e=billing-fine-print]").textContent).toBe(
      "Billed monthly. Cancel anytime and keep Pro until the period ends.",
    )
    expect(text()).not.toContain("per member")
    expect(text()).toContain(
      "Joining someone else's group? Ask its owner for an invitation link instead of paying.",
    )
    await click("[data-e2e=billing-checkout]")
    expect(app.checkouts).toEqual([PRO_PLAN_ID])
    expect(app.periods).toEqual([BillingPeriod.Monthly])
  })

  it("keeps the start card after a checkout left unpaid, and the ordinary card once the group had a plan", async () => {
    const props = { plan: FLAT_PRO, plans: PAID_FROM_SIGN_UP }
    await mount(panel({ ...FREE_OWNER, hasCustomer: true }, props))
    expect(find("h3").textContent?.trim()).toBe("Start with Pro")
    // A group whose plan lapsed reads the ordinary free card, which asks for nothing new.
    await rerender(panel({ ...FREE_OWNER, status: BillingStatus.Canceled }, props))
    expect(find("h3").textContent?.trim()).toBe("Free plan")
    expect(has("[data-e2e=billing-join-instead]")).toBe(false)
    expect(find("[data-e2e=billing-checkout]").textContent).toBe("Upgrade to Pro (opens Stripe)")
  })

  it("draws the ordinary free card when the free plan allows something", async () => {
    await mount(panel(FREE_OWNER, { plan: FLAT_PRO, plans: TEST_PLANS }))
    expect(find("h3").textContent?.trim()).toBe("Free plan")
    expect(has("[data-e2e=billing-amount]")).toBe(false)
    expect(has("[data-e2e=billing-join-instead]")).toBe(false)
  })

  it("never says per member for a plan priced for the whole group", async () => {
    await mount(panel(FREE_OWNER, { plan: FLAT_PRO }))
    expect(find("[data-e2e=billing-price]").textContent).toBe(
      "Pro costs €4.00 a month for the whole group.",
    )
    expect(find("[data-e2e=billing-fine-print]").textContent).toBe(
      "Billed monthly. Cancel anytime and keep Pro until the period ends.",
    )
    expect(text()).not.toContain("per member")
    expect(text()).not.toContain("With 6 members")
  })

  it("promises a refund only when the plan sets its days", async () => {
    await mount(panel(FREE_OWNER, { plan: FLAT_PRO }))
    expect(has("[data-e2e=billing-refund]")).toBe(false)
    await rerender(panel(FREE_OWNER, { plan: { ...FLAT_PRO, refundDays: 30 } }))
    expect(find("[data-e2e=billing-refund]").textContent).toBe(
      "Changed your mind? Ask within 30 days for a full refund.",
    )
  })

  it("asks for a plan, not a higher limit, when a refusal's cap is 0", async () => {
    await mount(
      <PlanRefusalNotice
        groupId={GROUP_ID}
        groupName="Home"
        refusal={{
          code: "PLAN_LIMIT_REACHED",
          entitlement: "maxNotes",
          limit: 0,
          canUpgrade: true,
        }}
      />,
    )
    expect(text()).toContain("\u2068Home\u2069 has no paid plan")
    expect(text()).toContain("Choose a plan to start adding.")
    expect(text()).not.toContain("limit")
  })

  it("offers no billing period for a plan sold monthly only", async () => {
    await mount(panel(FREE_OWNER))
    expect(has("[role=radiogroup]")).toBe(false)
    expect(find("[data-e2e=billing-price]").hasAttribute("aria-live")).toBe(false)
  })

  it("offers Monthly and Yearly for a plan with a yearly price, Monthly chosen first", async () => {
    const app = calls()
    await mount(panel(FREE_OWNER, { ...app.props, plan: YEARLY_PRO }))
    const picker = find("[role=radiogroup]")
    const options = [...picker.querySelectorAll("[role=radio]")]
    expect(picker.getAttribute("aria-label")).toBe("Billing period")
    expect(options.map((option) => option.textContent)).toEqual(["Monthly", "Yearly"])
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual(["true", "false"])
    expect(find("[data-e2e=billing-price]").textContent).toBe(
      "Pro costs €4.00 per member a month. With 6 members, Team would pay €24.00 a month.",
    )
    await act(() => (options[1] as HTMLElement).click())
    expect(app.picked).toEqual([BillingPeriod.Yearly])
    await click("[data-e2e=billing-checkout]")
    expect(app.periods).toEqual([BillingPeriod.Monthly])
  })

  it("prices the year with its saving, says it renews yearly, and checks out yearly", async () => {
    const app = calls()
    await mount(panel(FREE_OWNER, { ...app.props, plan: YEARLY_PRO, period: BillingPeriod.Yearly }))
    expect(find("[data-e2e=billing-price]").getAttribute("aria-live")).toBe("polite")
    expect(find("[data-e2e=billing-price]").textContent).toBe(
      "Pro costs €40.00 per member a year. With 6 members, Team would pay €240.00 a year. €8.00 less than paying monthly.",
    )
    expect(find("[data-e2e=billing-fine-print]").textContent).toBe(
      "Billed yearly per member. Cancel anytime and keep Pro until the period ends.",
    )
    await click("[data-e2e=billing-checkout]")
    expect(app.checkouts).toEqual([PRO_PLAN_ID])
    expect(app.periods).toEqual([BillingPeriod.Yearly])
  })

  it("names no saving when the yearly price saves nothing", async () => {
    const dear = { ...YEARLY_PRO, yearlyAmount: 4800 }
    await mount(panel(FREE_OWNER, { plan: dear, period: BillingPeriod.Yearly }))
    expect(has("[data-e2e=billing-saving]")).toBe(false)
  })

  it("checks a plan sold monthly only out monthly, whatever period the address asked for", async () => {
    const app = calls()
    await mount(panel(FREE_OWNER, { ...app.props, period: BillingPeriod.Yearly }))
    expect(text()).toContain("Pro costs €9.00 per member a month.")
    await click("[data-e2e=billing-checkout]")
    expect(app.periods).toEqual([BillingPeriod.Monthly])
  })

  it("shows a yearly subscriber the yearly total, and monthly one portal visit away", async () => {
    const app = calls()
    await mount(panel(YEARLY_OWNER, { ...app.props, plan: YEARLY_PRO }))
    expect(find("[data-e2e=billing-seats]").textContent).toBe(
      "€240.00 a year, for 6 members at €40.00 each, the owner included.",
    )
    expect(find("[data-e2e=billing-row-period]").textContent).toContain(
      "You pay yearly. Monthly costs €24.00 a month.Stripe shows what you pay today before you confirm.",
    )
    expect(find("[data-e2e=billing-portal-period]").textContent).toBe(
      "Switch to monthly (opens Stripe)",
    )
    await click("[data-e2e=billing-portal-period]")
    expect(app.portals).toBe(1)
  })

  it("offers a monthly subscriber of a plan sold yearly the year and its saving", async () => {
    await mount(panel(PRO_OWNER, { plan: YEARLY_PRO }))
    expect(find("[data-e2e=billing-period]").textContent).toBe(
      "You pay monthly. Yearly costs €240.00 a year, €48.00 less.",
    )
    expect(find("[data-e2e=billing-portal-period]").textContent).toBe(
      "Switch to yearly (opens Stripe)",
    )
  })

  it("offers no period row for a plan sold monthly only, nor once the plan is cancelled", async () => {
    await mount(panel(PRO_OWNER))
    expect(has("[data-e2e=billing-row-period]")).toBe(false)
    await rerender(panel({ ...YEARLY_OWNER, cancelAtPeriodEnd: true }, { plan: YEARLY_PRO }))
    expect(has("[data-e2e=billing-row-period]")).toBe(false)
  })

  it("tells a yearly trial what the group pays a year once it ends", async () => {
    await mount(panel({ ...YEARLY_OWNER, ...TRIAL_STATE }, { plan: YEARLY_PRO }))
    expect(find("[data-e2e=billing-trial]").textContent).toContain(
      "After that, Team pays €240.00 a year unless you cancel.",
    )
  })

  it("offers Upgrade to Pro, saying the trial went to another group, once the owner used it", async () => {
    const app = calls()
    const trial = { enabled: true, used: true, groupId: OTHER_GROUP_ID, days: 14 }
    await mount(panel(FREE_OWNER, { ...app.props, trial }))
    expect(find("[data-e2e=billing-checkout]").textContent).toBe("Upgrade to Pro (opens Stripe)")
    expect(find("[data-e2e=billing-trial-used]").textContent).toBe(
      "You've already used your free trial on another group.",
    )
    await click("[data-e2e=billing-checkout]")
    expect(app.checkouts).toEqual([PRO_PLAN_ID])
  })

  it("offers the trial again to the group that holds it, with no line about another group", async () => {
    const trial = { enabled: true, used: true, groupId: GROUP_ID, days: 14 }
    await mount(panel(FREE_OWNER, { trial }))
    expect(find("[data-e2e=billing-checkout]").textContent).toBe(
      "Start 14-day free trial (opens Stripe)",
    )
    expect(has("[data-e2e=billing-trial-used]")).toBe(false)
  })

  it("offers no checkout and no fine print while Stripe confirms the owner's checkout", async () => {
    await mount(panel(FREE_OWNER, { confirming: true }))
    expect(has("[data-e2e=billing-confirming]")).toBe(true)
    expect(has("[data-e2e=billing-checkout]")).toBe(false)
    expect(has("[data-e2e=billing-fine-print]")).toBe(false)
  })

  it("offers a free group that paid before Upgrade to Pro, and its invoices in Stripe", async () => {
    const app = calls()
    await mount(panel({ ...FREE_OWNER, hasCustomer: true }, app.props))
    expect(find("[data-e2e=billing-checkout]").textContent).toBe("Upgrade to Pro (opens Stripe)")
    expect(has("[data-e2e=billing-trial-used]")).toBe(false)
    expect(has("[data-e2e=billing-row-card]")).toBe(false)
    expect(has("[data-e2e=billing-row-cancel]")).toBe(false)
    await click("[data-e2e=billing-portal-invoices]")
    expect(app.portals).toBe(1)
    expect(app.checkouts).toEqual([])
  })

  it("tells a trialing owner when the trial ends and what the group pays then, and cancels in Stripe", async () => {
    const app = calls()
    await mount(panel(TRIAL_OWNER, app.props))
    expect(find("[data-e2e=billing-status]").textContent).toBe("· Trial")
    expect(find("[data-e2e=billing-trial]").textContent).toBe(
      "The trial ends in 10 days, on 31 October 2026. After that, Team pays €54.00 a month unless you cancel.",
    )
    expect(has("[data-e2e=billing-checkout]")).toBe(false)
    expect(find("[data-e2e=billing-row-cancel]").textContent).toContain(
      "You won't be charged if you cancel before 31 October 2026.",
    )
    await click("[data-e2e=billing-portal-cancel]")
    expect(app.portals).toBe(1)
  })

  it("shows a paying owner the monthly total, the renewal date and a Stripe row for each change", async () => {
    const app = calls()
    await mount(panel(PRO_OWNER, app.props))
    expect(find("[data-e2e=billing-plan-name]").textContent).toBe("Pro")
    expect(find("[data-e2e=billing-status]").textContent).toBe("· Renews on 4 November 2026")
    expect(find("[data-e2e=billing-seats]").textContent).toBe(
      "€54.00 a month, for 6 members at €9.00 each, the owner included.",
    )
    for (
      const [row, button] of [["card", "Change card"], ["invoices", "View invoices"], [
        "cancel",
        "Cancel plan",
      ]]
    ) {
      expect(find(`[data-e2e=billing-portal-${row}]`).textContent).toBe(`${button} (opens Stripe)`)
      await click(`[data-e2e=billing-portal-${row}]`)
    }
    expect(app.portals).toBe(3)
    expect(has("[data-e2e=billing-checkout]")).toBe(false)
  })

  it("tells the owner of a cancelled plan when Pro ends and renews it in Stripe, with no Cancel plan", async () => {
    const app = calls()
    await mount(panel(ENDING_OWNER, app.props))
    expect(find("[data-e2e=billing-status]").textContent).toBe("· Ends on 4 November 2026")
    expect(find("[data-e2e=billing-ending]").textContent).toBe(
      "Pro ends on 4 November 2026. Then the group moves to the free plan.",
    )
    expect(has("[data-e2e=billing-row-cancel]")).toBe(false)
    await click("[data-e2e=billing-renew]")
    expect(app.portals).toBe(1)
  })

  it("warns the owner of a past-due group to change the card, and changes it in Stripe", async () => {
    const app = calls()
    await mount(panel(PAST_DUE_OWNER, app.props))
    expect(find("[data-e2e=billing-status]").textContent).toBe("· Payment failed")
    expect(find("[data-e2e=billing-notice]").textContent).toBe(
      "A payment failed. To keep Pro, update your card with Change card within 7 days, by 28 October 2026.",
    )
    // Cancelling is still in Stripe's page, but the tab offers no row that says Pro is kept.
    expect(has("[data-e2e=billing-row-cancel]")).toBe(false)
    await click("[data-e2e=billing-portal-card]")
    expect(app.portals).toBe(1)
    await mount(
      panel(
        {
          ...PAST_DUE_OWNER,
          planId: FREE_PLAN_ID,
          notice: { ...PAST_DUE_OWNER.notice!, daysLeft: 0 },
        },
        app.props,
      ),
    )
    expect(text()).toContain(
      "A payment failed, so the group moved to the free plan. Update your card with Change card to get Pro back.",
    )
    // The group still has its subscription, so a second checkout is never offered.
    expect(has("[data-e2e=billing-checkout]")).toBe(false)
  })

  it("shows a member who is not the owner the plan and who can change it, with no status and not one button", async () => {
    for (const billing of [FREE_OWNER, TRIAL_OWNER, PRO_OWNER, ENDING_OWNER, PAST_DUE_OWNER]) {
      const app = calls()
      await mount(panel(asMember(billing), app.props))
      expect(find("[data-e2e=billing-owner-only]").textContent).toBe(
        "Only Maya Chen, the group's owner, can change its plan or see invoices.",
      )
      expect(root!.querySelectorAll("button, a[href], form").length).toBe(0)
      expect(has("[data-e2e=billing-notice]")).toBe(false)
      expect(has("[data-e2e=billing-status]")).toBe(false)
      await act(() => render(null, root!))
    }
  })

  it("says every group is on the free plan while billing is off, with no button", async () => {
    await mount(panel({ ...FREE_OWNER, enabled: false, canManage: false }))
    expect(find("[data-e2e=billing-off]").textContent).toBe("Every group is on the free plan.")
    expect(root!.querySelectorAll("button, a[href]").length).toBe(0)
  })

  it("says Stripe is confirming the plan only while the owner is back from checkout and the group is still free", async () => {
    await mount(panel(FREE_OWNER, { confirming: true }))
    expect(find("[data-e2e=billing-confirming]").textContent).toBe(
      "Stripe is confirming your plan. This page will update on its own.",
    )
    await rerender(panel(PRO_OWNER, { confirming: true }))
    expect(has("[data-e2e=billing-confirming]")).toBe(false)
    await rerender(panel(FREE_OWNER))
    expect(has("[data-e2e=billing-confirming]")).toBe(false)
  })

  it("opens nothing a second time while Stripe's page is opening", async () => {
    const app = calls()
    await mount(panel(PRO_OWNER, { ...app.props, pending: true }))
    await click("[data-e2e=billing-portal-card]")
    await mount(panel(FREE_OWNER, { ...app.props, pending: true }))
    await click("[data-e2e=billing-checkout]")
    expect(app.portals).toBe(0)
    expect(app.checkouts).toEqual([])
  })

  it("moves focus to the error each time Stripe's page could not be opened", async () => {
    const error = "Could not open Stripe's billing page. Check your connection and try again."
    await mount(panel(PRO_OWNER, { error, errorId: 1 }))
    find<HTMLButtonElement>("[data-e2e=billing-portal-card]").focus()
    await rerender(panel(PRO_OWNER, { error, errorId: 2 }))
    expect(document.activeElement?.getAttribute("data-e2e")).toBe("billing-error")
    expect(find("[data-e2e=billing-error]").textContent).toContain(error)
  })

  it("says it is loading the plan, then why it could not be read", async () => {
    await mount(panel(null))
    expect(find("[role=status]").getAttribute("aria-label")).toBe("Loading the plan")
    await rerender(panel(null, { error: "The plan could not be read." }))
    expect(text()).toContain("The plan could not be read.")
    expect(has("[data-e2e=billing-plan]")).toBe(false)
  })

  it("shows no English outside the catalogs in any state: an en-XA render of each, the seat price and the plan refusals is all pseudo-language or data", async () => {
    const off = { ...FREE_OWNER, enabled: false }
    const used = { enabled: true, used: true, groupId: OTHER_GROUP_ID, days: 14 }
    await mount(
      <I18nContext.Provider value={PSEUDO}>
        {panel(FREE_OWNER, { trial: used, error: BILLING_MESSAGES.portalUnreachable })}
        {panel(FREE_OWNER, { confirming: true })}
        {panel(TRIAL_OWNER)}
        {panel(PRO_OWNER)}
        {panel(FREE_OWNER, { plan: YEARLY_PRO, period: BillingPeriod.Yearly })}
        {panel(YEARLY_OWNER, { plan: YEARLY_PRO })}
        {panel({ ...YEARLY_OWNER, ...TRIAL_STATE }, { plan: YEARLY_PRO })}
        {panel(PRO_OWNER, { plan: YEARLY_PRO })}
        {panel(ENDING_OWNER)}
        {panel(PAST_DUE_OWNER)}
        {panel(asMember(PRO_OWNER))}
        {panel(asMember(PRO_OWNER), { ownerName: null })}
        {panel(off)}
        {panel(null)}
        {panel(FREE_OWNER, { plan: { ...FLAT_PRO, refundDays: 30 }, plans: PAID_FROM_SIGN_UP })}
        {panel(FREE_OWNER, { plan: FLAT_PRO, period: BillingPeriod.Yearly })}
        <SeatPriceConfirm
          seatPrice={{ seats: 6, amount: 900, currency: "EUR", period: BillingPeriod.Monthly }}
          checked={false}
        />
        <SeatPriceConfirm
          seatPrice={{ seats: 6, amount: 4000, currency: "EUR", period: BillingPeriod.Yearly }}
          checked={false}
        />
        {(["maxNotes", "maxMembers", "maxAttachments", "storageBytes", "memberRoles"] as const).map(
          (entitlement) => (
            <PlanRefusalNotice
              key={entitlement}
              groupId={GROUP_ID}
              groupName="Team"
              refusal={{ code: "PLAN_LIMIT_REACHED", entitlement, limit: 10, canUpgrade: false }}
            />
          ),
        )}
        <PlanRefusalNotice
          groupId={GROUP_ID}
          refusal={{
            code: "PLAN_LIMIT_REACHED",
            entitlement: "maxNotes",
            limit: 0,
            canUpgrade: true,
          }}
        />
        <PlanRefusalNotice
          groupId={GROUP_ID}
          refusal={{
            code: "PLAN_LIMIT_REACHED",
            entitlement: "maxNotes",
            limit: 1,
            canUpgrade: true,
          }}
        />
      </I18nContext.Provider>,
    )

    // Data: the group's and the owner's names, money and dates.
    expect(englishLeft(document.body, ["Team", "Maya Chen", "October", "November"])).toEqual([])
    // The render reached every state: each one's pseudo-text is on the page.
    const page = document.body.textContent ?? ""
    for (
      const key of [
        "GroupBillingPanel.trialUsed",
        "GroupBillingPanel.portalUnreachable",
        "GroupBillingPanel.confirming",
        "GroupBillingPanel.statusTrial",
        "GroupBillingPanel.statusPaymentFailed",
        "GroupBillingPanel.ownerOnlyUnknown",
        "GroupBillingPanel.off",
        "SeatPriceConfirm.accept",
        "GroupBillingPanel.yearly",
        "GroupBillingPanel.periodHint",
        "GroupBillingPanel.switchMonthly",
        "GroupBillingPanel.switchYearly",
        "PlanRefusalNotice.rolesText",
        "PlanRefusalNotice.notesTitleUnnamed",
        "PlanRefusalNotice.askOwner",
        "PlanRefusalNotice.noPlanTitleUnnamed",
        "GroupBillingPanel.continueToPayment",
        "GroupBillingPanel.unitMonth",
        "GroupBillingPanel.joinInstead",
      ]
    ) {
      expect(page).toContain(PSEUDO.t(key))
    }
  })
})
