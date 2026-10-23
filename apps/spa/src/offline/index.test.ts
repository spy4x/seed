import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import {
  configureModules,
  forgetModules,
  forgetUser,
  localReads,
  recallUser,
  rememberUser,
  startModules,
  stopChanges,
  wipeDevice,
} from "../modules.ts"
import type { NoteItem } from "../state/notes.ts"
import type { TagItem } from "../state/tags.ts"
import { sessionState, type SessionUser } from "../state/session.ts"
import { toasts } from "../state/toasts.ts"
import { currentLayer, forgetDeviceCopy, startOffline, stopOffline } from "./index.ts"
import { installLocalStorage } from "@spy4x/platform/browser/testing"
import { createMemoryStorage } from "./memory-storage.ts"
import type { NoteEntry } from "./notes-cache.ts"
import { notesCollection } from "./notes-collection.ts"

const realFetch = globalThis.fetch
const globals = globalThis as { document?: unknown }
const signedOut = sessionState.value
const user = (id: number) => ({ id }) as SessionUser

function note(id: string, version = 1, title = id): NoteItem {
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

function tagItem(id: string, version = 1, name = id): TagItem {
  return {
    id,
    groupId: "g-1",
    name,
    color: "#b91c1c",
    version,
    changeSequence: "1",
    createdByUserId: 7,
    updatedByUserId: 7,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

/**
 * A write as the app queued it before the notes moved to the collections layer, field for field
 * as it lies in `offline:user:<id>:outbox` on a device (the store adds `seq`).
 */
const QUEUED_BY_AN_EARLIER_VERSION: NoteEntry = {
  key: "key-from-last-week",
  entityId: "n-1",
  kind: "update",
  payload: { groupId: "g-1", title: "Written offline", body: "last week" },
  baseVersion: 3,
  attempted: true,
  status: "pending",
  queuedAt: "2026-10-01T08:00:00.000Z",
}

interface Call {
  url: string
  key: string | null
  body: unknown
}

/** A server that takes every call and records it. */
function server(): Call[] {
  const calls: Call[] = []
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({
      url,
      key: new Headers(init.headers).get("Idempotency-Key"),
      body: JSON.parse(String(init.body)),
    })
    const body = JSON.parse(String(init.body)) as { id?: string }
    const result = String(url).includes("/tag.")
      ? { tag: tagItem(String(body.id), 1, "Urgent") }
      : { note: note("n-1", 4, "Written offline") }
    return Promise.resolve(Response.json({ result }))
  }) as unknown as typeof fetch
  return calls
}

/** Lets every queued step run: the queue's read, the runner's start and its flush. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const reads = { pull: () => {}, check: () => Promise.resolve() }

/** The page as the sync runners read it: a visible tab. */
function visiblePage(): void {
  globals.document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/** A page with no socket, signed in as `id`, on a device that holds `storage`. */
function startPage(id: number, storage: ReturnType<typeof createMemoryStorage>): void {
  visiblePage()
  configureModules({ realtime: false, offline: true })
  sessionState.value = { ...signedOut, user: user(id) }
  startModules(id, reads, { storage, databases: storage.databases })
}

/** What the page's `localStorage` holds: the remembered user and the deletions still owed. */
let kept: ReturnType<typeof installLocalStorage>["kept"]
let restoreLocalStorage = () => {}
const OWED = "offline:owed-deletion"

/** A Web Storage in memory with the parts a wipe walks: `length`, `key` and `clear`. */
function webStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  }
}

/** Puts `local` and `session` in place of the page's storages; returns the way back. */
function installWebStorage(local: Storage | object, session: Storage | object): () => void {
  const real = {
    local: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    session: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
  }
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: local })
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session })
  return () => {
    for (
      const [name, descriptor] of [["localStorage", real.local], [
        "sessionStorage",
        real.session,
      ]] as const
    ) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete (globalThis as Record<string, unknown>)[name]
    }
  }
}

beforeEach(() => {
  const installed = installLocalStorage()
  kept = installed.kept
  restoreLocalStorage = installed.restore
})

afterEach(async () => {
  stopChanges()
  await stopOffline()
  // Every deletion a test started has been tried before the next test begins.
  await forgetUser(createMemoryStorage())
  restoreLocalStorage()
  configureModules({})
  sessionState.value = signedOut
  globalThis.fetch = realFetch
  delete globals.document
  toasts.clear()
})

