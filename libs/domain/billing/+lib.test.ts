import { expect } from "@std/expect"
import { ONE_DAY_IN_MILLISECONDS as DAY } from "@spy4x/platform/universal/time-constants"
import { describe, it } from "@std/testing/bdd"
import { SubscriptionStatus } from "@spy4x/billing"
import { GroupRole } from "@domain/groups"
import {
  assertCanManageBilling,
  assertFeature,
  assertRoomFor,
  attachmentRulesOf,
  BillingError,
  BillingNoticeKind,
  billingNoticeOf,
  BillingStatus,
  DEFAULT_GRACE_DAYS,
  effectivePlanId,
  entitlementsOf,
  FREE_PLAN_ID,
  graceEndsAt,
  handoverTrialDays,
  hasLiveSubscription,
  isSeatBilled,
  PlanError,
  PLANS,
  PRO_PLAN_ID,
  providerPageUrl,
  readGroupBilling,
  readPlanRefusal,
  type StoredSubscription,
  toGroupBilling,
  toPlanRefusal,
  TRIAL_NOTICE_DAYS,
  UNLIMITED,
} from "./+lib.ts"

/** When the first payment failed in the tests below. */
const FAILED_AT = new Date("2026-10-01T10:00:00Z")
const NOW = new Date("2026-10-02T10:00:00Z")

const subscription = (status: BillingStatus, planId: string | null = PRO_PLAN_ID) =>
  ({
    groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002",
    providerSubscriptionId: "sub_1",
    planId,
    status,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pastDueSince: status === BillingStatus.PastDue ? FAILED_AT : null,
    trialEnd: null,
    quantity: 1,
    everActive: status !== BillingStatus.Trialing,
  }) satisfies StoredSubscription

/** When the trial and the period end in the tests of trials and cancellations. */
const ENDS_AT = new Date("2026-10-15T10:00:00Z")
const at = (ms: number) => new Date(ENDS_AT.getTime() + ms)
const trial = (changes: Partial<StoredSubscription> = {}): StoredSubscription => ({
  ...subscription(BillingStatus.Trialing),
  trialEnd: ENDS_AT,
  currentPeriodEnd: ENDS_AT,
  ...changes,
})
const cancelled = (changes: Partial<StoredSubscription> = {}): StoredSubscription => ({
  ...subscription(BillingStatus.Active),
  currentPeriodEnd: ENDS_AT,
  cancelAtPeriodEnd: true,
  ...changes,
})

/** The plan of a subscription past due since {@link FAILED_AT}, `elapsed` ms later. */
const planAfter = (elapsed: number, graceDays = DEFAULT_GRACE_DAYS) =>
  effectivePlanId(
    subscription(BillingStatus.PastDue),
    new Date(FAILED_AT.getTime() + elapsed),
    graceDays,
  )

