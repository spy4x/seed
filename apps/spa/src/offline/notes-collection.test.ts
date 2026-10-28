import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { NoteItem } from "../state/notes.ts"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections } from "@spy4x/realtime/collections"
import {
  createMemoryOutboxStore,
  createPromiseLock,
  type OutboxLock,
  type OutboxStore,
} from "@spy4x/realtime/outbox"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import type { NoteEntry, NotePayload, NotesCache } from "./notes-cache.ts"
import { notesCollection } from "./notes-collection.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import { tagsCollection } from "./tags-collection.ts"
import type { TagPayload } from "./tags-cache.ts"
import type { TagItem } from "../state/tags.ts"
import { englishText } from "@ui/message.ts"

const groupId = "g-1"

function note(id: string, version = 1, title = id, body = ""): NoteItem {
  return {
    id,
    groupId,
    title,
    body,
    tagIds: [],
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function refused(code: string) {
  return new RealtimeRequestError("conflict", "refused", { code })
}

/** The queue and the device's notes of one browser profile, which two tabs share. */
type Device = OutboxStore<NotePayload, NoteItem> & NotesCache

function createMemoryStore(): Device {
  return { ...createMemoryOutboxStore<NotePayload, NoteItem>(), ...createMemoryNotesCache() }
}

/** The server as a test plays it: one function per kind of call. */
interface Ports {
  store: Device
  lock: OutboxLock
  isOnline(): boolean
  newKey(): string
  now(): string
  send(name: string, payload: Record<string, unknown>, key: string): Promise<unknown>
  /** The server's note as it is now, or `null` when it is gone. */
  fetchNote(groupId: string, noteId: string): Promise<NoteItem | null>
}

/** The notes collection of user 1 over `ports`: the adapter under test, on the library's layer. */
function notesOver(ports: Ports) {
  const calls: CallPort = {
    command: (name, payload, options) =>
      ports.send(name, payload as Record<string, unknown>, options?.idempotencyKey ?? ""),
    async query(name, payload) {
      const { groupId, id } = payload as { groupId: string; id: string }
      if (name !== "note.get") throw new Error(`unexpected query ${name}`)
      const found = await ports.fetchNote(groupId, id)
      if (!found) throw refused("NOTE_NOT_FOUND")
      return { note: found }
    },
  }
  const tags = tagsCollection({
    userId: 1,
    cache: createMemoryTagsCache(),
    store: createMemoryOutboxStore<TagPayload, TagItem>(),
  })
  const definition = notesCollection({ userId: 1, cache: ports.store, store: ports.store })
  const collections = createCollections({
    // The tags are the notes' parent, so they are registered first (ADR 003, section 5).
    collections: [tags, definition],
    calls,
    canSend: ports.isOnline,
    lock: ports.lock,
    newKey: ports.newKey,
    now: ports.now,
  })
  return collections.get(definition)
}

/** The queue of the notes collection over `ports`. */
function createNotesOutbox(ports: Ports) {
  return notesOver(ports).outbox
}

/** A group's notes with the queued `entries` applied, as the adapter shapes them. */
function overlayNotes(
  entries: readonly NoteEntry[],
  _userId: number,
  group: string,
  base: readonly NoteItem[],
): NoteItem[] {
  return notesOver({
    store: createMemoryStore(),
    lock: createPromiseLock(),
    isOnline: () => false,
    newKey: () => "",
    now: () => "",
    send: () => Promise.reject(new Error("an overlay sends nothing")),
    fetchNote: () => Promise.resolve(null),
  }).applyQueued(base, entries, group)
}

interface Sent {
  name: string
  payload: Record<string, unknown>
  key: string
}

/** An outbox over a memory store whose server is a function the test replaces. */
function harness() {
  const store = createMemoryStore()
  const sent: Sent[] = []
  const fetched: string[][] = []
  const state = {
    /** Throws to simulate the server; returns the answer otherwise. */
    server: (_sent: Sent): unknown => ({ note: note("n-1", 2) }),
    current: null as NoteItem | null,
    online: true,
    /** Runs when a send starts, before the server answers. */
    onSend: undefined as undefined | (() => Promise<void>),
  }
  let keys = 0
  const outbox = createNotesOutbox({
    store,
    lock: createPromiseLock(),
    isOnline: () => state.online,
    newKey: () => `key-${++keys}`,
    now: () => "2026-10-03T00:00:00.000Z",
    async send(name, payload, key) {
      const call = { name, payload, key }
      sent.push(call)
      await state.onSend?.()
      return state.server(call)
    },
    fetchNote(group, id) {
      fetched.push([group, id])
      return Promise.resolve(state.current)
    },
  })
  const offline = () => {
    state.online = false
    state.server = () => {
      throw new ConnectionLostError("the socket is not open")
    }
  }
  return { store, outbox, sent, fetched, state, offline }
}

describe("outbox while the socket is down", () => {
  it("keeps a note created offline and shows it in the list", async () => {
    const { store, outbox, offline } = harness()
    offline()
    const outcome = await outbox.submit({
      kind: "create",
      entityId: "n-new",
      payload: { groupId, title: "Written offline", body: "text" },
    })
    expect(outcome.kind).toBe("queued")
    const shown = overlayNotes(await store.readOutbox(), 1, groupId, [note("n-1")])
    expect(shown.map((n) => n.title)).toEqual(["Written offline", "n-1"])
  })

  it("keeps a queued write across a restart of the layer", async () => {
    const { store, outbox, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "n-new",
      payload: { groupId, title: "T", body: "" },
    })
    const again = createNotesOutbox({
      store,
      lock: createPromiseLock(),
      isOnline: () => true,
      newKey: () => "other",
      now: () => "",
      send: () => Promise.resolve({ note: note("n-new") }),
      fetchNote: () => Promise.resolve(null),
    })
    expect((await again.reload()).map((e) => e.entityId)).toEqual(["n-new"])
  })

  it("sends the queue in order with the original keys once the socket is back", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "a",
      payload: { groupId, title: "A", body: "" },
    })
    await outbox.submit({
      kind: "create",
      entityId: "b",
      payload: { groupId, title: "B", body: "" },
    })
    state.online = true
    state.server = ({ payload }) => ({ note: note(String(payload.id)) })
    await outbox.flush()
    expect(sent.map((s) => [s.name, s.payload.id, s.key])).toEqual([
      ["note.create", "a", "key-1"],
      ["note.create", "b", "key-2"],
    ])
    expect(outbox.entries()).toEqual([])
  })

  it("stops at the first write that cannot reach the server and keeps the rest", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "a",
      payload: { groupId, title: "A", body: "" },
    })
    await outbox.submit({
      kind: "create",
      entityId: "b",
      payload: { groupId, title: "B", body: "" },
    })
    sent.length = 0
    state.online = true
    await outbox.flush()
    expect(sent.length).toBe(1)
    expect(outbox.entries().length).toBe(2)
  })
})

