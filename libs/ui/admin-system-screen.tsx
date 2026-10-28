import type { ComponentChildren, JSX } from "preact"
import { IconRefresh } from "@spy4x/preact-icons"
import { formatBytes } from "@spy4x/platform/universal/format-number"
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
import { Rich } from "@spy4x/preact-ui/i18n"
import { useAdminText } from "./i18n.ts"
import { ADMIN_JOB_PATHS } from "./admin-jobs-screen.tsx"
import type { Navigate } from "./progressive.tsx"

const NUMBER = new Intl.NumberFormat("en")

/**
 * Each state's word and colour. The word always shows, so the colour is never the only sign.
 * `name` is the state's fixed English name for `data-health`, which tests and e2e read.
 */
const HEALTH: Record<
  AdminHealth,
  { name: string; key: string; color: "green" | "orange" | "red" }
> = {
  [AdminHealth.OK]: { name: "ok", key: `AdminSystem.ok`, color: "green" },
  [AdminHealth.WARNING]: { name: "warning", key: `AdminSystem.warning`, color: "orange" },
  [AdminHealth.ERROR]: { name: "error", key: `AdminSystem.error`, color: "red" },
}

/** The banner above the cards: the worst state of the stack in one sentence. */
const SUMMARY: Record<AdminHealth, { tone: "success" | "warning" | "danger"; key: string }> = {
  [AdminHealth.OK]: { tone: "success", key: `AdminSystem.summaryOk` },
  [AdminHealth.WARNING]: { tone: "warning", key: `AdminSystem.summaryWarning` },
  [AdminHealth.ERROR]: { tone: "danger", key: `AdminSystem.summaryError` },
}

