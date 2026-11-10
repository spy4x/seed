import type postgres from "postgres"
import { INDEXNOW_MAX_URLS } from "@spy4x/integrations/indexnow"
import { CATALOG_INDEXNOW_JOB, type CatalogItem, catalogItemPath } from "@domain/catalog"
import { DEFAULT_LANGUAGE, LANGUAGES, sitePath } from "@domain/identity"
import type { JobHandler } from "../jobs/jobs.ts"
import { type IndexNowSetup, pingIndexNow, queueIndexNow } from "../jobs/indexnow.ts"

/**
 * How the website names an item's pages: the item address (`CATALOG_ITEM_PATH`, read by
 * `readCatalogItemPath`) and the catalog's languages (`CATALOG_LANGUAGES`).
 */
export interface CatalogPages {
  itemPath: string
  languages: readonly string[]
}

/** What the `catalog.indexnow` job needs. */
export interface CatalogIndexNowJobDeps {
  sql: postgres.Sql
  /** `null` while IndexNow is off: the job sends nothing. */
  setup: IndexNowSetup | null
  pages: CatalogPages
  /** Told once when a ping fails. Never gets the key. */
  log: (line: string) => void
  /** Defaults to `globalThis.fetch`; tests pass a fake. */
  fetch?: typeof fetch
}

/**
 * Every address of an item's page on the website, at most {@link INDEXNOW_MAX_URLS}: the item
 * address in each language the website lists it in, as its sitemap does (`catalogLanguages` in
 * `apps/mpa/catalog.ts`): the default language, without a prefix, and each other site language the
 * catalog keeps, such as `/de/jackets/zip-jacket`.
 */
export function catalogItemUrls(
  item: { slug: string; categorySlug: string | null },
  pages: CatalogPages,
  siteUrl: string,
): string[] {
  const path = catalogItemPath(pages.itemPath, {
    itemSlug: item.slug,
    categorySlug: item.categorySlug,
  })
  return LANGUAGES
    .filter((language) => language === DEFAULT_LANGUAGE || pages.languages.includes(language))
    .slice(0, INDEXNOW_MAX_URLS)
    .map((language) => `${siteUrl}${sitePath(language, path)}`)
}

/** What of a published item an edit must change for its page to be sent to IndexNow again. */
type PageFields = Pick<CatalogItem, `price` | `slug` | `categoryId` | `soldOut`>

/**
 * Whether an edit changed what the search engines should see again: the price, the sold-out
 * combinations (in any order), the slug or the category. Texts, colours and sizes alone do not.
 */
export function itemPageChanged(before: PageFields, after: PageFields): boolean {
  const soldOut = (item: PageFields) =>
    item.soldOut.map(({ colourId, sizeId }) => `${colourId}/${sizeId}`).sort().join(`,`)
  return before.price !== after.price || before.slug !== after.slug ||
    before.categoryId !== after.categoryId || soldOut(before) !== soldOut(after)
}

/**
 * The `catalog.indexnow` job, about one item: it sends the item's addresses to IndexNow, so Bing,
 * Yandex and the other engines that share it look at the page again within minutes. It reads the
 * item when it runs, so a hidden item is sent too: its page now answers 404, which the engines see.
 *
 * An item that was never published, or is gone, has no page to send. A failed ping is logged once
 * and the job still succeeds: it is never retried, and it never touches the item.
 */
export function catalogIndexNowJob(deps: CatalogIndexNowJobDeps): JobHandler {
  return async (event) => {
    if (!deps.setup) return
    const [item] = await deps.sql<
      { slug: string; categorySlug: string | null; publishedAt: Date | null }[]
    >`
      SELECT i.slug, c.slug AS category_slug, i.published_at
      FROM catalog_items i LEFT JOIN catalog_categories c ON c.id = i.category_id
      WHERE i.id = ${event.aggregateId}
    `
    if (!item || item.publishedAt === null) return
    await pingIndexNow(
      deps.setup,
      catalogItemUrls(item, deps.pages, deps.setup.siteUrl),
      `catalog item ${event.aggregateId}`,
      deps,
    )
  }
}

/** Queues the item's `catalog.indexnow` job in the write's transaction, deduplicated ({@link queueIndexNow}). */
export function queueCatalogIndexNow(sql: postgres.Sql, itemId: string): Promise<void> {
  return queueIndexNow(sql, CATALOG_INDEXNOW_JOB, itemId)
}
