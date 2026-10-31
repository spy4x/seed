import { createMemoryOutboxStore, type OutboxStore } from "@spy4x/realtime/outbox"
import { createMemoryReadCache } from "@spy4x/realtime/testing"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import type { OfflineStorage } from "./index.ts"
import type { QueueDatabases } from "./send-once.ts"
import type { ChangesCopy } from "@spy4x/realtime/changes"
import { type ChangesRows, deviceCopy } from "./device-copy.ts"
import { createMemoryChangesCopy } from "./memory-changes.ts"
import type { NotePayload, NotesCache } from "./notes-cache.ts"
import type { TagPayload, TagsCache } from "./tags-cache.ts"

/** What one user has on a device in memory. */
export interface MemoryDevice {
  /** The read copies, by key. */
  reads: Map<string, { value: unknown; savedAt: number }>
  /** The changes copy: every group's notes and tags and their cursors. */
  copy: ChangesCopy<ChangesRows>
  /** The copy's notes, as the layer reads them. */
  notes: NotesCache
  queue: OutboxStore<NotePayload, NoteItem>
  /** The copy's tags, as the layer reads them. */
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
      const copy = createMemoryChangesCopy()
      const views = deviceCopy({
        copy,
        fetch: () => Promise.reject(new Error("a test reads the copy without the server")),
      })
      device = {
        reads: new Map(),
        copy,
        notes: views.notes,
        queue: createMemoryOutboxStore<NotePayload, NoteItem>(),
        tags: views.tags,
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
      [`offline:user:${userId}:changes`, () => device.copy.clear()],
      [`offline:user:${userId}:outbox`, () => emptyQueue(device.queue)],
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
    openCopy: (userId) => of(userId).copy,
    openQueue: (userId) => of(userId).queue,
    openTagsQueue: (userId) => of(userId).tagsQueue,
  }
}
