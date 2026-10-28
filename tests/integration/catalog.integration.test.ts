/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  CATALOG_AUDIT_KINDS,
  CATALOG_PHOTOS_MAX,
  CatalogError,
  type CatalogItemFields,
  catalogPhotoObjectKey,
  CatalogVersionConflictError,
} from "@domain/catalog"
import { type CatalogActor, PostgresCatalog } from "@server/catalog/postgres-catalog.ts"
import {
  readPublicCatalog,
  readPublicItem,
  readPublicPhotoFile,
  readTrackingTarget,
} from "@server/catalog/public-catalog.ts"
import { SAMPLE_CATALOG_SOURCES, seedSampleCatalog } from "@server/catalog/sample-catalog.ts"
import type { UmamiLinks } from "@server/catalog/tracking.ts"
import { IMAGE_PROCESS_JOB } from "@server/files/images.ts"
import { createAdminCatalog } from "../../apps/api/routes/admin/catalog.ts"
import { applyMigrations } from "./migrations.ts"

/**
 * The catalog (#466) against a real Postgres with every migration applied: the admin's writes and
 * their audit rows, the version check, retried creates, colours, sizes and sold-out sizes, photos
 * and their images, categories, and what the public website may read.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `catalog_test_${uuidV7().replaceAll(`-`, ``)}`
  const sql = postgres({
    ...settings,
    max: 5,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    await applyMigrations(sql)
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

async function operator(sql: postgres.Sql): Promise<CatalogActor> {
  const [{ id }] = await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id, first_name, last_name, role)
    SELECT id, 'Maya', 'Chen', 3 FROM auth_user RETURNING id
  `
  return { userId: id, requestId: `req-${id}` }
}

async function auditKinds(sql: postgres.Sql): Promise<string[]> {
  const rows = await sql<{ eventKind: string }[]>`
    SELECT event_kind FROM audit_events WHERE entity_type LIKE 'catalog_%' ORDER BY id
  `
  return rows.map((row) => row.eventKind)
}

/** An item's fields: two colours, two sizes, the red S sold out. */
function jacket(patch: Partial<CatalogItemFields> = {}) {
  const red = uuidV7()
  const blue = uuidV7()
  const small = uuidV7()
  const medium = uuidV7()
  const fields: CatalogItemFields = {
    slug: `zip-jacket`,
    categoryId: null,
    name: { en: `Zip jacket`, vi: `Áo khoác zip` },
    description: { en: `Warm.` },
    material: {},
    fit: {},
    care: {},
    price: 450_000,
    colours: [
      { id: red, name: { en: `Red` }, swatch: `#aa0000` },
      { id: blue, name: { en: `Blue` }, swatch: `#0000aa` },
    ],
    sizes: [
      {
        id: small,
        label: `S`,
        heightCm: { min: 150, max: 162 },
        weightKg: { min: 40, max: 52 },
      },
      { id: medium, label: `M`, heightCm: null, weightKg: null },
    ],
    soldOut: [{ colourId: red, sizeId: small }],
    ...patch,
  }
  return { fields, red, blue, small, medium }
}

/** Marks the photo processed, with one AVIF and one WebP width, as the worker would. */
async function process(sql: postgres.Sql, photoId: string): Promise<void> {
  const key = catalogPhotoObjectKey(photoId)
  await sql`UPDATE images SET processed_at = now() WHERE id = ${photoId}`
  await sql`
    INSERT INTO image_variants (object_key, image_id, content_type, width, height) VALUES
      (${`${key}/480.webp`}, ${photoId}, 'image/webp', 480, 640),
      (${`${key}/480.avif`}, ${photoId}, 'image/avif', 480, 640)
  `
}

/** The code of the {@link CatalogError} `run` rejects with. */
async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (error instanceof CatalogError) return error.code
    throw error
  }
  throw new Error(`nothing was refused`)
}

