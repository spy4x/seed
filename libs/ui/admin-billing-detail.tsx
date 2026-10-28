// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import { timeAgo } from "@spy4x/platform/universal/time"
import { IconExternalLink } from "@spy4x/preact-icons"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioGroup } from "@spy4x/preact-ui/radio"
import { Timeline, type TimelineTone } from "@spy4x/preact-ui/timeline"
import {
  ADMIN_BILLING_NOTE_MAX_LENGTH,
  ADMIN_BILLING_SUPERVISOR_ACTIONS,
  ADMIN_BILLING_TIME_LABELS,
  ADMIN_BILLING_TIME_LENGTHS,
  type AdminBillingActionKind,
  adminBillingActionRefusal,
  type AdminBillingCustomer,
  type AdminBillingDetail,
  type AdminBillingHistoryEntry,
  type AdminBillingPayment,
  adminBillingStatus,
  type AdminBillingTimeLength,
  BILLING_AUDIT_EVENTS,
  BillingStatus,
  listPriceOf,
  noChargeUntil,
  planEndsIfCancelledAt,
  seatsOf,
} from "@domain/billing"
import { UserRole } from "@domain/identity"
import { ADMIN_GROUP_PATHS, adminGroupPersonName } from "./admin-groups-list.tsx"
import {
  ADMIN_BILLING_PATHS,
  billingDate,
  billingPlanName,
  BillingStatusLine,
  money,
  perMonth,
} from "./admin-billing-list.tsx"
import { useFormat } from "@spy4x/preact-ui/format"
import type { Formatters } from "@spy4x/time/format"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The signed-in operator, as far as the page needs them. */
export interface AdminBillingOperatorView {
  id: number
  role: UserRole
}

/** The dialogs of a customer's page. The cancel dialog chooses between the period's end and now. */
export type AdminBillingDialogKind = "refund" | "time" | "cancel" | "undo"

/** An action the operator confirmed, with everything its route needs but the idempotency key. */
export type AdminBillingAction =
  | { kind: "refund"; paymentId: string; note: string }
  | { kind: "time"; length: AdminBillingTimeLength; note: string }
  | { kind: "cancel"; when: "period_end" | "now"; note: string }
  | { kind: "undo"; note: string }

/** The last payment as the page reads it from Stripe, apart from the stored facts. */
export interface AdminBillingPaymentView {
  /** `undefined` while it loads, `null` when the customer has not paid yet. */
  payment: AdminBillingPayment | null | undefined
  /** Why Stripe did not give it, or `null`. */
  error: string | null
}

/** Why an action failed, and whether it may still have happened in Stripe. */
export interface AdminBillingActionError {
  message: string
  /** No clear answer came back: the dialog must not say that nothing changed. */
  unknown: boolean
}

/** An action went to Stripe; the stored subscription changes once its webhook lands. */
export interface AdminBillingWaiting {
  /** Two minutes passed with no change: the page points to Stripe instead. */
  timedOut: boolean
}

export interface AdminBillingCustomerScreenProps {
  /** The customer, or `null` while it loads or when it could not be read. */
  detail: AdminBillingDetail | null
  /** Why the customer could not be read, or `null`. */
  error: string | null
  payment: AdminBillingPaymentView
  operator: AdminBillingOperatorView
  /** The time the dates and the dialog's new end are read against. */
  now: Date
  /** Reads the customer again after a failure. */
  onRetry: () => void
  /** Asks Stripe for the last payment again after a failure. */
  onRetryPayment: () => void
  /** The open dialog, or `null`. */
  dialog: AdminBillingDialogKind | null
  onOpenDialog: (dialog: AdminBillingDialogKind) => void
  /** The operator closed the dialog: the app drops its error and its idempotency key. */
  onCloseDialog: () => void
  actionError: AdminBillingActionError | null
  pending: boolean
  onAction: (action: AdminBillingAction) => void
  waiting: AdminBillingWaiting | null
  navigate?: Navigate
}

