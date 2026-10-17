import type { ComponentChildren, JSX } from "preact"
import { IconRefresh } from "@spy4x/preact-icons"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { ConfirmDialog } from "@spy4x/preact-ui/confirm-dialog"
import { DataTable, type DataTableColumn } from "@spy4x/preact-ui/data-table"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  ADMIN_BACKUP_ERROR_HOURS,
  ADMIN_BACKUP_WARNING_HOURS,
  ADMIN_FAILED_JOBS_DAYS,
  ADMIN_QUEUE_LATE_WARNING_MINUTES,
  type AdminFailedJob,
  AdminHealth,
  type AdminSystemJobKind,
  type AdminSystemSnapshot,
} from "@domain/identity"
import { When } from "@spy4x/preact-ui/format"

const NUMBER = new Intl.NumberFormat("en")

/** Each state's word and colour. The word always shows, so the colour is never the only sign. */
const HEALTH: Record<AdminHealth, { text: string; color: "green" | "orange" | "red" }> = {
  [AdminHealth.OK]: { text: "OK", color: "green" },
  [AdminHealth.WARNING]: { text: "Warning", color: "orange" },
  [AdminHealth.ERROR]: { text: "Error", color: "red" },
}

/** The banner above the cards: the worst state of the stack in one sentence. */
const SUMMARY: Record<AdminHealth, { tone: "success" | "warning" | "danger"; text: string }> = {
  [AdminHealth.OK]: { tone: "success", text: "Everything is working." },
  [AdminHealth.WARNING]: {
    tone: "warning",
    text: "Something needs a look soon. The cards marked Warning say what.",
  },
  [AdminHealth.ERROR]: {
    tone: "danger",
    text: "Something is broken. The cards marked Error say what.",
  },
}

/** A state as a badge: `OK`, `Warning` or `Error`. */
export function HealthBadge(
  { health, dataE2E }: { health: AdminHealth; dataE2E?: string },
): JSX.Element {
  const { text, color } = HEALTH[health] ?? HEALTH[AdminHealth.ERROR]
  return (
    <span data-e2e={dataE2E} data-health={text.toLowerCase()}>
      <Badge text={text} color={color} />
    </span>
  )
}

export interface AdminSystemScreenProps {
  /** The last reading, or `null` before the first arrives. */
  snapshot: AdminSystemSnapshot | null
  /** Why the page could not be read, or `null`. */
  error: string | null
  /** A reading is in flight. */
  pending: boolean
  onRefresh: () => void
  /** The failed job whose confirmation is open, or `null`. */
  retrying: AdminFailedJob | null
  /** Why the API refused to run it again, or `null`. */
  retryError: string | null
  retryPending: boolean
  onOpenRetry: (job: AdminFailedJob) => void
  onCloseRetry: () => void
  onRetry: (job: AdminFailedJob) => void
}

/**
 * The System page (#429): the health of the stack as status cards with an OK, Warning or Error
 * badge (database, cache, job queue, backup, migrations, build), each job's last and next run, and
 * the jobs that gave up, each of which can be run again after a confirmation. Names and states
 * only: no setting, address of a service or secret reaches this page.
 */
export function AdminSystemScreen(props: AdminSystemScreenProps): JSX.Element {
  const { snapshot, error } = props
  return (
    <Stack>
      <PageHeader
        title="System"
        subtitle={snapshot
          ? (
            <>
              Checked <time dateTime={snapshot.checkedAt}>{timeAgo(snapshot.checkedAt)}</time>
            </>
          )
          : "The health of the services behind the product."}
        titleDataE2E="admin-system-title"
        action={
          <PageAction
            label={props.pending ? "Checking…" : "Check again"}
            Icon={IconRefresh}
            onClick={props.onRefresh}
            disabled={props.pending}
            dataE2E="admin-system-refresh"
          />
        }
      />
      {snapshot === null
        ? error
          ? (
            <div class="flex flex-col items-start gap-3">
              <ErrorState message={error} dataE2E="admin-system-error" />
              <Button variant="secondary" onClick={props.onRefresh}>Try again</Button>
            </div>
          )
          : (
            <div role="status" aria-label="Checking the services" data-e2e="admin-system-loading">
              <LoadingSkeleton rows={6} />
            </div>
          )
        : (
          <>
            <ErrorState message={error} dataE2E="admin-system-error" />
            <SystemBody snapshot={snapshot} onOpenRetry={props.onOpenRetry} />
          </>
        )}
      {props.retrying && (
        <ConfirmDialog
          title="Run this job again"
          confirmLabel="Run again"
          busy={props.retryPending}
          busyLabel="Starting…"
          onConfirm={() => {
            props.onRetry(props.retrying!)
            return false
          }}
          onCancel={props.onCloseRetry}
          dataE2E="admin-retry-dialog"
          confirmDataE2E="admin-retry-confirm"
        >
          <Stack>
            <p class="text-sm text-muted">
              The job <span class="font-mono text-foreground">{props.retrying.kind}</span>{" "}
              gave up after {props.retrying.attempts}{" "}
              {props.retrying.attempts === 1 ? "attempt" : "attempts"}. It runs once more now, with
              a fresh set of attempts. The audit log records that you started it.
            </p>
            <ErrorState message={props.retryError} dataE2E="admin-retry-error" />
          </Stack>
        </ConfirmDialog>
      )}
    </Stack>
  )
}

