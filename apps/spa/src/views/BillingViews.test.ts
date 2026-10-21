import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { BillingStatus, type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { checkoutDoneToast } from "./BillingViews.tsx"

const PRO: GroupBilling = {
  enabled: true,
  planId: PRO_PLAN_ID,
  status: BillingStatus.Active,
  currentPeriodEnd: new Date("2026-11-04T00:00:00Z"),
  cancelAtPeriodEnd: false,
  trialEnd: null,
  notice: null,
  canManage: true,
  subscribed: true,
  hasCustomer: true,
  seatPrice: null,
}

describe("checkoutDoneToast", () => {
  it("names the trial and its end after a trial start, and says nothing of a payment", () => {
    const trial = {
      ...PRO,
      status: BillingStatus.Trialing,
      trialEnd: new Date("2026-11-04T00:00:00Z"),
    }
    expect(checkoutDoneToast(trial, "Team")).toEqual({
      title: "Your 14-day Pro trial has started",
      body: `"Team" is on Pro until November 4, 2026.`,
    })
  })

  it("says You're on Pro after a paid start", () => {
    expect(checkoutDoneToast(PRO, "Team")).toEqual({
      title: "You're on Pro",
      body: `Stripe confirmed the payment for "Team".`,
    })
  })
})
