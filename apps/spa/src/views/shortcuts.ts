import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  TAG_PATHS,
} from "@ui/progressive.tsx"
import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"
import type { PageCommand } from "@ui/search-palette.tsx"
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
}

/**
 * The SPA's keyboard shortcuts, the one list the "Keyboard shortcuts" dialog shows and the frame
 * binds, each described by a key of the `app` catalog. Search's keys, the New note dialog's and Undo's (`useUndoToast`) are bound where they act
 * and listed here; Activity is listed and bound only while the rail shows it, and the overview's
 * `d` and `c` only while it is open.
 */
export function spaShortcutRows(ports: SpaShortcutPorts): ShortcutRow[] {
  const { general, goTo, newNote, page } = SHORTCUT_GROUPS
  const go = (keys: string, description: string, href: string): ShortcutRow => ({
    keys,
    description,
    group: goTo,
    run: () => ports.navigate(href),
  })
  const [show, close] = generalRows(ports.openShortcuts)
  return [
    show,
    { keys: "mod+k", description: `Shortcuts.search`, group: general },
    { keys: "/", description: `Shortcuts.search`, group: general },
    { keys: "n", description: `Shortcuts.newNoteRow`, group: general, run: ports.openNewNote },
    { keys: "mod+z", description: `Shortcuts.undo`, group: general },
    close,
    go("g o", `Frame.overview`, OVERVIEW_PATHS.root),
    go("g n", `Frame.notes`, NOTE_PATHS.list),
    go("g t", `Frame.tags`, TAG_PATHS.list),
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
    { keys: "enter", description: `Shortcuts.addNote`, group: newNote },
    { keys: "mod+enter", description: `Shortcuts.addAndOpen`, group: newNote },
  ]
}

/** The overview's commands in the palette, while the overview is open; labels are `app` keys. */
const OVERVIEW_COMMANDS = [
  { id: "overview-range", label: `Shortcuts.dateRange` },
  { id: "overview-customise", label: `Shortcuts.customise` },
] as const

/** The note page's command in the palette, while a note an editor can change is open. */
const NOTE_COMMANDS = [{ id: "note-attach", label: `AppShell.attachFiles` }] as const

/**
 * The open page's commands in the palette, if it has any: labelled in the translator's language,
 * and found by their English label too.
 */
export function pageCommands(
  t: Translator<string>,
  open: { overview: boolean; noteEditor: boolean },
): PageCommand[] | undefined {
  const commands = open.overview ? OVERVIEW_COMMANDS : open.noteEditor ? NOTE_COMMANDS : undefined
  return commands?.map((command) => ({
    id: command.id,
    label: t.t(command.label),
    aliases: [englishText(command.label)],
  }))
}
