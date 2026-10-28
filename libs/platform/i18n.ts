/**
 * The interface language of an app (#216), shared by the SPA and the admin app: which language to
 * show, the choice this device keeps, and the translator built from the catalogs of the language
 * shown. Each app lists its own catalogs: its English ones, bundled, and one loader per language,
 * a fixed `import()` each, so the build makes one chunk per language and loads only the one shown.
 *
 * Only a member of the app's language list ever selects a loader: a stored or kept value is
 * checked against the list first, and anything else is English.
 *
 * @module
 */

import { signal } from "@preact/signals"
import {
  type Catalog,
  createTranslator,
  negotiateLanguage,
  type Translator,
} from "@spy4x/platform/universal/i18n"

/** One language's catalogs, in the order the app lists its namespaces (the library's first). */
export type CatalogList = readonly Catalog[]

/** Where this device keeps the language chosen on it. */
export const LANGUAGE_STORAGE_KEY = `language`

/**
 * The language to show: the person's stored choice, else the one kept on this device, else the
 * best match of the browser's languages, else English. A value off the list counts as no choice.
 */
export function pickLanguage<Language extends string>(
  languages: readonly Language[],
  stored: string | null | undefined,
  kept: string | null | undefined,
  requested: readonly string[] | undefined,
): Language {
  const fallback = languages[0]
  for (const choice of [stored, kept]) {
    const listed = languages.find((language) => language === choice)
    if (listed) return listed
  }
  return negotiateLanguage(requested ?? [], languages, fallback)
}

/** The device's copy of the chosen language: `localStorage`, or nothing when it is blocked. */
export interface KeptLanguage {
  read(): string | null
  write(language: string | null): void
}

/** {@link KeptLanguage} in `storage`; every failure of a blocked storage reads as no choice. */
export function keptLanguage(storage: () => Storage | undefined): KeptLanguage {
  return {
    read() {
      try {
        return storage()?.getItem(LANGUAGE_STORAGE_KEY) ?? null
      } catch (_error) {
        return null
      }
    },
    write(language) {
      try {
        if (language === null) storage()?.removeItem(LANGUAGE_STORAGE_KEY)
        else storage()?.setItem(LANGUAGE_STORAGE_KEY, language)
      } catch (_error) {
        // Blocked storage: the device keeps no choice, and the browser's languages decide.
      }
    },
  }
}

/** Options of {@link createLanguages}. */
export interface LanguagesOptions<Language extends string> {
  /** The languages the app ships, English first. */
  languages: readonly Language[]
  /** The English catalogs, bundled: every translator's source. */
  english: CatalogList
  /** One loader per other language, each a fixed `import()` of that language's catalog list. */
  loaders: { readonly [Tag in Exclude<Language, `en`>]: () => Promise<{ default: CatalogList }> }
  /** The page whose `<html lang dir>` follows the language; left out in tests without a page. */
  root?: () => HTMLElement | undefined
}

/**
 * The app's translator, as a signal the `I18nContext` provider reads. {@link use} loads a
 * language's catalogs and switches to it once they are there, so the screen never shows a half
 * loaded language: the old one stays until the new one is ready, and stays when loading fails.
 */
export function createLanguages<Language extends string>(options: LanguagesOptions<Language>) {
  const { languages, english } = options
  const loaded = new Map<string, CatalogList>()
  let numberLocale: string | undefined

  const build = (language: string): Translator<string> =>
    createTranslator({
      language,
      numberLocale,
      catalogs: english.map((source, index) => ({
        source,
        translation: loaded.get(language)?.[index],
      })),
    })

  const translator = signal<Translator<string>>(build(languages[0]))
  /** The language being loaded, while it is. */
  const loading = signal<Language | null>(null)
  /** The language whose catalogs could not be loaded (offline, say); cleared by the next switch. */
  const failed = signal<Language | null>(null)
  /** The language asked for last: an answer for an older request never switches. */
  let wanted: string = languages[0]

  const show = (next: Translator<string>) => {
    translator.value = next
    const root = options.root?.()
    if (!root) return
    root.lang = next.language
    root.dir = next.dir
  }

  /**
   * Switch to `language` once its catalogs are loaded; a value off the list switches to English.
   * Resolves to whether the language is shown now.
   */
  async function use(language: string): Promise<boolean> {
    const target = languages.find((listed) => listed === language) ?? languages[0]
    wanted = target
    failed.value = null
    const needsLoad = target !== languages[0] && !loaded.has(target)
    loading.value = needsLoad ? target : null
    if (needsLoad) {
      try {
        const loader = options.loaders[target as Exclude<Language, `en`>]
        loaded.set(target, (await loader()).default)
      } catch (_error) {
        if (wanted === target) {
          failed.value = target
          loading.value = null
        }
        return false
      }
      if (wanted !== target) return false
      loading.value = null
    }
    if (translator.peek().language !== target) show(build(target))
    else show(translator.peek())
    return true
  }

  /** Numbers inside messages follow the region format, not the language: rebuilds on a change. */
  function setNumberLocale(locale: string | undefined): void {
    if (locale === numberLocale) return
    numberLocale = locale
    show(build(translator.peek().language))
  }

  return { translator, loading, failed, use, setNumberLocale }
}

export type Languages = ReturnType<typeof createLanguages>

/**
 * What the language setting (`LanguageDialog`, the account menu's entry) reads and calls: the
 * shape of `AccountMenuLanguage` from `@spy4x/preact-system/account-menu`.
 */
export interface LanguageSetting<Language extends string> {
  languages: readonly Language[]
  /** The language chosen, or `null` when it follows the device. */
  current: Language | null
  /** What "Automatic" shows now. */
  automatic: Language
  /** The language loading after a choice; left out while none is. */
  pending?: Language
  /** The language that failed to load (offline, say), named in an error. */
  failed?: Language
  onSelect(tag: string | null): void
}

/**
 * The language setting's props, from the app's choice and its {@link createLanguages}. A tag the
 * picker passes is checked against the list again: only a listed language or `null` (Automatic)
 * reaches `choose`.
 */
export function languageSetting<Language extends string>(
  { languages, current, automatic, loading, failed, choose }: {
    languages: readonly Language[]
    current: Language | null
    automatic: Language
    loading: Language | null
    failed: Language | null
    choose(language: Language | null): void
  },
): LanguageSetting<Language> {
  return {
    languages,
    current,
    automatic,
    // The picker reads `null` as "Automatic is loading": nothing loading is `undefined`.
    pending: loading ?? undefined,
    failed: failed ?? undefined,
    onSelect(tag) {
      if (tag === null) return choose(null)
      const listed = languages.find((language) => language === tag)
      if (listed) choose(listed)
    },
  }
}
