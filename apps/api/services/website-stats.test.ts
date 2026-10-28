import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { UmamiMetric, UmamiReadResult, UmamiWebsiteRead } from "@spy4x/integrations/umami"
import {
  channelName,
  createWebsiteStats,
  MIN_ITEM_VIEWS,
  MIN_SOURCE_VISITS,
  readWebsiteStatsSetup,
  STATS_CACHE_MS,
  type StatsItem,
  type UmamiReads,
  type WebsiteStatsDependencies,
} from "./website-stats.ts"

const SETUP = {
  url: `https://stats.example.com`,
  token: `secret-token`,
  websiteId: `019a3b1c-7d2e-7f00-8a00-00000000beef`,
}
const NOW = Date.parse(`2026-10-28T12:00:00Z`)

const ok = <T>(output: T): Promise<UmamiReadResult<T>> =>
  Promise.resolve({ success: true, output, error: `` })
const down = <T>(): Promise<UmamiReadResult<T>> =>
  Promise.resolve({ success: false, output: null, error: `request failed`, status: null })
const refused = <T>(): Promise<UmamiReadResult<T>> =>
  Promise.resolve({ success: false, output: null, error: `HTTP 401`, status: 401 })

const totals = (visits: number) => ({
  pageviews: visits * 2,
  visitors: visits,
  visits,
  bounces: 0,
  totaltime: 0,
})

/** Umami's numbers, per source by its tag; `null` for the whole website. */
interface World {
  visits: Record<string, number>
  previousVisits: number
  events: Record<string, UmamiMetric[]>
  previousEvents: UmamiMetric[]
  paths: UmamiMetric[]
  itemClicks: Record<string, { value: string; total: number }[]>
  topSource: Record<string, string>
  perDay: { x: string; y: number }[]
  previousPerDay: { x: string; y: number }[]
}

const WORLD: World = {
  visits: { all: 130, "zalo-a": 60, facebook: 45, friends: 5 },
  previousVisits: 100,
  events: {
    // Umami's order, not the screen's: the channels are ranked by their clicks.
    all: [{ x: `order-telegram`, y: 3 }, { x: `order-zalo`, y: 7 }, { x: `newsletter`, y: 9 }],
    "zalo-a": [{ x: `order-zalo`, y: 2 }],
    facebook: [{ x: `order-zalo`, y: 4 }, { x: `order-telegram`, y: 1 }],
    friends: [{ x: `order-telegram`, y: 1 }],
  },
  previousEvents: [{ x: `order-zalo`, y: 4 }],
  paths: [
    { x: `/shirts/linen`, y: 40 },
    { x: `/shirts/silk`, y: 25 },
    { x: `/hats/straw`, y: 3 },
    { x: `/hats/wool`, y: MIN_ITEM_VIEWS - 1 },
  ],
  itemClicks: {
    "order-zalo": [{ value: `linen`, total: 5 }, { value: `straw`, total: 1 }],
    "order-telegram": [{ value: `linen`, total: 2 }],
  },
  topSource: { "/shirts/linen": `facebook`, "/hats/straw": `someone-elses-tag` },
  perDay: [{ x: `2026-10-27 00:00:00`, y: 4 }, { x: `2026-10-28 00:00:00`, y: 6 }],
  previousPerDay: [{ x: `2026-10-17 00:00:00`, y: 2 }],
}

const ITEMS: StatsItem[] = [
  { id: `i1`, slug: `linen`, path: `/shirts/linen`, name: `Linen shirt`, coverId: `p1` },
  { id: `i2`, slug: `silk`, path: `/shirts/silk`, name: `Silk blouse`, coverId: null },
  { id: `i3`, slug: `straw`, path: `/hats/straw`, name: `Straw hat`, coverId: null },
  // Too few views to call it "viewed, not ordered".
  { id: `i4`, slug: `wool`, path: `/hats/wool`, name: `Wool hat`, coverId: null },
]

const SOURCES = [
  { slug: `friends`, name: `Friends` },
  { slug: `zalo-a`, name: `Zalo group A` },
  { slug: `facebook`, name: `Facebook market` },
]