describe("billing domain", () => {
  it("numbers its statuses exactly as @spy4x/billing does", () => {
    const ours = Object.entries(BillingStatus).filter(([, value]) => typeof value === "number")
    const theirs = Object.entries(SubscriptionStatus).filter(([, value]) =>
      typeof value === "number"
    )
    expect(ours).toEqual(theirs)
  })

  it("keeps the paid plan while the subscription is trialing or active, however long", () => {
    const years = new Date(FAILED_AT.getTime() + 3 * 365 * DAY)
    for (const status of [BillingStatus.Trialing, BillingStatus.Active]) {
      expect(effectivePlanId(subscription(status), years, DEFAULT_GRACE_DAYS)).toBe(PRO_PLAN_ID)
    }
  })

  it("keeps the paid plan for seven days after the first failed payment, then gives the free plan", () => {
    expect(DEFAULT_GRACE_DAYS).toBe(7)
    expect(planAfter(0)).toBe(PRO_PLAN_ID)
    expect(planAfter(7 * DAY - 1)).toBe(PRO_PLAN_ID)
    expect(planAfter(7 * DAY)).toBe(FREE_PLAN_ID)
    expect(planAfter(30 * DAY)).toBe(FREE_PLAN_ID)
  })

  it("counts the grace period in the configured number of days", () => {
    expect(planAfter(3 * DAY - 1, 3)).toBe(PRO_PLAN_ID)
    expect(planAfter(3 * DAY, 3)).toBe(FREE_PLAN_ID)
    expect(planAfter(0, 0)).toBe(FREE_PLAN_ID)
  })

  it("gives no grace to a past-due subscription with no recorded start", () => {
    const unmarked = { ...subscription(BillingStatus.PastDue), pastDueSince: null }

    expect(effectivePlanId(unmarked, FAILED_AT, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
  })

  it("gives no grace to a trial whose first charge failed: it is free from the failure on", () => {
    const failedTrial = { ...subscription(BillingStatus.PastDue), everActive: false }

    expect(graceEndsAt(failedTrial, DEFAULT_GRACE_DAYS)).toEqual(FAILED_AT)
    expect(effectivePlanId(failedTrial, FAILED_AT, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
    expect(billingNoticeOf(failedTrial, FAILED_AT, DEFAULT_GRACE_DAYS))
      .toEqual({ kind: BillingNoticeKind.PaymentFailed, at: FAILED_AT, daysLeft: 0 })
  })

  it("ends the grace period the configured number of days after it began, only when past due", () => {
    expect(graceEndsAt(subscription(BillingStatus.PastDue), 7))
      .toEqual(new Date("2026-10-08T10:00:00Z"))
    expect(graceEndsAt(subscription(BillingStatus.Active), 7)).toBeNull()
  })

  it("falls back to the free plan once the subscription ends, stalls or bills an unknown price", () => {
    for (const status of [BillingStatus.Canceled, BillingStatus.Incomplete, BillingStatus.Paused]) {
      expect(effectivePlanId(subscription(status), NOW, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
    }
    expect(effectivePlanId(subscription(BillingStatus.Active, null), NOW, DEFAULT_GRACE_DAYS))
      .toBe(FREE_PLAN_ID)
    expect(effectivePlanId(subscription(BillingStatus.Active, "retired"), NOW, DEFAULT_GRACE_DAYS))
      .toBe(FREE_PLAN_ID)
    expect(effectivePlanId(null, NOW, DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
  })

  it("shows a past-due group's plan as free once its grace period is over", () => {
    const later = new Date(FAILED_AT.getTime() + 8 * DAY)
    const billing = (now: Date) =>
      toGroupBilling(subscription(BillingStatus.PastDue), GroupRole.OWNER, true, true, now, 7, 3)

    expect(billing(NOW)).toMatchObject({ planId: PRO_PLAN_ID, status: BillingStatus.PastDue })
    expect(billing(later)).toMatchObject({ planId: FREE_PLAN_ID, status: BillingStatus.PastDue })
  })

  it("shows the free plan and no way to manage it while billing is off, whatever is stored", () => {
    expect(
      toGroupBilling(subscription(BillingStatus.Active), GroupRole.OWNER, false, true, NOW, 7, 3),
    )
      .toEqual({
        enabled: false,
        planId: FREE_PLAN_ID,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        notice: null,
        canManage: false,
        subscribed: false,
        hasCustomer: false,
        seatPrice: null,
      })
  })

  it("keeps a trial's plan until the trial ends, then gives the free plan", () => {
    expect(effectivePlanId(trial(), at(-1), DEFAULT_GRACE_DAYS)).toBe(PRO_PLAN_ID)
    expect(effectivePlanId(trial(), at(0), DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
    // Once the trial has turned into a paid subscription, its old end no longer counts.
    expect(effectivePlanId(trial({ status: BillingStatus.Active }), at(DAY), DEFAULT_GRACE_DAYS))
      .toBe(PRO_PLAN_ID)
  })

  it("keeps a cancelled plan until its period ends, and for good once the cancellation is undone", () => {
    expect(effectivePlanId(cancelled(), at(-1), DEFAULT_GRACE_DAYS)).toBe(PRO_PLAN_ID)
    expect(effectivePlanId(cancelled(), at(0), DEFAULT_GRACE_DAYS)).toBe(FREE_PLAN_ID)
    expect(effectivePlanId(cancelled({ cancelAtPeriodEnd: false }), at(0), DEFAULT_GRACE_DAYS))
      .toBe(PRO_PLAN_ID)
  })

  it("carries the old owner's remaining plan time over to the new owner's trial, in whole days rounded up", () => {
    expect(handoverTrialDays(cancelled(), at(-20 * DAY), 7)).toBe(20)
    expect(handoverTrialDays(cancelled(), at(-20 * DAY + 1), 7)).toBe(20)
    expect(handoverTrialDays(cancelled(), at(-1), 7)).toBe(1)
    // A trial cancelled at its end carries over only the trial.
    expect(handoverTrialDays(trial({ cancelAtPeriodEnd: true }), at(-2 * DAY), 7)).toBe(2)
  })

  it("carries over nothing once the plan has ended, or while the old subscription still renews", () => {
    expect(handoverTrialDays(cancelled(), at(0), 7)).toBeNull()
    expect(handoverTrialDays(cancelled({ status: BillingStatus.Canceled }), at(-DAY), 7))
      .toBeNull()
    expect(handoverTrialDays(cancelled({ cancelAtPeriodEnd: false }), at(-DAY), 7)).toBeNull()
    // A trial that converts at its end charges the card then: it renews, though it has an end.
    expect(handoverTrialDays(trial(), at(-2 * DAY), 7)).toBeNull()
    expect(handoverTrialDays(null, at(-DAY), 7)).toBeNull()
  })

  it("carries over a past-due plan only until its grace ends, not to the period's end", () => {
    const pastDue = cancelled({ status: BillingStatus.PastDue, pastDueSince: FAILED_AT })

    // Past due since October 1, so the seven-day grace ends October 8, before the period ends.
    expect(handoverTrialDays(pastDue, NOW, 7)).toBe(6)
    expect(handoverTrialDays(pastDue, new Date(FAILED_AT.getTime() + 7 * DAY), 7)).toBeNull()
  })

  it("tells of a trial's end only in its last three days, counting the days left", () => {
    expect(TRIAL_NOTICE_DAYS).toBe(3)
    expect(billingNoticeOf(trial(), at(-3 * DAY - 1), 7)).toBeNull()
    expect(billingNoticeOf(trial(), at(-3 * DAY), 7))
      .toEqual({ kind: BillingNoticeKind.TrialEnding, at: ENDS_AT, daysLeft: 3 })
    expect(billingNoticeOf(trial(), at(-DAY - 1), 7)?.daysLeft).toBe(2)
    expect(billingNoticeOf(trial(), at(0), 7)).toBeNull()
  })

  it("tells of a cancelled plan's end until then, and of nothing once the cancellation is undone", () => {
    expect(billingNoticeOf(cancelled(), at(-20 * DAY), 7))
      .toEqual({ kind: BillingNoticeKind.PlanEnding, at: ENDS_AT, daysLeft: 20 })
    expect(billingNoticeOf(trial({ cancelAtPeriodEnd: true }), at(-10 * DAY), 7)?.kind)
      .toBe(BillingNoticeKind.PlanEnding)
    expect(billingNoticeOf(cancelled(), at(0), 7)).toBeNull()
    expect(billingNoticeOf(cancelled({ cancelAtPeriodEnd: false }), at(-DAY), 7)).toBeNull()
  })

  it("tells of a failed payment first, with the end of its grace period", () => {
    const failed = { ...cancelled(), status: BillingStatus.PastDue, pastDueSince: FAILED_AT }

    expect(billingNoticeOf(failed, NOW, 7)).toEqual({
      kind: BillingNoticeKind.PaymentFailed,
      at: new Date("2026-10-08T10:00:00Z"),
      daysLeft: 6,
    })
    expect(billingNoticeOf(failed, new Date("2026-10-09T10:00:00Z"), 7)?.daysLeft).toBe(0)
  })

  it("tells of nothing for a plain paid, ended or missing subscription", () => {
    for (const status of [BillingStatus.Active, BillingStatus.Canceled, BillingStatus.Paused]) {
      expect(billingNoticeOf(subscription(status), NOW, 7)).toBeNull()
    }
    expect(billingNoticeOf(null, NOW, 7)).toBeNull()
  })

  it("shows the notice to the owner only, with the trial's end", () => {
    const view = (role: GroupRole) =>
      toGroupBilling(trial(), role, true, true, at(-DAY), DEFAULT_GRACE_DAYS, 3)

    expect(view(GroupRole.OWNER)).toMatchObject({
      trialEnd: ENDS_AT,
      notice: { kind: BillingNoticeKind.TrialEnding, at: ENDS_AT, daysLeft: 1 },
    })
    expect(view(GroupRole.ADMIN)).toMatchObject({ trialEnd: ENDS_AT, notice: null })
  })

  it("reads the billing back from the API's JSON, dates included", () => {
    const view = toGroupBilling(trial(), GroupRole.OWNER, true, true, at(-DAY), 7, 3)
    const json = JSON.parse(JSON.stringify(view))

    expect(readGroupBilling(json)).toEqual(view)
  })

  it("reads no billing from JSON with a field missing or of the wrong kind", () => {
    const view = toGroupBilling(trial(), GroupRole.OWNER, true, true, at(-DAY), 7, 3)
    const json = JSON.parse(JSON.stringify(view))
    const broken = [
      { ...json, trialEnd: 5 },
      { ...json, currentPeriodEnd: "not a date" },
      { ...json, status: 9 },
      { ...json, notice: { ...json.notice, kind: 9 } },
      { ...json, notice: { ...json.notice, daysLeft: -1 } },
      { ...json, notice: undefined },
      { ...json, canManage: "yes" },
      { ...json, seatPrice: { seats: 1.5, amount: 900, currency: "EUR" } },
      { ...json, seatPrice: undefined },
      null,
    ]
    for (const value of broken) {
      expect({ value, read: readGroupBilling(value) }).toEqual({ value, read: null })
    }
  })

  it("bills the paid plan per member and the free plan not", () => {
    expect(PLANS.map((plan) => [plan.id, plan.perSeat])).toEqual([
      [FREE_PLAN_ID, false],
      [PRO_PLAN_ID, true],
    ])
  })

  it("bills per member only a live subscription to a per-member plan", () => {
    expect(isSeatBilled(subscription(BillingStatus.Active))).toBe(true)
    // The provider still charges a past-due subscription, so its seats still follow the members.
    expect(isSeatBilled(subscription(BillingStatus.PastDue))).toBe(true)
    expect(isSeatBilled(subscription(BillingStatus.Canceled))).toBe(false)
    expect(isSeatBilled(subscription(BillingStatus.Active, FREE_PLAN_ID))).toBe(false)
    expect(isSeatBilled(subscription(BillingStatus.Active, null))).toBe(false)
    expect(isSeatBilled(null)).toBe(false)
  })

  it("shows every member the per-member price and the seats of a group billed per member", () => {
    const view = (stored: StoredSubscription | null, enabled = true) =>
      toGroupBilling(stored, GroupRole.VIEWER, enabled, true, NOW, 7, 4).seatPrice

    expect(view(subscription(BillingStatus.Active))).toEqual({
      seats: 4,
      amount: 900,
      currency: "EUR",
    })
    expect(view(subscription(BillingStatus.Canceled))).toBeNull()
    expect(view(null)).toBeNull()
    expect(view(subscription(BillingStatus.Active), false)).toBeNull()
  })

  it("offers a trial on the paid plan only", () => {
    expect(PLANS.map((plan) => [plan.id, plan.trialDays])).toEqual([
      [FREE_PLAN_ID, 0],
      [PRO_PLAN_ID, 14],
    ])
  })

  it("counts every subscription that is not cancelled as live, whatever plan it shows", () => {
    for (
      const status of [
        BillingStatus.Trialing,
        BillingStatus.Active,
        BillingStatus.PastDue,
        BillingStatus.Incomplete,
        BillingStatus.Paused,
      ]
    ) {
      expect(hasLiveSubscription(subscription(status))).toBe(true)
    }
    expect(hasLiveSubscription(subscription(BillingStatus.Active, null))).toBe(true)
    expect(hasLiveSubscription(subscription(BillingStatus.Canceled))).toBe(false)
    expect(hasLiveSubscription(null)).toBe(false)
  })

  it("opens only http and https provider pages", () => {
    expect(providerPageUrl("https://checkout.stripe.com/c/pay/cs_1")).toBe(
      "https://checkout.stripe.com/c/pay/cs_1",
    )
    expect(providerPageUrl("http://localhost:8000/fake")).toBe("http://localhost:8000/fake")
    for (const url of ["javascript:alert(1)", "data:text/html,x", "/relative", "", 42, null]) {
      expect(providerPageUrl(url)).toBeNull()
    }
  })

  it("lets only the owner manage billing, and tells a stranger the group does not exist", () => {
    expect(() => assertCanManageBilling(GroupRole.OWNER)).not.toThrow()
    for (const role of [GroupRole.ADMIN, GroupRole.EDITOR, GroupRole.VIEWER]) {
      expect(() => assertCanManageBilling(role)).toThrow(
        new BillingError("ROLE_INSUFFICIENT", "Only the owner can manage the group's billing"),
      )
    }
    expect(() => assertCanManageBilling(null)).toThrow(
      new BillingError("GROUP_NOT_FOUND", "Group not found"),
    )
  })

  it("gives a group its plan's entitlements, the free plan's for an unknown id", () => {
    expect(entitlementsOf(PRO_PLAN_ID, true).features.memberRoles).toBe(true)
    expect(entitlementsOf(FREE_PLAN_ID, true).features.memberRoles).toBe(false)
    expect(entitlementsOf(FREE_PLAN_ID, true).limits.maxNotes).toBe(10)
    expect(entitlementsOf("gone", true)).toEqual(entitlementsOf(FREE_PLAN_ID, true))
  })

  it("allows every feature with no cap while billing is off", () => {
    const unlimited = entitlementsOf(FREE_PLAN_ID, false)
    expect(unlimited).toBe(UNLIMITED)
    expect(Object.values(unlimited.features).every((on) => on === true)).toBe(true)
    expect(Object.values(unlimited.limits).every((max) => max === null)).toBe(true)
    // Every key a plan has is on the list, so a key added to the plans but not here fails.
    expect(Object.keys(unlimited.features)).toEqual(Object.keys(PLANS[0].entitlements.features))
    expect(Object.keys(unlimited.limits).sort())
      .toEqual(Object.keys(PLANS[0].entitlements.limits).sort())
  })

  it("refuses a feature the plan lacks, and tells only the owner they can upgrade", () => {
    const free = entitlementsOf(FREE_PLAN_ID, true)
    expect(() => assertFeature(entitlementsOf(PRO_PLAN_ID, true), "memberRoles", GroupRole.ADMIN))
      .not.toThrow()
    const refusal = (role: GroupRole) => {
      try {
        assertFeature(free, "memberRoles", role)
      } catch (error) {
        return error instanceof PlanError ? toPlanRefusal(error) : null
      }
      return null
    }
    expect(refusal(GroupRole.OWNER)).toEqual({
      code: "PLAN_FEATURE_MISSING",
      entitlement: "memberRoles",
      limit: null,
      canUpgrade: true,
    })
    expect(refusal(GroupRole.ADMIN)?.canUpgrade).toBe(false)
  })

  it("refuses one more once the count reaches the cap, and never caps a null limit", () => {
    expect(() => assertRoomFor("maxNotes", 10, 9, GroupRole.EDITOR)).not.toThrow()
    expect(() => assertRoomFor("maxNotes", null, 1_000_000, GroupRole.EDITOR)).not.toThrow()
    for (const used of [10, 25]) {
      expect(() => assertRoomFor("maxNotes", 10, used, GroupRole.EDITOR)).toThrow(PlanError)
    }
  })

  it("reads a plan refusal back from an error body and nothing else", () => {
    const body = {
      code: "PLAN_LIMIT_REACHED",
      message: "x",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    expect(readPlanRefusal(body)).toEqual({
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    })
    expect(readPlanRefusal({ ...body, code: "ROLE_INSUFFICIENT" })).toBeNull()
    expect(readPlanRefusal({ ...body, canUpgrade: "yes" })).toBeNull()
    expect(readPlanRefusal({ ...body, entitlement: "maxSeats" })).toBeNull()
    expect(readPlanRefusal({ ...body, entitlement: "toString" })).toBeNull()
    expect(readPlanRefusal(null)).toBeNull()
  })

  it("keeps the file rules with billing off and takes each plan's own with billing on", () => {
    const free = PLANS.find((plan) => plan.id === FREE_PLAN_ID)!
    const pro = PLANS.find((plan) => plan.id === PRO_PLAN_ID)!
    expect(free.attachments).toEqual({ maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 })
    expect(free.entitlements.limits.maxAttachments).toBe(100)
    expect(attachmentRulesOf(PRO_PLAN_ID, false)).toBe(free.attachments)
    expect(attachmentRulesOf(PRO_PLAN_ID, true)).toBe(pro.attachments)
    expect(attachmentRulesOf("unknown", true)).toBe(free.attachments)
  })
})
