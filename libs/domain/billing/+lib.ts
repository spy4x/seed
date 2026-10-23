import { type } from "arktype"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import type { Command, Query } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import { canManageBilling, canRead, GroupRole } from "@domain/groups"

/**
 * Billing: one subscription per group, paid by the group's owner. A group without a paid
 * subscription is on the free plan. The provider (Stripe, through `@spy4x/billing`) owns the money;
 * this app keeps only what the provider's webhooks report. `docs/billing.md` explains the setup.
 */

/** The plan every group is on until a paid subscription says otherwise. */
export const FREE_PLAN_ID = "free"

/** The paid plan. Its provider price comes from the environment (`STRIPE_PRICE_PRO`). */
export const PRO_PLAN_ID = "pro"

// #region Entitlements
/**
 * A feature a plan may include. A product adds its own keys here, and TypeScript then asks for the
 * key in every plan's `entitlements.features` and in {@link UNLIMITED}.
 */
export type FeatureKey =
  /** Give a member another role after they joined. */
  "memberRoles"

/**
 * A count a plan caps. A product adds its own keys the same way as {@link FeatureKey}.
 *
 * - `maxMembers`: members of the group, the owner included. Creating an invitation and accepting
 *   one count against it; a pending invitation takes no seat.
 * - `maxNotes`: notes in the group that are not deleted.
 * - `maxAttachments`: files attached to the group's notes, deleted notes' files included until the
 *   notes are purged.
 * - `storageBytes`: bytes of those files.
 */
export type LimitKey = "maxMembers" | "maxNotes" | "maxAttachments" | "storageBytes"

/** What a plan allows: which features it includes, and how much of each count, `null` for no cap. */
export interface Entitlements {
  features: Readonly<Record<FeatureKey, boolean>>
  limits: Readonly<Record<LimitKey, number | null>>
}

/** What a deployment that takes no payments allows every group: everything, with no cap. */
export const UNLIMITED: Entitlements = {
  features: { memberRoles: true },
  limits: { maxMembers: null, maxNotes: null, maxAttachments: null, storageBytes: null },
}

/**
 * The rules for one file and one note: the largest file, and how many files one note holds. They
 * hold with billing off too: they protect the store and the note page, they are not what a plan
 * sells. A plan may raise them.
 */
export interface AttachmentRules {
  maxFileBytes: number
  maxPerNote: number
}

/** What a command needs from the group's plan: a feature it includes, or room under a cap. */
export type EntitlementNeed = { feature: FeatureKey } | { limit: LimitKey }
// #endregion Entitlements

/** One plan of the catalog, as the pricing page shows it. */
export interface Plan {
  id: string
  name: string
  /** In the currency's smallest unit: `900` is €9.00. */
  amount: number
  currency: string
  description: string
  features: string[]
  /** What the plan allows. The server checks these; `features` above is only the pricing text. */
  entitlements: Entitlements
  /** The plan's {@link AttachmentRules}. */
  attachments: AttachmentRules
  /**
   * Days of free trial this plan offers; `0` for none. Each person gets one trial, whichever group
   * they first open a checkout for (docs/billing.md, "Trials").
   */
  trialDays: number
  /**
   * The plan bills `amount` per member a month, the owner included, so the subscription's quantity
   * follows the group's member count. A pending invitation takes no seat, the same count
   * `maxMembers` caps.
   */
  perSeat: boolean
}

/** Every plan, free first. The paid ones are the ones a checkout may name. */
export const PLANS: readonly Plan[] = [
  {
    id: FREE_PLAN_ID,
    name: "Free",
    amount: 0,
    currency: "EUR",
    description: "For trying things out.",
    features: ["Up to 10 notes", "Up to 3 members", "100 files, 200 MB in all"],
    entitlements: {
      features: { memberRoles: false },
      limits: {
        maxMembers: 3,
        maxNotes: 10,
        maxAttachments: 100,
        storageBytes: 200 * 1024 * 1024,
      },
    },
    attachments: { maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 },
    trialDays: 0,
    perSeat: false,
  },
  {
    id: PRO_PLAN_ID,
    name: "Pro",
    amount: 900,
    currency: "EUR",
    description: "For a group that relies on it.",
    features: [
      "Billed per member, the owner included",
      "Unlimited notes",
      "Unlimited files, 10 GB in all",
      "Up to 50 members",
      "Promote members to editor or admin",
    ],
    entitlements: {
      features: { memberRoles: true },
      limits: {
        maxMembers: 50,
        maxNotes: null,
        maxAttachments: null,
        storageBytes: 10 * 1024 * 1024 * 1024,
      },
    },
    attachments: { maxFileBytes: 2 * 1024 * 1024, maxPerNote: 10 },
    trialDays: 14,
    perSeat: true,
  },
]

