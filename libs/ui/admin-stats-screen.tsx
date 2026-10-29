import type { JSX } from "preact"
import { useEffect, useState } from "preact/hooks"
import { changeText } from "@spy4x/preact-charts/change"
import { Kpi, type KpiChange, KpiGrid } from "@spy4x/preact-charts/kpi"
import { LineChart } from "@spy4x/preact-charts/line-chart"
import { Bars } from "@spy4x/preact-charts/bars"
import { type RankedBarRow, RankedBars } from "@spy4x/preact-charts/ranked-bars"
import { IconExternalLink } from "@spy4x/preact-icons"
import { Button, buttonClasses } from "@spy4x/preact-ui/button"
import { Card, CardBody, CardHeader } from "@spy4x/preact-ui/card"
import { DropdownItem } from "@spy4x/preact-ui/dropdown"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Field } from "@spy4x/preact-ui/field"
import { Select } from "@spy4x/preact-ui/input"
import { Stack } from "@spy4x/preact-ui/layout"
import { Link } from "@spy4x/preact-ui/link"
import { Notice } from "@spy4x/preact-ui/notice"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import { SegmentedControl } from "@spy4x/preact-ui/segmented-control"
import { useFormat } from "@spy4x/preact-ui/format"
import type { Translator } from "@spy4x/platform/universal/i18n"
import {
  WEBSITE_STATS_PERIODS,
  WEBSITE_STATS_SETTINGS,
  type WebsiteStatsCount,
  type WebsiteStatsDay,
  type WebsiteStatsItem,
  type WebsiteStatsPeriod,
  type WebsiteStatsReport,
  type WebsiteStatsResponse,
} from "@domain/identity"
import { ADMIN_CATALOG_PATHS } from "./admin-catalog.tsx"
import { countAxisTop } from "./admin-dashboard-screen.tsx"
import { useAdminText } from "./i18n.ts"
import type { Navigate } from "./progressive.tsx"

/** The Stats page. */
export const ADMIN_STATS_PATH = `/stats`

/** Where turning Stats on is described, for the "Stats are off" state. */
// Seed's own site: see docs/start-a-product.md
export const ADMIN_STATS_SETUP_URL =
  `https://github.com/spy4x/seed/blob/main/docs/analytics.md#stats-in-the-admin-app`

/** How long a first load waits before it draws the skeleton, so a fast answer never flashes one. */
export const STATS_SKELETON_DELAY_MS = 300

/** Below this many visits on most days, the chart draws one point per week. */
const WEEKLY_BELOW = 3

const NUMBER = new Intl.NumberFormat(`en`)

export interface AdminStatsScreenProps {
  days: WebsiteStatsPeriod
  /** The chart's source, by slug, or `null` for every source. */
  source: string | null
  /** The last answer, kept on screen while the next one loads; `null` before the first. */
  response: WebsiteStatsResponse | null
  /** A read is on its way: the numbers are dimmed and marked busy. */
  pending: boolean
  /** Our own API failed, or `null`. */
  error: string | null
  onPeriod: (days: WebsiteStatsPeriod) => void
  onSource: (source: string | null) => void
  /** Reads again; `fresh` skips the shared copy ("Refresh numbers"). */
  onRefresh: (fresh: boolean) => void
  navigate?: Navigate
}

/**
 * The website's numbers for a seller (#485): where visits come from, so they know where to post,
 * and which items people order or only look at, so they know what to restock or photograph again.
 * Totals only, from Umami on the server. It says "order clicks", never "orders": the order itself
 * happens in the chat.
 */
