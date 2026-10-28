import { type } from "arktype"
import { isHexColor } from "@spy4x/platform/universal/color"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { UUID_PATTERN } from "@spy4x/platform/universal/uuid"

/**
 * The catalog (#466): categories and items with colours, sizes and photos, which an operator edits
 * in the admin app and the public website shows. A shop, a menu, a rental list or a portfolio
 * starts from it. Every text a visitor reads is kept per language of the catalog; the price is a
 * whole number of the smallest unit of the one currency the catalog is set to. `docs/catalog.md`
 * walks through it; the SQL is `libs/server/catalog/`.
 *
 * @module
 */

// #region Limits
// Each matches its column in migration `2026_12_07_0001_catalog.sql`, counted in characters (an
// emoji is one), as Postgres counts a VARCHAR.

/** The longest address part of an item or a category. */
export const CATALOG_SLUG_MAX_LENGTH = 100
/** An item's or a category's name, in one language. */
export const CATALOG_NAME_MAX_LENGTH = 200
/** An item's description, in one language. */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 5000
/** An item's material, fit or care line, in one language. */
export const CATALOG_DETAIL_MAX_LENGTH = 500
/** A colour's name, in one language. */
export const CATALOG_COLOUR_NAME_MAX_LENGTH = 60
/** A size's label, such as `M` or `Free size`. */
export const CATALOG_SIZE_LABEL_MAX_LENGTH = 40
/** What a photo shows, for people who cannot see it, in one language. */
export const CATALOG_ALT_MAX_LENGTH = 300
export const CATALOG_COLOURS_MAX = 20
export const CATALOG_SIZES_MAX = 20
export const CATALOG_PHOTOS_MAX = 20
export const CATALOG_CATEGORIES_MAX = 100
/** The most items the catalog keeps: its lists have no pages. */
export const CATALOG_ITEMS_MAX = 1000
/** The highest price, in the currency's smallest unit: room for any currency's real prices. */
export const CATALOG_PRICE_MAX = 1_000_000_000_000
/** The most languages a catalog keeps its texts in. */
export const CATALOG_LANGUAGES_MAX = 10
/** A tracking link source's name, such as `Zalo group A` (#483). */
export const CATALOG_SOURCE_NAME_MAX_LENGTH = 60
/** The most sources the catalog keeps: one per place the shop shares its items in. */
export const CATALOG_SOURCES_MAX = 50

/** The photos the admin uploads: what a phone takes, iPhone HEIC included. */
export const CATALOG_PHOTO_TYPES = [`image/jpeg`, `image/png`, `image/webp`, `image/heic`] as const
/** The largest photo taken: 20 MiB, room for a phone's full-size photo. Only its widths are kept. */
export const CATALOG_PHOTO_MAX_BYTES = 20 * 1024 * 1024

/** A slug: lowercase letters and digits in words joined by single hyphens. */
export const CATALOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// #endregion

// #region Settings

/**
 * How a product's catalog is set up (`CATALOG_CURRENCY`, `CATALOG_LANGUAGES`): the currency every
 * price is in, and the languages its texts are kept in, the default one first. A visitor whose
 * language lacks a text reads the default language's.
 */
export interface CatalogSettings {
  /** An ISO 4217 code, such as `USD` or `VND`. */
  currency: string
  /** BCP 47 tags, the default first, such as `["vi", "en"]`. */
  languages: string[]
}

/** The settings of a catalog that sets nothing: US dollars, English. */
export const CATALOG_DEFAULT_SETTINGS: CatalogSettings = { currency: `USD`, languages: [`en`] }

/**
 * Checks a currency code: three capital letters that `Intl` formats as a currency. Throws an
 * `Error` naming the setting.
 */
export function parseCatalogCurrency(value: string): string {
  const code = value.trim().toUpperCase()
  let known = /^[A-Z]{3}$/.test(code)
  try {
    if (known) new Intl.NumberFormat(`en`, { style: `currency`, currency: code })
  } catch {
    known = false
  }
  if (!known) throw new Error(`CATALOG_CURRENCY must be a currency code such as USD or VND`)
  return code
}

