import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { activeShortcuts } from "@spy4x/preact-ui/hotkeys"
import { ShortcutsDialog } from "@spy4x/preact-ui/shortcuts-dialog"
import { ToggleField } from "@spy4x/preact-ui/toggle-field"
import { useAppText } from "./i18n.ts"

/**
 * One row of an app's keyboard shortcuts: what the "Keyboard shortcuts" dialog lists and, with
 * `run`, what the keys do. A row without `run` is listed only, because something else binds its
 * keys: `Modal` closes on Escape, the search palette binds Ctrl K and `/`, the New note dialog
 * binds Enter. The app binds the rest with `useShortcuts` (`libs/platform/shortcuts.ts`).
 */
export interface ShortcutRow {
  /** One combination (`"?"`, `"mod+k"`) or a sequence of presses (`"g n"`), as `Kbd` takes it. */
  keys: string
  /**
   * What it does, as the dialog lists it: a key of the `app` or `admin` catalog, which the dialog
   * translates. Text that is no key is listed as it is.
   */
  description: string
  /** The heading it is listed under: one of {@link SHORTCUT_GROUPS}, a key the dialog translates. */
  group: string
  /** What the keys do. Left out, the row is listed only. */
  run?: () => void
}

/**
 * The headings of the shortcuts dialog, in the order the rows of an app use them, as keys of the
 * `app` catalog, which the admin app loads too.
 */
export const SHORTCUT_GROUPS = {
  general: `Shortcuts.general`,
  goTo: `Shortcuts.goTo`,
  newNote: `Shortcuts.newNote`,
  page: `Shortcuts.page`,
} as const

/** The rows every app starts with: `?` opens the list, and Escape closes what is open. */
export function generalRows(openShortcuts: () => void): ShortcutRow[] {
  return [
    {
      keys: "?",
      description: `Shortcuts.show`,
      group: SHORTCUT_GROUPS.general,
      run: openShortcuts,
    },
    { keys: "esc", description: `Shortcuts.close`, group: SHORTCUT_GROUPS.general },
  ]
}

/** Props of {@link ShortcutsList}. */
export interface ShortcutsProps {
  /** The app's registry: every row the dialog lists, and with `run`, what the keys do. */
  rows: readonly ShortcutRow[]
  /** Whether the "Keyboard shortcuts" dialog is open. */
  open: boolean
  onOpen: () => void
  onClose: () => void
  /** Whether the single-key shortcuts are on, on this device. */
  singleKeys: boolean
  onSingleKeys: (on: boolean) => void
}

/**
 * The "Keyboard shortcuts" dialog: the rows that work now (preact-ui's `activeShortcuts`), the same list the
 * app binds, so it never shows a key that does nothing. Its footer says when shortcuts do not
 * work and holds the switch that turns the single keys off on this device; the dialog keeps its
 * height while it is open after the switch is pressed, so the switch stays under the pointer.
 */
export function ShortcutsList(
  { rows, open, onClose, singleKeys, onSingleKeys }: ShortcutsProps,
): JSX.Element {
  const t = useAppText()
  const active = activeShortcuts(rows, singleKeys).map((row) => ({
    ...row,
    description: t.t(row.description),
    group: t.t(row.group),
  }))
  // The switch drops or restores rows, and the dialog is centred, so it would jump away from the
  // pointer. A press on the switch pins the dialog's height until it closes, and the footer keeps
  // to the bottom (`[&>footer]:mt-auto`), so the switch stays where it was.
  const pinned = useRef<HTMLDialogElement | null>(null)
  useEffect(() => {
    if (open || !pinned.current) return
    pinned.current.style.removeProperty("min-height")
    pinned.current = null
  }, [open])
  const keepHeight = (event: JSX.TargetedMouseEvent<HTMLDivElement>) => {
    const dialog = event.currentTarget.closest("dialog")
    if (!dialog) return
    dialog.style.minHeight = `${dialog.offsetHeight}px`
    pinned.current = dialog
  }
  return (
    <ShortcutsDialog
      open={open}
      onClose={onClose}
      shortcuts={active}
      class="sm:max-w-lg [&>footer]:mt-auto"
      footer={
        <div class="w-full" data-e2e="shortcuts-footer" onClickCapture={keepHeight}>
          <ToggleField
            id="single-key-shortcuts"
            label={t.t(`Shortcuts.switchLabel`)}
            value={singleKeys}
            onToggle={onSingleKeys}
            description={singleKeys ? t.t(`Shortcuts.inFields`) : t.t(`Shortcuts.off`)}
          />
        </div>
      }
    />
  )
}
