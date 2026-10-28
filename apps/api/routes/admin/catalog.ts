import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import type postgres from "postgres"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { PayloadTooLargeError, readBoundedBody, readContentLength } from "@spy4x/net/bounded-body"
import { JSON_BODY_WRONG_TYPE, readJsonBody } from "@spy4x/server/http/bounded-body"
import { matchesContentType, SNIFF_BYTES } from "@spy4x/server/storage"
import {
  type AdminCatalogResponse,
  CATALOG_PHOTO_MAX_BYTES,
  CATALOG_PHOTO_TYPES,
  type CatalogCategory,
  catalogCategoryCreateSchema,
  type CatalogCategoryFields,
  catalogCategoryUpdateSchema,
  CatalogError,
  type CatalogItem,
  catalogItemCreateSchema,
  type CatalogItemFields,
  catalogItemStatusSchema,
  catalogItemUpdateSchema,
  type CatalogLinkSource,
  catalogOrderSchema,
  type CatalogPhoto,
  catalogPhotoObjectKey,
  catalogPhotoUpdateSchema,
  type CatalogSettings,
  catalogSourceCreateSchema,
  type CatalogSourceFields,
  catalogSourceOrderSchema,
  catalogSourceUpdateSchema,
  type CatalogText,
  catalogText,
  type CatalogTrackingLink,
  catalogTrackingLinkSchema,
  CatalogVersionConflictError,
  catalogVersionSchema,
  parseCatalogCategoryFields,
  parseCatalogItemFields,
  parseCatalogPhotoAlt,
  parseCatalogSourceFields,
} from "@domain/catalog"
import {
  type CatalogActor,
  PostgresCatalog,
  type StoredTrackingLink,
} from "@server/catalog/postgres-catalog.ts"
import {
  createUmamiLinks,
  newLinkCode,
  trackingLinkUrl,
  type TrackingSetup,
  umamiLinkName,
  type UmamiLinks,
  umamiTargetUrl,
} from "@server/catalog/tracking.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { ServerFiles } from "@server/files/files.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule } from "./module.ts"
import { codeForStatus, errorResponse } from "../../services/error-response.ts"

/** The largest JSON body a catalog route takes: an item with every colour and size it may have. */
export const CATALOG_BODY_MAX_BYTES = 256 * 1024

/** What the catalog routes call. Who may call it is the route's business. */
export interface AdminCatalogService {
  settings: CatalogSettings
  /** Whether items get tracking links: the website's address is set (#483). */
  tracking: boolean
  read(): Promise<Omit<AdminCatalogResponse, `settings` | `tracking`>>
  getItem(id: string): Promise<CatalogItem | null>
  /** The item's tracking links, one per source that has one. */
  itemLinks(itemId: string): Promise<CatalogTrackingLink[]>
  /**
   * The item's link for the source, made the first time; `null` when the item or the source does
   * not exist. Umami is asked to count it when it does not hold it yet; a failure there still
   * answers the link, which then goes straight to the item.
   */
  trackingLink(
    itemId: string,
    sourceId: string,
    actor: CatalogActor,
  ): Promise<CatalogTrackingLink | null>
  createItem(id: string, fields: CatalogItemFields, actor: CatalogActor): Promise<CatalogItem>
  updateItem(
    id: string,
    version: number,
    fields: CatalogItemFields,
    actor: CatalogActor,
  ): Promise<CatalogItem>
  setStatus(
    id: string,
    version: number,
    status: `published` | `hidden`,
    actor: CatalogActor,
  ): Promise<CatalogItem>
  deleteItem(id: string, version: number, actor: CatalogActor): Promise<void>
  /** Stores the photo's bytes and keeps it as the item's last photo, or answers `null` for no item. */
  addPhoto(
    itemId: string,
    photoId: string,
    bytes: Uint8Array,
    actor: CatalogActor,
  ): Promise<CatalogPhoto | null>
  updatePhoto(
    itemId: string,
    photoId: string,
    change: { alt: CatalogText; colourId: string | null },
    actor: CatalogActor,
  ): Promise<CatalogPhoto>
  reorderPhotos(
    itemId: string,
    ids: readonly string[],
    actor: CatalogActor,
  ): Promise<CatalogPhoto[]>
  removePhoto(itemId: string, photoId: string, actor: CatalogActor): Promise<void>
  /** The bytes and type of the photo's narrowest width, or `null` until there is one. */
  thumbnail(photoId: string): Promise<{ bytes: Uint8Array; contentType: string } | null>
  createCategory(
    id: string,
    fields: CatalogCategoryFields,
    actor: CatalogActor,
  ): Promise<CatalogCategory>
  updateCategory(
    id: string,
    version: number,
    fields: CatalogCategoryFields,
    actor: CatalogActor,
  ): Promise<CatalogCategory>
  deleteCategory(id: string, version: number, actor: CatalogActor): Promise<void>
  reorderCategories(ids: readonly string[], actor: CatalogActor): Promise<CatalogCategory[]>
  createSource(
    id: string,
    fields: CatalogSourceFields,
    actor: CatalogActor,
  ): Promise<CatalogLinkSource>
  updateSource(
    id: string,
    version: number,
    fields: CatalogSourceFields,
    actor: CatalogActor,
  ): Promise<CatalogLinkSource>
  deleteSource(id: string, version: number, actor: CatalogActor): Promise<void>
  reorderSources(ids: readonly string[], actor: CatalogActor): Promise<CatalogLinkSource[]>
}

