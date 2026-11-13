import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import { catalogItemPath, catalogText } from "@domain/catalog"
import {
  type WebsiteItemStatsResponse,
  websiteStatsPeriod,
  type WebsiteStatsResponse,
} from "@domain/identity"
import { PostgresCatalog } from "@server/catalog/postgres-catalog.ts"
import type { APIContext } from "../../_types.ts"
import { errorResponse } from "../../services/error-response.ts"
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
  /** One catalog item's numbers, or `null` when the catalog is off or has no such item. */
  readItem(id: string): Promise<WebsiteItemStatsResponse | null>
}

/** The refusal of an item id that names no item. */
export const STATS_ITEM_NOT_FOUND = `This item does not exist.`

const itemId = type(`string.uuid`)

/**
 * `GET /website-stats?days=7|30|90&source=<slug>&fresh=1` answers the Stats screen's
 * {@link WebsiteStatsResponse}: the website's totals from Umami, never a visitor, a session,
 * a place or an address. `days` outside the three periods reads as 30; `fresh=1` skips the shared
 * copy ("Refresh numbers"). The Umami token stays on the server.
 *
 * `GET /website-stats/items/:id` answers one catalog item's {@link WebsiteItemStatsResponse} for
 * its "Share links" card, and 404 for an id that is no UUID or names no item, or while the
 * catalog is off.
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
    .get(`/website-stats/items/:id`, dependencies.limit, async (c) => {
      const id = itemId(c.req.param(`id`))
      const answer = id instanceof type.errors
        ? null
        : await dependencies.readItem(id.toLowerCase())
      if (answer === null) return errorResponse(c, `not_found`, { message: STATS_ITEM_NOT_FOUND })
      return c.json(answer)
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
 * The Stats module: the website's visits, their sources, the catalog's items and the order
 * channels, from Umami. Always on, so the screen can say how to turn Stats on.
 */
export const statsAdminModule: AdminApiModule = {
  id: `stats`,
  routes: ({ sql, limit, catalog, websiteStats }) => {
    const repository = new PostgresCatalog(sql)
    const languages = catalog.settings.languages
    const categorySlugs = async () =>
      new Map((await repository.listCategories()).map(({ id, slug }) => [id, slug]))
    const stats = createWebsiteStats({
      setup: websiteStats.setup,
      missing: websiteStats.missing,
      sources: async () =>
        (await repository.listSources()).map(({ slug, name }) => ({ slug, name })),
      items: catalog.on
        ? async () => {
          const [items, categories] = await Promise.all([repository.listItems(), categorySlugs()])
          return items.map((item) => ({
            id: item.id,
            slug: item.slug,
            path: itemPathOf(item, categories),
            name: catalogText(item.name, languages),
            coverId: item.coverId,
          }))
        }
        : null,
    })
    /** The item's page on the website, as the tracker records it. */
    const itemPathOf = (
      item: { slug: string; categoryId: string | null },
      categories: Map<string, string>,
    ) =>
      catalogItemPath(websiteStats.itemPath, {
        itemSlug: item.slug,
        categorySlug: item.categoryId === null ? null : categories.get(item.categoryId) ?? null,
      })
    return createAdminWebsiteStatsRoutes({
      limit,
      read: stats.read,
      readItem: async (id) => {
        if (!catalog.on) return null
        const item = await repository.getItem(id)
        if (!item) return null
        return await stats.item({ id, path: itemPathOf(item, await categorySlugs()) })
      },
    })
  },
}
