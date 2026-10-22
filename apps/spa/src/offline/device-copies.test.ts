import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { IDBFactory } from "fake-indexeddb"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import { createReadCache } from "@spy4x/realtime/read-cache"
import type { NoteItem, NotePage, NotesDependencies } from "../state/notes.ts"
import type { TagItem, TagsDependencies } from "../state/tags.ts"
import {
  currentLayer,
  type OfflineStorage,
  readsDatabase,
  startOffline,
  stopOffline,
} from "./index.ts"
import { type NotePayload, openNotesCache } from "./notes-cache.ts"
import { offlineNotes } from "./notes-collection.ts"
import { openTagsCache, type TagPayload } from "./tags-cache.ts"
import { offlineTags } from "./tags-collection.ts"

/**
 * The device copies of the notes and tags over IndexedDB, the adapters the browser runs
 * (`openNotesCache`, `openTagsCache`), on the IndexedDB of `fake-indexeddb`. The other unit tests
 * of the layer run on the in-memory copies, which have no sign-out rule of their own.
 */

const groupId = "g-1"
const stamps = {
  version: 1,
  changeSequence: "1",
  createdByUserId: 7,
  updatedByUserId: 7,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
}

function note(id: string, group = groupId): NoteItem {
  return { id, groupId: group, title: `Private note ${id}`, body: "", tagIds: [], ...stamps }
}

function tag(id: string, group = groupId): TagItem {
  return { id, groupId: group, name: `Tag ${id}`, color: "#4b5563", ...stamps }
}

/** One browser: its IndexedDB, and the storage the layer opens on it. The queues are in memory. */
function browser() {
  const indexedDB = new IDBFactory() as unknown as globalThis.IDBFactory
  const storage: OfflineStorage = {
    openReads: (userId) => createReadCache({ name: readsDatabase(userId), indexedDB }),
    openNotes: (userId) => openNotesCache(userId, indexedDB),
    openTags: (userId) => openTagsCache(userId, indexedDB),
    openQueue: () => createMemoryOutboxStore<NotePayload, NoteItem>(),
    openTagsQueue: () => createMemoryOutboxStore<TagPayload, TagItem>(),
  }
  return {
    storage,
    /** What the device holds for the user, read by a copy opened just now, as the next start does. */
    notesOf: (userId: number, group = groupId) =>
      openNotesCache(userId, indexedDB).readNotes(group),
    tagsOf: (userId: number, group = groupId) => openTagsCache(userId, indexedDB).readTags(group),
  }
}

/** A server whose answer to each call the test gives when it chooses. */
function pendingServer() {
  const answers: ((value: unknown) => void)[] = []
  const pending = <T>() =>
    new Promise<T>((resolve) => answers.push(resolve as (v: unknown) => void))
  const never = () => Promise.reject(new Error("the test does not call this"))
  const notes: NotesDependencies = {
    fetchPage: () => pending<NotePage>(),
    get: () => pending<{ note: NoteItem }>(),
    create: never,
    update: never,
    delete: never,
    restore: never,
    move: never,
    newId: () => "id",
  }
  const tags: TagsDependencies = {
    fetchList: () => pending<TagItem[]>(),
    create: never,
    update: never,
    delete: never,
    newId: () => "id",
  }
  return {
    notes,
    tags,
    /** Whether a call is waiting for its answer. */
    asked: () => answers.length > 0,
    answer: (value: unknown) => answers.shift()!(value),
  }
}

/** Lets IndexedDB and the promises behind a call finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

/** Starts the layer of user 7 with a server that takes no queued write. */
function signIn(storage: OfflineStorage, command: () => Promise<unknown> = () => settleNever()) {
  return startOffline(7, {
    calls: { command, query: () => Promise.reject(new Error("the test reads no entity")) },
    canSend: () => true,
  }, storage)
}

function settleNever(): Promise<never> {
  return Promise.reject(new TypeError("Failed to fetch"))
}

describe("the notes and tags a device keeps in IndexedDB", () => {
  it("holds a group's notes and tags for the next start", async () => {
    const { storage, notesOf, tagsOf } = browser()
    await storage.openNotes(7).replaceNotes(groupId, [note("a"), note("b")])
    await storage.openTags(7).replaceTags(groupId, [tag("t")])

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["a", "b"])
    expect((await tagsOf(7)).map((t) => t.id)).toEqual(["t"])
    expect(await notesOf(8)).toEqual([])
  })

  it("files a moved note under its new group only", async () => {
    const { storage, notesOf } = browser()
    const cache = storage.openNotes(7)
    await cache.replaceNotes(groupId, [note("a"), note("b")])

    await cache.putNote(note("a", "g-2"))

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["b"])
    expect((await notesOf(7, "g-2")).map((n) => n.id)).toEqual(["a"])
  })

  it("removes a note and a tag whatever group holds them", async () => {
    const { storage, notesOf, tagsOf } = browser()
    await storage.openNotes(7).replaceNotes("g-2", [note("a", "g-2"), note("b", "g-2")])
    await storage.openTags(7).replaceTags("g-2", [tag("t", "g-2"), tag("u", "g-2")])

    await storage.openNotes(7).removeNote("a")
    await storage.openTags(7).removeTag("t")

    expect((await notesOf(7, "g-2")).map((n) => n.id)).toEqual(["b"])
    expect((await tagsOf(7, "g-2")).map((t) => t.id)).toEqual(["u"])
  })
})

