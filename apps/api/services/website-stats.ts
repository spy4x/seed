/**
 * The admin Stats screen's numbers (#485): the website's visits, where they come from, which items
 * people look at and order, and through which channel, read from the self-hosted Umami on the
 * server. The token never leaves the server, and only totals are read: no visitor, session, place
 * or address. Every operator shares one copy of the numbers for {@link STATS_CACHE_MS}; when
 * Umami does not answer, the last copy is shown, marked stale, and never zeros.
 *
 * @module
 */

import {
  checkUmamiWebsite,
  readUmamiEventValues,
  readUmamiMetrics,
  readUmamiPageviews,
  readUmamiStats,
  type UmamiMetric,
  type UmamiReadResult,
} from "@spy4x/integrations/umami"
import {
  WEBSITE_STATS_SETTINGS,
  type WebsiteStatsChannel,
  type WebsiteStatsDay,
  type WebsiteStatsItem,
  type WebsiteStatsPeriod,
  type WebsiteStatsReport,
  type WebsiteStatsResponse,
  type WebsiteStatsSource,
} from "@domain/identity"

/** How long one copy of the numbers is shown before Umami is asked again. */
export const STATS_CACHE_MS = 5 * 60_000

/** Below this many visits a source's rate reads "–" and its row is muted. */
export const MIN_SOURCE_VISITS = 20

/** Below this many views an item's rate reads "–", and it is not listed as "viewed, not ordered". */
export const MIN_ITEM_VIEWS = 10

/** An order button's event is `order-<channel>`, such as `order-telegram` (docs/catalog.md). */
export const ORDER_EVENT_PREFIX = `order-`

/** The property of an order event that names the item, by its slug. */
const ORDER_ITEM_PROPERTY = `item`

/** How many items each list of "Items" shows. */
const ITEMS_LISTED = 5

/** How many reads go to Umami at once. */
const UMAMI_CONCURRENCY = 4

const DAY_MS = 86_400_000

/** Where the self-hosted Umami is, its token (a secret) and the website's id. */
export interface WebsiteStatsSetup {
  url: string
  token: string
  websiteId: string
}

/**
 * Reads Stats' three settings: `UMAMI_API_URL`, `UMAMI_API_TOKEN` and `MPA_UMAMI_WEBSITE_ID`.
 * With all three set, the setup; otherwise `null` and the names of the ones that are not set, so
 * the screen can say which. Never throws: Stats being off stops nothing.
 */
export function readWebsiteStatsSetup(
  env: { get(name: string): string | undefined },
): { setup: WebsiteStatsSetup | null; missing: string[] } {
  const values = WEBSITE_STATS_SETTINGS.map((name) => env.get(name)?.trim() ?? ``)
  const missing = WEBSITE_STATS_SETTINGS.filter((_, index) => values[index] === ``)
  if (missing.length > 0) return { setup: null, missing }
  const [url, token, websiteId] = values
  return { setup: { url, token, websiteId }, missing: [] }
}

/** A place the shop shares its items in; `slug` is the `utm_source` of its links. */
export interface StatsSource {
  slug: string
  name: string
}

/** A catalog item as Stats names it, with its path on the website. */
export interface StatsItem {
  id: string
  slug: string
  /** The item's page on the website, such as `/shirts/linen-shirt`. */
  path: string
  name: string
  coverId: string | null
}

/** The Umami reads Stats makes; tests pass doubles. */
export interface UmamiReads {
  check: typeof checkUmamiWebsite
  stats: typeof readUmamiStats
  metrics: typeof readUmamiMetrics
  pageviews: typeof readUmamiPageviews
  eventValues: typeof readUmamiEventValues
}

/** What {@link createWebsiteStats} reads from. */
export interface WebsiteStatsDependencies {
  /** `null` while Stats is off; `missing` then names the settings that are not set. */
  setup: WebsiteStatsSetup | null
  missing: readonly string[]
  /** The sources, in their order. */
  sources(): Promise<StatsSource[]>
  /** The catalog's items, or `null` while the catalog is off. */
  items: (() => Promise<StatsItem[]>) | null
  umami?: UmamiReads
  now?: () => number
  /** A failure's line, without the token. */
  log?: (line: string) => void
}

