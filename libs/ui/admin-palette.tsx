import type { JSX } from "preact"
import { useRef } from "preact/hooks"
import { CommandPalette, matchOptions } from "@spy4x/preact-ui/command-palette"
import { hotkeyClickBinding, useHotkeys } from "@spy4x/preact-ui/hotkeys"
import type { ThemePreference } from "@domain/identity"
import {
  adminFindCommands,
  type AdminGoTo,
  adminPaletteCommands,
  type AdminPaletteOption,
  type AdminSearchChoice,
} from "./admin-palette-commands.ts"
import { paletteLabels } from "./search-palette.tsx"
import { useAdminText } from "./i18n.ts"

export type { AdminGoTo, AdminSearchChoice } from "./admin-palette-commands.ts"

/** Props of {@link AdminSearchPalette}. */
export interface AdminSearchPaletteProps {
  /** The destinations of the modules shown now, in the rail's order. */
  goTo: readonly AdminGoTo[]
  /** Whether the open page is a list whose search field `/` focuses. */
  listFilter: boolean
  /** The theme chosen now, shown on the Theme command. */
  theme: ThemePreference
  /** Whether the single-key shortcuts are on on this device. */
  singleKeys: boolean
  /**
   * Called with what the operator picked: after the palette has closed, or with it still open for
   * a theme or the single keys.
   */
  onSelect: (choice: AdminSearchChoice) => void
}

/** The palette's only hotkey: `/` focuses a list's own search field in the admin app. */
const ADMIN_SEARCH_HOTKEYS: readonly string[] = [`mod+k`]

/**
 * The admin app's palette, opened with Ctrl K (⌘K on a Mac) from every page, at every width, the
 * same palette as the product's (`SearchPalette`). It draws no trigger of its own: the shell's
 * "Search" entries open it by clicking its hidden one (`openSearch`), and it binds Ctrl K itself,
 * with its always-drawn root as what has to be on screen.
 *
 * It lists the commands of {@link adminPaletteCommands}, ranked as the product's palette ranks them
 * (`matchOptions`: aliases, word order, one typo, the other keyboard layout and alphabet). A query
 * adds "Find user …" and "Find group …" after them ({@link adminFindCommands}). Theme opens a
 * submenu whose rows change the theme at once, and Single-key shortcuts switches at once; both
 * keep the palette open.
 */
export function AdminSearchPalette(props: AdminSearchPaletteProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  useHotkeys(
    ADMIN_SEARCH_HOTKEYS.map((keys) =>
      hotkeyClickBinding(keys, () => trigger(root.current), () => root.current)
    ),
  )
  const t = useAdminText()
  // A kept-open row reads the latest props when it is drawn and when it runs.
  const latest = useRef(props)
  latest.current = props
  const select = (choice: AdminSearchChoice) => latest.current.onSelect(choice)
  const options = adminPaletteCommands({
    t,
    goTo: props.goTo,
    listFilter: props.listFilter,
    theme: () => latest.current.theme,
    singleKeys: () => latest.current.singleKeys,
  }, select)
  const shown = new Set(props.goTo.map((entry) => entry.id))
  const filter = (rows: readonly AdminPaletteOption[], query: string) => [
    ...matchOptions(rows, query, rows.length),
    ...adminFindCommands(t, query, shown),
  ]

  return (
    <div ref={root} data-e2e="search-root">
      <CommandPalette<AdminPaletteOption>
        options={options}
        filter={filter}
        onSelect={(option) => option.choice && props.onSelect(option.choice)}
        // Bound above, so they work while the trigger is hidden.
        hotkeys={[]}
        // Every admin row is a command, so "> for commands" would hide most of them: no hint.
        labels={{ ...paletteLabels(t), commandsHint: `` }}
        dataE2E="search"
        class="hidden"
      />
    </div>
  )
}

/** The palette's own trigger inside its root: hidden, and clicked to open it. */
function trigger(root: Element | null): HTMLButtonElement | null {
  return root?.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]") ?? null
}