Deno.test(`an item keeps its colours, sizes and sold-out sizes, with one audit row`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const { fields } = jacket()
    const id = uuidV7()
    const item = await catalog.createItem(id, fields, actor)
    expect(item).toMatchObject({ ...fields, id, status: `draft`, publishedAt: null, version: 1 })
    expect(await auditKinds(sql)).toEqual([CATALOG_AUDIT_KINDS.itemCreated])

    // A retry with the same fields answers the same item and writes nothing more.
    expect(await catalog.createItem(id, fields, actor)).toEqual(item)
    expect(await auditKinds(sql)).toHaveLength(1)
    expect(await refusal(() => catalog.createItem(id, { ...fields, price: 1 }, actor))).toBe(
      `ID_ALREADY_EXISTS`,
    )
    expect(await refusal(() => catalog.createItem(uuidV7(), jacket().fields, actor))).toBe(
      `SLUG_TAKEN`,
    )

    const [row] = await catalog.listItems()
    expect(row).toMatchObject({ id, stock: `some-sold-out`, photoCount: 0, coverId: null })
  })
})

Deno.test(`a save names the version it saw, and keeps only the sold-out sizes it was sent`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const { fields, blue, small } = jacket()
    const item = await catalog.createItem(uuidV7(), fields, actor)
    const photo = uuidV7()
    await catalog.addPhoto(item.id, photo, catalogPhotoObjectKey(photo), actor)
    await catalog.updatePhoto(item.id, photo, { alt: {}, colourId: fields.colours[0].id }, actor)

    const onlyBlue = {
      ...fields,
      colours: fields.colours.filter((colour) => colour.id === blue),
      soldOut: [{ colourId: blue, sizeId: small }],
    }
    const saved = await catalog.updateItem(item.id, 1, onlyBlue, actor)
    expect(saved.version).toBe(2)
    expect(saved.colours.map((colour) => colour.id)).toEqual([blue])
    expect(saved.soldOut).toEqual([{ colourId: blue, sizeId: small }])
    // The photo showed the removed colour: it now shows every colour.
    expect(saved.photos[0].colourId).toBeNull()
    const restocked = await catalog.updateItem(item.id, 2, { ...onlyBlue, soldOut: [] }, actor)
    expect(restocked.soldOut).toEqual([])

    await expect(catalog.updateItem(item.id, 1, onlyBlue, actor)).rejects.toThrow(
      CatalogVersionConflictError,
    )
    // Another item's colour id is never taken over.
    const other = await catalog.createItem(uuidV7(), jacket({ slug: `other` }).fields, actor)
    const stolen = { ...onlyBlue, colours: [{ ...other.colours[0] }], soldOut: [] }
    expect(await refusal(() => catalog.updateItem(item.id, 3, stolen, actor))).toBe(
      `INVALID_REQUEST`,
    )
    expect((await catalog.getItem(other.id))!.colours).toEqual(other.colours)
  })
})

Deno.test(`publishing needs a category, sets the first publish time once, and hides`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    expect(await refusal(() => catalog.setStatus(item.id, 1, `published`, actor))).toBe(
      `CATEGORY_REQUIRED`,
    )
    expect(await refusal(() => catalog.setStatus(item.id, 1, `hidden`, actor))).toBe(
      `NOT_PUBLISHED`,
    )

    const category = await catalog.createCategory(uuidV7(), {
      slug: `jackets`,
      name: { en: `Jackets` },
    }, actor)
    const filed = await catalog.updateItem(
      item.id,
      1,
      jacket({ categoryId: category.id }).fields,
      actor,
    )
    const published = await catalog.setStatus(item.id, filed.version, `published`, actor)
    expect(published.status).toBe(`published`)
    expect(published.publishedAt).not.toBeNull()

    const hidden = await catalog.setStatus(item.id, published.version, `hidden`, actor)
    const again = await catalog.setStatus(item.id, hidden.version, `published`, actor)
    expect(again.publishedAt).toBe(published.publishedAt)
    expect(
      await refusal(() =>
        catalog.updateItem(item.id, again.version, jacket({ categoryId: null }).fields, actor)
      ),
    ).toBe(`CATEGORY_REQUIRED`)
    expect(await refusal(() => catalog.deleteCategory(category.id, 1, actor))).toBe(
      `CATEGORY_NOT_EMPTY`,
    )
    expect((await auditKinds(sql)).filter((kind) => kind.startsWith(`catalog.item_`))).toEqual([
      CATALOG_AUDIT_KINDS.itemCreated,
      CATALOG_AUDIT_KINDS.itemUpdated,
      CATALOG_AUDIT_KINDS.itemPublished,
      CATALOG_AUDIT_KINDS.itemHidden,
      CATALOG_AUDIT_KINDS.itemPublished,
    ])
  })
})

