/**
 * The SPA palette's one command registry: every command a person can reach with Ctrl K (⌘K), with
 * the names that find it. Pure: it builds options from the app's state and hands each pick back as
 * a {@link SearchChoice}, which the app runs through the same function as the matching button.
 *
 * @module
 */
import type { CommandPaletteOption } from "@spy4x/preact-ui/command-palette"
import type { Translator } from "@spy4x/platform/universal/i18n"
import type { ThemePreference } from "@domain/identity"
import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  PROFILE_SECTIONS,
  profilePath,
  type ProfileSectionId,
  SCREEN_PATHS,
  TAG_PATHS,
} from "./progressive.tsx"
import { PROFILE_SECTION_TEXT } from "./profile-screen.tsx"
import { DATA_EXPORT_ANCHOR } from "./profile-export.tsx"
import { PICTURE_BUTTON_ID, pictureRule } from "./profile-picture.tsx"
import { THEME_KEYS, themeName } from "./preferences.tsx"
import type { ShortcutRow } from "./shortcuts.tsx"
import { englishText, type KeyedMessage, messageText } from "./message.ts"

/** What a picked result asks the app to do. */
export type SearchChoice =
  /** Open the note, switching to its group first when it is another one. */
  | { kind: "note"; noteId: string; groupId: string }
  /** Make the group the current one, as the group switcher does. */
  | { kind: "switch-group"; groupId: string }
  /** Open the group's settings page. */
  | { kind: "group-settings"; groupId: string }
  /** Go to a page of the app. */
  | { kind: "page"; href: string }
  /** Open the New note dialog, which adds a note without leaving the page. */
  | { kind: "new-note" }
  /** Run one of the open page's own commands, by its id. */
  | { kind: "command"; id: string }
  /** Paint the app in this theme, as the profile's Appearance section does. */
  | { kind: "theme"; theme: ThemePreference }
  /** Open the "Keyboard shortcuts" dialog. */
  | { kind: "shortcuts" }
  /** Sign out, as the account menu's "Sign out" does: unsent changes are asked about first. */
  | { kind: "sign-out" }
  /** Ask the browser to install the app, as the install offer's button does. */
  | { kind: "install" }

/** A command of the open page that the palette lists, such as "Change date range". */
export interface PageCommand {
  id: string
  /** What the palette lists, in the person's language. */
  label: string
  /** Other words that find it, such as its English label. */
  aliases?: readonly string[]
  /** Its keys from the app's shortcut list, when it has any. */
  kbd?: string
}

/** One row of the palette, carrying what picking it does; a submenu's rows run themselves. */
export interface PaletteOption extends CommandPaletteOption {
  choice?: SearchChoice
}

/** What the registry reads of the app's state. */
export interface PaletteContext {
  t: Translator<string>
  /** The region format's locale, for sizes in a detail. */
  locale: string
  /** The group the notes pages show, and whether the person may add notes and tags to it. */
  currentGroup: { id: string; name: string; canWrite: boolean } | null
  /** Whether the server can be reached. */
  online: boolean
  /**
   * The theme chosen now. A function, read each time a row is drawn: the palette keeps the rows of
   * its last search, so a theme picked with the palette open shows on them without a new search.
   */
  theme: () => ThemePreference
  /** The app's keyboard shortcuts: each command shows the keys of the row it shares a key with. */
  shortcuts: readonly ShortcutRow[]
  /** The group whose Activity the rail shows, or `null` while it shows none. */
  activityGroupId: string | null
  /** The open page's own commands. */
  pageCommands: readonly PageCommand[]
  /** The person is a guest: "Keep your account" leads the Account commands. */
  guest: boolean
  /** Whether "Open benchmark" is listed: development builds and the public demo only. */
  benchmark: boolean
  /** Whether the browser offers to install the app now. */
  canInstall: boolean
}

