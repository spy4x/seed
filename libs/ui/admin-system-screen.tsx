// deno-lint-ignore-file ui-text/no-literal
import type { ComponentChildren, JSX } from "preact"
import { IconRefresh } from "@spy4x/preact-icons"
import { formatBytes } from "@spy4x/platform/universal/format-number"
import { timeAgo } from "@spy4x/platform/universal/time"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { type Fact, FactList } from "@spy4x/preact-ui/fact-list"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageAction, PageHeader } from "@spy4x/preact-ui/page-header"
import {
  ADMIN_BACKUP_ERROR_HOURS,
  ADMIN_BACKUP_WARNING_HOURS,
  ADMIN_FAILED_JOBS_DAYS,
  ADMIN_QUEUE_LATE_WARNING_MINUTES,
  AdminHealth,
  type AdminSystemSnapshot,
} from "@domain/identity"
import { When } from "@spy4x/preact-ui/format"
import { ADMIN_JOB_PATHS } from "./admin-jobs-screen.tsx"
import type { Navigate } from "./progressive.tsx"

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
  navigate?: Navigate
}

/**
 * The System page (#429): the health of the stack as status cards with an OK, Warning or Error
 * badge (database, cache, job queue, backup, migrations, build). The queue's card links to the Jobs
 * module (#394), at its failed runs while any failed. Names and states only: no setting, address
 * of a service or secret reaches this page.
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
            <SystemBody snapshot={snapshot} navigate={props.navigate} />
          </>
        )}
    </Stack>
  )
}

function SystemBody(
  { snapshot, navigate }: { snapshot: AdminSystemSnapshot; navigate?: Navigate },
): JSX.Element {
  const { database, cache, fileStore, queue, backup, migrations, build } = snapshot
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
        <StatusCard
          title="Database"
          health={database.health}
          dataE2E="admin-system-database"
          facts={[{
            label: `Reachable`,
            value: database.reachable ? `Yes, in ${database.latencyMs} ms` : "No answer",
          }, {
            label: `Size`,
            value: database.sizeBytes === null ? "Unknown" : formatBytes(database.sizeBytes),
          }, {
            label: `Version`,
            value: database.version ? `Postgres ${database.version}` : "Unknown",
          }, {
            label: `Up since`,
            value: database.startedAt ? <When at={database.startedAt} /> : "Unknown",
          }]}
        />
        <StatusCard
          title="Cache (Valkey)"
          health={cache.health}
          dataE2E="admin-system-cache"
          facts={[{
            label: `Reachable`,
            value: cache.reachable ? `Yes, in ${cache.latencyMs} ms` : "No answer",
          }]}
        />
        <StatusCard
          title="File store (S3)"
          health={fileStore.health}
          dataE2E="admin-system-files"
          facts={[{
            label: `Reachable`,
            value: fileStore.reachable ? `Yes, in ${fileStore.latencyMs} ms` : "No answer",
          }]}
        />
        <StatusCard
          title="Job queue"
          health={queue.health}
          dataE2E="admin-system-queue"
          hint={
            <>
              Warns when a job waits more than {ADMIN_QUEUE_LATE_WARNING_MINUTES}{" "}
              minutes or any job failed.
            </>
          }
          footer={
            <Link
              href={queue.failed > 0 ? ADMIN_JOB_PATHS.failed : ADMIN_JOB_PATHS.list}
              navigate={navigate}
              class="pc-link text-sm font-medium"
              data-e2e="admin-system-open-jobs"
            >
              Open Jobs
            </Link>
          }
          facts={[
            {
              label: `Due now`,
              value: (
                <>
                  {NUMBER.format(queue.due)}
                  {queue.oldestDueAt && (
                    <span class="ml-1 text-muted">
                      · oldest <When at={queue.oldestDueAt} />
                    </span>
                  )}
                </>
              ),
            },
            { label: `Running`, value: NUMBER.format(queue.running) },
            { label: `Waiting to retry`, value: NUMBER.format(queue.retrying) },
            { label: `Scheduled`, value: NUMBER.format(queue.scheduled) },
            {
              label: `Failed, last ${ADMIN_FAILED_JOBS_DAYS} days`,
              value: NUMBER.format(queue.failed),
            },
          ]}
        />
        <StatusCard
          title="Backup"
          health={backup.health}
          dataE2E="admin-system-backup"
          hint={
            <>
              Warns after {ADMIN_BACKUP_WARNING_HOURS} hours without one, and is an error after{" "}
              {ADMIN_BACKUP_ERROR_HOURS}.
            </>
          }
          facts={[{
            label: `Last success`,
            value: backup.succeededAt ? <When at={backup.succeededAt} /> : "None recorded",
          }]}
        />
        <StatusCard
          title="Migrations"
          health={migrations.health}
          dataE2E="admin-system-migrations"
          facts={[{ label: `Applied`, value: NUMBER.format(migrations.applied) }, {
            label: `Newest`,
            value: <span class="font-mono text-xs">{migrations.latest ?? "None"}</span>,
          }, {
            label: `Applied at`,
            value: migrations.latestAt ? <When at={migrations.latestAt} /> : "Never",
          }]}
        />
        <StatusCard
          title="API build"
          dataE2E="admin-system-build"
          class="sm:col-span-2 xl:col-span-3"
          facts={[
            { label: `Version`, value: build.version ?? "Development build" },
            {
              label: `Commit`,
              value: (
                <span class="font-mono text-xs">
                  {build.commit ? build.commit.slice(0, 12) : "Unknown"}
                </span>
              ),
            },
            { label: `Runtime`, value: build.runtime },
            {
              label: `Up since`,
              value: <When at={build.startedAt} />,
            },
          ]}
        />
      </section>
    </>
  )
}

/**
 * One part of the stack: its name, its state as a badge, its facts, and a hint on when it warns.
 * The hint goes after the facts' `<dl>`, never inside it: a `<dl>` holds only `dt` and `dd` groups.
 */
function StatusCard(
  { title, health, dataE2E, hint, footer, class: className, facts }: {
    title: string
    health?: AdminHealth
    dataE2E: string
    /** One quiet line under the facts, such as when the card warns. */
    hint?: ComponentChildren
    /** A link under the hint, to where the card's subject is handled. */
    footer?: ComponentChildren
    /** The card's facts, as `FactList` shows them. */
    facts: readonly Fact[]
    /** Extra classes on the card, such as a column span. */
    class?: string
  },
): JSX.Element {
  return (
    <Card data-e2e={dataE2E} class={className}>
      <CardHeader
        title={title}
        headingLevel={2}
        action={health === undefined ? undefined : <HealthBadge health={health} />}
      />
      <CardBody class="flex flex-col gap-3">
        {
          /* The rows pad themselves; the card already does at its edges. The width cap keeps each
            label beside its value on a card that spans the page, such as the build's (#407). */
        }
        <FactList facts={facts} class="-my-3 max-w-xl" />
        {hint && <p class="text-xs text-muted">{hint}</p>}
        {footer}
      </CardBody>
    </Card>
  )
}
