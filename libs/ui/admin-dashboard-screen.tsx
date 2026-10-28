import type { JSX } from "preact"
import { changeText } from "@spy4x/preact-charts/change"
import { Kpi, KpiGrid, type KpiTone } from "@spy4x/preact-charts/kpi"
import { LineChart } from "@spy4x/preact-charts/line-chart"
import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { LoadingSkeleton } from "@spy4x/preact-ui/loading-skeleton"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import {
  ADMIN_STATS_DAYS,
  type AdminDailyCount,
  type AdminStatChange,
  type AdminStats,
  type GuestStats,
} from "@domain/identity"
import { useFormat } from "@spy4x/preact-ui/format"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAdminText } from "./i18n.ts"

const NUMBER = new Intl.NumberFormat("en")

/**
 * A change as a stat card's second line, in the operator's language: `+3 vs previous 7 days`,
 * `−1 vs yesterday`, or that it did not change. `days` is the period compared with: 1 reads
 * "yesterday".
 */
export function statChange(t: Translator<string>, change: AdminStatChange, days: number): string {
  const period = days === 1
    ? t.t(`AdminDashboard.yesterday`)
    : t.t(`AdminDashboard.previousDays`, { count: days })
  return changeText(change, period, `en`, t)
}

/**
 * The top of a count chart's Y axis: the first of 5, 10, 20, 50, 100, 200 and on that holds the
 * largest count. The chart steps its axis by a nice fraction of the top, and for these tops the
 * {@link COUNT_AXIS_STEPS} steps fall on whole people. A derived domain would pad below 0 and step
 * by fractions.
 */
export function countAxisTop(counts: readonly number[]): number {
  const largest = Math.max(0, ...counts)
  if (!Number.isFinite(largest)) return 5
  for (let scale = 1;; scale *= 10) {
    for (const top of [5 * scale, 10 * scale, 20 * scale]) if (top >= largest) return top
  }
}

/** How many steps a count chart's Y axis takes from 0 to {@link countAxisTop}. */
const COUNT_AXIS_STEPS = 5

/** A growth number's colour: up is good, down is a warning, flat is neutral. */
export function changeTone(change: AdminStatChange): KpiTone {
  if (change.current > change.previous) return "positive"
  if (change.current < change.previous) return "warning"
  return "neutral"
}

export interface AdminDashboardScreenProps {
  /** The numbers, or `null` while they load or when they could not be read. */
  stats: AdminStats | null
  /** Why the numbers could not be read, or `null`. */
  error: string | null
  /** Reads the numbers again. */
  onRetry: () => void
}

/**
 * The admin app's first page (#424): stat cards with the change against the period before, and
 * two 30-day charts, sign-ups and active people per day. Counts only: nobody's name or content.
 */
