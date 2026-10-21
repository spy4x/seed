import { type } from "arktype"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  accessEndsAt,
  BillingStatus,
  findPlan,
  graceEndsAt,
  type StoredSubscription,
} from "./+lib.ts"

/**
 * The operator area's billing module (#196): who pays, what they pay, and the five things support
 * may do about it. The shapes the API answers and the page reads, and the rules both sides share,
 * so the page shows the same status, amount and dates the server decided on.
 *
 * @module
 */

/** How many customers one page of the list shows. */
export const ADMIN_BILLING_PAGE_SIZE = 25

/** The longest search the list accepts. */
export const ADMIN_BILLING_SEARCH_MAX_LENGTH = 100

/**
 * The longest "Note for the audit log". The note travels in the audit row's `identifier`, which
 * holds 320 characters, next to the group id, the provider's object id and an amount.
 */
export const ADMIN_BILLING_NOTE_MAX_LENGTH = 200

/**
 * The audit rows (`auth_audits.event_type`) of the module's actions, on the operator's own trail.
 * They continue `AuthAuditEventType` (`@domain/identity`), whose last number is 24; migration
 * `2026_11_16_0001_admin_billing.sql` lets the table take them.
 */
export const BILLING_AUDIT_EVENTS = {
  /** A supervisor refunded a group's last payment in full. */
  paymentRefunded: 25,
  /** An operator gave a group time at no charge: a new trial end. */
  timeGiven: 26,
  /** An operator set a group's subscription to end at the end of its paid period. */
  cancelledAtPeriodEnd: 27,
  /** A supervisor ended a group's subscription at once. */
  cancelledNow: 28,
  /** An operator took back a cancellation that waited for the period's end. */
  cancellationUndone: 29,
} as const

export type BillingAuditEvent = typeof BILLING_AUDIT_EVENTS[keyof typeof BILLING_AUDIT_EVENTS]

/** Every number in {@link BILLING_AUDIT_EVENTS}, lowest first. */
export const BILLING_AUDIT_EVENT_TYPES: readonly BillingAuditEvent[] = Object.values(
  BILLING_AUDIT_EVENTS,
).sort((a, b) => a - b)

/** The list's status chips. `paying` (active and past due) is the default. */
export type AdminBillingStatusFilter =
  | "paying"
  | "trial"
  | "past_due"
  | "ending"
  | "cancelled"
  | "all"

export const ADMIN_BILLING_STATUS_FILTERS: readonly AdminBillingStatusFilter[] = [
  "paying",
  "trial",
  "past_due",
  "ending",
  "cancelled",
  "all",
]

/** What the list shows: a search, a status chip and a page. */
export interface AdminBillingFilter {
  query: string
  status: AdminBillingStatusFilter
  page: number
}

export const ADMIN_BILLING_NO_FILTER: AdminBillingFilter = { query: "", status: "paying", page: 1 }

/**
 * Reads the list's filter from query parameters (`q`, `status`, `page`). A value it does not
 * understand falls back to the default for that part, so a hand-edited address still shows a list.
 */
export function parseAdminBillingFilter(params: URLSearchParams): AdminBillingFilter {
  const query = (params.get("q") ?? "").trim().slice(0, ADMIN_BILLING_SEARCH_MAX_LENGTH)
  const rawStatus = params.get("status") as AdminBillingStatusFilter | null
  const status = rawStatus !== null && ADMIN_BILLING_STATUS_FILTERS.includes(rawStatus)
    ? rawStatus
    : ADMIN_BILLING_NO_FILTER.status
  const pageNumber = Number(params.get("page"))
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 && pageNumber <= 100_000
    ? pageNumber
    : 1
  return { query, status, page }
}

/** The query string of `filter`, leaving out every part at its default. No leading `?`. */
export function adminBillingFilterQuery(filter: AdminBillingFilter): string {
  const params = new URLSearchParams()
  if (filter.query) params.set("q", filter.query)
  if (filter.status !== ADMIN_BILLING_NO_FILTER.status) params.set("status", filter.status)
  if (filter.page > 1) params.set("page", String(filter.page))
  return params.toString()
}

/** An amount of money in a currency's smallest unit: `{ amount: 900, currency: "EUR" }`. */
export interface Money {
  amount: number
  currency: string
}