/** What the Stats route asks for. */
export interface WebsiteStatsQuery {
  days: WebsiteStatsPeriod
  /** A source's slug for the chart, or `null` for every source. */
  source: string | null
  /** Skip the copy and ask Umami now ("Refresh numbers"). */
  fresh: boolean
}

/** Why a read of Umami failed, as the screen tells it. */
type Problem = `token-refused` | `unknown-website` | `unreachable`

class UmamiFailure extends Error {
  constructor(readonly status: number | null, message: string) {
    super(message)
  }
}

/** The numbers that do not depend on the chart's source. */
type Base = Omit<WebsiteStatsReport, `source` | `perDay` | `previousPerDay`>

/** The chart's two series. */
interface Series {
  perDay: WebsiteStatsDay[]
  previousPerDay: WebsiteStatsDay[]
}

interface Entry<T> {
  value: T
  at: number
}

/** Order clicks per 100 of `of`, to one decimal, or `null` when `of` is below `min`. */
export function orderRate(clicks: number, of: number, min: number): number | null {
  return of < min || of === 0 ? null : Math.round((clicks / of) * 1000) / 10
}

/** The order clicks among an event breakdown: every event named `order-<channel>`. */
function orderClicksOf(events: readonly UmamiMetric[]): number {
  return events.reduce(
    (sum, event) => event.x.startsWith(ORDER_EVENT_PREFIX) ? sum + event.y : sum,
    0,
  )
}

/** `order-telegram` as `Telegram`, `order-zalo-oa` as `Zalo Oa`: the channel's name, from data. */
export function channelName(event: string): string {
  return event.slice(ORDER_EVENT_PREFIX.length).split(`-`).filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1)).join(` `)
}

/** The UTC day of `at`, `YYYY-MM-DD`. */
function utcDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** Runs `run` over `items`, at most `limit` at once, keeping their order. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * Stats' numbers over {@link WebsiteStatsDependencies}: `read` answers the screen's
 * {@link WebsiteStatsResponse}. The numbers that do not depend on the chart's source and the
 * chart's series are kept apart, each for {@link STATS_CACHE_MS}, so switching the chart's source
 * asks Umami only for its series. Reads of the same numbers at once share one request.
 */
