import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { WebsiteStatsQuery } from "../../services/website-stats.ts"
import { createAdminWebsiteStatsRoutes } from "./stats.ts"

function app() {
  const queries: WebsiteStatsQuery[] = []
  const routes = createAdminWebsiteStatsRoutes({
    limit: (_c, next) => next(),
    read: (query) => (queries.push(query), Promise.resolve({ state: `off`, missing: [] })),
  })
  return { routes, queries }
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
