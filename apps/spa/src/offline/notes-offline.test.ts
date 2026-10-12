import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { NoteItem, NotePage, NotesDependencies } from "../state/notes.ts"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections } from "@spy4x/realtime/collections"
import { RealtimeRequestError } from "@spy4x/realtime"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import { signal } from "@preact/signals"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import type { NoteEntry, NotePayload } from "./notes-cache.ts"
import { notesCollection, offlineNotes } from "./notes-collection.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import { createMemoryOutboxStore as memoryQueue } from "@spy4x/realtime/outbox"
import { tagsCollection } from "./tags-collection.ts"

const groupId = "g-1"

function note(id: string, version = 1, title = id): NoteItem {
  return {
    id,
    groupId,
    title,
    body: "",
    tagIds: [],
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

/** The notes of user 1 on a device in memory, with a server that takes every write. */
function layerWith(online: { socket: boolean }) {
  const cache = createMemoryNotesCache()
  const calls: CallPort = {
    command: (_name, payload) =>
      Promise.resolve({ note: note(String((payload as { id: string }).id), 1, "sent") }),
    query: () => Promise.reject(new Error("the test reads no note for a conflict")),
  }
  const definition = notesCollection({
    userId: 1,
    cache,
    store: createMemoryOutboxStore<NotePayload, NoteItem>(),
  })
  const tags = tagsCollection({
    userId: 1,
    cache: createMemoryTagsCache(),
    store: memoryQueue(),
  })
  const collections = createCollections({
    collections: [tags, definition],
    calls,
    canSend: () => online.socket,
    now: () => "2026-10-03T00:00:00.000Z",
  })
  const notes = collections.get(definition)
  const entries = signal<readonly NoteEntry[]>([])
  notes.outbox.subscribe((all) => entries.value = all)
  return { cache, notes, entries }
}

/** Server-side dependencies whose network the test switches off and on. */
function network(pages: NoteItem[][]) {
  const state = { up: true, reads: 0 }
  const online: NotesDependencies = {
    fetchPage(_group, cursor): Promise<NotePage> {
      state.reads++
      if (!state.up) return Promise.reject(new TypeError("Failed to fetch"))
      const index = Number(cursor ?? 0)
      return Promise.resolve({
        notes: pages[index],
        nextCursor: index + 1 < pages.length ? String(index + 1) : null,
      })
    },
    get: (_group, id) => Promise.resolve({ note: note(id) }),
    create: () => Promise.reject(new Error("the store must not call the network to write")),
    update: () => Promise.reject(new Error("the store must not call the network to write")),
    delete: () => Promise.reject(new Error("the store must not call the network to write")),
    restore: () => Promise.reject(new Error("the test restores nothing")),
    move: () => Promise.reject(new Error("the test moves nothing")),
    newId: () => "id",
  }
  return { state, online }
}

describe("offline notes reads", () => {
  it("answers from the device when the network is down", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a"), note("b")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    const page = await deps.fetchPage(groupId, null)
    expect(page.notes.map((n) => n.id)).toEqual(["a", "b"])
  })

  it("keeps every page of a group, not only the first", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a")], [note("b")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    expect((await deps.fetchPage(groupId, null)).notes.map((n) => n.id)).toEqual(["a", "b"])
  })

  it("shows a note created offline in the list read", async () => {
    const layer = layerWith({ socket: false })
    const { state, online } = network([[note("a")]])
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    state.up = false
    await deps.create({ groupId, id: "mine", title: "Offline note", body: "", tagIds: [] })
    const page = await deps.fetchPage(groupId, null)
    expect(page.notes.map((n) => n.title)).toEqual(["Offline note", "a"])
  })

  it("shows a note created offline in its own group only", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[note("a")]])
    const deps = offlineNotes(online, () => layer)
    await deps.create({
      groupId: "g-2",
      id: "elsewhere",
      title: "In the other group",
      body: "",
      tagIds: [],
    })
    const page = await deps.fetchPage(groupId, null)
    expect(page.notes.map((n) => n.title)).toEqual(["a"])
  })

  it("opens a note created offline although the server says it does not exist", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[]])
    const notFound = new RealtimeRequestError("not_found", "Note not found")
    const deps = offlineNotes({ ...online, get: () => Promise.reject(notFound) }, () => layer)
    await deps.create({ groupId, id: "mine", title: "Offline note", body: "", tagIds: [] })
    expect((await deps.get(groupId, "mine")).note.title).toBe("Offline note")
  })

  it("does not open a saved note the server says is gone", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("a")]])
    await layer.cache.replaceNotes(groupId, [note("a")])
    const notFound = new RealtimeRequestError("not_found", "Note not found")
    const deps = offlineNotes({ ...online, get: () => Promise.reject(notFound) }, () => layer)

    await expect(deps.get(groupId, "a")).rejects.toThrow("Note not found")
  })

  it("opens a saved note from the device when the server cannot be reached", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[note("a")]])
    await layer.cache.replaceNotes(groupId, [note("a", 3, "Saved")])
    const unreachable = new TypeError("Failed to fetch")
    const deps = offlineNotes({ ...online, get: () => Promise.reject(unreachable) }, () => layer)

    expect((await deps.get(groupId, "a")).note.title).toBe("Saved")
  })

  it("does not hide a server error behind the cached list", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("a")]])
    online.fetchPage = () => Promise.reject(new Error("Request failed"))
    await expect(offlineNotes(online, () => layer).fetchPage(groupId, null)).rejects.toThrow(
      "Request failed",
    )
  })

  it("goes straight to the server when no layer is running", async () => {
    const { online } = network([[note("a")]])
    const page = await offlineNotes(online, () => null).fetchPage(groupId, null)
    expect(page.notes.map((n) => n.id)).toEqual(["a"])
  })

  it("lists what the device holds without asking the network", async () => {
    const layer = layerWith({ socket: false })
    await layer.cache.replaceNotes(groupId, [note("cached")])
    const { state, online } = network([[]])
    const local = await offlineNotes(online, () => layer).readLocal!(groupId)
    expect(local.map((n) => n.id)).toEqual(["cached"])
    expect(state.reads).toBe(0)
  })
})

