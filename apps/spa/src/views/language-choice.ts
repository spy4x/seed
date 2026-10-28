import { LANGUAGES } from "@domain/identity"
import { type LanguageSetting, languageSetting, pickLanguage } from "@platform/i18n.ts"
import type { Language } from "@domain/identity"
import { languages } from "../i18n.ts"
import { pageLanguage } from "../state/page-language.ts"

/**
 * The language setting (#216) wherever `LanguageDialog` opens: the preferences' Language row, the
 * account menu and the signed-out header. Read in a render, so the screen follows the choice, the
 * load and its failure.
 */
export function languageChoice(): LanguageSetting<Language> {
  return languageSetting({
    languages: LANGUAGES,
    current: pageLanguage.current.value,
    automatic: pickLanguage(LANGUAGES, null, null, globalThis.navigator?.languages),
    loading: languages.loading.value,
    failed: languages.failed.value,
    choose: (language) => void pageLanguage.choose(language),
  })
}