/**
 * Checks a comma-separated list of language tags, the default first: each canonical, none
 * twice, one to {@link CATALOG_LANGUAGES_MAX}. Throws an `Error` naming the setting.
 */
export function parseCatalogLanguages(value: string): string[] {
  const fail = (): never => {
    throw new Error(
      `CATALOG_LANGUAGES must be language tags separated by commas, the default first, such as vi,en`,
    )
  }
  const tags = value.split(`,`).map((tag) => tag.trim()).filter((tag) => tag !== ``)
  if (tags.length === 0 || tags.length > CATALOG_LANGUAGES_MAX) fail()
  let canonical: string[] = []
  try {
    canonical = Intl.getCanonicalLocales(tags)
  } catch {
    fail()
  }
  if (canonical.length !== tags.length) fail()
  return canonical
}

/** The language a tag names, in that language, for the admin's field labels: `vi` → `Tiếng Việt`. */
export function catalogLanguageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: `language` }).of(tag)
    if (!name) return tag
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
  } catch {
    return tag
  }
}

// #endregion

// #region Shapes

/** One text in each language that has it, by language tag: `{ en: "Brown zip jacket" }`. */
export type CatalogText = Record<string, string>

/**
 * Where an item stands. A draft has never been on the website; a published item is; a hidden one
 * was, and is taken off without losing its address or its first publish date.
 */
export type CatalogItemStatus = `draft` | `published` | `hidden`

export const CATALOG_ITEM_STATUSES: readonly CatalogItemStatus[] = [`draft`, `published`, `hidden`]

/** One colour an item comes in, with the swatch the website draws. */
export interface CatalogColour {
  id: string
  name: CatalogText
  /** `#rrggbb`, lower case. */
  swatch: string
}

/** An inclusive range of whole numbers, such as heights of 160 to 170 cm. */
export interface CatalogRange {
  min: number
  max: number
}

/** The tallest height a size chart takes, in centimetres. */
export const CATALOG_HEIGHT_MAX_CM = 250
/** The heaviest weight a size chart takes, in kilograms. */
export const CATALOG_WEIGHT_MAX_KG = 300

/**
 * One size an item comes in, such as `M` or `Free size`, with the heights and weights it fits
 * when the item has a size chart: the size calculator's input (`recommendSize`).
 */
export interface CatalogSize {
  id: string
  label: string
  heightCm: CatalogRange | null
  weightKg: CatalogRange | null
}

/**
 * One colour and size of an item. `null` stands for the whole of a side the item does not have:
 * an item with sizes and no colours has the combinations `{ colourId: null, sizeId }`.
 */
export interface CatalogCombination {
  colourId: string | null
  sizeId: string | null
}

/** A photo's processing (#464): the worker makes its widths in seconds, or refuses it. */
export type CatalogPhotoState = `preparing` | `ready` | `refused`

/** One photo of an item, as the admin app reads it. The first is the item's cover. */
export interface CatalogPhoto {
  id: string
  /** The colour it shows, or `null` for every colour. */
  colourId: string | null
  alt: CatalogText
  state: CatalogPhotoState
}

/** What an operator writes about an item, checked by {@link parseCatalogItemFields}. */
export interface CatalogItemFields {
  slug: string
  categoryId: string | null
  name: CatalogText
  description: CatalogText
  material: CatalogText
  fit: CatalogText
  care: CatalogText
  /** In the smallest unit of the catalog's currency: cents, or dong. */
  price: number
  colours: CatalogColour[]
  sizes: CatalogSize[]
  /** The combinations that are sold out, one each. */
  soldOut: CatalogCombination[]
}

/** One item as the admin app reads it. */
export interface CatalogItem extends CatalogItemFields {
  id: string
  status: CatalogItemStatus
  /** The first time it went live; it never moves. `null` for a draft. */
  publishedAt: string | null
  photos: CatalogPhoto[]
  createdAt: string
  updatedAt: string
  /** Starts at 1 and grows by one with every save; a save, a status change or a delete names it. */
  version: number
}

/** Whether none, some or all of an item's combinations are sold out. */
export type CatalogStock = `in-stock` | `some-sold-out` | `sold-out`

