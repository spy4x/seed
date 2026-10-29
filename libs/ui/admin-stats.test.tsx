/**
 * The Stats screen (#485), driven in a browser DOM (happy-dom): the period and source in the
 * address, the ranked lists and their presses, every state, and the skeleton's delay.
 */
import { expect } from "@std/expect"
import { afterAll, afterEach, beforeAll, describe, it } from "@std/testing/bdd"
import { FakeTime } from "@std/testing/time"
import { Window } from "happy-dom"
import { render, type VNode } from "preact"
import { act } from "preact/test-utils"
import type { WebsiteStatsDay, WebsiteStatsReport, WebsiteStatsResponse } from "@domain/identity"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import {
  AdminStatsScreen,
  type AdminStatsScreenProps,
  chartPoints,
  STATS_SKELETON_DELAY_MS,
} from "./admin-stats-screen.tsx"
import { ADMIN_PSEUDO, englishLeft } from "./i18n-testing.ts"

const window = new Window({ url: "http://admin.localhost/stats" })
const own = {
  document: globalThis.document,
  FormData: globalThis.FormData,
  getComputedStyle: globalThis.getComputedStyle,
  location: globalThis.location,
}

beforeAll(() => {
  Object.assign(globalThis, {
    document: window.document,
    FormData: window.FormData,
    getComputedStyle: window.getComputedStyle.bind(window),
    location: window.location,
  })
})

afterAll(async () => {
  Object.assign(globalThis, own)
  await window.happyDOM.close()
})

let root: HTMLElement | null = null

afterEach(async () => {
  if (root) await act(() => render(null, root!))
  document.body.innerHTML = ""
  root = null
})

async function mount(node: VNode): Promise<HTMLElement> {
  if (!root) {
    root = document.createElement("div")
    document.body.append(root)
  }
  await act(() => render(node, root!))
  return root
}

function find<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element as unknown as T
}

function has(selector: string): boolean {
  return document.querySelector(selector) !== null
}

async function clickOn(element: Element): Promise<void> {
  await act(() => {
    element.dispatchEvent(
      new window.MouseEvent("click", { bubbles: true, cancelable: true }) as unknown as Event,
    )
  })
}

/** The button whose text is `text`, inside `scope`. */
function button(text: string, scope: ParentNode = document): HTMLElement {
  const found = [...scope.querySelectorAll("button")].find((element) =>
    element.textContent?.trim() === text
  )
  if (!found) throw new Error(`no button reads ${text}`)
  return found as unknown as HTMLElement
}

function link(text: string, scope: ParentNode = document): HTMLAnchorElement {
  const found = [...scope.querySelectorAll("a")].find((element) =>
    element.textContent?.trim() === text
  )
  if (!found) throw new Error(`no link reads ${text}`)
  return found as unknown as HTMLAnchorElement
}

/** The text of each cell of every body row of the table inside `selector`. */
function rows(selector: string): string[][] {
  return [...document.querySelectorAll(`${selector} tbody tr`)].map((row) =>
    [...row.querySelectorAll("th, td")].map((cell) => cell.textContent?.trim() ?? "")
  )
}

const days = (from: string, visits: number[]): WebsiteStatsDay[] =>
  visits.map((count, index) => {
    const day = new Date(`${from}T00:00:00Z`)
    day.setUTCDate(day.getUTCDate() + index)
    return { day: day.toISOString().slice(0, 10), visits: count }
  })

