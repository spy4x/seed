// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { IconArrowUpRight } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { Checkbox } from "@spy4x/preact-ui/checkbox"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Notice } from "@spy4x/preact-ui/notice"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { SettingGroup, SettingList, SettingRow } from "@spy4x/preact-ui/setting-row"
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
  type PersonTrial,
  type SeatPrice,
} from "@domain/billing"

/** The paid plan the tab offers. The catalog has one, Pro, billed per member. */
const PRO = PAID_PLANS[0]

const DAY_MS = 24 * 60 * 60 * 1000

function days(count: number): string {
  return count === 1 ? "1 day" : `${count} days`
}

function members(count: number): string {
  return count === 1 ? "1 member" : `${count} members`
}

/**
 * What the owner reads about a failed payment: by when to change the card, or that the group has
 * dropped to the free plan until they do. The other notices (a trial or a cancelled plan that ends
 * soon) say what the tab's plan text already says, so only this one is drawn.
 */
export function paymentFailedText(notice: BillingNotice, planName: string): string {
  return notice.daysLeft > 0
    ? `A payment failed. Update the card with Change card within ${days(notice.daysLeft)}, by ` +
      `${billingDate(notice.at)}, to keep ${planName}.`
    : `A payment failed, so the group is on the free plan. Update the card with Change card to ` +
      `get ${planName} back.`
}

/** Which of the tab's states a group's billing is in; `data-state` names it for the tests. */
export enum BillingState {
  /** This deployment takes no payments. */
  OFF = "off",
  FREE = "free",
  TRIAL = "trial",
  PRO = "pro",
  /** Cancelled, and paid until the end of its period. */
  ENDING = "ending",
  PAST_DUE = "past-due",
}

/** The state {@link GroupBillingPanel} draws for `billing`. */
export function billingState(billing: GroupBilling): BillingState {
  if (!billing.enabled) return BillingState.OFF
  if (billing.status === BillingStatus.PastDue) return BillingState.PAST_DUE
  if (!billing.subscribed || billing.planId === FREE_PLAN_ID) return BillingState.FREE
  if (billing.cancelAtPeriodEnd) return BillingState.ENDING
  if (billing.status === BillingStatus.Trialing) return BillingState.TRIAL
  return BillingState.PRO
}

export interface GroupBillingPanelProps {
  /** The group's id: the person's trial counts as unused for the group that holds it. */
  groupId: string
  /** The group's name, for the sentences that say what it pays. */
  groupName: string
  /** The group's billing, or `null` while it is read. */
  billing: GroupBilling | null
  /** The group's members now, the owner included, or `null` while they are read. */
  memberCount: number | null
  /** The owner's name, for the line a member who is not the owner reads; `null` while unknown. */
  ownerName: string | null
  /** The person's own trial, or `null` while it is read: it decides the checkout button's words. */
  trial: PersonTrial | null
  /**
   * The owner came back from the checkout and the payment provider has not confirmed it yet: the
   * tab says the page updates by itself.
   */
  confirming?: boolean
  /** Why the billing could not be read, or the checkout or the portal could not be opened. */
  error?: string | null
  /** New on every refusal, so focus moves to the message even when its text repeats. */
  errorId?: number
  /** The checkout or the portal is being opened: every button that opens one is busy. */
  pending?: boolean
  /** Now, for the days a trial has left. Tests pass a fixed one. */
  now?: Date
  /** Opens the provider's checkout for the paid plan. */
  onCheckout?: (planId: string) => void
  /** Opens the provider's portal: the card, the invoices, cancelling and renewing. */
  onPortal?: () => void
}

/**
 * A group's Plan and billing tab: what the group pays, when, and for the owner the one way to
 * change it. A free group's owner starts the trial or upgrades (the provider's checkout); a paying
 * group's owner changes the card, reads the invoices and cancels or renews (the provider's portal).
 * Anyone else reads the plan and who can change it, with no button at all. Every figure is the
 * server's: the plan's price times the members.
 */
