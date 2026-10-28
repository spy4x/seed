// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { IconDownload } from "@spy4x/preact-icons"
import { Kpi, KpiGrid } from "@spy4x/preact-charts/kpi"
import { LineChart } from "@spy4x/preact-charts/line-chart"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { DialogActions } from "@spy4x/preact-ui/dialog-actions"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Input } from "@spy4x/preact-ui/input"
import { Cluster, Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Modal } from "@spy4x/preact-ui/modal"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { ToggleChips } from "@spy4x/preact-ui/toggle-chips"
import { ADMIN_SEARCH_MAX_LENGTH, ADMIN_STATS_DAYS } from "@domain/identity"
import type {
  AdminNewsletterSend,
  AdminNewsletterStats,
  AdminSubscriberFilter,
  AdminSubscriberListResponse,
  AdminSubscriberRow,
  AdminSubscriberStatus,
  AdminSubscriberStatusFilter,
} from "@domain/subscribers"
import { changeText, changeTone, countAxisTop } from "./admin-dashboard-screen.tsx"
import { ScreenForm } from "./progressive.tsx"
import { OnDay, useFormat, When } from "@spy4x/preact-ui/format"

const NUMBER = new Intl.NumberFormat("en")

/** Both tables keep the server's order: newest first. */
const NO_SORT: never[] = []
const noSort = () => {}

/** The two tabs of the page. */
export type AdminNewsletterTab = "subscribers" | "sends"

/** What an operator can do to one address; each is confirmed in a dialog first. */
export type AdminSubscriberAction = "remove" | "resend"

/** The open dialog: the action and the address it is for. */
export interface AdminSubscriberDialog {
  action: AdminSubscriberAction
  email: string
}

const STATUS_CHIPS: { value: AdminSubscriberStatus; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
]

/** What each action's dialog says and does. */
const ACTIONS: Record<AdminSubscriberAction, {
  title: string
  text: (email: string) => string
  submit: string
  busy: string
}> = {
  remove: {
    title: "Remove this subscriber?",
    text: (email) =>
      `${email} stops getting the newsletter, as if they had pressed its unsubscribe link. The ` +
      `address is erased, and a confirm link mailed to it before now no longer works. They can ` +
      `subscribe again from the website.`,
    submit: "Remove",
    busy: "Removing…",
  },
  resend: {
    title: "Resend the confirm mail?",
    text: (email) =>
      `${email} gets a new mail with a link to confirm the subscription. Nothing changes until ` +
      `they press it.`,
    submit: "Resend",
    busy: "Sending…",
  },
}

export interface AdminNewsletterScreenProps {
  tab: AdminNewsletterTab
  onTab: (tab: AdminNewsletterTab) => void
  /** The numbers, or `null` while they load or when they could not be read. */
  stats: AdminNewsletterStats | null
  statsError: string | null
  /** What the address asked for; the search form and the chips start from it. */
  filter: AdminSubscriberFilter
  /** The page of addresses, or `null` while it loads. */
  list: AdminSubscriberListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  /** The operator searched or changed the status: the app reads page 1 of that. */
  onSearch: (filter: AdminSubscriberFilter) => void
  onPage: (page: number) => void
  /** The sent issues, newest first, or `null` while they load. */
  sends: readonly AdminNewsletterSend[] | null
  sendsError: string | null
  /** Reads everything again after a failure. */
  onRetry: () => void
  dialog: AdminSubscriberDialog | null
  /** Why the API refused the dialog's action, or `null`. */
  dialogError: string | null
  dialogPending: boolean
  onOpenDialog: (dialog: AdminSubscriberDialog) => void
  onCloseDialog: () => void
  onConfirm: () => void
  /** Counts the actions that went through; a change moves focus to the list's heading. */
  done: number
  exporting: boolean
  onExport: () => void
}

/**
 * The newsletter page of the operator area (#428): the list's numbers and its growth over 30 days,
 * then two tabs. "Subscribers" searches, filters and pages every confirmed and pending address,
 * each with Remove, and Resend while it waits for its confirm mail. "Sent issues" lists each issue
 * with how many it was for, how many got it and how many failed. The page's one primary action is
 * the CSV export.
 */
