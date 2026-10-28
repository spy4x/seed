import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import {
  CATALOG_NAME_MAX_LENGTH,
  catalogCombinations,
  CatalogError,
  catalogItemCreateSchema,
  catalogPhotoContentType,
  catalogStock,
  catalogText,
  parseCatalogCurrency,
  parseCatalogItemFields,
  parseCatalogLanguages,
  parseCatalogText,
  recommendSize,
} from "./+lib.ts"

const RED = `0199f0a0-0000-7000-8000-00000000000a`
const BLUE = `0199f0a0-0000-7000-8000-00000000000b`
const S = `0199f0a0-0000-7000-8000-00000000000c`
const M = `0199f0a0-0000-7000-8000-00000000000d`

/** A valid item's fields in a catalog kept in Vietnamese and English. */
function input(patch: Partial<Parameters<typeof parseCatalogItemFields>[0]> = {}) {
  return {
    slug: `ao-khoac-zip-nau`,
    categoryId: null,
    name: { vi: `Áo khoác zip nâu`, en: `Brown zip jacket` },
    description: {},
    material: {},
    fit: {},
    care: {},
    price: 450_000,
    colours: [{ id: RED, name: { vi: `Đỏ` }, swatch: `#AA0000` }],
    sizes: [{ id: S, label: `S` }, { id: M, label: ` M ` }],
    soldOut: [],
    ...patch,
  }
}

/** The field of the {@link CatalogError} `run` throws. */
function refusedField(run: () => unknown): string | null {
  try {
    run()
  } catch (error) {
    if (error instanceof CatalogError) return error.field
    throw error
  }
  throw new Error(`nothing was refused`)
}

describe(`catalog settings`, () => {
  it(`reads the languages in order, canonical, the default first`, () => {
    expect(parseCatalogLanguages(` VI , en-us `)).toEqual([`vi`, `en-US`])
  })

  it(`refuses an empty list, a tag that is no language and a language named twice`, () => {
    for (const value of [``, ` , `, `vi,not a tag`, `vi,en,vi`]) {
      expect(() => parseCatalogLanguages(value), value).toThrow(`CATALOG_LANGUAGES`)
    }
  })

  it(`reads a currency code in capitals and refuses anything else`, () => {
    expect(parseCatalogCurrency(` vnd `)).toBe(`VND`)
    expect(() => parseCatalogCurrency(`dong`)).toThrow(`CATALOG_CURRENCY`)
  })
})

describe(`catalog texts`, () => {
  const rule = { field: `name`, noun: `name`, max: 5, required: true }

  it(`keeps each language's trimmed text and leaves an empty one out`, () => {
    expect(parseCatalogText({ vi: ` Áo `, en: `  ` }, [`vi`, `en`], rule)).toEqual({ vi: `Áo` })
  })

  it(`asks for the text in the default language, naming that language's field`, () => {
    expect(refusedField(() => parseCatalogText({ en: `Coat` }, [`vi`, `en`], rule))).toBe(`name:vi`)
  })

  it(`refuses a language the catalog does not keep`, () => {
    expect(refusedField(() => parseCatalogText({ vi: `Áo`, de: `Mantel` }, [`vi`], rule))).toBe(
      `name`,
    )
  })

  it(`counts an emoji as one character, as Postgres does`, () => {
    expect(parseCatalogText({ en: `🧥🧥🧥🧥🧥` }, [`en`], rule)).toEqual({ en: `🧥🧥🧥🧥🧥` })
    expect(refusedField(() => parseCatalogText({ en: `🧥🧥🧥🧥🧥🧥` }, [`en`], rule))).toBe(
      `name:en`,
    )
  })

  it(`reads a text in the visitor's language, else in the default one`, () => {
    const languages = [`vi`, `en`]
    expect(catalogText({ vi: `Áo`, en: `Coat` }, languages, `en`)).toBe(`Coat`)
    expect(catalogText({ vi: `Áo` }, languages, `en`)).toBe(`Áo`)
    expect(catalogText({ en: `Coat` }, languages)).toBe(`Coat`)
  })
})

describe(`an item's fields`, () => {
  const languages = [`vi`, `en`]

  it(`trims the sizes and stores the swatch in lower case`, () => {
    const fields = parseCatalogItemFields(input(), languages)
    expect(fields.sizes.map((size) => size.label)).toEqual([`S`, `M`])
    expect(fields.colours[0].swatch).toBe(`#aa0000`)
  })

  it(`refuses a name too long for the default language`, () => {
    const name = { vi: `a`.repeat(CATALOG_NAME_MAX_LENGTH + 1) }
    expect(refusedField(() => parseCatalogItemFields(input({ name }), languages))).toBe(`name:vi`)
  })

  it(`refuses a slug with capitals or spaces`, () => {
    expect(refusedField(() => parseCatalogItemFields(input({ slug: `Ao khoac` }), languages)))
      .toBe(`slug`)
  })

  it(`refuses a negative price`, () => {
    expect(refusedField(() => parseCatalogItemFields(input({ price: -1 }), languages))).toBe(
      `price`,
    )
  })

  it(`refuses a colour without a swatch, naming that colour`, () => {
    const colours = [{ id: RED, name: { vi: `Đỏ` }, swatch: `red` }]
    expect(refusedField(() => parseCatalogItemFields(input({ colours }), languages))).toBe(
      `colour:${RED}`,
    )
  })

  it(`refuses a size named twice`, () => {
    const sizes = [{ id: S, label: `M` }, { id: M, label: `m` }]
    expect(refusedField(() => parseCatalogItemFields(input({ sizes }), languages))).toBe(
      `size:${M}`,
    )
  })

  it(`refuses a sold-out size of a colour the item does not have`, () => {
    const soldOut = [{ colourId: BLUE, sizeId: S }]
    expect(refusedField(() => parseCatalogItemFields(input({ soldOut }), languages))).toBe(
      `soldOut`,
    )
  })

  it(`keeps each sold-out combination once`, () => {
    const soldOut = [{ colourId: RED, sizeId: S }, { colourId: RED, sizeId: S }]
    expect(parseCatalogItemFields(input({ soldOut }), languages).soldOut).toEqual([
      { colourId: RED, sizeId: S },
    ])
  })

  it(`refuses a field the request does not have`, () => {
    const checked = catalogItemCreateSchema({ id: RED, ...input(), secret: true })
    expect(checked instanceof type.errors).toBe(true)
  })
})

