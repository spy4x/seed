import type { ThemePreference } from "@domain/identity"
import { GROUP_PATHS, NOTE_PATHS } from "@ui/progressive.tsx"
import type { SearchChoice } from "@ui/search-palette.tsx"

/** What {@link runChoice} drives: the shell's own functions, the ones its buttons and keys call. */
export interface ChoicePorts {
  navigate: (to: string) => void
  /** The group the notes pages show, or `null` for none. */
  currentGroupId: string | null
  selectGroup: (groupId: string) => Promise<unknown> | void
  /** The group switcher's switch, which also leaves a note of the group just left. */
  switchGroup: (groupId: string) => void
  newNote: () => void
  runPageCommand: (id: string) => void
  setTheme: (theme: ThemePreference) => void
  openShortcuts: () => void
  /** The account menu's sign-out, which asks about unsent changes first. */
  signOut: () => void
  install: () => void
}

/** Does what a palette pick asks, through the same function as its button or shortcut. */
export async function runChoice(choice: SearchChoice, ports: ChoicePorts): Promise<void> {
  switch (choice.kind) {
    case "page":
      return ports.navigate(choice.href)
    case "new-note":
      return ports.newNote()
    case "command":
      return ports.runPageCommand(choice.id)
    case "switch-group":
      return ports.switchGroup(choice.groupId)
    case "group-settings":
      return ports.navigate(GROUP_PATHS.settings(choice.groupId))
    case "theme":
      return ports.setTheme(choice.theme)
    case "shortcuts":
      return ports.openShortcuts()
    case "sign-out":
      return ports.signOut()
    case "install":
      return ports.install()
    case "note":
      // Straight to the note: never the editor's "Note in another group" page in between.
      if (choice.groupId !== ports.currentGroupId) await ports.selectGroup(choice.groupId)
      return ports.navigate(NOTE_PATHS.note(choice.noteId))
  }
}
