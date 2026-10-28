import { Hono } from "hono"
import type postgres from "postgres"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { CatalogSettings, PublicCatalogItem, PublicCatalogResponse } from "@domain/catalog"
import {
  readPublicCatalog,
  readPublicItem,
  readPublicPhotoFile,
} from "@server/catalog/public-catalog.ts"
import { errorResponse } from "../services/error-response.ts"

/** The website's reads of the catalog. */
export interface PublicCatalogReads {
  catalog(): Promise<PublicCatalogResponse>
  item(slug: string): Promise<PublicCatalogItem | null>
  /** The bytes and type of one width of a published item's photo, or `null`. */
  photo(id: string, file: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
}

/**
 * The public catalog (#466), mounted at `/api/catalog` for the public website, and only while the
 * catalog is on (`CATALOG=true`). No session. Only published items leave: a draft or hidden item
 * answers 404 like one that never existed.
 *
 * - `GET /` is the settings, the categories that hold a published item, and every published item
 *   with its cover.
 * - `GET /items/:slug` is one published item with its texts, colours, sizes, what is sold out and
 *   its photos.
 * - `GET /photos/:id/:file` is one width of a published item's photo, such as `960.webp`. The
 *   website serves it from its own host; the bytes never change for a name, so they are cached.
 */
export function createPublicCatalogRoute(reads: PublicCatalogReads): Hono {
  const notFound = (c: Parameters<typeof errorResponse>[0]) =>
    errorResponse(c, `not_found`, { message: `Not found` })
  return new Hono()
    .get(`/`, async (c) => c.json(await reads.catalog()))
    .get(`/items/:slug`, async (c) => {
      const item = await reads.item(c.req.param(`slug`))
      return item ? c.json({ item }) : notFound(c)
    })
    .get(`/photos/:id/:file`, async (c) => {
      const id = c.req.param(`id`)
      if (!isUuid(id)) return notFound(c)
      const photo = await reads.photo(id.toLowerCase(), c.req.param(`file`))
      if (!photo) return notFound(c)
      return new Response(photo.bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          "content-type": photo.contentType,
          "x-content-type-options": `nosniff`,
          "content-security-policy": `sandbox; default-src 'none'`,
          // A day, not forever: hiding an item takes its photos off the site within a day.
          "cache-control": `public, max-age=86400`,
        },
      })
    })
}

/** The reads over the app's database and file store. */
export function createPublicCatalogReads(
  sql: postgres.Sql,
  settings: CatalogSettings,
  readFile: (key: string) => Promise<Uint8Array | null>,
): PublicCatalogReads {
  return {
    catalog: () => readPublicCatalog(sql, settings),
    item: (slug) => readPublicItem(sql, slug),
    async photo(id, file) {
      const found = await readPublicPhotoFile(sql, id, file)
      const bytes = found && await readFile(found.objectKey)
      return found && bytes ? { bytes, contentType: found.contentType } : null
    },
  }
}