Deno.test(`a photo queues its processing, keeps its order, and takes its image when removed`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    const [a, b, c] = [uuidV7(), uuidV7(), uuidV7()]
    for (const id of [a, b, c]) {
      const added = await catalog.addPhoto(item.id, id, catalogPhotoObjectKey(id), actor)
      expect(added).toMatchObject({ added: true, photo: { id, state: `preparing` } })
    }
    // A retried upload answers the photo it made.
    expect(await catalog.addPhoto(item.id, a, catalogPhotoObjectKey(a), actor)).toMatchObject({
      added: false,
    })
    const jobs = await sql<{ aggregateId: string }[]>`
      SELECT aggregate_id FROM outbox_events WHERE event_kind = ${IMAGE_PROCESS_JOB}
    `
    expect(jobs.map((job) => job.aggregateId).sort()).toEqual([a, b, c].sort())

    const reordered = await catalog.reorderPhotos(item.id, [c, a, b], actor)
    expect(reordered.map((photo) => photo.id)).toEqual([c, a, b])
    expect(await refusal(() => catalog.reorderPhotos(item.id, [c, a], actor))).toBe(`ORDER_STALE`)

    await process(sql, c)
    expect((await catalog.listItems())[0]).toMatchObject({ coverId: c, photoCount: 3 })
    expect(await catalog.photoThumbnail(c)).toEqual({
      objectKey: `${catalogPhotoObjectKey(c)}/480.webp`,
      contentType: `image/webp`,
    })

    await catalog.removePhoto(item.id, c, actor)
    expect((await catalog.getItem(item.id))!.photos.map((photo) => photo.id)).toEqual([a, b])
    const [image] = await sql`SELECT 1 FROM images WHERE id = ${c}`
    expect(image).toBeUndefined()
    const queued = await sql<{ objectKey: string }[]>`
      SELECT object_key FROM file_deletions ORDER BY object_key
    `
    expect(queued.map((row) => row.objectKey)).toEqual([
      catalogPhotoObjectKey(c),
      `${catalogPhotoObjectKey(c)}/480.avif`,
      `${catalogPhotoObjectKey(c)}/480.webp`,
    ])

    // Deleting the item takes the rest of its photos and their images along.
    const { version } = (await catalog.getItem(item.id))!
    await catalog.deleteItem(item.id, version, actor)
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM images`
    expect(count).toBe(0)
  })
})

Deno.test(`an item keeps ${CATALOG_PHOTOS_MAX} photos at most`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    for (let n = 0; n < CATALOG_PHOTOS_MAX; n++) {
      const id = uuidV7()
      await catalog.addPhoto(item.id, id, catalogPhotoObjectKey(id), actor)
    }
    const extra = uuidV7()
    expect(
      await refusal(() => catalog.addPhoto(item.id, extra, catalogPhotoObjectKey(extra), actor)),
    ).toBe(`TOO_MANY`)
    expect(await catalog.addPhoto(uuidV7(), extra, catalogPhotoObjectKey(extra), actor)).toBeNull()
  })
})

Deno.test(`an uploaded photo's bytes are stored once, and deleted when the photo is not kept`, async () => {
  await withSchema(async (sql) => {
    const stored: string[] = []
    const deleted: string[] = []
    const files = {
      put: (key: string) => (stored.push(key), Promise.resolve()),
      delete: (key: string) => (deleted.push(key), Promise.resolve()),
      read: () => Promise.resolve(null),
    }
    const settings = { currency: `USD`, languages: [`en`, `vi`] }
    const catalog = createAdminCatalog(sql, { settings, files })
    const actor = await operator(sql)
    const bytes = new Uint8Array([1])
    const first = uuidV7()

    expect(await catalog.addPhoto(uuidV7(), first, bytes, actor)).toBeNull()
    expect(stored).toEqual([])

    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    expect(await catalog.addPhoto(item.id, first, bytes, actor)).toMatchObject({ id: first })
    // A retry answers the same photo and leaves the first bytes alone.
    expect(await catalog.addPhoto(item.id, first, bytes, actor)).toMatchObject({ id: first })
    expect({ stored, deleted }).toEqual({ stored: [catalogPhotoObjectKey(first)], deleted: [] })

    for (let n = 1; n < CATALOG_PHOTOS_MAX; n++) {
      await catalog.addPhoto(item.id, uuidV7(), bytes, actor)
    }
    const extra = uuidV7()
    stored.length = 0
    await expect(catalog.addPhoto(item.id, extra, bytes, actor)).rejects.toThrow(CatalogError)
    expect({ stored, deleted }).toEqual({
      stored: [catalogPhotoObjectKey(extra)],
      deleted: [catalogPhotoObjectKey(extra)],
    })
  })
})