const report: WebsiteStatsReport = {
  days: 7,
  visits: { current: 140, previous: 100 },
  orderClicks: { current: 7, previous: 7 },
  orderRate: { current: 5, previous: 7 },
  fewVisits: false,
  source: null,
  perDay: days("2026-10-21", [20, 20, 20, 20, 20, 20, 20]),
  previousPerDay: days("2026-10-14", [10, 15, 15, 15, 15, 15, 15]),
  sources: [
    { slug: "zalo-a", name: "Zalo A", visits: 80, orderClicks: 6, rate: 7.5, lowSample: false },
    {
      slug: "fb-market",
      name: "FB market",
      visits: 4,
      orderClicks: 1,
      rate: null,
      lowSample: true,
    },
    { slug: null, name: "", visits: 56, orderClicks: 0, rate: 0, lowSample: false },
  ],
  hasSources: true,
  items: {
    mostOrdered: [{
      id: "item-1",
      name: "Linen dress",
      coverId: "cover-1",
      views: 30,
      orderClicks: 5,
      rate: 16.7,
      topSource: "Zalo A",
      lowSample: false,
    }],
    viewedNotOrdered: [{
      id: "item-2",
      name: "Silk scarf",
      coverId: null,
      views: 12,
      orderClicks: 0,
      rate: 0,
      topSource: null,
      lowSample: false,
    }],
  },
  channels: [
    { event: "order-telegram", name: "Telegram", clicks: 4 },
    { event: "order-zalo", name: "Zalo", clicks: 3 },
  ],
  minSourceVisits: 20,
  minItemViews: 10,
}

const ready = (overrides: Partial<WebsiteStatsReport> = {}): WebsiteStatsResponse => ({
  state: "ready",
  umamiUrl: "https://umami.example.com/websites/w1",
  report: { ...report, ...overrides },
  updatedAt: new Date().toISOString(),
  stale: false,
})

function props(
  calls: unknown[][],
  overrides: Partial<AdminStatsScreenProps> = {},
): AdminStatsScreenProps {
  return {
    days: 7,
    source: null,
    response: ready(),
    pending: false,
    error: null,
    onPeriod: (days) => calls.push(["period", days]),
    onSource: (source) => calls.push(["source", source]),
    onRefresh: (fresh) => calls.push(["refresh", fresh]),
    navigate: (href) => calls.push(["navigate", href]),
    ...overrides,
  }
}

