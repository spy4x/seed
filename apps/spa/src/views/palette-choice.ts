import type { ThemePreference } from "@domain/identity"
import { GROUP_PATHS, NOTE_PATHS, TAG_PATHS } from "@ui/progressive.tsx"
import type { SearchChoice } from "@ui/search-palette.tsx"

/** What {@link runChoice} drives: the shell's own functions, the ones its buttons and keys call. */
export interface ChoicePorts {
  navigate: (to: string) => void
  /** The group the notes pages show, or `null` for none. */
  currentGroupId: string | null
  selectGroup: (groupId: string) => Promise<unknown> | void
  /** The group switcher's switch, which also leaves a note of the group just left. */
  switchGroup: (groupId: string) => void
  /** Opens the New note dialog; `title`, given, fills its title. */
  newNote: (title?: string) => void
  /**
   * Adds a note titled `title` to the current group. Resolves its id, or `null` when it was refused
   * or failed: the New note dialog is then open on the text and why.
   */
  addNote: (title: string) => Promise<string | null>
  /** Puts `name` in the create form of a tag or a group, as if typed there. */
  fillForm: (entity: "tag" | "group", name: string) => void
  /**
   * Creates the tag or group its filled create form holds. Resolves its id, or `null` when it was
   * refused or failed: the form keeps the text and why.
   */
  createFromForm: (entity: "tag" | "group") => Promise<string | null>
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
    case "quick-create":
      return await quickCreate(choice, ports)
  }
}

/**
 * A quick-create pick: Enter opens the create form with the text filled in (the New note dialog,
 * the new tag or new group page); `now` creates the item and opens it (the note's page, the tag's
 * editor, the group's page, which becomes the current group, as the group editor's create does).
 * A refused or failed create never loses the text: its form opens on the text and why.
 */
async function quickCreate(
  { entity, title, now }: Extract<SearchChoice, { kind: "quick-create" }>,
  ports: ChoicePorts,
): Promise<void> {
  if (entity === "note") {
    if (!now) return ports.newNote(title)
    const noteId = await ports.addNote(title)
    if (noteId !== null) ports.navigate(NOTE_PATHS.note(noteId))
    return
  }
  ports.fillForm(entity, title)
  const id = now ? await ports.createFromForm(entity) : null
  if (id === null) return ports.navigate(entity === "tag" ? TAG_PATHS.new : GROUP_PATHS.new)
  if (entity === "tag") return ports.navigate(TAG_PATHS.tag(id))
  // The group is in the list before the address changes, so its page draws at once.
  ports.navigate(GROUP_PATHS.settings(id))
  await ports.selectGroup(id)
}