Deno.test(`categories keep their order, and an empty one can be deleted`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const ids = [uuidV7(), uuidV7(), uuidV7()]
    for (const [n, id] of ids.entries()) {
      await catalog.createCategory(id, { slug: `c-${n}`, name: { en: `C ${n}` } }, actor)
    }
    expect(
      await refusal(() =>
        catalog.createCategory(uuidV7(), { slug: `c-0`, name: { en: `Again` } }, actor)
      ),
    ).toBe(`SLUG_TAKEN`)
    const reordered = await catalog.reorderCategories([ids[2], ids[0], ids[1]], actor)
    expect(reordered.map((category) => [category.id, category.position])).toEqual([
      [ids[2], 0],
      [ids[0], 1],
      [ids[1], 2],
    ])
    await catalog.deleteCategory(ids[2], 1, actor)
    expect((await catalog.listCategories()).map((category) => category.position)).toEqual([0, 1])
    await expect(catalog.updateCategory(ids[0], 2, { slug: `c-0`, name: { en: `C` } }, actor))
      .rejects.toThrow(CatalogVersionConflictError)
  })
})

Deno.test(`the website reads published items only, with the photos that are ready`, async () => {
  await withSchema(async (sql) => {
    const catalog = new PostgresCatalog(sql)
    const actor = await operator(sql)
    const category = await catalog.createCategory(uuidV7(), {
      slug: `jackets`,
      name: { en: `Jackets` },
    }, actor)
    const empty = await catalog.createCategory(uuidV7(), {
      slug: `empty`,
      name: { en: `Empty` },
    }, actor)
    const live = await catalog.createItem(
      uuidV7(),
      jacket({ categoryId: category.id }).fields,
      actor,
    )
    await catalog.setStatus(live.id, 1, `published`, actor)
    const draft = await catalog.createItem(
      uuidV7(),
      jacket({ slug: `draft`, categoryId: empty.id }).fields,
      actor,
    )
    const [ready, waiting, drafted, later] = [uuidV7(), uuidV7(), uuidV7(), uuidV7()]
    await catalog.addPhoto(live.id, waiting, catalogPhotoObjectKey(waiting), actor)
    await catalog.addPhoto(live.id, ready, catalogPhotoObjectKey(ready), actor)
    await catalog.addPhoto(live.id, later, catalogPhotoObjectKey(later), actor)
    await catalog.addPhoto(draft.id, drafted, catalogPhotoObjectKey(drafted), actor)
    await process(sql, ready)
    await process(sql, drafted)
    await process(sql, later)

    const settings = { currency: `VND`, languages: [`vi`, `en`] }
    const site = await readPublicCatalog(sql, settings)
    expect(site.settings).toEqual(settings)
    expect(site.categories).toEqual([{ slug: `jackets`, name: { en: `Jackets` } }])
    expect(site.items.map((item) => item.slug)).toEqual([`zip-jacket`])
    expect(site.items[0]).toMatchObject({
      categorySlug: `jackets`,
      price: 450_000,
      stock: `some-sold-out`,
      cover: {
        id: ready,
        variants: [
          { file: `480.avif`, width: 480, height: 640, type: `image/avif` },
          { file: `480.webp`, width: 480, height: 640, type: `image/webp` },
        ],
      },
    })
    expect(JSON.stringify(site)).not.toContain(live.id)

    const page = await readPublicItem(sql, `zip-jacket`)
    expect(page?.photos.map((photo) => photo.id)).toEqual([ready, later])
    expect(page?.sizes.map((size) => size.label)).toEqual([`S`, `M`])
    expect(await readPublicItem(sql, `draft`)).toBeNull()

    expect(await readPublicPhotoFile(sql, ready, `480.webp`)).toEqual({
      objectKey: `${catalogPhotoObjectKey(ready)}/480.webp`,
      contentType: `image/webp`,
    })
    expect(await readPublicPhotoFile(sql, drafted, `480.webp`)).toBeNull()
    expect(await readPublicPhotoFile(sql, ready, `../480.webp`)).toBeNull()

    await catalog.setStatus(live.id, 2, `hidden`, actor)
    expect((await readPublicCatalog(sql, settings)).items).toEqual([])
    expect(await readPublicPhotoFile(sql, ready, `480.webp`)).toBeNull()
  })
})