describe("stats screen", () => {
  it("shows visits, order clicks and the order rate, each with its change", async () => {
    await mount(<AdminStatsScreen {...props([])} />)
    const kpis = find("[data-e2e=admin-stats-kpis]").textContent
    expect(kpis).toContain("140")
    expect(kpis).toContain("+40 vs previous 7 days")
    expect(kpis).toContain("No change vs previous 7 days")
    expect(kpis).toContain("5.0%")
    expect(kpis).toContain("−2.0 points vs previous 7 days")
    expect(kpis).toContain("a tap on a Telegram or Zalo order button")
  })

  it("ranks the sources as given, ends with No source and prints – for a thin sample", async () => {
    await mount(<AdminStatsScreen {...props([])} />)
    const table = rows("[data-e2e=admin-stats-sources-list]")
    expect(table.map((row) => row.slice(1))).toEqual([
      ["80", "6", "7.5%"],
      ["4", "1", "–"],
      ["56", "0", "0.0%"],
    ])
    expect(table.map((row) => row[0].split("Order clicks")[0])).toEqual([
      "Zalo A",
      "FB market",
      "No source",
    ])
    expect(table[2][0]).toContain("Typed the address, or came from a link without a source.")
    const thin = find("[data-e2e=admin-stats-sources-list] tbody tr:nth-child(2)")
    expect(thin.getAttribute("data-low-sample")).toBe("true")
  })

  it("puts a source on the chart from its row and from the select, and All sources back", async () => {
    const calls: unknown[][] = []
    await mount(<AdminStatsScreen {...props(calls)} />)
    await clickOn(button("Zalo A", find("[data-e2e=admin-stats-sources-list]")))
    // The visits without a source have no line of their own on the chart.
    expect(() => button("No source")).toThrow()

    const select = find<HTMLSelectElement>("[data-e2e=admin-stats-source]")
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "All sources",
      "Zalo A",
      "FB market",
    ])
    for (const value of ["fb-market", ""]) {
      select.value = value
      await act(() => {
        select.dispatchEvent(new window.Event("change", { bubbles: true }) as unknown as Event)
      })
    }
    expect(calls).toEqual([["source", "zalo-a"], ["source", "fb-market"], ["source", null]])
  })

  it("draws the period picker beside the title from sm up, and under the header on a phone", async () => {
    await mount(<AdminStatsScreen {...props([])} />)
    const holders = [...document.querySelectorAll("[role=radiogroup]")].map((group) =>
      group.parentElement!.className
    )
    expect(holders).toEqual(["max-sm:hidden", "sm:hidden"])
  })

  it("asks for another period from the period picker", async () => {
    const calls: unknown[][] = []
    await mount(<AdminStatsScreen {...props(calls)} />)
    const picker = find("[role=radiogroup]")
    expect(picker.getAttribute("aria-label")).toBe("Period")
    expect(find("[role=radio][aria-checked=true]").textContent).toContain("7 days")
    await clickOn(button("90 days", picker))
    expect(calls).toEqual([["period", 90]])
  })

  it("refreshes past the shared copy, opens Umami and edits sources from More actions", async () => {
    const calls: unknown[][] = []
    await mount(<AdminStatsScreen {...props(calls)} />)
    await clickOn(find("button[aria-label='More actions']"))
    expect(find("[data-e2e=admin-stats-umami]").getAttribute("href")).toBe(
      "https://umami.example.com/websites/w1",
    )
    expect(find("[data-e2e=admin-stats-sources]").getAttribute("href")).toBe("/catalog/sources")
    await clickOn(find("[data-e2e=admin-stats-refresh]"))
    expect(calls).toEqual([["refresh", true]])
  })

  it("links each row of either list to its item's page, opened in the app", async () => {
    const calls: unknown[][] = []
    await mount(<AdminStatsScreen {...props(calls)} />)
    const ordered = link("Linen dress", find("[data-e2e=admin-stats-most-ordered]"))
    const viewed = link("Silk scarf", find("[data-e2e=admin-stats-not-ordered]"))
    expect(ordered.getAttribute("href")).toBe("/catalog/item-1")
    expect(viewed.getAttribute("href")).toBe("/catalog/item-2")
    await clickOn(ordered)
    await clickOn(viewed)
    expect(calls).toEqual([
      ["navigate", "/catalog/item-1"],
      ["navigate", "/catalog/item-2"],
    ])
    expect(find("[data-e2e=admin-stats-most-ordered]").textContent).toContain("mostly Zalo A")
    expect(find("[data-e2e=admin-stats-not-ordered]").textContent).toContain("at least 10 views")
  })

  it("counts the order clicks per channel and says what the numbers leave out", async () => {
    await mount(<AdminStatsScreen {...props([])} />)
    const channels = find("[data-e2e=admin-stats-channels]").textContent
    expect(channels).toContain("Telegram")
    expect(channels).toContain("Zalo")
    expect(find("[data-e2e=admin-stats-limits]").textContent).toBe(
      "Some visitors block trackers, so the real numbers are a little higher. A source's order clicks count only taps on the page its share link opened.",
    )
  })

  it("warns that rates can swing while the period has few visits", async () => {
    await mount(<AdminStatsScreen {...props([], { response: ready({ fewVisits: true }) })} />)
    expect(find("[data-e2e=admin-stats-few]").textContent).toContain("Few visits so far")
  })

  it("leaves out the items and Edit sources while the catalog is off", async () => {
    await mount(<AdminStatsScreen {...props([], { response: ready({ items: null }) })} />)
    expect(has("[data-e2e=admin-stats-items]")).toBe(false)
    expect(has("[data-e2e=admin-stats-sources]")).toBe(false)
    expect(has("[data-e2e=admin-stats-kpis]")).toBe(true)
  })

  it("says how to add sources while there are none", async () => {
    const calls: unknown[][] = []
    const noSources = ready({ hasSources: false, sources: [report.sources[2]] })
    await mount(<AdminStatsScreen {...props(calls, { response: noSources })} />)
    const line = find("[data-e2e=admin-stats-no-sources]")
    expect(line.textContent).toContain("No sources yet.")
    await clickOn(line.querySelector("a")!)
    expect(calls).toEqual([["navigate", "/catalog/sources"]])
  })

  it("shows one empty state with the catalog's link while nobody visited", async () => {
    const calls: unknown[][] = []
    const none = ready({ visits: { current: 0, previous: 0 } })
    await mount(<AdminStatsScreen {...props(calls, { response: none })} />)
    expect(find("[data-e2e=admin-stats-empty]").textContent).toContain("No visits yet")
    expect(has("[data-e2e=admin-stats-kpis]")).toBe(false)
    await clickOn(find("[data-e2e=admin-stats-empty] a"))
    expect(calls).toEqual([["navigate", "/catalog"]])
  })

  it("dims the old numbers and marks them busy while the next period loads", async () => {
    await mount(<AdminStatsScreen {...props([], { pending: true })} />)
    expect(find("[data-e2e=admin-stats-body]").getAttribute("aria-busy")).toBe("true")
  })
})

