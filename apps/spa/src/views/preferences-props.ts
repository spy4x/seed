import { useState } from "preact/hooks"
import type { PreferencesGroupProps } from "@ui/preferences.tsx"
import { PREFERENCES_FAILURES } from "@ui/preferences.tsx"
import { preferencesState } from "../state/preferences.ts"
import { themeStore } from "../state/theme.ts"

/**
 * The props of the profile page's "Language and region" group, wired to the page's preferences
 * store and theme store. The theme row writes the theme store, which saves to the server and paints
 * at once, offline too; the dialog's Save waits for the server's answer, on the version its values
 * were made on, and is refused at once without a connection.
 */
export function usePreferencesProps(): PreferencesGroupProps {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    onTheme: (theme) => themeStore.set(theme as Parameters<typeof themeStore.set>[0]),
    onSave: async (next, baseVersion) => {
      setError(null)
      state.dismissConflict()
      setPending(true)
      const outcome = await state.saveDraft(baseVersion, next)
      setPending(false)
      if (outcome.ok || outcome.reason === `conflict`) return
      setError(PREFERENCES_FAILURES[outcome.reason === `failed` ? `network` : outcome.reason])
    },
    onUseDeviceZone: () => void state.useDeviceZone(),
    onKeepZone: state.keepZone,
    onCloseDialog: () => {
      setError(null)
      state.dismissConflict()
    },
  }
}
