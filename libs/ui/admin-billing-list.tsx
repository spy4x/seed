import type { JSX } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { formatMoney } from "@spy4x/platform/universal/money"
import { Kpi, KpiGrid } from "@spy4x/preact-charts/kpi"
import { IconCreditCard, IconExternalLink } from "@spy4x/preact-icons"
import { Badge, type BadgeColor } from "@spy4x/preact-ui/badge"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Link } from "@spy4x/preact-ui/link"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import {
  ADMIN_BILLING_SEARCH_MAX_LENGTH,
  type AdminBillingCustomer,
  type AdminBillingFigures,
  type AdminBillingFilter,
  type AdminBillingListResponse,
  AdminBillingState,
  adminBillingStatus,
  type AdminBillingStatusFilter,
  type AdminBillingStatusView,
  BILLING_AUDIT_EVENTS,
  type BillingAuditEvent,
  BillingStatus,
  findPlan,
  listPriceOf,
  type Money,
  monthlyRevenueOf,
  seatsOf,
} from "@domain/billing"
import { adminGroupPersonName } from "./admin-groups-list.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"
import { useFormat, When } from "@spy4x/preact-ui/format"
import type { Formatters } from "@spy4x/time/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

/** The billing module's pages in the admin app. */
export const ADMIN_BILLING_PATHS = {
  list: `/billing`,
  customer: (groupId: string) => `/billing/${encodeURIComponent(groupId)}`,
} as const

/** Where the billing setup is described, for the action of the "Billing is off" state. */
export const ADMIN_BILLING_SETUP_URL = `https://github.com/spy4x/seed/blob/main/docs/billing.md`

/**
 * What each billing action is called in the audit log and on the person page, as a catalog key per
 * event code.
 */
export const BILLING_AUDIT_LABELS: Record<BillingAuditEvent, string> = {
  [BILLING_AUDIT_EVENTS.paymentRefunded]: `AdminAuditEvent.paymentRefunded`,
  [BILLING_AUDIT_EVENTS.timeGiven]: `AdminAuditEvent.timeGiven`,
  [BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd]: `AdminAuditEvent.cancelAtPeriodEnd`,
  [BILLING_AUDIT_EVENTS.cancelledNow]: `AdminAuditEvent.cancelledNow`,
  [BILLING_AUDIT_EVENTS.cancellationUndone]: `AdminAuditEvent.cancellationUndone`,
}

const STATUS_CHIPS: { value: AdminBillingStatusFilter; label: string }[] = [
  { value: `paying`, label: `AdminBilling.paying` },
  { value: `trial`, label: `AdminBilling.trial` },
  { value: `past_due`, label: `AdminBilling.pastDue` },
  { value: `ending`, label: `AdminBilling.ending` },
  { value: `cancelled`, label: `AdminBilling.cancelled` },
  { value: `all`, label: `AdminBilling.all` },
]

const NUMBER = new Intl.NumberFormat(`en`)

/** A date as the admin shows it, in the operator's format: `23 Oct 2026` or `Oct 23, 2026`. */
export function billingDate(at: string, format: Pick<Formatters, "date">): string {
  return format.date(at)
}

/** An amount as a person reads it: `€36.00`. */
export function money(value: Money): string {
  return formatMoney(value.amount, value.currency)
}

/** The plan's name, `Pro`, or `Unknown plan` (in the operator's language) for a price no plan maps to. */
export function billingPlanName(t: Translator<string>, planId: string | null): string {
  return (planId === null ? null : findPlan(planId))?.name ?? t.t(`AdminBilling.unknownPlan`)
}

