import { useState } from "preact/hooks"
import type { PreferencesFailure, PreferencesProps } from "@ui/preferences.tsx"
import { preferencesState } from "../state/preferences.ts"
import { themeStore } from "../state/theme.ts"
import { languageChoice } from "./language-choice.ts"

/**
 * The props of the profile's "Language and region" and "Appearance" sections, wired to the
 * preferences store and the theme store. A theme choice writes the theme store, which saves to the
 * server and paints at once, offline too; a region change is saved as it is made, on the version
 * its values were made on, and is refused at once without a connection.
 */
export function usePreferencesProps(): PreferencesProps {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<PreferencesFailure | null>(null)
  const state = preferencesState

  return {
    value: state.value.value,
    device: state.device.value,
    systemTheme: themeStore.system.value,
    otherZone: state.otherZone.value,
    conflict: state.conflict.value,
    version: state.version.value,
    pending,
    error,
    announcement: state.announcement.value,
    now: new Date(),
    language: languageChoice(),
    onTheme: (theme) => themeStore.set(theme as Parameters<typeof themeStore.set>[0]),
    onSave: async (next, baseVersion) => {
      setError(null)
      state.dismissConflict()
      setPending(true)
      const outcome = await state.saveDraft(baseVersion, next)
      setPending(false)
      if (outcome.ok || outcome.reason === `conflict`) return
      setError(outcome.reason === `failed` ? `network` : outcome.reason)
    },
    onUseDeviceZone: () => void state.useDeviceZone(),
    onKeepZone: state.keepZone,
  }
}