/** The Go to commands: the rail's and the shortcuts' destinations, with the words that find them. */
const GO_TO: readonly {
  id: string
  /** The `app` key of the label, which is also the description of its shortcut row. */
  key: string
  href: (context: PaletteContext) => string | null
  /** The `app` key of the older "Open …" name, kept as an alias in every language. */
  open?: string
  aliases: readonly string[]
}[] = [
  {
    id: "overview",
    key: `Frame.overview`,
    href: (context) => context.currentGroup ? OVERVIEW_PATHS.root : null,
    open: `Search.openOverview`,
    aliases: [`dashboard`, `stats`, `charts`, `обзор`, `статистика`, `дашборд`],
  },
  {
    id: "notes",
    key: `Frame.notes`,
    href: () => NOTE_PATHS.list,
    aliases: [`notes list`, `all notes`, `заметки`, `список заметок`],
  },
  {
    id: "tags",
    key: `Frame.tags`,
    href: () => TAG_PATHS.list,
    aliases: [`labels`, `categories`, `метки`, `теги`, `ярлыки`],
  },
  {
    id: "activity",
    key: `Frame.activity`,
    href: (context) =>
      context.activityGroupId === null ? null : GROUP_PATHS.activity(context.activityGroupId),
    aliases: [`history`, `log`, `audit`, `changes`, `активность`, `история`, `журнал`],
  },
  {
    id: "groups",
    key: `Frame.groups`,
    href: () => SCREEN_PATHS.groups,
    aliases: [`teams`, `workspaces`, `members`, `группы`, `команды`],
  },
  {
    id: "notifications",
    key: `Shortcuts.notifications`,
    href: () => SCREEN_PATHS.notifications,
    open: `Search.openNotifications`,
    aliases: [`inbox`, `alerts`, `уведомления`, `входящие`],
  },
  {
    id: "profile",
    key: `Shortcuts.profile`,
    href: () => SCREEN_PATHS.profile,
    open: `Search.openProfile`,
    aliases: [`my account`, `me`, `профиль`, `мой аккаунт`],
  },
]

/** Extra words for each profile section, beyond its English name and description. */
const SECTION_ALIASES: Record<ProfileSectionId, readonly string[]> = {
  account: [`name`, `email`, `e-mail`, `аккаунт`, `имя`, `почта`],
  security: [
    `password`,
    `two-factor`,
    `2fa`,
    `passkey`,
    `sessions`,
    `devices`,
    `пароль`,
    `безопасность`,
    `вход`,
  ],
  region: [
    `language`,
    `time zone`,
    `date format`,
    `clock`,
    `locale`,
    `язык`,
    `часовой пояс`,
    `формат даты`,
  ],
  appearance: [`look`, `colors`, `внешний вид`, `оформление`],
  notifications: [`push`, `email notifications`, `уведомления`, `оповещения`],
  "api-tokens": [`token`, `api key`, `access token`, `токен`, `ключ api`],
  "danger-zone": [`delete account`, `close account`, `remove account`, `удалить аккаунт`],
}

/** The three themes, in the order the profile lists them. */
const THEMES: readonly ThemePreference[] = [`system`, `light`, `dark`]

/** Extra words for each theme. */
const THEME_ALIASES: Record<ThemePreference, readonly string[]> = {
  system: [`auto`, `device`, `системная`, `как на устройстве`],
  light: [`day`, `светлая`],
  dark: [`night`, `тёмная`, `ночная`],
}

/** The keys of the shortcut row described by `key`, or `undefined` when it has none. */
function kbdOf(shortcuts: readonly ShortcutRow[], key: string): string | undefined {
  return shortcuts.find((row) => row.description === key)?.keys
}

/**
 * Every command the person can take now, under their headings in the order the palette lists
 * them: This page, Go to, Create, Settings, Account. Go to comes before Create, so a typo that
 * fits both ("notse") finds the page first. A command the person cannot take is left out
 * ("New note" without a group they may write to, Activity while the rail hides it, "Install app"
 * while the browser offers no install); one that needs the server stays listed offline, with why
 * it cannot run. Each is found by its label, by its English label in every language, and by the
 * words a person would try, in English and Russian.
 *
 * @param context The app's state.
 * @param select Runs a choice made inside a submenu, which keeps the palette open.
 */