describe("a queue an earlier version of the app left on the device", () => {
  it("is looked for in the database the queue has always had", () => {
    const definition = notesCollection({ userId: 7, cache: createMemoryStorage().of(7).notes })

    expect(definition.database).toBe("offline:user:7:outbox")
  })

  it("is sent as the note command it was, with the key it was queued under", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const calls = server()

    startPage(7, storage)
    await settle()

    expect(calls).toEqual([{
      url: "/api/call/note.update",
      key: "key-from-last-week",
      body: { groupId: "g-1", id: "n-1", title: "Written offline", body: "last week", version: 3 },
    }])
    expect(await storage.of(7).queue.readOutbox()).toEqual([])
    expect((await storage.of(7).notes.readNotes("g-1")).map((n) => n.version)).toEqual([4])
  })

  it("shows a conflict it held, with the server's side, for the person to choose", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry({
      ...QUEUED_BY_AN_EARLIER_VERSION,
      status: "conflict",
      conflict: {
        reason: "version",
        message: "Someone changed this note while you were offline.",
        server: note("n-1", 5, "Theirs"),
      },
    })
    const calls = server()

    startPage(7, storage)
    await settle()

    const [entry] = currentLayer()!.entries.value
    expect([entry.status, entry.conflict?.server?.title]).toEqual(["conflict", "Theirs"])
    expect(calls).toEqual([])
  })
})

describe("the queue of a started page", () => {
  it("is not sent while the cookie belongs to someone else", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const calls = server()

    startPage(7, storage)
    // The session changed under the page before the queue was read.
    sessionState.value = { ...signedOut, user: user(8) }
    await settle()

    expect(calls).toEqual([])
    expect((await storage.of(7).queue.readOutbox()).map((entry) => entry.key)).toEqual([
      "key-from-last-week",
    ])
  })

  it("is not sent by a layer that was stopped while the queue was being read", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const sent: string[] = []
    const transport = {
      calls: {
        command: (name: string) => Promise.resolve(void sent.push(name)),
        query: () => Promise.resolve(),
      },
      canSend: () => true,
    }

    visiblePage()
    startOffline(7, transport, storage)
    await stopOffline()
    await settle()
    const stopped = [...sent]
    startOffline(7, transport, storage)
    await settle()

    expect([stopped, sent]).toEqual([[], ["note.update"]])
  })
})