const STATE_BADGES: Record<AdminBillingState, { key: string; color: BadgeColor }> = {
  [AdminBillingState.Active]: { key: `AdminBilling.active`, color: `green` },
  [AdminBillingState.Trial]: { key: `AdminBilling.trial`, color: `blue` },
  [AdminBillingState.PastDue]: { key: `AdminBilling.pastDue`, color: `orange` },
  [AdminBillingState.Cancelled]: { key: `AdminBilling.cancelled`, color: `gray` },
  [AdminBillingState.Incomplete]: { key: `AdminBilling.incomplete`, color: `gray` },
  [AdminBillingState.Paused]: { key: `AdminBilling.paused`, color: `gray` },
}

/** The status word's badge. A past-due group whose grace is over shows red. */
export function billingStatusBadge(
  t: Translator<string>,
  view: AdminBillingStatusView,
): { text: string; color: BadgeColor } {
  const { key, color } = STATE_BADGES[view.state]
  return { text: t.t(key), color: view.date?.kind === `on_free_since` ? `red` : color }
}

/** The key date beside the status word: `Plan kept until Oct 23, 2026`, or `""` for none. */
export function billingDatePhrase(
  t: Translator<string>,
  view: AdminBillingStatusView,
  format: Pick<Formatters, "date">,
): string {
  if (view.date === null) return ``
  const date = billingDate(view.date.at, format)
  switch (view.date.kind) {
    case `renews`:
      return t.t(`AdminBilling.renews`, { date })
    case `ends`:
    case `trial_ends`:
      return t.t(`AdminBilling.ends`, { date })
    case `plan_kept_until`:
      return t.t(`AdminBilling.planKeptUntil`, { date })
    case `on_free_since`:
      return t.t(`AdminBilling.onFreeSince`, { date })
  }
}

/** The status badge and its date, on one line that wraps after the badge. */
export function BillingStatusLine(
  { view, dataE2E }: { view: AdminBillingStatusView; dataE2E?: string },
): JSX.Element {
  const t = useAdminText()
  const badge = billingStatusBadge(t, view)
  const phrase = billingDatePhrase(t, view, useFormat())
  return (
    <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-e2e={dataE2E}>
      <Badge text={badge.text} color={badge.color} />
      {phrase && <span class="whitespace-nowrap text-sm">{phrase}</span>}
    </span>
  )
}

/**
 * What the customer pays a month now, and how it is made up: `€36.00` over `4 × €9.00`. During a
 * trial it pays nothing, and the second line says what it would pay. `null` for an unknown price.
 */
export function perMonth(
  t: Translator<string>,
  customer: AdminBillingCustomer,
): { amount: string; detail: string | null } | null {
  const now = monthlyRevenueOf(customer)
  const price = listPriceOf(customer)
  if (now === null || price === null) return null
  const seats = seatsOf(customer)
  if (now.amount === 0) {
    const trial = customer.status === BillingStatus.Trialing
    return {
      amount: money(now),
      detail: trial ? t.t(`AdminBilling.wouldBe`, { amount: money(price) }) : null,
    }
  }
  return {
    amount: money(now),
    detail: seats > 1
      ? t.t(`AdminBilling.seatPrice`, {
        seats: NUMBER.format(seats),
        price: money({ amount: price.amount / seats, currency: price.currency }),
      })
      : null,
  }
}

/** Monthly recurring revenue per currency, never added across currencies: `€54.00 · $12.00`. */
function revenueText(revenue: readonly Money[]): string {
  return revenue.length === 0
    ? money({ amount: 0, currency: `EUR` })
    : revenue.map(money).join(` · `)
}

export interface AdminBillingListScreenProps {
  /** What the address asked for; the search form and the chips start from it. */
  filter: AdminBillingFilter
  /** The four figures, or `null` while they load or when they failed. */
  figures: AdminBillingFigures | null
  /** Set when the figures could not be read, or `null`. The screen says so in its own words. */
  figuresError: string | null
  /** The page of customers, or `null` while it loads or when it failed. */
  list: AdminBillingListResponse | null
  pending: boolean
  /** Set when the list could not be read, or `null`. The screen says so in its own words. */
  error: string | null
  /** The time the dates are read against: past due or on Free. */
  now: Date
  onSearch: (filter: AdminBillingFilter) => void
  onPage: (page: number) => void
  /** Reads the figures and the list again after a failure. */
  onRetry: () => void
  navigate?: Navigate
}

