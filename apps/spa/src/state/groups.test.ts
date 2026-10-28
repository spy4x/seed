import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { ReadCache } from "@spy4x/realtime/read-cache"
import { type GroupDetails, GroupRole } from "@domain/groups"
import {
  createGroupsStore,
  type DeletedGroupItem,
  EMPTY_GROUP_DRAFT,
  type GroupItem,
  type GroupPage,
  type GroupsDependencies,
  groupsOnDevice,
  type ReadChannel,
} from "./groups.ts"
import { createMemoryReadCache } from "@spy4x/realtime/testing"
import { memoryReads } from "./memory-reads.ts"
import { createLocalReads, noLocalReads } from "../modules.ts"

function item(id: string, sequence: string, name = id): GroupItem {
  return {
    id,
    name,
    role: GroupRole.OWNER,
    authorizationRevision: "1",
    changeSequence: sequence,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function deleted(id: string, name = id): DeletedGroupItem {
  return { ...item(id, "9", name), deletedAt: "2026-10-01T00:00:00.000Z" }
}

/** What a test of one change does not exercise: no deleted groups, and no other change. */
const UNUSED = {
  fetchDeleted: () => Promise.resolve({ groups: [] }),
  rename: () => Promise.reject(new Error("unused")),
  updateDetails: () => Promise.reject(new Error("unused")),
  remove: () => Promise.reject(new Error("unused")),
  restore: () => Promise.reject(new Error("unused")),
  moveAll: () => Promise.reject(new Error("unused")),
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function harness(
  overrides: {
    pages?: GroupPage[]
    create?: () => Promise<{ group: GroupItem }>
    read?: () => Promise<GroupPage>
    fetchDeleted?: () => Promise<{ groups: DeletedGroupItem[] }>
    rename?: (input: { groupId: string; name: string }) => Promise<{ group: GroupItem }>
    updateDetails?: (
      input: { groupId: string } & GroupDetails,
    ) => Promise<{ group: GroupItem }>
    remove?: (input: { groupId: string }) => Promise<{ group: DeletedGroupItem }>
    restore?: (input: { groupId: string }) => Promise<{ group: GroupItem }>
    moveAll?: (
      input: { groupId: string; toGroupId: string },
    ) => Promise<{ moved: number; counts: Record<string, number> }>
  },
) {
  const pages = [...(overrides.pages ?? [{ groups: [], nextCursor: null }])]
  const reads: { cursor: string | null; via: ReadChannel }[] = []
  const advanced: [string, number][] = []
  const created: ({ id: string; name: string } & GroupDetails)[] = []
  const store = createGroupsStore({
    ...UNUSED,
    ...(overrides.fetchDeleted && { fetchDeleted: overrides.fetchDeleted }),
    ...(overrides.rename && { rename: overrides.rename }),
    ...(overrides.updateDetails && { updateDetails: overrides.updateDetails }),
    ...(overrides.remove && { remove: overrides.remove }),
    ...(overrides.restore && { restore: overrides.restore }),
    ...(overrides.moveAll && { moveAll: overrides.moveAll }),
    fetchPage(cursor, via) {
      reads.push({ cursor, via })
      if (overrides.read) return overrides.read()
      return Promise.resolve(pages.shift() ?? { groups: [], nextCursor: null })
    },
    create(input) {
      created.push(input)
      return overrides.create?.() ?? Promise.resolve({ group: item(input.id, "1", input.name) })
    },
    advance: (groupId, sequence) => advanced.push([groupId, sequence]),
    newId: () => "new-id",
  })
  return { store, reads, advanced, created }
}

describe("groups store", () => {
  it("keeps the reason a read failed until a read succeeds, apart from the create form's error", async () => {
    let fail = true
    const { store } = harness({
      read: () =>
        fail
          ? Promise.reject(new RealtimeRequestError("timeout", "network down"))
          : Promise.resolve({ groups: [item("a", "1")], nextCursor: null }),
    })

    await store.refresh().catch(() => {})
    expect(store.loadError.value).toBe("network down")
    expect(store.error.value).toBeNull()

    fail = false
    await store.refresh()
    expect(store.loadError.value).toBeNull()
  })

  it("reads every page and moves the cursor of each group to its change sequence", async () => {
    const { store, reads, advanced } = harness({
      pages: [
        { groups: [item("a", "3")], nextCursor: "c1" },
        { groups: [item("b", "7")], nextCursor: null },
      ],
    })

    await store.refresh()

    expect(store.groups.value.map((group) => group.id)).toEqual(["a", "b"])
    expect(reads).toEqual([{ cursor: null, via: "rest" }, { cursor: "c1", via: "rest" }])
    expect(advanced).toEqual([["a", 3], ["b", 7]])
  })

  it("reads once more after a running read, and lets calls made meanwhile share that read", async () => {
    const { store, reads } = harness({})

    await Promise.all([store.refresh(), store.refresh(), store.refresh()])

    expect(reads).toHaveLength(2)
  })

  it("shows a group added while a read was running", async () => {
    const stale = deferred<GroupPage>()
    const served = [
      stale.promise,
      Promise.resolve({ groups: [item("a", "1"), item("new", "1")], nextCursor: null }),
    ]
    const store = createGroupsStore({
      ...UNUSED,
      fetchPage: () => served.shift() ?? Promise.resolve({ groups: [], nextCursor: null }),
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "x",
    })

    const first = store.refresh()
    // The change lands after the first read started; its hint asks for another read.
    const hinted = store.refresh()
    stale.resolve({ groups: [item("a", "1")], nextCursor: null })
    await Promise.all([first, hinted])

    expect(store.groups.value.map((group) => group.id)).toEqual(["a", "new"])
  })

  it("replaces the list with the server's answer, dropping a group it no longer lists", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }, {
        groups: [item("a", "2")],
        nextCursor: null,
      }],
    })

    await store.refresh()
    await store.refresh()

    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
  })

  it("reads over the socket for the refresh button and shows a failure under the form", async () => {
    const { store, reads } = harness({})
    await store.refreshFromUser()
    expect(reads).toEqual([{ cursor: null, via: "socket" }])

    const failing = createGroupsStore({
      ...UNUSED,
      fetchPage: () => Promise.reject(new RealtimeRequestError("unauthorized", "Session ended")),
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "x",
    })
    await failing.refreshFromUser()
    expect(failing.error.value).toBe("Session ended")
    expect(failing.loading.value).toBe(false)
  })

  it("creates a group with every field of the form in one request, puts it first and empties the form", async () => {
    const { store, created, advanced } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
    })
    await store.refresh()
    store.edit(null, { name: "  Trip  ", description: " Hikes ", color: "#15803d", emoji: "🏕️" })

    const group = await store.create()

    expect(created).toEqual([
      { id: "new-id", name: "Trip", description: "Hikes", color: "#15803d", emoji: "🏕️" },
    ])
    expect(group?.id).toBe("new-id")
    expect(store.groups.value.map((group) => group.id)).toEqual(["new-id", "a"])
    expect(advanced.at(-1)).toEqual(["new-id", 1])
    expect(store.draft(null)).toEqual(EMPTY_GROUP_DRAFT)
    expect(store.unsaved(null)).toBe(false)
    expect(store.creating.value).toBe(false)
  })

  it("keeps the form and shows the server's message under it when a create is refused", async () => {
    const { store } = harness({
      create: () => Promise.reject(new RealtimeRequestError("forbidden", "Group id is in use")),
    })
    store.edit(null, { ...EMPTY_GROUP_DRAFT, name: "Trip" })

    expect(await store.create()).toBeNull()

    expect(store.editorErrors.value).toEqual({ form: "Group id is in use" })
    expect(store.draft(null).name).toBe("Trip")
    expect(store.groups.value).toEqual([])
  })

  it("says a create needs a connection when the server was not reached", async () => {
    const { store } = harness({ create: () => Promise.reject(new TypeError("fetch failed")) })
    store.edit(null, { ...EMPTY_GROUP_DRAFT, name: "Trip" })

    await store.create()

    expect(store.editorErrors.value.form).toBe(
      "Creating a group needs a connection. Try again when you are back online.",
    )
  })

  it("tells each wrong field before sending, and sends nothing", async () => {
    const { store, created } = harness({})
    store.edit(null, { name: "  ", description: "x".repeat(501), color: null, emoji: "ab" })

    expect(await store.create()).toBeNull()

    expect(created).toEqual([])
    expect(store.editorErrors.value).toEqual({
      name: "Enter a name.",
      description: "Use at most 500 characters.",
      emoji: "Use a single emoji, such as 🏕️, or leave it empty.",
    })
  })

  it("ignores a create while one is already running", async () => {
    const { store, created } = harness({})
    store.edit(null, { ...EMPTY_GROUP_DRAFT, name: "Trip" })
    const first = store.create()
    await store.create()
    await first

    expect(created).toHaveLength(1)
  })

  it("shows a group as saved until something is typed, and counts only real changes as unsaved", async () => {
    const saved = { ...item("a", "1", "Home"), description: "Flat", color: "#1d4ed8" as const }
    const { store } = harness({ pages: [{ groups: [saved], nextCursor: null }] })
    await store.refresh()

    expect(store.draft("a")).toEqual({
      name: "Home",
      description: "Flat",
      color: "#1d4ed8",
      emoji: "",
    })
    store.edit("a", { ...store.draft("a"), name: "Home  ", emoji: " " })
    expect(store.unsaved("a")).toBe(false)
    store.edit("a", { ...store.draft("a"), color: "#b91c1c" })
    expect(store.unsaved("a")).toBe(true)
    expect(store.unsaved(null)).toBe(false)

    store.discard()

    expect(store.draft("a").color).toBe("#1d4ed8")
    expect(store.unsaved("a")).toBe(false)
  })

  it("drops what was typed for another group when an editor opens", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }],
    })
    await store.refresh()
    store.edit("a", { ...store.draft("a"), name: "Typed" })

    store.openEditor("a")
    expect(store.draft("a").name).toBe("Typed")
    store.openEditor("b")
    expect(store.draft("a").name).toBe("a")
  })

  it("saves only the name when only the name changed, and keeps the row's members", async () => {
    const renamed: unknown[] = []
    const listed = { ...item("a", "1", "Old"), memberCount: 3, members: [{ name: "Ann" }] }
    const { store } = harness({
      pages: [{ groups: [listed, item("b", "1")], nextCursor: null }],
      rename: (input) => {
        renamed.push(input)
        return Promise.resolve({ group: item(input.groupId, "2", input.name) })
      },
    })
    await store.refresh()
    store.edit("a", { ...store.draft("a"), name: "  New  " })

    expect(await store.save("a")).toBe(true)

    expect(renamed).toEqual([{ groupId: "a", name: "New" }])
    expect(store.groups.value[0]).toMatchObject({
      name: "New",
      changeSequence: "2",
      memberCount: 3,
    })
    expect(store.unsaved("a")).toBe(false)
    expect(store.working.value).toBeNull()
  })

  it("saves only the details when only they changed, with an empty emoji as none", async () => {
    const sent: unknown[] = []
    const { store } = harness({
      pages: [{ groups: [{ ...item("a", "1"), emoji: "🏠" }], nextCursor: null }],
      updateDetails: (input) => {
        sent.push(input)
        return Promise.resolve({
          group: { ...item("a", "2"), description: "Flat", color: "#15803d" },
        })
      },
    })
    await store.refresh()
    store.edit("a", { name: "a", description: "Flat", color: "#15803d", emoji: "" })

    expect(await store.save("a")).toBe(true)

    expect(sent).toEqual([{ groupId: "a", description: "Flat", color: "#15803d", emoji: null }])
    expect(store.groups.value[0]).toMatchObject({ description: "Flat", color: "#15803d" })
  })

  it("keeps what was typed and shows the server's reason under the form when a save is refused", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1", "Old")], nextCursor: null }],
      rename: () => Promise.reject(new RealtimeRequestError("forbidden", "Only an admin can")),
    })
    await store.refresh()
    store.edit("a", { ...store.draft("a"), name: "New" })

    expect(await store.save("a")).toBe(false)

    expect(store.editorErrors.value).toEqual({ form: "Only an admin can" })
    expect(store.draft("a").name).toBe("New")
    expect(store.unsaved("a")).toBe(true)
  })

  it("does not send a save with a wrong field, or for a group the person does not have", async () => {
    let sent = 0
    const { store } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
      rename: () => {
        sent++
        return Promise.reject(new Error("unused"))
      },
    })
    await store.refresh()
    store.edit("a", { ...store.draft("a"), name: "   " })

    expect(await store.save("a")).toBe(false)
    expect(store.editorErrors.value.name).toBe("Enter a name.")
    store.edit("other", { ...store.draft("a"), name: "Other" })
    expect(await store.save("other")).toBe(false)

    expect(sent).toBe(0)
  })

  it("moves a deleted group from the list to the deleted groups", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1"), item("b", "1")], nextCursor: null }],
      remove: ({ groupId }) => Promise.resolve({ group: deleted(groupId) }),
    })
    await store.refresh()

    const done = await store.remove("b")

    expect(done).toBe(true)
    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])
  })

  it("keeps the group listed and shows the reason when its delete is refused", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
      remove: () =>
        Promise.reject(
          new RealtimeRequestError("forbidden", "A person must keep at least one group"),
        ),
    })
    await store.refresh()

    const done = await store.remove("a")

    expect(done).toBe(false)
    expect(store.groups.value.map((group) => group.id)).toEqual(["a"])
    expect(store.deleted.value).toEqual([])
    expect(store.actionError.value?.message).toBe("A person must keep at least one group")
  })

  it("moves all of a group's data and remembers how many notes and tags went", async () => {
    const sent: { groupId: string; toGroupId: string }[] = []
    const { store } = harness({
      moveAll: (input) => {
        sent.push(input)
        return Promise.resolve({ moved: 9, counts: { tags: 2, notes: 7 } })
      },
    })

    const worked = await store.moveAll("a", "b")

    expect(worked).toBe(true)
    expect(sent).toEqual([{ groupId: "a", toGroupId: "b" }])
    expect(store.moved.value).toEqual({ groupId: "a", toGroupId: "b", count: 7, tags: 2 })
    expect(store.working.value).toBeNull()
    store.forgetMoveAll()
    expect(store.moved.value).toBeNull()
  })

  it("shows why a move of all the data was refused, and forgets it when the dialog closes", async () => {
    const { store } = harness({
      moveAll: () =>
        Promise.reject(new RealtimeRequestError("forbidden", "This group has nothing to move.")),
    })

    const worked = await store.moveAll("a", "b")

    expect(worked).toBe(false)
    expect(store.moved.value).toBeNull()
    expect(store.actionError.value).toEqual({
      groupId: "a",
      action: "moveAll",
      message: "This group has nothing to move.",
    })
    store.forgetMoveAll()
    expect(store.actionError.value).toBeNull()
  })

  it("keeps the plan refusal of a move, so the dialog can show the upgrade notice", async () => {
    const refusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: true,
    }
    const { store } = harness({
      moveAll: () =>
        Promise.reject(
          new RealtimeRequestError("forbidden", "Free groups hold 10 notes.", refusal),
        ),
    })

    await store.moveAll("a", "b")

    expect(store.actionError.value).toEqual({
      groupId: "a",
      action: "moveAll",
      message: "Free groups hold 10 notes.",
      plan: refusal,
    })
  })

  it("moves a restored group from the deleted groups back to the list", async () => {
    const { store } = harness({
      pages: [{ groups: [item("a", "1")], nextCursor: null }],
      fetchDeleted: () => Promise.resolve({ groups: [deleted("b")] }),
      restore: ({ groupId }) => Promise.resolve({ group: item(groupId, "10") }),
    })
    await store.refresh()
    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])

    await store.restore("b")

    expect(store.deleted.value).toEqual([])
    expect(store.groups.value.map((group) => group.id)).toEqual(["b", "a"])
  })

  it("reads the deleted groups with every list read, and keeps them when that read fails", async () => {
    let fail = false
    const { store } = harness({
      fetchDeleted: () =>
        fail
          ? Promise.reject(new TypeError("offline"))
          : Promise.resolve({ groups: [deleted("b")] }),
    })

    await store.refresh()
    fail = true
    await store.refresh()

    expect(store.deleted.value.map((group) => group.id)).toEqual(["b"])
    expect(store.loadError.value).toBeNull()
  })

  it("runs one change at a time", async () => {
    const gate = deferred<{ group: DeletedGroupItem }>()
    let sent = 0
    const { store } = harness({
      remove: () => {
        sent++
        return sent === 1 ? gate.promise : Promise.resolve({ group: deleted("a") })
      },
    })

    const first = store.remove("a")
    const second = await store.remove("a")
    gate.resolve({ group: deleted("a") })
    await first

    expect(second).toBe(false)
    expect(sent).toBe(1)
  })

  it("is loading from the start until the first read answers", async () => {
    const answer = deferred<GroupPage>()
    const { store } = harness({ read: () => answer.promise })
    expect(store.loading.value).toBe(true)

    const read = store.refresh()
    expect(store.loading.value).toBe(true)

    answer.resolve({ groups: [item("a", "1")], nextCursor: null })
    await read
    expect(store.loading.value).toBe(false)
  })

  it("is loading again after a reset, for the next person's first read", async () => {
    const { store } = harness({ pages: [{ groups: [item("a", "1")], nextCursor: null }] })
    await store.refresh()
    expect(store.loading.value).toBe(false)

    store.reset()

    expect(store.loading.value).toBe(true)
  })

  it("forgets everything on reset", async () => {
    const { store } = harness({ pages: [{ groups: [item("a", "1")], nextCursor: null }] })
    await store.refresh()
    store.edit(null, { ...EMPTY_GROUP_DRAFT, name: "x" })

    store.reset()

    expect(store.groups.value).toEqual([])
    expect(store.draft(null)).toEqual(EMPTY_GROUP_DRAFT)
  })
})

