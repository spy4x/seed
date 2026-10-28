// deno-lint-ignore-file ui-text/no-literal
import type { JSX, RefObject } from "preact"
import { useEffect, useRef, useState } from "preact/hooks"
import { IconArrowPath, IconPlayCircle } from "@spy4x/preact-icons"
import { Badge, type BadgeColor, type BadgeType } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { FactList } from "@spy4x/preact-ui/fact-list"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { OnDay, useFormat, When as Ago } from "@spy4x/preact-ui/format"
import { Input } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import { RadioChips } from "@spy4x/preact-ui/radio-chips"
import { Tabs } from "@spy4x/preact-ui/tabs"
import { Timeline, type TimelineItem } from "@spy4x/preact-ui/timeline"
import {
  ADMIN_JOB_SEARCH_MAX,
  ADMIN_JOB_STATE_FILTERS,
  type AdminJobDetail,
  type AdminJobFilter,
  type AdminJobListResponse,
  type AdminJobRow,
  AdminJobState,
  type AdminJobStateFilter,
  type AdminRepeatingJob,
} from "@domain/identity"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { ADMIN_GROUP_PATHS } from "./admin-groups-list.tsx"
import { type Navigate, ScreenForm } from "./progressive.tsx"

/** The Jobs module's pages in the admin app. */
export const ADMIN_JOB_PATHS = {
  list: `/jobs`,
  failed: `/jobs?state=failed`,
  repeating: `/jobs?tab=repeating`,
  job: (id: string) => `/jobs/${encodeURIComponent(id)}`,
} as const

const NUMBER = new Intl.NumberFormat(`en`)

/** Each state's word and badge. The word always shows, so the colour is never the only sign. */
export const JOB_STATES: Record<
  AdminJobState,
  { text: string; color: BadgeColor; type: BadgeType }
> = {
  [AdminJobState.Scheduled]: { text: `Scheduled`, color: `gray`, type: `outline` },
  [AdminJobState.Due]: { text: `Due now`, color: `blue`, type: `outline` },
  [AdminJobState.Running]: { text: `Running`, color: `blue`, type: `filled` },
  [AdminJobState.Retrying]: { text: `Waiting to retry`, color: `orange`, type: `outline` },
  [AdminJobState.Failed]: { text: `Failed`, color: `red`, type: `filled` },
  [AdminJobState.Done]: { text: `Done`, color: `green`, type: `outline` },
  [AdminJobState.Cancelled]: { text: `Cancelled`, color: `gray`, type: `filled` },
}

/** The label of each state chip. */
const CHIP_LABELS: Record<AdminJobStateFilter, string> = {
  all: `All`,
  failed: `Failed`,
  retrying: `Waiting to retry`,
  scheduled: `Scheduled`,
  running: `Running`,
  done: `Done`,
  cancelled: `Cancelled`,
}

/** A run's state as a badge. */
export function JobStateBadge({ state }: { state: AdminJobState }): JSX.Element {
  const view = JOB_STATES[state] ?? JOB_STATES[AdminJobState.Scheduled]
  return (
    <span data-e2e="admin-job-state" data-state={view.text}>
      <Badge text={view.text} color={view.color} type={view.type} />
    </span>
  )
}

/** A run that waits for its time or a retry, and no worker holds: it may run now or be cancelled. */
export function jobWaits(state: AdminJobState): boolean {
  return state === AdminJobState.Scheduled || state === AdminJobState.Due ||
    state === AdminJobState.Retrying
}

/** `4 of 20`. */
function attemptsLine(job: Pick<AdminJobRow, "attempts" | "maxAttempts">): string {
  return `${NUMBER.format(job.attempts)} of ${NUMBER.format(job.maxAttempts)}`
}

/** `true` once `pending` has lasted `ms`, so a quick answer shows no flash of a skeleton. */
function useLate(pending: boolean, ms = 300): boolean {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!pending) {
      setLate(false)
      return
    }
    const timer = setTimeout(() => setLate(true), ms)
    return () => clearTimeout(timer)
  }, [pending])
  return late
}

