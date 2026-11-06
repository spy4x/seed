import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { renderToString } from "preact-render-to-string"
import { PRO_PLAN_ID } from "@domain/billing"
import { BillingInterval, PricingTable } from "@spy4x/preact-ui/billing"
import { siteTranslator } from "../languages.ts"
import { demoPlans, demoSavings } from "./pricing-demo-plans.tsx"
import { TEST_PLANS } from "../../../libs/domain/billing/test-plans.ts"

const t = siteTranslator(`en`)

/** The test catalog with Pro sold yearly too, at $40 against $4 a month, as Financy sells it. */
const YEARLY = TEST_PLANS.map((plan) =>
  plan.id === PRO_PLAN_ID ? { ...plan, amount: 400, yearlyAmount: 4000, currency: `USD` } : plan
)

describe("demoPlans", () => {
  it("lists one monthly entry per plan when no plan sells yearly", () => {
    const plans = demoPlans(t, TEST_PLANS)

    expect(plans.map((plan) => [plan.id, plan.interval])).toEqual(
      TEST_PLANS.map((plan) => [plan.id, BillingInterval.Month]),
    )
  })

  it("adds a yearly entry for a plan sold yearly and shows the free plan under both", () => {
    const plans = demoPlans(t, YEARLY)

    expect(plans.map((plan) => [plan.id, plan.interval, plan.amount])).toEqual([
      [`free`, undefined, 0],
      [PRO_PLAN_ID, BillingInterval.Month, 400],
      [`${PRO_PLAN_ID}-yearly`, BillingInterval.Year, 4000],
    ])
  })

  it("turns on the table's own Monthly/Yearly toggle, monthly first", () => {
    const html = renderToString(<PricingTable plans={demoPlans(t, YEARLY)} />)

    expect(html).toContain(`data-pricing-interval="month"`)
    expect(html).toContain(`data-pricing-interval="year"`)
    expect(html.indexOf(`data-pricing-interval="month"`)).toBeLessThan(
      html.indexOf(`data-pricing-interval="year"`),
    )
  })
})

describe("demoSavings", () => {
  it("gives both prices and the saving for a plan sold yearly", () => {
    expect(demoSavings(t, YEARLY)).toEqual([
      `Pro costs $4.00 a month or $40.00 a year: $8.00 less than paying monthly.`,
    ])
  })

  it("says nothing when no plan sells yearly or the year saves nothing", () => {
    const even = YEARLY.map((plan) =>
      plan.id === PRO_PLAN_ID ? { ...plan, yearlyAmount: 4800 } : plan
    )

    expect(demoSavings(t, TEST_PLANS)).toEqual([])
    expect(demoSavings(t, even)).toEqual([])
  })
})