/** One item in the admin's list. */
export interface CatalogItemRow {
  id: string
  slug: string
  name: CatalogText
  categoryId: string | null
  price: number
  status: CatalogItemStatus
  stock: CatalogStock
  /** The cover photo's id, when it is ready to show. */
  coverId: string | null
  photoCount: number
  publishedAt: string | null
  updatedAt: string
}

/** One category as the admin app reads it. */
export interface CatalogCategory {
  id: string
  slug: string
  name: CatalogText
  /** 0 first. */
  position: number
  /** How many items it holds, whatever their status. */
  itemCount: number
  createdAt: string
  updatedAt: string
  version: number
}

/** The answer of `GET /api/admin/catalog`: the settings, every category and every item. */
export interface AdminCatalogResponse {
  settings: CatalogSettings
  categories: CatalogCategory[]
  items: CatalogItemRow[]
  /** The tracking links' sources, in order (#483). */
  sources: CatalogLinkSource[]
  /**
   * Whether items get tracking links: the website's address (`MPA_DOMAIN`) is set. Off, the item
   * page shows no "Share links" and the sources page says what to set.
   */
  tracking: boolean
}

/**
 * A place the shop shares its items in, such as a Zalo group (#483). Its `slug` is the
 * `utm_source` of its tracking links.
 */
export interface CatalogLinkSource {
  id: string
  name: string
  slug: string
  /** 0 first. */
  position: number
  /** How many items have a link for it. */
  linkCount: number
  createdAt: string
  updatedAt: string
  version: number
}

/** An item's tracking link for one source, made the first time "Copy link" is pressed. */
export interface CatalogTrackingLink {
  sourceId: string
  /** The short address on the website, `https://<site>/s/<code>`. */
  url: string
  createdAt: string
}

/** One stored width of a published photo, for `responsiveImage` of `@spy4x/platform`. */
export interface PublicCatalogVariant {
  /** The file's name under the photo, such as `960.webp`. */
  file: string
  width: number
  height: number
  type: string
}

/** A published item's photo, once its widths are made. */
export interface PublicCatalogPhoto {
  id: string
  colourId: string | null
  alt: CatalogText
  variants: PublicCatalogVariant[]
}

/** A category as the website reads it: no id, only the ones holding a published item. */
export interface PublicCatalogCategory {
  slug: string
  name: CatalogText
}

/** A published item in the website's lists. */
export interface PublicCatalogItemSummary {
  slug: string
  categorySlug: string
  name: CatalogText
  price: number
  stock: CatalogStock
  cover: PublicCatalogPhoto | null
  publishedAt: string
  updatedAt: string
}

/** A published item on its own page. */
export interface PublicCatalogItem extends PublicCatalogItemSummary {
  description: CatalogText
  material: CatalogText
  fit: CatalogText
  care: CatalogText
  colours: CatalogColour[]
  sizes: CatalogSize[]
  soldOut: CatalogCombination[]
  photos: PublicCatalogPhoto[]
}

/** The answer of `GET /api/catalog`: the settings, the categories and every published item. */
export interface PublicCatalogResponse {
  settings: CatalogSettings
  categories: PublicCatalogCategory[]
  items: PublicCatalogItemSummary[]
}

// #endregion

// #region Errors

export type CatalogErrorCode =
  | `ITEM_NOT_FOUND`
  | `CATEGORY_NOT_FOUND`
  | `PHOTO_NOT_FOUND`
  | `INVALID_REQUEST`
  | `ID_ALREADY_EXISTS`
  | `SLUG_TAKEN`
  | `CATEGORY_REQUIRED`
  | `CATEGORY_NOT_EMPTY`
  | `SOURCE_NOT_FOUND`
  | `TRACKING_OFF`
  | `NOT_PUBLISHED`
  | `TOO_MANY`
  | `ORDER_STALE`
  | `PHOTO_TYPE`
  | `PHOTO_TOO_LARGE`
  | `PHOTO_CONTENT`
  | `VERSION_CONFLICT`

/**
 * A refused catalog request. `field` names what it is about, as the editor's field keys do:
 * `slug`, `price`, `categoryId`, `name:en`, `colour:<id>`, `size:<id>`, `alt:vi`.
 */