/** The menu item's second line when the operator's role is too low for it (decision 6 of #196). */
export const NEEDS_SUPERVISOR = `Needs a supervisor`

/** Whether `role` may run `action`: refunds and cancelling at once need a supervisor. */
export function mayRun(role: UserRole, action: AdminBillingActionKind): boolean {
  return !ADMIN_BILLING_SUPERVISOR_ACTIONS.has(action) || role >= UserRole.SUPERVISOR
}

/** One menu entry of the page: shown or not, and when shown, why it cannot run, if it cannot. */
interface MenuEntry {
  dialog: AdminBillingDialogKind
  label: string
  danger: boolean
  /** Shown disabled with this reason, or `null` when it runs. */
  disabled: string | null
}

/**
 * The page's actions for this operator and this subscription (decisions 5 and 6 of #196). An
 * action that the subscription's state rules out is left out; one the operator's role or their
 * own membership rules out shows disabled with the reason. The API checks the same again.
 */
export function billingMenu(
  detail: AdminBillingDetail,
  payment: AdminBillingPaymentView,
  operator: AdminBillingOperatorView,
): MenuEntry[] {
  const { customer } = detail
  const allowed = (action: AdminBillingActionKind) =>
    adminBillingActionRefusal(action, customer) === null
  const blocked = (actions: AdminBillingActionKind[]): string | null =>
    detail.operatorIsMember
      ? `You belong to this group`
      : actions.some((action) => mayRun(operator.role, action))
      ? null
      : NEEDS_SUPERVISOR
  const entries: MenuEntry[] = []

  const paid = payment.payment
  if (paid === undefined || (paid !== null && !paid.refunded) || payment.error !== null) {
    entries.push({
      dialog: `refund`,
      label: `Refund the last payment`,
      danger: true,
      disabled: blocked([`refund`]) ??
        (payment.error !== null
          ? `Payment not loaded`
          : paid === undefined
          ? `Loading the payment`
          : null),
    })
  }
  if (allowed(`time`)) {
    entries.push({
      dialog: `time`,
      label: `Give time at no charge`,
      danger: false,
      disabled: blocked([`time`]),
    })
  }
  if (allowed(`undo`)) {
    entries.push({
      dialog: `undo`,
      label: `Undo the cancellation`,
      danger: false,
      disabled: blocked([`undo`]),
    })
  }
  const cancels = ([`cancel_period_end`, `cancel_now`] as const).filter(allowed)
  if (cancels.length > 0) {
    entries.push({
      dialog: `cancel`,
      label: `Cancel subscription`,
      danger: true,
      disabled: blocked([...cancels]),
    })
  }
  return entries
}

/**
 * One customer in the admin app (#196): its stored subscription, its last payment as Stripe gives
 * it when the page opens, a link to the customer in Stripe, and what operators did to it. The
 * actions sit in the header's "More actions" menu; each is confirmed in a dialog that names the
 * customer, the amount and what follows, and asks for an optional note for the audit log.
 */
