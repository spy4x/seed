import type postgres from "postgres"
import {
  CATALOG_AUDIT_KINDS,
  CATALOG_CATEGORIES_MAX,
  CATALOG_CATEGORY_ENTITY,
  CATALOG_ITEM_ENTITY,
  CATALOG_ITEMS_MAX,
  CATALOG_PHOTOS_MAX,
  CATALOG_SOURCE_ENTITY,
  CATALOG_SOURCES_MAX,
  type CatalogAuditKind,
  type CatalogCategory,
  type CatalogCategoryFields,
  type CatalogColour,
  type CatalogCombination,
  CatalogError,
  type CatalogItem,
  type CatalogItemFields,
  type CatalogItemRow,
  type CatalogItemStatus,
  type CatalogLinkSource,
  type CatalogPhoto,
  type CatalogPhotoState,
  type CatalogSize,
  type CatalogSourceFields,
  type CatalogStock,
  type CatalogText,
  CatalogVersionConflictError,
} from "@domain/catalog"
import { queueImage } from "../files/images.ts"

/** The operator behind a write, for its audit row. */
export interface CatalogActor {
  /** `null` for the seed's sample items, which no operator wrote. */
  userId: number | null
  /** The request's id, so the audit row can be matched with the request log. */
  requestId: string | null
}

type Tx = postgres.TransactionSql

/** A `catalog_items` row as Postgres answers it (camelCase through the client's transform). */
interface ItemRowRaw {
  id: string
  slug: string
  categoryId: string | null
  name: CatalogText
  description: CatalogText
  material: CatalogText
  fit: CatalogText
  care: CatalogText
  /** `INT8` is read as text, and turned into a number below. */
  price: string
  status: CatalogItemStatus
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  version: number
}

/** The columns of an item, its price as text. */
const ITEM_COLUMNS = `id, slug, category_id, name, description, material, fit, care,
  price::text AS price, status, published_at, created_at, updated_at, version`

/**
 * Whether none, some or all of an item's combinations are sold out, from how many it has and how
 * many are sold out. A removed colour or size takes its sold-out rows along, so the count is exact.
 */
export function stockOf(combinations: number, soldOut: number): CatalogStock {
  return soldOut === 0 ? `in-stock` : soldOut >= combinations ? `sold-out` : `some-sold-out`
}

/** The SQL that counts an item's combinations and sold-out rows, for the item aliased `i`. */
export const STOCK_COUNTS = `
  GREATEST((SELECT count(*) FROM catalog_item_colours c WHERE c.item_id = i.id), 1)
    * GREATEST((SELECT count(*) FROM catalog_item_sizes s WHERE s.item_id = i.id), 1)
    AS combinations,
  (SELECT count(*)::int FROM catalog_sold_out o WHERE o.item_id = i.id) AS sold_out_count`

/** Whether an image has a stored width the admin can show yet, as SQL on `im`, an `images` row. */
const SHOWN = `EXISTS (SELECT 1 FROM image_variants v WHERE v.image_id = im.id)`

/**
 * A photo's state from its image's row: ready for the admin once its narrowest width is stored
 * (#514), while the worker still makes the wider ones the website waits for.
 */
function photoState(
  image: { shown: boolean; refused: number | null },
): CatalogPhotoState {
  if (image.refused !== null) return `refused`
  return image.shown ? `ready` : `preparing`
}

/** The text of `value` with its keys sorted, so two equal objects give the same text. */
function stable(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, inner) =>
      inner && typeof inner === `object` && !Array.isArray(inner)
        ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
        : inner,
  )
}

/** An item's fields, as the editor sends them, out of a stored item. */
function fieldsOf(item: CatalogItem): CatalogItemFields {
  const { slug, categoryId, name, description, material, fit, care, price } = item
  const { colours, sizes, soldOut } = item
  return {
    slug,
    categoryId,
    name,
    description,
    material,
    fit,
    care,
    price,
    colours,
    sizes,
    soldOut,
  }
}

/** An item's sizes in its order, each with its size chart's ranges. */
export async function readCatalogSizes(sql: postgres.Sql, itemId: string): Promise<CatalogSize[]> {
  const rows = await sql<{
    id: string
    label: string
    heightMinCm: number | null
    heightMaxCm: number | null
    weightMinKg: number | null
    weightMaxKg: number | null
  }[]>`
    SELECT id, label, height_min_cm, height_max_cm, weight_min_kg, weight_max_kg
    FROM catalog_item_sizes WHERE item_id = ${itemId} ORDER BY position
  `
  const range = (min: number | null, max: number | null) =>
    min === null || max === null ? null : { min, max }
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    heightCm: range(row.heightMinCm, row.heightMaxCm),
    weightKg: range(row.weightMinKg, row.weightMaxKg),
  }))
}