export function AdminStatsScreen(props: AdminStatsScreenProps): JSX.Element {
  const { days, response, onPeriod, onRefresh, navigate } = props
  const t = useAdminText()
  const format = useFormat()
  const ready = response?.state === `ready` ? response : null
  const umamiUrl = response && response.state !== `off` ? response.umamiUrl : null
  const catalogOn = ready?.report.items != null
  const off = response?.state === `off`
  // Beside the title from `sm` up; under the header on a phone, where it would squeeze the title.
  const period = (
    <SegmentedControl
      ariaLabel={t.t(`AdminStats.period`)}
      value={String(days)}
      onChange={(value) => onPeriod(Number(value) as WebsiteStatsPeriod)}
      options={WEBSITE_STATS_PERIODS.map((period) => ({
        value: String(period),
        label: t.t(`AdminStats.periodDays`, { count: period }),
      }))}
    />
  )

  return (
    <Stack>
      <PageHeader
        title={t.t(`AdminStats.title`)}
        subtitle={ready
          ? t.t(`AdminStats.subtitleUpdated`, {
            count: days,
            ago: format.relative(ready.updatedAt),
          })
          : t.t(`AdminStats.subtitle`, { count: days })}
        titleDataE2E="admin-stats-title"
        action={off ? undefined : <div class="max-sm:hidden">{period}</div>}
        menu={off ? undefined : (
          <>
            <DropdownItem onClick={() => onRefresh(true)} dataE2E="admin-stats-refresh">
              {t.t(`AdminStats.refresh`)}
            </DropdownItem>
            {umamiUrl && (
              <DropdownItem href={umamiUrl} dataE2E="admin-stats-umami">
                {t.t(`AdminStats.openUmami`)}
              </DropdownItem>
            )}
            {catalogOn && (
              <DropdownItem
                href={ADMIN_CATALOG_PATHS.sources}
                navigate={navigate}
                dataE2E="admin-stats-sources"
              >
                {t.t(`AdminStats.editSources`)}
              </DropdownItem>
            )}
          </>
        )}
      />
      {!off && <div class="sm:hidden">{period}</div>}
      <StatsBody {...props} />
    </Stack>
  )
}

/** Everything under the header: one state, or the numbers. */
function StatsBody(props: AdminStatsScreenProps): JSX.Element {
  const { response, pending, error, onRefresh } = props
  const t = useAdminText()
  const format = useFormat()
  if (response === null) {
    return error
      ? (
        <div class="flex flex-col items-start gap-3" data-e2e="admin-stats-error">
          <ErrorState message={t.t(`AdminStats.loadError`)} />
          <Button variant="secondary" onClick={() => onRefresh(false)}>
            {t.t(`AdminStats.tryAgain`)}
          </Button>
        </div>
      )
      : <StatsSkeleton />
  }
  if (response.state === `off`) return <StatsOff missing={response.missing} />
  if (response.state !== `ready`) {
    return (
      <Card data-e2e={`admin-stats-${response.state}`}>
        <EmptyState
          inset
          headingLevel={2}
          title={t.t(`AdminStats.problemTitle`)}
          description={t.t(PROBLEM_TEXT[response.state])}
          action={
            <div class="flex flex-wrap gap-2">
              {response.state === `unreachable` && (
                <Button
                  variant="secondary"
                  onClick={() => onRefresh(true)}
                  disabled={pending}
                >
                  {t.t(`AdminStats.tryAgain`)}
                </Button>
              )}
              <ExternalButton href={response.umamiUrl}>
                {t.t(`AdminStats.openUmami`)}
              </ExternalButton>
            </div>
          }
        />
      </Card>
    )
  }
  return (
    <div
      class={pending ? `flex flex-col gap-6 opacity-60 transition-opacity` : `flex flex-col gap-6`}
      aria-busy={pending ? `true` : undefined}
      data-e2e="admin-stats-body"
    >
      {response.stale && (
        <Notice
          tone="warning"
          data-e2e="admin-stats-stale"
          action={
            <Button variant="secondary" size="sm" onClick={() => onRefresh(true)}>
              {t.t(`AdminStats.tryAgain`)}
            </Button>
          }
        >
          {t.t(`AdminStats.stale`, { time: format.time(response.updatedAt) })}
        </Notice>
      )}
      {error && <ErrorState message={t.t(`AdminStats.loadError`)} />}
      <Report report={response.report} {...props} />
    </div>
  )
}

