import type { ComponentChildren, JSX } from "preact"
import { useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
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
import { useFormat, When } from "@spy4x/preact-ui/format"
import type { Formatters } from "@spy4x/time/format"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

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
const NEEDS_SUPERVISOR = `AdminBillingCustomer.needsSupervisor`

/** Each length of free time as a person reads it, by catalog key. */
const TIME_LABELS: Record<AdminBillingTimeLength, string> = {
  "7d": `AdminBillingCustomer.length7d`,
  "14d": `AdminBillingCustomer.length14d`,
  "30d": `AdminBillingCustomer.length30d`,
  "1m": `AdminBillingCustomer.length1m`,
  "3m": `AdminBillingCustomer.length3m`,
  "6m": `AdminBillingCustomer.length6m`,
  "12m": `AdminBillingCustomer.length12m`,
}

/** Whether `role` may run `action`: refunds and cancelling at once need a supervisor. */
export function mayRun(role: UserRole, action: AdminBillingActionKind): boolean {
  return !ADMIN_BILLING_SUPERVISOR_ACTIONS.has(action) || role >= UserRole.SUPERVISOR
}

/** One menu entry of the page: shown or not, and when shown, why it cannot run, if it cannot. */
interface MenuEntry {
  dialog: AdminBillingDialogKind
  /** The entry's name, a catalog key. */
  label: string
  danger: boolean
  /** Shown disabled with this reason (a catalog key), or `null` when it runs. */
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
      ? `AdminBillingCustomer.youBelong`
      : actions.some((action) => mayRun(operator.role, action))
      ? null
      : NEEDS_SUPERVISOR
  const entries: MenuEntry[] = []

  const paid = payment.payment
  if (paid === undefined || (paid !== null && !paid.refunded) || payment.error !== null) {
    entries.push({
      dialog: `refund`,
      label: `AdminBillingCustomer.refundLast`,
      danger: true,
      disabled: blocked([`refund`]) ??
        (payment.error !== null
          ? `AdminBillingCustomer.paymentNotLoaded`
          : paid === undefined
          ? `AdminBillingCustomer.loadingPayment`
          : null),
    })
  }
  if (allowed(`time`)) {
    entries.push({
      dialog: `time`,
      label: `AdminBillingCustomer.giveTime`,
      danger: false,
      disabled: blocked([`time`]),
    })
  }
  if (allowed(`undo`)) {
    entries.push({
      dialog: `undo`,
      label: `AdminBillingCustomer.undoCancel`,
      danger: false,
      disabled: blocked([`undo`]),
    })
  }
  const cancels = ([`cancel_period_end`, `cancel_now`] as const).filter(allowed)
  if (cancels.length > 0) {
    entries.push({
      dialog: `cancel`,
      label: `AdminBillingCustomer.cancel`,
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
  const t = useAdminText()
  const back = { href: ADMIN_BILLING_PATHS.list, label: t.t(`AdminBillingCustomer.back`) }

  if (!detail) {
    return (
      <Stack>
        <PageHeader title={t.t(`AdminBillingCustomer.title`)} back={back} navigate={navigate} />
        {error
          ? (
            <div class="flex flex-col items-start gap-3" data-e2e="admin-billing-customer-error">
              <ErrorState message={error} />
              <Cluster>
                <Button variant="secondary" onClick={props.onRetry}>
                  {t.t(`AdminBillingCustomer.retry`)}
                </Button>
                <Link href={ADMIN_BILLING_PATHS.list} navigate={navigate} class="pc-link text-sm">
                  {t.t(`AdminBillingCustomer.backToBilling`)}
                </Link>
              </Cluster>
            </div>
          )
          : (
            <div role="status" aria-label={t.t(`AdminBillingCustomer.loading`)}>
              <LoadingSkeleton rows={5} />
            </div>
          )}
      </Stack>
    )
  }

  const { customer } = detail
  const view = adminBillingStatus(customer, props.now, detail.graceDays)
  const entries = billingMenu(detail, props.payment, props.operator)
  const owner = adminGroupPersonName(t, customer.owner)
  const stripe = detail.providerUrl && (
    <a
      href={detail.providerUrl}
      target="_blank"
      rel="noopener noreferrer"
      class={buttonClasses(`secondary`, `md`, `max-sm:size-11 max-sm:p-0`)}
      aria-label={t.t(`AdminBillingCustomer.openStripeLabel`)}
      data-e2e="admin-billing-stripe"
    >
      <IconExternalLink class="size-4" aria-hidden="true" />
      <span class="max-sm:hidden">{t.t(`AdminBillingCustomer.openStripe`)}</span>
    </a>
  )

  return (
    <Stack>
      <PageHeader
        title={customer.groupName}
        subtitle={t.t(`AdminBillingCustomer.ownedBy`, { owner })}
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
                <span>{t.t(entry.label)}</span>
                {entry.disabled && <span class="text-xs text-muted">{t.t(entry.disabled)}</span>}
              </span>
            </DropdownItem>
          ))
          : undefined}
        menuDataE2E="admin-billing-menu"
        titleDataE2E="admin-billing-customer-title"
      />

      {detail.operatorIsMember && (
        <Notice tone="info" data-e2e="admin-billing-member">
          {t.t(`AdminBillingCustomer.member`)}
        </Notice>
      )}
      {customer.groupDeletedAt && customer.status !== BillingStatus.Canceled && (
        <Notice tone="danger" data-e2e="admin-billing-deleted-notice">
          {t.t(`AdminBillingCustomer.deleted`)}
        </Notice>
      )}
      {props.waiting && <Waiting waiting={props.waiting} providerUrl={detail.providerUrl} />}

      <dl
        class="grid grid-cols-1 gap-4 rounded-xl border border-subtle bg-surface p-4 sm:grid-cols-[10rem_1fr]"
        data-e2e="admin-billing-summary"
      >
        <Fact label={t.t(`AdminBillingCustomer.status`)}>
          <BillingStatusLine view={view} dataE2E="admin-billing-status" />
        </Fact>
        <Fact label={t.t(`AdminBillingCustomer.plan`)}>{planLine(t, customer)}</Fact>
        <Fact label={t.t(`AdminBillingCustomer.perMonth`)}>
          <span data-e2e="admin-billing-per-month">{perMonthLine(t, customer)}</span>
        </Fact>
        <Fact label={t.t(`AdminBillingCustomer.lastPayment`)}>
          <LastPayment {...props.payment} onRetry={props.onRetryPayment} />
        </Fact>
        <Fact label={t.t(`AdminBillingCustomer.customerSince`)}>
          {detail.customerSince
            ? billingDate(detail.customerSince, format)
            : t.t(`AdminBillingCustomer.notRecorded`)}
        </Fact>
        {customer.owner.email && (
          <Fact label={t.t(`AdminBillingCustomer.ownerEmail`)}>
            <span class="wrap-anywhere" translate={false} data-e2e="admin-billing-owner-email">
              {customer.owner.email}
            </span>
          </Fact>
        )}
        <Fact label={t.t(`AdminBillingCustomer.group`)}>
          <Link
            href={ADMIN_GROUP_PATHS.group(customer.groupId)}
            navigate={navigate}
            class="pc-link wrap-anywhere"
            translate={false}
            data-e2e="admin-billing-group"
          >
            {customer.groupName}
          </Link>
        </Fact>
      </dl>

      <section class="flex flex-col gap-3" aria-labelledby="admin-billing-history">
        <h2 id="admin-billing-history" class="text-base font-semibold">
          {t.t(`AdminBillingCustomer.history`)}
        </h2>
        <Timeline
          label={t.t(`AdminBillingCustomer.history`)}
          empty={t.t(`AdminBillingCustomer.nothingRecorded`)}
          dataE2E="admin-billing-history"
          items={detail.history.map((entry) => ({
            id: entry.id,
            title: historyTitle(t, entry, format),
            at: entry.at,
            when: <When at={entry.at} />,
            description: historyDescription(t, entry),
            tone: historyTone(entry),
          }))}
        />
        <p class="text-sm text-muted">
          {t.t(`AdminBillingCustomer.historyNote`)}
          {detail.providerUrl && (
            <>
              {" "}
              <a
                href={detail.providerUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="pc-link"
              >
                {t.t(`AdminBillingCustomer.openStripe`)}
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
function planLine(t: Translator<string>, customer: AdminBillingCustomer): string {
  return t.t(`AdminBillingCustomer.planLine`, {
    plan: billingPlanName(t, customer.planId),
    count: seatsOf(customer),
  })
}

/** `4 × €9.00 = €36.00`, or what a trial would pay. */
function perMonthLine(t: Translator<string>, customer: AdminBillingCustomer): string {
  const amount = perMonth(t, customer)
  if (amount === null) return t.t(`AdminBillingCustomer.unknownPrice`)
  if (amount.detail === null) return amount.amount
  return t.t(
    customer.status === BillingStatus.Trialing
      ? `AdminBillingCustomer.duringTrial`
      : `AdminBillingCustomer.seatsTotal`,
    { amount: amount.amount, detail: amount.detail },
  )
}

/** The last payment line: loading, failed with a retry, none yet, or the amount and its date. */
function LastPayment(
  { payment, error, onRetry }: AdminBillingPaymentView & { onRetry: () => void },
): JSX.Element {
  const format = useFormat()
  const t = useAdminText()
  if (error !== null) {
    return (
      <span class="flex flex-wrap items-center gap-2" data-e2e="admin-billing-payment-error">
        <span class="font-normal text-danger">{error}</span>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {t.t(`AdminBillingCustomer.retry`)}
        </Button>
      </span>
    )
  }
  if (payment === undefined) {
    return (
      <span
        role="status"
        aria-label={t.t(`AdminBillingCustomer.loadingLastPayment`)}
        class="block w-40"
      >
        <LoadingSkeleton rows={1} />
      </span>
    )
  }
  if (payment === null) {
    return <span data-e2e="admin-billing-payment">{t.t(`AdminBillingCustomer.noneYet`)}</span>
  }
  const key = payment.refunded
    ? `AdminBillingCustomer.paymentRefunded`
    : payment.amountRefunded > 0
    ? `AdminBillingCustomer.paymentPartlyRefunded`
    : `AdminBillingCustomer.paymentOn`
  return (
    <span data-e2e="admin-billing-payment">
      {t.t(key, { amount: paymentAmount(payment), date: billingDate(payment.paidAt, format) })}
    </span>
  )
}

function paymentAmount(payment: Pick<AdminBillingPayment, "amount" | "currency">): string {
  return formatMoney(payment.amount, payment.currency)
}

/** What the operator did, as the history names it, in the operator's language. */
export function historyTitle(
  t: Translator<string>,
  entry: AdminBillingHistoryEntry,
  format: Pick<Formatters, "date">,
): string {
  switch (entry.event) {
    case BILLING_AUDIT_EVENTS.paymentRefunded:
      return entry.amount
        ? t.t(`AdminBillingCustomer.amountRefunded`, {
          amount: formatMoney(entry.amount.amount, entry.amount.currency),
        })
        : t.t(`AdminBillingCustomer.paymentRefundedTitle`)
    case BILLING_AUDIT_EVENTS.timeGiven:
      return entry.until
        ? t.t(`AdminBillingCustomer.noChargeUntil`, { date: billingDate(entry.until, format) })
        : t.t(`AdminBillingCustomer.timeGiven`)
    case BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd:
      return t.t(`AdminBillingCustomer.setToCancel`)
    case BILLING_AUDIT_EVENTS.cancelledNow:
      return t.t(`AdminBillingCustomer.cancelledNow`)
    case BILLING_AUDIT_EVENTS.cancellationUndone:
      return t.t(`AdminBillingCustomer.cancellationUndone`)
  }
}

function historyDescription(t: Translator<string>, entry: AdminBillingHistoryEntry): string {
  const by = entry.operator
    ? t.t(`AdminBillingCustomer.by`, { operator: entry.operator })
    : t.t(`AdminBillingCustomer.byRemoved`)
  return entry.note ? `${by} ${t.t(`AdminBillingCustomer.note`, { note: entry.note })}` : by
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
  const t = useAdminText()
  if (!waiting.timedOut) {
    return (
      <Notice tone="info" data-e2e="admin-billing-waiting">
        {t.t(`AdminBillingCustomer.waiting`)}
      </Notice>
    )
  }
  return (
    <Notice tone="warning" data-e2e="admin-billing-waiting">
      {t.t(`AdminBillingCustomer.timedOut`)}{" "}
      {providerUrl && (
        <a href={providerUrl} target="_blank" rel="noopener noreferrer" class="pc-link">
          {t.t(`AdminBillingCustomer.openStripe`)}
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
  t: Translator<string>,
  group: string,
  plan: string,
  keptUntil: Date | null,
  periodEnd: string | null,
  now: Date,
  format: Pick<Formatters, "date">,
): ComponentChildren {
  const sentence = (key: string, date?: string) => (
    <>
      <Rich
        parts={t.parts(key, { group, plan, date: date ?? `` })}
        tags={{ group: groupName }}
      />{" "}
      {t.t(`AdminBillingCustomer.renewHint`)}
    </>
  )
  if (keptUntil !== null && keptUntil.getTime() <= now.getTime()) {
    return sentence(`AdminBillingCustomer.alreadyFree`)
  }
  if (keptUntil === null || (periodEnd !== null && keptUntil.getTime() === Date.parse(periodEnd))) {
    return sentence(`AdminBillingCustomer.keepsUntilThen`)
  }
  return sentence(
    `AdminBillingCustomer.keepsUntil`,
    billingDate(keptUntil.toISOString(), format),
  )
}

/** A group's name inside a sentence: the group's own words, isolated and never machine-translated. */
function groupName(text: string): JSX.Element {
  return <bdi translate={false}>{text}</bdi>
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
  const t = useAdminText()
  const group = customer.groupName
  const plan = billingPlanName(t, customer.planId)
  const price = listPriceOf(customer)
  const charge = price ? money(price) : t.t(`AdminBillingCustomer.itsPlanPrice`)
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
        title: t.t(`AdminBillingCustomer.refundTitle`, { amount, group }),
        submit: t.t(`AdminBillingCustomer.refundSubmit`, { amount }),
        busy: t.t(`AdminBillingCustomer.refunding`),
        danger: true,
      }
      body = payment && (
        <p class="text-sm text-muted">
          {t.t(`AdminBillingCustomer.refundText`, {
            amount,
            date: billingDate(payment.paidAt, format),
          })}
        </p>
      )
      break
    }
    case `time`: {
      const until = billingDate(noChargeUntil(customer, length, props.now).toISOString(), format)
      copy = {
        title: t.t(`AdminBillingCustomer.timeTitle`, { group }),
        submit: t.t(`AdminBillingCustomer.timeSubmit`, { length: t.t(TIME_LABELS[length]) }),
        busy: t.t(`AdminBillingCustomer.saving`),
        danger: false,
      }
      body = (
        <>
          <RadioGroup
            legend={t.t(`AdminBillingCustomer.howLong`)}
            name="length"
            required
            value={length}
            onChange={(value) => setLength(value as AdminBillingTimeLength)}
            data-e2e="admin-billing-length"
            options={ADMIN_BILLING_TIME_LENGTHS.map((value) => ({
              value,
              label: t.t(TIME_LABELS[value]),
            }))}
          />
          <p class="text-sm text-muted" aria-live="polite" data-e2e="admin-billing-until">
            <Rich
              parts={t.parts(`AdminBillingCustomer.timeText`, { group, plan, date: until, charge })}
              tags={{ group: groupName }}
            />
          </p>
        </>
      )
      break
    }
    case `cancel`:
      copy = {
        title: t.t(`AdminBillingCustomer.cancelTitle`, { group }),
        submit: t.t(`AdminBillingCustomer.cancel`),
        busy: t.t(`AdminBillingCustomer.cancelling`),
        danger: true,
      }
      body = (
        <RadioGroup
          legend={t.t(`AdminBillingCustomer.when`)}
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
                    ? t.t(`AdminBillingCustomer.atPeriodEndOn`, { date: periodEnd })
                    : t.t(`AdminBillingCustomer.atPeriodEnd`)}
                  help={periodAllowed
                    ? periodEndHelp(
                      t,
                      group,
                      plan,
                      keptUntil,
                      customer.currentPeriodEnd,
                      props.now,
                      format,
                    )
                    : t.t(`AdminBillingCustomer.alreadySet`)}
                />
              ),
            },
            {
              value: `now`,
              disabled: !nowAllowed,
              label: (
                <OptionLabel
                  title={t.t(`AdminBillingCustomer.now`)}
                  help={nowAllowed
                    ? t.t(`AdminBillingCustomer.nowHelp`, { group })
                    : t.t(NEEDS_SUPERVISOR)}
                />
              ),
            },
          ]}
        />
      )
      break
    case `undo`:
      copy = {
        title: t.t(`AdminBillingCustomer.undoTitle`, { group }),
        submit: t.t(`AdminBillingCustomer.undoSubmit`),
        busy: t.t(`AdminBillingCustomer.saving`),
        danger: false,
      }
      body = (
        <p class="text-sm text-muted">
          {periodEnd
            ? t.t(`AdminBillingCustomer.renewsOn`, { plan, date: periodEnd, charge })
            : t.t(`AdminBillingCustomer.renews`, { plan, charge })}
        </p>
      )
      break
  }

  return (
    <Modal
      open
      onClose={onCloseDialog}
      title={copy.title}
      cancelLabel={t.t(`AdminBillingCustomer.close`)}
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
            label={t.t(`AdminBillingCustomer.noteLabel`)}
            hint={t.t(`AdminBillingCustomer.noteHint`)}
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
                <Notice
                  tone="warning"
                  title={t.t(`AdminBillingCustomer.resultUnknown`)}
                  data-e2e="admin-billing-dialog-error"
                >
                  {actionError.message}
                </Notice>
              )
              : <ErrorState message={actionError.message} dataE2E="admin-billing-dialog-error" />
          )}
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onCloseDialog}>
              {t.t(`AdminBillingCustomer.close`)}
            </Button>
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
function OptionLabel(
  { title, help }: { title: string; help: ComponentChildren },
): JSX.Element {
  return (
    <span class="flex flex-col gap-1">
      <span class="font-medium">{title}</span>
      <span class="text-sm text-muted">{help}</span>
    </span>
  )
}