describe("outbox list overlay", () => {
  it("hides a note deleted offline", async () => {
    const { store, outbox, offline } = harness()
    offline()
    await outbox.submit({
      kind: "delete",
      entityId: "n",
      payload: { groupId, title: "n", body: "" },
      version: 1,
    })
    const queued = await store.readOutbox()
    expect(overlayNotes(queued, 1, groupId, [note("n"), note("m")])).toEqual([note("m")])
  })

  it("shows the text of a note edited offline", async () => {
    const { store, outbox, offline } = harness()
    offline()
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "New", body: "b" },
      version: 1,
    })
    const [shown] = overlayNotes(await store.readOutbox(), 1, groupId, [note("n")])
    expect([shown.title, shown.body, shown.version]).toEqual(["New", "b", 1])
  })

  it("saves an entry as sent before the server answers, so a closed page cannot resend it under a new key", async () => {
    const { store, outbox, state } = harness()
    let during: boolean | undefined
    state.onSend = async () => {
      during = (await store.readOutbox())[0]?.attempted
    }
    await outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
    })
    expect(during).toBe(true)
  })
})

describe("outbox merging edits of one note", () => {
  it("sends a note created and edited offline as one create with the last text", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "First", body: "" },
    })
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Second", body: "b" },
      version: 0,
    })
    state.online = true
    state.server = () => ({ note: note("n", 1, "Second") })
    await outbox.flush()
    expect(sent.map((s) => [s.name, s.payload.title])).toEqual([["note.create", "Second"]])
  })

  it("sends nothing for a note created and deleted before any send", async () => {
    const { outbox, sent, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
    })
    const outcome = await outbox.submit({
      kind: "delete",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
      version: 0,
    })
    expect(outcome.kind).toBe("dropped")
    expect(outbox.entries()).toEqual([])
    expect(sent.filter((s) => s.name !== "note.create").length).toBe(0)
  })

  it("sends a second edit of a note as one update on the first edit's base version", async () => {
    const { outbox, sent, state, offline } = harness()
    offline()
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "A", body: "" },
      version: 3,
    })
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "B", body: "" },
      version: 3,
    })
    state.online = true
    state.server = () => ({ note: note("n", 4, "B") })
    await outbox.flush()
    expect(sent.map((s) => [s.payload.title, s.payload.version])).toEqual([["B", 3]])
  })

  it("keeps the key of an edit that was never sent", async () => {
    const { outbox, offline } = harness()
    offline()
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "A", body: "" },
      version: 3,
    })
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "B", body: "" },
      version: 3,
    })
    expect(outbox.entries().map((e) => [e.key, e.payload.title])).toEqual([["key-1", "B"]])
  })

  it("uses a new key for an edit made after a send whose outcome is unknown", async () => {
    const { outbox, sent, state } = harness()
    state.server = () => {
      throw new ConnectionLostError("closed after the send")
    }
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "A", body: "" },
      version: 3,
    })
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "B", body: "" },
      version: 3,
    })
    expect(sent.map((s) => s.key)).toEqual(["key-1", "key-2"])
  })

  it("deletes version 1 for a note created and deleted after a send with unknown outcome", async () => {
    const { outbox, sent, state } = harness()
    state.server = () => {
      throw new ConnectionLostError("closed after the send")
    }
    await outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
    })
    state.server = () => ({})
    const outcome = await outbox.submit({
      kind: "delete",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
      version: 0,
    })
    expect(outcome.kind).toBe("sent")
    expect(sent[sent.length - 1]).toMatchObject({ name: "note.delete", payload: { version: 1 } })
  })
})