describe("what the device keeps", () => {
  /** A device that holds a read copy, a note and a queued write of user 7. */
  async function deviceInUse() {
    const storage = createMemoryStorage()
    const device = storage.of(7)
    device.reads.set("groups", { value: [{ id: "g-1" }], savedAt: 1 })
    await device.notes.putNote(note("n-9"))
    await device.queue.putEntry({ ...QUEUED_BY_AN_EARLIER_VERSION, status: "conflict" })
    await device.tags.putTag(tagItem("t-9"))
    await device.tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", name: "Urgent", color: "#b91c1c" },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })
    return { storage, device }
  }

  it("keeps a list read through the running layer, and answers from it when unreachable", async () => {
    const storage = createMemoryStorage()
    server()
    startPage(7, storage)
    await localReads.through("members:g-1", () => Promise.resolve(["Ann"]))

    const answer = await localReads.through(
      "members:g-1",
      () => Promise.reject(new TypeError("Failed to fetch")),
    )

    expect([answer.value, answer.fresh]).toEqual([["Ann"], false])
    expect([...storage.of(7).reads.keys()]).toEqual(["members:g-1"])
  })

  it("keeps nothing while the local-data module is off", async () => {
    const storage = createMemoryStorage()
    startPage(7, storage)
    stopChanges()
    await stopOffline()
    configureModules({ realtime: false, offline: false })
    startModules(7, reads, { storage })

    await localReads.through("members:g-1", () => Promise.resolve(["Ann"]))

    expect(currentLayer()).toBeNull()
    expect([...storage.of(7).reads.keys()]).toEqual([])
  })

  /** The sign-out in the app's order (`apps/spa/src/app.tsx`): the device first, then the layer. */
  async function signOut(storage: ReturnType<typeof createMemoryStorage>): Promise<void> {
    sessionState.value = signedOut
    const wiped = wipeDevice(storage, storage.databases)
    forgetModules()
    await wiped
    await settle()
  }

  it("deletes the tags and the queued tag writes on sign-out", async () => {
    const { storage, device } = await deviceInUse()
    startPage(7, storage)
    await settle()

    await signOut(storage)

    expect(await device.tags.readTags("g-1")).toEqual([])
    expect(await device.tagsQueue.readOutbox()).toEqual([])
  })

  it("sends a tag queued on the device before the note that names it", async () => {
    const storage = createMemoryStorage()
    const device = storage.of(7)
    await device.queue.putEntry({
      key: "note-key",
      entityId: "n-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", title: "Plan", body: "", tagIds: ["t-1"] },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })
    await device.tagsQueue.putEntry({
      key: "tag-key",
      entityId: "t-1",
      kind: "create",
      baseVersion: 0,
      payload: { groupId: "g-1", name: "Urgent", color: "#b91c1c" },
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:01.000Z",
    })
    const calls = server()

    startPage(7, storage)
    await settle()

    expect(calls.map((call) => call.url)).toEqual(["/api/call/tag.create", "/api/call/note.create"])
  })

  it("deletes the read copies, the notes and the queued writes on sign-out", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    await settle()

    await signOut(storage)

    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.queue.readOutbox()).toEqual([])
    expect(currentLayer()).toBeNull()
  })

  it("deletes the app's browser storage on sign-out, and keeps only what finishes it and what belongs to the device", async () => {
    const { storage } = await deviceInUse()
    server()
    startPage(7, storage)
    await settle()
    const local = webStorage({
      "offline:session": `{"id":7}`,
      "selection:7": `{"groupId":"g-1"}`,
      "realtime:user:7:g-1": "12",
      "preferences:kept-zone": "Europe/Berlin",
      "auth:sign-out-owed": "1",
      "offline:owed-deletion": "[7]",
      "theme": "dark",
      "install-prompt-dismissed": "1",
      "last-sign-in": `{"method":"password","email":"a***@example.com"}`,
    })
    const sent = `{"email":"ann@example.com","sentAt":1}`
    const session = webStorage({ "draft": "Private text", "sign-in-link:sent": sent })
    const restore = installWebStorage(local, session)
    try {
      await signOut(storage)
    } finally {
      restore()
    }

    expect([...local.entries.keys()].sort()).toEqual([
      "auth:sign-out-owed",
      "install-prompt-dismissed",
      "last-sign-in",
      "theme",
    ])
    // The link this tab asked for stays, so "Check your inbox" survives a signed-out reload.
    expect([...session.entries]).toEqual([["sign-in-link:sent", sent]])
  })

  it("saves no answer that arrives after the sign-out", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    let answer!: (members: string[]) => void
    const reading = localReads.through(
      "members:g-1",
      () => new Promise<string[]>((resolve) => answer = resolve),
    )

    forgetModules()
    await settle()
    answer(["Ann"])
    await reading

    expect([...device.reads.keys()]).toEqual([])
  })

  it("saves no answer that arrives after a sign-out made in the app's order", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    rememberUser(user(7))
    await settle()
    let answer!: (members: string[]) => void
    const reading = localReads.through(
      "members:g-1",
      () => new Promise<string[]>((resolve) => answer = resolve),
    )

    // The app's order on sign-out: the effect that forgets the user runs before the one that
    // stops the modules (apps/spa/src/app.tsx).
    sessionState.value = signedOut
    void forgetUser(storage)
    forgetModules()
    await settle()
    expect([...device.reads.keys()]).toEqual([])
    answer(["Ann"])
    await reading
    await settle()

    expect([...device.reads.keys()]).toEqual([])
    expect(kept.getItem("offline:owed-deletion")).toBeNull()
  })

  it("deletes everything of the remembered user at a start that finds no session, their queue included", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    // No layer runs: the page found no session and shows the sign-in page.
    await wipeDevice(storage, storage.databases)

    expect(recallUser()).toBeNull()
    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.queue.readOutbox()).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
    expect(await device.tagsQueue.readOutbox()).toEqual([])
  })

  it("keeps the remembered user's queue when only their copies are forgotten, as a start with the module off needs to send it", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    await forgetUser(storage)

    expect([...device.reads.keys()]).toEqual([])
    expect((await device.queue.readOutbox()).map((entry) => entry.entityId)).toEqual(["n-1"])
    expect((await device.tagsQueue.readOutbox()).map((entry) => entry.entityId)).toEqual(["t-1"])
  })

  it("deletes everything of the remembered person at a start as someone else, their queue included, before that person's layer opens", async () => {
    const { storage, device } = await deviceInUse()
    server()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    // A start that finds person 8's session, as a provider sign-in's redirect brings it, in the
    // app's order: the user is remembered first, then the modules start (apps/spa/src/app.tsx).
    rememberUser(user(8), storage, storage.databases)
    startPage(8, storage)
    expect(currentLayer()).toBeNull()
    await settle()

    expect(recallUser()).toEqual(user(8))
    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
    expect(await device.queue.readOutbox()).toEqual([])
    expect(await device.tagsQueue.readOutbox()).toEqual([])
    expect(kept.getItem(OWED)).toBeNull()
    expect(currentLayer()?.userId).toBe(8)
  })

  it("deletes everything of the remembered person, their queue included, as soon as someone else is remembered, and nothing of the new person", async () => {
    const { storage, device } = await deviceInUse()
    const next = storage.of(8)
    await next.queue.putEntry({ ...QUEUED_BY_AN_EARLIER_VERSION, status: "conflict" })
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    rememberUser(user(8), storage, storage.databases)
    await settle()

    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
    expect(await device.queue.readOutbox()).toEqual([])
    expect(await device.tagsQueue.readOutbox()).toEqual([])
    expect((await next.queue.readOutbox()).length).toBe(1)
    expect(kept.getItem(OWED)).toBeNull()
  })

  it("deletes the app's browser storage as soon as someone else is remembered, and remembers the new person", async () => {
    configureModules({ realtime: false, offline: true })
    const local = webStorage({ "offline:session": `{"id":7}`, "selection:7": `{"groupId":"g-1"}` })
    const session = webStorage({ "draft": "Private text" })
    const restore = installWebStorage(local, session)
    try {
      rememberUser(user(8), createMemoryStorage())
      await settle()
    } finally {
      restore()
    }

    expect([...local.entries]).toEqual([["offline:session", `{"id":8}`]])
    expect(session.entries.size).toBe(0)
  })

  it("keeps the remembered person's copies at a start as the same person", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    rememberUser(user(7), storage)
    await settle()

    expect([...device.reads.keys()]).toEqual(["groups"])
    expect((await device.notes.readNotes("g-1")).map((n) => n.id)).toEqual(["n-9"])
    expect(kept.getItem(OWED)).toBeNull()
  })

  it("deletes the copies of the person whose layer runs when another person's layer starts, and keeps their queue", async () => {
    const { storage, device } = await deviceInUse()
    visiblePage()
    const transport = {
      calls: { command: () => Promise.resolve(), query: () => Promise.resolve() },
      canSend: () => false,
    }
    startOffline(7, transport, storage)
    await settle()

    startOffline(8, transport, storage)
    await settle()

    expect(currentLayer()?.userId).toBe(8)
    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
    expect((await device.queue.readOutbox()).map((entry) => entry.entityId)).toEqual(["n-1"])
    expect((await device.tagsQueue.readOutbox()).map((entry) => entry.entityId)).toEqual(["t-1"])
  })

  it("remembers the signed-in user under the key a device already holds, and nobody when what is stored there is not a user", () => {
    configureModules({ realtime: false, offline: true })
    // What the app wrote before it used the library's hint.
    kept.setItem("offline:session", JSON.stringify(user(7)))
    expect(recallUser()).toEqual(user(7))

    rememberUser(user(8))
    expect(JSON.parse(kept.getItem("offline:session") ?? "null")).toEqual(user(8))

    kept.setItem("offline:session", JSON.stringify({ firstName: "No id" }))
    expect(recallUser()).toBeNull()
    kept.setItem("offline:session", "not json")
    expect(recallUser()).toBeNull()
  })

  it("remembers nobody while the local-data module is off", () => {
    configureModules({ realtime: false, offline: false })
    rememberUser(user(7))
    expect(kept.size).toBe(0)
    kept.setItem("offline:session", JSON.stringify(user(7)))
    expect(recallUser()).toBeNull()
  })

  it("are gone before the sign-in page shows, even when the page asked twice to forget", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    // The session store's own reaction to "nobody is signed in" comes first; the start, which
    // holds the sign-in page back, asks second and finds nobody remembered.
    // The device takes a moment to delete, as IndexedDB does.
    const slow: typeof storage = {
      ...storage,
      openReads(userId) {
        const reads = storage.openReads(userId)
        return {
          ...reads,
          clear: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5))
            await reads.clear()
          },
        }
      },
    }
    void forgetUser(slow)
    await forgetUser(slow)

    expect([...device.reads.keys()]).toEqual([])
  })

  /**
   * `storage` with a read-copy deletion that `clear` replaces: one that waits, or one that fails.
   * Deleting a read-copy database goes through it too.
   */
  function deleting(
    storage: ReturnType<typeof createMemoryStorage>,
    clear: (really: () => Promise<void>) => Promise<void>,
  ): typeof storage {
    return {
      ...storage,
      openReads(userId) {
        const reads = storage.openReads(userId)
        return { ...reads, clear: () => clear(() => reads.clear()) }
      },
      databases: {
        list: storage.databases.list,
        delete: (name) =>
          name.startsWith("reads:")
            ? clear(() => storage.databases.delete(name))
            : storage.databases.delete(name),
      },
    }
  }

  it("forgets the person at once and still owes their copies a deletion when the page closes while they are being deleted", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))
    let finish!: () => void
    const held = new Promise<void>((resolve) => finish = resolve)
    // IndexedDB is still deleting when the page goes away: nothing after this point runs there.
    const closing = deleting(storage, async (really) => (await held, await really()))

    try {
      void forgetUser(closing)
      await settle()

      // The next start is a new page: what `localStorage` holds is all it has to find the copies by.
      expect(recallUser()).toBeNull()
      expect([...device.reads.keys()]).toEqual(["groups"])
      expect(kept.getItem(OWED)).toBe("[7]")
    } finally {
      finish()
    }
  })

  it("deletes the copies an earlier page still owed at a start that finds no session", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    // What a page that closed while deleting left behind: nobody remembered, one deletion owed.
    kept.setItem(OWED, "[7]")

    await forgetUser(storage)

    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
    expect(kept.getItem(OWED)).toBeNull()
  })

  it("deletes the copies an earlier page still owed before the layer of the next sign-in opens", async () => {
    const { storage, device } = await deviceInUse()
    server()
    kept.setItem(OWED, "[7]")

    startPage(7, storage)
    // No layer yet: a list read now goes to the server alone, so no owed copy can be shown.
    expect(currentLayer()).toBeNull()
    await settle()

    expect([...device.reads.keys()]).toEqual([])
    expect(kept.getItem(OWED)).toBeNull()
    expect(currentLayer()?.userId).toBe(7)
  })

  it("keeps the deletion owed when the device could not delete, says so, and deletes at the next start", async () => {
    const { storage, device } = await deviceInUse()
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))
    const warned: unknown[][] = []
    const realWarn = console.warn
    console.warn = (...line: unknown[]) => void warned.push(line)
    try {
      const refusing = deleting(storage, () => Promise.reject(new Error("storage is blocked")))

      await forgetUser(refusing)

      expect([...device.reads.keys()]).toEqual(["groups"])
      expect(kept.getItem(OWED)).toBe("[7]")
      expect(warned.map(([text]) => String(text))).toEqual([
        "The copies of user 7 kept on this device could not be deleted. The next start tries again.",
      ])

      // The next start, on a device that deletes again.
      await forgetUser(storage)

      expect([...device.reads.keys()]).toEqual([])
      expect(kept.getItem(OWED)).toBeNull()
    } finally {
      console.warn = realWarn
    }
  })

  it("does not open the layer of a person whose own owed copies the device could not delete", async () => {
    const { storage, device } = await deviceInUse()
    server()
    kept.setItem(OWED, "[7]")
    const realWarn = console.warn
    console.warn = () => {}
    try {
      startPage(7, deleting(storage, () => Promise.reject(new Error("storage is blocked"))))
      await settle()

      expect(currentLayer()).toBeNull()
      expect([...device.reads.keys()]).toEqual(["groups"])
      expect(kept.getItem(OWED)).toBe("[7]")
    } finally {
      console.warn = realWarn
    }
  })

  it("owes the deletion from sign-out until the device has deleted the copies", async () => {
    const { storage, device } = await deviceInUse()
    server()
    let finish!: () => void
    const held = new Promise<void>((resolve) => finish = resolve)
    startPage(7, deleting(storage, async (really) => (await held, await really())))
    await settle()

    try {
      forgetModules()
      await settle()
      expect(kept.getItem(OWED)).toBe("[7]")
    } finally {
      finish()
    }
    await settle()
    expect([...device.reads.keys()]).toEqual([])
    expect(kept.getItem(OWED)).toBeNull()
  })

  it("stops the running layer of the person whose copies it deletes", async () => {
    const { storage, device } = await deviceInUse()
    server()
    startPage(7, storage)
    await settle()

    await forgetDeviceCopy(7, storage)

    expect(currentLayer()).toBeNull()
    expect([...device.reads.keys()]).toEqual([])
    expect(await device.tags.readTags("g-1")).toEqual([])
  })

  it("deletes what the module kept for the remembered person once it is switched off", async () => {
    const { storage, device } = await deviceInUse()
    kept.setItem("offline:session", JSON.stringify(user(7)))
    visiblePage()
    configureModules({ realtime: false, offline: false })

    startModules(7, reads, { storage })
    await settle()

    expect([...device.reads.keys()]).toEqual([])
    expect(await device.notes.readNotes("g-1")).toEqual([])
    expect(kept.size).toBe(0)
  })

  it("opens no store on a device that holds no trace of the module while it is off", async () => {
    const storage = createMemoryStorage()
    const opened: number[] = []
    const watched: typeof storage = {
      ...storage,
      openReads: (userId) => (opened.push(userId), storage.openReads(userId)),
      openNotes: (userId) => (opened.push(userId), storage.openNotes(userId)),
    }
    visiblePage()
    configureModules({ realtime: false, offline: false })

    startModules(7, reads, { storage: watched })
    await forgetUser(watched)

    expect(opened).toEqual([])
    expect(kept.size).toBe(0)
  })
})

