import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { WebsiteStatsQuery } from "../../services/website-stats.ts"
import { createAdminWebsiteStatsRoutes, STATS_ITEM_NOT_FOUND } from "./stats.ts"

const ITEM_ID = `019a3b1c-7d2e-7f00-8a00-00000000abcd`

function app() {
  const queries: WebsiteStatsQuery[] = []
  const items: string[] = []
  const routes = createAdminWebsiteStatsRoutes({
    limit: (_c, next) => next(),
    read: (query) => (queries.push(query), Promise.resolve({ state: `off`, missing: [] })),
    readItem: (id) => (
      items.push(id),
        Promise.resolve(
          id === ITEM_ID ? { state: `ready`, views: 3, orderClicks: 1, sources: [] } : null,
        )
    ),
  })
  return { routes, queries, items }
}

describe(`GET /website-stats`, () => {
  it(`passes the period, the chart's source and a refresh to Stats`, async () => {
    const { routes, queries } = app()
    const response = await routes.request(`/website-stats?days=7&source=zalo-a&fresh=1`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: `off`, missing: [] })
    expect(queries).toEqual([{ days: 7, source: `zalo-a`, fresh: true }])
  })

  it(`reads 30 days, every source and the shared copy for anything else`, async () => {
    const { routes, queries } = app()
    await routes.request(`/website-stats?days=365&source=&fresh=yes`)
    await routes.request(`/website-stats`)
    expect(queries).toEqual([
      { days: 30, source: null, fresh: false },
      { days: 30, source: null, fresh: false },
    ])
  })
})

describe(`GET /website-stats/items/:id`, () => {
  it(`answers the item's numbers, reading it by its id in lower case`, async () => {
    const { routes, items } = app()
    const response = await routes.request(`/website-stats/items/${ITEM_ID.toUpperCase()}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: `ready`, views: 3, orderClicks: 1, sources: [] })
    expect(items).toEqual([ITEM_ID])
  })

  it(`answers 404 for an unknown item, and for an id that is no UUID without reading it`, async () => {
    const { routes, items } = app()
    const unknown = await routes.request(
      `/website-stats/items/019a3b1c-7d2e-7f00-8a00-000000000000`,
    )
    expect(unknown.status).toBe(404)
    expect(JSON.stringify(await unknown.json())).toContain(STATS_ITEM_NOT_FOUND)
    const malformed = await routes.request(`/website-stats/items/..%2Fsecrets`)
    expect(malformed.status).toBe(404)
    expect(items).toEqual([`019a3b1c-7d2e-7f00-8a00-000000000000`])
  })
})