/** A group's owner, as the list and the page name them. */
export interface AdminBillingOwner {
  id: number
  /** First and last name, or `""` before they set one. */
  name: string
  /** The address they sign in with, or `null` for an account that has none. */
  email: string | null
}

/**
 * One group's stored subscription with its group and owner: one row of the list, and the top of a
 * customer's page. Dates are ISO strings.
 */
export interface AdminBillingCustomer {
  groupId: string
  groupName: string
  /** When the group went to the trash, or `null`. Its subscription may still bill. */
  groupDeletedAt: string | null
  owner: AdminBillingOwner
  planId: string | null
  status: BillingStatus
  quantity: number | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEnd: string | null
  pastDueSince: string | null
  everActive: boolean
  /** When the last webhook changed the stored row. */
  updatedAt: string
}

/** How many customers each status chip holds, with every filter but the status applied. */
export type AdminBillingCounts = Record<AdminBillingStatusFilter, number>

/** `GET /api/admin/billing/customers`. */
export type AdminBillingListResponse =
  | { enabled: false }
  | {
    enabled: true
    customers: AdminBillingCustomer[]
    total: number
    page: number
    pageSize: number
    counts: AdminBillingCounts
    /** The days a past-due group keeps its plan, for the status line's date. */
    graceDays: number
    /** The public website's pricing page, for the empty list's action; `null` without a website. */
    pricingUrl: string | null
  }

/** The figures above the list (decision 2 of #196). */
export interface AdminBillingFigures {
  /** List price × seats of every active and past-due subscription, one entry per currency. */
  monthlyRevenue: Money[]
  /** Active and past-due subscriptions. */
  paying: number
  /** The past-due ones among {@link paying}. */
  pastDue: number
  /** Subscriptions in a trial, which includes time given at no charge. */
  trials: number
  /** The trials among {@link trials} that end in the next 7 days. */
  trialsEndingSoon: number
  /** Live subscriptions set to end at the end of their period. */
  ending: number
  /** When the last provider event arrived, or `null` when none has. */
  lastEventAt: string | null
}

/** `GET /api/admin/billing/figures`. */
export type AdminBillingFiguresResponse =
  | { enabled: false }
  | { enabled: true; figures: AdminBillingFigures }

/** One operator action on a customer's page, from the audit log. */
export interface AdminBillingHistoryEntry {
  id: number
  event: BillingAuditEvent
  at: string
  /** The operator's name, or their address before they set one; `null` once their account is gone. */
  operator: string | null
  /** The refunded amount, for a refund. */
  amount: (Money & { decimals: number }) | null
  /** The new end of the time at no charge, for time given. */
  until: string | null
  /** The note the operator wrote, or `""`. */
  note: string
}

/** `GET /api/admin/billing/:groupId`: the stored facts only, never a call to the provider. */
export interface AdminBillingDetail {
  customer: AdminBillingCustomer
  /** When the group first got a provider customer, or `null`. */
  customerSince: string | null
  /** The customer's page in the provider's dashboard, or `null` when there is none to link. */
  providerUrl: string | null
  history: AdminBillingHistoryEntry[]
  /** The operator who reads the page owns or belongs to the group, so every action is refused. */
  operatorIsMember: boolean
  graceDays: number
}

/** The last payment as the provider reports it when the page opens. */
export interface AdminBillingPayment {
  /** The provider's payment id; the refund dialog sends it back only to confirm what it showed. */
  id: string
  amount: number
  currency: string
  decimals: number
  paidAt: string
  amountRefunded: number
  refunded: boolean
}

/** `GET /api/admin/billing/:groupId/payment`. */
export interface AdminBillingPaymentResponse {
  payment: AdminBillingPayment | null
}

/** The lengths of time at no charge an operator may give (decision 5 of #196). */
export const ADMIN_BILLING_TIME_LENGTHS = ["7d", "14d", "30d", "1m", "3m", "6m", "12m"] as const
export type AdminBillingTimeLength = typeof ADMIN_BILLING_TIME_LENGTHS[number]

/** Each length as a person reads it. */
export const ADMIN_BILLING_TIME_LABELS: Record<AdminBillingTimeLength, string> = {
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "12m": "12 months",
}