export function AdminBillingCustomerScreen(props: AdminBillingCustomerScreenProps): JSX.Element {
  const { detail, error, navigate } = props
  const format = useFormat()
  const back = { href: ADMIN_BILLING_PATHS.list, label: `Billing` }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title="Customer" back={back} navigate={navigate} />
        {error
          ? (
            <div class="flex flex-col items-start gap-3" data-e2e="admin-billing-customer-error">
              <ErrorState message={error} />
              <Cluster>
                <Button variant="secondary" onClick={props.onRetry}>Try again</Button>
                <Link href={ADMIN_BILLING_PATHS.list} navigate={navigate} class="pc-link text-sm">
                  Back to Billing
                </Link>
              </Cluster>
            </div>
          )
          : (
            <div role="status" aria-label="Loading the group's billing">
              <LoadingSkeleton rows={5} />
            </div>
          )}
      </Stack>
    )
  }

  const { customer } = detail
  const view = adminBillingStatus(customer, props.now, detail.graceDays)
  const entries = billingMenu(detail, props.payment, props.operator)
  const owner = adminGroupPersonName(customer.owner)
  const stripe = detail.providerUrl && (
    <a
      href={detail.providerUrl}
      target="_blank"
      rel="noopener noreferrer"
      class={buttonClasses(`secondary`, `md`, `max-sm:size-11 max-sm:p-0`)}
      aria-label="Open in Stripe (opens a new tab)"
      data-e2e="admin-billing-stripe"
    >
      <IconExternalLink class="size-4" aria-hidden="true" />
      <span class="max-sm:hidden">Open in Stripe</span>
    </a>
  )

  return (
    <Stack>
      <PageHeader
        title={customer.groupName}
        subtitle={`Owned by ${owner}`}
        back={back}
        navigate={navigate}
        action={stripe || undefined}
        menu={entries.length > 0
          ? entries.map((entry) => (
            <DropdownItem
              key={entry.dialog}
              danger={entry.danger}
              disabled={entry.disabled !== null}
              dataE2E={`admin-billing-open-${entry.dialog}`}
              onClick={() => props.onOpenDialog(entry.dialog)}
            >
              <span class="flex w-full items-center justify-between gap-4">
                <span>{entry.label}</span>
                {entry.disabled && <span class="text-xs text-muted">{entry.disabled}</span>}
              </span>
            </DropdownItem>
          ))
          : undefined}
        menuDataE2E="admin-billing-menu"
        titleDataE2E="admin-billing-customer-title"
      />

      {detail.operatorIsMember && (
        <Notice tone="info" data-e2e="admin-billing-member">
          You own or belong to this group, so another operator handles its billing.
        </Notice>
      )}
      {customer.groupDeletedAt && customer.status !== BillingStatus.Canceled && (
        <Notice tone="danger" data-e2e="admin-billing-deleted-notice">
          This group is in the trash but its subscription still bills. Cancel it.
        </Notice>
      )}
      {props.waiting && <Waiting waiting={props.waiting} providerUrl={detail.providerUrl} />}

      <dl
        class="grid grid-cols-1 gap-4 rounded-xl border border-subtle bg-surface p-4 sm:grid-cols-[10rem_1fr]"
        data-e2e="admin-billing-summary"
      >
        <Fact label="Status">
          <BillingStatusLine view={view} dataE2E="admin-billing-status" />
        </Fact>
        <Fact label="Plan">{planLine(customer)}</Fact>
        <Fact label="Per month">
          <span data-e2e="admin-billing-per-month">{perMonthLine(customer)}</span>
        </Fact>
        <Fact label="Last payment">
          <LastPayment {...props.payment} onRetry={props.onRetryPayment} />
        </Fact>
        <Fact label="Customer since">
          {detail.customerSince ? billingDate(detail.customerSince, format) : `Not recorded`}
        </Fact>
        {customer.owner.email && (
          <Fact label="Owner's email">
            <span class="wrap-anywhere" data-e2e="admin-billing-owner-email">
              {customer.owner.email}
            </span>
          </Fact>
        )}
        <Fact label="Group">
          <Link
            href={ADMIN_GROUP_PATHS.group(customer.groupId)}
            navigate={navigate}
            class="pc-link wrap-anywhere"
            data-e2e="admin-billing-group"
          >
            {customer.groupName}
          </Link>
        </Fact>
      </dl>

      <section class="flex flex-col gap-3" aria-labelledby="admin-billing-history">
        <h2 id="admin-billing-history" class="text-base font-semibold">Billing history</h2>
        <Timeline
          label="Billing history"
          empty="Nothing recorded."
          dataE2E="admin-billing-history"
          items={detail.history.map((entry) => ({
            id: entry.id,
            title: historyTitle(entry, format),
            at: entry.at,
            when: timeAgo(entry.at),
            description: historyDescription(entry),
            tone: historyTone(entry),
          }))}
        />
        <p class="text-sm text-muted">
          Operator actions only. Invoices, payments and plan changes are in Stripe.
          {detail.providerUrl && (
            <>
              {" "}
              <a
                href={detail.providerUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="pc-link"
              >
                Open in Stripe
              </a>
            </>
          )}
        </p>
      </section>

      {props.dialog && <ActionDialog {...props} dialog={props.dialog} detail={detail} />}
    </Stack>
  )
}

