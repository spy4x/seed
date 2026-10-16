/**
 * The plan section of a group's settings and the pricing page: what the server renders (a working
 * form for every action, without JavaScript) and what a person does once the page runs, in a
 * happy-dom page. Kept beside the screens rather than in `screens.test.tsx`, so billing stays in its
 * own files.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import { renderToString } from "preact-render-to-string"
import {
  billingCheckoutRequestSchema,
  BillingNoticeKind,
  BillingStatus,
  FREE_PLAN_ID,
  type GroupBilling,
  PAID_PLANS,
  PRO_PLAN_ID,
} from "@domain/billing"
import { BILLING_PATHS, BillingCard, PricingScreen } from "./billing-screen.tsx"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

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
}

const PRO_OWNER: GroupBilling = {
  ...FREE_OWNER,
  planId: PRO_PLAN_ID,
  status: BillingStatus.Active,
  currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
  subscribed: true,
  hasCustomer: true,
}

interface RenderedForm {
  action: string | undefined
  method: string | undefined
  fields: string[]
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

/** Every form the server renders: where it posts and the names of the fields it sends. */
function forms(node: VNode): RenderedForm[] {
  const html = renderToString(node)
  return [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(([, attrs, body]) => ({
    action: attribute(` ${attrs}`, "action"),
    method: attribute(` ${attrs}`, "method"),
    fields: [...body.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
      .map(([tag]) => attribute(tag, "name"))
      .filter((name): name is string => name !== undefined)
      .sort(),
  }))
}

describe("billing screens without JavaScript", () => {
  it("gives the owner of a free group a link to the plans and no form", () => {
    const html = renderToString(<BillingCard groupId={groupId} billing={FREE_OWNER} />)

    expect(html).toContain(`href="${BILLING_PATHS.pricing(groupId)}"`)
    expect(forms(<BillingCard groupId={groupId} billing={FREE_OWNER} />)).toEqual([])
  })

  it("gives the owner of a paying group a form that posts to the portal", () => {
    expect(forms(<BillingCard groupId={groupId} billing={PRO_OWNER} />)).toEqual([
      { action: BILLING_PATHS.portal(groupId), method: "post", fields: [] },
    ])
  })

  it("gives the owner the portal, and no upgrade, while a subscription that shows as free is live", () => {
    const incomplete = {
      ...FREE_OWNER,
      status: BillingStatus.Incomplete,
      subscribed: true,
      hasCustomer: true,
    }
    const html = renderToString(<BillingCard groupId={groupId} billing={incomplete} />)

    expect(forms(<BillingCard groupId={groupId} billing={incomplete} />)).toEqual([
      { action: BILLING_PATHS.portal(groupId), method: "post", fields: [] },
    ])
    expect(html).not.toContain(BILLING_PATHS.pricing(groupId))
  })

  it("gives the owner of a group whose subscription ended both the plans and the portal", () => {
    const lapsed = { ...FREE_OWNER, status: BillingStatus.Canceled, hasCustomer: true }
    const html = renderToString(<BillingCard groupId={groupId} billing={lapsed} />)

    expect(html).toContain(`href="${BILLING_PATHS.pricing(groupId)}"`)
    expect(forms(<BillingCard groupId={groupId} billing={lapsed} />)).toEqual([
      { action: BILLING_PATHS.portal(groupId), method: "post", fields: [] },
    ])
  })

  it("shows any other member the plan and no way to change it", () => {
    const member = { ...PRO_OWNER, canManage: false }
    const html = renderToString(<BillingCard groupId={groupId} billing={member} />)

    expect(html).toContain(`data-e2e="billing-owner-only"`)
    expect(html).not.toContain(BILLING_PATHS.pricing(groupId))
    expect(forms(<BillingCard groupId={groupId} billing={member} />)).toEqual([])
  })

  it("shows a trial's end on the plan, and the owner how many days are left", () => {
    const trialEnd = new Date("2026-10-15T10:00:00Z")
    const trial = {
      ...PRO_OWNER,
      status: BillingStatus.Trialing,
      trialEnd,
      currentPeriodEnd: new Date("2026-11-15T10:00:00Z"),
      notice: { kind: BillingNoticeKind.TrialEnding, at: trialEnd, daysLeft: 2 },
    }
    const html = renderToString(<BillingCard groupId={groupId} billing={trial} />)

    expect(html).toContain("Trial ends on October 15, 2026")
    expect(html).toContain(`role="status"`)
    expect(html).toContain("The trial ends in 2 days, on October 15, 2026.")
  })

  it("announces a notice politely as a warning, with its kind for the e2e hooks", () => {
    const at = new Date("2026-10-08T10:00:00Z")
    const failed = {
      ...PRO_OWNER,
      status: BillingStatus.PastDue,
      notice: { kind: BillingNoticeKind.PaymentFailed, at, daysLeft: 3 },
    }
    const html = renderToString(<BillingCard groupId={groupId} billing={failed} />)
    const notice = html.match(/<div[^>]*data-e2e="billing-notice"[^>]*>/)?.[0] ?? ``

    expect(notice).toContain(`role="status"`)
    expect(notice).not.toContain(`role="alert"`)
    expect(notice).toContain(`data-kind="${BillingNoticeKind.PaymentFailed}"`)
    expect(notice).toContain(`border-warning`)
  })

  it("tells the owner when a cancelled plan ends and how to renew it, beside the portal", () => {
    const at = new Date("2026-11-01T00:00:00Z")
    const ending = {
      ...PRO_OWNER,
      cancelAtPeriodEnd: true,
      notice: { kind: BillingNoticeKind.PlanEnding, at, daysLeft: 1 },
    }
    const html = renderToString(<BillingCard groupId={groupId} billing={ending} />)

    expect(html).toContain(
      "The Pro plan was cancelled and ends in 1 day, on November 1, 2026. To keep it, renew it",
    )
    expect(forms(<BillingCard groupId={groupId} billing={ending} />)).toEqual([
      { action: BILLING_PATHS.portal(groupId), method: "post", fields: [] },
    ])
  })

  it("tells the owner of a failed payment until when the plan is kept, and after that how to get it back", () => {
    const at = new Date("2026-10-08T10:00:00Z")
    const failed = (planId: string, daysLeft: number) => ({
      ...PRO_OWNER,
      planId,
      status: BillingStatus.PastDue,
      notice: { kind: BillingNoticeKind.PaymentFailed, at, daysLeft },
    })

    expect(renderToString(<BillingCard groupId={groupId} billing={failed(PRO_PLAN_ID, 6)} />))
      .toContain("within 6 days, by October 8, 2026, to keep the Pro plan.")
    const lapsed = renderToString(
      <BillingCard groupId={groupId} billing={failed(FREE_PLAN_ID, 0)} />,
    )
    expect(lapsed).toContain("so the group is on the free plan.")
    expect(lapsed).toContain("to get the paid plan back.")
    expect(forms(<BillingCard groupId={groupId} billing={failed(FREE_PLAN_ID, 0)} />))
      .toEqual([{ action: BILLING_PATHS.portal(groupId), method: "post", fields: [] }])
  })

  it("shows a group billed per member what it pays: the price times its members", () => {
    const seats = { ...PRO_OWNER, seatPrice: { seats: 3, amount: 900, currency: "EUR" } }
    const html = renderToString(<BillingCard groupId={groupId} billing={seats} />)

    expect(html).toContain("€27.00")
    expect(html).toContain("3 members at €9.00 each a month, the owner included.")
  })

  it("shows no notice when there is none", () => {
    expect(renderToString(<BillingCard groupId={groupId} billing={PRO_OWNER} />))
      .not.toContain(`data-e2e="billing-notice"`)
  })

  it("shows only the plan while billing is off: no upgrade, and no word about who could change it", () => {
    const off = { ...FREE_OWNER, enabled: false, canManage: false }
    const html = renderToString(<BillingCard groupId={groupId} billing={off} />)

    expect(html).toContain(`data-plan="free"`)
    expect(html).not.toContain(BILLING_PATHS.pricing(groupId))
    expect(html).not.toContain(`data-e2e="billing-owner-only"`)
  })

  it("posts each paid plan to the checkout with the API's field name", () => {
    const rendered = forms(
      <PricingScreen groupId={groupId} groupName="Team" billing={FREE_OWNER} />,
    )
    const keys = billingCheckoutRequestSchema.props.map((prop) => String(prop.key)).sort()

    expect(rendered).toEqual([
      { action: BILLING_PATHS.checkout(groupId), method: "post", fields: keys },
    ])
    expect(
      renderToString(<PricingScreen groupId={groupId} groupName="Team" billing={FREE_OWNER} />),
    )
      .toContain(`value="${PRO_PLAN_ID}"`)
  })

  it("centres a single plan's card in the page column", () => {
    const html = renderToString(
      <PricingScreen groupId={groupId} groupName="Team" billing={FREE_OWNER} />,
    )
    const plans = html.match(/<fieldset [^>]*data-e2e="pricing-plans"[^>]*>/)?.[0] ?? ""

    expect(PAID_PLANS).toHaveLength(1)
    expect(plans).toMatch(/class="[^"]*\bmx-auto\b/)
    expect(plans).toMatch(/class="[^"]*\bmax-w-sm\b/)
  })

  it("labels the per-member plan's price with the unit it is charged per", () => {
    const html = renderToString(
      <PricingScreen groupId={groupId} groupName="Team" billing={FREE_OWNER} />,
    )

    expect(html).toContain("€9.00")
    expect(html).toContain("per member / month")
  })

  it("shows no plan to choose to a member who is not the owner, nor to a group that pays", () => {
    const member = { ...FREE_OWNER, canManage: false }

    expect(forms(<PricingScreen groupId={groupId} groupName="Team" billing={member} />)).toEqual([])
    expect(forms(<PricingScreen groupId={groupId} groupName="Team" billing={PRO_OWNER} />))
      .toEqual([])
  })

  it("shows no plan to choose while a subscription that shows as free is live", () => {
    const paused = { ...FREE_OWNER, status: BillingStatus.Paused, subscribed: true }

    expect(forms(<PricingScreen groupId={groupId} groupName="Team" billing={paused} />)).toEqual([])
  })
})

