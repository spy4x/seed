import type postgres from "postgres"
import type {
  CatalogColour,
  CatalogCombination,
  CatalogSettings,
  CatalogText,
  PublicCatalogCategory,
  PublicCatalogItem,
  PublicCatalogItemSummary,
  PublicCatalogPhoto,
  PublicCatalogResponse,
} from "@domain/catalog"
import { catalogPhotoObjectKey } from "@domain/catalog"
import { readCatalogSizes, STOCK_COUNTS, stockOf } from "./postgres-catalog.ts"

/**
 * The website's reads of the catalog (#466): published items only, in categories, with the photos
 * the worker has made widths of. A draft or a hidden item never leaves here, nor do item and
 * category ids; colour and size ids do, for the sold-out marks. The SQL of the admin's writes is `postgres-catalog.ts`.
 *
 * @module
 */

interface SummaryRow {
  id: string
  slug: string
  categorySlug: string
  name: CatalogText
  price: string
  publishedAt: Date
  updatedAt: Date
  combinations: string
  soldOutCount: number
}

/** The published items, the ones of `slug` only when it is given, in the categories' order. */
async function readSummaries(sql: postgres.Sql, slug?: string): Promise<SummaryRow[]> {
  return await sql<SummaryRow[]>`
    SELECT i.id, i.slug, c.slug AS category_slug, i.name, i.price::text AS price, i.published_at,
      i.updated_at, ${sql.unsafe(STOCK_COUNTS)}
    FROM catalog_items i JOIN catalog_categories c ON c.id = i.category_id
    WHERE i.status = 'published' ${slug === undefined ? sql`` : sql`AND i.slug = ${slug}`}
    ORDER BY c.position, i.published_at DESC, i.id
  `
}

/**
 * The ready photos of the items `itemIds`, in each item's order, with every width: AVIF before
 * WebP, narrowest first. A photo still being prepared or refused is left out. With `coversOnly`,
 * each item's cover alone.
 */
async function readPhotos(
  sql: postgres.Sql,
  itemIds: readonly string[],
  coversOnly = false,
): Promise<Map<string, PublicCatalogPhoto[]>> {
  // The cover is the item's first ready photo: the list reads no other.
  const cover = coversOnly
    ? sql`AND p.id = (
      SELECT c.id FROM catalog_photos c
      JOIN images ci ON ci.id = c.id AND ci.processed_at IS NOT NULL AND ci.refused IS NULL
      WHERE c.item_id = p.item_id
      ORDER BY c.position LIMIT 1
    )`
    : sql``
  const rows = await sql<{
    itemId: string
    id: string
    colourId: string | null
    alt: CatalogText
    objectKey: string
    contentType: string
    width: number
    height: number
  }[]>`
    SELECT p.item_id, p.id, p.colour_id, p.alt, v.object_key, v.content_type, v.width, v.height
    FROM catalog_photos p
    JOIN images im ON im.id = p.id AND im.processed_at IS NOT NULL AND im.refused IS NULL
    JOIN image_variants v ON v.image_id = p.id
    WHERE p.item_id = ANY(${sql.array([...itemIds])}::uuid[]) ${cover}
    ORDER BY p.item_id, p.position, v.content_type, v.width
  `
  const byItem = new Map<string, PublicCatalogPhoto[]>()
  for (const row of rows) {
    const photos = byItem.get(row.itemId) ?? []
    let photo = photos.at(-1)
    if (photo?.id !== row.id) {
      photo = { id: row.id, colourId: row.colourId, alt: row.alt, variants: [] }
      photos.push(photo)
    }
    photo.variants.push({
      file: row.objectKey.slice(row.objectKey.lastIndexOf(`/`) + 1),
      width: row.width,
      height: row.height,
      type: row.contentType,
    })
    byItem.set(row.itemId, photos)
  }
  return byItem
}

function summaryOf(row: SummaryRow, cover: PublicCatalogPhoto | null): PublicCatalogItemSummary {
  return {
    slug: row.slug,
    categorySlug: row.categorySlug,
    name: row.name,
    price: Number(row.price),
    stock: stockOf(Number(row.combinations), row.soldOutCount),
    cover,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * The website's catalog: its settings, the categories that hold a published item, and every
 * published item with its cover.
 */
export async function readPublicCatalog(
  sql: postgres.Sql,
  settings: CatalogSettings,
): Promise<PublicCatalogResponse> {
  const rows = await readSummaries(sql)
  const photos = await readPhotos(sql, rows.map((row) => row.id), true)
  const categories = await sql<PublicCatalogCategory[]>`
    SELECT c.slug, c.name FROM catalog_categories c
    WHERE EXISTS (
      SELECT 1 FROM catalog_items i WHERE i.category_id = c.id AND i.status = 'published'
    )
    ORDER BY c.position, c.id
  `
  return {
    settings,
    categories: categories.map(({ slug, name }) => ({ slug, name })),
    items: rows.map((row) => summaryOf(row, photos.get(row.id)?.[0] ?? null)),
  }
}

/** One published item with everything its page shows, or `null`. */
export async function readPublicItem(
  sql: postgres.Sql,
  slug: string,
): Promise<PublicCatalogItem | null> {
  const [row] = await readSummaries(sql, slug)
  if (!row) return null
  const [texts] = await sql<
    Pick<PublicCatalogItem, `description` | `material` | `fit` | `care`>[]
  >`
    SELECT description, material, fit, care FROM catalog_items WHERE id = ${row.id}
  `
  const colours = await sql<CatalogColour[]>`
    SELECT id, name, swatch FROM catalog_item_colours WHERE item_id = ${row.id} ORDER BY position
  `
  const sizes = await readCatalogSizes(sql, row.id)
  const soldOut = await sql<CatalogCombination[]>`
    SELECT colour_id, size_id FROM catalog_sold_out WHERE item_id = ${row.id}
  `
  const photos = (await readPhotos(sql, [row.id])).get(row.id) ?? []
  return {
    ...summaryOf(row, photos[0] ?? null),
    description: texts.description,
    material: texts.material,
    fit: texts.fit,
    care: texts.care,
    colours: colours.map(({ id, name, swatch }) => ({ id, name, swatch })),
    sizes,
    soldOut: soldOut.map(({ colourId, sizeId }) => ({ colourId, sizeId })),
    photos,
  }
}

/** A width's file name: its width and its type, such as `960.webp`. */
const VARIANT_FILE = /^[1-9][0-9]{0,4}\.(avif|webp)$/

/**
 * Where one width of a published item's photo is kept and its type, or `null` for a photo that is
 * not one, of an item that is not published, or a file that is no width.
 */
export async function readPublicPhotoFile(
  sql: postgres.Sql,
  photoId: string,
  file: string,
): Promise<{ objectKey: string; contentType: string } | null> {
  if (!VARIANT_FILE.test(file)) return null
  const objectKey = `${catalogPhotoObjectKey(photoId)}/${file}`
  const [row] = await sql<{ contentType: string }[]>`
    SELECT v.content_type
    FROM image_variants v
    JOIN catalog_photos p ON p.id = v.image_id
    JOIN catalog_items i ON i.id = p.item_id AND i.status = 'published'
    WHERE v.object_key = ${objectKey} AND v.image_id = ${photoId}
  `
  return row ? { objectKey, contentType: row.contentType } : null
}