/** One fact of the summary: its label on the left, or above it on a phone. */
function Fact({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <>
      <dt class="text-sm text-muted">{label}</dt>
      <dd class="min-w-0 text-sm font-medium max-sm:-mt-3">{children}</dd>
    </>
  )
}

/** `Pro, 4 members`. */
function planLine(customer: AdminBillingCustomer): string {
  const seats = seatsOf(customer)
  return `${billingPlanName(customer.planId)}, ${seats} ${seats === 1 ? `member` : `members`}`
}

/** `4 × €9.00 = €36.00`, or what a trial would pay. */
function perMonthLine(customer: AdminBillingCustomer): string {
  const amount = perMonth(customer)
  if (amount === null) return `Unknown price: Stripe bills a price no plan here maps to`
  if (amount.detail === null) return amount.amount
  return customer.status === BillingStatus.Trialing
    ? `${amount.amount} during the trial, ${amount.detail}`
    : `${amount.detail} = ${amount.amount}`
}

/** The last payment line: loading, failed with a retry, none yet, or the amount and its date. */
function LastPayment(
  { payment, error, onRetry }: AdminBillingPaymentView & { onRetry: () => void },
): JSX.Element {
  const format = useFormat()
  if (error !== null) {
    return (
      <span class="flex flex-wrap items-center gap-2" data-e2e="admin-billing-payment-error">
        <span class="font-normal text-danger">{error}</span>
        <Button variant="ghost" size="sm" onClick={onRetry}>Try again</Button>
      </span>
    )
  }
  if (payment === undefined) {
    return (
      <span role="status" aria-label="Loading the last payment" class="block w-40">
        <LoadingSkeleton rows={1} />
      </span>
    )
  }
  if (payment === null) return <span data-e2e="admin-billing-payment">None yet</span>
  return (
    <span data-e2e="admin-billing-payment">
      {paymentAmount(payment)} on {billingDate(payment.paidAt, format)}
      {payment.refunded ? `, refunded` : payment.amountRefunded > 0 ? `, partly refunded` : ``}
    </span>
  )
}

function paymentAmount(payment: Pick<AdminBillingPayment, "amount" | "currency">): string {
  return formatMoney(payment.amount, payment.currency)
}

/** What the operator did, as the history names it. */
export function historyTitle(
  entry: AdminBillingHistoryEntry,
  format: Pick<Formatters, "date">,
): string {
  switch (entry.event) {
    case BILLING_AUDIT_EVENTS.paymentRefunded:
      return entry.amount
        ? `${formatMoney(entry.amount.amount, entry.amount.currency)} refunded`
        : `Payment refunded`
    case BILLING_AUDIT_EVENTS.timeGiven:
      return entry.until
        ? `No charge until ${billingDate(entry.until, format)}`
        : `Time given at no charge`
    case BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd:
      return `Set to cancel at the period's end`
    case BILLING_AUDIT_EVENTS.cancelledNow:
      return `Cancelled at once`
    case BILLING_AUDIT_EVENTS.cancellationUndone:
      return `Cancellation undone`
  }
}

function historyDescription(entry: AdminBillingHistoryEntry): string {
  const by = `By ${entry.operator ?? `a removed operator`}.`
  return entry.note ? `${by} Note: ${entry.note}` : by
}

function historyTone(entry: AdminBillingHistoryEntry): TimelineTone {
  return entry.event === BILLING_AUDIT_EVENTS.cancelledNow ||
      entry.event === BILLING_AUDIT_EVENTS.paymentRefunded
    ? `warning`
    : `neutral`
}