describe("stats screen states", () => {
  it("names the three settings and hides the period picker while Stats is off", async () => {
    const off: WebsiteStatsResponse = {
      state: "off",
      missing: ["UMAMI_API_URL", "UMAMI_API_TOKEN", "MPA_UMAMI_WEBSITE_ID"],
    }
    await mount(<AdminStatsScreen {...props([], { response: off })} />)
    const text = find("[data-e2e=admin-stats-off]").textContent
    expect(text).toContain("Stats are off")
    expect(text).toContain("UMAMI_API_URL, UMAMI_API_TOKEN and MPA_UMAMI_WEBSITE_ID")
    expect(has("[role=radiogroup]")).toBe(false)
    const setup = find<HTMLAnchorElement>("[data-e2e=admin-stats-off] a")
    expect(setup.getAttribute("target")).toBe("_blank")
    expect(setup.getAttribute("aria-label")).toBe("Read the stats setup (opens in a new tab)")
  })

  it("names only the missing settings when some are set", async () => {
    const off: WebsiteStatsResponse = { state: "off", missing: ["UMAMI_API_TOKEN"] }
    await mount(<AdminStatsScreen {...props([], { response: off })} />)
    expect(find("[data-e2e=admin-stats-off]").textContent).toContain(
      "Missing: UMAMI_API_TOKEN. Add it to the server's env file and deploy.",
    )
  })

  it("says which setting Umami refused", async () => {
    const url = "https://umami.example.com/websites/w1"
    await mount(
      <AdminStatsScreen {...props([], { response: { state: "token-refused", umamiUrl: url } })} />,
    )
    expect(find("[data-e2e=admin-stats-token-refused]").textContent).toContain("UMAMI_API_TOKEN")
    await mount(
      <AdminStatsScreen
        {...props([], { response: { state: "unknown-website", umamiUrl: url } })}
      />,
    )
    expect(find("[data-e2e=admin-stats-unknown-website]").textContent).toContain(
      "MPA_UMAMI_WEBSITE_ID",
    )
    expect(has("[data-e2e=admin-stats-unknown-website] button")).toBe(false)
  })

  it("offers Try again, never zeros, while Umami is down with nothing kept", async () => {
    const calls: unknown[][] = []
    const down: WebsiteStatsResponse = {
      state: "unreachable",
      umamiUrl: "https://umami.example.com",
    }
    await mount(<AdminStatsScreen {...props(calls, { response: down })} />)
    const card = find("[data-e2e=admin-stats-unreachable]")
    expect(card.textContent).toContain("Umami is not answering")
    expect(has("[data-e2e=admin-stats-kpis]")).toBe(false)
    await clickOn(button("Try again", card))
    expect(calls).toEqual([["refresh", true]])
  })

  it("shows the kept numbers under a warning while Umami is down", async () => {
    const calls: unknown[][] = []
    const stale = { ...ready(), stale: true, updatedAt: "2026-10-27T14:40:00.000Z" }
    await mount(<AdminStatsScreen {...props(calls, { response: stale as WebsiteStatsResponse })} />)
    const notice = find("[data-e2e=admin-stats-stale]")
    expect(notice.textContent).toContain("Umami is not answering right now.")
    expect(has("[data-e2e=admin-stats-kpis]")).toBe(true)
    await clickOn(button("Try again", notice))
    expect(calls).toEqual([["refresh", true]])
  })

  it("shows our API's failure with Try again, which reads the shared copy", async () => {
    const calls: unknown[][] = []
    await mount(<AdminStatsScreen {...props(calls, { response: null, error: "Down." })} />)
    expect(find("[data-e2e=admin-stats-error]").textContent).toContain("Could not load the stats.")
    await clickOn(button("Try again"))
    expect(calls).toEqual([["refresh", false]])
  })

  it("draws the skeleton only once the first answer is slower than the delay", async () => {
    using time = new FakeTime()
    await mount(<AdminStatsScreen {...props([], { response: null })} />)
    expect(find("[data-e2e=admin-stats-loading]").getAttribute("aria-label")).toBe(
      "Loading the stats",
    )
    expect(has("[data-e2e=admin-stats-skeleton]")).toBe(false)
    await act(() => time.tick(STATS_SKELETON_DELAY_MS - 1))
    expect(has("[data-e2e=admin-stats-skeleton]")).toBe(false)
    await act(() => time.tick(1))
    expect(has("[data-e2e=admin-stats-skeleton]")).toBe(true)
  })
})

