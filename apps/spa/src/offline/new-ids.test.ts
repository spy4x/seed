// Every id the SPA makes is a UUID version 7 (docs/ids.md). These tests run the stores on the
// page's own dependencies (`onlineGroups`, `onlineNotes`, `onlineTags`), with only the network
// calls replaced, so the id is the one a person's browser would send.
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections } from "@spy4x/realtime/collections"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { createGroupsStore, type GroupItem, onlineGroups } from "../state/groups.ts"
import { createNotesStore, type NoteItem, onlineNotes } from "../state/notes.ts"
import { createTagsStore, onlineTags, type TagItem } from "../state/tags.ts"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import type { NotePayload } from "./notes-cache.ts"
import { notesCollection, offlineNotes } from "./notes-collection.ts"
import type { TagPayload } from "./tags-cache.ts"
import { offlineTags, tagsCollection } from "./tags-collection.ts"

const groupId = "0198f3a2-7c1e-7d4b-9a53-2f6e8b1c4d70"

/** Ids as the SPA made them before this rule: UUID version 4. */
const OLD_NOTE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
const OLD_TAG_ID = "9b2d5f1e-3c4a-4e6b-8d7f-1a2b3c4d5e6f"

const stamps = {
  version: 1,
  changeSequence: "1",
  createdByUserId: 1,
  updatedByUserId: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const note = (id: string): NoteItem => ({ id, groupId, title: id, body: "", tagIds: [], ...stamps })
const tag = (id: string): TagItem => ({ id, groupId, name: id, color: "#4b5563", ...stamps })

/** The device of user 1 in memory. `sent` lists every command that reached the server. */
function device(state: { socket: boolean }) {
  const sent: { name: string; id: string }[] = []
  const calls: CallPort = {
    command(name, payload) {
      const id = String((payload as { id: string }).id)
      sent.push({ name, id })
      return Promise.resolve(name.startsWith("tag.") ? { tag: tag(id) } : { note: note(id) })
    },
    query: () => Promise.reject(new Error("the test reads nothing over the socket")),
  }
  const tagsCache = createMemoryTagsCache()
  const cache = createMemoryNotesCache()
  const tagsDefinition = tagsCollection({
    userId: 1,
    cache: tagsCache,
    store: createMemoryOutboxStore<TagPayload, TagItem>(),
  })
  const notesDefinition = notesCollection({
    userId: 1,
    cache,
    store: createMemoryOutboxStore<NotePayload, NoteItem>(),
  })
  const collections = createCollections({
    collections: [tagsDefinition, notesDefinition],
    calls,
    canSend: () => state.socket,
    now: () => "2026-10-03T00:00:00.000Z",
  })
  return {
    sent,
    notesLayer: { cache, notes: collections.get(notesDefinition) },
    tagsLayer: { tagsCache, tags: collections.get(tagsDefinition) },
  }
}

const unreachable = () => Promise.reject(new TypeError("Failed to fetch"))

describe("ids the SPA makes", () => {
  it("gives a group created online a version 7 id", async () => {
    const created: string[] = []
    const store = createGroupsStore({
      ...onlineGroups,
      create(input) {
        created.push(input.id)
        return Promise.resolve({ group: { id: input.id, changeSequence: "1" } as GroupItem })
      },
      advance: () => {},
    })
    store.edit(null, { name: "Team", description: "", color: null, emoji: "" })

    await store.create()

    expect(created.length).toBe(1)
    expect(isUuid(created[0], 7)).toBe(true)
  })

  it("gives a note created online a version 7 id, and the next draft a different one", async () => {
    const created: string[] = []
    const store = createNotesStore({
      ...onlineNotes,
      fetchPage: () => Promise.resolve({ notes: [], nextCursor: null }),
      create(input) {
        created.push(input.id)
        return Promise.resolve({ note: note(input.id) })
      },
    })
    await store.open(groupId, null)
    store.draft.value = { ...store.draft.value, title: "Groceries" }

    await store.create()

    expect(created.length).toBe(1)
    expect(isUuid(created[0], 7)).toBe(true)
    expect(isUuid(store.draftId.value, 7)).toBe(true)
    expect(store.draftId.value).not.toBe(created[0])
  })

  it("gives a note created with no network a version 7 id, which the server gets once the socket is back", async () => {
    const state = { socket: false }
    const { sent, notesLayer } = device(state)
    const store = createNotesStore(
      offlineNotes({ ...onlineNotes, fetchPage: unreachable }, () => notesLayer),
    )
    await store.open(groupId, null)
    store.draft.value = { ...store.draft.value, title: "Written on a train" }

    const made = await store.create()

    expect(sent).toEqual([])
    expect(isUuid(made?.id, 7)).toBe(true)
    state.socket = true
    await notesLayer.notes.outbox.flush()
    expect(sent).toEqual([{ name: "note.create", id: made!.id }])
  })

  it("gives a tag created online a version 7 id", async () => {
    const created: string[] = []
    const store = createTagsStore({
      ...onlineTags,
      fetchList: () => Promise.resolve([]),
      create(input) {
        created.push(input.id)
        return Promise.resolve({ tag: tag(input.id) })
      },
    })
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "Home" })

    expect(await store.save()).not.toBeNull()

    expect(created.length).toBe(1)
    expect(isUuid(created[0], 7)).toBe(true)
  })

  it("gives a tag created with no network a version 7 id, which the server gets once the socket is back", async () => {
    const state = { socket: false }
    const { sent, tagsLayer } = device(state)
    const store = createTagsStore(
      offlineTags({ ...onlineTags, fetchList: unreachable }, () => tagsLayer),
    )
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "Home" })

    expect(await store.save()).not.toBeNull()

    const made = store.tags.value.find((entry) => entry.name === "Home")
    expect(sent).toEqual([])
    expect(isUuid(made?.id, 7)).toBe(true)
    state.socket = true
    await tagsLayer.tags.outbox.flush()
    expect(sent).toEqual([{ name: "tag.create", id: made!.id }])
  })

  it("still sends a note and a tag that were queued with version 4 ids before the update", async () => {
    const state = { socket: false }
    const { sent, notesLayer, tagsLayer } = device(state)
    const notes = offlineNotes({ ...onlineNotes, fetchPage: unreachable }, () => notesLayer)
    const tags = offlineTags({ ...onlineTags, fetchList: unreachable }, () => tagsLayer)
    await tags.create({ groupId, id: OLD_TAG_ID, name: "Home", color: "#4b5563" })
    await notes.create({ groupId, id: OLD_NOTE_ID, title: "Old", body: "", tagIds: [OLD_TAG_ID] })
    expect(sent).toEqual([])

    state.socket = true
    await tagsLayer.tags.outbox.flush()
    await notesLayer.notes.outbox.flush()

    expect(sent).toEqual([
      { name: "tag.create", id: OLD_TAG_ID },
      { name: "note.create", id: OLD_NOTE_ID },
    ])
  })
})