export function AdminDashboardScreen(
  { stats, error, onRetry }: AdminDashboardScreenProps,
): JSX.Element {
  const t = useAdminText()
  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminDashboard.title`)}
        subtitle={t.t(`AdminDashboard.subtitle`, { count: ADMIN_STATS_DAYS })}
        titleDataE2E="admin-dashboard-title"
      />
      {stats === null
        ? error
          ? (
            <div class="flex flex-col items-start gap-3">
              <ErrorState message={error} dataE2E="admin-dashboard-error" />
              <Button variant="secondary" onClick={onRetry}>{t.t(`AdminDashboard.retry`)}</Button>
            </div>
          )
          : (
            <div
              role="status"
              aria-label={t.t(`AdminDashboard.loading`)}
              data-e2e="admin-dashboard-loading"
            >
              <LoadingSkeleton rows={6} />
            </div>
          )
        : <DashboardBody stats={stats} />}
    </Stack>
  )
}

function DashboardBody({ stats }: { stats: AdminStats }): JSX.Element {
  const t = useAdminText()
  return (
    <>
      <section aria-label={t.t(`AdminDashboard.keyNumbers`)} data-e2e="admin-dashboard-stats">
        <KpiGrid minWidth="11rem">
          <Kpi
            label={t.t(`AdminDashboard.people`)}
            value={NUMBER.format(stats.people)}
            sub={t.t(`AdminDashboard.blockedCount`, { count: stats.blocked })}
            tone="accent"
          />
          <Kpi
            label={t.t(`AdminDashboard.newThisWeek`)}
            value={NUMBER.format(stats.newThisWeek.current)}
            sub={statChange(t, stats.newThisWeek, 7)}
            tone={changeTone(stats.newThisWeek)}
          />
          <Kpi
            label={t.t(`AdminDashboard.activeToday`)}
            value={NUMBER.format(stats.activeToday.current)}
            sub={statChange(t, stats.activeToday, 1)}
            tone={changeTone(stats.activeToday)}
          />
          <Kpi
            label={t.t(`AdminDashboard.activeThisWeek`)}
            value={NUMBER.format(stats.activeThisWeek.current)}
            sub={statChange(t, stats.activeThisWeek, 7)}
            tone={changeTone(stats.activeThisWeek)}
          />
          <Kpi
            label={t.t(`AdminDashboard.blocked`)}
            value={NUMBER.format(stats.blocked)}
            sub={t.t(`AdminDashboard.cannotSignIn`)}
            tone={stats.blocked > 0 ? "negative" : "neutral"}
          />
          <Kpi
            label={t.t(`AdminDashboard.groups`)}
            value={NUMBER.format(stats.groups)}
            tone="neutral"
          />
          <Kpi
            label={t.t(`AdminDashboard.notes`)}
            value={NUMBER.format(stats.notes)}
            tone="neutral"
          />
        </KpiGrid>
      </section>
      {stats.guests && <GuestKpis guests={stats.guests} days={stats.signUpsPerDay.length} />}
      <div class="grid gap-4 lg:grid-cols-2">
        <DailyChart
          title={t.t(`AdminDashboard.signUpsTitle`)}
          series={t.t(`AdminDashboard.signUpsSeries`)}
          days={stats.signUpsPerDay}
          summary={t.t(`AdminDashboard.signUpsSummary`, {
            total: NUMBER.format(sum(stats.signUpsPerDay)),
            count: stats.signUpsPerDay.length,
          })}
          dataE2E="admin-chart-sign-ups"
        />
        <DailyChart
          title={t.t(`AdminDashboard.activeTitle`)}
          series={t.t(`AdminDashboard.activeSeries`)}
          days={stats.activePerDay}
          // One person active on many days counts once a day, so a sum would count them again.
          summary={t.t(`AdminDashboard.busiestDay`, {
            count: NUMBER.format(Math.max(0, ...stats.activePerDay.map((day) => day.count))),
          })}
          dataE2E="admin-chart-active"
        />
      </div>
    </>
  )
}

/** The sum of a run of daily counts. */
function sum(days: readonly AdminDailyCount[]): number {
  return days.reduce((total, day) => total + day.count, 0)
}

/** One 30-day chart in a card, with a one-line summary of the period in its header. */
function DailyChart(
  { title, series, days, summary, dataE2E }: {
    title: string
    series: string
    days: readonly AdminDailyCount[]
    summary: string
    dataE2E: string
  },
): JSX.Element {
  const t = useAdminText()
  // The server counts each day in UTC, so its label is that UTC day, in the operator's format.
  const day = useFormat().utc()
  return (
    <Card data-e2e={dataE2E}>
      <CardHeader
        title={title}
        headingLevel={2}
        action={<span class="text-sm text-muted">{summary}</span>}
      />
      <CardBody>
        <LineChart
          series={[{ name: series, points: days.map((day) => ({ x: day.day, y: day.count })) }]}
          height={220}
          yDomain={[0, countAxisTop(days.map((day) => day.count))]}
          yTicks={COUNT_AXIS_STEPS}
          xFormat={(x) => day.dayMonth(typeof x === "string" ? `${x}T00:00:00Z` : x)}
          yFormat={(value) => NUMBER.format(value)}
          ariaLabel={t.t(`AdminDashboard.chartLabel`, { title, count: days.length })}
          emptyLabel={t.t(`AdminDashboard.nothingYet`)}
        />
      </CardBody>
    </Card>
  )
}

/**
 * Guest accounts (#224) over the dashboard's days: how many were made with one click, how many of
 * them got a sign-in method, and how many the clean-up deleted.
 */
function GuestKpis({ guests, days }: { guests: GuestStats; days: number }): JSX.Element {
  const t = useAdminText()
  return (
    <section aria-labelledby="admin-guests-title" data-e2e="admin-dashboard-guests">
      <h2 id="admin-guests-title" class="mb-2 text-sm font-medium text-muted">
        {t.t(`AdminDashboard.guestsTitle`, { count: days })}
      </h2>
      <KpiGrid minWidth="11rem">
        <Kpi
          label={t.t(`AdminDashboard.started`)}
          value={NUMBER.format(guests.created)}
          tone="neutral"
        />
        <Kpi
          label={t.t(`AdminDashboard.kept`)}
          value={NUMBER.format(guests.kept)}
          sub={guests.created > 0
            ? t.t(`AdminDashboard.keptShare`, {
              percent: Math.round((guests.kept / guests.created) * 100),
            })
            : t.t(`AdminDashboard.noneStarted`)}
          tone="neutral"
        />
        <Kpi
          label={t.t(`AdminDashboard.cleanedUp`)}
          value={NUMBER.format(guests.cleanedUp)}
          sub={t.t(`AdminDashboard.cleanedUpHint`)}
          tone="neutral"
        />
      </KpiGrid>
    </section>
  )
}