export class CatalogError extends Error {
  constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    public readonly field: string | null = null,
  ) {
    super(message)
    this.name = `CatalogError`
  }
}

/** A write named a version the item or category has moved past; it carries the current one. */
export class CatalogVersionConflictError extends CatalogError {
  constructor(public readonly currentVersion: number) {
    super(`VERSION_CONFLICT`, `Someone else changed this. Reload to see their changes.`)
    this.name = `CatalogVersionConflictError`
  }
}

// #endregion

// #region Request schemas
// The bodies of the admin routes. Lengths are checked in characters by the parsers below, not
// here: arktype counts UTF-16 units.

const text = type({ "[string]": `string` })
const uuid = type(UUID_PATTERN)
const range = type({ min: `number.integer`, max: `number.integer`, "+": `reject` })

const itemFields = {
  slug: `string`,
  categoryId: uuid.or(`null`),
  name: text,
  description: text,
  material: text,
  fit: text,
  care: text,
  price: `number.integer`,
  colours: type({ id: uuid, name: text, swatch: `string`, "+": `reject` }).array()
    .atMostLength(CATALOG_COLOURS_MAX),
  sizes: type({
    id: uuid,
    label: `string`,
    "heightCm?": range.or(`null`),
    "weightKg?": range.or(`null`),
    "+": `reject`,
  }).array().atMostLength(CATALOG_SIZES_MAX),
  soldOut: type({ colourId: uuid.or(`null`), sizeId: uuid.or(`null`), "+": `reject` }).array()
    .atMostLength((CATALOG_COLOURS_MAX + 1) * (CATALOG_SIZES_MAX + 1)),
} as const

const versionField = { version: `number.integer >= 1` } as const

/** `POST /api/admin/catalog/items`: a client-made id, so a retry cannot add a second item. */
export const catalogItemCreateSchema = type({ id: uuid, ...itemFields, "+": `reject` })
export type CatalogItemCreateRequest = typeof catalogItemCreateSchema.infer

/** `POST /api/admin/catalog/items/:id`: every field and the version edited. */
export const catalogItemUpdateSchema = type({ ...versionField, ...itemFields, "+": `reject` })

/** `POST /api/admin/catalog/items/:id/status`: publish or hide the item at `version`. */
export const catalogItemStatusSchema = type({
  ...versionField,
  status: `'published' | 'hidden'`,
  "+": `reject`,
})

/** A delete: the version the operator saw. */
export const catalogVersionSchema = type({ ...versionField, "+": `reject` })

/** `POST /api/admin/catalog/categories/order` and `.../photos/order`: every id, in the new order. */
export const catalogOrderSchema = type({
  ids: uuid.array().atMostLength(CATALOG_CATEGORIES_MAX),
  "+": `reject`,
})

/** `POST /api/admin/catalog/items/:id/photos/:photoId`: what the photo shows and its colour. */
export const catalogPhotoUpdateSchema = type({
  alt: text,
  colourId: uuid.or(`null`),
  "+": `reject`,
})

const categoryFields = { slug: `string`, name: text } as const

/** `POST /api/admin/catalog/categories`: a client-made id, so a retry cannot add a second one. */
export const catalogCategoryCreateSchema = type({ id: uuid, ...categoryFields, "+": `reject` })
export type CatalogCategoryCreateRequest = typeof catalogCategoryCreateSchema.infer

/** `POST /api/admin/catalog/categories/:id`: every field and the version edited. */
export const catalogCategoryUpdateSchema = type({
  ...versionField,
  ...categoryFields,
  "+": `reject`,
})

const sourceFields = { slug: `string`, name: `string` } as const

/** `POST /api/admin/catalog/sources`: a client-made id, so a retry cannot add a second one. */
export const catalogSourceCreateSchema = type({ id: uuid, ...sourceFields, "+": `reject` })
export type CatalogSourceCreateRequest = typeof catalogSourceCreateSchema.infer

/** `POST /api/admin/catalog/sources/:id`: every field and the version edited. */
export const catalogSourceUpdateSchema = type({ ...versionField, ...sourceFields, "+": `reject` })