export function AdminNewsletterScreen(props: AdminNewsletterScreenProps): JSX.Element {
  const tabs = [
    {
      id: "subscribers",
      label: "Subscribers",
      content: <SubscribersTab {...props} />,
    },
    {
      id: "sends",
      label: "Sent issues",
      content: <SendsTab sends={props.sends} error={props.sendsError} />,
    },
  ]
  return (
    <Stack>
      <PageHeader
        title="Newsletter"
        subtitle="Who gets the newsletter, and what it sent."
        titleDataE2E="admin-newsletter-title"
        action={
          <PageAction
            label={props.exporting ? "Exporting…" : "Export CSV"}
            Icon={IconDownload}
            onClick={props.onExport}
            disabled={props.exporting}
            dataE2E="admin-newsletter-export"
          />
        }
      />
      <StatsSection stats={props.stats} error={props.statsError} onRetry={props.onRetry} />
      <Tabs
        tabs={tabs}
        active={props.tab}
        onChange={(id) => props.onTab(id as AdminNewsletterTab)}
        lazy
        label="Newsletter"
        panelClass="pt-4"
        tabDataE2E="admin-newsletter-tab"
      />
      {props.dialog && (
        <ActionDialog
          dialog={props.dialog}
          error={props.dialogError}
          pending={props.dialogPending}
          onConfirm={props.onConfirm}
          onClose={props.onCloseDialog}
        />
      )}
    </Stack>
  )
}

/** The numbers and the chart of the list's size, or their loading and error states. */
function StatsSection(
  { stats, error, onRetry }: {
    stats: AdminNewsletterStats | null
    error: string | null
    onRetry: () => void
  },
): JSX.Element {
  // The server counts each day in UTC, so its label is that UTC day, in the operator's format.
  const day = useFormat().utc()
  if (stats === null) {
    return error
      ? (
        <div class="flex flex-col items-start gap-3">
          <ErrorState message={error} dataE2E="admin-newsletter-stats-error" />
          <Button variant="secondary" onClick={onRetry}>Try again</Button>
        </div>
      )
      : (
        <div role="status" aria-label="Loading the numbers">
          <LoadingSkeleton rows={3} />
        </div>
      )
  }
  const days = stats.subscribersPerDay
  const first = days[0]?.count ?? 0
  const last = days.at(-1)?.count ?? 0
  const growth = last - first
  return (
    <>
      <section aria-label="Key numbers" data-e2e="admin-newsletter-stats">
        <KpiGrid minWidth="11rem">
          <Kpi
            label="Subscribers"
            value={NUMBER.format(stats.confirmed)}
            sub="Confirmed, getting every issue"
            tone="accent"
          />
          <Kpi
            label="Pending"
            value={NUMBER.format(stats.pending)}
            sub="Confirm mail on its way"
            tone="neutral"
          />
          <Kpi
            label={`Joined, ${ADMIN_STATS_DAYS} days`}
            value={NUMBER.format(stats.joined.current)}
            sub={changeText(stats.joined, `previous ${ADMIN_STATS_DAYS} days`)}
            tone={changeTone(stats.joined)}
          />
          <Kpi label="Issues sent" value={NUMBER.format(stats.issues)} tone="neutral" />
        </KpiGrid>
      </section>
      <Card data-e2e="admin-newsletter-chart">
        <CardHeader
          title="Subscribers per day"
          headingLevel={2}
          action={
            <span class="text-sm text-muted">
              {growth === 0
                ? `No change in ${days.length} days`
                : `${growth > 0 ? "+" : "−"}${
                  NUMBER.format(Math.abs(growth))
                } in ${days.length} days`}
            </span>
          }
        />
        <CardBody>
          <LineChart
            series={[{
              name: "Subscribers",
              points: days.map((day) => ({ x: day.day, y: day.count })),
            }]}
            height={220}
            yDomain={[0, countAxisTop(days.map((day) => day.count))]}
            yTicks={5}
            xFormat={(x) => day.dayMonth(typeof x === "string" ? `${x}T00:00:00Z` : x)}
            yFormat={(value) => NUMBER.format(value)}
            ariaLabel={`Subscribers at the end of each day, the last ${days.length} days`}
            emptyLabel="Nothing yet"
          />
        </CardBody>
      </Card>
    </>
  )
}

