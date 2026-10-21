import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"
import type { AdminModule } from "./modules/types.ts"

/** The second key of each module's "Go to" sequence, by module id: `g u` opens Users. */
export const ADMIN_GO_KEYS: Readonly<Record<string, string>> = {
  dashboard: "d",
  users: "u",
  groups: "g",
  billing: "b",
  newsletter: "m",
  audit: "a",
  system: "s",
  "api-tokens": "k",
}

/** The modules whose first page is a list with a search field, which `/` focuses. */
export const LIST_FILTER_MODULES: ReadonlySet<string> = new Set([
  "users",
  "groups",
  "billing",
  "newsletter",
  "audit",
])

/** What the admin app's shortcuts act on. */
export interface AdminShortcutPorts {
  /** The modules shown, in the rail's order. */
  modules: readonly AdminModule[]
  /** The address of the page shown. */
  path: string
  navigate: (href: string) => void
  openShortcuts: () => void
  /** Moves focus to the open list's search field. */
  focusListFilter: () => void
}

/**
 * The admin app's keyboard shortcuts, the one list its "Keyboard shortcuts" dialog shows and its
 * shell binds: `?` and Escape, a `g` sequence per module shown, named as the rail names it, and
 * `/` while a list with a search field is open. There is no New note: operators write no notes.
 */
export function adminShortcutRows(ports: AdminShortcutPorts): ShortcutRow[] {
  const goTo = ports.modules.flatMap((module): ShortcutRow[] => {
    const key = ADMIN_GO_KEYS[module.id]
    if (key === undefined) return []
    return [{
      keys: `g ${key}`,
      description: module.nav.name,
      group: SHORTCUT_GROUPS.goTo,
      run: () => ports.navigate(module.nav.href),
    }]
  })
  const list = ports.modules.find((module) => module.nav.href === ports.path)
  const filter: ShortcutRow[] = list && LIST_FILTER_MODULES.has(list.id)
    ? [{
      keys: "/",
      description: "Search this list",
      group: SHORTCUT_GROUPS.page,
      run: ports.focusListFilter,
    }]
    : []
  return [...generalRows(ports.openShortcuts), ...goTo, ...filter]
}

/** Focuses the first search field of the page, the list's own. */
export function focusListFilter(): void {
  document.querySelector<HTMLInputElement>("main input[type=search]")?.focus()
}