/** `POST /api/admin/catalog/sources/order`: every id, in the new order. */
export const catalogSourceOrderSchema = type({
  ids: uuid.array().atMostLength(CATALOG_SOURCES_MAX),
  "+": `reject`,
})

/** `POST /api/admin/catalog/items/:id/links`: the item's link for one source, made when missing. */
export const catalogTrackingLinkSchema = type({ sourceId: uuid, "+": `reject` })

// #endregion

// #region Validation

/** How many characters `text` holds, as Postgres counts them: an emoji is one. */
function characters(text: string): number {
  return Array.from(text).length
}

function invalid(field: string, message: string): never {
  throw new CatalogError(`INVALID_REQUEST`, message, field)
}

/** Why `slug` is no address part, or `null` when it is one. */
export function catalogSlugProblem(slug: string): string | null {
  if (slug === ``) return `Add the address.`
  if (characters(slug) > CATALOG_SLUG_MAX_LENGTH) {
    return `Keep the address to ${CATALOG_SLUG_MAX_LENGTH} characters.`
  }
  if (!CATALOG_SLUG_PATTERN.test(slug)) return `Use lowercase letters, digits and hyphens only.`
  return null
}

/** What {@link parseCatalogText} checks a text against. */
export interface CatalogTextRule {
  /** The field's key; each language's error names `<field>:<language>`. */
  field: string
  /** What the field holds, lower case, for the messages: `name`, `description`. */
  noun: string
  max: number
  /** The default language must have it. */
  required?: boolean
}

/**
 * One text in each of `languages`: trimmed, an empty one left out, at most `rule.max`
 * characters, and present in the default language when `rule.required`. A language the catalog
 * does not keep is refused. Throws {@link CatalogError} naming `<field>:<language>`.
 */
export function parseCatalogText(
  input: CatalogText,
  languages: readonly string[],
  rule: CatalogTextRule,
): CatalogText {
  const result: CatalogText = {}
  for (const [language, value] of Object.entries(input)) {
    if (!languages.includes(language)) {
      invalid(rule.field, `The catalog keeps no texts in "${language}".`)
    }
    const trimmed = value.trim()
    if (trimmed === ``) continue
    const field = `${rule.field}:${language}`
    if (hasUnstorableTextCharacters(trimmed)) {
      invalid(field, `Remove the NUL or broken character from this field.`)
    }
    if (characters(trimmed) > rule.max) {
      invalid(field, `Keep the ${rule.noun} to ${rule.max} characters.`)
    }
    result[language] = trimmed
  }
  if (rule.required && !result[languages[0]]) {
    invalid(`${rule.field}:${languages[0]}`, `Enter the ${rule.noun}.`)
  }
  return result
}

/** The text in `language`, else in the default language, else in any language, else `""`. */
export function catalogText(
  text: CatalogText,
  languages: readonly string[],
  language = languages[0],
): string {
  return text[language] || text[languages[0]] || Object.values(text).find(Boolean) || ``
}

/** Every combination of an item's colours and sizes, colour by colour. */
export function catalogCombinations(
  colours: readonly Pick<CatalogColour, `id`>[],
  sizes: readonly Pick<CatalogSize, `id`>[],
): CatalogCombination[] {
  const colourIds = colours.length === 0 ? [null] : colours.map((colour) => colour.id)
  const sizeIds = sizes.length === 0 ? [null] : sizes.map((size) => size.id)
  return colourIds.flatMap((colourId) => sizeIds.map((sizeId) => ({ colourId, sizeId })))
}

/** The key of a combination, for sets and form fields: `<colour id or ->/<size id or ->`. */
export function catalogCombinationKey(combination: CatalogCombination): string {
  return `${combination.colourId ?? `-`}/${combination.sizeId ?? `-`}`
}

/** Whether none, some or all of the item's combinations are sold out. */
export function catalogStock(
  item: {
    colours: readonly Pick<CatalogColour, `id`>[]
    sizes: readonly Pick<CatalogSize, `id`>[]
    soldOut: readonly CatalogCombination[]
  },
): CatalogStock {
  const all = catalogCombinations(item.colours, item.sizes)
  const sold = new Set(item.soldOut.map(catalogCombinationKey))
  const count = all.filter((combination) => sold.has(catalogCombinationKey(combination))).length
  return count === 0 ? `in-stock` : count === all.length ? `sold-out` : `some-sold-out`
}

