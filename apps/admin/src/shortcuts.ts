import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"
import type { AdminModule } from "./modules/types.ts"

/** The second key of each module's "Go to" sequence, by module id: `g u` opens Users. */
export const ADMIN_GO_KEYS: Readonly<Record<string, string>> = {
  dashboard: "d",
  users: "u",
  groups: "g",
  billing: "b",
  newsletter: "m",
  blog: "p",
  "contact-links": "l",
  audit: "a",
  jobs: "j",
  system: "s",
  "api-tokens": "k",
}

/** The modules whose first page is a list with a search field, which `/` focuses. */
export const LIST_FILTER_MODULES: ReadonlySet<string> = new Set([
  "users",
  "groups",
  "billing",
  "newsletter",
  "blog",
  "audit",
  "jobs",
])

/**
 * A page's own actions, by the page's address: `c` writes a new post from the blog's list and
 * adds a link from the contact links.
 */
export const ADMIN_PAGE_ACTIONS: Readonly<
  Record<string, readonly { keys: string; description: string; href: string }[]>
> = {
  "/blog": [{ keys: "c", description: "New post", href: "/blog/new" }],
  "/contact-links": [{ keys: "c", description: "Add link", href: "/contact-links/new" }],
}

/** The pages whose save button takes Ctrl S (Command S on a Mac): the blog's editor. */
const SAVE_PAGES = /^\/blog\/[^/]+$/

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
 * shell binds: `?` and Escape, a `g` sequence per module shown, named as the rail names it, `/`
 * while a list with a search field is open, and the open page's own actions (`c` on the blog's
 * list; Ctrl S, listed, in its editor). There is no New note: operators write no notes.
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
  const actions = (ADMIN_PAGE_ACTIONS[ports.path] ?? []).map((action): ShortcutRow => ({
    keys: action.keys,
    description: action.description,
    group: SHORTCUT_GROUPS.page,
    run: () => ports.navigate(action.href),
  }))
  // Listed only: the save button binds the key itself, while it is shown and enabled.
  const save: ShortcutRow[] = SAVE_PAGES.test(ports.path)
    ? [{ keys: "mod+s", description: "Save the post", group: SHORTCUT_GROUPS.page }]
    : []
  return [...generalRows(ports.openShortcuts), ...goTo, ...filter, ...actions, ...save]
}

/** Focuses the first search field of the page, the list's own. */
export function focusListFilter(): void {
  document.querySelector<HTMLInputElement>("main input[type=search]")?.focus()
}