/** The plans a checkout may name: every plan but the free one. */
export const PAID_PLANS: readonly Plan[] = PLANS.filter((plan) => plan.id !== FREE_PLAN_ID)

/** The plan with this id, or `null`. */
export function findPlan(id: string): Plan | null {
  return PLANS.find((plan) => plan.id === id) ?? null
}

/**
 * What a group may do: its plan's entitlements, or {@link UNLIMITED} while billing is off, since
 * nobody could pay to lift a cap. An id no plan has gets the free plan's.
 */
export function entitlementsOf(planId: string, billingEnabled: boolean): Entitlements {
  if (!billingEnabled) return UNLIMITED
  return (findPlan(planId) ?? PLANS[0]).entitlements
}

/**
 * The file rules of a group's plan. With billing off every group has the free plan's: unlike the
 * caps of {@link entitlementsOf}, they are never lifted.
 */
export function attachmentRulesOf(planId: string, billingEnabled: boolean): AttachmentRules {
  return ((billingEnabled ? findPlan(planId) : null) ?? PLANS[0]).attachments
}

/** The outbox event kind a plan change is recorded under, on the group's change log. */
export const BILLING_EVENTS = {
  planChanged: "group.plan.changed",
} as const

/**
 * Where a subscription stands. The same numbers as `@spy4x/billing`'s `SubscriptionStatus`, kept
 * here so the domain does not depend on the provider package; a unit test pins them together.
 */
export enum BillingStatus {
  Trialing = 1,
  Active = 2,
  PastDue = 3,
  Canceled = 4,
  Incomplete = 5,
  Paused = 6,
}

/** The statuses that keep a paid plan for as long as they last. Past due has its own rule. */
const PAID_STATUSES: ReadonlySet<BillingStatus> = new Set([
  BillingStatus.Trialing,
  BillingStatus.Active,
])

/**
 * How many days a past-due group keeps its plan while the provider retries the charge, when
 * `BILLING_GRACE_DAYS` is unset.
 */
export const DEFAULT_GRACE_DAYS = 7

/** A group's subscription as this app stores it. */
export interface StoredSubscription {
  groupId: string
  providerSubscriptionId: string
  /** The app's plan id, or `null` when the provider bills a price no plan maps to. */
  planId: string | null
  status: BillingStatus
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  /**
   * When the provider first reported the subscription past due, kept through every later past-due
   * event (Stripe's `unpaid` arrives as past due too); `null` whenever the status is not past due.
   */
  pastDueSince: Date | null
  /** When the trial ends, or `null` when the subscription has none. */
  trialEnd: Date | null
  /** The seats the provider last reported it bills, or `null` when it reported none. */
  quantity: number | null
  /**
   * Whether the provider ever reported this subscription active, so it has paid at least once. Only
   * then does a failed payment keep the plan for the grace period.
   */
  everActive: boolean
}

/**
 * When a subscription stops paying for its plan by itself, whatever the provider reports later: the
 * end of a trial, or the end of the period of a subscription cancelled at its end. `null` when it
 * renews. The provider's webhook normally arrives at that moment; this bounds a late or lost one.
 */
export function accessEndsAt(subscription: StoredSubscription): Date | null {
  const ends = [
    subscription.status === BillingStatus.Trialing ? subscription.trialEnd : null,
    subscription.cancelAtPeriodEnd ? subscription.currentPeriodEnd : null,
  ].filter((date): date is Date => date !== null)
  if (ends.length === 0) return null
  return new Date(Math.min(...ends.map((date) => date.getTime())))
}

/**
 * The moment a past-due subscription stops keeping its plan: `graceDays` after it first became past
 * due. `null` for any other status. A past-due subscription with no recorded start has no grace, and
 * neither has one that never was active: a trial whose first charge fails ends when it fails.
 */