/** A size's height or weight range, checked: whole numbers from 1 to `top`, lowest first. */
function parseRange(
  input: CatalogRange | null | undefined,
  field: string,
  noun: string,
  unit: string,
  top: number,
): CatalogRange | null {
  if (!input) return null
  const { min, max } = input
  if (min < 1 || max > top) invalid(field, `Enter a ${noun} from 1 to ${top} ${unit}.`)
  if (min > max) invalid(field, `Put the lower ${noun} first.`)
  return { min, max }
}

/** What the size calculator answers (`recommendSize`). */
export type CatalogSizeAdvice =
  | { kind: `size`; size: CatalogSize }
  | { kind: `between`; smaller: CatalogSize; larger: CatalogSize }

/**
 * The size calculator: which of `sizes` fits a person of `heightCm` and `weightKg`. The sizes are
 * in the item's order, smallest first. The rule:
 *
 * 1. A measure no size has a range for is left out. No size has either range: `null`.
 * 2. A measure some size has a range for, whose value falls in none of them: `null`. The person is
 *    outside the chart, and a guess from the other measure would mislead.
 * 3. A size whose ranges hold every measure that is left: that size, the first one when ranges
 *    overlap.
 * 4. Otherwise the height and the weight point at different sizes (the first size holding each):
 *    `between` those two, the one earlier in the list as `smaller`.
 */
export function recommendSize(
  sizes: readonly CatalogSize[],
  { heightCm, weightKg }: { heightCm: number; weightKg: number },
): CatalogSizeAdvice | null {
  const measures = ([[`heightCm`, heightCm], [`weightKg`, weightKg]] as const)
    .filter(([key]) => sizes.some((size) => size[key]))
  if (measures.length === 0) return null
  const holds = (size: CatalogSize, key: `heightCm` | `weightKg`, value: number) => {
    const range = size[key]
    return range !== null && range.min <= value && value <= range.max
  }
  const firsts = measures.map(([key, value]) => sizes.findIndex((size) => holds(size, key, value)))
  if (firsts.includes(-1)) return null
  const fits = sizes.find((size) => measures.every(([key, value]) => holds(size, key, value)))
  if (fits) return { kind: `size`, size: fits }
  const [smaller, larger] = firsts.toSorted((a, b) => a - b)
  return { kind: `between`, smaller: sizes[smaller], larger: sizes[larger] }
}

/**
 * Trims and checks an item's fields against the catalog's `languages`. Throws
 * {@link CatalogError} with the field it is about: no name in the default language, a slug that is
 * no slug, a price that is negative or too high, a colour without a name or with a swatch that is
 * no `#rrggbb`, a size without a label or named twice, a height or weight range out of bounds or upside down, a colour or size id used twice, or a sold-out
 * combination of a colour or size the item does not have.
 */