Deno.test(`the sample catalog seeds once, with five published items`, async () => {
  await withSchema(async (sql) => {
    await seedSampleCatalog(sql)
    await seedSampleCatalog(sql)
    const catalog = new PostgresCatalog(sql)
    const items = await catalog.listItems()
    expect(items).toHaveLength(6)
    expect(items.filter((item) => item.status === `published`)).toHaveLength(5)
    expect(items.filter((item) => item.stock === `sold-out`)).toHaveLength(1)
    expect(await catalog.listCategories()).toHaveLength(3)
    expect(await catalog.listSources()).toHaveLength(SAMPLE_CATALOG_SOURCES.length)
  })
})

Deno.test(`sources keep their order and utm_source, and a deleted one takes its links`, async () => {
  await withSchema(async (sql) => {
    const actor = await operator(sql)
    const catalog = new PostgresCatalog(sql)
    const [zalo, insta] = [uuidV7(), uuidV7()]
    await catalog.createSource(zalo, { name: `Zalo group A`, slug: `zalo-a` }, actor)
    // A retried create answers the first; another source with the same utm_source is refused.
    await catalog.createSource(zalo, { name: `Zalo group A`, slug: `zalo-a` }, actor)
    await catalog.createSource(insta, { name: `Instagram`, slug: `instagram` }, actor)
    await expect(catalog.createSource(uuidV7(), { name: `Again`, slug: `zalo-a` }, actor))
      .rejects.toMatchObject({ code: `SLUG_TAKEN`, field: `slug` })
    const reordered = await catalog.reorderSources([insta, zalo], actor)
    expect(reordered.map((source) => [source.slug, source.position])).toEqual([
      [`instagram`, 0],
      [`zalo-a`, 1],
    ])
    const saved = await catalog.updateSource(
      zalo,
      1,
      { name: `Zalo group B`, slug: `zalo-b` },
      actor,
    )
    expect(saved).toMatchObject({ name: `Zalo group B`, slug: `zalo-b`, version: 2 })
    await expect(catalog.updateSource(zalo, 1, { name: `x`, slug: `x` }, actor)).rejects
      .toBeInstanceOf(CatalogVersionConflictError)

    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    await catalog.trackingLink(item.id, zalo, { id: uuidV7(), code: `AbCdEfGh_-1` }, actor)
    await catalog.deleteSource(zalo, 2, actor)
    expect((await catalog.listSources()).map((source) => [source.slug, source.position])).toEqual([
      [`instagram`, 0],
    ])
    expect(await catalog.itemLinks(item.id)).toEqual([])
    expect((await auditKinds(sql)).filter((kind) => kind.includes(`source`))).toEqual([
      CATALOG_AUDIT_KINDS.sourceCreated,
      CATALOG_AUDIT_KINDS.sourceCreated,
      CATALOG_AUDIT_KINDS.sourcesReordered,
      CATALOG_AUDIT_KINDS.sourceUpdated,
      CATALOG_AUDIT_KINDS.sourceDeleted,
    ])
  })
})

