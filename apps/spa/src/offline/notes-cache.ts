import { createDataCache } from "@spy4x/platform/browser/data-cache"
import type { OutboxEntry } from "@spy4x/realtime/outbox"
import type { NoteItem } from "../state/notes.ts"

/** What the person wrote in a queued note write: the outbox's payload. */
export interface NotePayload {
  groupId: string
  title: string
  body: string
  /** The tags on the note. A queued write from before tags existed has none: read as empty. */
  tagIds?: string[]
}

/** One queued note write, as the outbox from `@spy4x/realtime/outbox` keeps it. */
export type NoteEntry = OutboxEntry<NotePayload, NoteItem>

/** The notes the server last sent, kept on this device for one signed-in user. */
export interface NotesCache {
  /** A group's notes as the server last answered, in the server's order. */
  readNotes(groupId: string): Promise<NoteItem[]>
  /** Replaces a group's notes with a full server answer. */
  replaceNotes(groupId: string, notes: readonly NoteItem[]): Promise<void>
  putNote(note: NoteItem): Promise<void>
  removeNote(noteId: string): Promise<void>
  /** Drops every note. The queue is another database and stays. */
  clear(): Promise<void>
}

/** The IndexedDB databases of one user are all named from this. */
export function databasePrefix(userId: number): string {
  return `offline:user:${userId}`
}

/**
 * The notes of one user on this browser (`createDataCache`), in a database named for the user and
 * never shared between users. Each group is a scope, so one group's full read replaces only its
 * own notes.
 */
export function openNotesCache(userId: number): NotesCache {
  const notes = createDataCache<NoteItem>({
    name: `${databasePrefix(userId)}:notes`,
    getId: (note) => note.id,
  })
  return {
    // A copy kept before tags existed has no `tagIds`: the note then has no tags.
    readNotes: async (groupId) =>
      (await notes.read(groupId)).map((note) => ({ ...note, tagIds: note.tagIds ?? [] })),
    replaceNotes: (groupId, next) => notes.replace(groupId, next),
    async putNote(note) {
      // A moved note changes scope: drop it from every other group's copy in the same step.
      const others = (await notes.scopes()).filter((scope) => scope !== note.groupId)
      await notes.batch([
        ...others.map((scope) => ({ op: "delete" as const, scope, id: note.id })),
        { op: "put", scope: note.groupId, item: note },
      ])
    },
    async removeNote(noteId) {
      // A note's group is not known here, so remove it from every scope that holds notes.
      const scopes = await notes.scopes()
      await notes.batch(scopes.map((scope) => ({ op: "delete" as const, scope, id: noteId })))
    },
    clear: () => notes.clearAll(),
  }
}