export function parseCatalogItemFields(
  input: Omit<CatalogItemCreateRequest, `id`>,
  languages: readonly string[],
): CatalogItemFields {
  const slug = input.slug.trim()
  const slugProblem = catalogSlugProblem(slug)
  if (slugProblem) invalid(`slug`, slugProblem)
  const name = parseCatalogText(input.name, languages, {
    field: `name`,
    noun: `name`,
    max: CATALOG_NAME_MAX_LENGTH,
    required: true,
  })
  const description = parseCatalogText(input.description, languages, {
    field: `description`,
    noun: `description`,
    max: CATALOG_DESCRIPTION_MAX_LENGTH,
  })
  const [material, fit, care] = ([`material`, `fit`, `care`] as const).map((field) =>
    parseCatalogText(input[field], languages, {
      field,
      noun: field,
      max: CATALOG_DETAIL_MAX_LENGTH,
    })
  )
  if (input.price < 0) invalid(`price`, `Enter a price of 0 or more.`)
  if (input.price > CATALOG_PRICE_MAX) invalid(`price`, `Enter a lower price.`)

  const ids = new Set<string>()
  const unique = (id: string, field: string) => {
    if (ids.has(id.toLowerCase())) invalid(field, `Two entries have the same id. Reload the page.`)
    ids.add(id.toLowerCase())
  }
  const colours = input.colours.map((colour): CatalogColour => {
    const field = `colour:${colour.id.toLowerCase()}`
    unique(colour.id, field)
    const swatch = colour.swatch.trim().toLowerCase()
    if (!isHexColor(swatch)) invalid(field, `Pick the colour's swatch.`)
    const colourName = parseCatalogText(colour.name, languages, {
      field,
      noun: `colour name`,
      max: CATALOG_COLOUR_NAME_MAX_LENGTH,
      required: true,
    })
    return { id: colour.id.toLowerCase(), name: colourName, swatch }
  })
  const labels = new Set<string>()
  const sizes = input.sizes.map((size): CatalogSize => {
    const field = `size:${size.id.toLowerCase()}`
    unique(size.id, field)
    const label = size.label.trim()
    if (label === ``) invalid(field, `Enter the size.`)
    if (hasUnstorableTextCharacters(label)) {
      invalid(field, `Remove the NUL or broken character from this field.`)
    }
    if (characters(label) > CATALOG_SIZE_LABEL_MAX_LENGTH) {
      invalid(field, `Keep the size to ${CATALOG_SIZE_LABEL_MAX_LENGTH} characters.`)
    }
    if (labels.has(label.toLowerCase())) invalid(field, `This size is in the list already.`)
    labels.add(label.toLowerCase())
    const heightCm = parseRange(size.heightCm, field, `height`, `cm`, CATALOG_HEIGHT_MAX_CM)
    const weightKg = parseRange(size.weightKg, field, `weight`, `kg`, CATALOG_WEIGHT_MAX_KG)
    return { id: size.id.toLowerCase(), label, heightCm, weightKg }
  })

  const known = new Set(catalogCombinations(colours, sizes).map(catalogCombinationKey))
  const soldKeys = new Set<string>()
  const soldOut: CatalogCombination[] = []
  for (const entry of input.soldOut) {
    const combination = {
      colourId: entry.colourId?.toLowerCase() ?? null,
      sizeId: entry.sizeId?.toLowerCase() ?? null,
    }
    const key = catalogCombinationKey(combination)
    if (!known.has(key)) invalid(`soldOut`, `A sold-out size is not one of this item's.`)
    if (soldKeys.has(key)) continue
    soldKeys.add(key)
    soldOut.push(combination)
  }
  return {
    slug,
    categoryId: input.categoryId?.toLowerCase() ?? null,
    name,
    description,
    material,
    fit,
    care,
    price: input.price,
    colours,
    sizes,
    soldOut,
  }
}

/** A category's fields, checked. */
export interface CatalogCategoryFields {
  slug: string
  name: CatalogText
}

/** Trims and checks a category's fields. Throws {@link CatalogError} with the field. */
export function parseCatalogCategoryFields(
  input: Omit<CatalogCategoryCreateRequest, `id`>,
  languages: readonly string[],
): CatalogCategoryFields {
  const slug = input.slug.trim()
  const slugProblem = catalogSlugProblem(slug)
  if (slugProblem) invalid(`slug`, slugProblem)
  const name = parseCatalogText(input.name, languages, {
    field: `name`,
    noun: `name`,
    max: CATALOG_NAME_MAX_LENGTH,
    required: true,
  })
  return { slug, name }
}

/** A tracking link source's fields, checked. */
export interface CatalogSourceFields {
  name: string
  slug: string
}

/** Trims and checks a source's fields. Throws {@link CatalogError} with the field. */
export function parseCatalogSourceFields(
  input: Omit<CatalogSourceCreateRequest, `id`>,
): CatalogSourceFields {
  const name = input.name.trim()
  if (name === ``) invalid(`name`, `Add the name.`)
  if (hasUnstorableTextCharacters(name)) {
    invalid(`name`, `Remove the NUL or broken character from this field.`)
  }
  if (characters(name) > CATALOG_SOURCE_NAME_MAX_LENGTH) {
    invalid(`name`, `Keep the name to ${CATALOG_SOURCE_NAME_MAX_LENGTH} characters.`)
  }
  const slug = input.slug.trim()
  const slugProblem = catalogSlugProblem(slug)
  if (slugProblem) invalid(`slug`, slugProblem)
  return { name, slug }
}