export function graceEndsAt(subscription: StoredSubscription, graceDays: number): Date | null {
  if (subscription.status !== BillingStatus.PastDue) return null
  if (subscription.pastDueSince === null) return new Date(0)
  if (!subscription.everActive) return subscription.pastDueSince
  return new Date(subscription.pastDueSince.getTime() + graceDays * ONE_DAY_IN_MILLISECONDS)
}

/**
 * The plan a group is on at `now`: the subscription's plan while it is trialing or active, or past
 * due for less than `graceDays`, and only until {@link accessEndsAt}; else the free plan. Nothing is
 * deleted when the grace ends; the group only gets the free plan's entitlements, and a payment that
 * makes it active brings the plan back.
 */
export function effectivePlanId(
  subscription: StoredSubscription | null,
  now: Date,
  graceDays: number,
): string {
  if (subscription === null || subscription.planId === null) return FREE_PLAN_ID
  const graceEnd = graceEndsAt(subscription, graceDays)
  const paid = PAID_STATUSES.has(subscription.status) ||
    (graceEnd !== null && now.getTime() < graceEnd.getTime())
  if (!paid) return FREE_PLAN_ID
  const accessEnd = accessEndsAt(subscription)
  if (accessEnd !== null && now.getTime() >= accessEnd.getTime()) return FREE_PLAN_ID
  return findPlan(subscription.planId) ? subscription.planId : FREE_PLAN_ID
}

const BILLING_DATE = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" })

/**
 * A date as billing writes it, in the banner and the mail alike: `October 15, 2026`, in UTC, the
 * same on the server and in the browser, and the same form the plan card uses.
 */
export function billingDate(date: Date): string {
  return BILLING_DATE.format(date)
}

/** Days before the end of a trial that its owner is told it is ending. */
export const TRIAL_NOTICE_DAYS = 3

/** What a group's owner is told about its subscription, by e-mail and on the plan section. */
export enum BillingNoticeKind {
  /** The trial ends within {@link TRIAL_NOTICE_DAYS} days and the subscription then renews. */
  TrialEnding = 1,
  /** A payment failed: the plan is kept for the grace period while the provider retries. */
  PaymentFailed = 2,
  /** The subscription was cancelled at the end of its period: the plan ends then. */
  PlanEnding = 3,
}

/**
 * The notice in force for a subscription at `now`, or `null`. A failed payment comes first, then a
 * plan that ends, then a trial that ends soon; a trial cancelled at its end is a plan that ends.
 */
export function billingNoticeKindOf(
  subscription: StoredSubscription | null,
  now: Date,
): BillingNoticeKind | null {
  if (subscription === null) return null
  if (subscription.status === BillingStatus.PastDue) return BillingNoticeKind.PaymentFailed
  if (!PAID_STATUSES.has(subscription.status)) return null
  const accessEnd = accessEndsAt(subscription)
  if (accessEnd !== null && now.getTime() >= accessEnd.getTime()) return null
  if (subscription.cancelAtPeriodEnd) return BillingNoticeKind.PlanEnding
  if (subscription.status !== BillingStatus.Trialing || accessEnd === null) return null
  const noticeFrom = accessEnd.getTime() - TRIAL_NOTICE_DAYS * ONE_DAY_IN_MILLISECONDS
  return now.getTime() >= noticeFrom ? BillingNoticeKind.TrialEnding : null
}

/** A notice as the owner sees it: what happened, and when the plan ends or renews because of it. */
export interface BillingNotice {
  kind: BillingNoticeKind
  /**
   * When the trial ends, when a cancelled plan ends, or when the grace of a failed payment is over.
   */
  at: Date
  /** Whole days from the read until {@link at}, rounded up; `0` once it has passed. */
  daysLeft: number
}

/** The {@link BillingNotice} in force for a subscription at `now`, or `null`. */
export function billingNoticeOf(
  subscription: StoredSubscription | null,
  now: Date,
  graceDays: number,
): BillingNotice | null {
  const kind = billingNoticeKindOf(subscription, now)
  if (subscription === null || kind === null) return null
  const at = kind === BillingNoticeKind.PaymentFailed
    ? graceEndsAt(subscription, graceDays)
    : accessEndsAt(subscription) ?? subscription.currentPeriodEnd
  if (at === null) return null
  const daysLeft = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / ONE_DAY_IN_MILLISECONDS))
  return { kind, at, daysLeft }
}