/** A fake Umami over `world`, recording each read as `<report> <filter>`. */
function fakeUmami(
  world: World,
  state: { up: boolean; token: boolean } = { up: true, token: true },
) {
  const calls: string[] = []
  const tag = (options: UmamiWebsiteRead) =>
    options.filters?.utmSource ?? options.filters?.path ?? `all`
  const isPrevious = (options: UmamiWebsiteRead) => options.endAt < NOW - 86_400_000
  const reads: UmamiReads = {
    check: () =>
      Promise.resolve(
        state.token
          ? { success: true, output: { id: SETUP.websiteId, name: `Shop` }, error: `` }
          : { success: false, output: null, error: `HTTP 401`, problem: `token` },
      ),
    stats: (options) => {
      calls.push(`stats ${tag(options)}`)
      if (!state.up) return down()
      if (!state.token) return refused()
      return ok({
        ...totals(world.visits[tag(options)] ?? 0),
        comparison: totals(world.previousVisits),
      })
    },
    metrics: (options) => {
      calls.push(`metrics:${options.type} ${tag(options)}`)
      if (!state.up) return down()
      if (options.type === `event`) {
        return ok(isPrevious(options) ? world.previousEvents : world.events[tag(options)] ?? [])
      }
      if (options.type === `path`) return ok(world.paths)
      const top = world.topSource[options.filters?.path ?? ``]
      return ok(top ? [{ x: top, y: 9 }] : [])
    },
    pageviews: (options) => {
      calls.push(`pageviews ${tag(options)}`)
      if (!state.up) return down()
      return ok({
        pageviews: [],
        sessions: tag(options) === `all` ? world.perDay : [],
        compare: { pageviews: [], sessions: world.previousPerDay },
      })
    },
    eventValues: (options) => {
      calls.push(`values ${options.eventName}`)
      if (!state.up) return down()
      return ok(world.itemClicks[options.eventName] ?? [])
    },
  }
  return { reads, calls, state }
}

function stats(overrides: Partial<WebsiteStatsDependencies> = {}) {
  const umami = fakeUmami(WORLD)
  let now = NOW
  const service = createWebsiteStats({
    setup: SETUP,
    missing: [],
    sources: () => Promise.resolve(SOURCES),
    items: () => Promise.resolve(ITEMS),
    umami: umami.reads,
    now: () => now,
    log: () => {},
    ...overrides,
  })
  return { service, umami, later: (ms: number) => (now += ms) }
}

const QUERY = { days: 30, source: null, fresh: false } as const

describe(`Stats settings`, () => {
  it(`reads the three settings and names the missing ones`, () => {
    const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })
    expect(readWebsiteStatsSetup(env({}))).toEqual({
      setup: null,
      missing: [`UMAMI_API_URL`, `UMAMI_API_TOKEN`, `MPA_UMAMI_WEBSITE_ID`],
    })
    expect(readWebsiteStatsSetup(env({ UMAMI_API_URL: SETUP.url, UMAMI_API_TOKEN: ` ` })))
      .toEqual({ setup: null, missing: [`UMAMI_API_TOKEN`, `MPA_UMAMI_WEBSITE_ID`] })
    expect(readWebsiteStatsSetup(env({
      UMAMI_API_URL: SETUP.url,
      UMAMI_API_TOKEN: SETUP.token,
      MPA_UMAMI_WEBSITE_ID: SETUP.websiteId,
    }))).toEqual({ setup: SETUP, missing: [] })
  })

  it(`answers that Stats is off, naming what is missing, without asking Umami`, async () => {
    const { service, umami } = stats({ setup: null, missing: [`UMAMI_API_TOKEN`] })
    expect(await service.read(QUERY)).toEqual({ state: `off`, missing: [`UMAMI_API_TOKEN`] })
    expect(umami.calls).toEqual([])
  })
})

