import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  TAG_PATHS,
} from "@ui/progressive.tsx"
import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"
import type { PageCommand } from "@ui/search-palette.tsx"
import type { GroupAction } from "@ui/group-editor-screen.tsx"
import { englishText } from "@ui/message.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"

/** What the SPA's shortcuts act on. */
export interface SpaShortcutPorts {
  navigate: (href: string) => void
  openShortcuts: () => void
  openNewNote: () => void
  /** The group whose Activity the rail shows, or `null` while it shows none. */
  activityGroupId: string | null
  /** The overview's own keys while it is open; `null` or left out on every other page. */
  overviewPage?: { openRange(): void; openCustomise(): void } | null
  /**
   * Whether the benchmark page is open; left out, it is not. Its Run and Copy buttons bind `r` and
   * `c` themselves (`BenchmarkScreen`), so these rows are listed only.
   */
  benchmarkPage?: boolean
  /**
   * Whether the notes example is on (`SPA_NOTES`); left out, it is. Off, no row names notes or
   * tags: no `n`, Undo, `g n`, `g t` or the New note dialog's keys.
   */
  notes?: boolean
}

/**
 * The SPA's keyboard shortcuts, the one list the "Keyboard shortcuts" dialog shows and the frame
 * binds, each described by a key of the `app` catalog. Search's keys, the New note dialog's and Undo's
 * (`useUndoToast`) are bound where they act and listed here, as are the benchmark's `r` and `c`,
 * which its buttons bind while it is open. Activity is listed and bound only while the rail shows
 * it, and the overview's `d` and `c` only while it is open. A `g` row names the page it opens
 * (`href`), so the frame shows its keys on that page's entry.
 */
export function spaShortcutRows(ports: SpaShortcutPorts): ShortcutRow[] {
  const { general, goTo, newNote, page } = SHORTCUT_GROUPS
  const go = (keys: string, description: string, href: string): ShortcutRow => ({
    keys,
    description,
    group: goTo,
    run: () => ports.navigate(href),
    href,
  })
  const [show, close] = generalRows(ports.openShortcuts)
  const notes = ports.notes ?? true
  return [
    show,
    { keys: "mod+k", description: `Shortcuts.search`, group: general },
    { keys: "/", description: `Shortcuts.search`, group: general },
    ...(notes
      ? [
        { keys: "n", description: `Shortcuts.newNoteRow`, group: general, run: ports.openNewNote },
        { keys: "mod+z", description: `Shortcuts.undo`, group: general },
      ]
      : []),
    close,
    go("g o", `Frame.overview`, OVERVIEW_PATHS.root),
    ...(notes
      ? [go("g n", `Frame.notes`, NOTE_PATHS.list), go("g t", `Frame.tags`, TAG_PATHS.list)]
      : []),
    ...(ports.activityGroupId === null
      ? []
      : [go("g a", `Frame.activity`, GROUP_PATHS.activity(ports.activityGroupId))]),
    go("g g", `Frame.groups`, SCREEN_PATHS.groups),
    go("g i", `Shortcuts.notifications`, SCREEN_PATHS.notifications),
    go("g p", `Shortcuts.profile`, SCREEN_PATHS.profile),
    ...(ports.overviewPage
      ? [
        {
          keys: "d",
          description: `Shortcuts.dateRange`,
          group: page,
          run: ports.overviewPage.openRange,
        },
        {
          keys: "c",
          description: `Shortcuts.customise`,
          group: page,
          run: ports.overviewPage.openCustomise,
        },
      ]
      : []),
    ...(ports.benchmarkPage
      ? [
        { keys: "r", description: `Shortcuts.runBenchmark`, group: page },
        { keys: "c", description: `Shortcuts.copyResults`, group: page },
      ]
      : []),
    ...(notes
      ? [
        { keys: "enter", description: `Shortcuts.addNote`, group: newNote },
        { keys: "mod+enter", description: `Shortcuts.addAndOpen`, group: newNote },
      ]
      : []),
  ]
}

/** The overview's commands in the palette, while the overview is open; labels are `app` keys. */
const OVERVIEW_COMMANDS = [
  { id: "overview-range", label: `Shortcuts.dateRange` },
  { id: "overview-customise", label: `Shortcuts.customise` },
] as const

/** The benchmark page's commands in the palette, while it is open. */
const BENCHMARK_COMMANDS = [
  { id: "benchmark-run", label: `Shortcuts.runBenchmark` },
  { id: "benchmark-copy", label: `Shortcuts.copyResults` },
] as const

/** What the open note page lets the palette do; see {@link NotePageActions}. */
export type NoteAction = "attach" | "duplicate" | "move" | "copyLink" | "delete"

/**
 * The open note page's commands that the palette may run: only those the page offers now are
 * present (a reader gets `copyLink` alone). `delete` opens the page's confirmation, never deletes.
 */
export type NotePageActions = Partial<Record<NoteAction, () => void>>

/**
 * The open tag page's commands: `delete` while its menu's "Delete tag" can be picked. It opens the
 * page's confirmation, never deletes.
 */
export type TagPageActions = Partial<Record<"delete", () => void>>

/**
 * The open group page's commands, as its "More actions" menu offers them to the person now. Export
 * downloads at once, as the menu's does; Transfer, Leave and Delete only open their dialogs.
 */