/**
 * The billing page (#196): four figures from the stored subscriptions, then every customer with
 * its status word, key date and monthly amount, searched by group or owner and filtered by status
 * chips that show their counts. Each name opens the customer's page, where the actions are.
 */
export function AdminBillingListScreen(props: AdminBillingListScreenProps): JSX.Element {
  const { filter, list, pending, error, onSearch, onPage, navigate } = props
  const format = useFormat()
  const t = useAdminText()
  const heading = useRef<HTMLHeadingElement>(null)

  // After a search, a chip or a page change the list is new: once it arrives, the reader starts
  // again at its count. The first list is no change, so focus stays where it was.
  const asked = useRef(false)
  // Whether the search form sent the pending request, so only a search says "Searching…".
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (pending) return
    setSearching(false)
    if (asked.current && list !== null) heading.current?.focus()
    asked.current = false
  }, [pending, list])
  const search = (next: AdminBillingFilter) => {
    asked.current = true
    onSearch(next)
  }
  const turnPage = (next: number) => {
    asked.current = true
    onPage(next)
  }

  const header = (
    <PageHeader
      title={t.t(`AdminBilling.title`)}
      subtitle={t.t(`AdminBilling.subtitle`)}
      titleDataE2E="admin-billing-title"
    />
  )

  if (list !== null && !list.enabled) {
    return (
      <Stack>
        {header}
        <Card data-e2e="admin-billing-off">
          <EmptyState
            inset
            icon={<IconCreditCard class="size-8" aria-hidden="true" />}
            // What the module says while billing is off (decision 10 of #196).
            title={t.t(`AdminBilling.off`)}
            description={t.t(`AdminBilling.offText`)}
            action={
              <ExternalButton href={ADMIN_BILLING_SETUP_URL} data-e2e="admin-billing-setup">
                {t.t(`AdminBilling.readSetup`)}
              </ExternalButton>
            }
          />
        </Card>
      </Stack>
    )
  }

  const filtered = filter.query !== `` || filter.status !== `paying`
  // No customer at all, whatever the filter: nothing to search or filter yet.
  const none = list !== null && list.counts.all === 0 && filter.query === ``

  return (
    <Stack>
      {header}
      <Figures {...props} />

      {none
        ? (
          <Card data-e2e="admin-billing-none">
            <EmptyState
              inset
              icon={<IconCreditCard class="size-8" aria-hidden="true" />}
              title={t.t(`AdminBilling.noneYet`)}
              description={t.t(`AdminBilling.noneHint`)}
              action={list?.enabled && list.pricingUrl && (
                <ExternalButton href={list.pricingUrl} data-e2e="admin-billing-pricing">
                  {t.t(`AdminBilling.openPricing`)}
                </ExternalButton>
              )}
            />
          </Card>
        )
        : (
          <>
            <ScreenForm
              pending={pending}
              onSubmit={(data) => {
                setSearching(true)
                search({ ...filter, query: String(data.get(`q`) ?? ``).trim(), page: 1 })
              }}
            >
              {/* Keyed by the query, so going back in history shows the search that page had. */}
              <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
                <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
                  <Field id="admin-billing-q" label={t.t(`AdminBilling.search`)}>
                    <Input
                      name="q"
                      type="search"
                      data-e2e="admin-billing-search"
                      defaultValue={filter.query}
                      maxLength={ADMIN_BILLING_SEARCH_MAX_LENGTH}
                      autocomplete="off"
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  data-e2e="admin-billing-submit"
                  busy={pending && searching}
                  busyLabel={t.t(`AdminBilling.searching`)}
                >
                  {t.t(`AdminBilling.submit`)}
                </Button>
              </div>
            </ScreenForm>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* One row that scrolls sideways on a phone rather than wrapping into three. */}
              <div
                class="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:px-0"
                data-e2e="admin-billing-status"
              >
                <span class="text-sm text-muted" aria-hidden="true">
                  {t.t(`AdminBilling.status`)}
                </span>
                <ToggleChips
                  mode="single"
                  label={t.t(`AdminBilling.status`)}
                  class="flex-nowrap sm:flex-wrap"
                  options={STATUS_CHIPS.map((chip) => ({
                    value: chip.value,
                    label: list?.enabled
                      ? t.t(`AdminBilling.chipCount`, {
                        label: t.t(chip.label),
                        count: NUMBER.format(list.counts[chip.value]),
                      })
                      : t.t(chip.label),
                  }))}
                  value={filter.status}
                  onChange={(value) =>
                    search({
                      ...filter,
                      status: (value ?? `all`) as AdminBillingStatusFilter,
                      page: 1,
                    })}
                />
              </div>
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  data-e2e="admin-billing-clear"
                  onClick={() => search({ query: ``, status: `paying`, page: 1 })}
                >
                  {t.t(`AdminBilling.clear`)}
                </Button>
              )}
            </div>

            {error && (
              <div class="flex flex-col items-center gap-3" data-e2e="admin-billing-error">
                {/* The list's message when it could not be read, whatever the cause. */}
                <ErrorState message={t.t(`AdminBilling.listError`)} />
                <Button variant="secondary" onClick={props.onRetry}>
                  {t.t(`AdminBilling.retry`)}
                </Button>
              </div>
            )}

            {(list !== null || !error) && (
              <h2
                ref={heading}
                tabIndex={-1}
                class="text-sm text-muted"
                data-e2e="admin-billing-count"
              >
                {list?.enabled
                  ? t.t(`AdminBilling.count`, { count: list.total })
                  : t.t(`AdminBilling.loading`)}
              </h2>
            )}
            {list === null
              ? !error && (
                <div role="status" aria-label={t.t(`AdminBilling.loading`)}>
                  <LoadingSkeleton rows={5} />
                </div>
              )
              : list.enabled && (
                <div data-e2e="admin-billing-list">
                  <DataTable
                    mode="server"
                    class={TABLE_CLASS}
                    columns={customerColumns(t, props.now, list.graceDays, format, navigate)}
                    rows={list.customers.map((customer) => ({ customer }))}
                    caption={t.t(`AdminBilling.customers`)}
                    captionHidden
                    rowKey={(row) => row.customer.groupId}
                    sort={NO_SORT}
                    onSortChange={() => {}}
                    empty={
                      <EmptyState
                        inset
                        title={t.t(`AdminBilling.noMatch`)}
                        description={t.t(`AdminBilling.noMatchHint`)}
                        action={
                          <Button
                            variant="ghost"
                            onClick={() => search({ query: ``, status: `paying`, page: 1 })}
                          >
                            {t.t(`AdminBilling.clear`)}
                          </Button>
                        }
                      />
                    }
                    paging={{
                      page: list.page,
                      pageSize: list.pageSize,
                      total: list.total,
                      onChange: turnPage,
                      label: t.t(`AdminBilling.pages`),
                    }}
                  />
                </div>
              )}
          </>
        )}
    </Stack>
  )
}

