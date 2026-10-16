import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { BillingInterval, PlanCard, PricingTable } from "@spy4x/preact-ui/billing"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Notice } from "@spy4x/preact-ui/notice"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { SettingGroup } from "@spy4x/preact-ui/setting-row"
import { formatMoney } from "@spy4x/platform/universal/money"
import {
  billingDate,
  type BillingNotice,
  BillingNoticeKind,
  BillingStatus,
  findPlan,
  FREE_PLAN_ID,
  type GroupBilling,
  PAID_PLANS,
  type SeatPrice,
} from "@domain/billing"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { GROUP_PATHS, type Navigate } from "./progressive.tsx"

/**
 * The routes a group's billing lives at. `checkout` and `portal` are what the plan components'
 * forms name as their action; the SPA takes both submits over and asks the API for the provider's
 * page.
 */
export const BILLING_PATHS = {
  /** The plans the group can move to. */
  pricing: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/pricing`,
  /** `POST` opens the provider's checkout for `{ planId }`. */
  checkout: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/billing/checkout`,
  /** `POST` opens the provider's portal. Takes no fields. */
  portal: (groupId: string) => `/groups/${encodeURIComponent(groupId)}/billing/portal`,
} as const

/** Every plan as the pricing table draws it: monthly, in the plan's currency. */
const PRICING_PLANS = PAID_PLANS.map((plan) => ({
  id: plan.id,
  name: plan.name,
  amount: plan.amount,
  currency: plan.currency,
  interval: BillingInterval.Month,
  description: plan.description,
  features: plan.features,
  /** A per-member plan shows "per member / month" after its price. */
  unit: plan.perSeat ? `member` : undefined,
}))