describe("a queue left on the device while the module is off", () => {
  /** A device database list holding the notes queue of user 7, recording what it deletes. */
  function holdingQueue() {
    const held = new Set(["offline:user:7:outbox"])
    const deleted: string[] = []
    return {
      deleted,
      databases: {
        list: () => Promise.resolve([...held]),
        delete: (name: string) => (held.delete(name), deleted.push(name), Promise.resolve()),
      },
    }
  }

  it("is sent once at the start, and the device then holds none", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry(QUEUED_BY_AN_EARLIER_VERSION)
    const { databases, deleted } = holdingQueue()
    const calls = server()
    visiblePage()
    configureModules({ realtime: false, offline: false })
    sessionState.value = { ...signedOut, user: user(7) }

    startModules(7, reads, { storage, databases })
    await settle()

    expect(calls.filter((call) => call.url.includes("note.update")).map((call) => call.key))
      .toEqual(["key-from-last-week"])
    expect(deleted).toEqual(["offline:user:7:outbox"])
    expect(currentLayer()).toBeNull()
    expect(toasts.list.value).toEqual([])
  })

  it("drops a write the server refused and says so in a warning that stays", async () => {
    const storage = createMemoryStorage()
    await storage.of(7).queue.putEntry({ ...QUEUED_BY_AN_EARLIER_VERSION, status: "conflict" })
    const { databases, deleted } = holdingQueue()
    server()
    visiblePage()
    configureModules({ realtime: false, offline: false })
    sessionState.value = { ...signedOut, user: user(7) }

    startModules(7, reads, { storage, databases })
    await settle()

    expect(deleted).toEqual(["offline:user:7:outbox"])
    expect(toasts.list.value.map((toast) => [toast.type, toast.body, toast.duration])).toEqual([
      ["warning", `1 change you made offline couldn't be saved: "Written offline".`, 0],
    ])
  })
})

