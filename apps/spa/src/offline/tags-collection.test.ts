import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections, type ReferenceRemoved } from "@spy4x/realtime/collections"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import type { NotePayload } from "./notes-cache.ts"
import { notesCollection } from "./notes-collection.ts"
import type { TagPayload } from "./tags-cache.ts"
import { tagsCollection } from "./tags-collection.ts"

const groupId = "g-1"

function tag(id: string, version = 1, name = id): TagItem {
  return {
    id,
    groupId,
    name,
    color: "#4b5563",
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function note(id: string): NoteItem {
  return {
    id,
    groupId,
    title: id,
    body: "",
    tagIds: [],
    version: 1,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

interface Sent {
  name: string
  payload: Record<string, unknown>
}

/** Tags and notes of user 1 on one memory device, over a server the test plays. */
function harness() {
  const sent: Sent[] = []
  const removed: ReferenceRemoved[] = []
  const state = {
    online: true,
    /** The server no longer has the tag when it is asked for it. */
    tagGone: false,
    /** Throws to simulate the server; returns the answer otherwise. */
    server: (call: Sent): unknown => {
      const id = String(call.payload.id)
      return call.name.startsWith("tag.") ? { tag: tag(id, 2) } : { note: note(id) }
    },
  }
  const calls: CallPort = {
    async command(name, payload) {
      const call = { name, payload: payload as Record<string, unknown> }
      sent.push(call)
      if (!state.online) throw new ConnectionLostError("the socket is not open")
      return await state.server(call)
    },
    query: (name, payload) =>
      name === "tag.get" && state.tagGone
        ? Promise.reject(refused("TAG_NOT_FOUND"))
        : name === "tag.get"
        ? Promise.resolve({ tag: tag(String((payload as { id: string }).id), 2, "Theirs") })
        : Promise.reject(new Error(`unexpected query ${name}`)),
  }
  const tagsDefinition = tagsCollection({
    userId: 1,
    cache: createMemoryTagsCache(),
    store: createMemoryOutboxStore<TagPayload, TagItem>(),
  })
  const notesDefinition = notesCollection({
    userId: 1,
    cache: createMemoryNotesCache(),
    store: createMemoryOutboxStore<NotePayload, NoteItem>(),
  })
  const collections = createCollections({
    collections: [tagsDefinition, notesDefinition],
    calls,
    canSend: () => state.online,
    now: () => "2026-10-03T00:00:00.000Z",
    onReferenceRemoved: (event) => removed.push(event),
  })
  return {
    sent,
    removed,
    state,
    collections,
    tags: collections.get(tagsDefinition),
    notes: collections.get(notesDefinition),
  }
}

function refused(code: string) {
  return new RealtimeRequestError("conflict", "refused", { code })
}

const newTag = { groupId, name: "Urgent", color: "#b91c1c" as const }
const newNote = { groupId, title: "Plan", body: "", tagIds: ["t-1"] }

describe("tags created offline", () => {
  it("are shown in the group's list with the name and colour that were typed", async () => {
    const { tags, state } = harness()
    state.online = false
    await tags.outbox.submit({ kind: "create", entityId: "t-1", payload: newTag })

    const shown = await tags.overlay([tag("t-0")], groupId)

    expect(shown.map((t) => [t.id, t.name, t.color])).toEqual([
      ["t-1", "Urgent", "#b91c1c"],
      ["t-0", "t-0", "#4b5563"],
    ])
  })

  it("show an edit made offline over the server's tag", async () => {
    const { tags, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "update",
      entityId: "t-0",
      payload: { groupId, name: "Renamed", color: "#1d4ed8" },
      version: 1,
    })

    const [shown] = await tags.overlay([tag("t-0")], groupId)

    expect([shown.name, shown.color]).toEqual(["Renamed", "#1d4ed8"])
  })

  it("send a rename as tag.update on the version it started from", async () => {
    const { tags, sent, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "update",
      entityId: "t-0",
      payload: { groupId, name: "Renamed", color: "#1d4ed8" },
      version: 3,
    })
    state.online = true
    sent.length = 0

    await collections.flush()

    expect(sent).toEqual([{
      name: "tag.update",
      payload: { groupId, id: "t-0", name: "Renamed", color: "#1d4ed8", version: 3 },
    }])
  })

  it("send a delete as tag.delete on the version the person saw, without the name", async () => {
    const { tags, sent, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "delete",
      entityId: "t-0",
      payload: { groupId, name: "Old", color: "#4b5563" },
      version: 4,
    })
    state.online = true
    sent.length = 0

    await collections.flush()

    expect(sent).toEqual([{ name: "tag.delete", payload: { groupId, id: "t-0", version: 4 } }])
  })

  it("are shown in their own group's list only", async () => {
    const { tags, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "create",
      entityId: "t-1",
      payload: { ...newTag, groupId: "g-2" },
    })

    const here = await tags.overlay([tag("t-0")], groupId)
    const there = await tags.overlay([], "g-2")

    expect(here.map((t) => t.id)).toEqual(["t-0"])
    expect(there.map((t) => t.id)).toEqual(["t-1"])
  })
})