/** What the catalog routes need. */
export interface AdminCatalogRouteDependencies {
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  catalog: AdminCatalogService
}

function invalid(message: string, field: string | null = null): CatalogError {
  return new CatalogError(`INVALID_REQUEST`, message, field)
}

/** Reads and checks the request's JSON body against `schema`; throws `INVALID_REQUEST`. */
async function readBody<T>(
  c: Context<APIContext>,
  schema: (input: unknown) => T | type.errors,
): Promise<T> {
  let refused: CatalogError | undefined
  let body: unknown
  try {
    body = await readJsonBody(c, {
      maxBytes: CATALOG_BODY_MAX_BYTES,
      requireJsonContentType: true,
      toError: ({ status }) =>
        refused = invalid(status === 415 ? JSON_BODY_WRONG_TYPE : `Request body must be JSON`),
    })
  } catch (_error) {
    throw refused ?? invalid(`Request body must be JSON`)
  }
  const checked = schema(body)
  if (checked instanceof type.errors) throw invalid(checked.summary)
  return checked
}

/** The status a refusal answers with. */
function statusOf(error: CatalogError): 400 | 404 | 409 | 413 | 415 {
  switch (error.code) {
    case `ITEM_NOT_FOUND`:
    case `PHOTO_NOT_FOUND`:
    case `SOURCE_NOT_FOUND`:
      return 404
    case `CATEGORY_NOT_FOUND`:
      // A category picked in the item's form is a bad field; one in the path does not exist.
      return error.field ? 400 : 404
    case `INVALID_REQUEST`:
    case `PHOTO_CONTENT`:
      return 400
    case `PHOTO_TYPE`:
      return 415
    case `PHOTO_TOO_LARGE`:
      return 413
    default:
      return 409
  }
}

/** The operator behind the request, for the audit row. */
function actorOf(c: Context<APIContext>): CatalogActor {
  return { userId: c.get(`auth`)!.user.id, requestId: c.get(`requestId`) ?? null }
}

/** The type of the photo in the request, or `PHOTO_TYPE`. */
function photoTypeOf(c: Context<APIContext>): string {
  const type = (c.req.header(`content-type`) ?? ``).split(`;`)[0].trim().toLowerCase()
  if (!(CATALOG_PHOTO_TYPES as readonly string[]).includes(type)) {
    throw new CatalogError(`PHOTO_TYPE`, `A photo is a JPEG, PNG, WebP or HEIC image.`)
  }
  return type
}

const TOO_LARGE = `A photo can be up to ${CATALOG_PHOTO_MAX_BYTES / 1024 / 1024} MB.`

