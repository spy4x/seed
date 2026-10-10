import { RealtimeRequestError } from "@spy4x/realtime"
import { isRetryable } from "@spy4x/realtime/calls"
import {
  createOutbox,
  type Outbox,
  type OutboxCommand,
  type OutboxLock,
  type SendFailure,
} from "@spy4x/realtime/outbox"
import type { NoteItem } from "../state/notes.ts"
import type { LocalStore, NoteEntry, NotePayload } from "./local-store.ts"

/** The offline outbox as the notes use it: a note is the entity, its text the payload. */
export type NotesOutbox = Outbox<NotePayload, NoteItem>

/** What the notes outbox needs from the outside. Injected so tests need no network or IndexedDB. */
export interface NotesOutboxPorts {
  store: LocalStore
  /** Sends one note command through the calls port with the idempotency key. One try. */
  send(
    name: `note.${OutboxCommand<NotePayload>["kind"]}`,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown>
  /** The server's note as it is now, or `null` when it is gone. Rejects when unreachable. */
  fetchNote(groupId: string, noteId: string): Promise<NoteItem | null>
  lock: OutboxLock
  /** Whether the calls port is reachable and the page is signed in as the queue's user. */
  isOnline(): boolean
  newKey?(): string
  now?(): string
}

function codeOf(error: RealtimeRequestError): string | null {
  const code = (error.details as { code?: unknown } | undefined)?.code
  return typeof code === "string" ? code : null
}

/** Reads a failed note command: unreachable (try later) or the server's refusal and its code. */
export function classifyNoteError(error: unknown): SendFailure {
  if (!(error instanceof RealtimeRequestError) || isRetryable(error)) return { kind: "unreachable" }
  // The session ended, belongs to someone else or owes a second factor (the server answers all
  // three as `unauthorized`): the write was not judged, so it stays queued for its owner.
  if (error.code === "unauthorized") return { kind: "unreachable" }
  switch (codeOf(error)) {
    case "VERSION_CONFLICT":
      return { kind: "version" }
    case "NOTE_NOT_FOUND":
      return { kind: "not-found" }
    case "ID_ALREADY_EXISTS":
      return { kind: "already-exists" }
    default:
      return { kind: "rejected", message: error.message }
  }
}

/** Puts the notes' commands, error codes and local store behind the library's outbox. */
export function createNotesOutbox(ports: NotesOutboxPorts): NotesOutbox {
  const { store } = ports
  return createOutbox<NotePayload, NoteItem>({
    store,
    lock: ports.lock,
    canSend: ports.isOnline,
    newKey: ports.newKey,
    now: ports.now,
    classify: classifyNoteError,
    messages: {
      version: "Someone changed this note while you were offline.",
      gone: "This note was deleted, or moved to another group, while you were offline.",
    },
    cache: {
      put: (note) => store.putNote(note),
      remove: (noteId) => store.removeNote(noteId),
    },
    async send({ kind, entityId, payload, baseVersion }, key) {
      const base = { groupId: payload.groupId, id: entityId }
      if (kind === "delete") {
        await ports.send("note.delete", { ...base, version: baseVersion }, key)
        return
      }
      const text = { title: payload.title, body: payload.body }
      const body = kind === "create"
        ? { ...base, ...text }
        : { ...base, ...text, version: baseVersion }
      const result = await ports.send(`note.${kind}`, body, key)
      return (result as { note?: NoteItem } | undefined)?.note
    },
    // The queue still holds the entry while the outbox asks, and it knows the note's group.
    async fetchServer(noteId) {
      const entry = (await store.readOutbox()).find((queued) => queued.entityId === noteId)
      return entry ? await ports.fetchNote(entry.payload.groupId, noteId) : null
    },
  })
}

/**
 * The notes of a group as this person sees them: the server's (or the last it sent), with the
 * queued writes applied. A note created offline shows at the top with version 0.
 */
export function overlayNotes(
  entries: readonly NoteEntry[],
  userId: number,
  groupId: string,
  base: readonly NoteItem[],
): NoteItem[] {
  let notes = [...base]
  for (const entry of entries) {
    if (entry.payload.groupId !== groupId) continue
    const { title, body } = entry.payload
    if (entry.kind === "delete") {
      notes = notes.filter((note) => note.id !== entry.entityId)
      continue
    }
    const at = notes.findIndex((note) => note.id === entry.entityId)
    if (at !== -1) {
      notes[at] = { ...notes[at], title, body }
    } else if (entry.kind === "create") {
      notes.unshift({
        id: entry.entityId,
        groupId,
        title,
        body,
        version: 0,
        changeSequence: "0",
        createdByUserId: userId,
        updatedByUserId: userId,
        createdAt: entry.queuedAt,
        updatedAt: entry.queuedAt,
      })
    }
  }
  return notes
}
