// deno-lint-ignore-file ui-text/no-literal
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

/** The billing module's pages in the admin app. */
export const ADMIN_BILLING_PATHS = {
  list: `/billing`,
  customer: (groupId: string) => `/billing/${encodeURIComponent(groupId)}`,
} as const

/** Where the billing setup is described, for the action of the "Billing is off" state. */
export const ADMIN_BILLING_SETUP_URL = `https://github.com/spy4x/seed/blob/main/docs/billing.md`

/** The list's message when it could not be read, whatever the cause. */
export const ADMIN_BILLING_LIST_ERROR =
  `Could not load customers. Check your connection and try again.`

/** What the module says while billing is off (decision 10 of #196). */
export const ADMIN_BILLING_OFF_TEXT =
  `Every group is on the Free plan. To turn billing on, add the Stripe settings.`

/** What each billing action is called in the audit log and on the person page. */
export const BILLING_AUDIT_LABELS: Record<BillingAuditEvent, string> = {
  [BILLING_AUDIT_EVENTS.paymentRefunded]: `Payment refunded by an operator`,
  [BILLING_AUDIT_EVENTS.timeGiven]: `Time given at no charge by an operator`,
  [BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd]: `Subscription set to cancel by an operator`,
  [BILLING_AUDIT_EVENTS.cancelledNow]: `Subscription cancelled by an operator`,
  [BILLING_AUDIT_EVENTS.cancellationUndone]: `Cancellation undone by an operator`,
}