/** `date` moved by `length`: days exactly, months by the calendar in UTC (Jan 31 + 1 month = Mar 3). */
export function addTimeLength(date: Date, length: AdminBillingTimeLength): Date {
  const count = Number(length.slice(0, -1))
  if (length.endsWith("d")) return new Date(date.getTime() + count * ONE_DAY_IN_MILLISECONDS)
  const next = new Date(date.getTime())
  next.setUTCMonth(next.getUTCMonth() + count)
  return next
}

/**
 * The end of the time at no charge that giving `length` sets: `length` after the later of now and
 * the time already covered, which is the trial's end during a trial and the paid period's end while
 * active. A past-due subscription has no covered time, so it counts from now.
 */
export function noChargeUntil(
  customer: Pick<AdminBillingCustomer, "status" | "trialEnd" | "currentPeriodEnd">,
  length: AdminBillingTimeLength,
  now: Date,
): Date {
  const covered = customer.status === BillingStatus.Trialing
    ? customer.trialEnd
    : customer.status === BillingStatus.Active
    ? customer.currentPeriodEnd
    : null
  const from = covered !== null && new Date(covered).getTime() > now.getTime()
    ? new Date(covered)
    : now
  return addTimeLength(from, length)
}

/** The seats a subscription bills: its stored quantity, or one when the provider gave none. */
export function seatsOf(customer: Pick<AdminBillingCustomer, "quantity">): number {
  return customer.quantity !== null && customer.quantity > 0 ? customer.quantity : 1
}

/**
 * What the subscription's plan costs a month at its list price: the plan's amount per seat times
 * the seats for a per-member plan, else the amount. `null` when it bills a price no plan maps to.
 * Discounts and tax live in the provider and are not counted.
 */
export function listPriceOf(
  customer: Pick<AdminBillingCustomer, "planId" | "quantity">,
): Money | null {
  const plan = customer.planId === null ? null : findPlan(customer.planId)
  if (plan === null || plan.amount === 0) return null
  const seats = plan.perSeat ? seatsOf(customer) : 1
  return { amount: plan.amount * seats, currency: plan.currency }
}

/**
 * What the subscription adds to monthly recurring revenue: its list price while active or past due,
 * zero during a trial (time at no charge is a trial too) and after it ends. `null` for a price no
 * plan maps to.
 */
export function monthlyRevenueOf(
  customer: Pick<AdminBillingCustomer, "planId" | "quantity" | "status">,
): Money | null {
  const price = listPriceOf(customer)
  if (price === null) return null
  const counts = customer.status === BillingStatus.Active ||
    customer.status === BillingStatus.PastDue
  return counts ? price : { amount: 0, currency: price.currency }
}

