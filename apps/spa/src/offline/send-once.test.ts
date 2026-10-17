import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { CallPort } from "@spy4x/realtime/calls"
import type { NoteItem } from "../state/notes.ts"
import { createMemoryStorage } from "./memory-storage.ts"
import type { NoteEntry } from "./notes-cache.ts"
import { type QueueDatabases, refusedMessage, sendQueueOnce } from "./send-once.ts"

const NOTES_QUEUE = "offline:user:7:outbox"
const TAGS_QUEUE = "offline:user:7:tags-outbox"

function note(id: string, version: number, title: string): NoteItem {
  return {
    id,
    groupId: "g-1",
    title,
    body: "",
    tagIds: [],
    version,
    changeSequence: "1",
    createdByUserId: 7,
    updatedByUserId: 7,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function edit(entityId: string, title: string): NoteEntry {
  return {
    key: `key-${entityId}`,
    entityId,
    kind: "update",
    payload: { groupId: "g-1", title, body: "" },
    baseVersion: 1,
    attempted: false,
    status: "pending",
    queuedAt: "2026-10-01T08:00:00.000Z",
  }
}

/** A device's database list that records what is opened and deleted. */
function databasesHolding(...names: string[]) {
  const held = new Set(names)
  const deleted: string[] = []
  const databases: QueueDatabases = {
    list: () => Promise.resolve([...held]),
    delete(name) {
      held.delete(name)
      deleted.push(name)
      return Promise.resolve()
    },
  }
  return { databases, deleted }
}

/** A server that answers each note command with `answer(entityId)`. */
function serverAnswering(answer: (id: string) => Promise<unknown>) {
  const sent: string[] = []
  const calls: CallPort = {
    command: (name: string, payload: unknown) => {
      const id = String((payload as { id: string }).id)
      sent.push(`${name} ${id}`)
      return answer(id) as Promise<never>
    },
    query: (_name: string, payload: unknown) =>
      Promise.resolve({ note: note(String((payload as { id: string }).id), 5, "Theirs") }) as never,
  } as CallPort
  return { calls, sent }
}

const accepts = (id: string) => Promise.resolve({ note: note(id, 2, id) })

describe("sendQueueOnce", () => {
  it("opens no queue on a device that holds none", async () => {
    const storage = createMemoryStorage()
    let opened = 0
    const { databases } = databasesHolding("reads:7")
    const { calls, sent } = serverAnswering(accepts)

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage: {
        openQueue: (id) => (opened++, storage.openQueue!(id)),
        openTagsQueue: (id) => (opened++, storage.openTagsQueue!(id)),
      },
      databases,
    })

    expect([result, opened, sent]).toEqual([{ done: true, refused: [] }, 0, []])
  })

  it("sends every queued write, then deletes the queue's database", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(edit("n-1", "First"))
    await storage.of(7).queue.putEntry(edit("n-2", "Second"))
    const { databases, deleted } = databasesHolding(NOTES_QUEUE, "reads:7")
    const { calls, sent } = serverAnswering(accepts)

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage,
      databases,
    })

    expect(result).toEqual({ done: true, refused: [] })
    expect(sent).toEqual(["note.update n-1", "note.update n-2"])
    expect(deleted).toEqual([NOTES_QUEUE])
  })

  it("opens only the queue the device holds, so no other database is created", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(edit("n-1", "First"))
    const opened: string[] = []
    const { databases } = databasesHolding(NOTES_QUEUE)
    const { calls } = serverAnswering(accepts)

    await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage: {
        openQueue: (id) => (opened.push("notes"), storage.openQueue!(id)),
        openTagsQueue: (id) => (opened.push("tags"), storage.openTagsQueue!(id)),
      },
      databases,
    })

    expect(opened).toEqual(["notes"])
  })

  it("keeps the whole queue when a write cannot reach the server", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(edit("n-1", "First"))
    const { databases, deleted } = databasesHolding(NOTES_QUEUE)
    const { calls } = serverAnswering(() => Promise.reject(new ConnectionLostError("offline")))

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage,
      databases,
    })

    expect([result, deleted]).toEqual([{ done: false, refused: [] }, []])
    expect((await storage.of(7).queue.readOutbox()).length).toBe(1)
  })

  it("sends nothing and keeps the queue while the page cannot send as its user", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(edit("n-1", "First"))
    const { databases, deleted } = databasesHolding(NOTES_QUEUE)
    const { calls, sent } = serverAnswering(accepts)

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => false },
      storage,
      databases,
    })

    expect([result, sent, deleted]).toEqual([{ done: false, refused: [] }, [], []])
  })

  it("drops the writes the server refused, names them, and deletes the queue", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(edit("n-1", "Shopping list"))
    await storage.of(7).queue.putEntry(edit("n-2", "Sent fine"))
    await storage.of(7).queue.putEntry({ ...edit("n-3", ""), status: "conflict" })
    const { databases, deleted } = databasesHolding(NOTES_QUEUE, TAGS_QUEUE)
    const { calls, sent } = serverAnswering((id) =>
      id === "n-1"
        ? Promise.reject(
          new RealtimeRequestError("conflict", "refused", { code: "VERSION_CONFLICT" }),
        )
        : accepts(id)
    )

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage,
      databases,
    })

    expect(sent).toEqual(["note.update n-1", "note.update n-2"])
    expect(result).toEqual({ done: true, refused: ["Shopping list", "Untitled note"] })
    expect(deleted).toEqual([TAGS_QUEUE, NOTES_QUEUE])
  })

  it("keeps the queue on a browser that cannot list its databases", async () => {
    const { calls, sent } = serverAnswering(accepts)

    const result = await sendQueueOnce({
      userId: 7,
      transport: { calls, canSend: () => true },
      storage: createMemoryStorage(),
      databases: { list: () => Promise.resolve(undefined), delete: () => Promise.resolve() },
    })

    expect([result, sent]).toEqual([{ done: false, refused: [] }, []])
  })
})

describe("refusedMessage", () => {
  it("says nothing when nothing was refused", () => {
    expect(refusedMessage([])).toBe("")
  })

  it("names one refused change", () => {
    expect(refusedMessage(["Trip plan"])).toBe(
      `1 change you made offline couldn't be saved: "Trip plan".`,
    )
  })

  it("names the first three and counts the rest", () => {
    expect(refusedMessage(["A", "B", "C", "D", "E"])).toBe(
      `5 changes you made offline couldn't be saved: "A", "B", "C" and 2 more.`,
    )
  })
})
