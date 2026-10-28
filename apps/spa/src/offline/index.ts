import { type Signal, signal } from "@preact/signals"
import { createDataCache } from "@spy4x/platform/browser/data-cache"
import { requestPersistentStorage } from "@spy4x/platform/browser/persistent-storage"
import type { CallPort } from "@spy4x/realtime/calls"
import { type Collections, createCollections } from "@spy4x/realtime/collections"
import {
  createPromiseLock,
  createWebLock,
  type OutboxLock,
  type OutboxStore,
} from "@spy4x/realtime/outbox"
import { createReadCache, type ReadCache } from "@spy4x/realtime/read-cache"
import { createSyncRunner, type SyncRunner } from "@spy4x/realtime/sync-runner"
import type { NoteItem } from "../state/notes.ts"
import {
  databasePrefix,
  type NoteEntry,
  type NotePayload,
  type NotesCache,
  openNotesCache,
} from "./notes-cache.ts"
import { type NotesCollection, notesCollection } from "./notes-collection.ts"
import { openTagsCache, type TagEntry, type TagPayload, type TagsCache } from "./tags-cache.ts"
import { type TagsCollection, tagsCollection } from "./tags-collection.ts"
import type { TagItem } from "../state/tags.ts"
import type { Message } from "@ui/message.ts"

/**
 * The local-data module's entry point (ADR 003). Only `apps/spa/src/modules.ts` imports this
 * folder; the rest of the SPA takes the layer from there. `docs/offline.md` lists what to remove to
 * build without it.
 *
 * One signed-in user has these things on the device, each its own IndexedDB database:
 * - the read copies (`reads:<id>`): the last answer of every offline-readable list;
 * - the notes (`offline:user:<id>:notes`): the copy the queue keeps in step;
 * - the queue of note writes (`offline:user:<id>:outbox`);
 * - the tags (`offline:user:<id>:tags`) and their queue (`offline:user:<id>:tags-outbox`).
 *
 * Stopping the layer for a sign-out deletes the read copies, the notes and the tags. The sign-out
 * then deletes every database of the app, the queues included (`wipeDevice` in `modules.ts`).
 */

/** How the layer reaches the server: the calls port, and whether it may send now. */
export interface OfflineTransport {
  /** The calls port of the signed-in user (ADR 003); the queue is sent through it. */
  calls: CallPort
  /** Whether the port is reachable as the queue's user. The queue is sent only while it is. */
  canSend(): boolean
}

/** Where the layer keeps its data. The browser's is IndexedDB; a test passes memory. */
export interface OfflineStorage {
  /** The read copies of one user. */
  openReads(userId: number): ReadCache
  /** The device's copy of one user's notes. */
  openNotes(userId: number): NotesCache
  /** The device's copy of one user's tags. */
  openTags(userId: number): TagsCache
  /** The tags queue of one user, when it is not the IndexedDB one the collection opens itself. */
  openTagsQueue?(userId: number): OutboxStore<TagPayload, TagItem>
  /** The notes queue of one user, when it is not the IndexedDB one the collection opens itself. */
  openQueue?(userId: number): OutboxStore<NotePayload, NoteItem>
}

/** The device copy and the queue of one signed-in user. */
export interface OfflineLayer {
  userId: number
  /** The read copies: what an offline-readable list answers from when the server is unreachable. */
  reads: ReadCache
  /** The device's copy of the notes. */
  cache: NotesCache
  /** The device's copy of the tags. */
  tagsCache: TagsCache
  /** Every offline-writable collection behind one ordered flush: tags first, then notes. */
  collections: Collections
  /** The notes queue and its overlay. */
  notes: NotesCollection
  /** The tags queue and its overlay. */
  tags: TagsCollection
  /** The queued note writes, for the screen: refreshed after every change to the queue. */
  entries: Signal<readonly NoteEntry[]>
  /** The queued tag writes, for the screen. */
  tagEntries: Signal<readonly TagEntry[]>
  /**
   * What the layer did without asking: a tag that will never exist was taken off queued notes.
   * Each is a key of the `app` catalog with its values; the screen shows it in the person's
   * language until they dismiss it.
   */
  notices: Signal<readonly Message[]>
  /** Sends the queue on start, reconnect, visibility and focus, retrying with backoff. */
  runner: SyncRunner
}

/** The name of a user's read-copy database. */
export function readsDatabase(userId: number): string {
  return `reads:${userId}`
}

/** The read-copy key the groups list is kept under (`apps/spa/src/state/read-keys.ts`). */
const GROUPS_KEY = "groups"

/**
 * Moves the groups an earlier version kept in their own database (`offline:user:<id>:groups`) into
 * the read copies, then deletes that database. It runs once per device: afterwards the database is
 * gone. A copy the read cache already holds is newer and is kept.
 */
async function retireGroupsDatabase(userId: number, reads: ReadCache): Promise<void> {
  const name = `${databasePrefix(userId)}:groups`
  try {
    // Opening a database creates it, so look first where the browser can list them.
    const existing = await indexedDB.databases?.()
    if (existing && !existing.some((database) => database.name === name)) return
    const old = createDataCache<{ id: string }>({ name, getId: (group) => group.id })
    const groups = await old.read("groups")
    if (groups.length > 0 && await reads.get(GROUPS_KEY) === undefined) {
      await reads.set(GROUPS_KEY, groups)
    }
    indexedDB.deleteDatabase(name)
  } catch (_error) {
    // Blocked storage: there is nothing to move, and the next start tries again.
  }
}

