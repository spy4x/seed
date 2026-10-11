import { createMemoryOutboxStore, type OutboxStore } from "@spy4x/realtime/outbox"
import { createMemoryReadCache } from "../state/memory-reads.ts"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import type { OfflineStorage } from "./index.ts"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import type { NotePayload, NotesCache } from "./notes-cache.ts"
import type { TagPayload, TagsCache } from "./tags-cache.ts"

/** What one user has on a device in memory. */
export interface MemoryDevice {
  /** The read copies, by key. */
  reads: Map<string, { value: unknown; savedAt: number }>
  notes: NotesCache
  queue: OutboxStore<NotePayload, NoteItem>
  tags: TagsCache
  tagsQueue: OutboxStore<TagPayload, TagItem>
}

/**
 * A device in memory, for the tests: Deno has no IndexedDB. Like the browser's, it keeps each
 * user's data apart and still holds it when the layer is opened again.
 */
export function createMemoryStorage(): OfflineStorage & {
  /** What the device holds for `userId`. */
  of(userId: number): MemoryDevice
} {
  const devices = new Map<number, MemoryDevice>()
  function of(userId: number): MemoryDevice {
    let device = devices.get(userId)
    if (!device) {
      device = {
        reads: new Map(),
        notes: createMemoryNotesCache(),
        queue: createMemoryOutboxStore<NotePayload, NoteItem>(),
        tags: createMemoryTagsCache(),
        tagsQueue: createMemoryOutboxStore<TagPayload, TagItem>(),
      }
      devices.set(userId, device)
    }
    return device
  }
  return {
    of,
    openReads: (userId) => createMemoryReadCache(() => 0, of(userId).reads),
    openNotes: (userId) => of(userId).notes,
    openQueue: (userId) => of(userId).queue,
    openTags: (userId) => of(userId).tags,
    openTagsQueue: (userId) => of(userId).tagsQueue,
  }
}