export function paletteCommands(
  context: PaletteContext,
  select: (choice: SearchChoice) => void,
): PaletteOption[] {
  const { t, currentGroup, online, shortcuts } = context
  const heading = {
    page: t.t(`Shortcuts.page`),
    create: t.t(`Search.create`),
    goTo: t.t(`Shortcuts.goTo`),
    settings: t.t(`Search.settings`),
    account: t.t(`Search.account`),
  }
  // A command is found by its label and detail in English too, so a person who types the English
  // word ("password", "ZIP") finds it in every language. A detail given as text is shown as it is.
  const command = (
    id: string,
    key: string,
    group: string,
    choice: SearchChoice,
    extra: { detail?: KeyedMessage | string; aliases?: readonly string[]; kbd?: string } = {},
  ): PaletteOption => ({
    id: `action-${id}`,
    label: t.t(key),
    detail: typeof extra.detail === `string`
      ? extra.detail
      : messageText(t, extra.detail ?? null) ?? undefined,
    aliases: [
      englishText(key),
      ...(extra.detail && typeof extra.detail !== `string`
        ? [englishText(extra.detail.key, extra.detail.values)]
        : []),
      ...(extra.aliases ?? []),
    ],
    kbd: extra.kbd ?? kbdOf(shortcuts, key),
    group,
    choice,
  })
  const page = (href: string) => ({ kind: "page", href }) as const
  const inGroup: KeyedMessage | null = currentGroup?.canWrite
    ? { key: `Search.inGroup`, values: { group: currentGroup.name } }
    : null

  const thisPage = context.pageCommands.map((pageCommand): PaletteOption => ({
    id: `command-${pageCommand.id}`,
    label: pageCommand.label,
    aliases: pageCommand.aliases,
    kbd: pageCommand.kbd,
    group: heading.page,
    choice: { kind: "command", id: pageCommand.id },
  }))

  const create: PaletteOption[] = [
    // The same dialog as `n`: the note is added without leaving the page.
    ...(inGroup
      ? [command("new-note", `Search.newNote`, heading.create, { kind: "new-note" }, {
        detail: inGroup,
        aliases: [`add note`, `create note`, `write`, `новая заметка`, `создать заметку`],
        kbd: kbdOf(shortcuts, `Shortcuts.newNoteRow`),
      })]
      : []),
    ...(inGroup
      ? [command("new-tag", `Search.newTag`, heading.create, page(TAG_PATHS.new), {
        detail: inGroup,
        aliases: [`add tag`, `create tag`, `new label`, `новая метка`, `создать метку`],
      })]
      : []),
    {
      ...command("new-group", `Search.newGroup`, heading.create, page(GROUP_PATHS.new), {
        aliases: [`add group`, `create group`, `new team`, `новая группа`, `создать группу`],
      }),
      // Made on the server: listed offline too, so the person learns why it does nothing.
      disabledReason: online ? undefined : t.t(`Search.needsConnection`),
    },
  ]

  const goTo: PaletteOption[] = GO_TO.flatMap((entry) => {
    const href = entry.href(context)
    if (href === null) return []
    return [command(entry.id, entry.key, heading.goTo, page(href), {
      aliases: [
        ...(entry.open ? [t.t(entry.open), englishText(entry.open)] : []),
        ...entry.aliases,
      ],
    })]
  })
  if (context.benchmark) {
    goTo.push(
      command("benchmark", `Search.openBenchmark`, heading.goTo, page(SCREEN_PATHS.benchmark), {
        detail: { key: `Search.benchmarkDetail` },
        aliases: [
          `benchmark`,
          `performance`,
          `speed`,
          `speed test`,
          `load test`,
          `measure`,
          `device test`,
          `perf`,
          `бенчмарк`,
          `производительность`,
          `тест скорости`,
        ],
      }),
    )
  }

  const current = context.theme
  const themeRows = THEMES.map((theme): PaletteOption => ({
    id: `theme-${theme}`,
    label: themeName(t, theme),
    aliases: [englishText(THEME_KEYS[theme]), ...THEME_ALIASES[theme]],
    // Read when drawn: the palette keeps these rows while it stays open after a pick.
    get state() {
      return current() === theme ? t.t(`Search.current`) : undefined
    },
    keepOpen: true,
    run: () => select({ kind: "theme", theme }),
  }))
  const settings: PaletteOption[] = [
    {
      id: `action-theme`,
      label: t.t(`Preferences.theme`),
      aliases: [
        englishText(`Preferences.theme`),
        `dark`,
        `light`,
        `dark mode`,
        `light mode`,
        `night mode`,
        `color scheme`,
        `тема`,
        `тёмная тема`,
        `светлая тема`,
        `ночной режим`,
      ],
      get state() {
        return themeName(t, current())
      },
      group: heading.settings,
      children: themeRows,
    },
    ...PROFILE_SECTIONS.map((section) =>
      command(
        `settings-${section}`,
        PROFILE_SECTION_TEXT[section].label,
        heading.settings,
        page(profilePath(section)),
        {
          detail: { key: PROFILE_SECTION_TEXT[section].description },
          aliases: SECTION_ALIASES[section],
        },
      )
    ),
    command(
      "download-data",
      `Search.downloadData`,
      heading.settings,
      page(`${profilePath("account")}#${DATA_EXPORT_ANCHOR}`),
      {
        detail: { key: `Search.downloadDetail` },
        aliases: [
          `export my data`,
          `GDPR`,
          `archive`,
          `takeout`,
          `скачать данные`,
          `экспорт данных`,
        ],
      },
    ),
    command(
      "change-picture",
      `Search.changePicture`,
      heading.settings,
      page(`${profilePath("account")}#${PICTURE_BUTTON_ID}`),
      {
        detail: pictureRule(context.locale),
        aliases: [`avatar`, `photo`, `upload picture`, `фото`, `аватар`],
      },
    ),
    command("shortcuts", `Frame.shortcuts`, heading.settings, { kind: "shortcuts" }, {
      aliases: [`hotkeys`, `keys`, `keyboard`, `горячие клавиши`, `сочетания клавиш`],
      kbd: kbdOf(shortcuts, `Shortcuts.show`),
    }),
  ]

  const account: PaletteOption[] = [
    ...(context.guest
      ? [command("keep", `Search.keep`, heading.account, page(`/keep`), {
        detail: { key: `Search.keepDetail` },
      })]
      : []),
    ...(context.canInstall
      ? [command("install", `Search.installApp`, heading.account, { kind: "install" }, {
        aliases: [`add to home screen`, `pwa`, `desktop app`, `установить приложение`],
      })]
      : []),
    command("sign-out", `Frame.signOut`, heading.account, { kind: "sign-out" }, {
      aliases: [`log out`, `logout`, `sign off`, `выйти`, `выход`],
    }),
  ]

  return [...thisPage, ...goTo, ...create, ...settings, ...account]
}

/**
 * What a pick asks for: a group row's Ctrl Enter (⌘Enter) opens the group's settings instead of
 * switching to it; every other choice is the same either way.
 */
export function pickedChoice(choice: SearchChoice, alternative: boolean): SearchChoice {
  return alternative && choice.kind === "switch-group"
    ? { kind: "group-settings", groupId: choice.groupId }
    : choice
}

/**
 * The person's groups whose name matches, one row each: Enter makes it the current group, and
 * Ctrl Enter (⌘Enter) opens its settings. Found by its name and by "Switch to …".
 */
export function groupRow(
  t: Translator<string>,
  group: { id: string; name: string },
  detail: string,
  current: boolean,
): PaletteOption {
  return {
    id: `group-${group.id}`,
    label: group.name,
    detail,
    hint: current ? t.t(`Search.current`) : undefined,
    aliases: [
      t.t(`Search.switchTo`, { group: group.name }),
      englishText(`Search.switchTo`, { group: group.name }),
    ],
    group: t.t(`Search.groups`),
    choice: { kind: "switch-group", groupId: group.id },
  }
}