export type GroupPageActions = Partial<Record<GroupAction, () => void>>

/**
 * The actions of a page's menu (`groupMenuActions`, `tagMenuActions`) that the palette offers: those
 * the menu shows and lets the person pick now, mapped to `null`. A hidden or disabled item is left
 * out, since the palette cannot show the menu's reason line.
 */
export function readyActions<A extends string>(menu: Partial<Record<A, string | null>>): A[] {
  return (Object.keys(menu) as A[]).filter((action) => menu[action] === null)
}

/** One action command of a page: its id, the action it runs, its label key and extra words. */
interface ActionCommand<A extends string> {
  id: string
  action: A
  label: string
  aliases: readonly string[]
}

/**
 * The note page's commands in the palette, in the order listed, each shown only while the page
 * offers its action. Besides its English label, each is found by the words in `aliases`.
 */
const NOTE_COMMANDS: readonly ActionCommand<NoteAction>[] = [
  { id: "note-attach", action: "attach", label: `AppShell.attachFiles`, aliases: [] },
  {
    id: "note-duplicate",
    action: "duplicate",
    label: `AppShell.duplicateNote`,
    aliases: [`copy note`, `clone`, `дублировать`, `копия заметки`],
  },
  {
    id: "note-move",
    action: "move",
    label: `AppShell.moveNote`,
    aliases: [`move to group`, `перенести заметку`, `переместить`],
  },
  {
    id: "note-copy-link",
    action: "copyLink",
    label: `AppShell.copyNoteLink`,
    aliases: [`share link`, `url`, `ссылка`],
  },
  {
    id: "note-delete",
    action: "delete",
    label: `AppShell.deleteNote`,
    aliases: [`remove note`, `trash`, `удалить заметку`],
  },
]

/** The tag page's command in the palette, as {@link NOTE_COMMANDS}. */
const TAG_COMMANDS: readonly ActionCommand<"delete">[] = [
  {
    id: "tag-delete",
    action: "delete",
    label: `AppShell.deleteTag`,
    aliases: [`remove tag`, `trash`, `удалить метку`, `удалить тег`],
  },
]

/** The group page's commands in the palette, in its menu's order, as {@link NOTE_COMMANDS}. */
const GROUP_COMMANDS: readonly ActionCommand<GroupAction>[] = [
  {
    id: "group-transfer",
    action: "transfer",
    label: `AppShell.transferGroup`,
    aliases: [`hand over`, `new owner`, `передать группу`, `передать владение`],
  },
  {
    id: "group-export",
    action: "export",
    label: `AppShell.exportGroup`,
    aliases: [`download`, `backup`, `экспорт`, `скачать группу`],
  },
  {
    id: "group-leave",
    action: "leave",
    label: `AppShell.leaveGroup`,
    aliases: [`quit group`, `exit group`, `покинуть группу`, `уйти из группы`],
  },
  {
    id: "group-delete",
    action: "delete",
    label: `AppShell.deleteGroup`,
    aliases: [`remove group`, `trash`, `удалить группу`],
  },
]

/** The pages whose palette commands each run one of the page's actions; `null` while not open. */
export interface ActionPages {
  noteEditor: NotePageActions | null
  tagEditor?: TagPageActions | null
  groupEditor?: GroupPageActions | null
}

/** Each open action page's commands that it offers now, with the action each runs. */
function offeredCommands(
  open: ActionPages,
): { id: string; label: string; aliases: readonly string[]; run: () => void }[] {
  const offered = <A extends string>(
    commands: readonly ActionCommand<A>[],
    actions: Partial<Record<A, () => void>> | null | undefined,
  ) =>
    commands.flatMap((command) => {
      const run = actions?.[command.action]
      return run ? [{ ...command, run }] : []
    })
  return [
    ...offered(NOTE_COMMANDS, open.noteEditor),
    ...offered(TAG_COMMANDS, open.tagEditor),
    ...offered(GROUP_COMMANDS, open.groupEditor),
  ]
}

/** Runs the open page's action command `id`, if that page offers it now. */
export function runActionCommand(id: string, open: ActionPages): void {
  offeredCommands(open).find((command) => command.id === id)?.run()
}

/**
 * The open page's commands in the palette, if it has any: labelled in the translator's language,
 * found by their English label and their aliases too, and showing the keys of the shortcut row
 * with the same label. On a note, tag or group page, only the commands that page offers now.
 */
export function pageCommands(
  t: Translator<string>,
  open: { overview: boolean; benchmark: boolean } & ActionPages,
  rows: readonly ShortcutRow[],
): PageCommand[] | undefined {
  const actions = offeredCommands(open)
  const commands:
    | readonly { id: string; label: string; aliases?: readonly string[] }[]
    | undefined = open.overview
      ? OVERVIEW_COMMANDS
      : open.benchmark
      ? BENCHMARK_COMMANDS
      : open.noteEditor || open.tagEditor || open.groupEditor
      ? actions
      : undefined
  return commands?.map((command) => ({
    id: command.id,
    label: t.t(command.label),
    aliases: command.aliases,
    englishWords: [englishText(command.label)],
    kbd: rows.find((row) => row.description === command.label)?.keys,
  }))
}