describe(`stock`, () => {
  const colours = [{ id: RED }, { id: BLUE }]
  const sizes = [{ id: S }, { id: M }]

  it(`lists every colour with every size, and a missing side as null`, () => {
    expect(catalogCombinations(colours, sizes)).toHaveLength(4)
    expect(catalogCombinations([], sizes)).toEqual([
      { colourId: null, sizeId: S },
      { colourId: null, sizeId: M },
    ])
    expect(catalogCombinations([], [])).toEqual([{ colourId: null, sizeId: null }])
  })

  it(`says whether none, some or all of an item's combinations are sold out`, () => {
    const item = (soldOut: { colourId: string | null; sizeId: string | null }[]) =>
      catalogStock({
        colours: colours.map((colour) => ({ ...colour, name: {}, swatch: `#000000` })),
        sizes: sizes.map((size) => ({ ...size, label: size.id })),
        soldOut,
      })
    expect(item([])).toBe(`in-stock`)
    expect(item([{ colourId: RED, sizeId: S }])).toBe(`some-sold-out`)
    expect(item(catalogCombinations(colours, sizes))).toBe(`sold-out`)
    expect(catalogStock({ colours: [], sizes: [], soldOut: [{ colourId: null, sizeId: null }] }))
      .toBe(`sold-out`)
  })
})

describe(`size chart`, () => {
  const L = `0199f0a0-0000-7000-8000-00000000000e`
  const size = (id: string, label: string, height: [number, number], weight: [number, number]) => ({
    id,
    label,
    heightCm: { min: height[0], max: height[1] },
    weightKg: { min: weight[0], max: weight[1] },
  })
  const chart = [
    size(S, `S`, [150, 160], [40, 50]),
    size(M, `M`, [161, 170], [51, 60]),
    size(L, `L`, [171, 180], [61, 70]),
  ]
  const label = (advice: ReturnType<typeof recommendSize>) =>
    advice === null
      ? null
      : advice.kind === `size`
      ? advice.size.label
      : `${advice.smaller.label}-${advice.larger.label}`

  it(`keeps a size's height and weight ranges, and none when they are left out`, () => {
    const sizes = [{ ...chart[0], id: S }, { id: M, label: `M`, heightCm: null }]
    expect(parseCatalogItemFields(input({ sizes }), [`vi`, `en`]).sizes).toEqual([
      chart[0],
      { id: M, label: `M`, heightCm: null, weightKg: null },
    ])
  })

  it(`refuses a range upside down, below 1 or past the chart's top`, () => {
    for (const heightCm of [{ min: 170, max: 160 }, { min: 0, max: 160 }, { min: 1, max: 251 }]) {
      const sizes = [{ id: S, label: `S`, heightCm }]
      expect(refusedField(() => parseCatalogItemFields(input({ sizes }), [`vi`, `en`]))).toBe(
        `size:${S}`,
      )
    }
  })

  it(`recommends the size whose ranges hold both the height and the weight`, () => {
    expect(label(recommendSize(chart, { heightCm: 165, weightKg: 55 }))).toBe(`M`)
  })

  it(`answers between two sizes when the height and the weight point at different ones`, () => {
    expect(label(recommendSize(chart, { heightCm: 175, weightKg: 45 }))).toBe(`S-L`)
  })

  it(`recommends nothing for a person outside the chart, or an item without one`, () => {
    expect(recommendSize(chart, { heightCm: 190, weightKg: 55 })).toBeNull()
    const plain = chart.map((one) => ({ ...one, heightCm: null, weightKg: null }))
    expect(recommendSize(plain, { heightCm: 165, weightKg: 55 })).toBeNull()
  })

  it(`goes by height alone when no size has a weight range`, () => {
    const heights = chart.map((one) => ({ ...one, weightKg: null }))
    expect(label(recommendSize(heights, { heightCm: 172, weightKg: 999 }))).toBe(`L`)
  })
})

describe(`photos`, () => {
  it(`uploads a .heic file without a type as HEIC`, () => {
    expect(catalogPhotoContentType({ name: `IMG_0001.HEIC`, type: `` })).toBe(`image/heic`)
    expect(catalogPhotoContentType({ name: `a.png`, type: `image/png` })).toBe(`image/png`)
  })
})