/** A read cache whose every step waits for `ready`, so nothing is read before a move finished. */
function after(ready: Promise<void>, cache: ReadCache): ReadCache {
  return {
    get: async (key) => (await ready, await cache.get(key)),
    set: async (key, value) => (await ready, await cache.set(key, value)),
    delete: async (key) => (await ready, await cache.delete(key)),
    clear: async () => (await ready, await cache.clear()),
  }
}

/** The browser's storage: IndexedDB databases named for the user. */
export const browserStorage: OfflineStorage = {
  openReads(userId) {
    const reads = createReadCache({ name: readsDatabase(userId) })
    return after(retireGroupsDatabase(userId, reads), reads)
  },
  openNotes: openNotesCache,
  openTags: openTagsCache,
}

let layer: OfflineLayer | null = null

/** One lock per user across all tabs of the browser; one tab's chain where locks are missing. */
export function withBrowserLock(userId: number): OutboxLock {
  return typeof navigator !== "undefined" && navigator.locks
    ? createWebLock(navigator.locks, `offline-outbox:${userId}`)
    : createPromiseLock()
}

/** The running layer as a signal, so a screen that shows the queue redraws when it starts. */
export const activeLayer = signal<OfflineLayer | null>(null)

/** The running layer, or `null` before sign-in: the stores then talk to the server alone. */
export function currentLayer(): OfflineLayer | null {
  return layer
}

/**
 * Opens the user's device copy and queue. Calling it again for the same user does nothing. Called
 * for another user while one runs, it stops that layer and deletes its copies, as signing out does:
 * the device must not keep one person's data for the next. The queue is deleted with every other
 * database by `wipeDevice` in `modules.ts`, which a change of user runs. A device that refuses the
 * deletion is left to the debt `modules.ts` keeps for the person it remembered.
 */
export function startOffline(
  userId: number,
  transport: OfflineTransport,
  storage: OfflineStorage = browserStorage,
): OfflineLayer {
  if (layer?.userId === userId) return layer
  if (layer) void stopOffline({ forget: true }).catch(() => {})
  const cache = storage.openNotes(userId)
  const tagsCache = storage.openTags(userId)
  const notices = signal<readonly Message[]>([])
  const tagsDefinition = tagsCollection({
    userId,
    cache: tagsCache,
    store: storage.openTagsQueue?.(userId),
  })
  const definition = notesCollection({ userId, cache, store: storage.openQueue?.(userId) })
  const collections = createCollections({
    // Parents first (ADR 003, section 5): a note names tags, so tags go out before notes.
    collections: [tagsDefinition, definition],
    calls: transport.calls,
    canSend: () => transport.canSend(),
    lock: withBrowserLock(userId),
    onReferenceRemoved({ children }) {
      const count = children.length
      notices.value = [...notices.value, { key: `OfflineStatus.tagTakenOff`, values: { count } }]
    },
  })
  const tags = collections.get(tagsDefinition)
  const notes = collections.get(definition)
  const entries = signal<readonly NoteEntry[]>([])
  const tagEntries = signal<readonly TagEntry[]>([])
  notes.outbox.subscribe((all) => entries.value = all)
  tags.outbox.subscribe((all) => tagEntries.value = all)
  const runner = createSyncRunner({ flush: collections.syncFlush })
  const started: OfflineLayer = {
    userId,
    reads: storage.openReads(userId),
    cache,
    tagsCache,
    collections,
    tags,
    notes,
    entries,
    tagEntries,
    notices,
    runner,
  }
  layer = started
  activeLayer.value = started
  // The queue is read first, so the runner's first flush sends what an earlier visit left. A
  // layer that was stopped meanwhile (the person signed out) does not start its runner: nothing
  // would stop it again.
  void collections.reload().then(() => {
    if (layer === started) runner.start()
  }, () => {})
  // Ask the browser not to evict the device copy and the queue; Safari clears idle sites.
  void requestPersistentStorage().catch(() => {})
  return started
}

/**
 * Stops the layer. `forget` also deletes the read copies and the notes, as signing out must. The
 * queue stays here: a start with the module off still sends it once, and a sign-out deletes it with
 * every other database (`wipeDevice` in `modules.ts`). It rejects when the device could not delete
 * the copies: the caller keeps the deletion owed (`modules.ts`).
 */
export async function stopOffline({ forget = false } = {}): Promise<void> {
  const closing = layer
  layer = null
  activeLayer.value = null
  if (!closing) return
  closing.runner.stop()
  closing.entries.value = []
  closing.tagEntries.value = []
  closing.notices.value = []
  if (forget) await forgetCopies(closing.reads, closing.cache, closing.tagsCache)
}

/** Deletes every copy. Each is tried even when another fails; the first failure rejects. */
async function forgetCopies(
  reads: ReadCache,
  cache: NotesCache,
  tagsCache: TagsCache,
): Promise<void> {
  const results = await Promise.allSettled([reads.clear(), cache.clear(), tagsCache.clear()])
  for (const result of results) if (result.status === "rejected") throw result.reason
}

/**
 * Deletes what the device kept of the server's answers for `userId`, stopping their layer first
 * when it runs. The queue stays; a sign-out deletes it (`wipeDevice` in `modules.ts`). It rejects
 * when the device could not delete.
 */
export async function forgetDeviceCopy(
  userId: number,
  storage: OfflineStorage = browserStorage,
): Promise<void> {
  if (layer?.userId === userId) return await stopOffline({ forget: true })
  await forgetCopies(
    storage.openReads(userId),
    storage.openNotes(userId),
    storage.openTags(userId),
  )
}

/** Sends the queued writes. Never rejects: what could not be sent stays queued. */
export async function flushOutbox(): Promise<void> {
  try {
    await layer?.collections.flush()
  } catch (_error) {
    // The queue keeps the writes; the next reconnect or push tries again.
  }
}