const window = new Window({ url: "http://app.localhost/" })
const own = { document: globalThis.document, FormData: globalThis.FormData }

let root: HTMLElement | null = null

async function mount(node: VNode): Promise<HTMLElement> {
  root = document.createElement("div")
  document.body.append(root)
  await act(() => render(node, root!))
  return root
}

async function rerender(node: VNode): Promise<void> {
  await act(() => render(node, root!))
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = root?.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

/** Submits the form around `selector`; `true` when nothing cancelled it, so the browser posts. */
async function submit(selector: string): Promise<boolean> {
  const form = find(selector).closest("form")
  if (!form) throw new Error(`${selector} is in no form`)
  let posted = false
  await act(() => {
    const event = new window.Event("submit", { bubbles: true, cancelable: true })
    posted = form.dispatchEvent(event as unknown as Event)
  })
  return posted
}

describe("billing screens in the browser", () => {
  beforeAll(() => {
    Object.assign(globalThis, { document: window.document, FormData: window.FormData })
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

  it("hands the chosen plan to the app's callback instead of posting", async () => {
    const chosen: string[] = []
    await mount(
      <PricingScreen
        groupId={groupId}
        groupName="Team"
        billing={FREE_OWNER}
        onChoose={(planId) => chosen.push(planId)}
      />,
    )

    const posted = await submit(`[data-e2e="pricing-plans"] button`)

    expect(posted).toBe(false)
    expect(chosen).toEqual([PRO_PLAN_ID])
  })

  it("lets the plan's form post itself when the app takes no callback", async () => {
    await mount(<PricingScreen groupId={groupId} groupName="Team" billing={FREE_OWNER} />)

    expect(await submit(`[data-e2e="pricing-plans"] button`)).toBe(true)
  })

  it("disables every plan while a checkout opens, and opens none twice", async () => {
    const chosen: string[] = []
    await mount(
      <PricingScreen
        groupId={groupId}
        groupName="Team"
        billing={FREE_OWNER}
        pending
        onChoose={(planId) => chosen.push(planId)}
      />,
    )

    expect(find<HTMLFieldSetElement>(`[data-e2e="pricing-plans"]`).disabled).toBe(true)
    await submit(`[data-e2e="pricing-plans"] button`)
    expect(chosen).toEqual([])
  })

  it("opens the portal through the app's callback, and only once while it is pending", async () => {
    let opened = 0
    const card = (pending: boolean) => (
      <BillingCard
        groupId={groupId}
        billing={PRO_OWNER}
        pending={pending}
        onManage={() => opened++}
      />
    )
    await mount(card(false))

    expect(await submit(`[data-e2e="group-section-billing"] form button`)).toBe(false)
    await rerender(card(true))
    await submit(`[data-e2e="group-section-billing"] form button`)

    expect(opened).toBe(1)
  })

  it("moves focus to a refused checkout's message", async () => {
    const props = { groupId, groupName: "Team", billing: FREE_OWNER }
    await mount(<PricingScreen {...props} />)

    await rerender(<PricingScreen {...props} error="The payment provider is unavailable." />)

    expect(document.activeElement?.getAttribute("data-e2e")).toBe("pricing-error")
    expect(find(`[data-e2e="pricing-error"]`).textContent).toContain("unavailable")
  })

  it("moves focus to the message again when the same refusal comes back", async () => {
    const props = { groupId, groupName: "Team", billing: FREE_OWNER, error: "Refused." }
    await mount(<PricingScreen {...props} errorId={1} />)
    find<HTMLButtonElement>(`[data-e2e="pricing-plans"] button`).focus()

    await rerender(<PricingScreen {...props} errorId={2} />)

    expect(document.activeElement?.getAttribute("data-e2e")).toBe("pricing-error")
  })

  it("moves focus to the portal's message again when the same refusal comes back", async () => {
    const props = { groupId, billing: PRO_OWNER, error: "Refused." }
    await mount(<BillingCard {...props} errorId={1} />)
    find<HTMLButtonElement>(`[data-e2e="group-section-billing"] form button`).focus()

    await rerender(<BillingCard {...props} errorId={2} />)

    expect(document.activeElement?.getAttribute("data-e2e")).toBe("billing-error")
  })

  it("moves focus to a refused portal's message", async () => {
    await mount(<BillingCard groupId={groupId} billing={PRO_OWNER} />)

    await rerender(<BillingCard groupId={groupId} billing={PRO_OWNER} error="No subscription." />)

    expect(document.activeElement?.getAttribute("data-e2e")).toBe("billing-error")
  })
})
