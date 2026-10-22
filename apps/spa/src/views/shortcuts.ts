import {
  GROUP_PATHS,
  NOTE_PATHS,
  OVERVIEW_PATHS,
  SCREEN_PATHS,
  TAG_PATHS,
} from "@ui/progressive.tsx"
import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"

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
 * binds. Search's keys, the New note dialog's and Undo's (`useUndoToast`) are bound where they act
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
    { keys: "mod+k", description: "Search notes and groups", group: general },
    { keys: "/", description: "Search notes and groups", group: general },
    { keys: "n", description: "New note", group: general, run: ports.openNewNote },
    { keys: "mod+z", description: "Undo deleting a note, while its toast shows", group: general },
    close,
    go("g o", "Overview", OVERVIEW_PATHS.root),
    go("g n", "Notes", NOTE_PATHS.list),
    go("g t", "Tags", TAG_PATHS.list),
    ...(ports.activityGroupId === null
      ? []
      : [go("g a", "Activity", GROUP_PATHS.activity(ports.activityGroupId))]),
    go("g g", "Groups", SCREEN_PATHS.groups),
    go("g i", "Notifications", SCREEN_PATHS.notifications),
    go("g p", "Profile", SCREEN_PATHS.profile),
    ...(ports.overviewPage
      ? [
        {
          keys: "d",
          description: "Change date range",
          group: page,
          run: ports.overviewPage.openRange,
        },
        {
          keys: "c",
          description: "Customise overview",
          group: page,
          run: ports.overviewPage.openCustomise,
        },
      ]
      : []),
    { keys: "enter", description: "Add note", group: newNote },
    { keys: "mod+enter", description: "Add and open", group: newNote },
  ]
}
