import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SITE_LANGUAGES, siteTranslator } from "./languages.ts"

// The home hero's badge cannot wrap (`whitespace-nowrap`), so a long translation runs off a phone.
const BADGE_MAX = 30

describe("the home hero's badge", () => {
  it(`stays within ${BADGE_MAX} characters in every language of the site`, () => {
    // An empty language list would pass silently.
    expect(SITE_LANGUAGES.length).toBeGreaterThan(1)
    for (const language of SITE_LANGUAGES) {
      const badge = siteTranslator(language).t(`HomeHero.badge`)
      expect([...badge].length, `${language}: ${badge}`).toBeLessThanOrEqual(BADGE_MAX)
    }
  })
})