/**
 * Whether the group has a subscription the provider may still charge: any stored one that is not
 * cancelled, whatever plan or price it bills. A second checkout while one exists would start a
 * second subscription.
 */
export function hasLiveSubscription(subscription: StoredSubscription | null): boolean {
  return subscription !== null && subscription.status !== BillingStatus.Canceled
}

/**
 * The trial a new owner's checkout starts with after a transfer of ownership: the whole days, rounded
 * up, that the old owner's subscription still gives the group its plan, so the new owner is first
 * charged when the old owner's plan ends and the two never bill the same days. `null` when the
 * group is not on a paid plan at `now` (the old subscription has ended, or is past due beyond its
 * grace), or when that subscription still renews and so has no end to wait for.
 */
export function handoverTrialDays(
  subscription: StoredSubscription | null,
  now: Date,
  graceDays: number,
): number | null {
  if (
    subscription === null || !subscription.cancelAtPeriodEnd ||
    effectivePlanId(subscription, now, graceDays) === FREE_PLAN_ID
  ) {
    return null
  }
  // A past-due subscription keeps the plan only for its grace, whatever period it was billing.
  const ends = [accessEndsAt(subscription), graceEndsAt(subscription, graceDays)]
    .filter((date): date is Date => date !== null)
  if (ends.length === 0) return null
  const end = Math.min(...ends.map((date) => date.getTime()))
  return Math.ceil((end - now.getTime()) / ONE_DAY_IN_MILLISECONDS)
}

/**
 * Whether the provider bills the group per member: its subscription is live and its plan is
 * {@link Plan.perSeat}. A past-due subscription past its grace still counts, since the provider
 * keeps charging it; the subscription's quantity then follows the member count.
 */
export function isSeatBilled(subscription: StoredSubscription | null): boolean {
  if (!hasLiveSubscription(subscription) || subscription?.planId == null) return false
  return findPlan(subscription.planId)?.perSeat === true
}

/** The per-member price a group pays, as the invitation form shows it before a new member joins. */
export interface SeatPrice {
  /** Members the group pays for now, the owner included. */
  seats: number
  /** The price of one seat a month, in the currency's smallest unit. */
  amount: number
  currency: string
}

/**
 * The provider page a checkout or portal answer names, when it is an `http:` or `https:` URL; any
 * other scheme (`javascript:`, `data:`) or a value that is no URL gives `null`, so the app never
 * sends a person there.
 */
export function providerPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
  } catch {
    return null
  }
}

/** A group's billing, as the API returns it to any member. */
export interface GroupBilling {
  /** `false` when this deployment takes no payments: every group is on the free plan. */
  enabled: boolean
  planId: string
  /** The subscription's status, or `null` when the group never had one. */
  status: BillingStatus | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  /** When the trial ends, or `null` when there is none. */
  trialEnd: Date | null
  /** What the owner is told about the subscription; always `null` for anyone else. */
  notice: BillingNotice | null
  /** Whether the person asking may open checkout or the portal: billing is on and they own it. */
  canManage: boolean
  /**
   * The group has a subscription that is not cancelled and that its owner pays, so it cannot check
   * out again. A subscription the previous owner still pays after a transfer of ownership does not
   * count: the new owner may check out (see {@link handoverTrialDays}).
   */
  subscribed: boolean
  /** The group has a provider customer, so its portal (invoices, card, plan) can be opened. */
  hasCustomer: boolean
  /** What the group pays per member, while it is billed per member (see {@link isSeatBilled}). */
  seatPrice: SeatPrice | null
}

/**
 * Builds the {@link GroupBilling} view of one group for one member, with the plan it is on at `now`
 * (see {@link effectivePlanId}). `members` is the group's member count, the owner included.
 * `handedOver` is true when the group's provider customer belongs to an owner who has since
 * transferred the group: the subscription then is not the current owner's to manage, so the view
 * offers a checkout instead and gives no notice about it.
 */
