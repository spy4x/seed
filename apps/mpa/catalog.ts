import { type } from "arktype"
import { HttpError } from "@spy4x/preact-server"
import {
  CATALOG_SLUG_PATTERN,
  catalogItemPath,
  type CatalogText,
  type PublicCatalogItem,
  type PublicCatalogPhoto,
  type PublicCatalogResponse,
} from "@domain/catalog"
import type { Language } from "@domain/identity"
import type { ResponsiveImageVariant } from "@spy4x/platform/universal/srcset"
import type { Api } from "./api.ts"
import { DEFAULT_LANGUAGE, SITE_LANGUAGES } from "./languages.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"

/** The catalog's page: every category and every published item. */
export const CATALOG_PATH = `/catalog`

/** Where the website serves the catalog's photos from its own host: `/catalog/photos/<id>/<file>`. */
export const CATALOG_PHOTOS_PATH = `/catalog/photos`

/**
 * The item page's address, the API's default of `CATALOG_ITEM_PATH` (`DEFAULT_ITEM_PATH` in
 * `libs/server/catalog/tracking.ts`), which tracking links lead to. The route that serves it is
 * `routes/[[lang]]/[category]/[slug].tsx`.
 */
const ITEM_PATH = `/{category}/{slug}`

/** A category's page in the default language: `/catalog/<category>`. */
export function categoryPath(slug: string): string {
  return `${CATALOG_PATH}/${encodeURIComponent(slug)}`
}

/** An item's page in the default language: `/<category>/<item>`. */
export function itemPath(item: { slug: string; categorySlug: string }): string {
  return catalogItemPath(ITEM_PATH, { itemSlug: item.slug, categorySlug: item.categorySlug })
}

/** The catalog page's title and description, for its `<head>`. */
export function catalogHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Catalog.title`), description: t.t(`Catalog.intro`) }
}

/** The catalog page's head in English, as the sitemap and `llms.txt` name it. */
export const CATALOG_HEAD = catalogHead(siteEnglishText())

/** A photo width's address on this website. */
export function photoUrl(photoId: string, file: string): string {
  return `${CATALOG_PHOTOS_PATH}/${photoId}/${file}`
}

const text = type(`Record<string, string>`)
const swatch = type(`/^#[0-9a-f]{6}$/`)
const photo = type({
  id: `string`,
  colourId: `string | null`,
  alt: text,
  variants: type({
    file: `string`,
    width: `number.integer > 0`,
    height: `number.integer > 0`,
    type: `string`,
  }).array(),
})
const summaryFields = {
  slug: `string`,
  categorySlug: `string`,
  name: text,
  price: `number.integer >= 0`,
  stock: `'in-stock' | 'some-sold-out' | 'sold-out'`,
  cover: photo.or(`null`),
  publishedAt: `string`,
  updatedAt: `string`,
} as const

const catalogAnswer = type({
  settings: { currency: `string`, languages: `string[] > 0` },
  categories: type({ slug: `string`, name: text }).array(),
  items: type({
    ...summaryFields,
    sizes: type({ label: `string`, soldOut: `boolean` }).array(),
    colours: type({ name: text, swatch, soldOut: `boolean` }).array(),
  }).array(),
})

const range = type({ min: `number`, max: `number` }).or(`null`)

const itemAnswer = type({
  item: {
    ...summaryFields,
    description: text,
    material: text,
    fit: text,
    care: text,
    colours: type({ id: `string`, name: text, swatch, soldOut: `boolean` }).array(),
    sizes: type({
      id: `string`,
      label: `string`,
      heightCm: range,
      weightKg: range,
      soldOut: `boolean`,
    }).array(),
    soldOut: type({ colourId: `string | null`, sizeId: `string | null` }).array(),
    photos: photo.array(),
  },
})

/**
 * The error a page throws when the catalog API did not answer what it needed: 429 when the API's
 * public read limit refused the visitor, else 502, which the error page logs.
 */
function apiFailure(status: number, path: string): HttpError {
  return new HttpError(status === 429 ? 429 : 502, `The catalog API answered ${status} for ${path}`)
}

/**
 * The settings, the categories with a published item and every published item, or `null` while
 * the catalog is off (the API answers 404). Anything else the API answers throws
 * ({@link apiFailure}).
 */
export async function readCatalog(api: Api): Promise<PublicCatalogResponse | null> {
  const path = `/api/catalog` as const
  const answer = await api.call(`GET`, path)
  if (answer.status === 404) return null
  if (answer.status === 200) {
    const body = catalogAnswer(answer.body)
    if (!(body instanceof type.errors)) return body
  }
  throw apiFailure(answer.status, path)
}

