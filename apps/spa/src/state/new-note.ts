import { signal } from "@preact/signals"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { NEW_NOTE_TEXT, type NewNoteAdded, type NewNoteErrors } from "@ui/new-note-dialog.tsx"
import { type NoteItem, notesStore } from "./notes.ts"

/** What the New note store needs: the notes store's quick create, and a fresh note id. */
export interface NewNoteDependencies {
  create(
    input: { groupId: string; id: string; title: string },
  ): Promise<{ note: NoteItem } | { errors: NewNoteErrors }>
  newId(): string
}

/** The group the note goes to, as the dialog names it. */
export interface NewNoteTarget {
  id: string
  name: string
}

const NO_ERRORS: NewNoteErrors = {}

/**
 * The New note dialog's state, kept while the dialog is closed so the unsent title is there at the
 * next open. One id per note: kept across a failed try, so a retry the server already took is not
 * made twice, and renewed once a note is added.
 */
export function createNewNoteStore(dependencies: NewNoteDependencies) {
  const open = signal(false)
  const title = signal("")
  /** The group chosen in the dialog; `null` keeps the selected one. */
  const groupId = signal<string | null>(null)
  const pending = signal(false)
  const errors = signal<NewNoteErrors>(NO_ERRORS)
  const added = signal<NewNoteAdded | null>(null)
  let id = dependencies.newId()

  /** Opens the dialog with what was left in it; the last success line is gone. */
  function show(): void {
    added.value = null
    errors.value = NO_ERRORS
    open.value = true
  }

  /** Closes the dialog and keeps the text. */
  function close(): void {
    open.value = false
  }

  /**
   * Adds the note to `target`. Resolves the note once made, `null` when it was refused or failed;
   * the text stays then and `errors` says why. A second call while one runs does nothing.
   */
  async function add(target: NewNoteTarget | null): Promise<NoteItem | null> {
    if (pending.value) return null
    if (!target) {
      errors.value = { group: NEW_NOTE_TEXT.chooseGroupError }
      return null
    }
    pending.value = true
    errors.value = NO_ERRORS
    try {
      const outcome = await dependencies.create({ groupId: target.id, id, title: title.value })
      if ("errors" in outcome) {
        errors.value = outcome.errors
        return null
      }
      const { note } = outcome
      added.value = {
        noteId: note.id,
        groupId: target.id,
        title: note.title,
        groupName: target.name,
        // A note the server has not seen yet shows with version 0 (`offline/notes-collection.ts`).
        onDevice: note.version === 0,
      }
      title.value = ""
      id = dependencies.newId()
      return note
    } finally {
      pending.value = false
    }
  }

  /** Forgets everything, for the next person signed in on this device. */
  function reset(): void {
    open.value = false
    title.value = ""
    groupId.value = null
    pending.value = false
    errors.value = NO_ERRORS
    added.value = null
    id = dependencies.newId()
  }

  return { open, title, groupId, pending, errors, added, show, close, add, reset }
}

export const newNoteStore = createNewNoteStore({
  create: (input) => notesStore.quickCreate(input),
  newId: () => uuidV7(),
})