/** What the run's "When" says: its next run while it waits, else when it started or ended. */
/**
 * A moment as the job pages show it: `3 hours ago` for the past, `in 6 days` for the future, the
 * exact time on hover. preact-ui's `When` has no future form, so a waiting run would read "a
 * moment ago".
 */
function When({ at, class: className }: { at: string; class?: string }): JSX.Element {
  const format = useFormat()
  const instant = new Date(at)
  if (!(instant.valueOf() > Date.now())) return <Ago at={at} class={className} />
  return (
    <time class={className} dateTime={instant.toISOString()} title={format.exact(at)}>
      {format.relative(at)}
    </time>
  )
}

/**
 * A moment as a UTC clock time, `28 Oct, 03:00 UTC`, the way the schedules are written. The run-now
 * confirmations say it, since "instead of at in 2 hours" does not read.
 */
function AtClock({ at }: { at: string }): JSX.Element {
  const utc = useFormat().utc()
  return (
    <time dateTime={new Date(at).toISOString()} title={utc.exact(at)}>
      {`${utc.dayMonth(at)}, ${utc.time(at)} UTC`}
    </time>
  )
}

function WhenCell({ job }: { job: AdminJobRow }): JSX.Element {
  if (jobWaits(job.state)) {
    return (
      <span class="whitespace-nowrap text-sm">
        <span class="text-muted">Next run</span> <When at={job.dueAt} />
      </span>
    )
  }
  if (job.state === AdminJobState.Running) {
    return (
      <span class="whitespace-nowrap text-sm">
        <span class="text-muted">Started</span> <When at={job.startedAt ?? job.dueAt} />
      </span>
    )
  }
  return job.finishedAt
    ? <When class="whitespace-nowrap text-sm" at={job.finishedAt} />
    : <span class="text-sm text-muted">Not yet</span>
}

/**
 * The table on top of preact-ui's `DataTable`: it fits its rows, pads cells 1rem (0.75rem on a
 * phone), and on a phone shows only the job's cell, which then carries the state, attempts and time
 * on a meta line. Positions follow `runColumns`: 2 status, 3 attempts, 4 when.
 */
const TABLE_CLASS = [
  `[&>div:first-child]:min-h-0`,
  `[&_:is(th,td)]:px-4`,
  `max-sm:[&_:is(th,td)]:px-3`,
  `max-sm:[&_:is(th,td):nth-child(n+2)]:hidden`,
].join(` `)

function runColumns(navigate?: Navigate): DataTableColumn<AdminJobRow, never>[] {
  return [
    {
      id: `job`,
      header: `Job`,
      render: (job) => (
        <div class="flex min-w-0 flex-col gap-1">
          <Link
            href={ADMIN_JOB_PATHS.job(job.id)}
            navigate={navigate}
            class="pc-link line-clamp-2 font-medium"
            data-e2e={`admin-job-${job.id}`}
          >
            {job.label}
          </Link>
          <span class="font-mono text-xs text-muted wrap-anywhere">{job.kind}</span>
          {job.errorCode && (
            <span class="font-mono text-xs text-danger wrap-anywhere" data-e2e="admin-job-error">
              {job.errorCode}
            </span>
          )}
          <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:hidden">
            <JobStateBadge state={job.state} />
            <span>{attemptsLine(job)}</span>
            <WhenCell job={job} />
          </span>
        </div>
      ),
    },
    { id: `state`, header: `Status`, render: (job) => <JobStateBadge state={job.state} /> },
    {
      id: `attempts`,
      header: `Attempts`,
      render: (job) => (
        <span class="whitespace-nowrap text-sm tabular-nums">{attemptsLine(job)}</span>
      ),
    },
    { id: `when`, header: `When`, render: (job) => <WhenCell job={job} /> },
  ]
}

/** The page's two tabs. */
export type AdminJobsTab = `runs` | `repeating`

/** A confirmation the list page may hold open. */
export type AdminJobsConfirm =
  | { kind: `retryAll`; count: number }
  | { kind: `runRepeating`; job: AdminRepeatingJob }