export function GroupBillingPanel(props: GroupBillingPanelProps): JSX.Element {
  const { billing, groupName, error = null, errorId } = props
  const message = useRef<HTMLDivElement>(null)
  // A refused checkout or portal has no field to fix, so focus lands on the message.
  useEffect(() => {
    if (error && billing) message.current?.focus()
  }, [error, errorId])
  return (
    <SettingGroup
      title="Plan and billing"
      description={`What ${groupName} pays each month. Billing is handled by Stripe.`}
      dataE2E="group-section-billing"
    >
      {billing === null
        ? (error
          ? <ErrorState message={error} />
          : (
            <div role="status" aria-label="Loading the plan">
              <LoadingSkeleton rows={2} />
            </div>
          ))
        : (
          <div
            class="flex flex-col gap-4"
            data-e2e="billing-plan"
            data-plan={billing.planId}
            data-state={billingState(billing)}
          >
            <PlanSummary {...props} billing={billing} />
            {billing.canManage && <PortalRows {...props} billing={billing} />}
            <div ref={message} tabIndex={-1} data-e2e="billing-error">
              <ErrorState message={billing ? error : null} />
            </div>
          </div>
        )}
    </SettingGroup>
  )
}

/** The card that says which plan the group is on, what it costs, and the one primary action. */
function PlanSummary(props: GroupBillingPanelProps & { billing: GroupBilling }): JSX.Element {
  const { billing, groupId, groupName, memberCount, ownerName, trial, confirming = false } = props
  const { pending = false, now = new Date(), onCheckout, onPortal } = props
  const state = billingState(billing)
  const owner = billing.canManage
  const name = findPlan(billing.planId)?.name ?? billing.planId
  const money = (amount: number) => formatMoney(amount, PRO.currency)
  const seats = billing.seatPrice
  const total = seats && formatMoney(seats.amount * seats.seats, seats.currency)
  const periodEnd = billing.currentPeriodEnd && billingDate(billing.currentPeriodEnd)

  // The renewal date and a failed payment are the owner's business, as the payment notice is.
  const status = !owner
    ? null
    : state === BillingState.TRIAL
    ? "Trial"
    : state === BillingState.PRO && periodEnd
    ? `Renews on ${periodEnd}`
    : state === BillingState.ENDING && periodEnd
    ? `Ends on ${periodEnd}`
    : state === BillingState.PAST_DUE
    ? "Payment failed"
    : null

  let body: ComponentChildren = null
  let action: ComponentChildren = null
  let fine: ComponentChildren = null
  if (state === BillingState.OFF) {
    body = <p data-e2e="billing-off">Every group is on the free plan.</p>
  } else if (!owner) {
    body = (
      <p data-e2e="billing-owner-only">
        Only {ownerName ?? "the owner"}, the group's owner, can change its plan or see invoices.
      </p>
    )
  } else if (state === BillingState.FREE) {
    // A group that ever paid, or an owner whose one trial went to another group, gets no trial. The
    // group that holds the trial gets it again: its checkout claims the same trial.
    const trialUsed = (trial?.used ?? false) && trial?.groupId !== groupId
    const withTrial = PRO.trialDays > 0 && !trialUsed && !billing.hasCustomer
    body = (
      <p>
        {PRO.name} costs {money(PRO.amount)} per member a month.
        {memberCount !== null &&
          ` With ${members(memberCount)}, ${groupName} would pay ${
            money(PRO.amount * memberCount)
          } a month.`}
      </p>
    )
    // Back from the checkout, the payment is on its way: a second checkout could be paid twice.
    action = !billing.subscribed && !confirming && (
      <Button
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        busy={pending}
        busyLabel="Opening Stripe…"
        data-e2e="billing-checkout"
        onClick={() => {
          if (!pending) onCheckout?.(PRO.id)
        }}
      >
        {withTrial ? `Start ${PRO.trialDays}-day free trial` : `Upgrade to ${PRO.name}`}{" "}
        <span class="sr-only">(opens Stripe)</span>
      </Button>
    )
    fine = !billing.subscribed && !confirming && (
      <>
        {trialUsed && (
          <span class="block" data-e2e="billing-trial-used">
            You have used your free trial on another group.
          </span>
        )}
        Billed monthly per member. Cancel any time; you keep {PRO.name} until the period ends.
      </>
    )
  } else if (state === BillingState.TRIAL) {
    const end = billing.trialEnd ?? billing.currentPeriodEnd
    const left = end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) : null
    body = (
      <p data-e2e="billing-trial">
        {end && left !== null && `The trial ends in ${days(left)}, on ${billingDate(end)}. `}
        {total ? `Then ${groupName} pays ${total} a month unless you cancel.` : null}
      </p>
    )
  } else if (state === BillingState.PRO) {
    body = seats && (
      <p data-e2e="billing-seats">
        {total} a month, for {members(seats.seats)} at {money(seats.amount)}{" "}
        each, the owner included.
      </p>
    )
  } else if (state === BillingState.ENDING) {
    body = (
      <p data-e2e="billing-ending">
        {name} ends on{" "}
        {periodEnd ?? "the end of the period"}. The group then moves to the free plan.
      </p>
    )
    action = (
      <Button
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        busy={pending}
        busyLabel="Opening Stripe…"
        data-e2e="billing-renew"
        onClick={() => {
          if (!pending) onPortal?.()
        }}
      >
        Renew {name} <span class="sr-only">(opens Stripe)</span>
      </Button>
    )
  } else if (
    state === BillingState.PAST_DUE && billing.notice?.kind === BillingNoticeKind.PaymentFailed
  ) {
    body = (
      <Notice tone="warning" data-e2e="billing-notice" data-kind={billing.notice.kind}>
        {paymentFailedText(billing.notice, PRO.name)}
      </Notice>
    )
  }

  return (
    <Card>
      <div class="flex flex-col gap-3 px-4 py-4 sm:px-6">
        <h3 class="text-base font-medium text-foreground">
          <span data-e2e="billing-plan-name">{name}</span> plan{" "}
          {status && (
            <span class="font-normal text-muted" data-e2e="billing-status">· {status}</span>
          )}
        </h3>
        {body && <div class="text-sm text-muted">{body}</div>}
        {confirming && state === BillingState.FREE && (
          <p role="status" class="text-sm text-muted" data-e2e="billing-confirming">
            Stripe is confirming your plan. This page updates by itself.
          </p>
        )}
        {action && <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">{action}</div>}
        {fine && (
          <p class="text-sm text-muted sm:text-right" data-e2e="billing-fine-print">{fine}</p>
        )}
      </div>
    </Card>
  )
}

