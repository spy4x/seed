import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import { installLocalStorage } from "@spy4x/platform/browser/testing"
import {
  configureModules,
  currentLayer,
  startModules,
  stopChanges,
  watchUnsentChanges,
} from "../modules.ts"
import { sessionState, type SessionUser } from "../state/session.ts"
import { stopOffline } from "./index.ts"
import { createMemoryStorage, type MemoryDevice } from "./memory-storage.ts"
import type { NoteEntry } from "./notes-cache.ts"

/**
 * What the composition root (`modules.ts`) does with the queue of writes on behalf of the signed-in
 * user. The tests live in this folder because only `modules.ts` may import it from outside
 * (`tests/offline-removal.test.ts`), and they go with the folder when a product removes it.
 */

const realFetch = globalThis.fetch
const globals = globalThis as { document?: unknown }
const signedOut = sessionState.value
const user = (id: number) => ({ id }) as SessionUser

/** The page as the sync runner reads it: visible. */
function visiblePage() {
  globals.document = {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
  }
}

/** Waits for `done`, one macrotask at a time; fails rather than wait for ever. */
async function until(done: () => boolean): Promise<void> {
  for (let turns = 0; !done(); turns++) {
    if (turns > 200) throw new Error("the condition never held")
    await pause(0)
  }
}

/** Lets `ms` pass, timers included. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let restoreLocalStorage = () => {}
beforeEach(() => {
  restoreLocalStorage = installLocalStorage().restore
})

afterEach(() => {
  restoreLocalStorage()
  stopChanges()
  configureModules({})
  sessionState.value = signedOut
  globalThis.fetch = realFetch
  delete globals.document
})

describe("the queue of writes", () => {
  /** A device holding one queued edit of user 7's note `n-1`. */
  async function deviceWithQueue() {
    const storage = createMemoryStorage()
    const entry: NoteEntry = {
      key: "key-n-1",
      entityId: "n-1",
      kind: "update",
      payload: { groupId: "g-1", title: "Plan", body: "" },
      baseVersion: 1,
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    }
    await storage.of(7).queue.putEntry(entry)
    return storage
  }

  it("left on a device with the local data off, is sent only once its user is signed in", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const storage = await deviceWithQueue()
    const held = new Set(["offline:user:7:outbox"])
    const deleted: string[] = []
    let listed = 0
    let opened = 0
    const urls: string[] = []
    globalThis.fetch = ((url: string) => {
      urls.push(url)
      const note = { id: "n-1", groupId: "g-1", title: "Plan", body: "", tagIds: [], version: 2 }
      return Promise.resolve(Response.json({ result: { note } }))
    }) as unknown as typeof fetch
    // The cookie now belongs to user 8, while the page still starts for user 7.
    sessionState.value = { ...signedOut, user: user(8) }

    startModules(7, { pull: () => {}, check: () => Promise.resolve() }, {
      storage: {
        ...storage,
        openQueue: (id) => (opened++, storage.openQueue!(id)),
        openTagsQueue: (id) => (opened++, storage.openTagsQueue!(id)),
      },
      databases: {
        list: () => (listed++, Promise.resolve([...held])),
        delete(name) {
          held.delete(name)
          deleted.push(name)
          return Promise.resolve()
        },
      },
    })
    await until(() => listed === 1)
    // The try reads the transport right after the list; a macrotask later it has given up or sent.
    await pause(0)
    const asOther = { opened, urls: [...urls], deleted: [...deleted] }
    sessionState.value = { ...signedOut, user: user(7) }
    dispatchEvent(new Event("online"))
    await until(() => deleted.length === 1)

    expect(asOther).toEqual({ opened: 0, urls: [], deleted: [] })
    expect(urls).toEqual(["/api/call/note.update"])
  })

  it("makes the sign-out dialog say it cannot send while the page is not signed in as its user", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const storage = await deviceWithQueue()
    // Nothing reaches the server; the queue stays as it is.
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    sessionState.value = { ...signedOut, user: user(8) }
    try {
      startModules(7, { pull: () => {}, check: () => Promise.resolve() }, { storage })
      await until(() => currentLayer()?.entries.value.length === 1)
      const wait = (await watchUnsentChanges())!
      wait.send()
      const asOther = wait.view.value.state
      sessionState.value = { ...signedOut, user: user(7) }
      const asOwner = wait.view.value.state
      wait.dispose()

      expect([asOther, asOwner]).toEqual(["offline", "sending"])
    } finally {
      await stopOffline()
    }
  })
})

