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

/**
 * The notes the server sent, kept on this device for one signed-in user: a view over the changes
 * copy (`device-copy.ts`), which the pull keeps in step.
 */
export interface NotesCache {
  /** A group's notes on the device, newest change first, as the server lists them. */
  readNotes(groupId: string): Promise<NoteItem[]>
  /** Keeps a note a write or a read answered with, in its own group and in no other. */
  putNote(note: NoteItem): Promise<void>
  removeNote(noteId: string): Promise<void>
  /**
   * Drops every note. The queue is another database and stays. The copy is finished after this: a
   * write that arrives later saves nothing, so an answer still on its way at sign-out cannot put
   * the notes back. The next start opens a new one.
   */
  clear(): Promise<void>
}

/** The IndexedDB databases of one user are all named from this. */
export function databasePrefix(userId: number): string {
  return `offline:user:${userId}`
}
