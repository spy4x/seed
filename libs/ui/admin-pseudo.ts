/**
 * The operator area's screens in English and in the `en-XA` pseudo-language, for the happy-dom
 * tests (#275). The
 * pseudo-language wraps every catalog message in `⟦ ⟧`, so English left in a screen's code, past
 * the catalog, stands out: {@link englishLeft} lists it.
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
import signals from "@spy4x/preact-signals/i18n/en"
import charts from "@spy4x/preact-charts/i18n/en"
import admin from "@i18n/admin/en.json" with { type: "json" }

/** The admin app's catalogs, in the order the app lists them. */
const CATALOGS = [ui, system, signals, charts, admin] as Catalog[]

/** The admin app's words in English, as a screen's helper takes them. */
export const ADMIN_ENGLISH: Translator<string> = createTranslator({
  language: `en`,
  catalogs: CATALOGS.map((source) => ({ source })),
})

/** The admin app's words in `en-XA`. */
export const ADMIN_PSEUDO: Translator<string> = createTranslator({
  language: `en-XA`,
  catalogs: CATALOGS.map((source) => ({
    source,
    translation: pseudoLocalize(source),
  })),
})

/**
 * The English words a person reads under `root` outside the pseudo-language's marks: its text and
 * the names and hints in its attributes. `data` lists what the screen shows as it is (a person's
 * name, an address, a code), which is never translated.
 */
export function englishLeft(root: Element, data: readonly string[] = []): string[] {
  const texts: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Content marked as not to translate is data: a post's text, a slug, a key.
    if (node.parentElement?.closest(`script, style, [translate="no"]`)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of root.querySelectorAll(`*`)) {
    if (element.closest(`[translate="no"]`)) continue
    for (const name of [`aria-label`, `placeholder`, `title`]) {
      const value = element.getAttribute(name)
      if (value) texts.push(value)
    }
  }
  return texts.map((text) => text.trim()).filter((text) => {
    // A message split around a value spans several nodes: `⟦… ` before it, ` …⟧` after.
    let rest = text.replaceAll(/⟦[^⟧]*(⟧|$)/g, ``).replace(/^[^⟦]*⟧/, ``)
    for (const value of data) rest = rest.replaceAll(value, ``)
    return /[A-Za-z]{2,}/.test(rest)
  })
}