/** The search, the status chips and the table of addresses. */
function SubscribersTab(props: AdminNewsletterScreenProps): JSX.Element {
  const { filter, list, pending, error, onSearch, onPage, onOpenDialog, done } = props
  const heading = useRef<HTMLHeadingElement>(null)

  // After a page change or an action the list is new: the reader starts again at its heading. The
  // first page that arrives is no change, so focus stays where it was.
  const page = list?.page
  const seen = useRef<{ page?: number; done: number }>({ done })
  useEffect(() => {
    if (page === undefined) return
    const before = seen.current
    if ((before.page !== undefined && before.page !== page) || before.done !== done) {
      heading.current?.focus()
    }
    seen.current = { page, done }
  }, [page, done])

  const filtered = filter.query !== "" || filter.status !== "any"
  return (
    <Stack>
      <Notice tone="info" title="Unsubscribed addresses are not kept">
        An address that unsubscribes, or that you remove, is erased at once. The list keeps only a
        keyed mark that names no address, so no earlier confirm link can add them back. They can
        still subscribe again from the website.
      </Notice>
      <div class="flex flex-col gap-4 rounded-xl border border-subtle bg-surface p-4">
        <ScreenForm
          pending={pending}
          onSubmit={(data) =>
            onSearch({ ...filter, query: String(data.get("q") ?? "").trim(), page: 1 })}
        >
          {/* Keyed by the query, so the box shows the search the list was loaded with. */}
          <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
            <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
              <Field id="admin-newsletter-q" label="Address">
                <Input
                  name="q"
                  type="search"
                  data-e2e="admin-newsletter-search"
                  defaultValue={filter.query}
                  maxLength={ADMIN_SEARCH_MAX_LENGTH}
                  autocomplete="off"
                />
              </Field>
            </div>
            <Button
              type="submit"
              variant="secondary"
              data-e2e="admin-newsletter-submit"
              busy={pending}
              busyLabel="Searching…"
            >
              Search
            </Button>
          </div>
        </ScreenForm>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex flex-wrap items-center gap-2" data-e2e="admin-newsletter-status">
            <span class="text-sm text-muted" aria-hidden="true">Status</span>
            <ToggleChips
              mode="single"
              label="Status"
              options={STATUS_CHIPS}
              value={filter.status === "any" ? null : filter.status}
              onChange={(value) =>
                onSearch({
                  ...filter,
                  status: (value ?? "any") as AdminSubscriberStatusFilter,
                  page: 1,
                })}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-newsletter-clear"
              onClick={() => onSearch({ query: "", status: "any", page: 1 })}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <ErrorState message={error} dataE2E="admin-newsletter-error" />

      <h2 ref={heading} tabIndex={-1} class="text-sm text-muted" data-e2e="admin-newsletter-count">
        {list
          ? `${NUMBER.format(list.total)} ${list.total === 1 ? "address" : "addresses"}`
          : "Loading addresses"}
      </h2>
      {list === null
        ? !error && (
          <div role="status" aria-label="Loading addresses">
            <LoadingSkeleton rows={5} />
          </div>
        )
        : (
          <div data-e2e="admin-newsletter-list">
            <DataTable
              mode="server"
              class="[&>div:first-child]:min-h-0"
              columns={subscriberColumns(onOpenDialog)}
              rows={list.subscribers}
              sort={NO_SORT}
              onSortChange={noSort}
              caption="Subscribers"
              captionHidden
              rowKey={(row) => row.email}
              empty={filtered
                ? (
                  <EmptyState
                    inset
                    title="Nobody matches"
                    description="Try another address, or clear the filters."
                  />
                )
                : (
                  <EmptyState
                    inset
                    title="No subscribers yet"
                    description="Addresses show here once someone subscribes on the website."
                  />
                )}
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: onPage,
                label: "Pages of subscribers",
              }}
            />
          </div>
        )}
    </Stack>
  )
}