describe("outbox when the server answers", () => {
  it("answers a change made online with the server's note and leaves nothing queued", async () => {
    const { outbox, state } = harness()
    state.server = () => ({ note: note("n", 2, "Saved") })
    const outcome = await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Saved", body: "" },
      version: 1,
    })
    expect(outcome).toEqual({ kind: "sent", server: note("n", 2, "Saved") })
    expect(outbox.entries()).toEqual([])
  })

  it("hands a refusal to the person who just made the change and queues nothing", async () => {
    const { outbox, state } = harness()
    state.server = () => {
      throw refused("VERSION_CONFLICT")
    }
    const outcome = await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "" },
      version: 1,
    })
    expect(outcome.kind).toBe("failed")
    expect(outbox.entries()).toEqual([])
  })

  it("keeps a write queued while the server says the same key is still running", async () => {
    const { outbox, state } = harness()
    state.server = () => {
      throw refused("IN_PROGRESS")
    }
    const outcome = await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "" },
      version: 1,
    })
    expect([outcome.kind, outbox.entries()[0]?.status]).toEqual(["queued", "pending"])
  })
})

describe("outbox when the session ended under it", () => {
  /** The server's answer to a call without a session, as another user, or with a second factor owed. */
  const unauthorized = () => {
    throw new RealtimeRequestError("unauthorized", "The session belongs to another user")
  }

  it("keeps a queued note pending when the server answers that the session ended", async () => {
    const { outbox, state, offline } = harness()
    offline()
    await outbox.submit({
      kind: "create",
      entityId: "n-new",
      payload: { groupId, title: "Written offline", body: "text" },
    })
    state.online = true
    state.server = unauthorized
    await outbox.flush().catch(() => {})
    expect(outbox.entries().map((entry) => [entry.payload.title, entry.status])).toEqual([
      ["Written offline", "pending"],
    ])
  })

  it("queues a note saved at the moment the server answers that the session ended", async () => {
    const { outbox, state } = harness()
    state.server = unauthorized
    const outcome = await outbox.submit({
      kind: "create",
      entityId: "n-new",
      payload: { groupId, title: "Saved as the session ended", body: "text" },
    })
    expect([outcome.kind, outbox.entries().map((entry) => entry.status)]).toEqual([
      "queued",
      ["pending"],
    ])
  })
})

