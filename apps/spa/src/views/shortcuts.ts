import { GROUP_PATHS, NOTE_PATHS, SCREEN_PATHS, TAG_PATHS } from "@ui/progressive.tsx"
import { generalRows, SHORTCUT_GROUPS, type ShortcutRow } from "@ui/shortcuts.tsx"

/** What the SPA's shortcuts act on. */
export interface SpaShortcutPorts {
  navigate: (href: string) => void
  openShortcuts: () => void
  openNewNote: () => void
  /** The group whose Activity the rail shows, or `null` while it shows none. */
  activityGroupId: string | null
}

/**
 * The SPA's keyboard shortcuts, the one list the "Keyboard shortcuts" dialog shows and the frame
 * binds. Search's keys and the New note dialog's are bound by those components and listed here;
 * Activity is listed and bound only while the rail shows it.
 */
export function spaShortcutRows(ports: SpaShortcutPorts): ShortcutRow[] {
  const { general, goTo, newNote } = SHORTCUT_GROUPS
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
    close,
    go("g n", "Notes", NOTE_PATHS.list),
    go("g t", "Tags", TAG_PATHS.list),
    ...(ports.activityGroupId === null
      ? []
      : [go("g a", "Activity", GROUP_PATHS.activity(ports.activityGroupId))]),
    go("g g", "Groups", SCREEN_PATHS.groups),
    go("g i", "Notifications", SCREEN_PATHS.notifications),
    go("g p", "Profile", SCREEN_PATHS.profile),
    { keys: "enter", description: "Add note", group: newNote },
    { keys: "mod+enter", description: "Add and open", group: newNote },
  ]
}
