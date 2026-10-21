import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { LocalReads } from "@spy4x/realtime/read-cache"
import { NOTE_WIDGETS } from "@domain/notes"
import { createOverviewStore } from "./overview.ts"

const [total, added] = NOTE_WIDGETS
const october = {
  groupId: "g-1",
  range: { from: "2026-10-01", to: "2026-10-21" },
  timeZone: "Europe/Berlin",
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Lets every answer that is already settled reach the store. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("overview store", () => {
  it("asks each widget's operation for the group, the days and the zone", async () => {
    const asked: [string, unknown][] = []
    const store = createOverviewStore({
      query: (name, payload) => {
        asked.push([name, payload])
        return Promise.resolve({ current: 1, previous: null } as never)
      },
    })

    store.open(october, [total, added])
    await settle()

    expect(asked).toEqual([
      ["note.widget.total", {
        groupId: "g-1",
        from: "2026-10-01",
        to: "2026-10-21",
        timeZone: "Europe/Berlin",
      }],
      ["note.widget.added", {
        groupId: "g-1",
        from: "2026-10-01",
        to: "2026-10-21",
        timeZone: "Europe/Berlin",
      }],
    ])
    expect(store.loads.value[total.id]).toEqual({
      status: "ready",
      data: { current: 1, previous: null },
      savedAt: null,
    })
  })

  it("shows one widget's failure without holding the other back, and reads it again on retry", async () => {
    let fail = true
    const store = createOverviewStore({
      query: (name) =>
        name === added.operation && fail
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ current: 2, previous: 1 } as never),
    })

    store.open(october, [total, added])
    await settle()
    expect(store.loads.value[total.id].status).toBe("ready")
    expect(store.loads.value[added.id]).toEqual({ status: "error" })

    fail = false
    store.retry(added.id)
    expect(store.loads.value[added.id]).toEqual({ status: "loading" })
    await settle()
    expect(store.loads.value[added.id].status).toBe("ready")
  })

  it("drops an answer for a range the page has moved on from", async () => {
    const first = deferred<never>()
    let calls = 0
    const store = createOverviewStore({
      query: () =>
        ++calls === 1 ? first.promise : Promise.resolve({ current: 7, previous: 5 } as never),
    })

    store.open(october, [total])
    store.open({ ...october, range: { from: "2026-10-15", to: "2026-10-21" } }, [total])
    await settle()
    first.resolve({ current: 99, previous: 0 } as never)
    await settle()

    expect(store.loads.value[total.id]).toEqual({
      status: "ready",
      data: { current: 7, previous: 5 },
      savedAt: null,
    })
  })

  it("reads only a widget shown again when the request has not changed", async () => {
    const asked: string[] = []
    const store = createOverviewStore({
      query: (name) => {
        asked.push(name)
        return Promise.resolve({ current: 1, previous: 1 } as never)
      },
    })

    store.open(october, [total])
    await settle()
    store.open(october, [total, added])
    await settle()

    expect(asked).toEqual([total.operation, added.operation])
  })

  it("shows the device's copy with the time it was saved when the server cannot be reached", async () => {
    const keys: string[] = []
    const device: LocalReads = {
      through<T>(key: string) {
        keys.push(key)
        return Promise.resolve({
          value: { current: 4, previous: 3 } as T,
          fresh: false,
          savedAt: 1234,
        })
      },
      copy: () => Promise.resolve(undefined),
    }
    const store = createOverviewStore({ query: () => Promise.reject(new Error("offline")) }, device)

    store.open(october, [total])
    await settle()

    expect(store.loads.value[total.id]).toEqual({
      status: "ready",
      data: { current: 4, previous: 3 },
      savedAt: 1234,
    })
    expect(keys).toEqual(["overview:g-1:notes.total:2026-10-01:2026-10-21:Europe/Berlin"])
  })
})
