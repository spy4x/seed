import { signal } from "@preact/signals"
import { activeShortcuts, useHotkeys } from "@spy4x/preact-ui/hotkeys"
import { browserStorage } from "@spy4x/platform/browser/storage"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"

/** A shortcut to bind: its presses, such as `"?"` or `"g n"`, and what they do. */
export interface BoundShortcut {
  keys: string
  run?: () => void
}

/**
 * Binds every row with `run` through preact-ui's `useHotkeys`, and, while `singleKeys` is off,
 * only the rows that are not single keys (`activeShortcuts`): Ctrl K and Escape keep working, `?`,
 * `/`, `n` and the `g` sequences do not. A row without `run` is listed only. `useHotkeys` leaves
 * fields, input methods, dialogs, menus and an open modal alone, and `g` alone waits for the next
 * key.
 *
 * @param rows The app's shortcuts.
 * @param singleKeys Whether single-key shortcuts are on, on this device.
 */
export function useShortcuts(rows: readonly BoundShortcut[], singleKeys: boolean): void {
  useHotkeys(
    activeShortcuts(rows, singleKeys).flatMap(({ keys, run }) =>
      run ? [{ keys, handler: () => run() }] : []
    ),
  )
}

/** Where the single-key setting is kept on this device. */
export const SINGLE_KEYS_KEY = "seed:single-key-shortcuts"

/**
 * The single-key switch of this device, kept in `storage` (`browserStorage()` in an app, which
 * never throws). On unless it was turned off here; nothing is sent to the server.
 */
export function createSingleKeysSetting(storage: KeyValueStore) {
  const on = signal(storage.getItem(SINGLE_KEYS_KEY) !== "off")
  return {
    on,
    set(value: boolean): void {
      on.value = value
      if (value) storage.removeItem(SINGLE_KEYS_KEY)
      else storage.setItem(SINGLE_KEYS_KEY, "off")
    },
  }
}

/** This device's single-key switch, shared by every app of the product: the SPA and the admin app. */
export const singleKeys = createSingleKeysSetting(browserStorage())

/**
 * Whether the device has a fine pointer, so a keyboard is likely: the account menu lists
 * "Keyboard shortcuts" only then. Read when asked, and true where the browser cannot say.
 */
export function hasFinePointer(): boolean {
  return globalThis.matchMedia?.("(any-pointer: fine)").matches ?? true
}
