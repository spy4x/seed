import { effect, type ReadonlySignal, signal, untracked } from "@preact/signals"
import type { SettingsSaveOutcome } from "@spy4x/preact-signals/settings"
import { isLanguage, type Language, LANGUAGES, type Preferences } from "@domain/identity"
import { type KeptLanguage, pickLanguage } from "@platform/i18n.ts"

/** What the language follows: the slice of the preferences state it reads and saves. */
export interface LanguagePreferences {
  loaded: ReadonlySignal<boolean>
  value: ReadonlySignal<Preferences>
  version: ReadonlySignal<number>
  save(patch: Partial<Preferences>): Promise<SettingsSaveOutcome<Preferences>>
}

/** What the sync needs from the outside. Injected so tests need no page and no socket. */
export interface LanguageSyncDependencies {
  preferences: LanguagePreferences
  /** Switches the page's translator; resolves to whether the language is shown now. */
  use(language: Language): Promise<boolean>
  kept: KeptLanguage
  /** The browser's languages, most preferred first (`navigator.languages`). */
  requested(): readonly string[]
  /** The region format the numbers in messages follow. */
  numberLocale: ReadonlySignal<string>
  setNumberLocale(locale: string): void
}

/**
 * The SPA's language (#216), as the preferences decide it: the person's stored choice, else the one
 * kept on this device, else the browser's languages, else English. Signed out, the device's choice
 * decides. The device keeps a copy of every saved choice, so the sign-in page after a sign-out
 * speaks it too. A record never saved (version `0`, a new account) takes the choice this device made
 * before signing in, as the theme does.
 *
 * @returns `current`, the choice the language setting shows checked (`null`: follow this device),
 *   `choose`, which the setting calls, and a disposer.
 */
export function syncLanguage(dependencies: LanguageSyncDependencies) {
  const { preferences, kept } = dependencies
  const show = (stored: Language | null) =>
    dependencies.use(pickLanguage(LANGUAGES, stored, kept.read(), dependencies.requested()))
  const listed = (value: string | null) => isLanguage(value) ? value : null
  const current = signal<Language | null>(listed(kept.read()))
  /** Whether this sign-in already offered the device's choice to a record never saved. */
  let offered = false

  const stopRecord = effect(() => {
    const loaded = preferences.loaded.value
    const stored = preferences.value.value.language
    const version = preferences.version.value
    untracked(() => {
      if (!loaded) {
        offered = false
        current.value = listed(kept.read())
        return void show(null)
      }
      const local = kept.read()
      if (version === 0 && stored === null && isLanguage(local) && !offered) {
        // Once per sign-in: a save that fails offline is not sent again in a loop. The save shows
        // at once and runs this again with the choice stored.
        offered = true
        void preferences.save({ language: local })
        return
      }
      if (version > 0 && stored !== local) kept.write(stored)
      current.value = stored
      void show(stored)
    })
  })

  const stopNumbers = effect(() => dependencies.setNumberLocale(dependencies.numberLocale.value))

  /**
   * The person chose `language` (`null`: follow this device): this device keeps it, and while
   * signed in it is saved for every device. Resolves to whether the language is shown now.
   */
  function choose(language: Language | null): Promise<boolean> {
    kept.write(language)
    current.value = language
    if (preferences.loaded.peek()) void preferences.save({ language })
    return show(language)
  }

  return {
    current: current as ReadonlySignal<Language | null>,
    choose,
    stop: () => {
      stopRecord()
      stopNumbers()
    },
  }
}