/** A tracking link's code: the random, public part of `/s/<code>`. */
export const CATALOG_LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{8,32}$/

/**
 * The address a tracking link sends a visitor to: the item's page on the website, tagged with the
 * source as `utm_source`, `share` as `utm_medium` and the item as `utm_campaign`. `itemPath` is the
 * website's item address with `{category}` and `{slug}` in it, such as `/{category}/{slug}`.
 * Answers `null` when the address would leave `siteUrl`, so a link can never send a visitor to
 * another site.
 */
export function catalogTaggedItemUrl(
  siteUrl: string,
  itemPath: string,
  { itemSlug, categorySlug, sourceSlug }: {
    itemSlug: string
    categorySlug: string | null
    sourceSlug: string
  },
): string | null {
  const path = itemPath
    .replaceAll(`{category}`, encodeURIComponent(categorySlug ?? ``))
    .replaceAll(`{slug}`, encodeURIComponent(itemSlug))
    .replace(/\/{2,}/g, `/`)
  let url: URL
  try {
    url = new URL(path, siteUrl)
  } catch {
    return null
  }
  if (!path.startsWith(`/`) || url.origin !== new URL(siteUrl).origin) return null
  url.searchParams.set(`utm_source`, sourceSlug)
  url.searchParams.set(`utm_medium`, `share`)
  url.searchParams.set(`utm_campaign`, itemSlug)
  return url.href
}

/** What a photo shows, checked against the catalog's languages. */
export function parseCatalogPhotoAlt(alt: CatalogText, languages: readonly string[]): CatalogText {
  return parseCatalogText(alt, languages, {
    field: `alt`,
    noun: `description`,
    max: CATALOG_ALT_MAX_LENGTH,
  })
}

/**
 * The type a photo is uploaded as. A desktop browser that does not know HEIC gives a `.heic` or
 * `.heif` file no type; those go as HEIC, and the API still checks the bytes.
 */
export function catalogPhotoContentType(file: { name: string; type: string }): string {
  if ((CATALOG_PHOTO_TYPES as readonly string[]).includes(file.type)) return file.type
  return /\.hei[cf]$/i.test(file.name) ? `image/heic` : file.type
}

/** Where a photo's original is kept until the worker has made its widths and deleted it. */
export function catalogPhotoObjectKey(id: string): string {
  return `catalog/${id}`
}

// #endregion

// #region Audit
// Every operator change writes one `audit_events` row on the operator, with the item or category
// as its entity; the audit log names them (`@ui/admin-audit-screen.tsx`).

export const CATALOG_ITEM_ENTITY = `catalog_item`
export const CATALOG_CATEGORY_ENTITY = `catalog_category`
export const CATALOG_SOURCE_ENTITY = `catalog_link_source`

/** The `audit_events.event_kind` of each operator change. */
export const CATALOG_AUDIT_KINDS = {
  itemCreated: `catalog.item_created`,
  itemUpdated: `catalog.item_updated`,
  itemPublished: `catalog.item_published`,
  itemHidden: `catalog.item_hidden`,
  itemDeleted: `catalog.item_deleted`,
  photoAdded: `catalog.photo_added`,
  photoUpdated: `catalog.photo_updated`,
  photoRemoved: `catalog.photo_removed`,
  photosReordered: `catalog.photos_reordered`,
  categoryCreated: `catalog.category_created`,
  categoryUpdated: `catalog.category_updated`,
  categoryDeleted: `catalog.category_deleted`,
  categoriesReordered: `catalog.categories_reordered`,
  sourceCreated: `catalog.source_created`,
  sourceUpdated: `catalog.source_updated`,
  sourceDeleted: `catalog.source_deleted`,
  sourcesReordered: `catalog.sources_reordered`,
  linkCreated: `catalog.link_created`,
} as const

export type CatalogAuditKind = typeof CATALOG_AUDIT_KINDS[keyof typeof CATALOG_AUDIT_KINDS]

// #endregion
