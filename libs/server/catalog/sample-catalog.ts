import type postgres from "postgres"
import type {
  CatalogCategoryFields,
  CatalogItemFields,
  CatalogItemStatus,
  CatalogSize,
  CatalogText,
} from "@domain/catalog"
import { type CatalogActor, PostgresCatalog } from "./postgres-catalog.ts"

/**
 * A small merch shop for local work and the public demo (#466): three categories and six items
 * with colours, sizes, a sold-out size and a sold-out item, in English. Five are published and one
 * is a draft. They have no photos: the website shows its placeholder until an operator adds some.
 * The ids are fixed, so seeding again adds nothing.
 */
export const SAMPLE_CATALOG_CATEGORIES: readonly (CatalogCategoryFields & { id: string })[] = [
  { id: `019a2f6c-0c00-7000-8000-00000000ca01`, slug: `tops`, name: { en: `Tops` } },
  { id: `019a2f6c-0c00-7000-8000-00000000ca02`, slug: `hoodies`, name: { en: `Hoodies` } },
  { id: `019a2f6c-0c00-7000-8000-00000000ca03`, slug: `accessories`, name: { en: `Accessories` } },
]

const [TOPS, HOODIES, ACCESSORIES] = SAMPLE_CATALOG_CATEGORIES.map((category) => category.id)

/** One sample colour or size id: `019a2f6c-0c00-7000-8000-0000000c<item><n>`. */
function partId(item: number, n: number): string {
  return `019a2f6c-0c00-7000-8000-0000000c${String(item).padStart(2, `0`)}${
    String(n).padStart(2, `0`)
  }`
}

/** The sample size chart: the heights (cm) and weights (kg) each size fits. */
const SIZE_CHART = [
  { label: `S`, heightCm: { min: 150, max: 162 }, weightKg: { min: 40, max: 52 } },
  { label: `M`, heightCm: { min: 163, max: 170 }, weightKg: { min: 53, max: 62 } },
  { label: `L`, heightCm: { min: 171, max: 178 }, weightKg: { min: 63, max: 72 } },
  { label: `XL`, heightCm: { min: 179, max: 190 }, weightKg: { min: 73, max: 90 } },
] as const

/** Sizes S to XL of sample item `item`, with {@link SIZE_CHART}. */
function apparelSizes(item: number): CatalogSize[] {
  return SIZE_CHART.map((size, n) => ({
    id: partId(item, 10 + n),
    label: size.label,
    heightCm: { ...size.heightCm },
    weightKg: { ...size.weightKg },
  }))
}

/** One sample item: its id, fields and status. */
export interface SampleCatalogItem {
  id: string
  status: CatalogItemStatus
  fields: CatalogItemFields
}

/** An English text, or none for `""`. */
const en = (text: string): CatalogText => text ? { en: text } : {}

function texts(description: string, material: string, fit: string, care: string) {
  return { description: en(description), material: en(material), fit: en(fit), care: en(care) }
}

