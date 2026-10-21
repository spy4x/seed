// Seed's own site: see docs/start-a-product.md
/** The product this website promotes, as every page names it. */
export const SITE_NAME = `Seed`

/**
 * Where the source lives: the "View on GitHub" links and the footer point here.
 */
export const REPOSITORY_URL = `https://github.com/spy4x/seed`

/**
 * The website's way into the app (#224): every "try" button opens the app's `/try`, which starts
 * a guest account with one click. `label` is the button, `line` the sentence under the hero's.
 * A product built on Seed without the public demo says `Try it now` and
 * `No account needed. Add a sign-in method later to keep your work.`
 */
export const TRY_ENTRY = {
  label: `Try the live demo`,
  line:
    `No sign-up. The demo opens as a guest account with sample data, and it is wiped every night.`,
} as const

/** The author's own site: the person behind Seed in JSON-LD and the "who builds it" links. */
export const AUTHOR_URL = `https://antonshubin.com`
