import { computed, type ReadonlySignal, signal } from "@preact/signals"
import type { SyncRunnerState } from "@spy4x/realtime/sync-runner"
import type { OfflineLayer } from "./index.ts"
import { TAGS_COLLECTION } from "./tags-collection.ts"

/**
 * What a sign-out must know about the writes that have not reached the server: how many there are,
 * how many wait on the person's choice, and where that choice is made.
 */
export interface UnsentCounts {
  /** Every queued write, notes and tags, those that wait on a choice included. */
  unsent: number
  /**
   * The writes that never send by themselves: the server refused them (a conflict), or they are
   * held back by a parent in conflict.
   */
  conflicts: number
  /** The group of the first write that waits on a choice: its notes page shows the chooser. */
  reviewGroupId: string | null
}

/** Counts the layer's queued writes as {@link UnsentCounts}. */
export function countUnsent(layer: OfflineLayer): UnsentCounts {
  const notes = layer.entries.value
  const tags = layer.tagEntries.value
  const refused = [...tags, ...notes].filter((entry) => entry.status === "conflict")
  // A write held back by a refused parent is still `pending` in its own queue, so it is not counted
  // twice.
  const held = layer.collections.waiting().filter((waiting) => waiting.onPerson)
    .map((waiting) =>
      (waiting.collection === TAGS_COLLECTION ? tags : notes).find((entry) =>
        entry.entityId === waiting.entityId && entry.status === "pending"
      )
    )
    .filter((entry) => entry !== undefined)
  const stuck = [...refused, ...held]
  return {
    unsent: notes.length + tags.length,
    conflicts: stuck.length,
    reviewGroupId: stuck[0]?.payload.groupId ?? null,
  }
}

/** Where the wait for the queue stands, in the words `UnsentChangesDialog` takes. */
export type UnsentState = "ask" | "sending" | "offline" | "retrying"

/** What the sign-out dialog shows. */
export interface UnsentView extends UnsentCounts {
  /** Writes that reached the server since the person chose to send. */
  sent: number
  state: UnsentState
}

/** The queue watched while a sign-out waits for it. */
export interface UnsentWait {
  view: ReadonlySignal<UnsentView>
  /** "Send, then sign out": sends the queue now. The runner keeps retrying with its backoff. */
  send(): void
  /** Stops watching the runner. */
  dispose(): void
}

/** Options of {@link watchUnsent}. */
export interface WatchUnsentOptions {
  layer: OfflineLayer
  /** Whether the browser has a network; a signal, so the view follows it. */
  online: ReadonlySignal<boolean>
  /** Whether the queue may be sent now: the page is signed in as its user, with a network. */
  canSend(): boolean
}

/**
 * Watches the queue for a sign-out. Before {@link UnsentWait.send} the state is `ask`; after it,
 * `offline` while nothing can be sent, `retrying` while the runner waits after a failed run, and
 * `sending` otherwise. The runner already sends on reconnect and retries with backoff, so nothing
 * here sends twice: `send` only asks it to run now.
 */
export function watchUnsent({ layer, online, canSend }: WatchUnsentOptions): UnsentWait {
  const runner = signal<SyncRunnerState>(layer.runner.getState())
  const stop = layer.runner.subscribe((state) => runner.value = state)
  const sendingFrom = signal<number | null>(null)
  const view = computed((): UnsentView => {
    const counts = countUnsent(layer)
    const sendable = counts.unsent - counts.conflicts
    const from = sendingFrom.value
    if (from === null) return { ...counts, sent: 0, state: "ask" }
    const sent = Math.max(0, from - sendable)
    // Read both signals on every run, so the view follows the network and the runner.
    const offline = !online.value || !canSend()
    const failing = runner.value.failures > 0 && !runner.value.running
    return {
      ...counts,
      sent,
      state: offline ? "offline" : failing ? "retrying" : "sending",
    }
  })
  return {
    view,
    send() {
      if (sendingFrom.value !== null) return
      const counts = countUnsent(layer)
      sendingFrom.value = counts.unsent - counts.conflicts
      void layer.runner.kick()
    },
    dispose: stop,
  }
}