describe("outbox conflicts found after a reconnect", () => {
  async function staleUpdate() {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "my body" },
      version: 1,
    })
    h.state.server = () => {
      throw refused("VERSION_CONFLICT")
    }
    h.state.current = note("n", 2, "Theirs")
    h.state.online = true
    await h.outbox.flush()
    return h
  }

  it("keeps an edit the server refused as a visible conflict with both versions", async () => {
    const { outbox } = await staleUpdate()
    const [entry] = outbox.entries()
    expect(entry.status).toBe("conflict")
    expect(entry.conflict?.reason).toBe("version")
    expect(entry.conflict?.server?.title).toBe("Theirs")
    expect(entry.payload.title).toBe("Mine")
  })

  it("does not send a conflicted write again on its own", async () => {
    const { outbox, sent } = await staleUpdate()
    sent.length = 0
    await outbox.flush()
    expect(sent).toEqual([])
  })

  it("sends my version on top of the server's when I keep mine", async () => {
    const { outbox, sent, state } = await staleUpdate()
    state.server = () => ({ note: note("n", 3, "Mine") })
    sent.length = 0
    await outbox.keepMine(outbox.entries()[0])
    expect(sent.map((s) => [s.name, s.payload.title, s.payload.version])).toEqual([
      ["note.update", "Mine", 2],
    ])
    expect(outbox.entries()).toEqual([])
  })

  it("shows the server's note and drops mine when I use the server's", async () => {
    const { outbox, store } = await staleUpdate()
    await outbox.useTheirs(outbox.entries()[0])
    expect(outbox.entries()).toEqual([])
    expect((await store.readNotes(groupId)).map((n) => n.title)).toEqual(["Theirs"])
  })

  it("keeps an edit of a note deleted on the server as a conflict with no server note", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "" },
      version: 1,
    })
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.current = null
    h.state.online = true
    await h.outbox.flush()
    expect(h.outbox.entries()[0].conflict?.reason).toBe("gone")
    expect(h.outbox.entries()[0].conflict?.server).toBe(null)
  })

  it("keeps an edit of a note moved to another group as a conflict that says so", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "my body" },
      version: 1,
    })
    // The server answers "not found in this group" for a moved note, and the old group has none.
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.current = null
    h.state.online = true

    await h.outbox.flush()

    const [entry] = h.outbox.entries()
    expect(entry.conflict?.reason).toBe("gone")
    expect(englishText(entry.conflict?.message ?? ``)).toContain("moved to another group")
    expect(entry.payload).toMatchObject({ title: "Mine", body: "my body" })
  })

  it("treats a delete of a note already gone as done", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "delete",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
      version: 1,
    })
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.online = true
    await h.outbox.flush()
    expect(h.outbox.entries()).toEqual([])
  })

  it("keeps a write the server refuses for another reason, with the server's message", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
    })
    h.state.server = () => {
      throw refused("ROLE_INSUFFICIENT")
    }
    h.state.online = true
    await h.outbox.flush()
    const [entry] = h.outbox.entries()
    expect(entry.status).toBe("conflict")
    expect(entry.conflict).toMatchObject({ reason: "rejected", message: "refused" })
  })
})

describe("outbox shared by two tabs", () => {
  it("keeps an edit made in one tab while another tab's send of the same note is running", async () => {
    const store = createMemoryStore()
    let finishSend: () => void = () => {}
    const sending = new Promise<void>((resolve) => (finishSend = resolve))
    let started: () => void = () => {}
    const sendStarted = new Promise<void>((resolve) => (started = resolve))
    let keys = 0
    const tab = (online: boolean, prefix: string) =>
      createNotesOutbox({
        store,
        // No lock shared between the two: the worst case for the queue's own checks.
        lock: createPromiseLock(),
        isOnline: () => online,
        newKey: () => `${prefix}-${++keys}`,
        now: () => "2026-10-03T00:00:00.000Z",
        async send() {
          started()
          await sending
          return { note: note("n", 2, "From tab B") }
        },
        fetchNote: () => Promise.resolve(null),
      })
    const tabA = tab(false, "key-a")
    const tabB = tab(true, "key-b")
    await tabA.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Old", body: "" },
      version: 1,
    })
    const flushing = tabB.flush()
    await sendStarted
    // Tab A, offline, edits the same note while tab B's send is in flight.
    await tabA.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Edit in A", body: "" },
      version: 1,
    })
    finishSend()
    await flushing
    const [kept] = await store.readOutbox()
    expect(kept?.payload.title).toBe("Edit in A")
  })

  it("keeps an edit made in one tab when another tab's send of the same note is refused", async () => {
    const store = createMemoryStore()
    let refuse: () => void = () => {}
    const refusal = new Promise<void>((resolve) => (refuse = resolve))
    let started: () => void = () => {}
    const sendStarted = new Promise<void>((resolve) => (started = resolve))
    let keys = 0
    const tab = (online: boolean, prefix: string) =>
      createNotesOutbox({
        store,
        lock: createPromiseLock(),
        isOnline: () => online,
        newKey: () => `${prefix}-${++keys}`,
        now: () => "2026-10-03T00:00:00.000Z",
        async send() {
          started()
          await refusal
          throw refused("VERSION_CONFLICT")
        },
        fetchNote: () => Promise.resolve(note("n", 2, "Theirs")),
      })
    const tabA = tab(false, "key-a")
    const tabB = tab(true, "key-b")
    await tabA.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Old", body: "" },
      version: 1,
    })
    const flushing = tabB.flush()
    await sendStarted
    await tabA.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Edit in A", body: "" },
      version: 1,
    })
    refuse()
    await flushing
    const [kept] = await store.readOutbox()
    expect([kept?.payload.title, kept?.status]).toEqual(["Edit in A", "pending"])
  })
})

