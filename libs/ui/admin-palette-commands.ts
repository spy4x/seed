/**
 * The admin palette's one command registry: every command an operator can reach with Ctrl K (⌘K),
 * with the names that find it. Pure: it builds options from the admin app's state and hands each
 * pick back as an {@link AdminSearchChoice}, which the app runs through the same function as the
 * matching shortcut or menu entry.
 *
 * @module
 */
import type { CommandPaletteOption } from "@spy4x/preact-ui/command-palette"
import { createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { ADMIN_NO_FILTER, adminUserFilterQuery, type ThemePreference } from "@domain/identity"
import { ADMIN_GROUP_NO_FILTER, adminGroupFilterQuery } from "@domain/groups"
import app from "@i18n/app/en.ts"
import admin from "@i18n/admin/en.ts"
import { ADMIN_PATHS } from "./admin-frame.tsx"
import { ADMIN_GROUP_PATHS } from "./admin-groups-list.tsx"
import {
  SETTINGS_ALIASES,
  shortcutKeys,
  SHORTCUTS_ALIASES,
  SIGN_OUT_ALIASES,
  themeCommand,
} from "./palette-commands.ts"
import { quoted } from "./search-palette.tsx"

/** What a picked command asks the admin app to do. */
export type AdminSearchChoice =
  /** Go to a page of the admin app. */
  | { kind: "page"; href: string }
  /** Paint the app in this theme, as the account menu's Theme does. */
  | { kind: "theme"; theme: ThemePreference }
  /** Turn the single-key shortcuts on or off on this device, as the shortcuts dialog does. */
  | { kind: "single-keys"; on: boolean }
  /** Open the "Keyboard shortcuts" dialog. */
  | { kind: "shortcuts" }
  /** Move focus to the open list's search field, as `/` does. */
  | { kind: "list-filter" }
  /** Sign out, as the account menu's "Sign out" does. */
  | { kind: "sign-out" }

/** One row of the admin palette, carrying what picking it does; a submenu's rows run themselves. */
export interface AdminPaletteOption extends CommandPaletteOption {
  choice?: AdminSearchChoice
  /** The keys of the shortcut that does the same, a sequence such as `g u` included. */
  shortcut?: string
}

/**
 * One Go to destination: a shown module's first page, or one of the blog's pages its `g` sequence
 * opens. The shortcuts and the palette both list these, so the two never disagree.
 */
export interface AdminGoTo {
  /** The module's id, or the page's own (`blog-channels`): it picks the words that find it. */
  id: string
  /** The catalog key of its name, as the rail and the shortcuts list name it. */
  key: string
  href: string
  /** Its `g` sequence, such as `g u`. */
  keys: string
}

/** What the registry reads of the admin app's state. */
export interface AdminPaletteContext {
  t: Translator<string>
  /** The destinations of the modules shown now, in the rail's order. */
  goTo: readonly AdminGoTo[]
  /** Whether the open page is a list whose search field `/` focuses. */
  listFilter: boolean
  /** The theme chosen now; read each time a row is drawn, as {@link themeCommand} says. */
  theme: () => ThemePreference
  /** Whether the single-key shortcuts are on now; read each time the row is drawn. */
  singleKeys: () => boolean
}

/** Extra words for each destination, beyond its name in the operator's language and English. */
const GO_TO_ALIASES: Readonly<Record<string, readonly string[]>> = {
  dashboard: [`home`, `overview`, `start`, `главная`, `обзор`, `дашборд`],
  stats: [`statistics`, `analytics`, `metrics`, `charts`, `статистика`, `аналитика`],
  users: [`people`, `accounts`, `members`, `пользователи`, `люди`, `аккаунты`],
  groups: [`teams`, `workspaces`, `группы`, `команды`],
  billing: [`payments`, `subscriptions`, `invoices`, `plans`, `оплата`, `подписки`, `платежи`],
  newsletter: [`subscribers`, `mailing list`, `emails`, `рассылка`, `подписчики`],
  blog: [`posts`, `articles`, `write`, `блог`, `посты`, `статьи`],
  "contact-links": [`contacts`, `social links`, `links`, `контакты`, `ссылки`],
  catalog: [`products`, `items`, `categories`, `каталог`, `товары`],
  audit: [`history`, `log`, `changes`, `журнал`, `аудит`, `история`],
  jobs: [`queue`, `background jobs`, `tasks`, `задачи`, `очередь`],
  system: [`health`, `server`, `status`, `система`, `сервер`, `состояние`],
  "api-tokens": [`tokens`, `api keys`, `keys`, `токены`, `ключи api`],
  "blog-channels": [`channels`, `social`, `каналы`, `соцсети`],
  "blog-needs-sharing": [`share`, `to share`, `поделиться`, `не опубликованные`],
}

/** Extra words for "Single-key shortcuts". */
const SINGLE_KEYS_ALIASES: readonly string[] = [
  `single keys`,
  `one-key shortcuts`,
  `hotkeys on`,
  `hotkeys off`,
  `одиночные клавиши`,
  `горячие клавиши`,
]

let english: Translator<string> | undefined

/** `key` in English, from the operator area's catalogs. */
function englishText(key: string, values?: Record<string, string>): string {
  english ??= createTranslator({ language: `en`, catalogs: [{ source: app }, { source: admin }] })
  return english.t(key, values)
}

/**
 * Every command the operator can take now, under their headings in the order the palette lists
 * them: Go to, Settings, Account. A destination is listed only while its module is shown, and
 * "Search this list" only on a list whose search field `/` focuses. Each is found by its label,
 * by its English label in every language, and by the words an operator would try, in English and
 * Russian.
 *
 * @param context The admin app's state.
 * @param select Runs a choice made with the palette still open: a theme, or the single keys.
 */
export function adminPaletteCommands(
  context: AdminPaletteContext,
  select: (choice: AdminSearchChoice) => void,
): AdminPaletteOption[] {
  const { t } = context
  const heading = {
    goTo: t.t(`Shortcuts.goTo`),
    settings: t.t(`Search.settings`),
    account: t.t(`Search.account`),
  }
  const command = (
    id: string,
    key: string,
    group: string,
    choice: AdminSearchChoice,
    extra: { aliases?: readonly string[]; keys?: string } = {},
  ): AdminPaletteOption => ({
    id: `action-${id}`,
    label: t.t(key),
    aliases: [englishText(key), ...(extra.aliases ?? [])],
    ...shortcutKeys(extra.keys),
    group,
    choice,
  })

  const goTo = context.goTo.map((entry) =>
    command(`go-${entry.id}`, entry.key, heading.goTo, { kind: "page", href: entry.href }, {
      aliases: GO_TO_ALIASES[entry.id] ?? [],
      keys: entry.keys,
    })
  )

  const singleKeys: AdminPaletteOption = {
    id: `action-single-keys`,
    label: t.t(`Shortcuts.switchLabel`),
    aliases: [englishText(`Shortcuts.switchLabel`), ...SINGLE_KEYS_ALIASES, ...SETTINGS_ALIASES],
    group: heading.settings,
    // Read when drawn: the palette keeps this row, highlighted, while it stays open after a pick.
    get state() {
      return t.t(context.singleKeys() ? `AdminSearch.on` : `AdminSearch.off`)
    },
    keepOpen: true,
    run: () => select({ kind: "single-keys", on: !context.singleKeys() }),
  }
  const settings: AdminPaletteOption[] = [
    themeCommand(t, context.theme, heading.settings, (theme) => select({ kind: "theme", theme })),
    singleKeys,
    command(`shortcuts`, `AdminFrame.shortcuts`, heading.settings, { kind: "shortcuts" }, {
      aliases: SHORTCUTS_ALIASES,
      keys: `?`,
    }),
    ...(context.listFilter
      ? [command(`list-filter`, `AdminShortcuts.searchList`, heading.settings, {
        kind: "list-filter",
      }, {
        aliases: [`filter`, `find in list`, `search list`, `фильтр`, `поиск по списку`],
        keys: `/`,
      })]
      : []),
  ]

  const account = [
    command(`sign-out`, `AdminFrame.signOut`, heading.account, { kind: "sign-out" }, {
      aliases: SIGN_OUT_ALIASES,
    }),
  ]

  return [...goTo, ...settings, ...account]
}

/**
 * The Quick find rows for `query`: "Find user …" opens the users list filtered by it, and
 * "Find group …" the groups list, each only while its module is shown. None for an empty query.
 * They match every query, so the palette lists them after the commands that match.
 *
 * @param shown The ids of the modules shown now.
 */
export function adminFindCommands(
  t: Translator<string>,
  query: string,
  shown: ReadonlySet<string>,
): AdminPaletteOption[] {
  const text = query.trim()
  if (text === ``) return []
  const group = t.t(`AdminSearch.find`)
  const users = adminUserFilterQuery({ ...ADMIN_NO_FILTER, query: text })
  const groups = adminGroupFilterQuery({ ...ADMIN_GROUP_NO_FILTER, query: text })
  return [
    ...(shown.has(`users`)
      ? [{
        id: `find-user`,
        label: t.t(`AdminSearch.findUser`, { query: quoted(text) }),
        group,
        choice: { kind: "page", href: `${ADMIN_PATHS.users}?${users}` } as const,
      }]
      : []),
    ...(shown.has(`groups`)
      ? [{
        id: `find-group`,
        label: t.t(`AdminSearch.findGroup`, { query: quoted(text) }),
        group,
        choice: { kind: "page", href: `${ADMIN_GROUP_PATHS.list}?${groups}` } as const,
      }]
      : []),
  ]
}