function SystemBody(
  { snapshot, onOpenRetry }: {
    snapshot: AdminSystemSnapshot
    onOpenRetry: (job: AdminFailedJob) => void
  },
): JSX.Element {
  const { database, cache, queue, backup, migrations, build } = snapshot
  const summary = SUMMARY[snapshot.health] ?? SUMMARY[AdminHealth.ERROR]
  return (
    <>
      <div data-e2e="admin-system-summary" data-health={HEALTH[snapshot.health]?.text}>
        <Notice tone={summary.tone}>{summary.text}</Notice>
      </div>
      <section
        aria-label="Services"
        class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-e2e="admin-system-cards"
      >
        <StatusCard title="Database" health={database.health} dataE2E="admin-system-database">
          <Fact label="Reachable">
            {database.reachable ? `Yes, in ${database.latencyMs} ms` : "No answer"}
          </Fact>
          <Fact label="Size">
            {database.sizeBytes === null ? "Unknown" : formatBytes(database.sizeBytes)}
          </Fact>
          <Fact label="Version">
            {database.version ? `Postgres ${database.version}` : "Unknown"}
          </Fact>
          <Fact label="Up since">
            {database.startedAt ? <When at={database.startedAt} /> : "Unknown"}
          </Fact>
        </StatusCard>
        <StatusCard title="Cache (Valkey)" health={cache.health} dataE2E="admin-system-cache">
          <Fact label="Reachable">
            {cache.reachable ? `Yes, in ${cache.latencyMs} ms` : "No answer"}
          </Fact>
        </StatusCard>
        <StatusCard title="Job queue" health={queue.health} dataE2E="admin-system-queue">
          <Fact label="Due now">
            {NUMBER.format(queue.due)}
            {queue.oldestDueAt && (
              <span class="ml-1 text-muted">
                · oldest <When at={queue.oldestDueAt} />
              </span>
            )}
          </Fact>
          <Fact label="Running">{NUMBER.format(queue.running)}</Fact>
          <Fact label="Waiting to retry">{NUMBER.format(queue.retrying)}</Fact>
          <Fact label="Scheduled">{NUMBER.format(queue.scheduled)}</Fact>
          <Fact label={`Failed, last ${ADMIN_FAILED_JOBS_DAYS} days`}>
            {NUMBER.format(queue.failed)}
          </Fact>
          <p class="text-xs text-muted">
            Warns when a job waits more than {ADMIN_QUEUE_LATE_WARNING_MINUTES}{" "}
            minutes or any job failed.
          </p>
        </StatusCard>
        <StatusCard title="Backup" health={backup.health} dataE2E="admin-system-backup">
          <Fact label="Last success">
            {backup.succeededAt ? <When at={backup.succeededAt} /> : "None recorded"}
          </Fact>
          <p class="text-xs text-muted">
            Warns after {ADMIN_BACKUP_WARNING_HOURS} hours without one, and is an error after{" "}
            {ADMIN_BACKUP_ERROR_HOURS}.
          </p>
        </StatusCard>
        <StatusCard title="Migrations" health={migrations.health} dataE2E="admin-system-migrations">
          <Fact label="Applied">{NUMBER.format(migrations.applied)}</Fact>
          <Fact label="Newest">
            <span class="font-mono text-xs wrap-anywhere">{migrations.latest ?? "None"}</span>
          </Fact>
          <Fact label="Applied at">
            {migrations.latestAt ? <When at={migrations.latestAt} /> : "Never"}
          </Fact>
        </StatusCard>
        <StatusCard title="API build" dataE2E="admin-system-build">
          <Fact label="Version">{build.version ?? "Development build"}</Fact>
          <Fact label="Commit">
            <span class="font-mono text-xs">
              {build.commit ? build.commit.slice(0, 12) : "Unknown"}
            </span>
          </Fact>
          <Fact label="Runtime">{build.runtime}</Fact>
          <Fact label="Up since">
            <When at={build.startedAt} />
          </Fact>
        </StatusCard>
      </section>
      <JobsCard jobs={snapshot.jobs} />
      <FailedJobsCard jobs={snapshot.failedJobs} onOpenRetry={onOpenRetry} />
    </>
  )
}