describe("the sign-out question", () => {
  const reads = { pull: () => {}, check: () => Promise.resolve() }

  /**
   * A device holding one queued edit of `userId`'s note `n-1`. Each test has its own user: a send
   * that never ends holds that user's queue lock for the rest of the file.
   */
  async function deviceWithQueue(userId: number) {
    const storage = createMemoryStorage()
    await storage.of(userId).queue.putEntry({
      key: "key-n-1",
      entityId: "n-1",
      kind: "update",
      payload: { groupId: "g-1", title: "Plan", body: "" },
      baseVersion: 1,
      attempted: false,
      status: "pending",
      queuedAt: "2026-10-01T08:00:00.000Z",
    })
    return storage
  }

  it("asks right after start, before the layer has read the queue", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const storage = await deviceWithQueue(9)
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    sessionState.value = { ...signedOut, user: user(9) }
    try {
      startModules(9, reads, { storage, databases: storage.databases })
      const readYet = currentLayer()?.entries.value.length
      const wait = await watchUnsentChanges()
      const unsent = wait?.view.value.unsent
      wait?.dispose()

      expect([readYet, unsent]).toEqual([0, 1])
    } finally {
      await stopOffline()
    }
  })

  it("asks when the device refused to delete the person's owed copies, so no layer opened", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const storage = await deviceWithQueue(10)
    const refused = () => Promise.reject(new Error("storage is blocked"))
    const refusing: typeof storage = {
      ...storage,
      openReads: (userId) => ({ ...storage.openReads(userId), clear: refused }),
      databases: { list: storage.databases.list, delete: refused },
    }
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    localStorage.setItem("offline:owed-deletion", "[10]")
    sessionState.value = { ...signedOut, user: user(10) }
    const realWarn = console.warn
    console.warn = () => {}
    try {
      startModules(10, reads, { storage: refusing, databases: refusing.databases })
      await pause(0)
      const layer = currentLayer()
      const wait = await watchUnsentChanges()
      const view = wait?.view.value
      wait?.dispose()

      expect(layer).toBeNull()
      expect(view).toMatchObject({ unsent: 1, conflicts: 0, state: "ask" })
    } finally {
      console.warn = realWarn
    }
  })

  type QueueEntries = Awaited<ReturnType<MemoryDevice["queue"]["readOutbox"]>>

  /**
   * `storage` whose first queue store, the one the layer opens, never answers its first read until
   * `release` gives it the entries to return. Every later store reads the device at once.
   */
  function stallingFirstRead(storage: Awaited<ReturnType<typeof deviceWithQueue>>) {
    let release: (entries?: unknown[]) => void = () => {}
    const gate = new Promise<unknown[] | undefined>((resolve) => release = resolve)
    let opened = 0
    const openQueue = (userId: number) => {
      const store = storage.of(userId).queue
      if (opened++ > 0) return store
      let first = true
      return {
        ...store,
        readOutbox() {
          if (!first) return store.readOutbox()
          first = false
          return gate.then((entries) => (entries as QueueEntries | undefined) ?? store.readOutbox())
        },
      }
    }
    return { storage: { ...storage, openQueue }, release }
  }

  it("answers within the deadline with the device's count when the layer's queue read stalls", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const device = await deviceWithQueue(12)
    const { storage, release } = stallingFirstRead(device)
    let answer: () => void = () => {}
    const answered = new Promise<void>((resolve) => answer = resolve)
    globalThis.fetch = (async () => {
      await answered
      const note = { id: "n-1", groupId: "g-1", title: "Plan", body: "", tagIds: [], version: 2 }
      return Response.json({ result: { note } })
    }) as unknown as typeof fetch
    sessionState.value = { ...signedOut, user: user(12) }
    try {
      startModules(12, reads, { storage, databases: device.databases, queueReadDeadlineMs: 20 })
      let layerRead = false
      void currentLayer()!.loaded.then(() => layerRead = true)
      const wait = (await watchUnsentChanges())!
      const asked = { layerRead, unsent: wait.view.value.unsent }
      // Once the layer has read the queue, the dialog follows the layer: its send empties it.
      release()
      answer()
      await until(() => wait.view.value.unsent === 0)
      wait.dispose()

      expect(asked).toEqual({ layerRead: false, unsent: 1 })
    } finally {
      release()
      answer()
      await stopOffline()
    }
  })

  it("shows nothing when the session ends while the layer reads the queue", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const device = await deviceWithQueue(15)
    const { storage, release } = stallingFirstRead(device)
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    sessionState.value = { ...signedOut, user: user(15) }
    try {
      startModules(15, reads, { storage, databases: device.databases, queueReadDeadlineMs: 5_000 })
      const asking = watchUnsentChanges()
      await pause(0)
      stopChanges()
      release()
      const wait = await asking
      wait?.dispose()

      expect(wait).toBeNull()
    } finally {
      release()
      await stopOffline()
    }
  })

  it("does not ask about the person's own queue an earlier sign-out still owed a deletion of", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const storage = await deviceWithQueue(13)
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch
    localStorage.setItem("offline:owed-deletion", "[13]")
    sessionState.value = { ...signedOut, user: user(13) }
    try {
      startModules(13, reads, { storage, databases: storage.databases })
      const wait = await watchUnsentChanges()
      wait?.dispose()
      const left = await storage.of(13).queue.readOutbox()

      expect({ asked: wait !== null, left: left.length }).toEqual({ asked: false, left: 0 })
    } finally {
      await stopOffline()
    }
  })

  it("sends a queued write once when the layer opens after Send started without it", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: true })
    const storage = await deviceWithQueue(14)
    let deletable: () => void = () => {}
    const deletions = new Promise<void>((resolve) => deletable = resolve)
    const databases = {
      list: storage.databases.list,
      delete: (name: string) => deletions.then(() => storage.databases.delete(name)),
    }
    let answer: () => void = () => {}
    const answered = new Promise<void>((resolve) => answer = resolve)
    const urls: string[] = []
    globalThis.fetch = (async (url: string) => {
      urls.push(url)
      await answered
      const note = { id: "n-1", groupId: "g-1", title: "Plan", body: "", tagIds: [], version: 2 }
      return Response.json({ result: { note } })
    }) as unknown as typeof fetch
    // The session ended on the server and kept the queue; a sign-out cut short still owes the rest.
    localStorage.setItem("offline:kept-queue", "14")
    localStorage.setItem("offline:owed-deletion", "[14]")
    sessionState.value = { ...signedOut, user: user(14) }
    try {
      startModules(14, reads, { storage, databases, queueReadDeadlineMs: 20 })
      const wait = (await watchUnsentChanges())!
      const layerAtSend = currentLayer()
      wait.send()
      await until(() => urls.length === 1)
      deletable()
      await until(() => currentLayer() !== null)
      // The layer reads the queue under the same lock the send holds until the server answers.
      answer()
      await currentLayer()!.loaded
      await until(() => wait.view.value.unsent === 0)
      await until(() => currentLayer()!.entries.value.length === 0)
      await pause(20)
      wait.dispose()

      expect(layerAtSend).toBeNull()
      expect(urls).toEqual(["/api/call/note.update"])
    } finally {
      deletable()
      answer()
      await stopOffline()
    }
  })

  it("with the local data off, asks about the queue left on the device and sends it on Send", async () => {
    visiblePage()
    configureModules({ realtime: false, offline: false })
    const storage = await deviceWithQueue(11)
    const urls: string[] = []
    globalThis.fetch = ((url: string) => {
      urls.push(url)
      const note = { id: "n-1", groupId: "g-1", title: "Plan", body: "", tagIds: [], version: 2 }
      return Promise.resolve(Response.json({ result: { note } }))
    }) as unknown as typeof fetch
    // Another person's cookie: the queue cannot go out at start, so it is still there when asked.
    sessionState.value = { ...signedOut, user: user(8) }
    startModules(11, reads, { storage, databases: storage.databases })
    await pause(0)
    const wait = (await watchUnsentChanges())!
    const asked = wait.view.value.unsent
    sessionState.value = { ...signedOut, user: user(11) }
    wait.send()
    await until(() => wait.view.value.unsent === 0)
    wait.dispose()

    expect(asked).toBe(1)
    expect(urls).toEqual(["/api/call/note.update"])
  })
})
