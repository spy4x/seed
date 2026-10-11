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

/**
 * The local-data module's entry point (ADR 003). Only `apps/spa/src/modules.ts` imports this
 * folder; the rest of the SPA takes the layer from there. `docs/offline.md` lists what to remove to
 * build without it.
 *
 * One signed-in user has three things on the device, each its own IndexedDB database:
 * - the read copies (`reads:<id>`): the last answer of every offline-readable list;
 * - the notes (`offline:user:<id>:notes`): the copy the queue keeps in step;
 * - the queue of note writes (`offline:user:<id>:outbox`).
 *
 * Signing out deletes the first two. The queue stays: it is the person's unsent work.
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
  /** Every offline-writable collection behind one ordered flush. Notes are the only one. */
  collections: Collections
  /** The notes queue and its overlay. */
  notes: NotesCollection
  /** The queued writes, for the screen: refreshed after every change to the queue. */
  entries: Signal<readonly NoteEntry[]>
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
}

let layer: OfflineLayer | null = null

/** One lock per user across all tabs of the browser; one tab's chain where locks are missing. */
function withBrowserLock(userId: number): OutboxLock {
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

/** Opens the user's device copy and queue. Calling it again for the same user does nothing. */
export function startOffline(
  userId: number,
  transport: OfflineTransport,
  storage: OfflineStorage = browserStorage,
): OfflineLayer {
  if (layer?.userId === userId) return layer
  void stopOffline()
  const cache = storage.openNotes(userId)
  const definition = notesCollection({ userId, cache, store: storage.openQueue?.(userId) })
  const collections = createCollections({
    collections: [definition],
    calls: transport.calls,
    canSend: () => transport.canSend(),
    lock: withBrowserLock(userId),
  })
  const notes = collections.get(definition)
  const entries = signal<readonly NoteEntry[]>([])
  notes.outbox.subscribe((all) => entries.value = all)
  const runner = createSyncRunner({ flush: collections.syncFlush })
  const started: OfflineLayer = {
    userId,
    reads: storage.openReads(userId),
    cache,
    collections,
    notes,
    entries,
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
 * Stops the layer. `forget` also deletes the read copies and the notes, as signing out must; the
 * queue stays, because a write that never reached the server is the person's work and goes out the
 * next time they sign in on this browser. It rejects when the device could not delete them: the
 * caller keeps the deletion owed (`modules.ts`).
 */
export async function stopOffline({ forget = false } = {}): Promise<void> {
  const closing = layer
  layer = null
  activeLayer.value = null
  if (!closing) return
  closing.runner.stop()
  closing.entries.value = []
  if (forget) await forgetCopies(closing.reads, closing.cache)
}

/** Deletes both copies. Each is tried even when the other fails; a failure rejects. */
async function forgetCopies(reads: ReadCache, cache: NotesCache): Promise<void> {
  const [readsGone, notesGone] = await Promise.allSettled([reads.clear(), cache.clear()])
  if (readsGone.status === "rejected") throw readsGone.reason
  if (notesGone.status === "rejected") throw notesGone.reason
}

/**
 * Deletes what the device kept of the server's answers for `userId`, stopping their layer first
 * when it runs. The queue stays, as on sign-out. It rejects when the device could not delete.
 */
export async function forgetDeviceCopy(
  userId: number,
  storage: OfflineStorage = browserStorage,
): Promise<void> {
  if (layer?.userId === userId) return await stopOffline({ forget: true })
  await forgetCopies(storage.openReads(userId), storage.openNotes(userId))
}

/** Sends the queued writes. Never rejects: what could not be sent stays queued. */
export async function flushOutbox(): Promise<void> {
  try {
    await layer?.collections.flush()
  } catch (_error) {
    // The queue keeps the writes; the next reconnect or push tries again.
  }
}