/** Reads an item with its colours, sizes, sold-out combinations and photos, or `null`. */
export async function readCatalogItem(sql: postgres.Sql, id: string): Promise<CatalogItem | null> {
  const [row] = await sql<ItemRowRaw[]>`
    SELECT ${sql.unsafe(ITEM_COLUMNS)} FROM catalog_items WHERE id = ${id}
  `
  if (!row) return null
  const colours = await sql<CatalogColour[]>`
    SELECT id, name, swatch FROM catalog_item_colours WHERE item_id = ${id} ORDER BY position
  `
  const sizes = await readCatalogSizes(sql, id)
  const soldOut = await sql<CatalogCombination[]>`
    SELECT o.colour_id, o.size_id FROM catalog_sold_out o
    LEFT JOIN catalog_item_colours c ON c.id = o.colour_id
    LEFT JOIN catalog_item_sizes s ON s.id = o.size_id
    WHERE o.item_id = ${id} ORDER BY c.position NULLS FIRST, s.position NULLS FIRST
  `
  const photos = await sql<
    (Omit<CatalogPhoto, `state`> & { shown: boolean; refused: number | null })[]
  >`
    SELECT p.id, p.colour_id, p.alt, ${sql.unsafe(SHOWN)} AS shown, im.refused
    FROM catalog_photos p JOIN images im ON im.id = p.id
    WHERE p.item_id = ${id} ORDER BY p.position
  `
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    material: row.material,
    fit: row.fit,
    care: row.care,
    price: Number(row.price),
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    colours: colours.map(({ id, name, swatch }) => ({ id, name, swatch })),
    sizes,
    soldOut: soldOut.map(({ colourId, sizeId }) => ({ colourId, sizeId })),
    photos: photos.map(({ id, colourId, alt, ...image }) => ({
      id,
      colourId,
      alt,
      state: photoState(image),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }
}

/** The constraints a second item or category with the same slug breaks. */
const SLUG_UNIQUE: Record<string, { message: string; code: string }> = {
  catalog_items_slug_unique: {
    message: `Another item has this address. Pick another.`,
    code: `itemSlugTaken`,
  },
  catalog_categories_slug_unique: {
    message: `Another category has this address. Pick another.`,
    code: `categorySlugTaken`,
  },
  catalog_link_sources_slug_unique: {
    message: `Another source has this utm_source. Pick another.`,
    code: `sourceSlugTaken`,
  },
}

/** `error` as `SLUG_TAKEN` when it is a slug's unique violation, else as is. */
function slugTaken(error: unknown): unknown {
  const pg = error as { code?: string; constraint_name?: string; constraint?: string }
  const taken = pg?.code === `23505`
    ? SLUG_UNIQUE[pg.constraint_name ?? pg.constraint ?? ``]
    : undefined
  return taken ? new CatalogError(`SLUG_TAKEN`, taken.message, `slug`, { code: taken.code }) : error
}

/**
 * The catalog's reads and writes for the admin app (#466). It checks no role: only the operator
 * area calls it, behind its gate. Every write runs in one transaction that locks what it changes
 * (the item, or the categories), checks the version the operator saw, and writes the operator's
 * audit row, so a write and its record are kept or undone together and two operators are served
 * one after the other.
 */
export class PostgresCatalog {
  constructor(private readonly sql: postgres.Sql) {}

  // #region Items

  /** Every item, most recently changed first. */
  async listItems(): Promise<CatalogItemRow[]> {
    const rows = await this.sql<
      (Omit<CatalogItemRow, `price` | `stock` | `publishedAt` | `updatedAt`> & {
        price: string
        combinations: number
        soldOutCount: number
        publishedAt: Date | null
        updatedAt: Date
      })[]
    >`
      SELECT i.id, i.slug, i.name, i.category_id, i.price::text AS price, i.status,
        i.published_at, i.updated_at,
        (SELECT count(*)::int FROM catalog_photos p WHERE p.item_id = i.id) AS photo_count,
        (
          SELECT p.id FROM catalog_photos p JOIN images im ON im.id = p.id
          WHERE p.item_id = i.id AND p.position = 0 AND im.refused IS NULL
            AND ${this.sql.unsafe(SHOWN)}
        ) AS cover_id,
        ${this.sql.unsafe(STOCK_COUNTS)}
      FROM catalog_items i
      ORDER BY i.updated_at DESC, i.id
      LIMIT ${CATALOG_ITEMS_MAX}
    `
    return rows.map(({ combinations, soldOutCount, ...row }) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      categoryId: row.categoryId,
      price: Number(row.price),
      status: row.status,
      stock: stockOf(Number(combinations), soldOutCount),
      coverId: row.coverId,
      photoCount: row.photoCount,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  /** One item, or `null`. */
  getItem(id: string): Promise<CatalogItem | null> {
    return readCatalogItem(this.sql, id)
  }

  /**
   * Adds an item as a draft. A create retried with the same id and fields answers the item the
   * first one made and writes nothing more; any other reuse of an id is refused.
   */
  async createItem(
    id: string,
    fields: CatalogItemFields,
    actor: CatalogActor,
  ): Promise<CatalogItem> {
    return await this.write(async (tx) => {
      // Creates wait for each other, so the count below cannot let two past the limit.
      await tx`LOCK TABLE catalog_items IN SHARE ROW EXCLUSIVE MODE`
      const first = await readCatalogItem(tx, id)
      if (first) {
        if (first.version === 1 && stable(fieldsOf(first)) === stable(fields)) return first
        throw new CatalogError(`ID_ALREADY_EXISTS`, `An item with this id exists already.`)
      }
      await checkCategory(tx, fields.categoryId)
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM catalog_items
      `
      if (count >= CATALOG_ITEMS_MAX) {
        throw new CatalogError(
          `TOO_MANY`,
          `The catalog keeps ${CATALOG_ITEMS_MAX} items at most. Delete one first.`,
        )
      }
      await tx`
        INSERT INTO catalog_items (
          id, slug, category_id, name, description, material, fit, care, price
        ) VALUES (
          ${id}, ${fields.slug}, ${fields.categoryId}, ${tx.json(fields.name)},
          ${tx.json(fields.description)}, ${tx.json(fields.material)}, ${tx.json(fields.fit)},
          ${tx.json(fields.care)}, ${fields.price}
        )
      `
      await writeParts(tx, id, fields)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.itemCreated, CATALOG_ITEM_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readCatalogItem(tx, id))!
    })
  }

  /** Saves every field of the item at `version`: its texts, price, colours, sizes and stock. */
  async updateItem(
    id: string,
    version: number,
    fields: CatalogItemFields,
    actor: CatalogActor,
  ): Promise<CatalogItem> {
    return await this.write(async (tx) => {
      const row = await currentItem(tx, id, version)
      await checkCategory(tx, fields.categoryId)
      if (row.status === `published` && fields.categoryId === null) {
        throw new CatalogError(
          `CATEGORY_REQUIRED`,
          `A published item needs a category. Pick one, or hide the item first.`,
          `categoryId`,
        )
      }
      await tx`
        UPDATE catalog_items SET
          slug = ${fields.slug}, category_id = ${fields.categoryId}, name = ${tx.json(fields.name)},
          description = ${tx.json(fields.description)}, material = ${tx.json(fields.material)},
          fit = ${tx.json(fields.fit)}, care = ${tx.json(fields.care)}, price = ${fields.price},
          updated_at = now(), version = version + 1
        WHERE id = ${id}
      `
      await writeParts(tx, id, fields)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.itemUpdated, CATALOG_ITEM_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readCatalogItem(tx, id))!
    })
  }

  /**
   * Publishes the item at `version`, or hides it. Publishing needs a category; the first publish
   * sets `published_at`, which never moves again. Only a published item can be hidden.
   */
  async setStatus(
    id: string,
    version: number,
    status: `published` | `hidden`,
    actor: CatalogActor,
  ): Promise<CatalogItem> {
    return await this.write(async (tx) => {
      const row = await currentItem(tx, id, version)
      if (status === `published` && row.categoryId === null) {
        throw new CatalogError(
          `CATEGORY_REQUIRED`,
          `Pick the item's category before you publish it.`,
          `categoryId`,
        )
      }
      if (status === `hidden` && row.status !== `published`) {
        throw new CatalogError(`NOT_PUBLISHED`, `Only a published item can be hidden.`)
      }
      if (row.status !== status) {
        await tx`
          UPDATE catalog_items SET status = ${status},
            published_at = COALESCE(published_at, now()), updated_at = now(),
            version = version + 1
          WHERE id = ${id}
        `
        const kind = status === `published`
          ? CATALOG_AUDIT_KINDS.itemPublished
          : CATALOG_AUDIT_KINDS.itemHidden
        await audit(tx, actor, kind, CATALOG_ITEM_ENTITY, id, { slug: row.slug })
      }
      return (await readCatalogItem(tx, id))!
    })
  }

  /** Deletes the item at `version`, with its colours, sizes and photos. */
  async deleteItem(id: string, version: number, actor: CatalogActor): Promise<void> {
    await this.write(async (tx) => {
      const row = await currentItem(tx, id, version)
      await tx`DELETE FROM catalog_items WHERE id = ${id}`
      await audit(tx, actor, CATALOG_AUDIT_KINDS.itemDeleted, CATALOG_ITEM_ENTITY, id, {
        slug: row.slug,
      })
    })
  }

  // #endregion

  // #region Photos

  /** Whether the item exists, before its photo's bytes are stored. */
  async hasItem(id: string): Promise<boolean> {
    const [row] = await this.sql`SELECT 1 FROM catalog_items WHERE id = ${id}`
    return row !== undefined
  }

  /**
   * Keeps the photo already stored at `objectKey` as the item's last photo and queues its
   * processing (#464), in one transaction. A photo retried with the same id answers the first one.
   * Answers `null` when the item is gone, so the caller deletes the stored bytes.
   */
  async addPhoto(
    itemId: string,
    photoId: string,
    objectKey: string,
    actor: CatalogActor,
  ): Promise<{ photo: CatalogPhoto; added: boolean } | null> {
    return await this.sql.begin(async (tx) => {
      const [item] = await tx`SELECT 1 FROM catalog_items WHERE id = ${itemId} FOR UPDATE`
      if (!item) return null
      const [first] = await tx<{ itemId: string }[]>`
        SELECT item_id FROM catalog_photos WHERE id = ${photoId}
      `
      if (first) {
        if (first.itemId !== itemId) {
          throw new CatalogError(`ID_ALREADY_EXISTS`, `A photo with this id exists already.`)
        }
        return { photo: (await readPhoto(tx, photoId))!, added: false }
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM catalog_photos WHERE item_id = ${itemId}
      `
      if (count >= CATALOG_PHOTOS_MAX) {
        throw new CatalogError(
          `TOO_MANY`,
          `An item keeps ${CATALOG_PHOTOS_MAX} photos at most. Remove one first.`,
        )
      }
      await queueImage(tx, photoId, objectKey)
      await tx`
        INSERT INTO catalog_photos (id, item_id, position)
        VALUES (${photoId}, ${itemId}, ${count})
      `
      await touch(tx, itemId)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.photoAdded, CATALOG_ITEM_ENTITY, itemId, {
        photoId,
      })
      return { photo: (await readPhoto(tx, photoId))!, added: true }
    }) as { photo: CatalogPhoto; added: boolean } | null
  }

  /** Saves what the photo shows and which colour, which must be one of the item's. */
  async updatePhoto(
    itemId: string,
    photoId: string,
    change: { alt: CatalogText; colourId: string | null },
    actor: CatalogActor,
  ): Promise<CatalogPhoto> {
    return await this.sql.begin(async (tx) => {
      await lockItem(tx, itemId)
      await photoOf(tx, itemId, photoId)
      if (change.colourId !== null) {
        const [colour] = await tx`
          SELECT 1 FROM catalog_item_colours WHERE id = ${change.colourId} AND item_id = ${itemId}
        `
        if (!colour) {
          throw new CatalogError(
            `INVALID_REQUEST`,
            `That colour is not one of this item's. Reload the page.`,
            `colourId`,
          )
        }
      }
      await tx`
        UPDATE catalog_photos SET alt = ${tx.json(change.alt)}, colour_id = ${change.colourId}
        WHERE id = ${photoId}
      `
      await touch(tx, itemId)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.photoUpdated, CATALOG_ITEM_ENTITY, itemId, {
        photoId,
      })
      return (await readPhoto(tx, photoId))!
    }) as CatalogPhoto
  }

  /**
   * Puts the item's photos in the order of `ids`, which must name each of them once; the first is
   * the cover. A list that is not the current set is refused with `ORDER_STALE`.
   */
  async reorderPhotos(
    itemId: string,
    ids: readonly string[],
    actor: CatalogActor,
  ): Promise<CatalogPhoto[]> {
    return await this.sql.begin(async (tx) => {
      await lockItem(tx, itemId)
      const rows = await tx<{ id: string }[]>`
        SELECT id FROM catalog_photos WHERE item_id = ${itemId}
      `
      assertSameSet(rows.map((row) => row.id), ids, `photos`)
      await tx`
        UPDATE catalog_photos AS photo SET position = ordered.position - 1
        FROM unnest(${tx.array([...ids])}::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE photo.id = ordered.id AND photo.position <> ordered.position - 1
      `
      await touch(tx, itemId)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.photosReordered, CATALOG_ITEM_ENTITY, itemId, {
        ids: [...ids],
      })
      return (await readCatalogItem(tx, itemId))!.photos
    }) as CatalogPhoto[]
  }

  /** Removes the photo; the ones after it move up. Its image and every width go with it. */
  async removePhoto(itemId: string, photoId: string, actor: CatalogActor): Promise<void> {
    await this.sql.begin(async (tx) => {
      await lockItem(tx, itemId)
      const position = await photoOf(tx, itemId, photoId)
      await tx`DELETE FROM catalog_photos WHERE id = ${photoId}`
      await tx`
        UPDATE catalog_photos SET position = position - 1
        WHERE item_id = ${itemId} AND position > ${position}
      `
      await touch(tx, itemId)
      await audit(tx, actor, CATALOG_AUDIT_KINDS.photoRemoved, CATALOG_ITEM_ENTITY, itemId, {
        photoId,
      })
    })
  }

  /**
   * The narrowest width of a catalog photo, for the admin's thumbnails, or its widest, for its
   * lightbox (#514); WebP first, or `null` until one is stored. `final` once every width is made,
   * so the widest no longer changes.
   */
  async photoWidth(
    photoId: string,
    which: `narrowest` | `widest`,
  ): Promise<{ objectKey: string; contentType: string; final: boolean } | null> {
    const [row] = await this.sql<{ objectKey: string; contentType: string; final: boolean }[]>`
      SELECT v.object_key, v.content_type, im.processed_at IS NOT NULL AS final
      FROM image_variants v
      JOIN catalog_photos p ON p.id = v.image_id
      JOIN images im ON im.id = v.image_id
      WHERE v.image_id = ${photoId}
      ORDER BY (v.content_type = 'image/webp') DESC,
        ${which === `widest` ? this.sql`v.width DESC` : this.sql`v.width`}
      LIMIT 1
    `
    return row ?? null
  }

  // #endregion

  // #region Categories

  /** Every category in order, with how many items each holds. */
  listCategories(): Promise<CatalogCategory[]> {
    return readCategories(this.sql)
  }

  /**
   * Adds a category after the others. A create retried with the same id and fields answers the
   * category the first one made; any other reuse of an id is refused.
   */
  async createCategory(
    id: string,
    fields: CatalogCategoryFields,
    actor: CatalogActor,
  ): Promise<CatalogCategory> {
    return await this.writeCategories(async (tx) => {
      const [first] = await tx<{ slug: string; name: CatalogText; version: number }[]>`
        SELECT slug, name, version FROM catalog_categories WHERE id = ${id}
      `
      if (first) {
        if (
          first.version === 1 && first.slug === fields.slug &&
          stable(first.name) === stable(fields.name)
        ) {
          return (await readCategories(tx, id))[0]
        }
        throw new CatalogError(`ID_ALREADY_EXISTS`, `A category with this id exists already.`)
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM catalog_categories
      `
      if (count >= CATALOG_CATEGORIES_MAX) {
        throw new CatalogError(
          `TOO_MANY`,
          `The catalog keeps ${CATALOG_CATEGORIES_MAX} categories at most. Delete one first.`,
        )
      }
      await tx`
        INSERT INTO catalog_categories (id, slug, name, position)
        VALUES (${id}, ${fields.slug}, ${tx.json(fields.name)}, ${count})
      `
      await audit(tx, actor, CATALOG_AUDIT_KINDS.categoryCreated, CATALOG_CATEGORY_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readCategories(tx, id))[0]
    })
  }

  /** Saves the category's address and name at `version`. */
  async updateCategory(
    id: string,
    version: number,
    fields: CatalogCategoryFields,
    actor: CatalogActor,
  ): Promise<CatalogCategory> {
    return await this.writeCategories(async (tx) => {
      await currentCategory(tx, id, version)
      await tx`
        UPDATE catalog_categories SET slug = ${fields.slug}, name = ${tx.json(fields.name)},
          updated_at = now(), version = version + 1
        WHERE id = ${id}
      `
      await audit(tx, actor, CATALOG_AUDIT_KINDS.categoryUpdated, CATALOG_CATEGORY_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readCategories(tx, id))[0]
    })
  }

  /** Deletes an empty category at `version`; one that holds items is refused. */
  async deleteCategory(id: string, version: number, actor: CatalogActor): Promise<void> {
    await this.writeCategories(async (tx) => {
      const row = await currentCategory(tx, id, version)
      const [held] = await tx`SELECT 1 FROM catalog_items WHERE category_id = ${id} LIMIT 1`
      if (held) {
        throw new CatalogError(
          `CATEGORY_NOT_EMPTY`,
          `Move or delete this category's items first.`,
        )
      }
      await tx`DELETE FROM catalog_categories WHERE id = ${id}`
      await tx`UPDATE catalog_categories SET position = position - 1 WHERE position > ${row.position}`
      await audit(tx, actor, CATALOG_AUDIT_KINDS.categoryDeleted, CATALOG_CATEGORY_ENTITY, id, {
        slug: row.slug,
      })
    })
  }

  /**
   * Puts the categories in the order of `ids`, which must name each once. Positions change,
   * versions do not: an edit open elsewhere still saves.
   */
  async reorderCategories(ids: readonly string[], actor: CatalogActor): Promise<CatalogCategory[]> {
    await this.writeCategories(async (tx) => {
      const rows = await tx<{ id: string }[]>`SELECT id FROM catalog_categories`
      assertSameSet(rows.map((row) => row.id), ids, `categories`)
      await tx`
        UPDATE catalog_categories AS category SET position = ordered.position - 1
        FROM unnest(${tx.array([...ids])}::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE category.id = ordered.id AND category.position <> ordered.position - 1
      `
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, details)
        VALUES (
          ${CATALOG_AUDIT_KINDS.categoriesReordered}, ${actor.userId}, ${actor.requestId},
          ${CATALOG_CATEGORY_ENTITY}, ${tx.json({ ids: [...ids] })}
        )
      `
    })
    return await this.listCategories()
  }

  /** Runs `body` in a transaction that holds the categories' write lock. */
  private async writeCategories<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
    return await this.write(async (tx) => {
      await tx`LOCK TABLE catalog_categories IN SHARE ROW EXCLUSIVE MODE`
      return await body(tx)
    })
  }

  // #endregion

  // #region Sources

  /** Every tracking link source in order, with how many items have a link for each. */
  listSources(): Promise<CatalogLinkSource[]> {
    return readSources(this.sql)
  }

  /**
   * Adds a source after the others. A create retried with the same id and fields answers the
   * source the first one made; any other reuse of an id is refused.
   */
  async createSource(
    id: string,
    fields: CatalogSourceFields,
    actor: CatalogActor,
  ): Promise<CatalogLinkSource> {
    return await this.writeSources(async (tx) => {
      const [first] = await tx<{ slug: string; name: string; version: number }[]>`
        SELECT slug, name, version FROM catalog_link_sources WHERE id = ${id}
      `
      if (first) {
        if (first.version === 1 && first.slug === fields.slug && first.name === fields.name) {
          return (await readSources(tx, id))[0]
        }
        throw new CatalogError(`ID_ALREADY_EXISTS`, `A source with this id exists already.`)
      }
      const [{ count }] = await tx<{ count: number }[]>`
        SELECT count(*)::int AS count FROM catalog_link_sources
      `
      if (count >= CATALOG_SOURCES_MAX) {
        throw new CatalogError(
          `TOO_MANY`,
          `The catalog keeps ${CATALOG_SOURCES_MAX} sources at most. Delete one first.`,
        )
      }
      await tx`
        INSERT INTO catalog_link_sources (id, slug, name, position)
        VALUES (${id}, ${fields.slug}, ${fields.name}, ${count})
      `
      await audit(tx, actor, CATALOG_AUDIT_KINDS.sourceCreated, CATALOG_SOURCE_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readSources(tx, id))[0]
    })
  }

  /**
   * Saves the source's name and `utm_source` at `version`. Its links keep their addresses and
   * carry the new `utm_source` from the next visit on.
   */
  async updateSource(
    id: string,
    version: number,
    fields: CatalogSourceFields,
    actor: CatalogActor,
  ): Promise<CatalogLinkSource> {
    return await this.writeSources(async (tx) => {
      await currentSource(tx, id, version)
      await tx`
        UPDATE catalog_link_sources SET slug = ${fields.slug}, name = ${fields.name},
          updated_at = now(), version = version + 1
        WHERE id = ${id}
      `
      await audit(tx, actor, CATALOG_AUDIT_KINDS.sourceUpdated, CATALOG_SOURCE_ENTITY, id, {
        slug: fields.slug,
      })
      return (await readSources(tx, id))[0]
    })
  }

  /** Deletes the source at `version` and its links, whose addresses then answer 404. */
  async deleteSource(id: string, version: number, actor: CatalogActor): Promise<void> {
    await this.writeSources(async (tx) => {
      const row = await currentSource(tx, id, version)
      const [{ links }] = await tx<{ links: number }[]>`
        SELECT count(*)::int AS links FROM catalog_tracking_links WHERE source_id = ${id}
      `
      await tx`DELETE FROM catalog_link_sources WHERE id = ${id}`
      await tx`
        UPDATE catalog_link_sources SET position = position - 1 WHERE position > ${row.position}
      `
      await audit(tx, actor, CATALOG_AUDIT_KINDS.sourceDeleted, CATALOG_SOURCE_ENTITY, id, {
        slug: row.slug,
        links: String(links),
      })
    })
  }

  /** Puts the sources in the order of `ids`, which must name each once. Versions do not move. */
  async reorderSources(ids: readonly string[], actor: CatalogActor): Promise<CatalogLinkSource[]> {
    await this.writeSources(async (tx) => {
      const rows = await tx<{ id: string }[]>`SELECT id FROM catalog_link_sources`
      assertSameSet(rows.map((row) => row.id), ids, `sources`)
      await tx`
        UPDATE catalog_link_sources AS source SET position = ordered.position - 1
        FROM unnest(${tx.array([...ids])}::uuid[]) WITH ORDINALITY AS ordered(id, position)
        WHERE source.id = ordered.id AND source.position <> ordered.position - 1
      `
      await tx`
        INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, details)
        VALUES (
          ${CATALOG_AUDIT_KINDS.sourcesReordered}, ${actor.userId}, ${actor.requestId},
          ${CATALOG_SOURCE_ENTITY}, ${tx.json({ ids: [...ids] })}
        )
      `
    })
    return await this.listSources()
  }

  /** Runs `body` in a transaction that holds the sources' write lock. */
  private async writeSources<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
    return await this.write(async (tx) => {
      await tx`LOCK TABLE catalog_link_sources IN SHARE ROW EXCLUSIVE MODE`
      return await body(tx)
    })
  }

  // #endregion

  // #region Tracking links

  /** The item's tracking links, one per source that has one. */
  async itemLinks(itemId: string): Promise<StoredTrackingLink[]> {
    return await this.sql<StoredTrackingLink[]>`
      SELECT ${this.sql.unsafe(LINK_COLUMNS)} FROM catalog_tracking_links l
      WHERE l.item_id = ${itemId}
      ORDER BY l.created_at, l.id
    `
  }

  /**
   * The item's link for the source, made with `id` and `code` when it has none. A second call, or
   * two at once, answer the first link: `created` says whether this call made it, and only that
   * call writes the audit row. Answers `null` when the item or the source does not exist.
   */
  async trackingLink(
    itemId: string,
    sourceId: string,
    made: { id: string; code: string },
    actor: CatalogActor,
  ): Promise<TrackingLinkMade | null> {
    return await this.sql.begin(async (tx) => {
      // The item and the source stay while the link is made; a deletion waits for this.
      const [item] = await tx<{ name: CatalogText }[]>`
        SELECT name FROM catalog_items WHERE id = ${itemId} FOR SHARE
      `
      if (!item) return null
      const [source] = await tx<{ slug: string; name: string }[]>`
        SELECT slug, name FROM catalog_link_sources WHERE id = ${sourceId} FOR SHARE
      `
      if (!source) return null
      const names = { item: item.name, source: source.name }
      const [inserted] = await tx<StoredTrackingLink[]>`
        INSERT INTO catalog_tracking_links (id, item_id, source_id, code)
        VALUES (${made.id}, ${itemId}, ${sourceId}, ${made.code})
        ON CONFLICT (item_id, source_id) DO NOTHING
        RETURNING ${tx.unsafe(LINK_COLUMNS.replaceAll(`l.`, ``))}
      `
      if (inserted) {
        await audit(tx, actor, CATALOG_AUDIT_KINDS.linkCreated, CATALOG_ITEM_ENTITY, itemId, {
          source: source.slug,
          code: made.code,
        })
        return { link: inserted, created: true, names }
      }
      const [existing] = await tx<StoredTrackingLink[]>`
        SELECT ${tx.unsafe(LINK_COLUMNS)} FROM catalog_tracking_links l
        WHERE l.item_id = ${itemId} AND l.source_id = ${sourceId}
      `
      return { link: existing, created: false, names }
    }) as TrackingLinkMade | null
  }

  /** Records that Umami holds the link, under the link's own id. */
  async markUmamiLinked(id: string): Promise<void> {
    await this.sql`UPDATE catalog_tracking_links SET umami_link_id = id WHERE id = ${id}`
  }

  // #endregion

  /** Runs `body` in a transaction, answering a slug taken by another as `SLUG_TAKEN`. */
  private async write<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.sql.begin(body) as T
    } catch (error) {
      throw slugTaken(error)
    }
  }
}

/**
 * Replaces the item's colours, sizes and sold-out combinations with `fields`'. A colour or size
 * that is gone takes its sold-out rows along, and its photos show every colour again. An id that
 * belongs to another item's colour or size is refused.
 */
async function writeParts(tx: Tx, itemId: string, fields: CatalogItemFields): Promise<void> {
  const colourIds = fields.colours.map((colour) => colour.id)
  const sizeIds = fields.sizes.map((size) => size.id)
  await tx`
    DELETE FROM catalog_item_colours
    WHERE item_id = ${itemId} AND NOT (id = ANY(${tx.array(colourIds)}::uuid[]))
  `
  await tx`
    DELETE FROM catalog_item_sizes
    WHERE item_id = ${itemId} AND NOT (id = ANY(${tx.array(sizeIds)}::uuid[]))
  `
  const foreign = () =>
    new CatalogError(
      `INVALID_REQUEST`,
      `A colour or size belongs to another item. Reload the page.`,
    )
  for (const [position, colour] of fields.colours.entries()) {
    const written = await tx`
      INSERT INTO catalog_item_colours (id, item_id, name, swatch, position)
      VALUES (${colour.id}, ${itemId}, ${tx.json(colour.name)}, ${colour.swatch}, ${position})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, swatch = EXCLUDED.swatch,
        position = EXCLUDED.position
      WHERE catalog_item_colours.item_id = EXCLUDED.item_id
      RETURNING id
    `
    if (written.length === 0) throw foreign()
  }
  for (const [position, size] of fields.sizes.entries()) {
    const written = await tx`
      INSERT INTO catalog_item_sizes (id, item_id, label, position, height_min_cm, height_max_cm,
        weight_min_kg, weight_max_kg)
      VALUES (${size.id}, ${itemId}, ${size.label}, ${position}, ${size.heightCm?.min ?? null},
        ${size.heightCm?.max ?? null}, ${size.weightKg?.min ?? null}, ${size.weightKg?.max ?? null})
      ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, position = EXCLUDED.position,
        height_min_cm = EXCLUDED.height_min_cm, height_max_cm = EXCLUDED.height_max_cm,
        weight_min_kg = EXCLUDED.weight_min_kg, weight_max_kg = EXCLUDED.weight_max_kg
      WHERE catalog_item_sizes.item_id = EXCLUDED.item_id
      RETURNING id
    `
    if (written.length === 0) throw foreign()
  }
  await tx`DELETE FROM catalog_sold_out WHERE item_id = ${itemId}`
  if (fields.soldOut.length > 0) {
    const rows = fields.soldOut.map((combination) => ({
      item_id: itemId,
      colour_id: combination.colourId,
      size_id: combination.sizeId,
    }))
    await tx`INSERT INTO catalog_sold_out ${tx(rows, `item_id`, `colour_id`, `size_id`)}`
  }
}

/** Refuses a category that does not exist. */
async function checkCategory(tx: Tx, categoryId: string | null): Promise<void> {
  if (categoryId === null) return
  const [row] = await tx`SELECT 1 FROM catalog_categories WHERE id = ${categoryId}`
  if (!row) {
    throw new CatalogError(
      `CATEGORY_NOT_FOUND`,
      `This category does not exist any more. Pick another.`,
      `categoryId`,
    )
  }
}

/**
 * Locks the item for the rest of the transaction and checks it is still at `version`. Throws
 * `ITEM_NOT_FOUND` when it is gone, or {@link CatalogVersionConflictError} with its version.
 */
async function currentItem(
  tx: Tx,
  id: string,
  version: number,
): Promise<{ slug: string; status: CatalogItemStatus; categoryId: string | null }> {
  const [row] = await tx<
    { slug: string; status: CatalogItemStatus; categoryId: string | null; version: number }[]
  >`
    SELECT slug, status, category_id, version FROM catalog_items WHERE id = ${id} FOR UPDATE
  `
  if (!row) throw new CatalogError(`ITEM_NOT_FOUND`, `This item does not exist any more.`)
  if (row.version !== version) throw new CatalogVersionConflictError(row.version)
  return row
}

/** Locks the item for a photo change, or throws `ITEM_NOT_FOUND`. */
async function lockItem(tx: Tx, id: string): Promise<void> {
  const [row] = await tx`SELECT 1 FROM catalog_items WHERE id = ${id} FOR UPDATE`
  if (!row) throw new CatalogError(`ITEM_NOT_FOUND`, `This item does not exist any more.`)
}

/** The position of the item's photo, or `PHOTO_NOT_FOUND`. */
async function photoOf(tx: Tx, itemId: string, photoId: string): Promise<number> {
  const [row] = await tx<{ position: number }[]>`
    SELECT position FROM catalog_photos WHERE id = ${photoId} AND item_id = ${itemId}
  `
  if (!row) throw new CatalogError(`PHOTO_NOT_FOUND`, `This photo does not exist any more.`)
  return row.position
}

/** Every category in order, or only `id`, with how many items each holds. */
async function readCategories(sql: postgres.Sql, id?: string): Promise<CatalogCategory[]> {
  const rows = await sql<(Omit<CatalogCategory, `createdAt` | `updatedAt`> & {
    createdAt: Date
    updatedAt: Date
  })[]>`
    SELECT c.id, c.slug, c.name, c.position, c.created_at, c.updated_at, c.version,
      (SELECT count(*)::int FROM catalog_items i WHERE i.category_id = c.id) AS item_count
    FROM catalog_categories c
    ${id === undefined ? sql`` : sql`WHERE c.id = ${id}`}
    ORDER BY c.position, c.id
  `
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    itemCount: row.itemCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }))
}

/** One photo as the admin reads it. */
async function readPhoto(sql: postgres.Sql, id: string): Promise<CatalogPhoto | null> {
  const [row] = await sql<
    (Omit<CatalogPhoto, `state`> & { shown: boolean; refused: number | null })[]
  >`
    SELECT p.id, p.colour_id, p.alt, ${sql.unsafe(SHOWN)} AS shown, im.refused
    FROM catalog_photos p JOIN images im ON im.id = p.id WHERE p.id = ${id}
  `
  if (!row) return null
  const { shown, refused, ...photo } = row
  return { ...photo, state: photoState({ shown, refused }) }
}

/** Marks the item changed, for the website's sitemap, without moving its version. */
async function touch(tx: Tx, itemId: string): Promise<void> {
  await tx`UPDATE catalog_items SET updated_at = now() WHERE id = ${itemId}`
}

/**
 * Locks the category for the rest of the transaction and checks it is still at `version`.
 */
async function currentCategory(
  tx: Tx,
  id: string,
  version: number,
): Promise<{ slug: string; position: number }> {
  const [row] = await tx<{ slug: string; position: number; version: number }[]>`
    SELECT slug, position, version FROM catalog_categories WHERE id = ${id} FOR UPDATE
  `
  if (!row) throw new CatalogError(`CATEGORY_NOT_FOUND`, `This category does not exist any more.`)
  if (row.version !== version) throw new CatalogVersionConflictError(row.version)
  return row
}

/** A tracking link as the database holds it. */
export interface StoredTrackingLink {
  id: string
  sourceId: string
  code: string
  /** Set once Umami holds the link, under the link's own id. */
  umamiLinkId: string | null
  createdAt: Date
}

/** What {@link PostgresCatalog.trackingLink} answers. */
export interface TrackingLinkMade {
  link: StoredTrackingLink
  /** Whether this call made the link. */
  created: boolean
  /** The item's and the source's names, for the link's name in Umami. */
  names: { item: CatalogText; source: string }
}

const LINK_COLUMNS = `l.id, l.source_id, l.code, l.umami_link_id, l.created_at`

async function readSources(sql: postgres.Sql, id?: string): Promise<CatalogLinkSource[]> {
  const rows = await sql<(Omit<CatalogLinkSource, `createdAt` | `updatedAt`> & {
    createdAt: Date
    updatedAt: Date
  })[]>`
    SELECT s.id, s.slug, s.name, s.position, s.created_at, s.updated_at, s.version,
      (SELECT count(*)::int FROM catalog_tracking_links l WHERE l.source_id = s.id) AS link_count
    FROM catalog_link_sources s
    ${id === undefined ? sql`` : sql`WHERE s.id = ${id}`}
    ORDER BY s.position, s.id
  `
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    position: row.position,
    linkCount: row.linkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }))
}

/** Locks the source for the rest of the transaction and checks it is still at `version`. */
async function currentSource(
  tx: Tx,
  id: string,
  version: number,
): Promise<{ slug: string; position: number }> {
  const [row] = await tx<{ slug: string; position: number; version: number }[]>`
    SELECT slug, position, version FROM catalog_link_sources WHERE id = ${id} FOR UPDATE
  `
  if (!row) throw new CatalogError(`SOURCE_NOT_FOUND`, `This source does not exist any more.`)
  if (row.version !== version) throw new CatalogVersionConflictError(row.version)
  return row
}

/** Refuses an order that does not name every one of `known` exactly once. */
function assertSameSet(known: readonly string[], ids: readonly string[], noun: string): void {
  const set = new Set(known)
  if (
    new Set(ids).size !== ids.length || ids.length !== set.size || ids.some((id) => !set.has(id))
  ) {
    throw new CatalogError(
      `ORDER_STALE`,
      `The ${noun} changed since this page loaded. Reload and try again.`,
    )
  }
}

/** Writes the operator's audit row of one change. */
async function audit(
  tx: Tx,
  actor: CatalogActor,
  kind: CatalogAuditKind,
  entityType: string,
  entityId: string,
  details: Record<string, string | string[]>,
): Promise<void> {
  await tx`
    INSERT INTO audit_events (event_kind, actor_user_id, request_id, entity_type, entity_id, details)
    VALUES (
      ${kind}, ${actor.userId}, ${actor.requestId}, ${entityType}, ${entityId}, ${tx.json(details)}
    )
  `
}
