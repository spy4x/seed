import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { BillingPeriod, BillingStatus, type GroupBilling, PRO_PLAN_ID } from "@domain/billing"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import { createFormatters } from "@spy4x/time/format"
import app from "@i18n/app/en.ts"
import { checkoutDoneToast, periodFromSearch } from "./BillingViews.tsx"
import { TEST_PLANS } from "../../../../libs/domain/billing/test-plans.ts"

const t = createTranslator({ language: "en", catalogs: [{ source: app }] })
const format = createFormatters({ locale: "en-US", timeZone: "Asia/Tokyo" })

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
  period: null,
}

describe("checkoutDoneToast", () => {
  it("names the trial and its end after a trial start, and says nothing of a payment", () => {
    const trial = {
      ...PRO,
      status: BillingStatus.Trialing,
      trialEnd: new Date("2026-11-04T00:00:00Z"),
    }
    expect(checkoutDoneToast(t, format, trial, "Team", TEST_PLANS)).toEqual({
      title: "Your 14-day Pro trial has started",
      body: `“\u2068Team\u2069” is on Pro until November 4, 2026.`,
    })
  })

  it("says You're on Pro after a paid start", () => {
    expect(checkoutDoneToast(t, format, PRO, "Team")).toEqual({
      title: "You’re on Pro",
      body: `Stripe confirmed the payment for “\u2068Team\u2069”.`,
    })
  })
})

describe("periodFromSearch", () => {
  it("reads the year from ?period=year and the month from anything else", () => {
    expect(periodFromSearch("period=year")).toBe(BillingPeriod.Yearly)
    expect(periodFromSearch("?checkout=done&period=year")).toBe(BillingPeriod.Yearly)
    expect(periodFromSearch("")).toBe(BillingPeriod.Monthly)
    expect(periodFromSearch("period=decade")).toBe(BillingPeriod.Monthly)
  })
})