describe("the groups list on the device", () => {
  /** A server with one page of groups that a test makes unreachable or refusing. */
  function server(groups: GroupItem[]) {
    const state = { failure: null as Error | null, reads: [] as ReadChannel[] }
    const online: GroupsDependencies = {
      ...UNUSED,
      fetchPage(_cursor, via) {
        state.reads.push(via)
        return state.failure
          ? Promise.reject(state.failure)
          : Promise.resolve({ groups, nextCursor: null })
      },
      create: () => Promise.reject(new Error("unused")),
      advance: () => {},
      newId: () => "id",
    }
    return { state, online }
  }

  it("answers the groups list from the device when the server is unreachable", async () => {
    const { state, online } = server([item("g-1", "1", "Team")])
    const deps = groupsOnDevice(online, memoryReads())
    await deps.fetchPage(null, "rest")
    state.failure = new TypeError("Failed to fetch")

    expect((await deps.fetchPage(null, "rest")).groups.map((g) => g.name)).toEqual(["Team"])
  })

  it("replaces the device's groups with every answer of the server", async () => {
    const groups = [item("g-1", "1", "Team")]
    const { state, online } = server(groups)
    const deps = groupsOnDevice(online, memoryReads())
    await deps.fetchPage(null, "rest")
    groups.splice(0, 1, item("g-2", "1", "Family"))
    await deps.fetchPage(null, "rest")
    state.failure = new TypeError("Failed to fetch")

    expect((await deps.fetchPage(null, "rest")).groups.map((g) => g.name)).toEqual(["Family"])
  })

  it("does not answer from the device when the server refuses the read", async () => {
    const { state, online } = server([item("g-1", "1")])
    const deps = groupsOnDevice(online, memoryReads())
    await deps.fetchPage(null, "rest")
    state.failure = new Error("Forbidden")

    await expect(deps.fetchPage(null, "rest")).rejects.toThrow("Forbidden")
  })

  it("does not paint a copy the device hands over only after the server refused the read", async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => release = resolve)
    const cache = createMemoryReadCache()
    await cache.set("members:g-1", ["Ann"])
    const slow: ReadCache = { ...cache, get: async (key) => (await held, await cache.get(key)) }
    const painted: unknown[] = []

    await createLocalReads(() => slow).through(
      "members:g-1",
      () => Promise.reject(new Error("forbidden")),
      (copy) => void painted.push(copy?.value),
    ).catch(() => {})
    release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(painted).toStrictEqual([])
  })

  it("shows the device's groups before the server has answered", async () => {
    const { online } = server([item("g-1", "1", "Team")])
    const reads = memoryReads()
    await groupsOnDevice(online, reads).fetchPage(null, "rest")
    const slow = deferred<GroupPage>()
    const store = createGroupsStore(
      groupsOnDevice({ ...online, fetchPage: () => slow.promise }, reads),
    )

    const reading = store.refresh()
    await new Promise((resolve) => setTimeout(resolve, 0))
    // The whole saved row, not only its name: a paint that keeps the name but not the rest is wrong.
    expect(store.groups.value).toStrictEqual([item("g-1", "1", "Team")])

    slow.resolve({ groups: [item("g-1", "2", "Renamed")], nextCursor: null })
    await reading
    expect(store.groups.value).toStrictEqual([item("g-1", "2", "Renamed")])
  })

  it("keeps nothing on a device whose local-data module is off", async () => {
    const { state, online } = server([item("g-1", "1")])
    const deps = groupsOnDevice(online, noLocalReads)
    await deps.fetchPage(null, "rest")
    state.failure = new TypeError("Failed to fetch")

    await expect(deps.fetchPage(null, "rest")).rejects.toThrow("Failed to fetch")
    expect(await deps.readLocal?.()).toEqual([])
  })
})
