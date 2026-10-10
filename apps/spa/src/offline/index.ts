import { type Signal, signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { requestPersistentStorage } from "@spy4x/platform/browser/persistent-storage"
import {
  createSyncRunner,
  flushOutbox as outboxFlush,
  type SyncRunner,
} from "@spy4x/realtime/sync-runner"
import { createPromiseLock, createWebLock, type OutboxLock } from "@spy4x/realtime/outbox"
import { type CallPort, sendCommand, sendQuery } from "@spy4x/realtime/calls"
import type { NoteItem } from "../state/notes.ts"
import { type LocalStore, type NoteEntry, openLocalStore } from "./local-store.ts"
import { startRunnerWhileCurrent } from "./start-runner.ts"
import { createNotesOutbox, type NotesOutbox } from "./notes-outbox.ts"

/**
 * The offline layer's entry point. Only `apps/spa/src/modules.ts` imports this folder; the rest of
 * the SPA takes the layer from there. `docs/offline.md` lists what to remove to build without it.
 */

/** How the layer reaches the server: the calls port, and whether it may send now. */
export interface OfflineTransport {
  /** The calls port of the signed-in user (ADR 003); the queue is sent through it. */
  calls: CallPort
  /** Whether the port is reachable as the queue's user. The queue is sent only while it is. */
  canSend(): boolean
}

/** The local store and the queue of one signed-in user. */
export interface OfflineLayer {
  userId: number
  store: LocalStore
  outbox: NotesOutbox
  /** The queued writes, for the screen: refreshed after every change to the queue. */
  entries: Signal<readonly NoteEntry[]>
  /** Sends the queue on start, reconnect, visibility and focus, retrying with backoff. */
  runner: SyncRunner
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

/** Opens the user's local store and queue. Calling it again for the same user does nothing. */
export function startOffline(userId: number, transport: OfflineTransport): OfflineLayer {
  if (layer?.userId === userId) return layer
  stopOffline()
  const store = openLocalStore(userId)
  const outbox = createNotesOutbox({
    store,
    lock: withBrowserLock(userId),
    isOnline: () => transport.canSend(),
    send: (name, payload, key) =>
      sendCommand(transport.calls, name, payload, { attempts: 1, newKey: () => key }),
    async fetchNote(groupId, id) {
      try {
        const { note } = await sendQuery<{ note: NoteItem }>(
          transport.calls,
          "note.get",
          { groupId, id },
          { attempts: 1 },
        )
        return note
      } catch (error) {
        const code = error instanceof RealtimeRequestError
          ? (error.details as { code?: unknown } | undefined)?.code
          : null
        if (code === "NOTE_NOT_FOUND") return null
        throw error
      }
    },
  })
  const entries = signal<readonly NoteEntry[]>([])
  outbox.subscribe((all) => entries.value = all)
  const runner = createSyncRunner({ flush: outboxFlush(outbox) })
  layer = { userId, store, outbox, entries, runner }
  activeLayer.value = layer
  void startRunnerWhileCurrent(runner, outbox.reload(), () => layer?.runner === runner)
  // Ask the browser not to evict the device copy and the queue; Safari clears idle sites.
  void requestPersistentStorage().catch(() => {})
  return layer
}

/**
 * Closes the local store. `forget` also drops the cached notes and groups, as signing out must;
 * the queue stays, because a write that never reached the server is the person's work and goes
 * out the next time they sign in on this browser.
 */
export async function stopOffline({ forget = false } = {}): Promise<void> {
  const closing = layer
  layer = null
  activeLayer.value = null
  if (!closing) return
  closing.runner.stop()
  if (forget) await closing.store.clearCache().catch(() => {})
  closing.entries.value = []
}

/** Sends the queued writes. Never rejects: what could not be sent stays queued. */
export async function flushOutbox(): Promise<void> {
  try {
    await layer?.outbox.flush()
  } catch (_error) {
    // The queue keeps the writes; the next reconnect or push tries again.
  }
}
