// Seed's own site: see docs/start-a-product.md
import { IconSprout } from "@spy4x/preact-icons"

/** The product this website promotes, as every page names it. */
export const SITE_NAME = `Seed`

/** The product's icon, drawn beside `SITE_NAME` in every brand mark of the website. */
export const SITE_ICON = IconSprout

/**
 * Where the source lives: the "View on GitHub" links and the footer point here.
 */
export const REPOSITORY_URL = `https://github.com/spy4x/seed`

/**
 * The website's way into the app (#224): every "try" button opens the app's `/try`, which starts
 * a guest account with one click. `label` is the button, `line` the sentence under the hero's,
 * each a key of the `site` catalog (`i18n/site`). A product built on Seed without the public demo
 * says `Try it now` and `No account needed. Add a sign-in method later to keep your work.` there.
 */
export const TRY_ENTRY = {
  label: `TryEntry.label`,
  line: `TryEntry.line`,
} as const

/** The author's own site: the person behind Seed in JSON-LD and the "who builds it" links. */
export const AUTHOR_URL = `https://antonshubin.com`

/** An address of the app as the pictures' browser frames show it, the same in every language. */
export function appAddress(path: string): string {
  return `app.seedsaas.com${path}`
}
