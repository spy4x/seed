import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { IDBFactory } from "fake-indexeddb"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import { createReadCache } from "@spy4x/realtime/read-cache"
import type { NoteItem, NotesDependencies } from "../state/notes.ts"
import type { TagItem, TagsDependencies } from "../state/tags.ts"
import { deviceCopy, openChangesCopy } from "./device-copy.ts"
import {
  currentLayer,
  type OfflineStorage,
  readsDatabase,
  startOffline,
  stopOffline,
} from "./index.ts"
import type { NotePayload } from "./notes-cache.ts"
import { offlineNotes } from "./notes-collection.ts"
import type { TagPayload } from "./tags-cache.ts"
import { offlineTags } from "./tags-collection.ts"

/**
 * The device's copy of the notes and tags over IndexedDB, the adapter the browser runs
 * (`openChangesCopy`), on the IndexedDB of `fake-indexeddb`. The other unit tests of the layer run
 * on the in-memory copy, which has no sign-out rule of its own.
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

function note(id: string, group = groupId, more: Partial<NoteItem> = {}): NoteItem {
  return {
    id,
    groupId: group,
    title: `Private note ${id}`,
    body: "",
    tagIds: [],
    ...stamps,
    ...more,
  }
}

function tag(id: string, group = groupId): TagItem {
  return { id, groupId: group, name: `Tag ${id}`, color: "#4b5563", ...stamps }
}

/** The server's answer to `group.changes`: the changes in `(after, through]`, all on one page. */
function changes(
  after: number,
  through: number,
  rows: { notes?: NoteItem[]; tags?: TagItem[]; gone?: { kind: "notes" | "tags"; id: string }[] } =
    {},
): unknown {
  return {
    status: "changes",
    after,
    through,
    current: through,
    more: false,
    upserts: { notes: rows.notes ?? [], tags: rows.tags ?? [] },
    tombstones: rows.gone ?? [],
  }
}

/** One browser: its IndexedDB, and the storage the layer opens on it. The queues are in memory. */
function browser() {
  const indexedDB = new IDBFactory() as unknown as globalThis.IDBFactory
  const storage: OfflineStorage = {
    openReads: (userId) => createReadCache({ name: readsDatabase(userId), indexedDB }),
    openCopy: (userId) => openChangesCopy(userId, indexedDB),
    openQueue: () => createMemoryOutboxStore<NotePayload, NoteItem>(),
    openTagsQueue: () => createMemoryOutboxStore<TagPayload, TagItem>(),
  }
  /** The user's copy with the pull answered by `answers`, one per pull, in order. */
  const copyOf = (userId: number, answers: unknown[] = []) => {
    const asked: number[] = []
    const copy = deviceCopy({
      copy: storage.openCopy(userId),
      fetch: (_group, after) => {
        asked.push(after)
        const next = answers.shift()
        return next ? Promise.resolve(next) : Promise.reject(new TypeError("Failed to fetch"))
      },
    })
    return Object.assign(copy, { asked })
  }
  return {
    storage,
    copyOf,
    /** What the device holds for the user, read by a copy opened just now, as the next start does. */
    notesOf: (userId: number, group = groupId) => copyOf(userId).notes.readNotes(group),
    tagsOf: (userId: number, group = groupId) => copyOf(userId).tags.readTags(group),
  }
}

/** A server whose answer to each read the test gives when it chooses. */
function pendingServer() {
  const answers: ((value: unknown) => void)[] = []
  const pending = <T>() =>
    new Promise<T>((resolve) => answers.push(resolve as (v: unknown) => void))
  const never = () => Promise.reject(new Error("the test does not call this"))
  const notes: NotesDependencies = {
    fetchPage: never,
    get: () => pending<{ note: NoteItem }>(),
    create: never,
    update: never,
    delete: never,
    restore: never,
    move: never,
    newId: () => "id",
  }
  const tags: TagsDependencies = {
    fetchList: never,
    create: never,
    update: never,
    delete: never,
    newId: () => "id",
  }
  return {
    notes,
    tags,
    /** The `group.changes` call of the layer. */
    query: () => pending<unknown>(),
    /** Whether a call is waiting for its answer. */
    asked: () => answers.length > 0,
    answer: (value: unknown) => answers.shift()!(value),
  }
}

/** Lets IndexedDB and the promises behind a call finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

/** Starts the layer of user 7 with a server that takes no queued write and answers no read. */
function signIn(
  storage: OfflineStorage,
  command: () => Promise<unknown> = () => settleNever(),
  query: () => Promise<unknown> = () => settleNever(),
) {
  return startOffline(7, { calls: { command, query }, canSend: () => true }, storage)
}

function settleNever(): Promise<never> {
  return Promise.reject(new TypeError("Failed to fetch"))
}

