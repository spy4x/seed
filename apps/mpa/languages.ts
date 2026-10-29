/**
 * The website's languages (#276): which ones it serves, at which address, and the translator of
 * each. The language comes from the address alone: English (the default) at `/pricing`, every
 * other language under its own prefix, `/de/pricing`. No cookie, no redirect by the browser's
 * language, so a shared link opens in the language it was shared in and crawlers see every version.
 *
 * A product whose main language is not English, or that adds one, changes `LANGUAGES` and
 * `DEFAULT_LANGUAGE` in `libs/domain/identity/preferences.ts`, and gives each language a catalog
 * set in {@link CATALOGS} here.
 *
 * @module
 */
import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { DEFAULT_LANGUAGE, type Language, LANGUAGES } from "@domain/identity"
import uiEn from "@spy4x/preact-ui/i18n/en"
import uiRu from "@spy4x/preact-ui/i18n/ru"
import uiEs from "@spy4x/preact-ui/i18n/es"
import uiDe from "@spy4x/preact-ui/i18n/de"
import uiPtBr from "@spy4x/preact-ui/i18n/pt-BR"
import uiAr from "@spy4x/preact-ui/i18n/ar"
import systemEn from "@spy4x/preact-system/i18n/en"
import systemRu from "@spy4x/preact-system/i18n/ru"
import systemEs from "@spy4x/preact-system/i18n/es"
import systemDe from "@spy4x/preact-system/i18n/de"
import systemPtBr from "@spy4x/preact-system/i18n/pt-BR"
import systemAr from "@spy4x/preact-system/i18n/ar"
import siteEn from "@i18n/site/en.json" with { type: "json" }
import siteRu from "@i18n/site/ru.json" with { type: "json" }
import siteEs from "@i18n/site/es.json" with { type: "json" }
import siteDe from "@i18n/site/de.json" with { type: "json" }
import sitePtBr from "@i18n/site/pt-BR.json" with { type: "json" }
import siteAr from "@i18n/site/ar.json" with { type: "json" }

/** The languages the website is served in, the default first. */
export const SITE_LANGUAGES: readonly Language[] = LANGUAGES

/**
 * The language served without a prefix, and the one `x-default` points at: the product's main
 * language, set in `libs/domain/identity/preferences.ts`.
 */
export { DEFAULT_LANGUAGE }

/** The website's own catalogs per language: the components' words, then the site's. */
const CATALOGS: Record<Language, readonly [Catalog, Catalog, Catalog]> = {
  en: [uiEn, systemEn, siteEn],
  ru: [uiRu, systemRu, siteRu],
  es: [uiEs, systemEs, siteEs],
  de: [uiDe, systemDe, siteDe],
  "pt-BR": [uiPtBr, systemPtBr, sitePtBr],
  ar: [uiAr, systemAr, siteAr],
}

/** The Open Graph locale of each language, as `og:locale` names it. */
const OG_LOCALES: Record<Language, string> = {
  en: `en_US`,
  ru: `ru_RU`,
  es: `es_ES`,
  de: `de_DE`,
  "pt-BR": `pt_BR`,
  ar: `ar_AR`,
}

/** True for a language the website serves, compared exactly: `PT-br` is not `pt-BR`. */
export function isSiteLanguage(value: unknown): value is Language {
  return typeof value === `string` && (SITE_LANGUAGES as readonly string[]).includes(value)
}

/**
 * What the address's language segment asks for: `serve` a language (no segment is the default
 * one), `redirect` for the default language's own prefix (`/en/pricing`, which exists once, at
 * `/pricing`), or `missing` for anything else, which answers 404. Nothing reads the segment before
 * this check.
 */
export function segmentLanguage(
  segment: string | undefined,
): { kind: `serve`; language: Language } | { kind: `redirect` } | { kind: `missing` } {
  if (segment === undefined) return { kind: `serve`, language: DEFAULT_LANGUAGE }
  if (segment === DEFAULT_LANGUAGE) return { kind: `redirect` }
  if (isSiteLanguage(segment)) return { kind: `serve`, language: segment }
  return { kind: `missing` }
}

/**
 * The language of an address and the page's path within it: `/de/pricing` is German `/pricing`.
 * An address whose first segment is no served language, or is the default language's, is the
 * default language's, path unchanged.
 */
export function pathLanguage(pathname: string): { language: Language; path: string } {
  const segment = pathname.split(`/`)[1]
  if (segment !== DEFAULT_LANGUAGE && isSiteLanguage(segment)) {
    return { language: segment, path: pathname.slice(segment.length + 1) || `/` }
  }
  return { language: DEFAULT_LANGUAGE, path: pathname }
}

/**
 * The address of the page at `path` in `language`: `/pricing` stays `/pricing` in the default
 * language and becomes `/de/pricing` in German. The home page in German is `/de`. A fragment or a
 * query stays where it is: `/#status` becomes `/de#status`.
 */
export function localePath(language: Language, path: string): string {
  if (language === DEFAULT_LANGUAGE) return path
  if (path === `/` || path.startsWith(`/#`) || path.startsWith(`/?`)) {
    return `/${language}${path.slice(1)}`
  }
  return `/${language}${path}`
}

/** The Open Graph locale of `language`, such as `de_DE`. */
export function ogLocale(language: Language): string {
  return OG_LOCALES[language]
}

const translators = new Map<Language, Translator<string>>()

/**
 * The translator of the website in `language`: the components' catalogs, then the site's own. A
 * message missing in `language` falls back to English.
 */
export function siteTranslator(language: Language): Translator<string> {
  let translator = translators.get(language)
  if (!translator) {
    const [ui, system, site] = CATALOGS[language]
    const [uiSource, systemSource, siteSource] = CATALOGS.en
    translator = createTranslator({
      language,
      catalogs: [
        { source: uiSource, translation: language === `en` ? undefined : ui },
        { source: systemSource, translation: language === `en` ? undefined : system },
        { source: siteSource, translation: language === `en` ? undefined : site },
      ],
    })
    translators.set(language, translator)
  }
  return translator
}

/**
 * Every served language by its name in `language`, as one list: "English, Russian, Spanish, German,
 * Brazilian Portuguese and Arabic" in English.
 */
export function languageList(language: Language): string {
  const names = new Intl.DisplayNames([language], { type: `language` })
  return new Intl.ListFormat(language, { type: `conjunction` })
    .format(SITE_LANGUAGES.map((tag) => names.of(tag) ?? tag))
}