export interface AdminJobsScreenProps {
  tab: AdminJobsTab
  onTab: (tab: AdminJobsTab) => void
  /** What the address asked for; the search form and the chips start from it. */
  filter: AdminJobFilter
  /** The page of runs, or `null` while it loads. */
  list: AdminJobListResponse | null
  pending: boolean
  /** Why the list could not be read, or `null`. */
  error: string | null
  onSearch: (filter: AdminJobFilter) => void
  onPage: (page: number) => void
  onReload: () => void
  /** The repeating jobs, or `null` while they load. */
  repeating: readonly AdminRepeatingJob[] | null
  repeatingError: string | null
  onReloadRepeating: () => void
  /** The repeating job whose "Run now" is in flight, or `null`. */
  starting: string | null
  /** Runs a repeating job now; the screen asks first for one that sends mail. */
  onRunRepeating: (job: AdminRepeatingJob) => void
  confirm: AdminJobsConfirm | null
  confirmPending: boolean
  confirmError: string | null
  onOpenConfirm: (confirm: AdminJobsConfirm) => void
  onCloseConfirm: () => void
  onConfirm: (confirm: AdminJobsConfirm) => void
  navigate?: Navigate
}

/**
 * The Jobs page (#394): every run of a background job, filtered by state and searched by name, and
 * the repeating jobs with their schedules. A run's name opens its page. Names, states, attempts,
 * error classes and times only: a job keeps no data and no error message.
 */
/**
 * Moves focus to `target` once an action went through: it was pending and is now closed with no
 * error. The button that started it is often gone by then (a run done again has no "Run again"),
 * so focus would fall to the page's body. A cancel or a refusal leaves focus where the dialog puts
 * it.
 */
function useFocusAfterAction(
  open: boolean,
  pending: boolean,
  error: string | null,
  target: RefObject<HTMLElement>,
): void {
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !pending && !open && error === null) target.current?.focus()
    wasPending.current = pending
  }, [open, pending, error])
}

export function AdminJobsScreen(props: AdminJobsScreenProps): JSX.Element {
  const failed = props.list?.counts.failed ?? 0
  return (
    <Stack>
      <PageHeader
        title="Jobs"
        subtitle="Work the server does in the background, and how each run went."
        titleDataE2E="admin-jobs-title"
        menu={failed > 0
          ? (
            <DropdownItem
              dataE2E="admin-jobs-retry-all"
              onClick={() => props.onOpenConfirm({ kind: `retryAll`, count: failed })}
            >
              Run again all failed ({NUMBER.format(failed)})
            </DropdownItem>
          )
          : undefined}
        menuDataE2E="admin-jobs-menu"
      />
      <Tabs
        label="Jobs"
        active={props.tab}
        onChange={(id) => props.onTab(id as AdminJobsTab)}
        tabs={[
          { id: `runs`, label: `Runs`, content: <Runs {...props} /> },
          { id: `repeating`, label: `Repeating`, content: <Repeating {...props} /> },
        ]}
      />
      {props.confirm && <ListConfirm {...props} confirm={props.confirm} />}
    </Stack>
  )
}