/**
 * The four figures and the line that says where they come from. They load on their own, so a
 * failed list still shows them, and a failure here leaves the list.
 */
function Figures(
  { figures, figuresError, onRetry }: AdminBillingListScreenProps,
): JSX.Element {
  const t = useAdminText()
  if (figuresError) {
    return (
      <div class="flex flex-col items-center gap-3" data-e2e="admin-billing-figures-error">
        <ErrorState message={t.t(`AdminBilling.figuresError`)} />
        <Button variant="secondary" onClick={onRetry}>{t.t(`AdminBilling.retry`)}</Button>
      </div>
    )
  }
  if (figures === null) {
    return (
      <div role="status" aria-label={t.t(`AdminBilling.loadingFigures`)}>
        <LoadingSkeleton rows={2} />
      </div>
    )
  }
  return (
    <section
      aria-label={t.t(`AdminBilling.keyNumbers`)}
      class="flex flex-col gap-2"
      data-e2e="admin-billing-figures"
    >
      {/* Two columns fit a 390px phone; a revenue in several currencies wraps inside its card. */}
      <KpiGrid minWidth="9rem">
        <Kpi
          class="min-w-0 wrap-anywhere"
          label={t.t(`AdminBilling.mrr`)}
          value={revenueText(figures.monthlyRevenue)}
          sub={t.t(`AdminBilling.mrrHint`)}
          tone="neutral"
        />
        <Kpi
          label={t.t(`AdminBilling.payingGroups`)}
          value={NUMBER.format(figures.paying)}
          sub={t.t(`AdminBilling.pastDueCount`, { count: figures.pastDue })}
          tone="neutral"
        />
        <Kpi
          label={t.t(`AdminBilling.inTrial`)}
          value={NUMBER.format(figures.trials)}
          sub={t.t(`AdminBilling.trialsEnding`, { count: figures.trialsEndingSoon })}
          tone="neutral"
        />
        <Kpi
          label={t.t(`AdminBilling.ending`)}
          value={NUMBER.format(figures.ending)}
          sub={t.t(`AdminBilling.endingHint`)}
          tone="neutral"
        />
      </KpiGrid>
      <p class="text-xs text-muted" data-e2e="admin-billing-source">
        {t.t(`AdminBilling.source`)} {figures.lastEventAt
          ? (
            <Rich
              parts={t.parts(`AdminBilling.lastEvent`)}
              tags={{ when: () => <When at={figures.lastEventAt!} /> }}
            />
          )
          : t.t(`AdminBilling.noEvent`)}
      </p>
    </section>
  )
}

