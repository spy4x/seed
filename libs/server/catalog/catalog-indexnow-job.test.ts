import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { catalogItemUrls, itemPageChanged } from "./catalog-indexnow-job.ts"
import { DEFAULT_ITEM_PATH } from "./tracking.ts"

const SITE = `https://www.example.com`
const ITEM = { slug: `zip-jacket`, categorySlug: `jackets` }

describe(`catalogItemUrls`, () => {
  it(`names the item's page in the default language only, for an English-only catalog`, () => {
    expect(catalogItemUrls(ITEM, { itemPath: DEFAULT_ITEM_PATH, languages: [`en`] }, SITE))
      .toEqual([`${SITE}/jackets/zip-jacket`])
  })

  it(`adds each site language the catalog keeps, in the site's order, as the sitemap lists them`, () => {
    const pages = { itemPath: DEFAULT_ITEM_PATH, languages: [`vi`, `de`, `en`] }
    expect(catalogItemUrls(ITEM, pages, SITE)).toEqual([
      `${SITE}/jackets/zip-jacket`,
      `${SITE}/de/jackets/zip-jacket`,
    ])
  })

  it(`follows the product's own item address`, () => {
    expect(catalogItemUrls(ITEM, { itemPath: `/shop/{slug}`, languages: [`en`] }, SITE))
      .toEqual([`${SITE}/shop/zip-jacket`])
  })
})

describe(`itemPageChanged`, () => {
  const before = {
    price: 450_000,
    slug: `zip-jacket`,
    categoryId: `c1`,
    soldOut: [{ colourId: `red`, sizeId: `s` }, { colourId: `blue`, sizeId: null }],
  }

  it(`is true for a new price, sold-out combination, slug or category`, () => {
    expect(itemPageChanged(before, { ...before, price: 400_000 })).toBe(true)
    expect(itemPageChanged(before, { ...before, soldOut: before.soldOut.slice(1) })).toBe(true)
    expect(itemPageChanged(before, { ...before, slug: `jacket` })).toBe(true)
    expect(itemPageChanged(before, { ...before, categoryId: `c2` })).toBe(true)
  })

  it(`is false when only the order of the same sold-out combinations differs`, () => {
    expect(itemPageChanged(before, { ...before, soldOut: [...before.soldOut].reverse() }))
      .toBe(false)
  })
})