/** The page's shape while the first answer is on its way, after a short wait. */
function StatsSkeleton(): JSX.Element {
  const t = useAdminText()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), STATS_SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div role="status" aria-label={t.t(`AdminStats.loading`)} data-e2e="admin-stats-loading">
      {shown && (
        <div class="flex flex-col gap-4" aria-hidden="true" data-e2e="admin-stats-skeleton">
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                class="h-24 animate-pulse rounded-lg bg-track motion-reduce:animate-none"
              />
            ))}
          </div>
          <div class="h-64 animate-pulse rounded-lg bg-track motion-reduce:animate-none" />
          {[0, 1, 2, 3, 4].map((key) => (
            <div
              key={key}
              class="h-10 animate-pulse rounded-md bg-track motion-reduce:animate-none"
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Stats is not set up: which settings turn it on, and which of them are missing. */
function StatsOff({ missing }: { missing: string[] }): JSX.Element {
  const t = useAdminText()
  const all = missing.length === WEBSITE_STATS_SETTINGS.length
  return (
    <Card data-e2e="admin-stats-off">
      <EmptyState
        inset
        headingLevel={2}
        title={t.t(`AdminStats.offTitle`)}
        description={all ? t.t(`AdminStats.offText`) : t.t(`AdminStats.offSome`, {
          missing: listOf(t, missing, `conjunction`),
          count: missing.length,
        })}
        action={
          <ExternalButton href={ADMIN_STATS_SETUP_URL}>
            {t.t(`AdminStats.readSetup`)}
          </ExternalButton>
        }
      />
    </Card>
  )
}

/** A button-styled link that opens another site in a new tab, and says so. */
function ExternalButton({ href, children }: { href: string; children: string }): JSX.Element {
  const t = useAdminText()
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class={buttonClasses(`secondary`, `md`)}
      aria-label={t.t(`AdminStats.newTab`, { label: children })}
    >
      <IconExternalLink class="size-4" aria-hidden="true" />
      {children}
    </a>
  )
}

/** Each problem's sentence. */
const PROBLEM_TEXT = {
  "token-refused": `AdminStats.tokenRefused`,
  "unknown-website": `AdminStats.unknownWebsite`,
  unreachable: `AdminStats.unreachable`,
} as const

/** `a, b and c` (or `or`) in the operator's language. */
function listOf(
  t: Translator<string>,
  words: readonly string[],
  type: `conjunction` | `disjunction`,
) {
  return new Intl.ListFormat(t.language, { type }).format(words)
}

/** A count's change as a `Kpi` line: up, down or flat, never coloured as good or bad. */
function countChange(t: Translator<string>, count: WebsiteStatsCount, days: number): KpiChange {
  return {
    text: changeText(count, t.t(`AdminDashboard.previousDays`, { count: days }), `en`, t),
    direction: count.current > count.previous
      ? `up`
      : count.current < count.previous
      ? `down`
      : `flat`,
  }
}

/** A rate as `4.2%`, or "–" when there is none. */
function percent(rate: number | null): string {
  return rate === null ? `–` : `${rate.toFixed(1)}%`
}

/**
 * Whether the chart sums weeks: when most days have fewer than {@link WEEKLY_BELOW} visits, so a
 * quiet shop sees a trend instead of a comb. A week of seven days is never summed.
 */
export function chartIsWeekly(days: readonly WebsiteStatsDay[]): boolean {
  const quiet = days.filter((day) => day.visits < WEEKLY_BELOW).length
  return days.length > 7 && quiet > days.length / 2
}

/**
 * The chart's points: one per day, or one per week (summed, named by its first day). Both lines of
 * the chart take the current period's `weekly`, so they always have the same points.
 */
export function chartPoints(
  days: readonly WebsiteStatsDay[],
  weekly: boolean = chartIsWeekly(days),
): { x: string; y: number; weekly: boolean }[] {
  if (!weekly) return days.map((day) => ({ x: day.day, y: day.visits, weekly }))
  const points: { x: string; y: number; weekly: boolean }[] = []
  for (let index = 0; index < days.length; index += 7) {
    const week = days.slice(index, index + 7)
    points.push({ x: week[0].day, y: week.reduce((sum, day) => sum + day.visits, 0), weekly })
  }
  return points
}

function Report(
  { report, source, onSource, navigate }: AdminStatsScreenProps & { report: WebsiteStatsReport },
): JSX.Element {
  const t = useAdminText()
  const days = report.days
  const channels = report.channels.map((channel) => channel.name)

  if (report.visits.current === 0) {
    return (
      <Card data-e2e="admin-stats-empty">
        <EmptyState
          inset
          headingLevel={2}
          title={t.t(`AdminStats.noVisitsTitle`)}
          description={t.t(`AdminStats.noVisitsText`)}
          action={report.items !== null && (
            <Link
              href={ADMIN_CATALOG_PATHS.list}
              navigate={navigate}
              class={buttonClasses(`secondary`, `md`)}
            >
              {t.t(`AdminStats.openCatalog`)}
            </Link>
          )}
        />
      </Card>
    )
  }

  const rateChange: KpiChange | undefined =
    report.orderRate.current !== null && report.orderRate.previous !== null
      ? {
        text: t.t(`AdminStats.rateChange`, {
          change: `${report.orderRate.current >= report.orderRate.previous ? `+` : `−`}${
            Math.abs(report.orderRate.current - report.orderRate.previous).toFixed(1)
          }`,
          count: days,
        }),
        direction: report.orderRate.current > report.orderRate.previous
          ? `up`
          : report.orderRate.current < report.orderRate.previous
          ? `down`
          : `flat`,
      }
      : undefined

  return (
    <>
      {report.fewVisits && (
        <Notice live={false} data-e2e="admin-stats-few">{t.t(`AdminStats.fewVisits`)}</Notice>
      )}
      <section aria-label={t.t(`AdminStats.keyNumbers`)} data-e2e="admin-stats-kpis">
        <KpiGrid minWidth="9.5rem">
          <Kpi
            label={t.t(`AdminStats.visits`)}
            value={NUMBER.format(report.visits.current)}
            change={countChange(t, report.visits, days)}
          />
          <Kpi
            label={t.t(`AdminStats.orderClicks`)}
            value={NUMBER.format(report.orderClicks.current)}
            change={countChange(t, report.orderClicks, days)}
          />
          <Kpi
            label={t.t(`AdminStats.orderRate`)}
            value={percent(report.orderRate.current)}
            sub={t.t(`AdminStats.orderRateHint`)}
            change={rateChange}
          />
        </KpiGrid>
        <p class="mt-2 text-sm text-muted">
          {channels.length > 0
            ? t.t(`AdminStats.orderClickMeans`, { channels: listOf(t, channels, `disjunction`) })
            : t.t(`AdminStats.orderClickMeansAny`)}
        </p>
      </section>

      <VisitsChart report={report} source={source} onSource={onSource} />

      <section aria-labelledby="admin-stats-sources-title" data-e2e="admin-stats-sources-list">
        <h2 id="admin-stats-sources-title" class="text-lg font-semibold">
          {t.t(`AdminStats.sourcesTitle`)}
        </h2>
        <p class="mb-3 text-sm text-muted">{t.t(`AdminStats.sourcesIntro`)}</p>
        <Card>
          <CardBody>
            <RankedBars
              ariaLabel={t.t(`AdminStats.sourcesLabel`, { count: days })}
              columns={{
                label: t.t(`AdminStats.source`),
                value: t.t(`AdminStats.visits`),
                extra: [
                  { label: t.t(`AdminStats.orderClicks`) },
                  { label: t.t(`AdminStats.orderRate`), format: (rate) => percent(rate) },
                ],
              }}
              format={(value) => NUMBER.format(value)}
              data={report.sources.map((row): RankedBarRow => ({
                label: row.slug === null ? t.t(`AdminStats.noSource`) : row.name,
                value: row.visits,
                values: [row.orderClicks, row.rate],
                lowSample: row.lowSample,
                note: row.slug === null ? t.t(`AdminStats.noSourceHint`) : undefined,
                onSelect: row.slug === null ? undefined : () => onSource(row.slug),
              }))}
            />
            {!report.hasSources && (
              <p class="mt-3 text-sm text-muted" data-e2e="admin-stats-no-sources">
                {t.t(`AdminStats.noSources`)}
                {` `}
                {report.items !== null && (
                  <Link href={ADMIN_CATALOG_PATHS.sources} navigate={navigate}>
                    {t.t(`AdminStats.editSources`)}
                  </Link>
                )}
              </p>
            )}
            {report.hasSources &&
              report.sources.every((row) => row.slug === null || row.visits === 0) && (
              <p class="mt-3 text-sm text-muted" data-e2e="admin-stats-sources-quiet">
                {t.t(`AdminStats.sourcesQuiet`, { count: days })}
              </p>
            )}
          </CardBody>
        </Card>
      </section>

      {report.items && (
        <Items
          items={report.items}
          days={days}
          minViews={report.minItemViews}
          navigate={navigate}
        />
      )}

      <section aria-labelledby="admin-stats-channels-title" data-e2e="admin-stats-channels">
        <h2 id="admin-stats-channels-title" class="mb-3 text-lg font-semibold">
          {t.t(`AdminStats.channelsTitle`)}
        </h2>
        <Card class="max-w-xl">
          <CardBody>
            <Bars
              ariaLabel={t.t(`AdminStats.channelsLabel`, { count: days })}
              data={report.channels.map((channel) => ({
                label: channel.name,
                value: channel.clicks,
              }))}
              format={(value) => NUMBER.format(value)}
              emptyLabel={t.t(`AdminStats.noOrderClicks`)}
            />
          </CardBody>
        </Card>
      </section>

      <p class="text-sm text-muted" data-e2e="admin-stats-limits">{t.t(`AdminStats.limits`)}</p>
    </>
  )
}

function VisitsChart(
  { report, source, onSource }: {
    report: WebsiteStatsReport
    source: string | null
    onSource: (source: string | null) => void
  },
): JSX.Element {
  const t = useAdminText()
  const day = useFormat().utc()
  const weekly = chartIsWeekly(report.perDay)
  const current = chartPoints(report.perDay, weekly)
  // The period before, bucketed the same way and drawn under the same days, so the lines compare.
  const previous = chartPoints(report.previousPerDay, weekly).map((point, index) => ({
    x: current[index]?.x ?? point.x,
    y: point.y,
  }))
  const total = report.perDay.reduce((sum, entry) => sum + entry.visits, 0)
  const named = report.sources.filter((row) => row.slug !== null)
  return (
    <Card data-e2e="admin-stats-chart">
      <CardHeader
        title={t.t(weekly ? `AdminStats.chartTitleWeekly` : `AdminStats.chartTitle`)}
        headingLevel={2}
        action={
          <span class="text-sm text-muted">
            {t.t(`AdminStats.chartSummary`, { total: NUMBER.format(total), count: report.days })}
          </span>
        }
      />
      <CardBody>
        {named.length > 0 && (
          <div class="mb-3 max-w-xs">
            <Field id="admin-stats-source" label={t.t(`AdminStats.source`)}>
              <Select
                name="source"
                data-e2e="admin-stats-source"
                options={[
                  { value: ``, label: t.t(`AdminStats.allSources`) },
                  ...named.map((row) => ({ value: row.slug!, label: row.name })),
                ]}
                value={source ?? ``}
                onChange={(event) =>
                  onSource((event.currentTarget as HTMLSelectElement).value || null)}
              />
            </Field>
          </div>
        )}
        <LineChart
          series={[
            { name: t.t(`AdminStats.visits`), points: current.map(({ x, y }) => ({ x, y })) },
            {
              name: t.t(`AdminStats.previousSeries`, { count: report.days }),
              points: previous,
              dashed: true,
            },
          ]}
          height={220}
          yDomain={[0, countAxisTop([...current, ...previous].map((point) => point.y))]}
          yTicks={5}
          xFormat={(x) => day.dayMonth(typeof x === `string` ? `${x}T00:00:00Z` : x)}
          yFormat={(value) => NUMBER.format(value)}
          ariaLabel={t.t(`AdminStats.chartLabel`, { count: report.days })}
          emptyLabel={t.t(`AdminDashboard.nothingYet`)}
        />
      </CardBody>
    </Card>
  )
}

function Items(
  { items, days, minViews, navigate }: {
    items: NonNullable<WebsiteStatsReport[`items`]>
    days: number
    minViews: number
    navigate?: Navigate
  },
): JSX.Element {
  const t = useAdminText()
  const row = (item: WebsiteStatsItem, value: number, values: (number | null)[]): RankedBarRow => ({
    label: item.name,
    value,
    values,
    lowSample: item.lowSample,
    image: item.coverId ? { src: ADMIN_CATALOG_PATHS.thumbnail(item.coverId), alt: `` } : undefined,
    note: item.topSource ? t.t(`AdminStats.mostlyFrom`, { source: item.topSource }) : undefined,
    href: ADMIN_CATALOG_PATHS.item(item.id),
  })
  return (
    <section aria-labelledby="admin-stats-items-title" data-e2e="admin-stats-items">
      <h2 id="admin-stats-items-title" class="text-lg font-semibold">
        {t.t(`AdminStats.itemsTitle`)}
      </h2>
      <p class="mb-3 text-sm text-muted">{t.t(`AdminStats.itemsIntro`)}</p>
      <div class="flex flex-col gap-4">
        <Card data-e2e="admin-stats-most-ordered">
          <CardBody>
            <RankedBars
              title={t.t(`AdminStats.mostOrdered`)}
              columns={{
                label: t.t(`AdminStats.item`),
                value: t.t(`AdminStats.orderClicks`),
                extra: [
                  { label: t.t(`AdminStats.views`), format: (value) => NUMBER.format(value) },
                  { label: t.t(`AdminStats.orderRate`), format: (rate) => percent(rate) },
                ],
              }}
              format={(value) => NUMBER.format(value)}
              navigate={navigate}
              data={items.mostOrdered.map((item) =>
                row(item, item.orderClicks, [item.views, item.rate])
              )}
              emptyLabel={t.t(`AdminStats.noOrderClicks`)}
            />
          </CardBody>
        </Card>
        <Card data-e2e="admin-stats-not-ordered">
          <CardBody>
            <RankedBars
              title={t.t(`AdminStats.notOrdered`)}
              columns={{
                label: t.t(`AdminStats.item`),
                value: t.t(`AdminStats.views`),
                extra: [{ label: t.t(`AdminStats.orderClicks`) }],
              }}
              format={(value) => NUMBER.format(value)}
              navigate={navigate}
              data={items.viewedNotOrdered.map((item) => row(item, item.views, [item.orderClicks]))}
              emptyLabel={items.mostOrdered.length > 0
                ? t.t(`AdminStats.allOrdered`)
                : t.t(`AdminStats.noItemViews`, { count: days })}
            />
            <p class="mt-2 text-sm text-muted">
              {t.t(`AdminStats.notOrderedIntro`, { count: minViews })}
            </p>
          </CardBody>
        </Card>
      </div>
    </section>
  )
}