/** The notice while an action waits for Stripe's webhook, and after two minutes without one. */
function Waiting(
  { waiting, providerUrl }: { waiting: AdminBillingWaiting; providerUrl: string | null },
): JSX.Element {
  if (!waiting.timedOut) {
    return (
      <Notice tone="info" data-e2e="admin-billing-waiting">
        Sent to Stripe, waiting for confirmation. The page updates once Stripe confirms, usually
        within a minute.
      </Notice>
    )
  }
  return (
    <Notice tone="warning" data-e2e="admin-billing-waiting">
      Stripe has not confirmed yet. Check the customer in Stripe.{" "}
      {providerUrl && (
        <a href={providerUrl} target="_blank" rel="noopener noreferrer" class="pc-link">
          Open in Stripe
        </a>
      )}
    </Notice>
  )
}

interface DialogCopy {
  title: string
  submit: string
  busy: string
  danger: boolean
}

/**
 * What cancelling at the period's end leaves the group: its plan until the period's end, or until an
 * earlier grace or trial end, or nothing more when that end has passed and it is on Free already.
 */
function periodEndHelp(
  group: string,
  plan: string,
  keptUntil: Date | null,
  periodEnd: string | null,
  now: Date,
  format: Pick<Formatters, "date">,
): string {
  const renew = `Its owner can renew it under Manage billing before the period ends.`
  if (keptUntil !== null && keptUntil.getTime() <= now.getTime()) {
    return `${group} is already on Free and is not charged again. ${renew}`
  }
  if (keptUntil === null || (periodEnd !== null && keptUntil.getTime() === Date.parse(periodEnd))) {
    return `${group} keeps ${plan} until then and is not charged again. ${renew}`
  }
  return `${group} keeps ${plan} until ${
    billingDate(keptUntil.toISOString(), format)
  } and is not charged again. ${renew}`
}

