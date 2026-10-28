import { computed } from "@preact/signals"
import { kept, languages } from "../i18n.ts"
import { syncLanguage } from "./language.ts"
import { preferencesState } from "./preferences.ts"

/** The page's language, following the person's preferences; `choose` is the language setting. */
export const pageLanguage = syncLanguage({
  preferences: preferencesState,
  use: languages.use,
  kept,
  requested: () => globalThis.navigator?.languages ?? [],
  numberLocale: computed(() => preferencesState.format.value.locale),
  setNumberLocale: languages.setNumberLocale,
})
