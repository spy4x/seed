/**
 * The translator of the public website's words (the `site` namespace, #276): the MPA's pages and
 * the newsletter screens it renders. Inside the website it is the page's, from the nearest
 * `I18nContext`. Without a provider, as in a test that renders one screen, it is the site's
 * English. Inside the SPA, whose catalogs leave the site's words out, a key the app's translator
 * does not know reads in the site's English too, so a newsletter screen there never shows a key.
 *
 * @module
 */

import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { ENGLISH, useT } from "@spy4x/preact-ui/i18n"
import site from "@i18n/site/en.json" with { type: "json" }

let siteEnglish: Translator<string> | undefined

/** The site's English alone, for a test or a page rendered outside the website's frame. */
export function siteEnglishText(): Translator<string> {
  siteEnglish ??= createTranslator({ language: `en`, catalogs: [{ source: site }] })
  return siteEnglish
}

/** The translator of the website's pages and of the newsletter screens (the `site` namespace). */
export function useSiteText(): Translator<string> {
  const translator = useT()
  const english = siteEnglishText()
  if (translator === ENGLISH) return english
  return {
    language: translator.language,
    dir: translator.dir,
    // A translator answers a key it does not know with the key itself.
    t: (key, values) => {
      const text = translator.t(key, values)
      return text === key ? english.t(key, values) : text
    },
    parts: (key, values) => {
      const parts = translator.parts(key, values)
      return parts.length === 1 && parts[0] === key ? english.parts(key, values) : parts
    },
  }
}