/**
 * The owner's ways into the provider's portal, one row each: the card, the invoices, and cancelling
 * while a trial or a paid plan still renews. A free group with past invoices keeps the invoices row; a group the
 * provider knows nothing of has none.
 */
function PortalRows(props: GroupBillingPanelProps & { billing: GroupBilling }): JSX.Element | null {
  const { billing, pending = false, onPortal } = props
  if (!billing.subscribed && !billing.hasCustomer) return null
  const state = billingState(billing)
  const trialEnd = billing.trialEnd ?? billing.currentPeriodEnd
  const portal = (label: string, dataE2E: string) => (
    <Button
      variant="outline"
      size="sm"
      class="min-h-11 sm:min-h-9"
      busy={pending}
      data-e2e={dataE2E}
      onClick={() => {
        if (!pending) onPortal?.()
      }}
    >
      {label} <span class="sr-only">(opens Stripe)</span>
      <IconArrowUpRight class="size-4" aria-hidden="true" />
    </Button>
  )
  return (
    <SettingList>
      {billing.subscribed && (
        <SettingRow
          label="Payment method"
          value="The card Stripe charges each month."
          action={portal("Change card", "billing-portal-card")}
          dataE2E="billing-row-card"
        />
      )}
      <SettingRow
        label="Invoices"
        value="Every invoice and receipt, to read or download."
        action={portal("View invoices", "billing-portal-invoices")}
        dataE2E="billing-row-invoices"
      />
      {(state === BillingState.TRIAL || state === BillingState.PRO) && (
        <SettingRow
          label={`Cancel ${PRO.name}`}
          value={state === BillingState.TRIAL && trialEnd
            ? `Nothing is charged if you cancel before ${billingDate(trialEnd)}.`
            : `You keep ${PRO.name} until the period ends.`}
          action={portal("Cancel plan", "billing-portal-cancel")}
          dataE2E="billing-row-cancel"
        />
      )}
    </SettingList>
  )
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
