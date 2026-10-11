import type { NoteItem } from "../state/notes.ts"
import type { NotesCache } from "./notes-cache.ts"

/**
 * A `NotesCache` in memory, with the behaviour the IndexedDB one has that the logic relies on.
 * The unit tests of the offline layer run on it, because Deno has no IndexedDB.
 */
export function createMemoryNotesCache(): NotesCache {
  let notes: NoteItem[] = []
  return {
    readNotes: (groupId) =>
      Promise.resolve(
        notes.filter((note) => note.groupId === groupId).map((n) => ({
          ...n,
          tagIds: n.tagIds ?? [],
        })),
      ),
    replaceNotes(groupId, next) {
      notes = [...notes.filter((note) => note.groupId !== groupId), ...next.map((n) => ({ ...n }))]
      return Promise.resolve()
    },
    putNote(note) {
      const at = notes.findIndex((existing) => existing.id === note.id)
      if (at === -1) notes = [{ ...note }, ...notes]
      else notes[at] = { ...note }
      return Promise.resolve()
    },
    removeNote(noteId) {
      notes = notes.filter((note) => note.id !== noteId)
      return Promise.resolve()
    },
    clear() {
      notes = []
      return Promise.resolve()
    },
  }
}