/**
 * The catalog routes of the operator area (#466), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and every `POST` passed the
 * same-origin guard. Every change writes an audit row on the operator.
 *
 * - `GET /catalog` answers the settings, every category and every item.
 * - `GET /catalog/items/:id` is one item with its colours, sizes, stock and photos.
 * - `POST /catalog/items` adds a draft: the item's fields and a client-made UUID v7 `id`. 201.
 * - `POST /catalog/items/:id` saves every field at `version`; `/status` publishes or hides it;
 *   `/delete` deletes it.
 * - `POST /catalog/items/:id/photos?id=<photo id>` takes one photo's bytes as the body, with its
 *   type as `Content-Type` (JPEG, PNG, WebP or HEIC, up to {@link CATALOG_PHOTO_MAX_BYTES}). The
 *   bytes pass through the API: the admin host's policy lets it reach no other origin, so it
 *   cannot upload to the file store itself. They are checked against the type, stored, and
 *   processed by the worker (#464). The same photo id again answers the first photo. 201.
 * - `POST /catalog/items/:id/photos/order` takes `{ ids }`; `.../photos/:photoId` saves
 *   `{ alt, colourId }`; `.../photos/:photoId/delete` removes it.
 * - `GET /catalog/photos/:photoId/thumbnail` answers the photo's narrowest width, for the admin's
 *   lists: this host's `img-src 'self'` cannot load the file store.
 * - `POST /catalog/categories` adds one (201); `/categories/order` takes `{ ids }`;
 *   `/categories/:id` saves `{ version, slug, name }`; `/categories/:id/delete` takes `{ version }`.
 * - `POST /catalog/sources` adds a tracking link source (201); `/sources/order`, `/sources/:id` and
 *   `/sources/:id/delete` work as the categories' do (#483).
 * - `POST /catalog/items/:id/links` takes `{ sourceId }` and answers the item's link for that
 *   source, made the first time. 409 `TRACKING_OFF` while the website's address is unset.
 *
 * A refusal answers the API's error shape, with `field` when it is about one field and
 * `currentVersion` on a version conflict.
 */