/** The dialog of one action: what it does, its choice when it has one, the note and its button. */
function ActionDialog(
  props: AdminBillingCustomerScreenProps & {
    dialog: AdminBillingDialogKind
    detail: AdminBillingDetail
  },
): JSX.Element {
  const { dialog, detail, operator, pending, onAction, onCloseDialog, actionError } = props
  const { customer } = detail
  const format = useFormat()
  const group = customer.groupName
  const plan = billingPlanName(customer.planId)
  const price = listPriceOf(customer)
  const charge = price ? money(price) : `its plan's price`
  const periodEnd = customer.currentPeriodEnd
    ? billingDate(customer.currentPeriodEnd, format)
    : null
  const keptUntil = planEndsIfCancelledAt(customer, detail.graceDays)
  const payment = props.payment.payment ?? null

  const [length, setLength] = useState<AdminBillingTimeLength>(`1m`)
  const nowAllowed = mayRun(operator.role, `cancel_now`)
  const periodAllowed = adminBillingActionRefusal(`cancel_period_end`, customer) === null
  const [when, setWhen] = useState<`period_end` | `now`>(periodAllowed ? `period_end` : `now`)

  let copy: DialogCopy
  let body: ComponentChildren
  switch (dialog) {
    case `refund`: {
      const amount = payment ? paymentAmount(payment) : ``
      copy = {
        title: `Refund ${amount} to ${group}?`,
        submit: `Refund ${amount}`,
        busy: `Refunding…`,
        danger: true,
      }
      body = payment && (
        <p class="text-sm text-muted">
          Stripe returns the {amount} paid on {billingDate(payment.paidAt, format)}{" "}
          to the card it came from. The subscription keeps running; to stop it, cancel it too.
        </p>
      )
      break
    }
    case `time`: {
      const until = billingDate(noChargeUntil(customer, length, props.now).toISOString(), format)
      copy = {
        title: `Give ${group} time at no charge`,
        submit: `Give ${ADMIN_BILLING_TIME_LABELS[length]} at no charge`,
        busy: `Saving…`,
        danger: false,
      }
      body = (
        <>
          <RadioGroup
            legend="For how long"
            name="length"
            required
            value={length}
            onChange={(value) => setLength(value as AdminBillingTimeLength)}
            data-e2e="admin-billing-length"
            options={ADMIN_BILLING_TIME_LENGTHS.map((value) => ({
              value,
              label: ADMIN_BILLING_TIME_LABELS[value],
            }))}
          />
          <p class="text-sm text-muted" aria-live="polite" data-e2e="admin-billing-until">
            {group} keeps {plan} and nothing is charged until{" "}
            {until}. After that, the normal charge of {charge} a month starts again.
          </p>
        </>
      )
      break
    }
    case `cancel`:
      copy = {
        title: `Cancel ${group}'s subscription?`,
        submit: `Cancel subscription`,
        busy: `Cancelling…`,
        danger: true,
      }
      body = (
        <RadioGroup
          legend="When"
          name="when"
          required
          value={when}
          onChange={(value) => setWhen(value as `period_end` | `now`)}
          data-e2e="admin-billing-when"
          options={[
            {
              value: `period_end`,
              disabled: !periodAllowed,
              label: (
                <OptionLabel
                  title={periodEnd
                    ? `At the end of the period, on ${periodEnd}`
                    : `At the end of the period`}
                  help={periodAllowed
                    ? periodEndHelp(
                      group,
                      plan,
                      keptUntil,
                      customer.currentPeriodEnd,
                      props.now,
                      format,
                    )
                    : `Already set to end then.`}
                />
              ),
            },
            {
              value: `now`,
              disabled: !nowAllowed,
              label: (
                <OptionLabel
                  title="Now"
                  help={nowAllowed
                    ? `${group} moves to Free at once. The current period is not refunded; refund it separately if needed. The owner is not told.`
                    : NEEDS_SUPERVISOR}
                />
              ),
            },
          ]}
        />
      )
      break
    case `undo`:
      copy = {
        title: `Keep ${group}'s subscription?`,
        submit: `Keep subscription`,
        busy: `Saving…`,
        danger: false,
      }
      body = (
        <p class="text-sm text-muted">
          {plan} renews{periodEnd ? ` on ${periodEnd}` : ``} and is charged {charge} as usual.
        </p>
      )
      break
  }

  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel="Close"
      tone={copy.danger ? `danger` : `default`}
      dataE2E="admin-billing-dialog"
    >
      <ScreenForm
        pending={pending}
        onSubmit={(data) => {
          const note = String(data.get(`note`) ?? ``).trim()
          switch (dialog) {
            case `refund`:
              if (payment) onAction({ kind: `refund`, paymentId: payment.id, note })
              return
            case `time`:
              onAction({ kind: `time`, length, note })
              return
            case `cancel`:
              onAction({ kind: `cancel`, when, note })
              return
            case `undo`:
              onAction({ kind: `undo`, note })
          }
        }}
      >
        <Stack>
          {body}
          <Field
            id="admin-billing-note"
            label="Note for the audit log (optional)"
            hint="Why you did this. Other operators see it in the audit log."
          >
            <Input
              name="note"
              maxLength={ADMIN_BILLING_NOTE_MAX_LENGTH}
              autocomplete="off"
              data-e2e="admin-billing-note"
            />
          </Field>
          {actionError && (
            actionError.unknown
              ? (
                <Notice tone="warning" title="Result unknown" data-e2e="admin-billing-dialog-error">
                  {actionError.message}
                </Notice>
              )
              : <ErrorState message={actionError.message} dataE2E="admin-billing-dialog-error" />
          )}
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCloseDialog}>Close</Button>
            <Button
              type="submit"
              variant={copy.danger ? `danger` : `primary`}
              data-e2e="admin-billing-action-submit"
              busy={pending}
              busyLabel={copy.busy}
            >
              {copy.submit}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}

/** A radio option's name and the sentence under it. */
function OptionLabel({ title, help }: { title: string; help: string }): JSX.Element {
  return (
    <span class="flex flex-col gap-1">
      <span class="font-medium">{title}</span>
      <span class="text-sm text-muted">{help}</span>
    </span>
  )
}