/** Monthly recurring revenue over `customers`, one sum per currency, never mixed, by currency. */
export function monthlyRevenue(
  customers: readonly Pick<AdminBillingCustomer, "planId" | "quantity" | "status">[],
): Money[] {
  const sums = new Map<string, number>()
  for (const customer of customers) {
    const revenue = monthlyRevenueOf(customer)
    if (revenue === null) continue
    sums.set(revenue.currency, (sums.get(revenue.currency) ?? 0) + revenue.amount)
  }
  return [...sums].map(([currency, amount]) => ({ amount, currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/** The one status word a customer shows (decision 3 of #196). */
export enum AdminBillingState {
  Active = 1,
  Trial = 2,
  PastDue = 3,
  Cancelled = 4,
  /** Created, but the first payment never went through. */
  Incomplete = 5,
  Paused = 6,
}

/** What the key date beside the status word says. */
export type AdminBillingDateKind =
  | "renews"
  | "ends"
  | "trial_ends"
  | "plan_kept_until"
  | "on_free_since"

/** A customer's status: its word and the one date that matters for it. */
export interface AdminBillingStatusView {
  state: AdminBillingState
  date: { kind: AdminBillingDateKind; at: string } | null
}

/** The stored subscription as `@domain/billing`'s rules read it. */
function storedOf(customer: AdminBillingCustomer): StoredSubscription {
  return {
    groupId: customer.groupId,
    providerSubscriptionId: ``,
    planId: customer.planId,
    status: customer.status,
    currentPeriodEnd: customer.currentPeriodEnd === null
      ? null
      : new Date(customer.currentPeriodEnd),
    cancelAtPeriodEnd: customer.cancelAtPeriodEnd,
    pastDueSince: customer.pastDueSince === null ? null : new Date(customer.pastDueSince),
    trialEnd: customer.trialEnd === null ? null : new Date(customer.trialEnd),
    quantity: customer.quantity,
    everActive: customer.everActive,
  }
}

/**
 * When the subscription stops keeping its plan by itself, by the rule `effectivePlanId` applies:
 * the earliest of the grace end of a failed payment and the access end (a trial's end, or the period
 * end of a subscription cancelled at its end). `null` when it keeps renewing.
 */
function planEndsAt(subscription: StoredSubscription, graceDays: number): Date | null {
  const ends = [graceEndsAt(subscription, graceDays), accessEndsAt(subscription)]
    .filter((date): date is Date => date !== null)
  if (ends.length === 0) return null
  return new Date(Math.min(...ends.map((date) => date.getTime())))
}

/**
 * When the group would lose its plan if it were cancelled at its period's end now: the period's end,
 * or the earlier end of its grace period or trial. The cancel dialog promises this date. `null` when
 * the subscription records neither.
 */
export function planEndsIfCancelledAt(
  customer: AdminBillingCustomer,
  graceDays: number,
): Date | null {
  return planEndsAt({ ...storedOf(customer), cancelAtPeriodEnd: true }, graceDays)
}

/**
 * A customer's status word and key date: "Past due, plan kept until Oct 23", "Trial, ends Oct 30",
 * "Active, renews Nov 12", "Active, ends Nov 12" for a cancellation waiting for the period's end.
 */
export function adminBillingStatus(
  customer: AdminBillingCustomer,
  now: Date,
  graceDays: number,
): AdminBillingStatusView {
  switch (customer.status) {
    case BillingStatus.Trialing: {
      const end = customer.cancelAtPeriodEnd && customer.currentPeriodEnd !== null
        ? customer.currentPeriodEnd
        : customer.trialEnd
      return {
        state: AdminBillingState.Trial,
        date: end === null ? null : { kind: `trial_ends`, at: end },
      }
    }
    case BillingStatus.Active:
      return {
        state: AdminBillingState.Active,
        date: customer.currentPeriodEnd === null
          ? null
          : { kind: customer.cancelAtPeriodEnd ? `ends` : `renews`, at: customer.currentPeriodEnd },
      }
    case BillingStatus.PastDue: {
      const end = planEndsAt(storedOf(customer), graceDays)
      if (end === null) return { state: AdminBillingState.PastDue, date: null }
      return {
        state: AdminBillingState.PastDue,
        date: {
          kind: end.getTime() > now.getTime() ? `plan_kept_until` : `on_free_since`,
          at: end.toISOString(),
        },
      }
    }
    case BillingStatus.Canceled:
      return { state: AdminBillingState.Cancelled, date: null }
    case BillingStatus.Incomplete:
      return { state: AdminBillingState.Incomplete, date: null }
    default:
      return { state: AdminBillingState.Paused, date: null }
  }
}

/** The five actions of a customer's page. */
export type AdminBillingActionKind = "refund" | "time" | "cancel_period_end" | "cancel_now" | "undo"

/** The actions that move money out or cannot be taken back: a supervisor or above only. */
export const ADMIN_BILLING_SUPERVISOR_ACTIONS: ReadonlySet<AdminBillingActionKind> = new Set([
  "refund",
  "cancel_now",
])

/** Why an action cannot run on a subscription in its current state, or `null` when it can. */
export function adminBillingActionRefusal(
  action: AdminBillingActionKind,
  customer: Pick<AdminBillingCustomer, "status" | "cancelAtPeriodEnd">,
): string | null {
  const cancelled = customer.status === BillingStatus.Canceled
  switch (action) {
    case "refund":
      return null
    case "time":
      if (
        customer.status === BillingStatus.Trialing || customer.status === BillingStatus.Active ||
        customer.status === BillingStatus.PastDue
      ) {
        return null
      }
      return cancelled
        ? `A cancelled subscription cannot run at no charge. Its owner checks out again first.`
        : `Only a trial, an active or a past-due subscription can get time at no charge.`
    case "cancel_period_end":
      if (cancelled) return `This subscription is already cancelled.`
      if (customer.cancelAtPeriodEnd) return `This subscription already ends at its period's end.`
      return null
    case "cancel_now":
      return cancelled ? `This subscription is already cancelled.` : null
    case "undo":
      if (cancelled) return `This subscription is already cancelled.`
      return customer.cancelAtPeriodEnd ? null : `No cancellation is waiting to be undone.`
  }
}

const note = `string <= ${ADMIN_BILLING_NOTE_MAX_LENGTH}`

/**
 * An idempotency key: a UUID, which the page makes (version 7) when the dialog opens. Any version
 * passes, as every id validator here does; a retry sends the same key and acts once.
 */
const idempotencyKey = type("string").narrow((value, ctx) => isUuid(value) || ctx.mustBe("a UUID"))

/** The body of `POST /api/admin/billing/:groupId/refund`. */
export const adminBillingRefundSchema = type({
  idempotencyKey,
  /** The payment the dialog showed. Only compared with the one the server reads; never refunded. */
  paymentId: "0 < string <= 255",
  "note?": note,
  "+": "reject",
})

/** The body of `POST /api/admin/billing/:groupId/time`. */
export const adminBillingTimeSchema = type({
  idempotencyKey,
  length: type.enumerated(...ADMIN_BILLING_TIME_LENGTHS),
  "note?": note,
  "+": "reject",
})

/** The body of `POST /api/admin/billing/:groupId/cancel`. */
export const adminBillingCancelSchema = type({
  idempotencyKey,
  when: "'period_end' | 'now'",
  "note?": note,
  "+": "reject",
})

/** The body of `POST /api/admin/billing/:groupId/undo-cancel`. */
export const adminBillingUndoSchema = type({
  idempotencyKey,
  "note?": note,
  "+": "reject",
})

/** What every action route answers on success. */
export interface AdminBillingActionResponse {
  /** The customer's page as stored now. The subscription itself changes when the webhook lands. */
  detail: AdminBillingDetail
  /** The refunded amount, for a refund. */
  refunded?: Money
  /** The new end of the time at no charge, for time given. */
  until?: string
}

/** The longest `auth_audits.identifier`. */
const IDENTIFIER_MAX_LENGTH = 320

/** What one billing audit row says, besides who did it and when. */
export interface BillingAuditFacts {
  groupId: string
  /** The provider's object the action changed: the payment for a refund, else the subscription. */
  objectId: string
  amount?: Money & { decimals: number }
  until?: string
  note: string
}

/**
 * The `identifier` of a billing audit row: `group:<id> obj:<provider id> [amount:<minor> <CUR>
 * <decimals>] [until:<ISO>] note:<note>`. The note comes last, so it may hold any text, and is cut
 * so the whole fits the column's 320 characters.
 */
export function billingAuditIdentifier(facts: BillingAuditFacts): string {
  let head = `group:${facts.groupId} obj:${facts.objectId}`
  if (facts.amount) {
    head += ` amount:${facts.amount.amount} ${facts.amount.currency} ${facts.amount.decimals}`
  }
  if (facts.until) head += ` until:${facts.until}`
  head += ` note:`
  return head + Array.from(facts.note).slice(0, Math.max(0, IDENTIFIER_MAX_LENGTH - head.length))
    .join(``)
}

const IDENTIFIER_PATTERN =
  /^group:(\S+) obj:(\S+)(?: amount:(\d+) ([A-Z]{3}) (\d+))?(?: until:(\S+))? note:([\s\S]*)$/

/** The facts {@link billingAuditIdentifier} wrote, or `null` for an identifier of another shape. */
export function readBillingAuditIdentifier(identifier: string): BillingAuditFacts | null {
  const match = IDENTIFIER_PATTERN.exec(identifier)
  if (!match) return null
  const [, groupId, objectId, amount, currency, decimals, until, note] = match
  return {
    groupId,
    objectId,
    ...(amount === undefined
      ? {}
      : { amount: { amount: Number(amount), currency, decimals: Number(decimals) } }),
    ...(until === undefined ? {} : { until }),
    note,
  }
}

/** The prefix every audit row about `groupId` starts with, for a `LIKE` over `identifier`. */
export function billingAuditPrefix(groupId: string): string {
  return `group:${groupId} `
}
