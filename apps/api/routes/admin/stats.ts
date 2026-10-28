import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { catalogItemPath, catalogText } from "@domain/catalog"
import { websiteStatsPeriod, type WebsiteStatsResponse } from "@domain/identity"
import { PostgresCatalog } from "@server/catalog/postgres-catalog.ts"
import type { APIContext } from "../../_types.ts"
import {
  createWebsiteStats,
  type WebsiteStatsQuery,
  type WebsiteStatsSetup,
} from "../../services/website-stats.ts"
import type { AdminApiModule } from "./module.ts"

/** What the Stats route calls. */
export interface AdminWebsiteStatsRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  read(query: WebsiteStatsQuery): Promise<WebsiteStatsResponse>
}

/**
 * `GET /website-stats?days=7|30|90&source=<slug>&fresh=1` answers the Stats screen's
 * {@link WebsiteStatsResponse} (#485): the website's totals from Umami, never a visitor, a session,
 * a place or an address. `days` outside the three periods reads as 30; `fresh=1` skips the shared
 * copy ("Refresh numbers"). The Umami token stays on the server.
 */
export function createAdminWebsiteStatsRoutes(
  dependencies: AdminWebsiteStatsRouteDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>()
    .get(`/website-stats`, dependencies.limit, async (c) => {
      const source = c.req.query(`source`)?.trim() || null
      return c.json(
        await dependencies.read({
          days: websiteStatsPeriod(c.req.query(`days`)),
          source,
          fresh: c.req.query(`fresh`) === `1`,
        }),
      )
    })
}

/** What Stats is built from, read once at start (`apps/api/index.ts`). */
export interface WebsiteStatsContext {
  /** `null` while Stats is off; `missing` then names the unset settings. */
  setup: WebsiteStatsSetup | null
  missing: string[]
  /** The website's item address, with `{category}` and `{slug}` (`CATALOG_ITEM_PATH`). */
  itemPath: string
}

/**
 * The Stats module (#485): the website's visits, their sources, the catalog's items and the order
 * channels, from Umami. Always on, so the screen can say how to turn Stats on.
 */
export const statsAdminModule: AdminApiModule = {
  id: `stats`,
  routes: ({ sql, limit, catalog, websiteStats }) => {
    const repository = new PostgresCatalog(sql)
    const languages = catalog.settings.languages
    const stats = createWebsiteStats({
      setup: websiteStats.setup,
      missing: websiteStats.missing,
      sources: async () =>
        (await repository.listSources()).map(({ slug, name }) => ({ slug, name })),
      items: catalog.on
        ? async () => {
          const [items, categories] = await Promise.all([
            repository.listItems(),
            repository.listCategories(),
          ])
          const categorySlugs = new Map(categories.map(({ id, slug }) => [id, slug]))
          return items.map((item) => ({
            id: item.id,
            slug: item.slug,
            path: catalogItemPath(websiteStats.itemPath, {
              itemSlug: item.slug,
              categorySlug: item.categoryId === null
                ? null
                : categorySlugs.get(item.categoryId) ?? null,
            }),
            name: catalogText(item.name, languages),
            coverId: item.coverId,
          }))
        }
        : null,
    })
    return createAdminWebsiteStatsRoutes({ limit, read: stats.read })
  },
}
