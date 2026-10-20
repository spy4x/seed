// Seed's own site: see docs/start-a-product.md
import { AUTHOR_URL } from "./brand.ts"

/**
 * What hiring Anton costs, as antonshubin.com lists it (checked on 2026-10-16). `/pricing` reads
 * these, so a change of price is one edit here and one on antonshubin.com.
 */
export const HIRE_PRICES = {
  mvpFrom: `$8,000`,
  mvpWeeks: `3 weeks`,
  hourly: `$150`,
  retainerFrom: `$3,000`,
  strategySession: `$150`,
} as const

/** Tags a link to antonshubin.com with where the visitor came from, for its lead log. */
const FROM_SEED = `utm_source=seedsaas&utm_medium=referral&utm_campaign=mvp`

/**
 * antonshubin.com's page for the MVP offer: a product built on Seed, from idea to production. Every
 * "hire me" link on this site goes there, and `/mvp` answers a 301 to it.
 */
export const HIRE_PAGE_URL = `${AUTHOR_URL}/catalog/zero-to-production-saas-mvp?${FROM_SEED}`