const STATUS_CHIPS: { value: AdminBillingStatusFilter; label: string }[] = [
  { value: `paying`, label: `Paying` },
  { value: `trial`, label: `Trial` },
  { value: `past_due`, label: `Past due` },
  { value: `ending`, label: `Ending` },
  { value: `cancelled`, label: `Cancelled` },
  { value: `all`, label: `All` },
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

/** The plan's name, `Pro`, or `Unknown plan` for a price no plan maps to. */
export function billingPlanName(planId: string | null): string {
  return (planId === null ? null : findPlan(planId))?.name ?? `Unknown plan`
}

const STATE_BADGES: Record<AdminBillingState, { text: string; color: BadgeColor }> = {
  [AdminBillingState.Active]: { text: `Active`, color: `green` },
  [AdminBillingState.Trial]: { text: `Trial`, color: `blue` },
  [AdminBillingState.PastDue]: { text: `Past due`, color: `orange` },
  [AdminBillingState.Cancelled]: { text: `Cancelled`, color: `gray` },
  [AdminBillingState.Incomplete]: { text: `Checkout not finished`, color: `gray` },
  [AdminBillingState.Paused]: { text: `Paused`, color: `gray` },
}

/** The status word's badge. A past-due group whose grace is over shows red. */
export function billingStatusBadge(
  view: AdminBillingStatusView,
): { text: string; color: BadgeColor } {
  const badge = STATE_BADGES[view.state]
  return view.date?.kind === `on_free_since` ? { ...badge, color: `red` } : badge
}

/** The key date beside the status word: `Plan kept until Oct 23, 2026`, or `""` for none. */
export function billingDatePhrase(
  view: AdminBillingStatusView,
  format: Pick<Formatters, "date">,
): string {
  if (view.date === null) return ``
  const day = billingDate(view.date.at, format)
  switch (view.date.kind) {
    case `renews`:
      return `Renews ${day}`
    case `ends`:
    case `trial_ends`:
      return `Ends ${day}`
    case `plan_kept_until`:
      return `Plan kept until ${day}`
    case `on_free_since`:
      return `On Free since ${day}`
  }
}

/** The status badge and its date, on one line that wraps after the badge. */
export function BillingStatusLine(
  { view, dataE2E }: { view: AdminBillingStatusView; dataE2E?: string },
): JSX.Element {
  const badge = billingStatusBadge(view)
  const phrase = billingDatePhrase(view, useFormat())
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
  customer: AdminBillingCustomer,
): { amount: string; detail: string | null } | null {
  const now = monthlyRevenueOf(customer)
  const price = listPriceOf(customer)
  if (now === null || price === null) return null
  const seats = seatsOf(customer)
  if (now.amount === 0) {
    const trial = customer.status === BillingStatus.Trialing
    return { amount: money(now), detail: trial ? `would be ${money(price)}` : null }
  }
  return {
    amount: money(now),
    detail: seats > 1
      ? `${NUMBER.format(seats)} × ${
        money({ amount: price.amount / seats, currency: price.currency })
      }`
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
      title="Billing"
      subtitle="Who pays, what they pay, and what you earn."
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
            title="Billing is off"
            description={ADMIN_BILLING_OFF_TEXT}
            action={
              <ExternalButton href={ADMIN_BILLING_SETUP_URL} data-e2e="admin-billing-setup">
                Read the billing setup
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
              title="No paid groups yet"
              description="A group shows here once its owner checks out a paid plan, trial included."
              action={list?.enabled && list.pricingUrl && (
                <ExternalButton href={list.pricingUrl} data-e2e="admin-billing-pricing">
                  Open the pricing page
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
                  <Field id="admin-billing-q" label="Group name, owner or group id">
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
                  busyLabel="Searching…"
                >
                  Search
                </Button>
              </div>
            </ScreenForm>
            <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
              {/* One row that scrolls sideways on a phone rather than wrapping into three. */}
              <div
                class="-mx-4 flex max-w-[calc(100%+2rem)] items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:flex-wrap sm:px-0"
                data-e2e="admin-billing-status"
              >
                <span class="text-sm text-muted" aria-hidden="true">Status</span>
                <ToggleChips
                  mode="single"
                  label="Status"
                  class="flex-nowrap sm:flex-wrap"
                  options={STATUS_CHIPS.map((chip) => ({
                    value: chip.value,
                    label: list?.enabled
                      ? `${chip.label} ${NUMBER.format(list.counts[chip.value])}`
                      : chip.label,
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
                  Clear filters
                </Button>
              )}
            </div>

            {error && (
              <div class="flex flex-col items-center gap-3" data-e2e="admin-billing-error">
                <ErrorState message={ADMIN_BILLING_LIST_ERROR} />
                <Button variant="secondary" onClick={props.onRetry}>Try again</Button>
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
                  ? `${NUMBER.format(list.total)} ${list.total === 1 ? `group` : `groups`}`
                  : `Loading customers`}
              </h2>
            )}
            {list === null
              ? !error && (
                <div role="status" aria-label="Loading customers">
                  <LoadingSkeleton rows={5} />
                </div>
              )
              : list.enabled && (
                <div data-e2e="admin-billing-list">
                  <DataTable
                    mode="server"
                    class={TABLE_CLASS}
                    columns={customerColumns(props.now, list.graceDays, format, navigate)}
                    rows={list.customers.map((customer) => ({ customer }))}
                    caption="Customers"
                    captionHidden
                    rowKey={(row) => row.customer.groupId}
                    sort={NO_SORT}
                    onSortChange={() => {}}
                    empty={
                      <EmptyState
                        inset
                        title="No group matches"
                        description="Try another name or address, or clear the filters."
                        action={
                          <Button
                            variant="ghost"
                            onClick={() => search({ query: ``, status: `paying`, page: 1 })}
                          >
                            Clear filters
                          </Button>
                        }
                      />
                    }
                    paging={{
                      page: list.page,
                      pageSize: list.pageSize,
                      total: list.total,
                      onChange: turnPage,
                      label: `Pages of customers`,
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
  if (figuresError) {
    return (
      <div class="flex flex-col items-center gap-3" data-e2e="admin-billing-figures-error">
        <ErrorState message="Could not count revenue." />
        <Button variant="secondary" onClick={onRetry}>Try again</Button>
      </div>
    )
  }
  if (figures === null) {
    return (
      <div role="status" aria-label="Loading the figures">
        <LoadingSkeleton rows={2} />
      </div>
    )
  }
  return (
    <section aria-label="Key numbers" class="flex flex-col gap-2" data-e2e="admin-billing-figures">
      {/* Two columns fit a 390px phone; a revenue in several currencies wraps inside its card. */}
      <KpiGrid minWidth="9rem">
        <Kpi
          class="min-w-0 wrap-anywhere"
          label="Monthly recurring revenue"
          value={revenueText(figures.monthlyRevenue)}
          sub="Active and past-due subscriptions at list price. Trials count as 0."
          tone="neutral"
        />
        <Kpi
          label="Paying groups"
          value={NUMBER.format(figures.paying)}
          sub={`${NUMBER.format(figures.pastDue)} past due`}
          tone="neutral"
        />
        <Kpi
          label="In trial"
          value={NUMBER.format(figures.trials)}
          sub={`${NUMBER.format(figures.trialsEndingSoon)} end in the next 7 days`}
          tone="neutral"
        />
        <Kpi
          label="Ending"
          value={NUMBER.format(figures.ending)}
          sub="Cancelled, paid until their period ends"
          tone="neutral"
        />
      </KpiGrid>
      <p class="text-xs text-muted" data-e2e="admin-billing-source">
        Counted from the subscriptions this app stores, so a change in Stripe shows here once its
        webhook arrives. {figures.lastEventAt
          ? (
            <>
              Last Stripe event <When at={figures.lastEventAt} />.
            </>
          )
          : `No Stripe event has arrived yet.`}
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
function nextCharge(view: AdminBillingStatusView, format: Pick<Formatters, "date">): string {
  return view.date?.kind === `renews` || view.date?.kind === `trial_ends`
    ? billingDate(view.date.at, format)
    : `None`
}

/** The table's columns, in the order the server sorts: past due first, then trials ending soonest. */
function customerColumns(
  now: Date,
  graceDays: number,
  format: Pick<Formatters, "date">,
  navigate?: Navigate,
): DataTableColumn<CustomerRow, "customer">[] {
  return [
    {
      id: `group`,
      header: `Group`,
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
      header: `Owner`,
      render: ({ customer }) => (
        <div class="flex w-44 min-w-0 flex-col">
          <span class="truncate text-sm font-medium" title={adminGroupPersonName(customer.owner)}>
            {adminGroupPersonName(customer.owner)}
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
      header: `Status`,
      render: ({ customer }) => (
        <BillingStatusLine
          view={adminBillingStatus(customer, now, graceDays)}
          dataE2E="admin-billing-row-status"
        />
      ),
    },
    {
      id: `perMonth`,
      header: `Per month`,
      align: `right`,
      render: ({ customer }) => {
        const amount = perMonth(customer)
        return amount === null
          ? <span class="text-sm text-muted">Unknown price</span>
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
      header: `Next charge`,
      render: ({ customer }) => (
        <span class="whitespace-nowrap text-sm">
          {nextCharge(adminBillingStatus(customer, now, graceDays), format)}
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
  const owner = customer.owner.email ?? adminGroupPersonName(customer.owner)
  return (
    <div class="flex min-w-40 flex-col gap-1 max-sm:min-w-0">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={ADMIN_BILLING_PATHS.customer(customer.groupId)}
          navigate={navigate}
          class="pc-link line-clamp-2 font-medium wrap-anywhere"
          title={customer.groupName}
          data-e2e={`admin-billing-${customer.groupId}`}
        >
          {customer.groupName}
        </Link>
        {customer.groupDeletedAt && (
          <span data-e2e="admin-billing-deleted">
            <Badge text="In trash" color="red" type="outline" />
          </span>
        )}
      </div>
      <div class="flex flex-col gap-1 sm:hidden" data-e2e="admin-billing-phone">
        <BillingStatusLine view={view} />
        <span class="text-xs text-muted wrap-anywhere">{owner}</span>
      </div>
    </div>
  )
}

/** A secondary button that opens `href` in a new tab and says so to a screen reader. */
function ExternalButton(
  { href, children, ...rest }: { href: string; children: string; "data-e2e"?: string },
): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class={buttonClasses(`secondary`, `md`)}
      aria-label={`${children} (opens a new tab)`}
      {...rest}
    >
      <IconExternalLink class="size-4" aria-hidden="true" />
      {children}
    </a>
  )
}
