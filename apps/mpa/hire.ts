// Seed's own site: see docs/start-a-product.md
import { AUTHOR_URL } from "./brand.ts"
import { catalogPrice } from "./components/catalog.tsx"

/**
 * What hiring Anton costs, as antonshubin.com lists it (checked on 2026-10-16). Amounts are
 * US cents; `/pricing` writes them with {@link hirePrice}, so a change of price is one edit here and one on antonshubin.com.
 */
export const HIRE_PRICES = {
  mvpFrom: 800_000,
  /** Weeks from the start to a live product, at the least. */
  mvpWeeks: 3,
  hourly: 15_000,
  retainerFrom: 300_000,
  strategySession: 15_000,
} as const

/** The currency of {@link HIRE_PRICES}. */
export const HIRE_CURRENCY = `USD`

/**
 * A hire price in US cents as the page's language writes it, in whole dollars: `US$8,000` in
 * English (British, like the rest of the site), `8.000 $` in German. A price with cents throws, since it would show rounded.
 */
export function hirePrice(cents: number, language: string): string {
  // `decimals: 0` reads the amount as whole dollars, so no `.00` follows a round price.
  return catalogPrice(cents / 100, HIRE_CURRENCY, language, { decimals: 0 })
}

/** Tags a link to antonshubin.com with where the visitor came from, for its lead log. */
const FROM_SEED = `utm_source=seedsaas&utm_medium=referral&utm_campaign=mvp`

/**
 * antonshubin.com's page for the MVP offer: a product built on Seed, from idea to production. Every
 * "hire me" link on this site goes there, and `/mvp` answers a 301 to it.
 */
export const HIRE_PAGE_URL = `${AUTHOR_URL}/catalog/zero-to-production-saas-mvp?${FROM_SEED}`