describe("the visits chart beside the period before", () => {
  /** Each row of the chart's data table: its label, then this period's and the last's value. */
  const chartRows = () =>
    [...document.querySelectorAll("[data-e2e=admin-stats-chart] [data-chart-table] tbody tr")]
      .map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent))

  for (
    const [name, current, previous, slots] of [
      ["draws a busy period by day over a quiet one", 10, 1, 30],
      ["draws a quiet period by week over a busy one", 1, 10, 5],
    ] as const
  ) {
    it(name, async () => {
      const both = ready({
        days: 30,
        perDay: days("2026-09-29", Array(30).fill(current)),
        previousPerDay: days("2026-08-30", Array(30).fill(previous)),
      })
      await mount(<AdminStatsScreen {...props([], { days: 30, response: both })} />)
      const rows = chartRows()
      expect(rows.length).toBe(slots)
      // Every slot has a number in both lines: neither stops early nor bunches up at the start.
      expect(rows.filter((row) => row.includes("–"))).toEqual([])
    })
  }
})

describe("the visits chart's points", () => {
  it("keeps one point per day while most days have a few visits", () => {
    const points = chartPoints(days("2026-10-01", [3, 3, 3, 0, 0, 3, 3, 3]))
    expect(points.map((point) => point.y)).toEqual([3, 3, 3, 0, 0, 3, 3, 3])
  })

  it("sums weeks while most days have fewer than three visits", () => {
    const points = chartPoints(days("2026-10-01", [1, 0, 2, 0, 1, 0, 0, 5, 1]))
    expect(points).toEqual([
      { x: "2026-10-01", y: 4, weekly: true },
      { x: "2026-10-08", y: 6, weekly: true },
    ])
  })

  it("never sums a week of seven days", () => {
    expect(chartPoints(days("2026-10-01", [0, 0, 0, 0, 0, 0, 1])).map((point) => point.weekly))
      .toEqual([false, false, false, false, false, false, false])
  })
})

describe("stats screen in en-XA", () => {
  it("shows no English outside the catalog: every word is pseudo-language or data", async () => {
    const page = await mount(
      <I18nContext.Provider value={ADMIN_PSEUDO}>
        <AdminStatsScreen {...props([])} />
      </I18nContext.Provider>,
    )
    expect(
      englishLeft(page, [`Zalo A`, `FB market`, `Linen dress`, `Silk scarf`, `Telegram`, `Zalo`]),
    )
      .toEqual([])
  })
})