export function toGroupBilling(
  subscription: StoredSubscription | null,
  role: GroupRole,
  enabled: boolean,
  hasCustomer: boolean,
  now: Date,
  graceDays: number,
  members: number,
  handedOver = false,
): GroupBilling {
  const seatPlan = enabled && isSeatBilled(subscription) ? findPlan(subscription!.planId!) : null
  return {
    enabled,
    planId: enabled ? effectivePlanId(subscription, now, graceDays) : FREE_PLAN_ID,
    status: enabled ? subscription?.status ?? null : null,
    currentPeriodEnd: enabled ? subscription?.currentPeriodEnd ?? null : null,
    cancelAtPeriodEnd: enabled ? subscription?.cancelAtPeriodEnd ?? false : false,
    trialEnd: enabled ? subscription?.trialEnd ?? null : null,
    notice: enabled && canManageBilling(role) && !handedOver
      ? billingNoticeOf(subscription, now, graceDays)
      : null,
    canManage: enabled && canManageBilling(role),
    subscribed: enabled && hasLiveSubscription(subscription) && !handedOver,
    hasCustomer: enabled && hasCustomer,
    seatPrice: seatPlan
      ? { seats: members, amount: seatPlan.amount, currency: seatPlan.currency }
      : null,
  }
}

/** A date as JSON carries it, an ISO string, back to a date; `undefined` for anything else. */
function jsonDate(value: unknown): Date | null | undefined {
  if (value === null) return null
  if (typeof value !== "string") return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function readSeatPrice(value: unknown): SeatPrice | null | undefined {
  if (value === null) return null
  if (typeof value !== "object" || value === undefined) return undefined
  const { seats, amount, currency } = value as Record<string, unknown>
  const whole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0
  if (!whole(seats) || !whole(amount) || typeof currency !== "string") return undefined
  return { seats, amount, currency }
}

function readNotice(value: unknown): BillingNotice | null | undefined {
  if (value === null) return null
  if (typeof value !== "object" || value === undefined) return undefined
  const { kind, at, daysLeft } = value as Record<string, unknown>
  const date = jsonDate(at)
  if (typeof kind !== "number" || !(kind in BillingNoticeKind) || !date) return undefined
  if (typeof daysLeft !== "number" || !Number.isInteger(daysLeft) || daysLeft < 0) return undefined
  return { kind, at: date, daysLeft }
}

/**
 * Reads a {@link GroupBilling} back from the API's JSON, its dates included; `null` when any field
 * is missing or of the wrong kind. Both web apps read the billing through it.
 */
export function readGroupBilling(value: unknown): GroupBilling | null {
  if (typeof value !== "object" || value === null) return null
  const billing = value as Record<string, unknown>
  const { enabled, planId, status, cancelAtPeriodEnd, canManage, subscribed, hasCustomer } = billing
  const currentPeriodEnd = jsonDate(billing.currentPeriodEnd)
  const trialEnd = jsonDate(billing.trialEnd)
  const notice = readNotice(billing.notice)
  const seatPrice = readSeatPrice(billing.seatPrice)
  if (
    typeof enabled !== "boolean" || typeof planId !== "string" ||
    typeof cancelAtPeriodEnd !== "boolean" || typeof canManage !== "boolean" ||
    typeof subscribed !== "boolean" || typeof hasCustomer !== "boolean" ||
    !(status === null || (typeof status === "number" && status in BillingStatus)) ||
    currentPeriodEnd === undefined || trialEnd === undefined || notice === undefined ||
    seatPrice === undefined
  ) {
    return null
  }
  return {
    enabled,
    planId,
    status: status as BillingStatus | null,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    trialEnd,
    notice,
    canManage,
    subscribed,
    hasCustomer,
    seatPrice,
  }
}

/**
 * The trial a person may still start (`GET /api/billing/trial`). A trial is given once per person
 * (#205): the first group whose checkout they open gets it, and their later groups check out
 * without one. The create-group page says which.
 */
export interface PersonTrial {
  /** `false` when this deployment takes no payments. */
  enabled: boolean
  /** The person's trial went to a group already. */
  used: boolean
  /** The group the trial went to, or `null` while it is unused. */
  groupId: string | null
  /** The longest trial of a paid plan, in days; 0 when no plan has one. */
  days: number
}

const personTrialSchema = type({
  enabled: "boolean",
  used: "boolean",
  groupId: "string | null",
  days: "number.integer >= 0",
})

/** Reads a {@link PersonTrial} back from the API's JSON; `null` when it is not one. */
export function readPersonTrial(value: unknown): PersonTrial | null {
  const trial = personTrialSchema(value)
  if (trial instanceof type.errors) return null
  return { enabled: trial.enabled, used: trial.used, groupId: trial.groupId, days: trial.days }
}

/** The longest trial any paid plan starts with, in days. */
export const LONGEST_TRIAL_DAYS = Math.max(0, ...PAID_PLANS.map((plan) => plan.trialDays))

export type BillingErrorCode =
  | "ALREADY_SUBSCRIBED"
  | "BILLING_DISABLED"
  | "GROUP_NOT_FOUND"
  | "INVALID_REQUEST"
  | "NO_SUBSCRIPTION"
  | "PROVIDER_ERROR"
  | "ROLE_INSUFFICIENT"
  | "UNKNOWN_PLAN"

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "BillingError"
  }
}