describe("a note that names a tag created offline", () => {
  it("is sent after the tag, even when the note was queued first", async () => {
    const { tags, notes, sent, collections, state } = harness()
    state.online = false
    await notes.outbox.submit({ kind: "create", entityId: "n-1", payload: newNote })
    await tags.outbox.submit({ kind: "create", entityId: "t-1", payload: newTag })
    state.online = true
    sent.length = 0

    await collections.flush()

    expect(sent.map((call) => [call.name, call.payload.id])).toEqual([
      ["tag.create", "t-1"],
      ["note.create", "n-1"],
    ])
    expect(sent[1].payload.tagIds).toEqual(["t-1"])
  })

  it("waits for the person while its tag is in conflict", async () => {
    const { tags, notes, sent, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({ kind: "create", entityId: "t-1", payload: newTag })
    await notes.outbox.submit({ kind: "create", entityId: "n-1", payload: newNote })
    state.online = true
    state.server = (call) => {
      if (call.name === "tag.create") throw refused("TAG_NAME_TAKEN")
      return { note: note("n-1") }
    }
    sent.length = 0

    await collections.flush()

    expect(sent.map((call) => call.name)).toEqual(["tag.create"])
    expect(collections.waiting().map((w) => [w.collection, w.entityId, w.onPerson])).toEqual([
      ["notes", "n-1", true],
    ])
  })

  it("loses the reference, and the person is told, when the tag will never exist", async () => {
    const { tags, notes, sent, removed, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({ kind: "create", entityId: "t-1", payload: newTag })
    await notes.outbox.submit({ kind: "create", entityId: "n-1", payload: newNote })

    expect(await tags.outbox.withdraw("t-1")).toBe(true)

    expect(removed.map((event) => event.children)).toEqual([[{
      collection: "notes",
      entityId: "n-1",
    }]])
    state.online = true
    sent.length = 0
    await collections.flush()
    expect(sent.map((call) => [call.name, call.payload.tagIds])).toEqual([["note.create", []]])
  })
})

describe("tag failures", () => {
  it("name the tag, not a note, when someone changed it meanwhile", async () => {
    const { tags, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "update",
      entityId: "t-0",
      payload: { groupId, name: "Mine", color: "#b91c1c" },
      version: 1,
    })
    state.online = true
    state.server = (call) => {
      if (call.name === "tag.update") throw refused("VERSION_CONFLICT")
      return {}
    }

    await collections.flush()

    const [entry] = tags.outbox.entries()
    expect(entry.status).toBe("conflict")
    expect(entry.conflict?.message).toBe("Someone changed this tag while you were offline.")
  })

  it("say the tag was deleted when someone deleted it meanwhile", async () => {
    const { tags, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({
      kind: "update",
      entityId: "t-0",
      payload: { groupId, name: "Mine", color: "#b91c1c" },
      version: 1,
    })
    state.online = true
    state.tagGone = true
    state.server = () => {
      throw refused("TAG_NOT_FOUND")
    }

    await collections.flush()

    const [entry] = tags.outbox.entries()
    expect(entry.status).toBe("conflict")
    expect(entry.conflict?.reason).toBe("gone")
    expect(entry.conflict?.message).toBe("This tag was deleted while you were offline.")
  })

  it("keep a tag queued while the server says the session ended", async () => {
    const { tags, collections, state } = harness()
    state.online = false
    await tags.outbox.submit({ kind: "create", entityId: "t-1", payload: newTag })
    state.online = true
    state.server = () => {
      throw new RealtimeRequestError("unauthorized", "Sign in again")
    }

    await collections.flush()

    expect(tags.outbox.entries().map((entry) => entry.status)).toEqual(["pending"])
  })
})
