import { createMemoryOutboxStore, type OutboxStore } from "@spy4x/realtime/outbox"
import { createMemoryReadCache } from "@spy4x/realtime/testing"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import type { OfflineStorage } from "./index.ts"
import type { QueueDatabases } from "./send-once.ts"
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
  /** The device's databases by their browser names; deleting one empties that part. */
  databases: QueueDatabases
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
  /** Each user's databases, by the names the browser gives them, and how to empty each. */
  function parts(userId: number, device: MemoryDevice): [string, () => Promise<void>][] {
    const emptyQueue = async (queue: OutboxStore<unknown, unknown>) => {
      for (const entry of await queue.readOutbox()) await queue.removeEntry(entry.seq!)
    }
    return [
      [`reads:${userId}`, () => Promise.resolve(device.reads.clear())],
      [`offline:user:${userId}:notes`, () => device.notes.clear()],
      [`offline:user:${userId}:outbox`, () => emptyQueue(device.queue)],
      [`offline:user:${userId}:tags`, () => device.tags.clear()],
      [`offline:user:${userId}:tags-outbox`, () => emptyQueue(device.tagsQueue)],
    ]
  }
  const all = () => [...devices].flatMap(([userId, device]) => parts(userId, device))
  return {
    databases: {
      list: () => Promise.resolve(all().map(([name]) => name)),
      delete: async (name) => await all().find(([candidate]) => candidate === name)?.[1](),
    },
    of,
    openReads: (userId) => createMemoryReadCache(() => 0, of(userId).reads),
    openNotes: (userId) => of(userId).notes,
    openQueue: (userId) => of(userId).queue,
    openTags: (userId) => of(userId).tags,
    openTagsQueue: (userId) => of(userId).tagsQueue,
  }
}