export type PlanErrorCode = "PLAN_FEATURE_MISSING" | "PLAN_LIMIT_REACHED"

/**
 * A command the group's plan does not allow: a feature it lacks, or a cap it has reached. The API
 * answers it with 402 Payment Required, so a client tells it apart from a role refusal (403).
 */
export class PlanError extends Error {
  constructor(
    public readonly code: PlanErrorCode,
    /** The feature or the cap that refused it. */
    public readonly entitlement: FeatureKey | LimitKey,
    /** The cap that was reached, or `null` for a missing feature. */
    public readonly limit: number | null,
    /** The person asking may change the plan (the owner); anyone else is told to ask the owner. */
    public readonly canUpgrade: boolean,
    message: string,
  ) {
    super(message)
    this.name = "PlanError"
  }
}

/** What the API and the socket send with a {@link PlanError}, beside its code. */
export interface PlanRefusal {
  code: PlanErrorCode
  entitlement: FeatureKey | LimitKey
  limit: number | null
  canUpgrade: boolean
}

/** The fields of a {@link PlanError} a client needs to draw the upgrade prompt. */
export function toPlanRefusal(error: PlanError): PlanRefusal {
  return {
    code: error.code,
    entitlement: error.entitlement,
    limit: error.limit,
    canUpgrade: error.canUpgrade,
  }
}

/** Reads a {@link PlanRefusal} back from an error body or socket details; `null` for anything else. */
export function readPlanRefusal(value: unknown): PlanRefusal | null {
  if (typeof value !== "object" || value === null) return null
  const { code, entitlement, limit, canUpgrade } = value as Record<string, unknown>
  if (code !== "PLAN_FEATURE_MISSING" && code !== "PLAN_LIMIT_REACHED") return null
  if (typeof entitlement !== "string" || typeof canUpgrade !== "boolean") return null
  // A key this build does not know has no wording to show, so it is no refusal it can draw.
  const known = [...Object.keys(UNLIMITED.features), ...Object.keys(UNLIMITED.limits)]
  if (!known.includes(entitlement)) return null
  if (limit !== null && typeof limit !== "number") return null
  return { code, entitlement: entitlement as FeatureKey | LimitKey, limit, canUpgrade }
}

/** Throws {@link PlanError} unless `entitlements` include `feature`. */
export function assertFeature(
  entitlements: Entitlements,
  feature: FeatureKey,
  role: GroupRole,
): void {
  if (entitlements.features[feature]) return
  throw new PlanError(
    "PLAN_FEATURE_MISSING",
    feature,
    null,
    canManageBilling(role),
    "The group's plan does not include this",
  )
}

/**
 * Throws {@link PlanError} unless one more fits under the cap: `used` is the count before the write,
 * and `max` is the plan's cap (`null` for none). A group already over its cap, after a downgrade,
 * keeps what it has and is refused anything more.
 */
export function assertRoomFor(
  limit: LimitKey,
  max: number | null,
  used: number,
  role: GroupRole,
): void {
  if (max === null || used < max) return
  throw new PlanError(
    "PLAN_LIMIT_REACHED",
    limit,
    max,
    canManageBilling(role),
    "The group has reached its plan's limit",
  )
}

// #region Authorization
/** Throws unless `role` is a member's; a stranger is told the group does not exist. */
export function assertCanReadBilling(role: GroupRole | null): asserts role is GroupRole {
  if (role === null || !canRead(role)) throw new BillingError("GROUP_NOT_FOUND", "Group not found")
}