Deno.test(`"Copy link" makes one link per item and source, however often it is pressed`, async () => {
  await withSchema(async (sql) => {
    const actor = await operator(sql)
    const catalog = new PostgresCatalog(sql)
    const source = uuidV7()
    await catalog.createSource(source, { name: `Zalo group A`, slug: `zalo-a` }, actor)
    const item = await catalog.createItem(uuidV7(), jacket().fields, actor)
    const created: { id: string; name: string; url: string; slug: string }[] = []
    let umamiUp = false
    const umami: UmamiLinks = {
      create: (link) => {
        created.push(link)
        return Promise.resolve(umamiUp)
      },
      address: (slug) => `https://stats.example/q/${slug}`,
      isUp: () => Promise.resolve(true),
    }
    const service = createAdminCatalog(sql, {
      settings: { currency: `VND`, languages: [`en`] },
      files: {
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        read: () => Promise.resolve(null),
      },
      tracking: { siteUrl: `https://shop.example`, itemPath: `/{category}/{slug}`, umami: null },
      umami,
    })

    // Two presses at once, then one more: one row, one audit row, one address.
    const answers = await Promise.all([
      service.trackingLink(item.id, source, actor),
      service.trackingLink(item.id, source, actor),
    ])
    answers.push(await service.trackingLink(item.id, source, actor))
    const urls = new Set(answers.map((answer) => answer?.url))
    expect(urls.size).toBe(1)
    const url = [...urls][0]!
    expect(url).toMatch(/^https:\/\/shop\.example\/s\/[A-Za-z0-9_-]{11}$/)
    const [{ rows }] = await sql<{ rows: number }[]>`
      SELECT count(*)::int AS rows FROM catalog_tracking_links
    `
    expect(rows).toBe(1)
    expect((await auditKinds(sql)).filter((kind) => kind === CATALOG_AUDIT_KINDS.linkCreated))
      .toHaveLength(1)

    // Umami was down for those presses: each offered it the link again, with the link's own id.
    const code = url.split(`/s/`)[1]
    expect(created).toHaveLength(3)
    expect(new Set(created.map((link) => link.id)).size).toBe(1)
    expect(created[0]).toMatchObject({
      name: `Zip jacket · Zalo group A`,
      url: `https://shop.example/s/${code}?counted=1`,
      slug: code,
    })
    // Once Umami holds it, the link says so and Umami is not asked again.
    umamiUp = true
    await service.trackingLink(item.id, source, actor)
    await service.trackingLink(item.id, source, actor)
    expect(created).toHaveLength(4)
    const [stored] = await catalog.itemLinks(item.id)
    expect(stored.umamiLinkId).toBe(stored.id)
    expect(await service.itemLinks(item.id)).toEqual([
      { sourceId: source, url, createdAt: stored.createdAt.toISOString() },
    ])

    // A source or item that is gone makes no link.
    expect(await service.trackingLink(item.id, uuidV7(), actor)).toBeNull()
    expect(await service.trackingLink(uuidV7(), source, actor)).toBeNull()
  })
})

Deno.test(`a link leads only to a published item, by the item's own slug`, async () => {
  await withSchema(async (sql) => {
    const actor = await operator(sql)
    const catalog = new PostgresCatalog(sql)
    const category = uuidV7()
    await catalog.createCategory(category, { slug: `jackets`, name: { en: `Jackets` } }, actor)
    const source = uuidV7()
    await catalog.createSource(source, { name: `Friends`, slug: `friends` }, actor)
    const item = await catalog.createItem(uuidV7(), jacket({ categoryId: category }).fields, actor)
    const code = `AbCdEfGh_-1`
    await catalog.trackingLink(item.id, source, { id: uuidV7(), code }, actor)

    expect(await readTrackingTarget(sql, code)).toBeNull()
    const published = await catalog.setStatus(item.id, item.version, `published`, actor)
    expect(await readTrackingTarget(sql, code)).toEqual({
      code,
      umamiLinkId: null,
      itemSlug: `zip-jacket`,
      categorySlug: `jackets`,
      sourceSlug: `friends`,
    })
    expect(await readTrackingTarget(sql, `ZZZZZZZZZZZ`)).toBeNull()
    await catalog.setStatus(item.id, published.version, `hidden`, actor)
    expect(await readTrackingTarget(sql, code)).toBeNull()
  })
})