/**
 * The table's layout on top of preact-ui's `DataTable`, which takes no class per column:
 *
 * - The library's table box keeps 300px of height even under a single row; here it fits its rows.
 * - Cells are padded 1rem on each side, 0.75rem on a phone, where they wrap so a long address
 *   never pushes the amount off the screen.
 * - Below 640px the owner, the status and the next charge go: the group's cell then shows the
 *   status line and the owner's address under the name, and the amount stays beside it.
 *
 * Positions follow `customerColumns`: 2 owner, 3 status, 5 next charge.
 */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-sm:[&_td]:whitespace-normal`,
  `max-sm:[&_:is(th,td):nth-child(2)]:hidden`,
  `max-sm:[&_:is(th,td):nth-child(3)]:hidden`,
  `max-sm:[&_:is(th,td):nth-child(5)]:hidden`,
].join(` `)

interface CustomerRow {
  customer: AdminBillingCustomer
}

/** The server keeps one order (past due first, then trials ending soonest), so no column sorts. */
const NO_SORT: [] = []

/** When the customer is charged next: the renewal, or the end of a trial; `None` otherwise. */
function nextCharge(
  t: Translator<string>,
  view: AdminBillingStatusView,
  format: Pick<Formatters, "date">,
): string {
  return view.date?.kind === `renews` || view.date?.kind === `trial_ends`
    ? billingDate(view.date.at, format)
    : t.t(`AdminBilling.none`)
}

/** The table's columns, in the order the server sorts: past due first, then trials ending soonest. */
function customerColumns(
  t: Translator<string>,
  now: Date,
  graceDays: number,
  format: Pick<Formatters, "date">,
  navigate?: Navigate,
): DataTableColumn<CustomerRow, "customer">[] {
  return [
    {
      id: `group`,
      header: t.t(`AdminBilling.group`),
      render: ({ customer }) => (
        <GroupCell
          customer={customer}
          view={adminBillingStatus(customer, now, graceDays)}
          navigate={navigate}
        />
      ),
    },
    {
      id: `owner`,
      header: t.t(`AdminBilling.owner`),
      render: ({ customer }) => (
        <div class="flex w-44 min-w-0 flex-col" translate={false}>
          <span
            class="truncate text-sm font-medium"
            title={adminGroupPersonName(t, customer.owner)}
          >
            {adminGroupPersonName(t, customer.owner)}
          </span>
          {customer.owner.email && customer.owner.name && (
            <span class="truncate text-xs text-muted" title={customer.owner.email}>
              {customer.owner.email}
            </span>
          )}
        </div>
      ),
    },
    {
      id: `status`,
      header: t.t(`AdminBilling.status`),
      render: ({ customer }) => (
        <BillingStatusLine
          view={adminBillingStatus(customer, now, graceDays)}
          dataE2E="admin-billing-row-status"
        />
      ),
    },
    {
      id: `perMonth`,
      header: t.t(`AdminBilling.perMonth`),
      align: `right`,
      render: ({ customer }) => {
        const amount = perMonth(t, customer)
        return amount === null
          ? <span class="text-sm text-muted">{t.t(`AdminBilling.unknownPrice`)}</span>
          : (
            <div class="flex flex-col items-end text-right" data-e2e="admin-billing-row-amount">
              <span class="whitespace-nowrap font-medium tabular-nums">{amount.amount}</span>
              {amount.detail && (
                <span class="whitespace-nowrap text-xs text-muted tabular-nums">
                  {amount.detail}
                </span>
              )}
            </div>
          )
      },
    },
    {
      id: `nextCharge`,
      header: t.t(`AdminBilling.nextCharge`),
      render: ({ customer }) => (
        <span class="whitespace-nowrap text-sm">
          {nextCharge(t, adminBillingStatus(customer, now, graceDays), format)}
        </span>
      ),
    },
  ]
}

/**
 * The group column: its name as the link to the customer's page, and a badge while the group is
 * in the trash. On a phone, which has no status or owner column, the status line and the owner's
 * address follow under the name.
 */
function GroupCell(
  { customer, view, navigate }: {
    customer: AdminBillingCustomer
    view: AdminBillingStatusView
    navigate?: Navigate
  },
): JSX.Element {
  const t = useAdminText()
  const owner = customer.owner.email ?? adminGroupPersonName(t, customer.owner)
  return (
    <div class="flex min-w-40 flex-col gap-1 max-sm:min-w-0">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={ADMIN_BILLING_PATHS.customer(customer.groupId)}
          navigate={navigate}
          class="pc-link line-clamp-2 font-medium wrap-anywhere"
          title={customer.groupName}
          translate={false}
          data-e2e={`admin-billing-${customer.groupId}`}
        >
          {customer.groupName}
        </Link>
        {customer.groupDeletedAt && (
          <span data-e2e="admin-billing-deleted">
            <Badge text={t.t(`AdminBilling.inTrash`)} color="red" type="outline" />
          </span>
        )}
      </div>
      <div class="flex flex-col gap-1 sm:hidden" data-e2e="admin-billing-phone">
        <BillingStatusLine view={view} />
        <span class="text-xs text-muted wrap-anywhere" translate={false}>{owner}</span>
      </div>
    </div>
  )
}

/** A secondary button that opens `href` in a new tab and says so to a screen reader. */
function ExternalButton(
  { href, children, ...rest }: { href: string; children: string; "data-e2e"?: string },
): JSX.Element {
  const t = useAdminText()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class={buttonClasses(`secondary`, `md`)}
      aria-label={t.t(`AdminBilling.newTab`, { label: children })}
      {...rest}
    >
      <IconExternalLink class="size-4" aria-hidden="true" />
      {children}
    </a>
  )
}
