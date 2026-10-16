import { AUTHOR_URL } from "./brand.ts"

/**
 * What hiring Anton costs, as antonshubin.com lists it (checked on 2026-10-16). `/pricing` and
 * `/mvp` both read these, so a change of price is one edit here and one on antonshubin.com.
 */
export const HIRE_PRICES = {
  /** The starting price of an MVP built on Seed, in US dollars. */
  mvpFromUsd: 8_000,
  mvpFrom: `$8,000`,
  mvpWeeks: `3 weeks`,
  hourly: `$150`,
  retainerFrom: `$3,000`,
  strategySession: `$150`,
} as const

/** Tags a link to antonshubin.com with where the visitor came from, for its lead log. */
const FROM_SEED = `utm_source=seedsaas&utm_medium=referral&utm_campaign=mvp`

/** antonshubin.com's booking page: the calendar for a free 30-minute call. */
export const BOOK_CALL_URL = `${AUTHOR_URL}/book?${FROM_SEED}`

/** The written-brief form on the same booking page, for a founder who prefers to write. */
export const BRIEF_URL = `${BOOK_CALL_URL}#brief`

/** Anton's Upwork profile: where the reviews and the figures quoted on `/mvp` can be checked. */
export const UPWORK_URL = `https://www.upwork.com/freelancers/ashubin`