/**
 * The published item at `slug`, or `null` when there is none, or the catalog is off. Anything
 * else the API answers throws ({@link apiFailure}).
 */
export async function readItem(api: Api, slug: string): Promise<PublicCatalogItem | null> {
  if (!CATALOG_SLUG_PATTERN.test(slug)) return null
  const path = `/api/catalog/items/${slug}` as const
  const answer = await api.call(`GET`, path)
  if (answer.status === 404) return null
  if (answer.status === 200) {
    const body = itemAnswer(answer.body)
    if (!(body instanceof type.errors)) return body.item
  }
  throw apiFailure(answer.status, path)
}

/**
 * The languages a catalog page has an address in: the default one, at the address without a
 * prefix, then every other language both the website and the catalog have, such as `/de/catalog`.
 */
export function catalogLanguages(settings: { languages: readonly string[] }): Language[] {
  return SITE_LANGUAGES.filter((language) =>
    language === DEFAULT_LANGUAGE || settings.languages.includes(language)
  )
}

/**
 * A catalog text in the page's language, else in the catalog's default language, else in any
 * language it has, with the language it is in, for the element's `lang`.
 */
export function catalogText(
  value: CatalogText,
  language: string,
  settings: { languages: readonly string[] },
): { text: string; lang: string } {
  for (const tag of [language, settings.languages[0]]) {
    if (value[tag]) return { text: value[tag], lang: tag }
  }
  const [tag, found] = Object.entries(value).find(([, text]) => text !== ``) ?? [language, ``]
  return { text: found, lang: tag }
}

/** A photo's widths as `responsiveImage` takes them, AVIF first as the API sorts them. */
export function photoVariants(photo: PublicCatalogPhoto): ResponsiveImageVariant[] {
  return photo.variants.map((variant) => ({
    url: photoUrl(photo.id, variant.file),
    width: variant.width,
    height: variant.height,
    type: variant.type,
  }))
}

/**
 * The photo's widest width of the type every browser shows (the last the API lists), for the
 * structured data and the sitemap.
 */
export function photoLargest(photo: PublicCatalogPhoto): string | null {
  const last = photo.variants.at(-1)?.type
  const widest = photo.variants.filter((variant) => variant.type === last)
    .reduce<PublicCatalogPhoto[`variants`][number] | null>(
      (a, b) => (a === null || b.width > a.width ? b : a),
      null,
    )
  return widest ? photoUrl(photo.id, widest.file) : null
}

/** One catalog page as the sitemap and `llms.txt` list it. */
export interface CatalogPage {
  /** In the default language's form; {@link CatalogPage.languages} says where else it lives. */
  path: string
  /** The languages the page has an address in, the default first. */
  languages: Language[]
  /** The page's name: an item's or a category's in the catalog's default language. */
  title: string
  kind: `catalog` | `category` | `item`
  /** The newest change among the items it shows. */
  lastmod: string
  /** The photos it shows, as paths on this website: an item's cover. */
  images: string[]
}

/**
 * The catalog's page, each category's and each item's, in the catalog's order. Empty while the
 * catalog is off, has no published item, or the API cannot answer: the sitemap and `llms.txt`
 * still list the other pages then.
 */
export async function catalogPages(api: Api): Promise<CatalogPage[]> {
  let catalog: PublicCatalogResponse | null
  try {
    catalog = await readCatalog(api)
  } catch {
    return []
  }
  if (catalog === null || catalog.items.length === 0) return []
  const { settings, items } = catalog
  const languages = catalogLanguages(settings)
  const name = (value: CatalogText) => catalogText(value, settings.languages[0], settings).text
  const newest = (dates: string[]) => dates.sort().at(-1)!
  return [
    {
      path: CATALOG_PATH,
      languages,
      title: CATALOG_HEAD.title,
      kind: `catalog`,
      lastmod: newest(items.map((item) => item.updatedAt)),
      images: [],
    },
    ...catalog.categories.flatMap((category): CatalogPage[] => {
      const inside = items.filter((item) => item.categorySlug === category.slug)
      if (inside.length === 0) return []
      return [{
        path: categoryPath(category.slug),
        languages,
        title: name(category.name),
        kind: `category`,
        lastmod: newest(inside.map((item) => item.updatedAt)),
        images: [],
      }]
    }),
    ...items.map((item): CatalogPage => {
      const cover = item.cover && photoLargest(item.cover)
      return {
        path: itemPath(item),
        languages,
        title: name(item.name),
        kind: `item`,
        lastmod: item.updatedAt,
        images: cover ? [cover] : [],
      }
    }),
  ]
}
