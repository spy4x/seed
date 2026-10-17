import { createCollections } from "@spy4x/realtime/collections"
import { createMemoryOutboxStore, type OutboxStore } from "@spy4x/realtime/outbox"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import { type OfflineStorage, type OfflineTransport, withBrowserLock } from "./index.ts"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import { databasePrefix, type NotePayload } from "./notes-cache.ts"
import { notesCollection } from "./notes-collection.ts"
import { type TagPayload, tagsQueueDatabase } from "./tags-cache.ts"
import { TAGS_COLLECTION, tagsCollection } from "./tags-collection.ts"

/** The IndexedDB databases a device holds, by name, as far as the queue needs them. */
export interface QueueDatabases {
  /** The names of the databases on the device; `undefined` where the browser cannot list them. */
  list(): Promise<readonly string[] | undefined>
  /** Deletes one database. */
  delete(name: string): Promise<void>
}

/** The browser's IndexedDB, listed without opening anything: opening a database creates it. */
export const browserDatabases: QueueDatabases = {
  async list() {
    if (typeof indexedDB === "undefined") return undefined
    const all = await indexedDB.databases?.()
    return all?.map((database) => database.name ?? "")
  },
  delete(name) {
    return new Promise((resolve, reject) => {
      const deleting = indexedDB.deleteDatabase(name)
      deleting.onsuccess = () => resolve()
      deleting.onerror = () => reject(deleting.error)
    })
  },
}

/** What {@link sendQueueOnce} did. */
export interface SendOnceResult {
  /**
   * `true` once the device holds no queue for the user: there was none, or every write was sent or
   * dropped and the databases were deleted. `false` while a write could not reach the server; the
   * queue is kept for the next try.
   */
  done: boolean
  /** What each write the server refused was about, in queue order; they were dropped. */
  refused: string[]
}

/** Options of {@link sendQueueOnce}. */
export interface SendOnceOptions {
  userId: number
  transport: OfflineTransport
  /** Tests pass their queues here; the browser's are the IndexedDB ones. */
  storage?: Pick<OfflineStorage, "openQueue" | "openTagsQueue">
  databases?: QueueDatabases
}

/**
 * With the local-data module switched off (`SPA_OFFLINE=false`), sends the queue an earlier visit
 * left on the device, once, then deletes it: nothing is kept on a device the module is off for.
 *
 * Nothing is opened on a device without a queue. A write that cannot reach the server keeps the
 * whole queue for the next try (the next start, or the browser coming back online). A write the
 * server refuses cannot be resolved without the conflict screen, which is off with the module, so
 * it is dropped and named in the result for the app to say so.
 */
export async function sendQueueOnce(
  { userId, transport, storage = {}, databases = browserDatabases }: SendOnceOptions,
): Promise<SendOnceResult> {
  const notesName = `${databasePrefix(userId)}:outbox`
  const tagsName = tagsQueueDatabase(userId)
  const names = await databases.list()
  // A browser that cannot list its databases cannot tell without creating one; it keeps the queue.
  if (!names) return { done: false, refused: [] }
  const hasNotes = names.includes(notesName)
  const hasTags = names.includes(tagsName)
  if (!hasNotes && !hasTags) return { done: true, refused: [] }
  if (!transport.canSend()) return { done: false, refused: [] }

  // The queue that is absent stays in memory, so no database is created for it.
  const tagsStore: OutboxStore<TagPayload, TagItem> | undefined = hasTags
    ? storage.openTagsQueue?.(userId)
    : createMemoryOutboxStore()
  const notesStore: OutboxStore<NotePayload, NoteItem> | undefined = hasNotes
    ? storage.openQueue?.(userId)
    : createMemoryOutboxStore()
  const tagsDefinition = tagsCollection({
    userId,
    cache: createMemoryTagsCache(),
    store: tagsStore,
  })
  const notesDefinition = notesCollection({
    userId,
    cache: createMemoryNotesCache(),
    store: notesStore,
  })
  const collections = createCollections({
    collections: [tagsDefinition, notesDefinition],
    calls: transport.calls,
    canSend: () => transport.canSend(),
    lock: withBrowserLock(userId),
  })
  const tags = collections.get(tagsDefinition)
  const notes = collections.get(notesDefinition)
  await collections.reload()
  try {
    await collections.flush()
  } catch (_unreachable) {
    // What did not go out is still queued; the check below keeps it.
  }

  const held = new Set(
    collections.waiting().filter((waiting) => waiting.onPerson)
      .map((waiting) => `${waiting.collection}:${waiting.entityId}`),
  )
  const tagEntries = tags.outbox.entries()
  const noteEntries = notes.outbox.entries()
  const isRefused = (collection: string) => (entry: { status: string; entityId: string }) =>
    entry.status === "conflict" || held.has(`${collection}:${entry.entityId}`)
  const waiting = [
    ...tagEntries.filter((entry) => !isRefused(TAGS_COLLECTION)(entry)),
    ...noteEntries.filter((entry) => !isRefused("notes")(entry)),
  ]
  if (waiting.length > 0) return { done: false, refused: [] }

  const refused = [
    ...tagEntries.map((entry) => entry.payload.name || "Untitled tag"),
    ...noteEntries.map((entry) => entry.payload.title || "Untitled note"),
  ]
  // The databases this device had are deleted; an open connection closes on the deletion's
  // version change.
  for (const name of [hasTags && tagsName, hasNotes && notesName]) {
    if (name) await databases.delete(name)
  }
  return { done: true, refused }
}

/**
 * The warning for writes {@link sendQueueOnce} dropped: how many, and the first three by name.
 * `""` when there were none.
 */
export function refusedMessage(refused: readonly string[]): string {
  if (refused.length === 0) return ""
  const count = refused.length
  const shown = refused.slice(0, 3).map((label) => `"${label}"`).join(", ")
  const more = count > 3 ? ` and ${count - 3} more` : ""
  const changes = count === 1 ? "1 change" : `${count} changes`
  return `${changes} you made offline couldn't be saved: ${shown}${more}.`
}