/** A state as a badge: `OK`, `Warning` or `Error`. */
export function HealthBadge(
  { health, dataE2E }: { health: AdminHealth; dataE2E?: string },
): JSX.Element {
  const t = useAdminText()
  const { name, key, color } = HEALTH[health] ?? HEALTH[AdminHealth.ERROR]
  return (
    <span data-e2e={dataE2E} data-health={name}>
      <Badge text={t.t(key)} color={color} />
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
  const t = useAdminText()
  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminSystem.title`)}
        subtitle={snapshot
          ? (
            <Rich
              parts={t.parts(`AdminSystem.checked`)}
              tags={{ when: () => <When at={snapshot.checkedAt} /> }}
            />
          )
          : t.t(`AdminSystem.subtitle`)}
        titleDataE2E="admin-system-title"
        action={
          <PageAction
            label={t.t(props.pending ? `AdminSystem.checking` : `AdminSystem.checkAgain`)}
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
              <Button variant="secondary" onClick={props.onRefresh}>
                {t.t(`AdminSystem.retry`)}
              </Button>
            </div>
          )
          : (
            <div
              role="status"
              aria-label={t.t(`AdminSystem.loading`)}
              data-e2e="admin-system-loading"
            >
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
  const t = useAdminText()
  const summary = SUMMARY[snapshot.health] ?? SUMMARY[AdminHealth.ERROR]
  const reachable = (ms: number, ok: boolean) =>
    ok ? t.t(`AdminSystem.reachableIn`, { ms }) : t.t(`AdminSystem.noAnswer`)
  const unknown = t.t(`AdminSystem.unknown`)
  return (
    <>
      <div data-e2e="admin-system-summary" data-health={HEALTH[snapshot.health]?.name}>
        <Notice tone={summary.tone}>{t.t(summary.key)}</Notice>
      </div>
      {
        /* Two columns at most: a third left each card so narrow that its labels wrapped and the
          newest migration's name broke mid-word at 1440 px (#453). */
      }
      <section
        aria-label={t.t(`AdminSystem.services`)}
        class="grid gap-4 lg:grid-cols-2"
        data-e2e="admin-system-cards"
      >
        <StatusCard
          title={t.t(`AdminSystem.database`)}
          health={database.health}
          dataE2E="admin-system-database"
          facts={[{
            label: t.t(`AdminSystem.reachable`),
            value: reachable(database.latencyMs, database.reachable),
          }, {
            label: t.t(`AdminSystem.size`),
            value: database.sizeBytes === null ? unknown : formatBytes(database.sizeBytes),
          }, {
            label: t.t(`AdminSystem.version`),
            value: database.version ? `Postgres ${database.version}` : unknown,
          }, {
            label: t.t(`AdminSystem.upSince`),
            value: database.startedAt ? <When at={database.startedAt} /> : unknown,
          }]}
        />
        <StatusCard
          title={t.t(`AdminSystem.cache`)}
          health={cache.health}
          dataE2E="admin-system-cache"
          facts={[{
            label: t.t(`AdminSystem.reachable`),
            value: reachable(cache.latencyMs, cache.reachable),
          }]}
        />
        <StatusCard
          title={t.t(`AdminSystem.fileStore`)}
          health={fileStore.health}
          dataE2E="admin-system-files"
          facts={[{
            label: t.t(`AdminSystem.reachable`),
            value: reachable(fileStore.latencyMs, fileStore.reachable),
          }]}
        />
        <StatusCard
          title={t.t(`AdminSystem.queue`)}
          health={queue.health}
          dataE2E="admin-system-queue"
          hint={t.t(`AdminSystem.queueHint`, { count: ADMIN_QUEUE_LATE_WARNING_MINUTES })}
          footer={
            <Link
              href={queue.failed > 0 ? ADMIN_JOB_PATHS.failed : ADMIN_JOB_PATHS.list}
              navigate={navigate}
              class="pc-link text-sm font-medium"
              data-e2e="admin-system-open-jobs"
            >
              {t.t(`AdminSystem.openJobs`)}
            </Link>
          }
          facts={[
            {
              label: t.t(`AdminSystem.dueNow`),
              value: (
                <>
                  {NUMBER.format(queue.due)}
                  {queue.oldestDueAt && (
                    <span class="ml-1 text-muted">
                      <Rich
                        parts={t.parts(`AdminSystem.oldest`)}
                        tags={{ when: () => <When at={queue.oldestDueAt!} /> }}
                      />
                    </span>
                  )}
                </>
              ),
            },
            { label: t.t(`AdminSystem.running`), value: NUMBER.format(queue.running) },
            { label: t.t(`AdminSystem.retrying`), value: NUMBER.format(queue.retrying) },
            { label: t.t(`AdminSystem.scheduled`), value: NUMBER.format(queue.scheduled) },
            {
              label: t.t(`AdminSystem.failedDays`, { count: ADMIN_FAILED_JOBS_DAYS }),
              value: NUMBER.format(queue.failed),
            },
          ]}
        />
        <StatusCard
          title={t.t(`AdminSystem.backup`)}
          health={backup.health}
          dataE2E="admin-system-backup"
          hint={t.t(`AdminSystem.backupHint`, {
            count: ADMIN_BACKUP_WARNING_HOURS,
            error: ADMIN_BACKUP_ERROR_HOURS,
          })}
          facts={[{
            label: t.t(`AdminSystem.lastSuccess`),
            value: backup.succeededAt
              ? <When at={backup.succeededAt} />
              : t.t(`AdminSystem.noneRecorded`),
          }]}
        />
        <StatusCard
          title={t.t(`AdminSystem.migrations`)}
          health={migrations.health}
          dataE2E="admin-system-migrations"
          facts={[{ label: t.t(`AdminSystem.applied`), value: NUMBER.format(migrations.applied) }, {
            label: t.t(`AdminSystem.newest`),
            value: (
              <span class="font-mono text-xs">
                {migrations.latest ?? t.t(`AdminSystem.none`)}
              </span>
            ),
          }, {
            label: t.t(`AdminSystem.appliedAt`),
            value: migrations.latestAt
              ? <When at={migrations.latestAt} />
              : t.t(`AdminSystem.never`),
          }]}
        />
        <StatusCard
          title={t.t(`AdminSystem.build`)}
          dataE2E="admin-system-build"
          class="lg:col-span-2"
          facts={[
            {
              label: t.t(`AdminSystem.version`),
              value: build.version ?? t.t(`AdminSystem.developmentBuild`),
            },
            {
              label: t.t(`AdminSystem.commit`),
              value: (
                <span class="font-mono text-xs">
                  {build.commit ? build.commit.slice(0, 12) : unknown}
                </span>
              ),
            },
            { label: t.t(`AdminSystem.runtime`), value: build.runtime },
            {
              label: t.t(`AdminSystem.upSince`),
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
