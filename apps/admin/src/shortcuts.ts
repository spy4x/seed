import type { Translator } from "@spy4x/platform/universal/i18n"
import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"
import type { AdminModule } from "./modules/types.ts"

/** The second key of each module's "Go to" sequence, by module id: `g u` opens Users. */
export const ADMIN_GO_KEYS: Readonly<Record<string, string>> = {
  dashboard: "d",
  stats: "t",
  users: "u",
  groups: "g",
  billing: "b",
  newsletter: "m",
  blog: "p",
  "contact-links": "l",
  catalog: "c",
  audit: "a",
  jobs: "j",
  system: "s",
  "api-tokens": "k",
}

/**
 * The blog's own pages that a `g` sequence opens too, while the blog module is shown: `g h` the
 * sharing channels, `g n` the live posts that still need sharing.
 */
const BLOG_GO_PAGES: readonly { keys: string; description: string; href: string }[] = [
  { keys: "g h", description: `AdminShortcuts.sharingChannels`, href: "/blog/channels" },
  { keys: "g n", description: `AdminShortcuts.needsSharing`, href: "/blog?sharing=todo" },
]

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
 * A page's own actions, by the page's address: `c` writes a new post from the blog's list, adds a
 * link from the contact links, and adds an item or a category from the catalog's lists. Each
 * description is a catalog key.
 */
export const ADMIN_PAGE_ACTIONS: Readonly<
  Record<string, readonly { keys: string; description: string; href: string }[]>
> = {
  "/blog": [{ keys: "c", description: `AdminShortcuts.newPost`, href: "/blog/new" }],
  "/blog/channels": [{
    keys: "c",
    description: `AdminShortcuts.addChannel`,
    href: "/blog/channels/new",
  }],
  "/contact-links": [{
    keys: "c",
    description: `AdminShortcuts.addLink`,
    href: "/contact-links/new",
  }],
  "/catalog": [{ keys: "c", description: `AdminShortcuts.addItem`, href: "/catalog/new" }],
  "/catalog/categories": [
    { keys: "c", description: `AdminShortcuts.addCategory`, href: "/catalog/categories/new" },
  ],
}

/**
 * The pages whose save button takes Ctrl S (Command S on a Mac): the blog's editor and the
 * catalog's item editor. The blog's channels page is no post.
 */
const SAVE_PAGES = /^\/(blog|catalog)\/(?!(categories|channels)(\/|$))[^/]+$/

/** A post's editor, new or saved, whose body takes F8 to its figure problems. */
const BLOG_POST_PAGE = /^\/blog\/(?!channels$)[^/]+$/

/** A post's sharing checklist, whose rows take their own keys. */
const BLOG_SHARING_PAGE = /^\/blog\/[^/]+\/sharing$/

/** The checklist's keys, each a catalog key; its page binds them itself. */
const SHARING_KEYS: readonly { keys: string; description: string }[] = [
  { keys: "j", description: `AdminShortcuts.nextRow` },
  { keys: "k", description: `AdminShortcuts.previousRow` },
  { keys: "t", description: `AdminShortcuts.copyRowText` },
  { keys: "o", description: `AdminShortcuts.openRowChannel` },
  { keys: "p", description: `AdminShortcuts.focusRowLink` },
  { keys: "s", description: `AdminShortcuts.skipRow` },
  { keys: "e", description: `AdminShortcuts.rowResults` },
]

/** What the admin app's shortcuts act on. */
export interface AdminShortcutPorts {
  /** The modules shown, in the rail's order. */
  modules: readonly AdminModule[]
  /** The page's translator: the rows' descriptions are catalog keys. */
  t: Translator<string>
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
      description: ports.t.t(module.nav.name),
      group: SHORTCUT_GROUPS.goTo,
      run: () => ports.navigate(module.nav.href),
    }]
  })
  const blogPages = ports.modules.some((module) => module.id === `blog`)
    ? BLOG_GO_PAGES.map((page): ShortcutRow => ({
      keys: page.keys,
      description: ports.t.t(page.description),
      group: SHORTCUT_GROUPS.goTo,
      run: () => ports.navigate(page.href),
    }))
    : []
  const list = ports.modules.find((module) => module.nav.href === ports.path)
  const filter: ShortcutRow[] = list && LIST_FILTER_MODULES.has(list.id)
    ? [{
      keys: "/",
      description: ports.t.t(`AdminShortcuts.searchList`),
      group: SHORTCUT_GROUPS.page,
      run: ports.focusListFilter,
    }]
    : []
  const actions = (ADMIN_PAGE_ACTIONS[ports.path] ?? []).map((action): ShortcutRow => ({
    keys: action.keys,
    description: ports.t.t(action.description),
    group: SHORTCUT_GROUPS.page,
    run: () => ports.navigate(action.href),
  }))
  // Listed only: the save button binds the key itself, while it is shown and enabled.
  const save: ShortcutRow[] = SAVE_PAGES.test(ports.path)
    ? [{
      keys: "mod+s",
      description: ports.t.t(
        ports.path.startsWith(`/catalog/`) ? `AdminShortcuts.saveItem` : `AdminShortcuts.savePost`,
      ),
      group: SHORTCUT_GROUPS.page,
    }]
    : []
  // Listed only: the post's textarea takes F8 itself, to its next or previous figure problem.
  const problems: ShortcutRow[] = BLOG_POST_PAGE.test(ports.path)
    ? [
      { keys: `f8`, description: ports.t.t(`AdminShortcuts.nextProblem`) },
      { keys: `shift+f8`, description: ports.t.t(`AdminShortcuts.previousProblem`) },
    ].map((row) => ({ ...row, group: SHORTCUT_GROUPS.page }))
    : []
  // Listed only: the checklist's rows take these keys themselves, while one has focus.
  const rows: ShortcutRow[] = BLOG_SHARING_PAGE.test(ports.path)
    ? SHARING_KEYS.map((row) => ({
      keys: row.keys,
      description: ports.t.t(row.description),
      group: SHORTCUT_GROUPS.page,
    }))
    : []
  return [
    ...generalRows(ports.openShortcuts),
    ...goTo,
    ...blogPages,
    ...filter,
    ...actions,
    ...save,
    ...problems,
    ...rows,
  ]
}

/** Focuses the first search field of the page, the list's own. */
export function focusListFilter(): void {
  document.querySelector<HTMLInputElement>("main input[type=search]")?.focus()
}
