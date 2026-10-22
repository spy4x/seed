import { signal } from "@preact/signals"
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { WaitingEntry } from "@spy4x/realtime/collections"
import type { SyncRunnerState } from "@spy4x/realtime/sync-runner"
import type { OfflineLayer } from "./index.ts"
import type { NoteEntry } from "./notes-cache.ts"
import type { TagEntry } from "./tags-cache.ts"
import { countUnsent, watchUnsent } from "./unsent.ts"

function noteEntry(entityId: string, status: "pending" | "conflict", groupId = "g-1"): NoteEntry {
  return {
    seq: Number(entityId.replace(/\D/g, "")) || 1,
    key: `key-${entityId}`,
    entityId,
    kind: "update",
    payload: { groupId, title: entityId, body: "" },
    baseVersion: 1,
    attempted: false,
    status,
    queuedAt: "2026-10-01T08:00:00.000Z",
  }
}

function tagEntry(entityId: string, status: "pending" | "conflict", groupId = "g-1"): TagEntry {
  return {
    seq: 1,
    key: `key-${entityId}`,
    entityId,
    kind: "create",
    payload: { groupId, name: entityId, color: "#b91c1c" },
    baseVersion: 0,
    attempted: false,
    status,
    queuedAt: "2026-10-01T08:00:00.000Z",
  }
}

const idle: SyncRunnerState = { running: false, lastError: null, failures: 0, nextRetryAt: null }

/** A layer with these queues, whose runner records kicks and reports what the test sets. */
function layerWith(
  notes: NoteEntry[],
  tags: TagEntry[] = [],
  waiting: WaitingEntry[] = [],
) {
  const entries = signal<readonly NoteEntry[]>(notes)
  const tagEntries = signal<readonly TagEntry[]>(tags)
  let state = idle
  const listeners = new Set<(state: SyncRunnerState) => void>()
  const kicks: number[] = []
  const layer = {
    entries,
    tagEntries,
    collections: { waiting: () => waiting },
    runner: {
      getState: () => state,
      subscribe: (listener: (state: SyncRunnerState) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      kick: () => Promise.resolve(void kicks.push(1)),
    },
  } as unknown as OfflineLayer
  const setRunner = (next: Partial<SyncRunnerState>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener(state)
  }
  return { layer, entries, kicks, setRunner, listeners }
}

describe("countUnsent", () => {
  it("counts every queued note and tag write", () => {
    const { layer } = layerWith([noteEntry("n-1", "pending")], [tagEntry("t-1", "pending")])

    expect(countUnsent(layer)).toEqual({ unsent: 2, conflicts: 0, reviewGroupId: null })
  })

  it("counts refused writes and writes held back by a refused parent as needing a choice", () => {
    const { layer } = layerWith(
      [noteEntry("n-1", "pending", "g-2"), noteEntry("n-2", "pending")],
      [tagEntry("t-1", "conflict", "g-2")],
      [{
        collection: "notes",
        entityId: "n-1",
        blockedBy: [{ collection: "tags", entityId: "t-1", status: "conflict" }],
        onPerson: true,
      }],
    )

    expect(countUnsent(layer)).toEqual({ unsent: 3, conflicts: 2, reviewGroupId: "g-2" })
  })

  it("does not count a write that only waits for a parent still on its way", () => {
    const { layer } = layerWith(
      [noteEntry("n-1", "pending")],
      [tagEntry("t-1", "pending")],
      [{
        collection: "notes",
        entityId: "n-1",
        blockedBy: [{ collection: "tags", entityId: "t-1", status: "pending" }],
        onPerson: false,
      }],
    )

    expect(countUnsent(layer).conflicts).toBe(0)
  })
})

describe("watchUnsent", () => {
  it("asks first and sends nothing until the person chooses to send", () => {
    const { layer, kicks } = layerWith([noteEntry("n-1", "pending")])
    const wait = watchUnsent({ layer, online: signal(true), canSend: () => true })

    expect([wait.view.value.state, kicks.length]).toEqual(["ask", 0])
  })

  it("sends at once on send and counts the writes that left", () => {
    const { layer, entries, kicks } = layerWith([
      noteEntry("n-1", "pending"),
      noteEntry("n-2", "pending"),
      noteEntry("n-3", "pending"),
    ])
    const wait = watchUnsent({ layer, online: signal(true), canSend: () => true })

    wait.send()
    entries.value = entries.value.slice(1)

    expect(kicks.length).toBe(1)
    expect(wait.view.value).toEqual({
      unsent: 2,
      conflicts: 0,
      reviewGroupId: null,
      sent: 1,
      state: "sending",
    })
  })

  it("says offline while the browser has no network, and sending again once it is back", () => {
    const { layer } = layerWith([noteEntry("n-1", "pending")])
    const online = signal(false)
    const wait = watchUnsent({ layer, online, canSend: () => true })

    wait.send()
    const offline = wait.view.value.state
    online.value = true

    expect([offline, wait.view.value.state]).toEqual(["offline", "sending"])
  })

  it("says offline while the page cannot send as the queue's user", () => {
    const { layer } = layerWith([noteEntry("n-1", "pending")])
    const wait = watchUnsent({ layer, online: signal(true), canSend: () => false })

    wait.send()

    expect(wait.view.value.state).toBe("offline")
  })

  it("says it retries while the runner waits after a failed run", () => {
    const { layer, setRunner } = layerWith([noteEntry("n-1", "pending")])
    const wait = watchUnsent({ layer, online: signal(true), canSend: () => true })

    wait.send()
    setRunner({ failures: 1, running: false })
    const retrying = wait.view.value.state
    setRunner({ running: true })

    expect([retrying, wait.view.value.state]).toEqual(["retrying", "sending"])
  })

  it("stops listening to the runner when disposed", () => {
    const { layer, listeners } = layerWith([noteEntry("n-1", "pending")])
    const wait = watchUnsent({ layer, online: signal(true), canSend: () => true })

    wait.dispose()

    expect(listeners.size).toBe(0)
  })
})
