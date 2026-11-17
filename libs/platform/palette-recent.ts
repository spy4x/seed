import { browserStorage } from "@spy4x/platform/browser/storage"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"
import {
  clearCommandPaletteRecent,
  type CommandPaletteRecent,
} from "@spy4x/preact-ui/command-palette"

/**
 * Where the search palette keeps its recent picks on this device. The SPA and the admin app run on
 * hosts of their own, so each has its own copy under this key.
 */
export const PALETTE_RECENT_KEY = "seed:palette-recent"

/** The palette's `recent` setting, and the way to forget what it kept. */
export interface PaletteRecent extends CommandPaletteRecent {
  /** Forgets the recent picks, as a sign-out must, so the next person sees none. Never throws. */
  forget(): void
}

/**
 * The palette's recent picks kept in `storage` (`browserStorage()` in an app, which never throws
 * and keeps a refused write in memory, so {@link PaletteRecent.forget} goes through it too).
 */
export function createPaletteRecent(storage: KeyValueStore): PaletteRecent {
  return {
    storageKey: PALETTE_RECENT_KEY,
    storage: () => storage,
    forget: () => clearCommandPaletteRecent(PALETTE_RECENT_KEY, () => storage),
  }
}

/** This device's recent palette picks, for the app that runs on this page. */
export const paletteRecent = createPaletteRecent(browserStorage())