describe(`Stats numbers`, () => {
  it(`counts visits and order clicks per source, best first, the visits without a source last`, async () => {
    const { service } = stats()
    const answer = await service.read(QUERY)
    if (answer.state !== `ready`) throw new Error(answer.state)
    const { report } = answer
    expect(report.visits).toEqual({ current: 130, previous: 100 })
    expect(report.orderClicks).toEqual({ current: 10, previous: 4 })
    expect(report.sources.map((row) => [row.slug, row.visits, row.orderClicks])).toEqual([
      [`facebook`, 45, 5],
      [`zalo-a`, 60, 2],
      [`friends`, 5, 1],
      [null, 20, 2],
    ])
    expect(report.sources[0]).toMatchObject({ rate: 11.1, lowSample: false })
    // Below MIN_SOURCE_VISITS a row keeps its counts, loses its rate and is muted.
    expect(MIN_SOURCE_VISITS).toBe(20)
    expect(report.sources[2]).toMatchObject({ rate: null, lowSample: true })
    expect(report.hasSources).toBe(true)
    expect(report.orderRate).toEqual({ current: 7.7, previous: 4 })
    expect(report.fewVisits).toBe(false)
    expect(answer.umamiUrl).toBe(`${SETUP.url}/websites/${SETUP.websiteId}`)
  })

  it(`names the order channels from the website's order events, most clicks first`, async () => {
    const { service } = stats()
    const answer = await service.read(QUERY)
    if (answer.state !== `ready`) throw new Error(answer.state)
    expect(answer.report.channels).toEqual([
      { event: `order-zalo`, name: `Zalo`, clicks: 7 },
      { event: `order-telegram`, name: `Telegram`, clicks: 3 },
    ])
    expect(channelName(`order-zalo-oa`)).toBe(`Zalo Oa`)
  })

  it(`says the period has few visits below the threshold`, async () => {
    const { service } = stats({
      umami: fakeUmami({ ...WORLD, visits: { all: MIN_SOURCE_VISITS - 1 } }).reads,
      sources: () => Promise.resolve([]),
    })
    const answer = await service.read(QUERY)
    if (answer.state !== `ready`) throw new Error(answer.state)
    expect(answer.report.fewVisits).toBe(true)
    expect(answer.report.orderRate.current).toBeNull()
    expect(answer.report.hasSources).toBe(false)
    expect(answer.report.sources.map((row) => row.slug)).toEqual([null])
  })

  it(`fills every day of the chart and of the period before, oldest first`, async () => {
    const { service } = stats()
    const answer = await service.read({ ...QUERY, days: 7 })
    if (answer.state !== `ready`) throw new Error(answer.state)
    const { perDay, previousPerDay } = answer.report
    expect(perDay.length).toBe(7)
    expect(perDay[0]).toEqual({ day: `2026-10-22`, visits: 0 })
    expect(perDay.slice(-2)).toEqual([
      { day: `2026-10-27`, visits: 4 },
      { day: `2026-10-28`, visits: 6 },
    ])
    expect(previousPerDay.length).toBe(7)
    expect(previousPerDay[0].day).toBe(`2026-10-15`)
    expect(previousPerDay.find((day) => day.day === `2026-10-17`)?.visits).toBe(2)
  })

  it(`lists the most ordered items and the items viewed but never ordered`, async () => {
    const { service } = stats()
    const answer = await service.read(QUERY)
    if (answer.state !== `ready`) throw new Error(answer.state)
    expect(answer.report.items?.mostOrdered).toEqual([
      {
        id: `i1`,
        name: `Linen shirt`,
        coverId: `p1`,
        views: 40,
        orderClicks: 7,
        rate: 17.5,
        topSource: `Facebook market`,
        lowSample: false,
      },
      {
        id: `i3`,
        name: `Straw hat`,
        coverId: null,
        views: 3,
        orderClicks: 1,
        rate: null,
        // A tag no source has is never shown.
        topSource: null,
        lowSample: true,
      },
    ])
    expect(MIN_ITEM_VIEWS).toBe(10)
    expect(answer.report.items?.viewedNotOrdered.map((item) => item.id)).toEqual([`i2`])
  })

  it(`leaves the items out while the catalog is off`, async () => {
    const { service, umami } = stats({ items: null })
    const answer = await service.read(QUERY)
    if (answer.state !== `ready`) throw new Error(answer.state)
    expect(answer.report.items).toBeNull()
    expect(umami.calls.some((call) => call.startsWith(`metrics:path`))).toBe(false)
  })

  it(`asks for one source's chart only for a source that exists`, async () => {
    const { service, umami } = stats()
    const known = await service.read({ ...QUERY, source: `zalo-a` })
    const unknown = await service.read({ ...QUERY, source: `nobody` })
    expect(known.state === `ready` && known.report.source).toBe(`zalo-a`)
    expect(unknown.state === `ready` && unknown.report.source).toBeNull()
    expect(umami.calls.filter((call) => call.startsWith(`pageviews`))).toEqual([
      `pageviews zalo-a`,
      `pageviews all`,
    ])
  })
})

describe(`Stats copy and failures`, () => {
  it(`keeps one copy for five minutes for every operator, and asks again after or on refresh`, async () => {
    const { service, umami, later } = stats()
    await Promise.all([service.read(QUERY), service.read(QUERY)])
    const once = umami.calls.length
    await service.read(QUERY)
    expect(umami.calls.length).toBe(once)
    later(STATS_CACHE_MS)
    await service.read(QUERY)
    expect(umami.calls.length).toBe(once * 2)
    await service.read({ ...QUERY, fresh: true })
    expect(umami.calls.length).toBe(once * 3)
  })

  it(`shows the last numbers, marked stale with their time, when Umami stops answering`, async () => {
    const { service, umami, later } = stats()
    const first = await service.read(QUERY)
    umami.state.up = false
    later(STATS_CACHE_MS + 1)
    const answer = await service.read(QUERY)
    expect(answer.state).toBe(`ready`)
    if (answer.state !== `ready` || first.state !== `ready`) throw new Error(answer.state)
    expect(answer.stale).toBe(true)
    expect(answer.updatedAt).toBe(first.updatedAt)
    expect(answer.report).toEqual(first.report)
  })

  it(`answers that Umami is not answering, never zeros, when nothing is kept`, async () => {
    const { service, umami } = stats()
    umami.state.up = false
    expect(await service.read(QUERY)).toEqual({
      state: `unreachable`,
      umamiUrl: `${SETUP.url}/websites/${SETUP.websiteId}`,
    })
  })

  it(`names a refused token, and a website Umami does not have`, async () => {
    const token = fakeUmami(WORLD, { up: true, token: false })
    const tokenAnswer = await stats({ umami: token.reads }).service.read(QUERY)
    expect(tokenAnswer.state).toBe(`token-refused`)

    const website = fakeUmami(WORLD, { up: true, token: false })
    website.reads.check = () =>
      Promise.resolve({ success: false, output: null, error: `x`, problem: `website` })
    const websiteAnswer = await stats({ umami: website.reads }).service.read(QUERY)
    expect(websiteAnswer.state).toBe(`unknown-website`)
  })
})
