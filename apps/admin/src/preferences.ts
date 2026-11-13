import { computed, signal } from "@preact/signals"
import type { StoredSettings } from "@spy4x/platform/universal/settings"
import { type Language, type Preferences, preferencesDefinition } from "@domain/identity"
import { createFormatters } from "@spy4x/time/format"
import { seedAutomaticLocale } from "@platform/i18n.ts"
import type { AdminFetch } from "./state.ts"

/** What "Automatic" region format is read from. Injected so tests need no browser. */
export interface OperatorLocale {
  /** The admin app's language shown now; read inside a computed, so a signal read follows it. */
  language(): string
  /** The device's locales, most preferred first: its own region format, then the browser's. */
  deviceLocales(): readonly string[]
}

/** Where the API answers the signed-in operator's own preferences. */
export const OWN_PREFERENCES_PATH = `/api/admin/me/preferences`

/**
 * The operator's own formatter: every date in the admin app follows the region format, time
 * zone and clock the operator chose in the product's app. Until the answer comes, or when it fails,
 * the device's own zone and clock are used, so a screen never waits on it. An "Automatic" region
 * format, and the one before the answer, is the device's in the admin app's language, else that
 * language's own region. The operator's chosen interface
 * language comes with it: `null` until it loads, and when they follow their device.
 */
export function createOperatorFormat(request: AdminFetch, locale: OperatorLocale) {
  const settings = signal<Preferences | null>(null)
  const format = computed(() =>
    createFormatters({
      ...settings.value,
      locale: settings.value?.locale ??
        seedAutomaticLocale(locale.language(), locale.deviceLocales()),
    })
  )
  const language = signal<Language | null>(null)
  /** Counts the loads, so an answer for a session that ended never lands in the next one. */
  let generation = 0

  /** Reads the operator's preferences; a failure keeps the device's format. */
  async function load(): Promise<void> {
    const mine = ++generation
    try {
      const answer = await request<StoredSettings>(OWN_PREFERENCES_PATH)
      if (mine !== generation || !answer.ok) return
      // `resolve` keeps only a record the schema accepts: a language off the list never gets here.
      const { value } = preferencesDefinition.resolve(answer.data)
      settings.value = value
      language.value = value.language
    } catch (_error) {
      // The network is down: the device's format stays.
    }
  }

  /** Signing out: back to the device's format. */
  function reset(): void {
    generation++
    settings.value = null
    language.value = null
  }

  return { format, language, load, reset }
}

export type OperatorFormat = ReturnType<typeof createOperatorFormat>
