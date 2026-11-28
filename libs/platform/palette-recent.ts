import { type ReadonlySignal, signal } from "@preact/signals"
import { browserStorage } from "@spy4x/platform/browser/storage"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"
import {
  addCommandPaletteRecent,
  clearCommandPaletteRecent,
  type CommandPaletteRecent,
} from "@spy4x/preact-ui/command-palette"

/**
 * Where the search palette keeps its recent picks on this device. The SPA and the admin app run on
 * hosts of their own, so each has its own copy under this key.
 */
export const PALETTE_RECENT_KEY = "seed:palette-recent"

/** Where the records opened outside the palette are kept, beside {@link PALETTE_RECENT_KEY}. */
export const PALETTE_OPENED_KEY = "seed:palette-opened"

/** How many opened records are kept: the palette shows at most five recent rows anyway. */
export const OPENED_KEPT = 10

/** A record the operator opened, such as a user's page, with what the palette's row shows. */
export interface OpenedRecord {
  kind: "user" | "group"
  id: string
  name: string
}

/** The palette's `recent` setting, and the way to forget what it kept. */
export interface PaletteRecent extends CommandPaletteRecent {
  /** The records opened on this device, newest first, at most {@link OPENED_KEPT}. */
  opened: ReadonlySignal<readonly OpenedRecord[]>
  /**
   * Keeps `record` first among the opened records and first among the palette's recent picks,
   * under the id of its row ({@link openedRowId}). Never throws.
   */
  open(record: OpenedRecord): void
  /**
   * Forgets the recent picks and the opened records, as a sign-out must, so the next person sees
   * none. Never throws.
   */
  forget(): void
}

/** The id of the palette row that opens `record`, such as `user:42`. */
export function openedRowId(record: Pick<OpenedRecord, "kind" | "id">): string {
  return `${record.kind}:${record.id}`
}

/**
 * The opened records a stored value holds, newest first: none for nothing stored, broken JSON or
 * anything but an array, and an entry that is not a record is skipped. Never throws.
 */
export function parseOpened(raw: string | null): OpenedRecord[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? `[]`)
  } catch (_error) {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((entry): entry is OpenedRecord =>
    (entry?.kind === `user` || entry?.kind === `group`) &&
    typeof entry.id === `string` && typeof entry.name === `string`
  ).slice(0, OPENED_KEPT)
}

/**
 * The palette's recent picks and opened records kept in `storage` (`browserStorage()` in an app,
 * which never throws and keeps a refused write in memory, so {@link PaletteRecent.forget} goes
 * through it too).
 */
export function createPaletteRecent(storage: KeyValueStore): PaletteRecent {
  const opened = signal(parseOpened(guarded(() => storage.getItem(PALETTE_OPENED_KEY), null)))
  return {
    storageKey: PALETTE_RECENT_KEY,
    storage: () => storage,
    opened,
    open(record) {
      const rowId = openedRowId(record)
      opened.value = [record, ...opened.value.filter((kept) => openedRowId(kept) !== rowId)]
        .slice(0, OPENED_KEPT)
      guarded(() => storage.setItem(PALETTE_OPENED_KEY, JSON.stringify(opened.value)), undefined)
      addCommandPaletteRecent(PALETTE_RECENT_KEY, () => storage, rowId)
    },
    forget() {
      clearCommandPaletteRecent(PALETTE_RECENT_KEY, () => storage)
      guarded(() => storage.removeItem(PALETTE_OPENED_KEY), undefined)
      opened.value = []
    },
  }
}

/** `run`'s result, or `fallback` where storage throws: remembering is only a convenience. */
function guarded<T>(run: () => T, fallback: T): T {
  try {
    return run()
  } catch (_error) {
    return fallback
  }
}

/** This device's recent palette picks, for the app that runs on this page. */
export const paletteRecent = createPaletteRecent(browserStorage())
