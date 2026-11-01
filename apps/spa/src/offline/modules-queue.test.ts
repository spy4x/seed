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
import { createMemoryStorage } from "./memory-storage.ts"
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
      const wait = watchUnsentChanges()!
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
