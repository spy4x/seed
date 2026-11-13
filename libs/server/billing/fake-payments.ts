import type postgres from "postgres"
import {
  BILLING_AUDIT_EVENTS,
  BillingPeriod,
  BillingStatus,
  findPlan,
  type Plan,
  priceOf,
} from "@domain/billing"

/** A subscription's last payment as the development provider answers it. */
export interface FakePayment {
  /** In the currency's smallest unit. */
  amount: number
  paidAt: Date
  /** Whether an operator refunded it. */
  refunded: boolean
}

/** The last payment of the subscription with this provider id, or `null` when it paid nothing. */
export type FakePayments = (subscriptionId: string) => Promise<FakePayment | null>

/**
 * What one `period` of `plan` costs a subscription of `seats` members, in the plan's currency's
 * smallest unit: the price once per member on a per-member plan, once otherwise. `null` when the
 * plan is not sold for that period.
 */
export function periodCharge(plan: Plan, period: BillingPeriod, seats: number): number | null {
  const price = priceOf(plan, period)
  return price === null ? null : price * (plan.perSeat ? seats : 1)
}

/** How long each billing period lasts in the development provider. */
const PERIOD_MS: Record<BillingPeriod, number> = {
  [BillingPeriod.Monthly]: 30 * 24 * 60 * 60_000,
  [BillingPeriod.Yearly]: 365 * 24 * 60 * 60_000,
}

/**
 * The development provider's payments, read from this app's own subscription rows, so the admin's
 * customer page tells the same story as the rest of the record. A trial, or a subscription never
 * active, has paid nothing. Otherwise the last payment is the plan's price for the subscription's
 * seats, at the start of the current period; for a past-due one, the period before the charge
 * that failed. It is refunded when the operator's refund of it is on record. Development only: real
 * Stripe answers for itself.
 */
export function postgresFakePayments(sql: postgres.Sql): FakePayments {
  return async (subscriptionId) => {
    const [row] = await sql<{
      status: BillingStatus
      planId: string | null
      quantity: number | null
      billingPeriod: BillingPeriod | null
      everActive: boolean
      currentPeriodEnd: Date | null
      pastDueSince: Date | null
      providerEventAt: Date
      refunded: boolean
    }[]>`
      SELECT s.status, s.plan_id, s.quantity, s.billing_period, s.ever_active, s.current_period_end,
        s.past_due_since, s.provider_event_at,
        EXISTS (
          SELECT 1 FROM auth_audits a
          WHERE a.event_type = ${BILLING_AUDIT_EVENTS.paymentRefunded}
            AND strpos(a.identifier, ${` obj:pi_fake_${subscriptionId} `}) > 0
        ) AS refunded
      FROM subscriptions s WHERE s.provider_subscription_id = ${subscriptionId}
      LIMIT 1
    `
    const plan = row?.planId ? findPlan(row.planId) : null
    if (!row || !plan || !row.everActive || row.status === BillingStatus.Trialing) return null
    const period = row.billingPeriod ?? BillingPeriod.Monthly
    const amount = periodCharge(plan, period, row.quantity ?? 1)
    if (amount === null) return null
    const due = row.status === BillingStatus.PastDue ? row.pastDueSince : row.currentPeriodEnd
    return {
      amount,
      paidAt: due ? new Date(due.getTime() - PERIOD_MS[period]) : row.providerEventAt,
      refunded: row.refunded,
    }
  }
}