/** Throws unless `role` is the owner's. See {@link assertCanReadBilling}. */
export function assertCanManageBilling(role: GroupRole | null): void {
  assertCanReadBilling(role)
  if (!canManageBilling(role)) {
    throw new BillingError("ROLE_INSUFFICIENT", "Only the owner can manage the group's billing")
  }
}
// #endregion Authorization

// #region Request schemas
/** `POST /api/groups/:groupId/billing/checkout`, from the Plan and billing tab: the plan chosen. */
export const billingCheckoutRequestSchema = type({ planId: "0 < string <= 64", "+": "reject" })
export type BillingCheckoutRequest = typeof billingCheckoutRequestSchema.infer
// #endregion Request schemas

// #region Commands and queries
export interface BillingCheckoutPayload {
  actor: Actor
  groupId: string
  planId: string
  idempotencyKey?: string
}

/** Where to send the person: the provider's hosted page. */
export interface BillingRedirect {
  url: string
}

export class BillingCheckoutCommand implements Command<BillingCheckoutPayload, BillingRedirect> {
  __resultType?: BillingRedirect
  constructor(public data: BillingCheckoutPayload) {}
}

export interface BillingPortalPayload {
  actor: Actor
  groupId: string
  idempotencyKey?: string
}

export class BillingPortalCommand implements Command<BillingPortalPayload, BillingRedirect> {
  __resultType?: BillingRedirect
  constructor(public data: BillingPortalPayload) {}
}

export interface BillingGetPayload {
  actor: Actor
  groupId: string
}

export class BillingGetQuery implements Query<BillingGetPayload, { billing: GroupBilling }> {
  __resultType?: { billing: GroupBilling }
  constructor(public data: BillingGetPayload) {}
}
export interface BillingTrialPayload {
  actor: Actor
}

/** Whether the actor's trial is still to be used; see {@link PersonTrial}. */
export class BillingTrialQuery implements Query<BillingTrialPayload, { trial: PersonTrial }> {
  __resultType?: { trial: PersonTrial }
  constructor(public data: BillingTrialPayload) {}
}
// #endregion Commands and queries

// #region Ports
/** What applying one webhook event did. */
export type BillingApplyOutcome =
  /** The event was stored and the group's subscription changed. */
  | "applied"
  /** This event id was stored before: nothing changed. */
  | "duplicate"
  /** Stored, but older than what the group's subscription already says: nothing changed. */
  | "stale"
  /** Stored, but it names no group of this app, or is not about a subscription. */
  | "ignored"

/**
 * Where billing is kept. `applyEvent` stores the provider's event id and applies the event in one
 * transaction, so a second delivery of the same event changes nothing.
 */
export interface BillingRepository {
  get(groupId: string): Promise<StoredSubscription | null>
  /**
   * The actor's role in the group, read the way a group write reads it (`lockActorRole`): a removal
   * or a role change committed first is seen, and `null` answers a stranger or a deleted group.
   */
  lockedRoleOf(groupId: string, userId: number): Promise<GroupRole | null>
  /**
   * The provider customer of the group's current owner, or `null` before its first checkout and
   * after a transfer of ownership, until the new owner checks out with a customer of their own.
   */
  customerOf(groupId: string): Promise<string | null>
  /**
   * Whether the group's provider customer belongs to an owner who has since transferred the group.
   * Nobody can open its portal through the app, and the new owner checks out with a new customer.
   */
  handedOver(groupId: string): Promise<boolean>
  /** The group's members, the owner included: the count `maxMembers` caps and seats bill. */
  membersOf(groupId: string): Promise<number>
  /**
   * Gives the person's one trial to the group, in one conditional write: `true` when the trial is
   * unused or already went to this group, `false` when another group has it. Two checkouts of two
   * groups at once never both get it.
   */
  claimTrial(userId: number, groupId: string): Promise<boolean>
  /** The group the person's trial went to, or `null` while it is unused. */
  trialGroupOf(userId: number): Promise<string | null>
}

/** The actor's role in a group, or `null` when they are not an active member of an active group. */
export interface GroupRoleLookup {
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
}
// #endregion Ports

export * from "./admin.ts"
