import { useEffect, useRef } from "preact/hooks"
import { signal } from "@preact/signals"
import { createHotkeyMatcher, isApplePlatform } from "@spy4x/platform/browser/hotkeys"
import type { KeyValueStore } from "@spy4x/platform/universal/key-value-store"

/** A shortcut to bind: its presses, such as `"?"` or `"g n"`, and what they do. */
export interface BoundShortcut {
  keys: string
  run?: () => void
}

/** The open modal `<dialog>`, or `null`; `null` too where `:modal` cannot be matched. */
function openModal(): Element | null {
  try {
    return document.querySelector("dialog:modal")
  } catch {
    return null
  }
}

/**
 * Binds every row with `run`: a press, or a sequence of presses one second apart at most, runs
 * it. Nothing runs while the person types in a field or composes text through an input method,
 * inside a dialog or menu, or while a modal dialog is open, so `?` and `n` never open on top of
 * another dialog. `g` alone does nothing; it waits for the next key.
 */
export function useShortcuts(rows: readonly BoundShortcut[]): void {
  const latest = useRef(rows)
  latest.current = rows
  const bound = rows.filter((row) => row.run).map((row) => row.keys).join("\n")
  useEffect(() => {
    if (bound === "") return
    const keys = bound.split("\n")
    const match = createHotkeyMatcher<string, KeyboardEvent>(
      keys.map((combo) => ({ id: combo, keys: combo.split(" ") })),
      {
        apple: isApplePlatform(),
        ignore: (event) => {
          if (event.defaultPrevented) return true
          // The target can be the document, which has no `closest`.
          const target = event.target as Partial<Element> | null
          return target?.closest?.("dialog, [role=dialog], [role=menu]") != null ||
            openModal() !== null
        },
      },
    )
    const listener = (event: KeyboardEvent) => {
      const id = match(event)
      if (id === undefined) return
      const row = latest.current.find((candidate) => candidate.keys === id && candidate.run)
      if (!row?.run) return
      event.preventDefault()
      row.run()
    }
    document.addEventListener("keydown", listener)
    return () => document.removeEventListener("keydown", listener)
  }, [bound])
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