describe("notes outbox wiring", () => {
  it("sends nothing while the page is not signed in as the queue's user", async () => {
    const { outbox, sent, state } = harness()
    state.online = false
    const outcome = await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "" },
      version: 1,
    })
    expect([outcome.kind, sent.length, outbox.entries().length]).toEqual(["queued", 0, 1])
  })

  it("sends a note's group, id, text and base version in the command the API expects", async () => {
    const { outbox, sent } = harness()
    await outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "T", body: "B" },
      version: 4,
    })
    expect(sent[0]).toMatchObject({
      name: "note.update",
      payload: { groupId, id: "n", title: "T", body: "B", version: 4 },
    })
  })

  it("sends the tags of a note in its create and its update", async () => {
    const { outbox, sent } = harness()
    await outbox.submit({
      kind: "create",
      entityId: "c",
      payload: { groupId, title: "T", body: "", tagIds: ["t-1", "t-2"] },
    })
    await outbox.submit({
      kind: "update",
      entityId: "u",
      payload: { groupId, title: "T", body: "", tagIds: [] },
      version: 2,
    })
    expect(sent.map((call) => [call.name, call.payload.tagIds])).toEqual([
      ["note.create", ["t-1", "t-2"]],
      ["note.update", []],
    ])
  })

  it("leaves a note's tags alone when an update queued by an older version names none", async () => {
    const { outbox, sent } = harness()
    await outbox.submit({
      kind: "update",
      entityId: "u",
      payload: { groupId, title: "T", body: "" },
      version: 2,
    })
    expect("tagIds" in sent[0].payload).toBe(false)
  })

  it("asks the server for the note in the group the queued write names", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId: "g-other", title: "Mine", body: "" },
      version: 1,
    })
    h.state.server = () => {
      throw refused("VERSION_CONFLICT")
    }
    h.state.current = note("n", 2, "Theirs")
    h.state.online = true
    await h.outbox.flush()
    expect(h.fetched).toEqual([["g-other", "n"]])
  })

  it("shows a replayed create whose id is taken as a conflict, not a duplicate", async () => {
    const h = harness()
    h.offline()
    await h.outbox.submit({
      kind: "create",
      entityId: "n",
      payload: { groupId, title: "T", body: "" },
    })
    h.state.server = () => {
      throw refused("ID_ALREADY_EXISTS")
    }
    h.state.current = note("n", 1, "Other")
    h.state.online = true
    await h.outbox.flush()
    const conflict = h.outbox.entries()[0].conflict
    expect(conflict).toMatchObject({ reason: "version" })
    expect(englishText(conflict?.message ?? ``)).toBe(
      "Someone changed this note while you were offline.",
    )
  })

  it("removes a note from the local copy once the server took its delete", async () => {
    const h = harness()
    await h.store.putNote(note("n"))
    h.state.server = () => ({})
    await h.outbox.submit({
      kind: "delete",
      entityId: "n",
      payload: { groupId, title: "n", body: "" },
      version: 1,
    })
    expect(await h.store.readNotes(groupId)).toEqual([])
  })

  it("removes a note deleted on the server from the local copy when I use the server's", async () => {
    const h = harness()
    await h.store.putNote(note("n"))
    h.offline()
    await h.outbox.submit({
      kind: "update",
      entityId: "n",
      payload: { groupId, title: "Mine", body: "" },
      version: 1,
    })
    h.state.server = () => {
      throw refused("NOTE_NOT_FOUND")
    }
    h.state.current = null
    h.state.online = true
    await h.outbox.flush()
    await h.outbox.useTheirs(h.outbox.entries()[0])
    expect(await h.store.readNotes(groupId)).toEqual([])
  })
})