function Runs(props: AdminJobsScreenProps): JSX.Element {
  const { filter, list, error, navigate } = props
  const count = useRef<HTMLParagraphElement>(null)
  useFocusAfterAction(props.confirm !== null, props.confirmPending, props.confirmError, count)
  const late = useLate(list === null && !error)
  const filtered = filter.query !== `` || filter.state !== `all`
  const clear = () => props.onSearch({ query: ``, state: `all`, page: 1 })
  return (
    <Stack>
      <div class="flex flex-col gap-4">
        <RadioChips
          legend="Status"
          hideLegend
          name="state"
          value={filter.state}
          optionsClass="flex flex-nowrap gap-2 overflow-x-auto pb-1"
          onChange={(value) =>
            props.onSearch({ ...filter, state: value as AdminJobStateFilter, page: 1 })}
          options={ADMIN_JOB_STATE_FILTERS.map((state) => ({
            value: state,
            label: list
              ? `${CHIP_LABELS[state]} ${NUMBER.format(list.counts[state])}`
              : CHIP_LABELS[state],
            inputAttributes: { "data-e2e": `admin-jobs-chip-${state}` },
          }))}
        />
        <ScreenForm
          pending={props.pending}
          onSubmit={(data) =>
            props.onSearch({ ...filter, query: String(data.get(`q`) ?? ``).trim(), page: 1 })}
        >
          {/* Keyed by the query, so going back in history shows the search that page had. */}
          <div key={filter.query} class="flex flex-wrap items-end gap-3" role="search">
            <div class="min-w-0 flex-1 basis-60 sm:max-w-md">
              <Field id="admin-jobs-q" label="Job">
                <Input
                  name="q"
                  type="search"
                  placeholder="Search by job name"
                  data-e2e="admin-jobs-search"
                  defaultValue={filter.query}
                  maxLength={ADMIN_JOB_SEARCH_MAX}
                  autocomplete="off"
                />
              </Field>
            </div>
            <Button
              type="submit"
              data-e2e="admin-jobs-submit"
              busy={props.pending}
              busyLabel="Searching…"
            >
              Search
            </Button>
            {filtered && (
              <Button variant="ghost" data-e2e="admin-jobs-clear" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
        </ScreenForm>
      </div>

      {list === null
        ? error
          ? (
            <div class="flex flex-col items-start gap-3" data-e2e="admin-jobs-error">
              <ErrorState message="Jobs could not be loaded. Check that the server is running, then try again." />
              <Button variant="secondary" onClick={props.onReload}>Try again</Button>
            </div>
          )
          : late && (
            <div role="status" aria-label="Loading jobs" data-e2e="admin-jobs-loading">
              <LoadingSkeleton rows={5} />
            </div>
          )
        : (
          <>
            <ErrorState message={error} />
            <p
              ref={count}
              tabIndex={-1}
              class="text-sm text-muted"
              data-e2e="admin-jobs-count"
              aria-live="polite"
            >
              {`${NUMBER.format(list.total)} ${list.total === 1 ? `job` : `jobs`}`}
            </p>
            {list.total === 0 && filter.state === `failed` && filter.query === ``
              ? (
                <div data-e2e="admin-jobs-none-failed">
                  <Notice tone="success">No failed jobs.</Notice>
                </div>
              )
              : (
                <div data-e2e="admin-jobs-list">
                  <DataTable
                    mode="server"
                    class={TABLE_CLASS}
                    columns={runColumns(navigate)}
                    rows={list.jobs}
                    sort={[]}
                    onSortChange={() => {}}
                    caption="Job runs"
                    captionHidden
                    rowKey={(job) => job.id}
                    empty={filtered
                      ? (
                        <EmptyState
                          inset
                          title="Nothing matches"
                          description="Try another name, or clear the filters."
                          action={
                            <Button variant="secondary" onClick={clear}>Clear filters</Button>
                          }
                        />
                      )
                      : (
                        <EmptyState
                          inset
                          title="No job has run yet"
                          description={`Jobs show here once the server schedules one. Finished jobs are kept for ${list.keptDays} days.`}
                        />
                      )}
                    paging={{
                      page: list.page,
                      pageSize: list.pageSize,
                      total: list.total,
                      onChange: props.onPage,
                      label: `Pages of jobs`,
                    }}
                  />
                </div>
              )}
            <p class="text-xs text-muted">Finished jobs are kept for {list.keptDays} days.</p>
          </>
        )}
    </Stack>
  )
}

function Repeating(props: AdminJobsScreenProps): JSX.Element {
  const { repeating, repeatingError, navigate } = props
  const late = useLate(repeating === null && !repeatingError)
  if (repeating === null) {
    return repeatingError
      ? (
        <div class="flex flex-col items-start gap-3" data-e2e="admin-repeating-error">
          <ErrorState message="Jobs could not be loaded. Check that the server is running, then try again." />
          <Button variant="secondary" onClick={props.onReloadRepeating}>Try again</Button>
        </div>
      )
      : late
      ? (
        <div role="status" aria-label="Loading jobs">
          <LoadingSkeleton rows={3} />
        </div>
      )
      : <div />
  }
  const columns: DataTableColumn<AdminRepeatingJob, never>[] = [
    {
      id: `job`,
      header: `Job`,
      render: (job) => (
        <div class="flex min-w-0 flex-col gap-1">
          {job.nextId
            ? (
              <Link
                href={ADMIN_JOB_PATHS.job(job.nextId)}
                navigate={navigate}
                class="pc-link font-medium"
              >
                {job.label}
              </Link>
            )
            : <span class="font-medium">{job.label}</span>}
          <span class="font-mono text-xs text-muted wrap-anywhere">{job.kind}</span>
          <span class="text-xs text-muted sm:hidden">{job.schedule}</span>
          {job.lastFailed && <span class="text-xs text-danger sm:hidden">Last run failed</span>}
        </div>
      ),
    },
    {
      id: `schedule`,
      header: `Schedule`,
      render: (job) => (
        <span class="text-sm" data-e2e="admin-repeating-schedule">{job.schedule}</span>
      ),
    },
    {
      id: `last`,
      header: `Last run`,
      render: (job) =>
        job.lastRunAt
          ? (
            <span class="flex flex-wrap items-center gap-2 text-sm">
              {job.lastFailed
                ? <Badge text="Failed" color="red" type="outline" />
                : <Badge text="Done" color="green" type="outline" />}
              <When at={job.lastRunAt} />
            </span>
          )
          : <span class="text-sm text-muted">Not yet</span>,
    },
    {
      id: `next`,
      header: `Next run`,
      render: (job) =>
        job.nextRunAt
          ? <When class="whitespace-nowrap text-sm" at={job.nextRunAt} />
          : <span class="text-sm text-muted">None waiting</span>,
    },
    {
      id: `action`,
      header: `Action`,
      render: (job) =>
        job.running ? <Badge text="Running" color="blue" /> : (
          <Button
            size="sm"
            variant="secondary"
            busy={props.starting === job.kind}
            busyLabel="Starting…"
            data-e2e={`admin-repeating-run-${job.kind}`}
            aria-label={`Run ${job.label} now`}
            onClick={() =>
              job.sendsMail
                ? props.onOpenConfirm({ kind: `runRepeating`, job })
                : props.onRunRepeating(job)}
          >
            Run now
          </Button>
        ),
    },
  ]
  return (
    <div data-e2e="admin-repeating">
      <DataTable
        class={[
          `[&>div:first-child]:min-h-0`,
          `[&_:is(th,td)]:px-4`,
          `max-sm:[&_:is(th,td)]:px-3`,
          `max-sm:[&_:is(th,td):nth-child(2)]:hidden`,
          `max-sm:[&_:is(th,td):nth-child(3)]:hidden`,
        ].join(` `)}
        columns={columns}
        rows={repeating}
        sort={[]}
        onSortChange={() => {}}
        caption="Repeating jobs"
        captionHidden
        rowKey={(job) => job.kind}
        empty={
          <EmptyState
            inset
            title="No job repeats"
            description="A job repeats once its definition has a schedule."
          />
        }
      />
    </div>
  )
}

function ListConfirm(
  props: AdminJobsScreenProps & { confirm: AdminJobsConfirm },
): JSX.Element {
  const { confirm } = props
  const many = confirm.kind === `retryAll`
  return (
    <ConfirmDialog
      title={many
        ? `Run ${NUMBER.format(confirm.count)} failed ${
          confirm.count === 1 ? `job` : `jobs`
        } again?`
        : `Run this job now?`}
      confirmLabel={many ? `Run again` : `Run now`}
      busy={props.confirmPending}
      busyLabel="Starting…"
      onConfirm={() => {
        props.onConfirm(confirm)
        return false
      }}
      onCancel={props.onCloseConfirm}
      dataE2E="admin-jobs-confirm"
      confirmDataE2E="admin-jobs-confirm-ok"
    >
      <Stack>
        <p class="text-sm text-muted">
          {many ? `Each runs once more with a fresh set of attempts.` : (
            <>
              {confirm.job.label} runs now
              {confirm.job.nextRunAt && (
                <>
                  {` instead of at `}
                  <AtClock at={confirm.job.nextRunAt} />
                </>
              )}. A repeating job keeps its schedule after this run.
            </>
          )}
        </p>
        <ErrorState message={props.confirmError} />
      </Stack>
    </ConfirmDialog>
  )
}

/** An action on one run. */
export type AdminJobAction = `retry` | `runNow` | `cancel`

export interface AdminJobScreenProps {
  /** The run, or `null` while it loads or when it could not be read. */
  job: AdminJobDetail | null
  error: string | null
  onReload: () => void
  /** The action whose confirmation is open, or `null`. */
  dialog: AdminJobAction | null
  /** An action is in flight, confirmed or not. */
  pending: boolean
  /** Why the action failed, shown in its dialog, or `null`. */
  dialogError: string | null
  onOpenDialog: (action: AdminJobAction) => void
  onCloseDialog: () => void
  /** Sends the action. The screen confirms first a cancel, and a job that sends mail. */
  onAction: (action: AdminJobAction) => void
  onCopyId: (id: string) => void
  navigate?: Navigate
}

function Time({ at, none = `Not yet` }: { at: string | null; none?: string }): JSX.Element {
  return at ? <When at={at} /> : <span class="text-muted">{none}</span>
}

/**
 * One run of a job (#394): its state and the action that fits it as the page's primary action
 * (Run again for a failed run, Run now for a waiting one), its facts, what it is about and when it
 * happened. Cancel and Copy id sit in More actions. A run that sends mail, and every cancel, asks
 * first.
 */
export function AdminJobScreen(props: AdminJobScreenProps): JSX.Element {
  const { job, error, navigate } = props
  const back = { href: ADMIN_JOB_PATHS.list, label: `Jobs` }
  const facts = useRef<HTMLElement>(null)
  useFocusAfterAction(props.dialog !== null, props.pending, props.dialogError, facts)

  if (!job) {
    return (
      <Stack>
        <PageHeader title="Job" back={back} navigate={navigate} />
        {error
          ? (
            <div class="flex flex-col items-start gap-3" data-e2e="admin-job-load-error">
              <ErrorState message={error} />
              <Button variant="secondary" onClick={props.onReload}>Try again</Button>
            </div>
          )
          : (
            <div role="status" aria-label="Loading the job">
              <LoadingSkeleton rows={5} />
            </div>
          )}
      </Stack>
    )
  }

  const waits = jobWaits(job.state)
  const failed = job.state === AdminJobState.Failed
  const start = (action: AdminJobAction) =>
    job.sendsMail ? props.onOpenDialog(action) : props.onAction(action)
  const primary = failed
    ? (
      <PageAction
        label={props.pending ? `Starting…` : `Run again`}
        Icon={IconArrowPath}
        hotkey="r"
        disabled={props.pending}
        onClick={() => start(`retry`)}
        dataE2E="admin-job-retry"
      />
    )
    : waits
    ? (
      <PageAction
        label={props.pending ? `Starting…` : `Run now`}
        Icon={IconPlayCircle}
        hotkey="n"
        disabled={props.pending}
        onClick={() => start(`runNow`)}
        dataE2E="admin-job-run-now"
      />
    )
    : undefined

  const timeline: TimelineItem[] = [
    { id: `created`, title: `Created`, at: job.createdAt, when: <When at={job.createdAt} /> },
  ]
  if (job.startedAt) {
    timeline.push({
      id: `started`,
      title: `Last try`,
      at: job.startedAt,
      when: <When at={job.startedAt} />,
      description: `Attempt ${attemptsLine(job)}`,
    })
  }
  if (job.finishedAt) {
    const ended = job.state === AdminJobState.Failed
      ? { title: `Gave up`, tone: `danger` as const }
      : job.state === AdminJobState.Cancelled
      ? { title: `Cancelled`, tone: `warning` as const }
      : { title: `Finished`, tone: `success` as const }
    timeline.push({ id: `ended`, ...ended, at: job.finishedAt, when: <When at={job.finishedAt} /> })
  }

  return (
    <Stack>
      <PageHeader
        title={job.label}
        // The header truncates its subtitle; a long code name wraps instead, so a phone shows it
        // whole.
        subtitle={
          <span class="flex flex-wrap items-center gap-2 whitespace-normal">
            <JobStateBadge state={job.state} />
            <span class="min-w-0 font-mono text-xs wrap-anywhere">{job.kind}</span>
          </span>
        }
        back={back}
        navigate={navigate}
        action={primary}
        menu={
          <>
            {waits && job.cancellable && (
              <DropdownItem
                danger
                dataE2E="admin-job-cancel"
                onClick={() => props.onOpenDialog(`cancel`)}
              >
                Cancel job
              </DropdownItem>
            )}
            <DropdownItem dataE2E="admin-job-copy-id" onClick={() => props.onCopyId(job.id)}>
              Copy id
            </DropdownItem>
          </>
        }
        menuDataE2E="admin-job-menu"
        titleDataE2E="admin-job-title"
      />

      <div class="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section
          ref={facts as RefObject<HTMLElement>}
          tabIndex={-1}
          aria-label="Details"
          class="rounded-xl border border-subtle bg-surface px-4 py-1"
          data-e2e="admin-job-facts"
        >
          <FactList
            facts={[
              { label: `Job`, value: job.label },
              { label: `Status`, value: <JobStateBadge state={job.state} /> },
              { label: `Repeats`, value: job.repeats ?? `No` },
              { label: `Created`, value: <Time at={job.createdAt} /> },
              { label: `Due at`, value: <Time at={job.dueAt} /> },
              { label: `Started`, value: <Time at={job.startedAt} /> },
              { label: `Finished`, value: <Time at={job.finishedAt} /> },
              { label: `Attempts`, value: attemptsLine(job) },
              {
                label: `Last error`,
                value: job.errorCode
                  ? <span class="font-mono" data-e2e="admin-job-error-code">{job.errorCode}</span>
                  : <span class="text-muted">None</span>,
                hint: `The error type only. The message is not stored.`,
              },
              {
                label: `About`,
                value: job.about
                  ? (
                    <Link
                      href={job.about.type === `user`
                        ? ADMIN_PATHS.user(job.about.id)
                        : ADMIN_GROUP_PATHS.group(job.about.id)}
                      navigate={navigate}
                      class="pc-link"
                      data-e2e="admin-job-about"
                    >
                      {job.about.name} →
                    </Link>
                  )
                  : <span class="text-muted">Nothing linked</span>,
              },
            ]}
          />
        </section>
        <section aria-label="What happened" class="rounded-xl border border-subtle bg-surface p-4">
          <Timeline items={timeline} label="What happened" />
        </section>
      </div>
      {job.keptUntil && (
        <p class="text-xs text-muted" data-e2e="admin-job-kept">
          Kept until <OnDay at={job.keptUntil} />, 7 days after it finished.
        </p>
      )}
      {props.dialog && <JobConfirm {...props} job={job} dialog={props.dialog} />}
    </Stack>
  )
}

function JobConfirm(
  props: AdminJobScreenProps & { job: AdminJobDetail; dialog: AdminJobAction },
): JSX.Element {
  const { job, dialog } = props
  const copy = {
    retry: {
      title: `Run this job again?`,
      body: (
        <>
          {job.label}
          {` `}sends email. If it partly ran before, someone may get it twice. The audit log records
          that you started it.
        </>
      ),
      confirm: `Run again`,
      busy: `Starting…`,
    },
    runNow: {
      title: `Run this job now?`,
      body: (
        <>
          {job.label} runs now instead of at{" "}
          <AtClock at={job.dueAt} />. A repeating job keeps its schedule after this run.
        </>
      ),
      confirm: `Run now`,
      busy: `Starting…`,
    },
    cancel: {
      title: `Cancel this job?`,
      body: (
        <>
          {job.label}
          {` `}will not run. A repeating job starts again the next time the worker starts. This
          cannot be undone.
        </>
      ),
      confirm: `Cancel job`,
      busy: `Cancelling…`,
    },
  }[dialog]
  return (
    <ConfirmDialog
      title={copy.title}
      confirmLabel={copy.confirm}
      cancelLabel={dialog === `cancel` ? `Keep it` : undefined}
      tone={dialog === `cancel` ? `danger` : undefined}
      busy={props.pending}
      busyLabel={copy.busy}
      onConfirm={() => {
        props.onAction(dialog)
        return false
      }}
      onCancel={props.onCloseDialog}
      dataE2E="admin-job-dialog"
      confirmDataE2E="admin-job-dialog-confirm"
    >
      <Stack>
        <p class="text-sm text-muted">{copy.body}</p>
        <ErrorState message={props.dialogError} dataE2E="admin-job-dialog-error" />
      </Stack>
    </ConfirmDialog>
  )
}