describe("two people on one device", () => {
  async function used(storage: ReturnType<typeof createMemoryStorage>, id: number) {
    const device = storage.of(id)
    device.reads.set("groups", { value: [{ id: `g-of-${id}` }], savedAt: 1 })
    await device.notes.putNote(note(`n-of-${id}`))
    await device.queue.putEntry({ ...QUEUED_BY_AN_EARLIER_VERSION, status: "conflict" })
    return device
  }

  /** `storage` on which one part of `who`'s copies cannot be deleted. */
  function failingFor(
    storage: ReturnType<typeof createMemoryStorage>,
    who: number,
    part: "reads" | "notes",
  ): typeof storage {
    return {
      ...storage,
      openReads(id) {
        const reads = storage.openReads(id)
        return id === who && part === "reads"
          ? { ...reads, clear: () => Promise.reject(new Error("blocked")) }
          : reads
      },
      openNotes(id) {
        const notes = storage.openNotes(id)
        return id === who && part === "notes"
          ? { ...notes, clear: () => Promise.reject(new Error("blocked")) }
          : notes
      },
    }
  }

  /** Runs `run` and gives back the warnings it logged. */
  async function warnings(run: () => Promise<void>): Promise<string[]> {
    const warned: string[] = []
    const real = console.warn
    console.warn = (text: unknown) => void warned.push(String(text))
    try {
      await run()
    } finally {
      console.warn = real
    }
    return warned
  }

  it("deletes the first person's owed copies and queue before the second person's layer opens, and keeps the second person's copies and queue", async () => {
    const storage = createMemoryStorage()
    const first = await used(storage, 7)
    const second = await used(storage, 8)
    server()
    kept.setItem(OWED, "[7]")

    startPage(8, storage)
    expect(currentLayer()).toBeNull()
    await settle()

    expect([...first.reads.keys()]).toEqual([])
    expect(await first.notes.readNotes("g-1")).toEqual([])
    expect(await first.queue.readOutbox()).toEqual([])
    expect([...second.reads.keys()]).toEqual(["groups"])
    expect((await second.queue.readOutbox()).length).toBe(1)
    expect(kept.getItem(OWED)).toBeNull()
    expect(currentLayer()?.userId).toBe(8)
  })

  it("keeps owing the person whose deletion failed when another person's succeeded", async () => {
    const storage = createMemoryStorage()
    const first = await used(storage, 7)
    const third = await used(storage, 9)
    configureModules({ realtime: false, offline: true })
    kept.setItem(OWED, "[7,9]")

    await warnings(() => forgetUser(failingFor(storage, 7, "reads")))

    expect([...third.reads.keys()]).toEqual([])
    expect([...first.reads.keys()]).toEqual(["groups"])
    expect(kept.getItem(OWED)).toBe("[7]")
  })

  it("keeps the deletion owed when only the notes copy could not be deleted", async () => {
    const storage = createMemoryStorage()
    const first = await used(storage, 7)
    configureModules({ realtime: false, offline: true })
    rememberUser(user(7))

    await warnings(() => forgetUser(failingFor(storage, 7, "notes")))

    expect((await first.notes.readNotes("g-1")).length).toBe(1)
    expect(kept.getItem(OWED)).toBe("[7]")
  })

  it("opens no layer for a person who signed out while an owed deletion was still running", async () => {
    const storage = createMemoryStorage()
    await used(storage, 7)
    server()
    kept.setItem(OWED, "[7]")

    startPage(8, storage)
    forgetModules()
    sessionState.value = signedOut
    await settle()

    expect(currentLayer()).toBeNull()
  })

  it("warns once on sign-out when the device refuses to delete a person's copies", async () => {
    const storage = createMemoryStorage()
    await used(storage, 7)
    server()
    let tried = 0
    const refusing: typeof storage = {
      ...storage,
      openReads(id) {
        const reads = storage.openReads(id)
        return { ...reads, clear: () => (tried++, Promise.reject(new Error("blocked"))) }
      },
    }
    startPage(7, refusing)
    rememberUser(user(7))
    await settle()

    // Signing out as the app does it: the session's own reaction first, then the modules'.
    const warned = await warnings(async () => {
      void forgetUser(refusing)
      forgetModules()
      await settle()
    })

    // The layer clears its own copy and the owed deletion clears the stored one: one report.
    expect(tried).toBe(2)
    expect(warned.length).toBe(1)
    expect(kept.getItem(OWED)).toBe("[7]")
  })
})