describe("an answer that arrives after the sign-out", () => {
  const globals = globalThis as { document?: unknown }
  // The page as the layer's sync runner reads it: a visible tab.
  beforeEach(() => {
    globals.document = {
      visibilityState: "visible",
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
  afterEach(async () => {
    await stopOffline()
    delete globals.document
  })

  it("does not put the notes list back on the device", async () => {
    const { storage, notesOf } = browser()
    const server = pendingServer()
    await storage.openNotes(7).replaceNotes(groupId, [note("old")])
    signIn(storage)
    const reading = offlineNotes(server.notes, currentLayer).fetchPage(groupId, null)
    await settle()
    expect(server.asked()).toBe(true)

    await stopOffline({ forget: true })
    expect(await notesOf(7)).toEqual([])
    server.answer({ notes: [note("late")], nextCursor: null })
    await reading
    await settle()

    expect(await notesOf(7)).toEqual([])
  })

  it("does not put the tags list back on the device", async () => {
    const { storage, tagsOf } = browser()
    const server = pendingServer()
    await storage.openTags(7).replaceTags(groupId, [tag("old")])
    signIn(storage)
    const reading = offlineTags(server.tags, currentLayer).fetchList(groupId)
    await settle()
    expect(server.asked()).toBe(true)

    await stopOffline({ forget: true })
    expect(await tagsOf(7)).toEqual([])
    server.answer([tag("late")])
    await reading
    await settle()

    expect(await tagsOf(7)).toEqual([])
  })

  it("does not put a note that was being opened back on the device", async () => {
    const { storage, notesOf } = browser()
    const server = pendingServer()
    signIn(storage)
    const opening = offlineNotes(server.notes, currentLayer).get(groupId, "late")
    await settle()

    await stopOffline({ forget: true })
    server.answer({ note: note("late") })
    await opening
    await settle()

    expect(await notesOf(7)).toEqual([])
  })

  it("does not save the server's note or tag for a write that was being sent", async () => {
    const { storage, notesOf, tagsOf } = browser()
    const sends: { name: string; answer: (value: unknown) => void }[] = []
    const layer = signIn(
      storage,
      () => new Promise((resolve) => sends.push({ name: "", answer: resolve })),
    )
    await settle()
    const creatingTag = layer.tags.outbox.submit({
      kind: "create",
      entityId: "late-tag",
      payload: { groupId, name: "Late", color: "#4b5563" },
    })
    await settle()
    expect(sends.length).toBe(1)

    await stopOffline({ forget: true })
    sends[0].answer({ tag: tag("late-tag") })
    await creatingTag
    await settle()
    // The tag has left the queue, so the note that waited behind it is sent now, if at all.
    const creatingNote = layer.notes.outbox.submit({
      kind: "create",
      entityId: "late-note",
      payload: { groupId, title: "Late", body: "", tagIds: [] },
    })
    await settle()
    sends[1]?.answer({ note: note("late-note") })
    await creatingNote
    await settle()

    expect(await tagsOf(7)).toEqual([])
    expect(await notesOf(7)).toEqual([])
  })

  it("does not keep a note whose saving had started when the copy was cleared", async () => {
    const { storage, notesOf } = browser()
    const cache = storage.openNotes(7)
    await cache.replaceNotes(groupId, [note("old")])

    const saving = cache.putNote(note("late"))
    await cache.clear()
    await saving
    await settle()

    expect(await notesOf(7)).toEqual([])
  })

  it("does not keep a tag whose saving had started when the copy was cleared", async () => {
    const { storage, tagsOf } = browser()
    const cache = storage.openTags(7)
    await cache.replaceTags(groupId, [tag("old")])

    const saving = cache.putTag(tag("late"))
    await cache.clear()
    await saving
    await settle()

    expect(await tagsOf(7)).toEqual([])
  })

  it("saves the answer for the same person after they sign in again", async () => {
    const { storage, notesOf } = browser()
    const server = pendingServer()
    signIn(storage)
    await stopOffline({ forget: true })

    signIn(storage)
    const reading = offlineNotes(server.notes, currentLayer).fetchPage(groupId, null)
    await settle()
    server.answer({ notes: [note("fresh")], nextCursor: null })
    await reading

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["fresh"])
  })
})
