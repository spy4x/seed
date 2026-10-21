import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { ActivityRow } from "@ui/group-activity-panel.tsx"
import { type ActivityPageResult, createActivityStore } from "./activity.ts"

function row(id: number): ActivityRow {
  return {
    id: String(id),
    kind: "group.renamed",
    at: "2026-10-01T10:00:00.000Z",
    actor: { userId: 1, name: "Ada" },
    target: null,
    entity: null,
    details: {},
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe("activity store", () => {
  it("shows the first page, then adds the next one under it with its cursor", async () => {
    const asked: (string | null)[] = []
    const store = createActivityStore({
      list: ({ cursor }) => {
        asked.push(cursor)
        return Promise.resolve(
          cursor === null
            ? { events: [row(3), row(2)], nextCursor: "c1" }
            : { events: [row(2), row(1)], nextCursor: null },
        )
      },
    })
    await store.open("g")
    expect(store.events.value.map((event) => event.id)).toEqual(["3", "2"])
    expect(store.nextCursor.value).toBe("c1")

    await store.loadMore()
    // Event 2 came twice, because a page edge moved; it shows once.
    expect(store.events.value.map((event) => event.id)).toEqual(["3", "2", "1"])
    expect(store.nextCursor.value).toBeNull()
    expect(asked).toEqual([null, "c1"])

    await store.loadMore()
    expect(asked.length).toBe(2)
  })

  it("keeps the reopened first page when Load more is pressed before it returns", async () => {
    const reopened = deferred<ActivityPageResult>()
    const asked: (string | null)[] = []
    let calls = 0
    const store = createActivityStore({
      list: ({ cursor }) => {
        asked.push(cursor)
        return ++calls === 1
          ? Promise.resolve({ events: [row(2)], nextCursor: "c1" })
          : reopened.promise
      },
    })
    await store.open("g")
    const again = store.open("g")
    await store.loadMore()
    reopened.resolve({ events: [row(5), row(4)], nextCursor: null })
    await again
    expect(asked).toEqual([null, null])
    expect(store.events.value.map((event) => event.id)).toEqual(["5", "4"])
    expect(store.loading.value).toBe(false)
  })

  it("keeps the events and shows the message when the next page fails", async () => {
    const store = createActivityStore({
      list: ({ cursor }) =>
        cursor === null
          ? Promise.resolve({ events: [row(2)], nextCursor: "c1" })
          : Promise.reject(new Error("The server is out of reach.")),
    })
    await store.open("g")
    await store.loadMore()
    expect(store.events.value.length).toBe(1)
    expect(store.error.value).toBe("The server is out of reach.")
    expect(store.nextCursor.value).toBe("c1")
    expect(store.loadingMore.value).toBe(false)
  })

  it("drops a page answered after the person opened another group", async () => {
    const slow = deferred<ActivityPageResult>()
    const store = createActivityStore({
      list: ({ groupId }) =>
        groupId === "a" ? slow.promise : Promise.resolve({ events: [row(9)], nextCursor: null }),
    })
    const first = store.open("a")
    await store.open("b")
    slow.resolve({ events: [row(1)], nextCursor: null })
    await first
    expect(store.groupId.value).toBe("b")
    expect(store.events.value.map((event) => event.id)).toEqual(["9"])
    expect(store.loading.value).toBe(false)
  })

  it("says why a refused read failed and shows no events", async () => {
    const store = createActivityStore({
      list: () => Promise.reject(new Error("Group role is insufficient")),
    })
    await store.open("g")
    expect(store.error.value).toBe("Group role is insufficient")
    expect(store.events.value).toEqual([])
  })
})
