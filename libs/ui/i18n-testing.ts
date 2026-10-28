/**
 * Translators and a check for the screens' tests (#275): the catalogs' English, and the `en-XA`
 * pseudo-language, for the product's screens and for the operator area's. Every catalog message of
 * the pseudo-language is wrapped in `⟦ ⟧`, so a screen rendered in it shows no English outside
 * those marks except data: a name, an address, a date. {@link englishLeft} lists what is left,
 * which is English that skipped the catalog.
 *
 * @module
 */
import {
  type Catalog,
  createTranslator,
  pseudoLocalize,
  type Translator,
} from "@spy4x/platform/universal/i18n"
import ui from "@spy4x/preact-ui/i18n/en"
import system from "@spy4x/preact-system/i18n/en"
import charts from "@spy4x/preact-charts/i18n/en"
import app from "@i18n/app/en.json" with { type: "json" }
import admin from "@i18n/admin/en.json" with { type: "json" }
import errors from "@i18n/errors/en.json" with { type: "json" }

/**
 * The catalogs each app loads, in the order it lists them (`apps/spa/src/i18n.ts`,
 * `apps/admin/src/i18n.ts`). The state catalog (`@spy4x/preact-signals`) is left out: no screen
 * reads it, and `libs/ui` takes no store package.
 */
const PRODUCT = [ui, system, charts, app, errors] as Catalog[]
const OPERATOR = [ui, system, charts, app, admin, errors] as Catalog[]

function english(catalogs: Catalog[]): Translator<string> {
  return createTranslator({ language: `en`, catalogs: catalogs.map((source) => ({ source })) })
}

function pseudo(catalogs: Catalog[]): Translator<string> {
  return createTranslator({
    language: `en-XA`,
    catalogs: catalogs.map((source) => ({ source, translation: pseudoLocalize(source) })),
  })
}

/** The product's words in English, for a test that calls a function taking a translator. */
export const ENGLISH: Translator<string> = english(PRODUCT)

/** The product's words in `en-XA`, as the SPA would load them. */
export const PSEUDO: Translator<string> = pseudo(PRODUCT)

/** The operator area's words in English, the product's included: it draws parts of its screens. */
export const ADMIN_ENGLISH: Translator<string> = english(OPERATOR)

/** The operator area's words in `en-XA`, as the admin app would load them. */
export const ADMIN_PSEUDO: Translator<string> = pseudo(OPERATOR)

/**
 * What `Intl` writes in the person's region format, which is theirs to choose apart from the
 * language: dates, times, relative times and sizes. A test's formatter is English.
 */
const MONTH = `(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?`
const TIME = `\\d{1,2}:\\d{2}(:\\d{2})?( ?[aApP]\\.?[mM]\\.?)?( [A-Z]{2,5}([+−-]\\d+)?)?`
const FORMATTED: readonly RegExp[] = [
  // Day first (en-GB, "1 Oct 2026, 10:00:00 UTC") and month first (en-US, "Oct 1, 2026, 6:00 AM
  // EDT"): the host's locale and time zone pick the form, so both count.
  new RegExp(`\\b\\d{1,2} ${MONTH}( \\d{4})?(,? ${TIME})?`, `g`),
  new RegExp(`\\b${MONTH} \\d{1,2}(, \\d{4})?(,? ${TIME})?`, `g`),
  new RegExp(`\\b${TIME}`, `g`),
  /\b(\d+|an?) (second|minute|hour|day|week|month|year)s? ago\b/g,
  /\bin (\d+|an?) (second|minute|hour|day|week|month|year)s?\b/g,
  /\b(yesterday|today|tomorrow|now)\b/gi,
  /\b\d+(\.\d+)? (B|kB|KB|MB|GB|TB)\b/g,
]

/** Where a page shows data as it is: a date in `<time>`, and content marked not to translate. */
const DATA_PLACES = `script, style, time, [translate="no"]`

/**
 * The English words a person reads under `root` outside the pseudo-language's marks: its text and
 * the names and hints in its attributes. `data` lists what the screen shows as it is (a person's
 * name, an address, a code), which is never translated; what `Intl` formats counts as data too.
 * An empty list means every word went through a catalog.
 */
export function englishLeft(root: Element, data: readonly (string | RegExp)[] = []): string[] {
  const texts: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(DATA_PLACES)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of root.querySelectorAll(`*`)) {
    if (element.closest(DATA_PLACES)) continue
    for (const name of [`aria-label`, `placeholder`, `title`, `label`]) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts.map((text) => text.trim()).filter((text) => {
    let rest = text
    for (const value of [...data, ...FORMATTED]) rest = rest.replaceAll(value, ``)
    // Whole messages, innermost first: a message can hold another as a value.
    for (let before = ``; before !== rest;) {
      before = rest
      rest = rest.replaceAll(/⟦[^⟦⟧]*⟧/g, ``)
    }
    // A message split around a value or a tag spans several nodes: `⟦… ` before it, ` …⟧` after.
    rest = rest.replace(/^[^⟦]*⟧/, ``).replace(/⟦[^⟧]*$/, ``)
    // The parts between hold pseudo-text too, whose vowels carry accents. English is a word of
    // plain letters only.
    return /(?<!\p{L})[A-Za-z]{2,}(?!\p{L})/u.test(rest)
  })
}