/** The table's columns: the address with its actions, its status and its dates. */
function subscriberColumns(
  onOpenDialog: (dialog: AdminSubscriberDialog) => void,
): DataTableColumn<AdminSubscriberRow, never>[] {
  return [
    {
      id: "email",
      header: "Address",
      // The actions sit under the address, so a phone shows them without scrolling sideways.
      render: ({ email, status }) => (
        <Stack gap="xs" class="min-w-48 items-start">
          {
            /* At least 12rem wide: on a phone the table scrolls sideways instead of squeezing the
              address into a column a few letters wide. */
          }
          <span class="font-medium wrap-anywhere" data-e2e="admin-subscriber-email">{email}</span>
          <Cluster gap="xs" class="-ml-2">
            {status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Resend the confirm mail to ${email}`}
                data-e2e="admin-subscriber-resend"
                onClick={() => onOpenDialog({ action: "resend", email })}
              >
                Resend
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${email}`}
              data-e2e="admin-subscriber-remove"
              onClick={() => onOpenDialog({ action: "remove", email })}
            >
              Remove
            </Button>
          </Cluster>
        </Stack>
      ),
    },
    {
      id: "status",
      header: "Status",
      render: ({ status }) =>
        status === "confirmed"
          ? <Badge text="Confirmed" color="green" />
          : <Badge text="Pending" color="orange" type="outline" />,
    },
    {
      id: "since",
      header: "Since",
      render: (row) => {
        const at = row.confirmedAt ?? row.requestedAt
        if (!at) return <span class="text-sm text-muted">Unknown</span>
        return (
          row.confirmedAt
            ? <OnDay class="whitespace-nowrap text-sm text-muted" at={at} />
            : (
              <span class="whitespace-nowrap text-sm text-muted">
                Asked <When at={at} />
              </span>
            )
        )
      },
    },
  ]
}

/** The sent issues, newest first, with their counts. */
function SendsTab(
  { sends, error }: { sends: readonly AdminNewsletterSend[] | null; error: string | null },
): JSX.Element {
  if (sends === null) {
    return error
      ? <ErrorState message={error} dataE2E="admin-newsletter-sends-error" />
      : (
        <div role="status" aria-label="Loading the sent issues">
          <LoadingSkeleton rows={4} />
        </div>
      )
  }
  return (
    <div data-e2e="admin-newsletter-sends">
      <DataTable
        mode="server"
        class="[&>div:first-child]:min-h-0"
        columns={SEND_COLUMNS}
        rows={sends}
        sort={NO_SORT}
        onSortChange={noSort}
        caption="Sent issues"
        captionHidden
        rowKey={(row) => row.issue}
        empty={
          <EmptyState
            inset
            title="Nothing sent yet"
            description="An issue shows here once the send command starts mailing it."
          />
        }
      />
    </div>
  )
}

/** A count, or a dash when the send log has none. */
function count(value: number | null): JSX.Element {
  return value === null
    ? <span class="text-muted" aria-label="Not recorded">—</span>
    : <span class="tabular-nums">{NUMBER.format(value)}</span>
}

const SEND_COLUMNS: DataTableColumn<AdminNewsletterSend, never>[] = [
  {
    id: "subject",
    header: "Issue",
    render: ({ subject, issue }) => (
      <div class="flex min-w-48 flex-col">
        <span class="font-medium wrap-anywhere">{subject}</span>
        <span class="text-sm text-muted wrap-anywhere">{issue}</span>
      </div>
    ),
  },
  {
    id: "startedAt",
    header: "Sent",
    render: ({ startedAt }) => <OnDay class="whitespace-nowrap text-sm" at={startedAt} />,
  },
  { id: "recipients", header: "Recipients", render: ({ recipients }) => count(recipients) },
  { id: "sent", header: "Delivered", render: ({ sent }) => count(sent) },
  {
    id: "failed",
    header: "Failed",
    render: ({ failed }) =>
      failed !== null && failed > 0
        ? <Badge text={NUMBER.format(failed)} color="red" />
        : count(failed),
  },
  {
    id: "state",
    header: "State",
    render: ({ completedAt, failed }) =>
      completedAt
        ? <Badge text="Finished" color="green" type="outline" />
        : failed !== null && failed > 0
        ? <Badge text="Needs a rerun" color="orange" />
        : <Badge text="Sending" color="blue" type="outline" />,
  },
]

/** The dialog of one action: what it does, why the API refused it, and its button. */
function ActionDialog(
  { dialog, error, pending, onConfirm, onClose }: {
    dialog: AdminSubscriberDialog
    error: string | null
    pending: boolean
    onConfirm: () => void
    onClose: () => void
  },
): JSX.Element {
  const copy = ACTIONS[dialog.action]
  const danger = dialog.action === "remove"
  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      cancelLabel="Close"
      tone={danger ? "danger" : undefined}
      dataE2E="admin-newsletter-dialog"
    >
      <ScreenForm pending={pending} onSubmit={onConfirm}>
        <Stack>
          <p class="text-sm text-muted wrap-anywhere">{copy.text(dialog.email)}</p>
          <ErrorState message={error} />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              data-e2e="admin-newsletter-confirm"
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