export function createWebsiteStats(dependencies: WebsiteStatsDependencies) {
  const {
    setup,
    missing,
    umami = {
      check: checkUmamiWebsite,
      stats: readUmamiStats,
      metrics: readUmamiMetrics,
      pageviews: readUmamiPageviews,
      eventValues: readUmamiEventValues,
    },
    now = Date.now,
    log = console.error,
  } = dependencies
  const cache = new Map<string, Entry<unknown>>()
  const loading = new Map<string, Promise<Entry<unknown>>>()

  /** A copy of `key`'s numbers: the cached one while it is fresh, else Umami's, else the last. */
  async function cached<T>(
    key: string,
    fresh: boolean,
    load: () => Promise<T>,
  ): Promise<Entry<T> & { stale: boolean }> {
    const hit = cache.get(key) as Entry<T> | undefined
    if (hit && !fresh && now() - hit.at < STATS_CACHE_MS) return { ...hit, stale: false }
    let pending = loading.get(key) as Promise<Entry<T>> | undefined
    if (!pending) {
      pending = load().then((value) => {
        const entry = { value, at: now() }
        cache.set(key, entry)
        return entry
      }).finally(() => loading.delete(key))
      loading.set(key, pending)
    }
    try {
      return { ...await pending, stale: false }
    } catch (error) {
      if (hit && error instanceof UmamiFailure && error.status === null) {
        return { ...hit, stale: true }
      }
      throw error
    }
  }

  return {
    async read(query: WebsiteStatsQuery): Promise<WebsiteStatsResponse> {
      if (setup === null) return { state: `off`, missing: [...missing] }
      const umamiUrl = `${setup.url.replace(/\/+$/, ``)}/websites/${setup.websiteId}`
      const connection = { baseUrl: setup.url, token: setup.token, websiteId: setup.websiteId }

      /** A read's output, or a {@link UmamiFailure} with Umami's status. */
      async function ok<T>(result: Promise<UmamiReadResult<T>>): Promise<T> {
        const answer = await result
        if (answer.success) return answer.output
        log(`Stats: Umami read failed: ${answer.error}`)
        // A refused token or website shows up as 401, 403 or 404; anything else is an outage.
        const refused = answer.status === 401 || answer.status === 403 || answer.status === 404
        throw new UmamiFailure(refused ? answer.status : null, answer.error)
      }

      const end = now()
      const start = Date.parse(`${utcDay(end)}T00:00:00Z`) - (query.days - 1) * DAY_MS
      const previousStart = start - query.days * DAY_MS
      const span = { ...connection, startAt: start, endAt: end }
      const previousSpan = { ...connection, startAt: previousStart, endAt: start - 1 }

      async function loadBase(sources: StatsSource[]): Promise<Base> {
        const [totals, events, previousEvents, items] = await Promise.all([
          ok(umami.stats(span)),
          ok(umami.metrics({ ...span, type: `event` })),
          ok(umami.metrics({ ...previousSpan, type: `event` })),
          dependencies.items?.() ?? null,
        ])
        const orderClicks = orderClicksOf(events)
        const previousOrderClicks = orderClicksOf(previousEvents)
        const channels: WebsiteStatsChannel[] = events
          .filter((event) => event.x.startsWith(ORDER_EVENT_PREFIX) && event.y > 0)
          .map((event) => ({ event: event.x, name: channelName(event.x), clicks: event.y }))
          .sort((a, b) => b.clicks - a.clicks)

        const perSource = await mapLimit(sources, UMAMI_CONCURRENCY, async (source) => {
          const filters = { utmSource: source.slug }
          const [stats, sourceEvents] = await Promise.all([
            ok(umami.stats({ ...span, filters })),
            ok(umami.metrics({ ...span, type: `event`, filters })),
          ])
          return {
            slug: source.slug,
            name: source.name,
            visits: stats.visits,
            orderClicks: orderClicksOf(sourceEvents),
          }
        })
        const ranked = perSource.map((row, index) => ({ row, index }))
          .sort((a, b) =>
            b.row.orderClicks - a.row.orderClicks || b.row.visits - a.row.visits ||
            a.index - b.index
          )
          .map(({ row }) => row)
        const sourced = (pick: (row: { visits: number; orderClicks: number }) => number) =>
          perSource.reduce((sum, row) => sum + pick(row), 0)
        const rows: WebsiteStatsSource[] = [
          ...ranked,
          {
            slug: null,
            name: ``,
            visits: Math.max(0, totals.visits - sourced((row) => row.visits)),
            orderClicks: Math.max(0, orderClicks - sourced((row) => row.orderClicks)),
          },
        ].map((row) => ({
          ...row,
          rate: orderRate(row.orderClicks, row.visits, MIN_SOURCE_VISITS),
          lowSample: row.visits < MIN_SOURCE_VISITS,
        }))

        return {
          days: query.days,
          visits: { current: totals.visits, previous: totals.comparison.visits },
          orderClicks: { current: orderClicks, previous: previousOrderClicks },
          orderRate: {
            current: orderRate(orderClicks, totals.visits, MIN_SOURCE_VISITS),
            previous: orderRate(previousOrderClicks, totals.comparison.visits, MIN_SOURCE_VISITS),
          },
          fewVisits: totals.visits < MIN_SOURCE_VISITS,
          sources: rows,
          hasSources: sources.length > 0,
          items: items === null ? null : await loadItems(items, sources, channels),
          channels,
          minSourceVisits: MIN_SOURCE_VISITS,
          minItemViews: MIN_ITEM_VIEWS,
        }
      }

      async function loadItems(
        items: StatsItem[],
        sources: StatsSource[],
        channels: WebsiteStatsChannel[],
      ): Promise<NonNullable<Base[`items`]>> {
        const [paths, ...perChannel] = await Promise.all([
          ok(umami.metrics({ ...span, type: `path`, limit: 500 })),
          ...channels.map((channel) =>
            ok(
              umami.eventValues({
                ...span,
                eventName: channel.event,
                propertyName: ORDER_ITEM_PROPERTY,
              }),
            )
          ),
        ])
        const views = new Map(paths.map((path) => [path.x, path.y]))
        const clicks = new Map<string, number>()
        for (const values of perChannel) {
          for (const value of values) {
            clicks.set(value.value, (clicks.get(value.value) ?? 0) + value.total)
          }
        }
        const rows = items.map((item) => {
          const itemViews = views.get(item.path) ?? 0
          const orderClicks = clicks.get(item.slug) ?? 0
          return {
            item,
            row: {
              id: item.id,
              name: item.name,
              coverId: item.coverId,
              views: itemViews,
              orderClicks,
              rate: orderRate(orderClicks, itemViews, MIN_ITEM_VIEWS),
              topSource: null as string | null,
              lowSample: itemViews < MIN_ITEM_VIEWS,
            } satisfies WebsiteStatsItem,
          }
        })
        const mostOrdered = rows.filter(({ row }) => row.orderClicks > 0)
          .sort((a, b) => b.row.orderClicks - a.row.orderClicks || b.row.views - a.row.views)
          .slice(0, ITEMS_LISTED)
        const names = new Map(sources.map((source) => [source.slug, source.name]))
        await mapLimit(mostOrdered, UMAMI_CONCURRENCY, async ({ item, row }) => {
          const [top] = await ok(
            umami.metrics({ ...span, type: `utmSource`, limit: 1, filters: { path: item.path } }),
          )
          // Stats names sources, never tags: a tag no source has stays unnamed.
          row.topSource = top ? names.get(top.x) ?? null : null
        })
        const viewedNotOrdered = rows
          .filter(({ row }) => row.views >= MIN_ITEM_VIEWS && row.orderClicks === 0)
          .sort((a, b) => b.row.views - a.row.views)
          .slice(0, ITEMS_LISTED)
        return {
          mostOrdered: mostOrdered.map(({ row }) => row),
          viewedNotOrdered: viewedNotOrdered.map(({ row }) => row),
        }
      }

      async function loadSeries(source: string | null): Promise<Series> {
        const series = await ok(umami.pageviews({
          ...span,
          unit: `day`,
          timezone: `UTC`,
          compare: true,
          ...(source === null ? {} : { filters: { utmSource: source } }),
        }))
        const byDay = (points: readonly { x: string; y: number }[]) =>
          new Map(points.map((point) => [point.x.slice(0, 10), point.y]))
        const current = byDay(series.sessions)
        const previous = byDay(series.compare?.sessions ?? [])
        const perDay: WebsiteStatsDay[] = []
        const previousPerDay: WebsiteStatsDay[] = []
        for (let index = 0; index < query.days; index++) {
          const day = utcDay(start + index * DAY_MS)
          const before = utcDay(previousStart + index * DAY_MS)
          perDay.push({ day, visits: current.get(day) ?? 0 })
          previousPerDay.push({ day: before, visits: previous.get(before) ?? 0 })
        }
        return { perDay, previousPerDay }
      }

      try {
        const sources = await dependencies.sources()
        // Only a source that exists is asked for, so the copies stay one per source.
        const source = sources.some((known) => known.slug === query.source) ? query.source : null
        const [base, series] = await Promise.all([
          cached(`base:${query.days}`, query.fresh, () => loadBase(sources)),
          cached(`series:${query.days}:${source ?? ``}`, query.fresh, () => loadSeries(source)),
        ])
        return {
          state: `ready`,
          umamiUrl,
          report: { ...base.value, source, ...series.value },
          updatedAt: new Date(Math.min(base.at, series.at)).toISOString(),
          stale: base.stale || series.stale,
        }
      } catch (error) {
        if (!(error instanceof UmamiFailure)) throw error
        return { state: await problemOf(error), umamiUrl }
      }

      /** Which problem a failed read was: asks Umami only when it refused something. */
      async function problemOf(failure: UmamiFailure): Promise<Problem> {
        if (failure.status === null) return `unreachable`
        const check = await umami.check(connection)
        if (check.success) return `unreachable`
        if (check.problem === `token`) return `token-refused`
        if (check.problem === `website`) return `unknown-website`
        return `unreachable`
      }
    },
  }
}

export type WebsiteStats = ReturnType<typeof createWebsiteStats>