function planName(planId: string): string {
  return findPlan(planId)?.name ?? planId
}

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`
}

/** What the owner reads for a notice: what happened, when, and what to do in the portal. */
export function billingNoticeText(notice: BillingNotice, planName: string): string {
  const date = billingDate(notice.at)
  const left = days(notice.daysLeft)
  switch (notice.kind) {
    case BillingNoticeKind.TrialEnding:
      return `The trial ends in ${left}, on ${date}. The ${planName} subscription then starts and ` +
        `is charged; to stop it, cancel it under Manage billing.`
    case BillingNoticeKind.PlanEnding:
      return `The ${planName} plan was cancelled and ends in ${left}, on ${date}. To keep it, ` +
        `renew it under Manage billing.`
    case BillingNoticeKind.PaymentFailed:
      return notice.daysLeft > 0
        ? `A payment failed. Update the card under Manage billing within ${left}, by ${date}, to ` +
          `keep the ${planName} plan.`
        : `A payment failed, so the group is on the free plan. Update the card under Manage ` +
          `billing to get the ${planName} plan back.`
  }
}

/**
 * The owner's notice about the subscription: a trial that ends soon, a failed payment, or a
 * cancelled plan that ends. Announced politely as a status; nothing when there is no notice.
 */
export function BillingNoticeBanner(
  { notice, planName }: { notice: BillingNotice | null; planName: string },
): JSX.Element | null {
  if (!notice) return null
  return (
    <Notice
      tone="warning"
      data-e2e="billing-notice"
      data-kind={notice.kind}
    >
      {billingNoticeText(notice, planName)}
    </Notice>
  )
}

/**
 * The date the plan card shows: a trial's end while trialing, else the end of the period. The
 * provider usually reports both as one moment during a trial; the trial's own end wins when not.
 */
function cardDate(billing: GroupBilling): Date | undefined {
  if (billing.status === BillingStatus.Trialing && billing.trialEnd) return billing.trialEnd
  return billing.currentPeriodEnd ?? undefined
}

export interface BillingCardProps {
  groupId: string
  /** The group's billing, or `null` while it is read. */
  billing: GroupBilling | null
  /** Why the billing could not be read or the portal could not be opened, or `null`. */
  error?: string | null
  /** New on every refusal, so focus moves to the message even when its text repeats. */
  errorId?: number
  /** The portal is being opened. */
  pending?: boolean
  navigate?: Navigate
  /**
   * Opens the provider's portal. Without it, the manage button posts to `BILLING_PATHS.portal`;
   * with it, the app takes the submit over.
   */
  onManage?: () => void
}

/**
 * The plan section of a group's settings. Every member sees the plan; only the owner gets the way
 * to change it: a link to the plans while the group is free, the provider's portal once it pays.
 */
export function BillingCard(
  { groupId, billing, error = null, errorId, pending = false, navigate, onManage }:
    BillingCardProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  // A refused portal has no field to fix, so focus lands on the message, under the button pressed.
  useEffect(() => {
    if (error && billing) message.current?.focus()
  }, [error, errorId])
  // PlanCard draws its own form with no submit callback, so the app's callback takes the submit over
  // from the fieldset around it. The listener is added here rather than as `onSubmitCapture`: Preact
  // only maps that prop when the element has an `onsubmit` property, which not every DOM gives a
  // fieldset.
  const portal = useRef<HTMLFieldSetElement>(null)
  useEffect(() => {
    const fieldset = portal.current
    if (!fieldset || !onManage) return
    const take = (event: Event) => {
      event.preventDefault()
      if (!pending) onManage()
    }
    fieldset.addEventListener("submit", take, true)
    return () => fieldset.removeEventListener("submit", take, true)
  }, [onManage, pending, billing])

  // The owner reaches the portal whenever the provider has something of the group's: a live
  // subscription, whatever plan it shows, or a customer with past invoices.
  const portalOpen = billing !== null && billing.canManage &&
    (billing.subscribed || billing.hasCustomer)
  const plan = billing ? findPlan(billing.planId) : null
  const planCard = portalOpen && billing.subscribed && billing.planId !== FREE_PLAN_ID &&
    billing.status !== null && billing.status <= 5
  const action = billing !== null && billing.enabled && billing.canManage && (
    <Cluster gap="sm">
      {!billing.subscribed && (
        <Button
          href={BILLING_PATHS.pricing(groupId)}
          navigate={navigate}
          variant="outline"
          size="sm"
          class="min-h-11 sm:min-h-9"
          data-e2e="billing-see-plans"
        >
          See plans
        </Button>
      )}
      {portalOpen && (
        <fieldset ref={portal} disabled={pending} class="m-0 min-w-0 border-0 p-0">
          <form method="post" action={BILLING_PATHS.portal(groupId)}>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              class="min-h-11 sm:min-h-9"
              busy={pending}
            >
              Manage billing
            </Button>
          </form>
        </fieldset>
      )}
    </Cluster>
  )
  return (
    <SettingGroup title="Plan" dataE2E="group-section-billing">
      {billing === null
        ? (error
          ? <ErrorState message={error} />
          : <p class="text-sm text-muted">Loading the plan...</p>)
        : (
          <div class="flex flex-col gap-4" data-e2e="billing-plan" data-plan={billing.planId}>
            <BillingNoticeBanner
              notice={billing.notice}
              // A group past its grace shows the free plan; its notice names the paid one.
              planName={billing.planId === FREE_PLAN_ID ? "paid" : planName(billing.planId)}
            />
            {planCard
              ? (
                // The fieldset disables the manage button while the portal opens.
                <fieldset
                  ref={portal}
                  disabled={pending}
                  class="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
                >
                  <PlanCard
                    planName={planName(billing.planId)}
                    status={billing.status as 1 | 2 | 3 | 4 | 5}
                    // A per-member plan shows what the group pays: one seat per member.
                    price={plan
                      ? {
                        amount: plan.amount * (billing.seatPrice?.seats ?? 1),
                        currency: plan.currency,
                        interval: BillingInterval.Month,
                      }
                      : undefined}
                    periodEnd={cardDate(billing)}
                    cancelAtPeriodEnd={billing.cancelAtPeriodEnd}
                    manageAction={BILLING_PATHS.portal(groupId)}
                    headingLevel={3}
                  />
                  {billing.seatPrice && (
                    <p class="text-sm text-muted" data-e2e="billing-seats">
                      {seatsText(billing.seatPrice)}
                    </p>
                  )}
                </fieldset>
              )
              : (
                <Card>
                  <div class="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <span class="text-sm font-medium">
                        <span data-e2e="billing-plan-name">{planName(billing.planId)}</span> plan
                      </span>
                      {billing.enabled && !billing.canManage && (
                        <span class="text-sm text-muted" data-e2e="billing-owner-only">
                          Only the group's owner can change its plan.
                        </span>
                      )}
                      {billing.enabled && billing.canManage && !billing.subscribed && (
                        <span class="text-sm text-muted">
                          A paid plan adds priority support for every member.
                        </span>
                      )}
                    </div>
                    {action}
                  </div>
                </Card>
              )}
            <div ref={message} tabIndex={-1} data-e2e="billing-error">
              <ErrorState message={error} />
            </div>
          </div>
        )}
    </SettingGroup>
  )
}

export interface PricingScreenProps {
  groupId: string
  /** The group's name for the heading, or `null` while it is read. */
  groupName: string | null
  /** The group's billing, or `null` while it is read. */
  billing: GroupBilling | null
  /** Why the plans cannot be shown or the checkout could not be opened, or `null`. */
  error?: string | null
  /** New on every refusal, so focus moves to the message even when its text repeats. */
  errorId?: number
  /** A checkout is being opened: every plan's button is disabled. */
  pending?: boolean
  navigate?: Navigate
  /**
   * Opens the provider's checkout for a plan. Without it, each plan's form posts `{ planId }` to
   * `BILLING_PATHS.checkout`; with it, the app takes the submit over.
   */
  onChoose?: (planId: string) => void
}

/**
 * The plans a group can move to. Only the owner gets a plan's "Choose" form; anyone else is told
 * who can choose, and a group that already pays is sent to its settings, where the portal changes
 * the plan.
 */
export function PricingScreen(
  { groupId, groupName, billing, error = null, errorId, pending = false, navigate, onChoose }:
    PricingScreenProps,
): JSX.Element {
  const message = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (error && billing) message.current?.focus()
  }, [error, errorId])

  const header = (
    <PageHeader
      title={groupName ? `Plans for ${groupName}` : "Plans"}
      titleDataE2E="pricing-title"
      back={{ href: GROUP_PATHS.settings(groupId), label: "Back to the group" }}
      navigate={navigate}
    />
  )
  if (billing === null) {
    return (
      <Stack gap="xl">
        {header}
        {error ? <ErrorState message={error} /> : <EmptyState title="Loading the plans..." />}
      </Stack>
    )
  }
  return (
    <Stack gap="xl">
      {header}
      {!billing.enabled
        ? <Notice data-e2e="pricing-off">Every group is on the Free plan.</Notice>
        : !billing.canManage
        ? (
          <Notice data-e2e="pricing-owner-only">
            Only the group's owner can change its plan.
          </Notice>
        )
        : billing.subscribed
        ? (
          <Notice data-e2e="pricing-paid">
            This group already has a subscription. Change or cancel it from the group's settings.
          </Notice>
        )
        : (
          <fieldset
            disabled={pending}
            // One plan would stretch across the page; it keeps a card's width, centred, instead.
            class={`m-0 w-full min-w-0 border-0 p-0 ${
              PRICING_PLANS.length === 1 ? "mx-auto max-w-sm" : ""
            }`}
            data-e2e="pricing-plans"
          >
            <PricingTable
              plans={PRICING_PLANS}
              action={BILLING_PATHS.checkout(groupId)}
              onChoose={onChoose && ((plan) => {
                if (!pending) onChoose(plan.id)
              })}
              headingLevel={2}
            />
          </fieldset>
        )}
      <div ref={message} tabIndex={-1} data-e2e="pricing-error">
        <ErrorState message={error} />
      </div>
    </Stack>
  )
}

/** "3 members at €9.00 each a month": what a group billed per member pays for. */
function seatsText({ seats, amount, currency }: SeatPrice): string {
  return `${seats} ${seats === 1 ? "member" : "members"} at ${formatMoney(amount, currency)} ` +
    `each a month, the owner included.`
}

export interface SeatPriceConfirmProps {
  /** The group's per-member price and its seats now, from `GroupBilling.seatPrice`. */
  seatPrice: SeatPrice
  /** The box is ticked. */
  checked: boolean
  onChange?: (checked: boolean) => void
  /** Why the create was refused for want of the confirmation, or `null`. */
  error?: string | null
}

/**
 * The price confirmation of a new invitation to a group billed per member: what one more member
 * adds to the bill, and a box the creator ticks to accept it. It belongs inside the invitation form,
 * so the box posts `acceptSeatPrice=true` with it; the server refuses a create without it. Focus
 * moves to the box when the create was refused for it.
 */
export function SeatPriceConfirm(
  { seatPrice, checked, onChange, error = null }: SeatPriceConfirmProps,
): JSX.Element {
  const box = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (error) box.current?.focus()
  }, [error])
  const { seats, amount, currency } = seatPrice
  const money = (value: number) => formatMoney(value, currency)
  return (
    <div data-e2e="seat-price">
      <Field
        id="invitation-seat-price"
        error={error}
        hint={`Each person who joins adds ${money(amount)} a month: with one more member the ` +
          `group pays ${money(amount * (seats + 1))} instead of ${money(amount * seats)}. ` +
          `The provider bills the difference for the rest of this period on the next invoice.`}
      >
        <Checkbox
          ref={box}
          name="acceptSeatPrice"
          value="true"
          data-e2e="seat-price-accept"
          checked={checked}
          onChange={(e) => onChange?.(e.currentTarget.checked)}
        >
          I accept the higher price for each person who joins
        </Checkbox>
      </Field>
    </div>
  )
}