/** One part of the stack: its name, its state as a badge, and its facts. */
function StatusCard(
  { title, health, dataE2E, children }: {
    title: string
    health?: AdminHealth
    dataE2E: string
    children: ComponentChildren
  },
): JSX.Element {
  return (
    <Card data-e2e={dataE2E}>
      <CardHeader
        title={title}
        headingLevel={2}
        action={health === undefined ? undefined : <HealthBadge health={health} />}
      />
      <CardBody>
        <dl class="flex flex-col gap-2">{children}</dl>
      </CardBody>
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ComponentChildren }): JSX.Element {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <dt class="text-sm text-muted">{label}</dt>
      <dd class="text-sm font-medium wrap-anywhere">{children}</dd>
    </div>
  )
}

function JobsCard({ jobs }: { jobs: readonly AdminSystemJobKind[] }): JSX.Element {
  const columns: DataTableColumn<AdminSystemJobKind, never>[] = [
    {
      id: "kind",
      header: "Job",
      render: (job) => <span class="font-mono text-sm">{job.kind}</span>,
    },
    {
      id: "last",
      header: "Last run",
      render: (job) =>
        job.lastRunAt
          ? (
            <span class="flex flex-wrap items-center gap-2 text-sm">
              <When at={job.lastRunAt} />
              {job.lastFailed
                ? <Badge text="Failed" color="red" type="outline" />
                : <Badge text="Done" color="green" type="outline" />}
            </span>
          )
          : <span class="text-sm text-muted">Not yet</span>,
    },
    {
      id: "next",
      header: "Next run",
      render: (job) =>
        job.nextRunAt
          ? (
            <span class="text-sm">
              <When at={job.nextRunAt} />
            </span>
          )
          : <span class="text-sm text-muted">None waiting</span>,
    },
  ]
  return (
    <Card data-e2e="admin-system-jobs">
      <CardHeader title="Jobs" headingLevel={2} />
      <CardBody>
        <DataTable
          columns={columns}
          rows={jobs}
          sort={[]}
          onSortChange={() => {}}
          caption="Each job's last and next run"
          captionHidden
          rowKey={(job) => job.kind}
          empty={<EmptyState title="No job has run yet" />}
        />
      </CardBody>
    </Card>
  )
}

function FailedJobsCard(
  { jobs, onOpenRetry }: {
    jobs: readonly AdminFailedJob[]
    onOpenRetry: (job: AdminFailedJob) => void
  },
): JSX.Element {
  const columns: DataTableColumn<AdminFailedJob, never>[] = [
    {
      id: "kind",
      header: "Job",
      render: (job) => <span class="font-mono text-sm wrap-anywhere">{job.kind}</span>,
    },
    {
      id: "error",
      header: "Error",
      render: (job) => (
        <span class="flex flex-col text-sm">
          <span class="font-mono wrap-anywhere">{job.errorCode}</span>
          <span class="text-xs text-muted">
            after {job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}
          </span>
        </span>
      ),
    },
    {
      id: "failed",
      header: "Gave up",
      render: (job) => (
        <span class="whitespace-nowrap text-sm">
          <When at={job.failedAt} />
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      render: (job) =>
        job.retryable
          ? (
            <Button
              size="sm"
              variant="secondary"
              data-e2e={`admin-retry-${job.id}`}
              aria-label={`Run ${job.kind} again`}
              onClick={() => onOpenRetry(job)}
            >
              Run again
            </Button>
          )
          : <span class="text-xs text-muted">Cannot be run again</span>,
    },
  ]
  return (
    <Card data-e2e="admin-system-failed">
      <CardHeader
        title={`Failed jobs, last ${ADMIN_FAILED_JOBS_DAYS} days`}
        headingLevel={2}
        action={<span class="text-sm text-muted">{NUMBER.format(jobs.length)}</span>}
      />
      <CardBody>
        <p class="mb-3 text-sm text-muted">
          A group change is never run again: out of order it could undo a later one. Nor is a job
          whose newer run already waits.
        </p>
        <DataTable
          columns={columns}
          rows={jobs}
          sort={[]}
          onSortChange={() => {}}
          caption="Jobs that gave up"
          captionHidden
          rowKey={(job) => job.id}
          empty={
            <EmptyState title="No job failed" description="Every job finished or is waiting." />
          }
        />
      </CardBody>
    </Card>
  )
}