describe("the notes and tags a device keeps in IndexedDB", () => {
  it("holds a group's notes and tags for the next start", async () => {
    const { copyOf, notesOf, tagsOf } = browser()
    await copyOf(7, [changes(0, 3, { notes: [note("a"), note("b")], tags: [tag("t")] })])
      .pull(groupId)

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["a", "b"])
    expect((await tagsOf(7)).map((t) => t.id)).toEqual(["t"])
    expect(await notesOf(8)).toEqual([])
  })

  it("asks only for the changes after its cursor, and drops the notes the server sends as gone", async () => {
    const { copyOf, notesOf } = browser()
    const edited = note("a", groupId, { title: "Edited", version: 2 })
    const copy = copyOf(7, [
      changes(0, 3, { notes: [note("a"), note("b"), note("c")] }),
      changes(3, 5, { notes: [edited], gone: [{ kind: "notes", id: "b" }] }),
    ])

    await copy.pull(groupId)
    await copy.pull(groupId)

    expect(copy.asked).toEqual([0, 3])
    expect((await notesOf(7)).map((n) => [n.id, n.title])).toEqual([
      ["a", "Edited"],
      ["c", "Private note c"],
    ])
  })

  it("files a moved note under its new group only", async () => {
    const { copyOf, notesOf } = browser()
    const copy = copyOf(7, [changes(0, 1, { notes: [note("a"), note("b")] }), changes(0, 1)])
    await copy.pull(groupId)
    await copy.pull("g-2")

    await copy.notes.putNote(note("a", "g-2"))

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["b"])
    expect((await notesOf(7, "g-2")).map((n) => n.id)).toEqual(["a"])
  })

  it("keeps the newer note when a slow answer brings an older version of it", async () => {
    const { copyOf, notesOf } = browser()
    const copy = copyOf(7, [changes(0, 2, { notes: [note("a", groupId, { version: 2 })] })])
    await copy.pull(groupId)

    await copy.notes.putNote(note("a", groupId, { version: 1, title: "Stale" }))

    expect((await notesOf(7)).map((n) => n.version)).toEqual([2])
  })

  it("removes a note and a tag whatever group holds them", async () => {
    const { copyOf, notesOf, tagsOf } = browser()
    const copy = copyOf(7, [
      changes(0, 1, {
        notes: [note("a", "g-2"), note("b", "g-2")],
        tags: [tag("t", "g-2"), tag("u", "g-2")],
      }),
    ])
    await copy.pull("g-2")

    await copy.notes.removeNote("a")
    await copy.tags.removeTag("t")

    expect((await notesOf(7, "g-2")).map((n) => n.id)).toEqual(["b"])
    expect((await tagsOf(7, "g-2")).map((t) => t.id)).toEqual(["u"])
  })

  it("drops a deleted tag from the notes that named it, and counts each tag's notes", async () => {
    const { copyOf, notesOf, tagsOf } = browser()
    const copy = copyOf(7, [
      changes(0, 2, {
        notes: [note("a", groupId, { tagIds: ["t", "u"] }), note("b", groupId, { tagIds: ["t"] })],
        tags: [tag("t"), tag("u")],
      }),
      changes(2, 3, { gone: [{ kind: "tags", id: "u" }] }),
    ])
    await copy.pull(groupId)
    await copy.pull(groupId)

    expect((await notesOf(7)).map((n) => [n.id, n.tagIds])).toEqual([["a", ["t"]], ["b", ["t"]]])
    expect((await tagsOf(7)).map((t) => [t.id, t.noteCount])).toEqual([["t", 2]])
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
    const { storage, copyOf, notesOf } = browser()
    const server = pendingServer()
    await copyOf(7, [changes(0, 1, { notes: [note("old")] })]).pull(groupId)
    signIn(storage, undefined, server.query)
    const reading = offlineNotes(server.notes, currentLayer).fetchPage(groupId, null)
    await settle()
    expect(server.asked()).toBe(true)

    await stopOffline({ forget: true })
    expect(await notesOf(7)).toEqual([])
    server.answer(changes(0, 2, { notes: [note("late")] }))
    await reading.catch(() => {})
    await settle()

    expect(await notesOf(7)).toEqual([])
  })

  it("does not put the tags list back on the device", async () => {
    const { storage, copyOf, tagsOf } = browser()
    const server = pendingServer()
    await copyOf(7, [changes(0, 1, { tags: [tag("old")] })]).pull(groupId)
    signIn(storage, undefined, server.query)
    const reading = offlineTags(server.tags, currentLayer).fetchList(groupId)
    await settle()
    expect(server.asked()).toBe(true)

    await stopOffline({ forget: true })
    expect(await tagsOf(7)).toEqual([])
    server.answer(changes(0, 2, { tags: [tag("late")] }))
    await reading.catch(() => {})
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
    const { copyOf, notesOf } = browser()
    const copy = copyOf(7, [changes(0, 1, { notes: [note("old")] })])
    await copy.pull(groupId)
    const cache = copy.notes

    const saving = cache.putNote(note("late"))
    await cache.clear()
    await saving
    await settle()

    expect(await notesOf(7)).toEqual([])
  })

  it("does not keep a tag whose saving had started when the copy was cleared", async () => {
    const { copyOf, tagsOf } = browser()
    const copy = copyOf(7, [changes(0, 1, { tags: [tag("old")] })])
    await copy.pull(groupId)
    const cache = copy.tags

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

    signIn(storage, undefined, server.query)
    const reading = offlineNotes(server.notes, currentLayer).fetchPage(groupId, null)
    await settle()
    server.answer(changes(0, 1, { notes: [note("fresh")] }))
    await reading

    expect((await notesOf(7)).map((n) => n.id)).toEqual(["fresh"])
  })
})
