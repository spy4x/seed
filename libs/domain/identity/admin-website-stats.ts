/**
 * The admin Stats screen's shapes (#485): the website's visits, where they come from, which items
 * people look at and order, and how they order, read from Umami. Totals only: no visitor, session,
 * place or address ever reaches the operator area.
 *
 * @module
 */

/** The periods the screen offers, in days; the address carries one as `?days=`. */
export const WEBSITE_STATS_PERIODS = [7, 30, 90] as const

/** One of {@link WEBSITE_STATS_PERIODS}. */
export type WebsiteStatsPeriod = typeof WEBSITE_STATS_PERIODS[number]

/** The period the screen opens with. */
export const WEBSITE_STATS_DEFAULT_PERIOD: WebsiteStatsPeriod = 30

/** The three settings Stats needs, in the order the screen names them. */
export const WEBSITE_STATS_SETTINGS = [
  `UMAMI_API_URL`,
  `UMAMI_API_TOKEN`,
  `MPA_UMAMI_WEBSITE_ID`,
] as const

/** The period's number and the same number over the period of the same length before it. */
export interface WebsiteStatsCount {
  current: number
  previous: number
}

/** One day of the chart: the UTC day (`YYYY-MM-DD`) and its visits. */
export interface WebsiteStatsDay {
  day: string
  visits: number
}

/**
 * One row of "Where visits come from". `slug` is `null` for the last row, the visits that came
 * without a share link, so the rows add up to the period's visits.
 */
export interface WebsiteStatsSource {
  slug: string | null
  name: string
  visits: number
  orderClicks: number
  /** Order clicks per 100 visits, or `null` while the visits are too few to judge. */
  rate: number | null
  /** Fewer visits than the server's threshold: the row is drawn muted. */
  lowSample: boolean
}

/** One item row of "Items". */
export interface WebsiteStatsItem {
  id: string
  /** In the catalog's default language. */
  name: string
  /** The cover photo, for a 40 px thumbnail, or `null`. */
  coverId: string | null
  /** Visitors who opened the item's page, each counted once. */
  views: number
  orderClicks: number
  /** Order clicks per 100 views, or `null` while the views are too few to judge. */
  rate: number | null
  /** The source that brought the item most views, by name, or `null`. */
  topSource: string | null
  lowSample: boolean
}

/** Order clicks of one order button, such as Telegram. */
export interface WebsiteStatsChannel {
  /** The event's name on the website, such as `order-telegram`. */
  event: string
  /** The channel's name, from the event's: `Telegram`. */
  name: string
  clicks: number
}

/** The numbers of one period. */
export interface WebsiteStatsReport {
  days: WebsiteStatsPeriod
  visits: WebsiteStatsCount
  orderClicks: WebsiteStatsCount
  /** Order clicks per 100 visits in each period, `null` in one with too few visits. */
  orderRate: { current: number | null; previous: number | null }
  /** The period has fewer visits than the threshold: every rate can change a lot. */
  fewVisits: boolean
  /** The source the chart shows, by `slug`, or `null` for every source. */
  source: string | null
  /** The chart: one entry per UTC day of the period, oldest first. */
  perDay: WebsiteStatsDay[]
  /** The period before, day by day in the same order. */
  previousPerDay: WebsiteStatsDay[]
  /** Ranked by order clicks, then visits; the visits without a source last. */
  sources: WebsiteStatsSource[]
  /** Whether any source is defined; without one the list holds only the last row. */
  hasSources: boolean
  /** `null` while the catalog is off. */
  items: { mostOrdered: WebsiteStatsItem[]; viewedNotOrdered: WebsiteStatsItem[] } | null
  /** Most clicks first. */
  channels: WebsiteStatsChannel[]
  /** The thresholds below which a row is muted and its rate reads "–". */
  minSourceVisits: number
  minItemViews: number
}

/**
 * The answer of `GET /api/admin/website-stats`. `umamiUrl` opens the website in Umami, for the
 * numbers this screen leaves out.
 */
export type WebsiteStatsResponse =
  | {
    /** Umami is not set up: `missing` names the settings that are not set. */
    state: `off`
    missing: string[]
  }
  | { state: `token-refused` | `unknown-website` | `unreachable`; umamiUrl: string }
  | {
    state: `ready`
    umamiUrl: string
    report: WebsiteStatsReport
    /** When Umami gave these numbers (ISO). */
    updatedAt: string
    /** Umami did not answer, so these are the last numbers it gave. */
    stale: boolean
  }

/** The `days` of an address, or the default for anything else. */
export function websiteStatsPeriod(value: string | null | undefined): WebsiteStatsPeriod {
  const days = Number(value)
  return (WEBSITE_STATS_PERIODS as readonly number[]).includes(days)
    ? days as WebsiteStatsPeriod
    : WEBSITE_STATS_DEFAULT_PERIOD
}