export const SAMPLE_CATALOG_ITEMS: readonly SampleCatalogItem[] = [
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb01`,
    status: `published`,
    fields: {
      slug: `seedling-tee`,
      categoryId: TOPS,
      name: { en: `Seedling tee` },
      ...texts(
        `A soft everyday T-shirt with a small seedling on the chest.`,
        `100% organic cotton, 180 g/m²`,
        `Regular fit. Take your usual size.`,
        `Machine wash cold, inside out.`,
      ),
      price: 2400,
      colours: [
        { id: partId(1, 1), name: { en: `Forest` }, swatch: `#2f5d3a` },
        { id: partId(1, 2), name: { en: `Sand` }, swatch: `#d8c7a3` },
      ],
      sizes: apparelSizes(1),
      soldOut: [{ colourId: partId(1, 2), sizeId: partId(1, 10) }],
    },
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb02`,
    status: `published`,
    fields: {
      slug: `logo-long-sleeve`,
      categoryId: TOPS,
      name: { en: `Logo long sleeve` },
      ...texts(
        `A long-sleeve top with the logo printed down one arm.`,
        `Cotton and recycled polyester`,
        `Relaxed fit.`,
        `Machine wash at 30 °C.`,
      ),
      price: 3200,
      colours: [{ id: partId(2, 1), name: { en: `Ink` }, swatch: `#1f2a44` }],
      sizes: apparelSizes(2),
      soldOut: [],
    },
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb03`,
    status: `published`,
    fields: {
      slug: `zip-hoodie`,
      categoryId: HOODIES,
      name: { en: `Zip hoodie` },
      ...texts(
        `A heavy zip hoodie for cold mornings at the desk.`,
        `80% cotton, 20% polyester fleece`,
        `Regular fit with a ribbed hem.`,
        `Machine wash cold. Do not tumble dry.`,
      ),
      price: 5800,
      colours: [
        { id: partId(3, 1), name: { en: `Brown` }, swatch: `#6b4a2f` },
        { id: partId(3, 2), name: { en: `Grey` }, swatch: `#8a8d91` },
      ],
      sizes: apparelSizes(3),
      soldOut: [],
    },
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb04`,
    status: `published`,
    fields: {
      slug: `pullover-hoodie`,
      categoryId: HOODIES,
      name: { en: `Pullover hoodie` },
      ...texts(`Our first hoodie, now sold out.`, `100% cotton`, `Oversized fit.`, ``),
      price: 5200,
      colours: [],
      sizes: [{ id: partId(4, 10), label: `Free size`, heightCm: null, weightKg: null }],
      soldOut: [{ colourId: null, sizeId: partId(4, 10) }],
    },
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb05`,
    status: `published`,
    fields: {
      slug: `canvas-tote`,
      categoryId: ACCESSORIES,
      name: { en: `Canvas tote` },
      ...texts(`A sturdy tote that fits a laptop.`, `Heavy cotton canvas`, ``, `Hand wash.`),
      price: 1800,
      colours: [{ id: partId(5, 1), name: { en: `Natural` }, swatch: `#efe6d2` }],
      sizes: [],
      soldOut: [],
    },
  },
  {
    id: `019a2f6c-0c00-7000-8000-00000000cb06`,
    status: `draft`,
    fields: {
      slug: `enamel-mug`,
      categoryId: ACCESSORIES,
      name: { en: `Enamel mug` },
      ...texts(`A camping mug for coffee anywhere.`, `Enamelled steel`, ``, ``),
      price: 1500,
      colours: [],
      sizes: [],
      soldOut: [],
    },
  },
]

/** The seed's writes have no operator. */
const SEED: CatalogActor = { userId: null, requestId: null }

/**
 * Adds {@link SAMPLE_CATALOG_CATEGORIES} and {@link SAMPLE_CATALOG_ITEMS} through the admin's own
 * repository, skipping the ones that exist, and publishes the published ones. With `at`, the rows
 * it adds and their audit rows are dated then: the demo's seed writes its past at a `now` of its
 * own, and no row may be later than it.
 */
export async function seedSampleCatalog(sql: postgres.Sql, at?: Date): Promise<void> {
  const catalog = new PostgresCatalog(sql)
  const categories = new Set((await catalog.listCategories()).map((category) => category.id))
  const added: string[] = []
  for (const { id, ...fields } of SAMPLE_CATALOG_CATEGORIES) {
    if (categories.has(id)) continue
    await catalog.createCategory(id, fields, SEED)
    added.push(id)
  }
  for (const sample of SAMPLE_CATALOG_ITEMS) {
    if (await catalog.getItem(sample.id)) continue
    const item = await catalog.createItem(sample.id, sample.fields, SEED)
    if (sample.status === `published`) {
      await catalog.setStatus(item.id, item.version, `published`, SEED)
    }
    added.push(sample.id)
  }
  if (!at || added.length === 0) return
  const ids = sql.array(added)
  await sql`
    UPDATE catalog_categories SET created_at = ${at}, updated_at = ${at} WHERE id = ANY(${ids}::uuid[])
  `
  await sql`
    UPDATE catalog_items SET created_at = ${at}, updated_at = ${at},
      published_at = CASE WHEN published_at IS NULL THEN NULL ELSE ${at}::timestamptz END
    WHERE id = ANY(${ids}::uuid[])
  `
  await sql`UPDATE audit_events SET created_at = ${at} WHERE entity_id = ANY(${ids}::uuid[])`
}