export function createAdminCatalogRoutes(
  { limit, catalog }: AdminCatalogRouteDependencies,
): Hono<APIContext> {
  const languages = catalog.settings.languages
  /** The id in the path `name`, or a refusal: an id that is no UUID names nothing. */
  const idOf = (c: Context<APIContext>, name: string, notFound: CatalogError): string => {
    const id = c.req.param(name) ?? ``
    if (!isUuid(id)) throw notFound
    return id.toLowerCase()
  }
  const itemId = (c: Context<APIContext>) =>
    idOf(c, `id`, new CatalogError(`ITEM_NOT_FOUND`, `This item does not exist.`))
  const photoId = (c: Context<APIContext>) =>
    idOf(c, `photoId`, new CatalogError(`PHOTO_NOT_FOUND`, `This photo does not exist.`))
  const categoryId = (c: Context<APIContext>) =>
    idOf(c, `id`, new CatalogError(`CATEGORY_NOT_FOUND`, `This category does not exist.`))
  const sourceId = (c: Context<APIContext>) =>
    idOf(c, `id`, new CatalogError(`SOURCE_NOT_FOUND`, `This source does not exist.`))

  const route = new Hono<APIContext>()
  route.onError((error, c) => {
    if (error instanceof CatalogVersionConflictError) {
      return errorResponse(c, `conflict`, {
        message: error.message,
        reason: error.code,
        details: { currentVersion: error.currentVersion },
      })
    }
    if (error instanceof CatalogError) {
      const status = statusOf(error)
      return errorResponse(c, codeForStatus(status), {
        message: error.message,
        reason: error.code,
        status,
        ...(error.field && { details: { field: error.field } }),
      })
    }
    throw error
  })

  return route
    .get(`/catalog`, limit, async (c) => {
      const answer: AdminCatalogResponse = {
        settings: catalog.settings,
        tracking: catalog.tracking,
        ...await catalog.read(),
      }
      return c.json(answer)
    })
    .get(`/catalog/items/:id`, limit, async (c) => {
      const id = itemId(c)
      const item = await catalog.getItem(id)
      if (!item) throw new CatalogError(`ITEM_NOT_FOUND`, `This item does not exist.`)
      return c.json({ item, links: await catalog.itemLinks(id) })
    })
    .post(`/catalog/items/:id/links`, limit, async (c) => {
      const id = itemId(c)
      const { sourceId } = await readBody(c, catalogTrackingLinkSchema)
      if (!catalog.tracking) {
        throw new CatalogError(
          `TRACKING_OFF`,
          `Tracking links need the website's address. Set MPA_DOMAIN and deploy.`,
        )
      }
      const link = await catalog.trackingLink(id, sourceId.toLowerCase(), actorOf(c))
      if (!link) {
        throw new CatalogError(`SOURCE_NOT_FOUND`, `This item or source does not exist any more.`)
      }
      return c.json({ link })
    })
    .post(`/catalog/items`, limit, async (c) => {
      const { id, ...input } = await readBody(c, catalogItemCreateSchema)
      const fields = parseCatalogItemFields(input, languages)
      return c.json({ item: await catalog.createItem(id.toLowerCase(), fields, actorOf(c)) }, 201)
    })
    .post(`/catalog/items/:id`, limit, async (c) => {
      const id = itemId(c)
      const { version, ...input } = await readBody(c, catalogItemUpdateSchema)
      const fields = parseCatalogItemFields(input, languages)
      return c.json({ item: await catalog.updateItem(id, version, fields, actorOf(c)) })
    })
    .post(`/catalog/items/:id/status`, limit, async (c) => {
      const id = itemId(c)
      const { version, status } = await readBody(c, catalogItemStatusSchema)
      return c.json({ item: await catalog.setStatus(id, version, status, actorOf(c)) })
    })
    .post(`/catalog/items/:id/delete`, limit, async (c) => {
      const id = itemId(c)
      const { version } = await readBody(c, catalogVersionSchema)
      await catalog.deleteItem(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
    .post(`/catalog/items/:id/photos`, limit, async (c) => {
      const id = itemId(c)
      const photo = c.req.query(`id`) ?? ``
      if (!isUuid(photo)) throw invalid(`Name the photo with a UUID in "id".`)
      const contentType = photoTypeOf(c)
      if ((readContentLength(c.req.raw.headers) ?? 0) > CATALOG_PHOTO_MAX_BYTES) {
        throw new CatalogError(`PHOTO_TOO_LARGE`, TOO_LARGE)
      }
      let bytes: Uint8Array
      try {
        bytes = await readBoundedBody(c.req.raw, { maxBytes: CATALOG_PHOTO_MAX_BYTES })
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          throw new CatalogError(`PHOTO_TOO_LARGE`, TOO_LARGE)
        }
        throw invalid(`The photo did not arrive whole. Try again.`)
      }
      if (bytes.length === 0 || !matchesContentType(bytes.subarray(0, SNIFF_BYTES), contentType)) {
        throw new CatalogError(`PHOTO_CONTENT`, `This file is not the image its type says.`)
      }
      const added = await catalog.addPhoto(id, photo.toLowerCase(), bytes, actorOf(c))
      if (!added) throw new CatalogError(`ITEM_NOT_FOUND`, `This item does not exist any more.`)
      return c.json({ photo: added }, 201)
    })
    .post(`/catalog/items/:id/photos/order`, limit, async (c) => {
      const id = itemId(c)
      const { ids } = await readBody(c, catalogOrderSchema)
      const ordered = ids.map((one) => one.toLowerCase())
      return c.json({ photos: await catalog.reorderPhotos(id, ordered, actorOf(c)) })
    })
    .post(`/catalog/items/:id/photos/:photoId`, limit, async (c) => {
      const id = itemId(c)
      const photo = photoId(c)
      const input = await readBody(c, catalogPhotoUpdateSchema)
      const change = {
        alt: parseCatalogPhotoAlt(input.alt, languages),
        colourId: input.colourId?.toLowerCase() ?? null,
      }
      return c.json({ photo: await catalog.updatePhoto(id, photo, change, actorOf(c)) })
    })
    .post(`/catalog/items/:id/photos/:photoId/delete`, limit, async (c) => {
      await catalog.removePhoto(itemId(c), photoId(c), actorOf(c))
      return c.json({ deleted: true })
    })
    .get(`/catalog/photos/:photoId/thumbnail`, limit, async (c) => {
      const thumbnail = await catalog.thumbnail(photoId(c))
      if (!thumbnail) throw new CatalogError(`PHOTO_NOT_FOUND`, `This photo is not ready yet.`)
      return new Response(thumbnail.bytes as Uint8Array<ArrayBuffer>, {
        headers: {
          "content-type": thumbnail.contentType,
          "x-content-type-options": `nosniff`,
          "content-security-policy": `sandbox; default-src 'none'`,
          "cache-control": `private, max-age=86400`,
        },
      })
    })
    .post(`/catalog/categories`, limit, async (c) => {
      const { id, ...input } = await readBody(c, catalogCategoryCreateSchema)
      const fields = parseCatalogCategoryFields(input, languages)
      const category = await catalog.createCategory(id.toLowerCase(), fields, actorOf(c))
      return c.json({ category }, 201)
    })
    .post(`/catalog/categories/order`, limit, async (c) => {
      const { ids } = await readBody(c, catalogOrderSchema)
      const ordered = ids.map((one) => one.toLowerCase())
      return c.json({ categories: await catalog.reorderCategories(ordered, actorOf(c)) })
    })
    .post(`/catalog/categories/:id`, limit, async (c) => {
      const id = categoryId(c)
      const { version, ...input } = await readBody(c, catalogCategoryUpdateSchema)
      const fields = parseCatalogCategoryFields(input, languages)
      return c.json({ category: await catalog.updateCategory(id, version, fields, actorOf(c)) })
    })
    .post(`/catalog/categories/:id/delete`, limit, async (c) => {
      const id = categoryId(c)
      const { version } = await readBody(c, catalogVersionSchema)
      await catalog.deleteCategory(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
    .post(`/catalog/sources`, limit, async (c) => {
      const { id, ...input } = await readBody(c, catalogSourceCreateSchema)
      const fields = parseCatalogSourceFields(input)
      const source = await catalog.createSource(id.toLowerCase(), fields, actorOf(c))
      return c.json({ source }, 201)
    })
    .post(`/catalog/sources/order`, limit, async (c) => {
      const { ids } = await readBody(c, catalogSourceOrderSchema)
      const ordered = ids.map((id) => id.toLowerCase())
      return c.json({ sources: await catalog.reorderSources(ordered, actorOf(c)) })
    })
    .post(`/catalog/sources/:id`, limit, async (c) => {
      const id = sourceId(c)
      const { version, ...input } = await readBody(c, catalogSourceUpdateSchema)
      const fields = parseCatalogSourceFields(input)
      return c.json({ source: await catalog.updateSource(id, version, fields, actorOf(c)) })
    })
    .post(`/catalog/sources/:id/delete`, limit, async (c) => {
      const id = sourceId(c)
      const { version } = await readBody(c, catalogVersionSchema)
      await catalog.deleteSource(id, version, actorOf(c))
      return c.json({ deleted: true })
    })
}

/** What the service needs besides the database: the settings and the file store. */
export interface AdminCatalogSetup {
  settings: CatalogSettings
  files: Pick<ServerFiles, `put` | `delete` | `read`>
  /** How tracking links are made, or `null` while the website's address is unset (#483). */
  tracking?: TrackingSetup | null
  /** Umami, while it is set up; `null` makes links that go straight to the item. */
  umami?: UmamiLinks | null
  /** A new link's id; UUID v7. */
  newId?: () => string
}

/** The service over the app's database and file store. */
export function createAdminCatalog(
  sql: postgres.Sql,
  { settings, files, tracking = null, umami = null, newId = uuidV7 }: AdminCatalogSetup,
): AdminCatalogService {
  const repository = new PostgresCatalog(sql)
  const toLink = (site: string, link: StoredTrackingLink): CatalogTrackingLink => ({
    sourceId: link.sourceId,
    url: trackingLinkUrl(site, link.code),
    createdAt: link.createdAt.toISOString(),
  })
  return {
    settings,
    tracking: tracking !== null,
    read: async () => ({
      categories: await repository.listCategories(),
      items: await repository.listItems(),
      sources: await repository.listSources(),
    }),
    getItem: (id) => repository.getItem(id),
    async itemLinks(itemId) {
      if (tracking === null) return []
      return (await repository.itemLinks(itemId)).map((link) => toLink(tracking.siteUrl, link))
    },
    async trackingLink(itemId, sourceId, actor) {
      if (tracking === null) return null
      const made = await repository.trackingLink(
        itemId,
        sourceId,
        { id: newId(), code: newLinkCode() },
        actor,
      )
      if (!made) return null
      const { link, names } = made
      // A link made while Umami was down or unset is offered to Umami again on the next press.
      if (umami !== null && link.umamiLinkId === null) {
        const counted = await umami.create({
          id: link.id,
          name: umamiLinkName(catalogText(names.item, settings.languages), names.source),
          url: umamiTargetUrl(tracking.siteUrl, link.code),
          slug: link.code,
        })
        if (counted) await repository.markUmamiLinked(link.id)
      }
      return toLink(tracking.siteUrl, link)
    },
    createItem: (id, fields, actor) => repository.createItem(id, fields, actor),
    updateItem: (id, version, fields, actor) => repository.updateItem(id, version, fields, actor),
    setStatus: (id, version, status, actor) => repository.setStatus(id, version, status, actor),
    deleteItem: (id, version, actor) => repository.deleteItem(id, version, actor),
    async addPhoto(itemId, photoId, bytes, actor) {
      if (!await repository.hasItem(itemId)) return null
      const key = catalogPhotoObjectKey(photoId)
      // A retried upload keeps the bytes of the first: the worker made its widths from those.
      const [known] = await sql`SELECT 1 FROM catalog_photos WHERE id = ${photoId}`
      if (!known) await files.put(key, bytes)
      const forget = () => known ? Promise.resolve() : files.delete(key).catch(() => {})
      try {
        const kept = await repository.addPhoto(itemId, photoId, key, actor)
        // The item went away meanwhile: nothing points at the bytes.
        if (!kept) await forget()
        return kept?.photo ?? null
      } catch (error) {
        await forget()
        throw error
      }
    },
    updatePhoto: (itemId, photoId, change, actor) =>
      repository.updatePhoto(itemId, photoId, change, actor),
    reorderPhotos: (itemId, ids, actor) => repository.reorderPhotos(itemId, ids, actor),
    removePhoto: (itemId, photoId, actor) => repository.removePhoto(itemId, photoId, actor),
    async thumbnail(photoId) {
      const variant = await repository.photoThumbnail(photoId)
      const bytes = variant && await files.read(variant.objectKey)
      return variant && bytes ? { bytes, contentType: variant.contentType } : null
    },
    createCategory: (id, fields, actor) => repository.createCategory(id, fields, actor),
    updateCategory: (id, version, fields, actor) =>
      repository.updateCategory(id, version, fields, actor),
    deleteCategory: (id, version, actor) => repository.deleteCategory(id, version, actor),
    reorderCategories: (ids, actor) => repository.reorderCategories(ids, actor),
    createSource: (id, fields, actor) => repository.createSource(id, fields, actor),
    updateSource: (id, version, fields, actor) =>
      repository.updateSource(id, version, fields, actor),
    deleteSource: (id, version, actor) => repository.deleteSource(id, version, actor),
    reorderSources: (ids, actor) => repository.reorderSources(ids, actor),
  }
}

/**
 * The catalog module (#466): the shop's categories and items, as the website shows them. Its
 * routes exist only with `CATALOG=true`; off, the admin app shows no Catalog entry.
 */
export const catalogAdminModule: AdminApiModule = {
  id: `catalog`,
  enabled: ({ catalog }) => catalog.on,
  routes: ({ sql, limit, catalog, files }) =>
    createAdminCatalogRoutes({
      limit,
      catalog: createAdminCatalog(sql, {
        settings: catalog.settings,
        files,
        tracking: catalog.tracking ?? null,
        umami: catalog.tracking?.umami ? createUmamiLinks(catalog.tracking.umami) : null,
      }),
    }),
}