describe("offline notes writes", () => {
  it("returns the server's note when the socket is open", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[]])
    const { note: created } = await offlineNotes(online, () => layer).create({
      groupId,
      id: "n",
      title: "T",
      body: "",
      tagIds: [],
    })
    expect(created.title).toBe("sent")
  })

  it("returns the local note and queues the write when the socket is closed", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[]])
    const { note: created } = await offlineNotes(online, () => layer).create({
      groupId,
      id: "n",
      title: "T",
      body: "",
      tagIds: [],
    })
    expect(created.title).toBe("T")
    expect(layer.entries.value.length).toBe(1)
  })
})

describe("offline notes moves", () => {
  it("files the moved notes under their new group on the device", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("a")]])
    online.move = (input) =>
      Promise.resolve({
        notes: input.noteIds.map((id) => ({ ...note(id, 2), groupId: input.toGroupId })),
      })
    const deps = offlineNotes(online, () => layer)
    await layer.cache.putNote(note("a"))

    await deps.move({ groupId, toGroupId: "g-2", noteIds: ["a"] })

    expect((await layer.cache.readNotes(groupId)).map((n) => n.id)).toEqual([])
    expect((await layer.cache.readNotes("g-2")).map((n) => n.id)).toEqual(["a"])
  })

  it("leaves the device alone when the server refuses the move", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("a")]])
    online.move = () => Promise.reject(new Error("refused"))
    await layer.cache.putNote(note("a"))

    await offlineNotes(online, () => layer).move({ groupId, toGroupId: "g-2", noteIds: ["a"] })
      .catch(() => {})

    expect((await layer.cache.readNotes(groupId)).map((n) => n.id)).toEqual(["a"])
  })

  it("restores a note on the server, keeps it on the device and queues nothing", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[]])
    online.restore = (input) => Promise.resolve({ note: note(input.id, 3) })
    const deps = offlineNotes(online, () => layer)

    const { note: restored } = await deps.restore({ groupId, id: "a" })

    expect(restored.version).toBe(3)
    expect((await layer.cache.readNotes(groupId)).map((n) => n.id)).toEqual(["a"])
    expect(await layer.notes.store.readOutbox()).toEqual([])
  })

  it("undoes a delete that is still waiting on the device without asking the server", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[note("a")]])
    online.restore = () => Promise.reject(new Error("the server must not be asked"))
    const deps = offlineNotes(online, () => layer)
    await deps.fetchPage(groupId, null)
    await deps.delete({ groupId, id: "a", version: 1 })
    expect((await deps.fetchPage(groupId, null)).notes).toEqual([])

    const { note: restored } = await deps.restore({ groupId, id: "a" })

    expect(restored.id).toBe("a")
    expect((await deps.fetchPage(groupId, null)).notes.map((n) => n.id)).toEqual(["a"])
    expect(await layer.notes.store.readOutbox()).toEqual([])
  })

  it("refuses to restore with the network down instead of queueing the restore", async () => {
    const layer = layerWith({ socket: false })
    const { online } = network([[]])
    online.restore = () => Promise.reject(new TypeError("Failed to fetch"))

    await expect(offlineNotes(online, () => layer).restore({ groupId, id: "a" })).rejects
      .toThrow(TypeError)

    expect(await layer.notes.store.readOutbox()).toEqual([])
    expect(await layer.cache.readNotes(groupId)).toEqual([])
  })

  it("reads the deleted notes from the server only, and never stores them as live notes", async () => {
    const layer = layerWith({ socket: true })
    const { online } = network([[note("live")]])
    const deps = offlineNotes(online, () => layer)

    const page = await deps.fetchPage(groupId, null, true)

    expect(page.notes.map((n) => n.id)).toEqual(["live"])
    expect(await layer.cache.readNotes(groupId)).toEqual([])
  })
})
