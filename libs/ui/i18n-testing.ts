/**
 * Translators for the screens' tests (#275): the `app` catalog's English, and the `en-XA`
 * pseudo-language. Every catalog message of the pseudo-language is
 * wrapped in `⟦ ⟧`, so a screen rendered with {@link PSEUDO} shows no English outside those marks
 * except data: a name, an address, a date. {@link untranslated} lists what is left, which is English
 * that skipped the catalog.
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
import app from "@i18n/app/en.json" with { type: "json" }

/** The `app` catalog's English, for a test that calls a function taking a translator. */
export const ENGLISH: Translator<string> = createTranslator({
  language: `en`,
  catalogs: [{ source: app }],
})

/** The library's catalogs and the `app` catalog, each in `en-XA`, as the SPA would load them. */
export const PSEUDO: Translator<string> = createTranslator({
  language: `en-XA`,
  catalogs: ([ui, system, app] as Catalog[]).map((source) => ({
    source,
    translation: pseudoLocalize(source),
  })),
})

/**
 * The text under `root` a person reads, text nodes and the names and hints in attributes, that is
 * neither pseudo-language nor one of `data`: an empty list when everything went through the
 * catalog.
 */
export function untranslated(root: Element, data: readonly string[] = []): string[] {
  const texts: string[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(`script, style`)) continue
    texts.push(node.textContent ?? ``)
  }
  for (const element of root.querySelectorAll(`*`)) {
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
