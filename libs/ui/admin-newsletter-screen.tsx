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
import { languageName } from "@spy4x/preact-ui/language-picker"
import {
  ADMIN_SEARCH_MAX_LENGTH,
  ADMIN_STATS_DAYS,
  type Language,
  LANGUAGES,
} from "@domain/identity"
import type {
  AdminNewsletterSend,
  AdminNewsletterStats,
  AdminSubscriberFilter,
  AdminSubscriberListResponse,
  AdminSubscriberRow,
  AdminSubscriberStatus,
  AdminSubscriberStatusFilter,
} from "@domain/subscribers"
import { changeTone, countAxisTop, statChange } from "./admin-dashboard-screen.tsx"
import { ScreenForm } from "./progressive.tsx"
import { OnDay, useFormat, When } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

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

const STATUS_CHIPS: { value: AdminSubscriberStatus; key: string }[] = [
  { value: "confirmed", key: `AdminNewsletter.confirmed` },
  { value: "pending", key: `AdminNewsletter.pending` },
]

/** What each action's dialog says and does, as catalog keys. */
const ACTIONS: Record<AdminSubscriberAction, {
  title: string
  text: string
  submit: string
  busy: string
}> = {
  remove: {
    title: `AdminNewsletter.removeTitle`,
    text: `AdminNewsletter.removeText`,
    submit: `AdminNewsletter.removeSubmit`,
    busy: `AdminNewsletter.removing`,
  },
  resend: {
    title: `AdminNewsletter.resendTitle`,
    text: `AdminNewsletter.resendText`,
    submit: `AdminNewsletter.resendSubmit`,
    busy: `AdminNewsletter.sending`,
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
  const t = useAdminText()
  const tabs = [
    {
      id: "subscribers",
      label: t.t(`AdminNewsletter.subscribers`),
      content: <SubscribersTab {...props} />,
    },
    {
      id: "sends",
      label: t.t(`AdminNewsletter.sentIssues`),
      content: <SendsTab sends={props.sends} error={props.sendsError} />,
    },
  ]
  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminNewsletter.title`)}
        subtitle={t.t(`AdminNewsletter.subtitle`)}
        titleDataE2E="admin-newsletter-title"
        action={
          <PageAction
            label={t.t(props.exporting ? `AdminNewsletter.exporting` : `AdminNewsletter.export`)}
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
        label={t.t(`AdminNewsletter.title`)}
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
  const t = useAdminText()
  if (stats === null) {
    return error
      ? (
        <div class="flex flex-col items-start gap-3">
          <ErrorState message={error} dataE2E="admin-newsletter-stats-error" />
          <Button variant="secondary" onClick={onRetry}>{t.t(`AdminNewsletter.retry`)}</Button>
        </div>
      )
      : (
        <div role="status" aria-label={t.t(`AdminNewsletter.loadingNumbers`)}>
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
      <section aria-label={t.t(`AdminNewsletter.keyNumbers`)} data-e2e="admin-newsletter-stats">
        <KpiGrid minWidth="11rem">
          <Kpi
            label={t.t(`AdminNewsletter.subscribers`)}
            value={NUMBER.format(stats.confirmed)}
            sub={t.t(`AdminNewsletter.confirmedHint`)}
            tone="accent"
          />
          <Kpi
            label={t.t(`AdminNewsletter.pending`)}
            value={NUMBER.format(stats.pending)}
            sub={t.t(`AdminNewsletter.pendingHint`)}
            tone="neutral"
          />
          <Kpi
            label={t.t(`AdminNewsletter.joined`, { count: ADMIN_STATS_DAYS })}
            value={NUMBER.format(stats.joined.current)}
            sub={statChange(t, stats.joined, ADMIN_STATS_DAYS)}
            tone={changeTone(stats.joined)}
          />
          <Kpi
            label={t.t(`AdminNewsletter.issuesSent`)}
            value={NUMBER.format(stats.issues)}
            tone="neutral"
          />
        </KpiGrid>
      </section>
      <Card data-e2e="admin-newsletter-chart">
        <CardHeader
          title={t.t(`AdminNewsletter.perDay`)}
          headingLevel={2}
          action={<span class="text-sm text-muted">{growthText(t, growth, days.length)}</span>}
        />
        <CardBody>
          <LineChart
            series={[{
              name: t.t(`AdminNewsletter.subscribers`),
              points: days.map((day) => ({ x: day.day, y: day.count })),
            }]}
            height={220}
            yDomain={[0, countAxisTop(days.map((day) => day.count))]}
            yTicks={5}
            xFormat={(x) => day.dayMonth(typeof x === "string" ? `${x}T00:00:00Z` : x)}
            yFormat={(value) => NUMBER.format(value)}
            ariaLabel={t.t(`AdminNewsletter.chartLabel`, { count: days.length })}
            emptyLabel={t.t(`AdminNewsletter.nothingYet`)}
          />
        </CardBody>
      </Card>
    </>
  )
}

/** "+3 in 30 days", "−2 in 30 days" or "No change in 30 days". */
function growthText(t: Translator<string>, growth: number, days: number): string {
  if (growth === 0) return t.t(`AdminNewsletter.noChange`, { count: days })
  return t.t(growth > 0 ? `AdminNewsletter.growthUp` : `AdminNewsletter.growthDown`, {
    n: Math.abs(growth),
    count: days,
  })
}

/** The search, the status chips and the table of addresses. */
function SubscribersTab(props: AdminNewsletterScreenProps): JSX.Element {
  const { filter, list, pending, error, onSearch, onPage, onOpenDialog, done } = props
  const heading = useRef<HTMLHeadingElement>(null)
  const t = useAdminText()

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

  const filtered = filter.query !== "" || filter.status !== "any" || filter.language !== "any"
  return (
    <Stack>
      <Notice tone="info" title={t.t(`AdminNewsletter.notKeptTitle`)}>
        {t.t(`AdminNewsletter.notKeptText`)}
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
              <Field id="admin-newsletter-q" label={t.t(`AdminNewsletter.address`)}>
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
              busyLabel={t.t(`AdminNewsletter.searching`)}
            >
              {t.t(`AdminNewsletter.search`)}
            </Button>
          </div>
        </ScreenForm>
        <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div class="flex flex-wrap items-center gap-2" data-e2e="admin-newsletter-status">
            <span class="text-sm text-muted" aria-hidden="true">
              {t.t(`AdminNewsletter.status`)}
            </span>
            <ToggleChips
              mode="single"
              label={t.t(`AdminNewsletter.status`)}
              options={STATUS_CHIPS.map((chip) => ({ value: chip.value, label: t.t(chip.key) }))}
              value={filter.status === "any" ? null : filter.status}
              onChange={(value) =>
                onSearch({
                  ...filter,
                  status: (value ?? "any") as AdminSubscriberStatusFilter,
                  page: 1,
                })}
            />
          </div>
          <div class="flex flex-wrap items-center gap-2" data-e2e="admin-newsletter-language">
            <span class="text-sm text-muted" aria-hidden="true">
              {t.t(`AdminNewsletter.language`)}
            </span>
            <ToggleChips
              mode="single"
              label={t.t(`AdminNewsletter.language`)}
              options={LANGUAGES.map((language) => ({
                value: language,
                label: languageName(language),
              }))}
              value={filter.language === "any" ? null : filter.language}
              onChange={(value) =>
                onSearch({ ...filter, language: (value ?? "any") as Language | "any", page: 1 })}
            />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              data-e2e="admin-newsletter-clear"
              onClick={() => onSearch({ query: "", status: "any", language: "any", page: 1 })}
            >
              {t.t(`AdminNewsletter.clear`)}
            </Button>
          )}
        </div>
      </div>

      <ErrorState message={error} dataE2E="admin-newsletter-error" />

      <h2 ref={heading} tabIndex={-1} class="text-sm text-muted" data-e2e="admin-newsletter-count">
        {list
          ? t.t(`AdminNewsletter.count`, { count: list.total })
          : t.t(`AdminNewsletter.loadingAddresses`)}
      </h2>
      {list === null
        ? !error && (
          <div role="status" aria-label={t.t(`AdminNewsletter.loadingAddresses`)}>
            <LoadingSkeleton rows={5} />
          </div>
        )
        : (
          <div data-e2e="admin-newsletter-list">
            <DataTable
              mode="server"
              class="[&>div:first-child]:min-h-0"
              columns={subscriberColumns(t, onOpenDialog)}
              rows={list.subscribers}
              sort={NO_SORT}
              onSortChange={noSort}
              caption={t.t(`AdminNewsletter.subscribers`)}
              captionHidden
              rowKey={(row) => row.email}
              empty={filtered
                ? (
                  <EmptyState
                    inset
                    title={t.t(`AdminNewsletter.nobodyMatches`)}
                    description={t.t(`AdminNewsletter.nobodyMatchesHint`)}
                  />
                )
                : (
                  <EmptyState
                    inset
                    title={t.t(`AdminNewsletter.noSubscribers`)}
                    description={t.t(`AdminNewsletter.noSubscribersHint`)}
                  />
                )}
              paging={{
                page: list.page,
                pageSize: list.pageSize,
                total: list.total,
                onChange: onPage,
                label: t.t(`AdminNewsletter.pages`),
              }}
            />
          </div>
        )}
    </Stack>
  )
}

/** The table's columns: the address with its actions, its status, its language and its dates. */
function subscriberColumns(
  t: Translator<string>,
  onOpenDialog: (dialog: AdminSubscriberDialog) => void,
): DataTableColumn<AdminSubscriberRow, never>[] {
  return [
    {
      id: "email",
      header: t.t(`AdminNewsletter.address`),
      // The actions sit under the address, so a phone shows them without scrolling sideways.
      render: ({ email, status }) => (
        <Stack gap="xs" class="min-w-48 items-start">
          {
            /* At least 12rem wide: on a phone the table scrolls sideways instead of squeezing the
              address into a column a few letters wide. */
          }
          <span
            class="font-medium wrap-anywhere"
            translate={false}
            data-e2e="admin-subscriber-email"
          >
            {email}
          </span>
          <Cluster gap="xs" class="-ml-2">
            {status === "pending" && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t.t(`AdminNewsletter.resendTo`, { email })}
                data-e2e="admin-subscriber-resend"
                onClick={() => onOpenDialog({ action: "resend", email })}
              >
                {t.t(`AdminNewsletter.resendSubmit`)}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label={t.t(`AdminNewsletter.removeEmail`, { email })}
              data-e2e="admin-subscriber-remove"
              onClick={() => onOpenDialog({ action: "remove", email })}
            >
              {t.t(`AdminNewsletter.removeSubmit`)}
            </Button>
          </Cluster>
        </Stack>
      ),
    },
    {
      id: "status",
      header: t.t(`AdminNewsletter.status`),
      render: ({ status }) =>
        status === "confirmed"
          ? <Badge text={t.t(`AdminNewsletter.confirmed`)} color="green" />
          : <Badge text={t.t(`AdminNewsletter.pending`)} color="orange" type="outline" />,
    },
    {
      id: "language",
      header: t.t(`AdminNewsletter.language`),
      render: ({ language }) => (
        <span class="whitespace-nowrap text-sm" lang={language}>{languageName(language)}</span>
      ),
    },
    {
      id: "since",
      header: t.t(`AdminNewsletter.since`),
      render: (row) => {
        const at = row.confirmedAt ?? row.requestedAt
        if (!at) return <span class="text-sm text-muted">{t.t(`AdminNewsletter.unknown`)}</span>
        return (
          row.confirmedAt
            ? <OnDay class="whitespace-nowrap text-sm text-muted" at={at} />
            : (
              <span class="whitespace-nowrap text-sm text-muted">
                <Rich
                  parts={t.parts(`AdminNewsletter.asked`)}
                  tags={{ when: () => <When at={at} /> }}
                />
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
  const t = useAdminText()
  if (sends === null) {
    return error
      ? <ErrorState message={error} dataE2E="admin-newsletter-sends-error" />
      : (
        <div role="status" aria-label={t.t(`AdminNewsletter.loadingSends`)}>
          <LoadingSkeleton rows={4} />
        </div>
      )
  }
  return (
    <div data-e2e="admin-newsletter-sends">
      <DataTable
        mode="server"
        class="[&>div:first-child]:min-h-0"
        columns={sendColumns(t)}
        rows={sends}
        sort={NO_SORT}
        onSortChange={noSort}
        caption={t.t(`AdminNewsletter.sentIssues`)}
        captionHidden
        rowKey={(row) => row.issue}
        empty={
          <EmptyState
            inset
            title={t.t(`AdminNewsletter.nothingSent`)}
            description={t.t(`AdminNewsletter.nothingSentHint`)}
          />
        }
      />
    </div>
  )
}

/** The sent issues' columns, in the operator's language. */
function sendColumns(t: Translator<string>): DataTableColumn<AdminNewsletterSend, never>[] {
  // A count, or a dash when the send log has none.
  const count = (value: number | null) =>
    value === null
      ? <span class="text-muted" aria-label={t.t(`AdminNewsletter.notRecorded`)}>—</span>
      : <span class="tabular-nums">{NUMBER.format(value)}</span>
  return [
    {
      id: "subject",
      header: t.t(`AdminNewsletter.issue`),
      render: ({ subject, issue }) => (
        <div class="flex min-w-48 flex-col" translate={false}>
          <span class="font-medium wrap-anywhere">{subject}</span>
          <span class="text-sm text-muted wrap-anywhere">{issue}</span>
        </div>
      ),
    },
    {
      id: "startedAt",
      header: t.t(`AdminNewsletter.sent`),
      render: ({ startedAt }) => <OnDay class="whitespace-nowrap text-sm" at={startedAt} />,
    },
    {
      id: "recipients",
      header: t.t(`AdminNewsletter.recipients`),
      render: ({ recipients }) => count(recipients),
    },
    { id: "sent", header: t.t(`AdminNewsletter.delivered`), render: ({ sent }) => count(sent) },
    {
      id: "failed",
      header: t.t(`AdminNewsletter.failed`),
      render: ({ failed }) =>
        failed !== null && failed > 0
          ? <Badge text={NUMBER.format(failed)} color="red" />
          : count(failed),
    },
    {
      id: "state",
      header: t.t(`AdminNewsletter.state`),
      render: ({ completedAt, failed }) =>
        completedAt
          ? <Badge text={t.t(`AdminNewsletter.finished`)} color="green" type="outline" />
          : failed !== null && failed > 0
          ? <Badge text={t.t(`AdminNewsletter.needsRerun`)} color="orange" />
          : <Badge text={t.t(`AdminNewsletter.sendingState`)} color="blue" type="outline" />,
    },
  ]
}

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
  const t = useAdminText()
  const copy = ACTIONS[dialog.action]
  const danger = dialog.action === "remove"
  return (
    <Modal
      open
      onClose={onClose}
      title={t.t(copy.title)}
      cancelLabel={t.t(`AdminNewsletter.close`)}
      tone={danger ? "danger" : undefined}
      dataE2E="admin-newsletter-dialog"
    >
      <ScreenForm pending={pending} onSubmit={onConfirm}>
        <Stack>
          <p class="text-sm text-muted wrap-anywhere">
            <Rich
              parts={t.parts(copy.text, { email: dialog.email })}
              tags={{ email: (text: string) => <bdi translate={false}>{text}</bdi> }}
            />
          </p>
          <ErrorState message={error} />
          <DialogActions>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t.t(`AdminNewsletter.cancel`)}
            </Button>
            <Button
              type="submit"
              variant={danger ? "danger" : "primary"}
              data-e2e="admin-newsletter-confirm"
              busy={pending}
              busyLabel={t.t(copy.busy)}
            >
              {t.t(copy.submit)}
            </Button>
          </DialogActions>
        </Stack>
      </ScreenForm>
    </Modal>
  )
}
