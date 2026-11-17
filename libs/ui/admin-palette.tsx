import type { JSX } from "preact"
import { useRef } from "preact/hooks"
import { CommandPalette, type CommandPaletteRecent } from "@spy4x/preact-ui/command-palette"
import { hotkeyClickBinding, useHotkeys } from "@spy4x/preact-ui/hotkeys"
import type { Translator } from "@spy4x/platform/universal/i18n"
import type { ThemePreference } from "@domain/identity"
import {
  adminFindCommands,
  type AdminGoTo,
  adminPaletteCommands,
  type AdminPaletteContext,
  type AdminPaletteOption,
  type AdminSearchChoice,
} from "./admin-palette-commands.ts"
import { matchCommands, themeRows, withRun } from "./palette-commands.ts"
import { type PageCommand, paletteLabels, recentExtras, storedRecent } from "./search-palette.tsx"
import { useAdminText } from "./i18n.ts"

export type { AdminGoTo, AdminPageCommand, AdminSearchChoice } from "./admin-palette-commands.ts"

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
  /** The open page's own commands, listed under "This page"; a pick names one by its id. */
  page?: readonly PageCommand[]
  /**
   * Called with what the operator picked: after the palette has closed, or with it still open for
   * a theme or the single keys.
   */
  onSelect: (choice: AdminSearchChoice) => void
  /**
   * Where the palette keeps the operator's last picks, listed under "Recent" before anything is
   * typed. Left out, nothing is remembered. The app clears it on sign-out.
   */
  recent?: CommandPaletteRecent
}

/**
 * What the palette's registry ({@link adminPaletteCommands}) reads, from the palette's props. The
 * admin app builds the same list for the shortcuts dialog with it, so the two never disagree.
 *
 * @param t The admin app's translator.
 * @param props The palette's props.
 * @param live The latest props, read when a row is drawn (the theme, the single keys); defaults
 *   to `props`.
 */
export function adminPaletteContext(
  t: Translator<string>,
  props: Omit<AdminSearchPaletteProps, "onSelect">,
  live: () => Pick<AdminSearchPaletteProps, "theme" | "singleKeys"> = () => props,
): AdminPaletteContext {
  return {
    t,
    goTo: props.goTo,
    listFilter: props.listFilter,
    theme: () => live().theme,
    singleKeys: () => live().singleKeys,
    page: props.page,
  }
}

/** The palette's only hotkey: `/` focuses a list's own search field in the admin app. */
const ADMIN_SEARCH_HOTKEYS: readonly string[] = [`mod+k`]

/**
 * The admin app's palette, opened with Ctrl K (⌘K on a Mac) from every page, at every width, the
 * same palette as the product's (`SearchPalette`). It draws no trigger of its own: the shell's
 * "Search" entries open it by clicking its hidden one (`openSearch`), and it binds Ctrl K itself,
 * with its always-drawn root as what has to be on screen.
 *
 * It lists the commands of {@link adminPaletteCommands}, the open page's own first, ranked as the
 * product's palette ranks them (`matchOptions`: aliases, word order, one typo, the other keyboard
 * layout and alphabet). A query
 * adds "Find user …" and "Find group …" after them ({@link adminFindCommands}), and a row per
 * theme ("Theme → Dark", {@link themeRows}). Theme opens a submenu whose rows change the theme at
 * once, and Single-key shortcuts and the theme rows switch at once; all keep the palette open.
 *
 * Every row is a command (it has `run`), so `CommandPalette` pins above the rest, for a query, the
 * first one whose name or alias starts with it under "Best match", and before anything is typed
 * the operator's last picks under "Recent", kept in `recent`.
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
  const runnable = (option: AdminPaletteOption) => withRun(option, select)
  const registry = adminPaletteContext(t, props, () => latest.current)
  const commands = adminPaletteCommands(registry, select).map(runnable)
  const themes = themeRows(
    t,
    registry.theme,
    t.t(`Search.settings`),
    (theme) => select({ kind: "theme", theme }),
  )
  const shown = new Set(props.goTo.map((entry) => entry.id))
  // The theme rows are for a typed query: the empty one lists the Theme command and its submenu,
  // and only the theme rows picked before, so "Recent" can show them.
  const filter = (rows: readonly AdminPaletteOption[], query: string) => {
    if (query.trim() !== ``) {
      return [
        ...matchCommands(rows, query, rows.length),
        ...adminFindCommands(t, query, shown).map(runnable),
      ]
    }
    const listed = rows.filter((row) => !themes.includes(row))
    return [...listed, ...recentExtras(storedRecent(latest.current.recent), listed, themes)]
  }

  return (
    <div ref={root} data-e2e="search-root">
      <CommandPalette<AdminPaletteOption>
        options={[...commands, ...themes]}
        filter={filter}
        // Every row runs itself; this is only a fallback.
        onSelect={(option) => option.choice && props.onSelect(option.choice)}
        recent={props.recent}
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
