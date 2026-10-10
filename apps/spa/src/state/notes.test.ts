import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import {
  createNotesStore,
  NOTE_MESSAGES,
  type NoteItem,
  type NotePage,
  restoreWhileReachable,
} from "./notes.ts"

const groupId = "g-1"

function item(id: string, version = 1, title = id): NoteItem {
  return {
    id,
    groupId,
    title,
    body: "",
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function conflict(currentVersion: number) {
  return new RealtimeRequestError("conflict", "The note was changed by someone else", {
    code: "VERSION_CONFLICT",
    currentVersion,
  })
}

function notFound() {
  return new RealtimeRequestError("not_found", "Note not found", { code: "NOTE_NOT_FOUND" })
}

function harness(overrides: {
  pages?: NotePage[]
  update?: () => Promise<{ note: NoteItem }>
  delete?: () => Promise<unknown>
  get?: () => Promise<{ note: NoteItem }>
  locate?: (id: string) => Promise<{ groupId: string }>
  create?: () => Promise<{ note: NoteItem }>
  move?: () => Promise<{ notes: NoteItem[] }>
  restore?: () => Promise<{ note: NoteItem }>
  deletedPages?: NotePage[]
} = {}) {
  const pages = [...(overrides.pages ?? [])]
  const deletedPages = [...(overrides.deletedPages ?? [])]
  const reads: { groupId: string; cursor: string | null }[] = []
  const deletedReads: string[] = []
  const calls: { name: string; input: unknown }[] = []
  let ids = 0
  const store = createNotesStore({
    fetchPage(forGroup, cursor, deleted) {
      if (deleted) {
        deletedReads.push(forGroup)
        return Promise.resolve(deletedPages.shift() ?? { notes: [], nextCursor: null })
      }
      reads.push({ groupId: forGroup, cursor })
      return Promise.resolve(pages.shift() ?? { notes: [], nextCursor: null })
    },
    get(forGroup, id) {
      calls.push({ name: "get", input: { groupId: forGroup, id } })
      return overrides.get?.() ?? Promise.resolve({ note: item(id) })
    },
    locate(id) {
      calls.push({ name: "locate", input: { id } })
      return overrides.locate?.(id) ?? Promise.reject(notFound())
    },
    create(input) {
      calls.push({ name: "create", input })
      return overrides.create?.() ??
        Promise.resolve({ note: { ...item(input.id), title: input.title } })
    },
    update(input) {
      calls.push({ name: "update", input })
      return overrides.update?.() ??
        Promise.resolve({ note: { ...item(input.id, input.version + 1), title: input.title } })
    },
    delete(input) {
      calls.push({ name: "delete", input })
      return overrides.delete?.() ?? Promise.resolve({})
    },
    restore(input) {
      calls.push({ name: "restore", input })
      return overrides.restore?.() ?? Promise.resolve({ note: item(input.id, 3) })
    },
    move(input) {
      calls.push({ name: "move", input })
      return overrides.move?.() ?? Promise.resolve({ notes: [] })
    },
    newId: () => `new-${++ids}`,
  })
  return { store, reads, deletedReads, calls }
}

describe("notes store", () => {
  it("shows the notes the device holds while the read is still running", async () => {
    let answer: (page: NotePage) => void = () => {}
    const store = createNotesStore({
      fetchPage: () => new Promise<NotePage>((resolve) => (answer = resolve)),
      get: () => Promise.reject(new Error("unused")),
      create: () => Promise.reject(new Error("unused")),
      update: () => Promise.reject(new Error("unused")),
      delete: () => Promise.reject(new Error("unused")),
      restore: () => Promise.reject(new Error("unused")),
      move: () => Promise.reject(new Error("unused")),
      newId: () => "id",
      readLocal: () => Promise.resolve([item("cached")]),
    })

    const opening = store.open(groupId, null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.notes.value.map((note) => note.id)).toEqual(["cached"])
    expect(store.loading.value).toBe(true)

    answer({ notes: [item("fresh")], nextCursor: null })
    await opening
    expect(store.notes.value.map((note) => note.id)).toEqual(["fresh"])
  })

  it("reads every page of the group it opens", async () => {
    const { store, reads } = harness({
      pages: [
        { notes: [item("a")], nextCursor: "c1" },
        { notes: [item("b")], nextCursor: null },
      ],
    })

    await store.open(groupId, null)

    expect(store.notes.value.map((note) => note.id)).toEqual(["a", "b"])
    expect(reads).toEqual([{ groupId, cursor: null }, { groupId, cursor: "c1" }])
  })

  it("creates with the form's id and trimmed title, then starts a new draft with a new id", async () => {
    const { store, calls } = harness()
    await store.open(groupId, null)
    const firstId = store.draftId.value
    store.draft.value = { title: "  Plan  ", body: "b" }

    await store.create()

    expect(calls).toEqual([
      { name: "create", input: { groupId, id: firstId, title: "Plan", body: "b" } },
    ])
    expect(store.notes.value.map((note) => note.title)).toEqual(["Plan"])
    expect(store.draft.value).toEqual({ title: "", body: "" })
    expect(store.draftId.value).not.toBe(firstId)
  })

  it("gives back the note it created, and nothing when the title is missing", async () => {
    const { store } = harness()
    await store.open(groupId, null)
    store.draft.value = { title: "Plan", body: "" }
    const id = store.draftId.value

    expect((await store.create())?.id).toBe(id)

    store.draft.value = { title: " ", body: "" }
    expect(await store.create()).toBe(null)
  })

  it("puts a missing title error on the title and sends nothing", async () => {
    const { store, calls } = harness()
    await store.open(groupId, null)
    store.draft.value = { title: "   ", body: "b" }

    await store.create()

    expect(store.createErrors.value).toEqual({ title: NOTE_MESSAGES.titleRequired, form: null })
    expect(calls).toEqual([])
  })

  it("hands the screen the plan's refusal when the group is at its note cap", async () => {
    const refusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    const { store } = harness({
      create: () =>
        Promise.reject(new RealtimeRequestError("forbidden", "The note limit is reached", refusal)),
    })
    await store.open(groupId, null)
    store.draft.value = { title: "Eleventh", body: "" }

    expect(await store.create()).toBe(null)

    expect(store.createErrors.value).toEqual({
      title: null,
      form: "The note limit is reached",
      plan: refusal,
    })
    expect(store.draft.value.title).toBe("Eleventh")
  })

  it("saves the edit with the version it started from", async () => {
    const { store, calls } = harness({ pages: [{ notes: [item("a", 4)], nextCursor: null }] })
    await store.open(groupId, "a")
    store.editing.value = { ...store.editing.value!, title: "New title" }

    expect(await store.save()).toBe(true)

    expect(calls).toEqual([
      { name: "update", input: { groupId, id: "a", title: "New title", body: "", version: 4 } },
    ])
    expect(store.editing.value).toBe(null)
    expect(store.notes.value[0].version).toBe(5)
  })

  it("keeps the typed text and flags a conflict when the note moved on", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }],
      update: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, "a")
    store.editing.value = { ...store.editing.value!, title: "Mine" }

    expect(await store.save()).toBe(false)

    expect(store.editing.value).toMatchObject({ title: "Mine", version: 1, conflict: true })
    expect(store.editErrors.value.form).toBe(NOTE_MESSAGES.conflict)
  })

  it("starts the edit again from the latest version when asked", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }],
      update: () => Promise.reject(conflict(2)),
      get: () => Promise.resolve({ note: item("a", 2, "Theirs") }),
    })
    await store.open(groupId, "a")
    await store.save()

    await store.reloadLatest()

    expect(store.editing.value).toEqual({
      id: "a",
      title: "Theirs",
      body: "",
      version: 2,
      conflict: false,
      base: { title: "Theirs", body: "" },
    })
    expect(store.editErrors.value).toEqual({ title: null, form: null })
  })

  it("rereads the list when a delete was refused for a stale version", async () => {
    const { store, reads } = harness({
      pages: [
        { notes: [item("a", 1)], nextCursor: null },
        { notes: [item("a", 2, "Changed")], nextCursor: null },
      ],
      delete: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, null)

    await store.remove(store.notes.value[0])

    expect(store.listError.value).toBe(NOTE_MESSAGES.deleteConflict)
    expect(reads.length).toBe(2)
    expect(store.notes.value.map((note) => note.title)).toEqual(["Changed"])
  })

  it("deletes the open note and says so, so the page can leave it", async () => {
    const { store, calls } = harness({ pages: [{ notes: [item("a", 3)], nextCursor: null }] })
    await store.open(groupId, "a")

    expect(await store.remove(store.notes.value[0])).toBe(true)

    expect(calls).toEqual([{ name: "delete", input: { groupId, id: "a", version: 3 } }])
    expect(store.editing.value).toBe(null)
    expect(store.notes.value).toEqual([])
  })

  it("flags a conflict on the open note when its delete was refused for a stale version", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }, {
        notes: [item("a", 2)],
        nextCursor: null,
      }],
      delete: () => Promise.reject(conflict(2)),
    })
    await store.open(groupId, "a")

    expect(await store.remove(store.notes.value[0])).toBe(false)

    expect(store.editing.value).toMatchObject({ id: "a", conflict: true })
  })

  it("marks a note that is not in the open group as missing, with no list error", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () =>
        Promise.reject(
          new RealtimeRequestError("not_found", "Note not found", { code: "NOTE_NOT_FOUND" }),
        ),
    })

    await store.open(groupId, "elsewhere")

    expect(store.missing.value).toBe(true)
    expect(store.editing.value).toBe(null)
    expect(store.listError.value).toBe(null)

    await store.open(groupId, "a")
    expect(store.missing.value).toBe(false)
  })

  it("names the other group of a note that is in one of the person's groups, and stays missing", async () => {
    const { store, calls } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () => Promise.reject(notFound()),
      locate: () => Promise.resolve({ groupId: "g-2" }),
    })

    await store.open(groupId, "elsewhere")

    expect(calls.filter((call) => call.name === "locate")).toEqual([
      { name: "locate", input: { id: "elsewhere" } },
    ])
    expect(store.elsewhere.value).toBe("g-2")
    expect(store.missing.value).toBe(true)
    expect(store.editing.value).toBe(null)
  })

  it("names no group when the lookup finds none, or cannot be asked", async () => {
    const lookups = [
      () => Promise.reject(notFound()),
      () => Promise.reject(new TypeError("offline")),
      () => Promise.resolve({ groupId }),
    ]
    for (const locate of lookups) {
      const { store } = harness({
        pages: [{ notes: [], nextCursor: null }],
        get: () => Promise.reject(notFound()),
        locate,
      })

      await store.open(groupId, "elsewhere")

      expect(store.elsewhere.value).toBe(null)
      expect(store.missing.value).toBe(true)
    }
  })

  it("ignores a late lookup for a note that is no longer the one being opened", async () => {
    let answer!: (found: { groupId: string }) => void
    const late = new Promise<{ groupId: string }>((resolve) => answer = resolve)
    const { store } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () => Promise.reject(notFound()),
      locate: () => late,
    })
    await store.open(groupId, null)
    const gone = store.open(groupId, "gone")
    await new Promise((resolve) => setTimeout(resolve, 0)) // the lookup is now on its way
    await store.open(groupId, "a")

    answer({ groupId: "g-2" })
    await gone

    expect(store.editing.value?.id).toBe("a")
    expect(store.missing.value).toBe(false)
    expect(store.elsewhere.value).toBe(null)
  })

  it("keeps the open note when a read of an earlier note fails late", async () => {
    let fail!: (cause: unknown) => void
    const reads = [new Promise<{ note: NoteItem }>((_, reject) => fail = reject)]
    const { store, calls } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () => reads.shift() ?? Promise.resolve({ note: item("a") }),
    })
    await store.open(groupId, null)
    const gone = store.open(groupId, "gone")
    await store.open(groupId, "a")

    fail(notFound())
    await gone

    expect(store.editing.value?.id).toBe("a")
    expect(store.missing.value).toBe(false)
    expect(calls.some((call) => call.name === "locate")).toBe(false)
  })

  it("drops the other group when another note opens", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a")], nextCursor: null }],
      get: () => Promise.reject(notFound()),
      locate: () => Promise.resolve({ groupId: "g-2" }),
    })
    await store.open(groupId, "elsewhere")

    await store.open(groupId, "a")

    expect(store.elsewhere.value).toBe(null)
    expect(store.missing.value).toBe(false)
  })

  it("counts typed text as unsaved until it is saved, created or discarded", async () => {
    const { store } = harness({ pages: [{ notes: [item("a", 4)], nextCursor: null }] })
    await store.open(groupId, null)
    expect(store.unsaved.value).toBe(false)
    store.draft.value = { title: "Half", body: "" }
    expect(store.unsaved.value).toBe(true)
    store.discardDraft()
    expect(store.unsaved.value).toBe(false)

    await store.open(groupId, "a")
    expect(store.unsaved.value).toBe(false)
    store.editing.value = { ...store.editing.value!, title: "Changed" }
    expect(store.unsaved.value).toBe(true)
    store.editing.value = { ...store.editing.value!, title: "a" }
    expect(store.unsaved.value).toBe(false)
    store.editing.value = { ...store.editing.value!, body: "Typed text" }
    expect(store.unsaved.value).toBe(true)
    store.editing.value = { ...store.editing.value!, body: "" }
    store.editing.value = { ...store.editing.value!, title: "Changed" }
    await store.save()
    expect(store.unsaved.value).toBe(false)
  })

  it("keeps the typed text unsaved while the note is flagged as changed by someone else", async () => {
    const { store } = harness({ pages: [{ notes: [item("a", 1)], nextCursor: null }] })
    await store.open(groupId, "a")
    expect(store.unsaved.value).toBe(false)

    store.editing.value = { ...store.editing.value!, conflict: true }

    expect(store.unsaved.value).toBe(true)
  })

  it("does not count another member's change to the open note as the person's own edit", async () => {
    const { store } = harness({
      pages: [{ notes: [item("a", 1)], nextCursor: null }, {
        notes: [item("a", 2, "Theirs")],
        nextCursor: null,
      }],
    })
    await store.open(groupId, "a")

    await store.refresh()

    expect(store.unsaved.value).toBe(false)
  })

  it("forgets the previous group's notes and draft when another group opens", async () => {
    const { store, reads } = harness({ pages: [{ notes: [item("a")], nextCursor: null }] })
    await store.open(groupId, null)
    store.draft.value = { title: "Half typed", body: "" }

    await store.open("g-2", null)

    expect(store.notes.value).toEqual([])
    expect(store.draft.value).toEqual({ title: "", body: "" })
    expect(reads.map((read) => read.groupId)).toEqual([groupId, "g-2"])
  })

  describe("moving notes", () => {
    const pages = [{ notes: [item("a"), item("b"), item("c")], nextCursor: null }]

    it("moves the ticked notes, takes them off the list and closes the open one", async () => {
      const { store, calls } = harness({ pages })
      await store.open(groupId, "a")

      expect(await store.move("g-2", ["a", "b"])).toBe(true)

      expect(calls.at(-1)).toEqual({
        name: "move",
        input: { groupId, toGroupId: "g-2", noteIds: ["a", "b"] },
      })
      expect(store.notes.value.map((note) => note.id)).toEqual(["c"])
      expect(store.editing.value).toBe(null)
      expect(store.moveError.value).toBe(null)
    })

    it("asks for a tick and sends nothing when no note is selected", async () => {
      const { store, calls } = harness({ pages })
      await store.open(groupId, null)

      expect(await store.move("g-2", [])).toBe(false)

      expect(store.moveError.value).toBe(NOTE_MESSAGES.moveNone)
      expect(calls).toEqual([])
      expect(store.notes.value).toHaveLength(3)
    })

    it("refuses to move a note with unsaved changes, keeping the typed text", async () => {
      const { store, calls } = harness({ pages })
      await store.open(groupId, "a")
      store.editing.value = { ...store.editing.value!, title: "Typed but not saved" }

      expect(await store.move("g-2", ["a"])).toBe(false)

      expect(store.moveError.value).toBe(NOTE_MESSAGES.moveUnsaved)
      expect(calls.filter((call) => call.name === "move")).toEqual([])
      expect(store.editing.value?.title).toBe("Typed but not saved")
      expect(store.notes.value).toHaveLength(3)
    })

    it("keeps the list and shows the server's refusal when the move is refused", async () => {
      const { store } = harness({
        pages,
        move: () => Promise.reject(new RealtimeRequestError("forbidden", "Not an editor there")),
      })
      await store.open(groupId, null)

      expect(await store.move("g-2", ["a"])).toBe(false)

      expect(store.moveError.value).toBe("Not an editor there")
      expect(store.notes.value).toHaveLength(3)
    })

    it("says moving needs a connection when the socket is down, and keeps the list", async () => {
      const { store } = harness({
        pages,
        move: () => Promise.reject(new TypeError("Failed to fetch")),
      })
      await store.open(groupId, null)

      expect(await store.move("g-2", ["a"])).toBe(false)

      expect(store.moveError.value).toBe(NOTE_MESSAGES.moveOffline)
      expect(store.notes.value).toHaveLength(3)
    })

    it("refuses a second move while the first is still on its way", async () => {
      let settle: () => void = () => {}
      const { store, calls } = harness({
        pages,
        move: () => new Promise((resolve) => (settle = () => resolve({ notes: [] }))),
      })
      await store.open(groupId, null)

      const first = store.move("g-2", ["a"])
      expect(store.moving.value).toBe(true)
      expect(await store.move("g-2", ["b"])).toBe(false)
      settle()
      expect(await first).toBe(true)

      expect(calls.filter((call) => call.name === "move")).toHaveLength(1)
      expect(store.moving.value).toBe(false)
    })

    it("rereads the list when a ticked note is no longer there", async () => {
      const { store, reads } = harness({
        pages: [...pages, { notes: [item("c")], nextCursor: null }],
        move: () =>
          Promise.reject(
            new RealtimeRequestError("not_found", "gone", { code: "NOTE_NOT_FOUND" }),
          ),
      })
      await store.open(groupId, null)

      expect(await store.move("g-2", ["a"])).toBe(false)

      expect(store.moveError.value).toBe(NOTE_MESSAGES.moveGone)
      expect(reads).toHaveLength(2)
      expect(store.notes.value.map((note) => note.id)).toEqual(["c"])
    })
  })
  describe("restoring deleted notes", () => {
    const planRefused = () =>
      new RealtimeRequestError("forbidden", "This group's plan holds 10 notes", {
        code: "PLAN_LIMIT_REACHED",
        entitlement: "maxNotes",
        limit: 10,
        canUpgrade: true,
      })

    it("offers Undo for ten seconds after a delete, for the note that was deleted", async () => {
      const { store } = harness({ pages: [{ notes: [item("a", 2, "Plan")], nextCursor: null }] })
      await store.open(groupId, null)
      const before = Date.now()

      await store.remove({ id: "a", version: 2 })

      expect(store.undo.value?.id).toBe("a")
      expect(store.undo.value?.title).toBe("Plan")
      expect(store.undo.value!.until - before).toBeGreaterThanOrEqual(10_000)
      expect(store.undo.value!.until - Date.now()).toBeLessThanOrEqual(10_000)
    })

    it("offers no Undo for a delete that was refused", async () => {
      const { store } = harness({
        pages: [{ notes: [item("a")], nextCursor: null }],
        delete: () => Promise.reject(conflict(2)),
      })
      await store.open(groupId, null)

      await store.remove({ id: "a", version: 1 })

      expect(store.undo.value).toBe(null)
    })

    it("undoes a delete: restores the note, puts it back in the list and ends the offer", async () => {
      const { store, calls } = harness({
        pages: [{ notes: [item("a", 2, "Plan")], nextCursor: null }],
      })
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 2 })
      expect(store.notes.value).toEqual([])

      expect(await store.undoDelete()).toBe(true)

      expect(calls.filter((call) => call.name === "restore")).toEqual([
        { name: "restore", input: { groupId, id: "a" } },
      ])
      expect(store.notes.value.map((note) => note.id)).toEqual(["a"])
      expect(store.undo.value).toBe(null)
    })

    it("reports how Undo ended, for focus: the restored note, or a failure", async () => {
      let fail = false
      let restoring = "a"
      const { store } = harness({
        pages: [{ notes: [item("a", 2, "Plan"), item("b", 2, "Trip")], nextCursor: null }],
        restore: () =>
          fail
            ? Promise.reject(new TypeError("Failed to fetch"))
            : Promise.resolve({ note: item(restoring) }),
      })
      store.listShown.value = true
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 2 })
      await store.undoDelete()
      expect(store.undoOutcome.value).toEqual({ id: "a", restored: true })
      store.clearUndoOutcome()
      expect(store.undoOutcome.value).toBe(null)

      fail = true
      restoring = "b"
      await store.remove({ id: "b", version: 2 })
      await store.undoDelete()
      expect(store.undoOutcome.value).toEqual({ id: "b", restored: false })
    })

    it("reports no Undo outcome when the group changed or the list left while it was pending", async () => {
      let finish = () => {}
      const { store } = harness({
        pages: [{ notes: [item("a", 2, "Plan")], nextCursor: null }],
        restore: () =>
          new Promise((resolve) => {
            finish = () => resolve({ note: item("a") })
          }),
      })
      store.listShown.value = true
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 2 })
      const pending = store.undoDelete()
      await store.open("g-2", null)
      finish()
      await pending
      expect(store.undoOutcome.value).toBe(null)

      store.listShown.value = true
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 2 })
      const again = store.undoDelete()
      store.listShown.value = false
      finish()
      await again
      expect(store.undoOutcome.value).toBe(null)
    })

    it("keeps the reason a failed Undo gave until the next delete, and shows no Undo for it", async () => {
      const { store } = harness({
        pages: [{ notes: [item("a", 2, "Plan"), item("b", 2, "Trip")], nextCursor: null }],
        restore: () => Promise.reject(new TypeError("Failed to fetch")),
      })
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 2 })

      expect(await store.undoDelete()).toBe(false)
      expect(store.restoreError.value.form).toBe(NOTE_MESSAGES.restoreOffline)
      expect(store.undo.value).toBe(null)

      await store.remove({ id: "b", version: 2 })
      expect(store.restoreError.value.form).toBe(null)
    })

    it("does not read the deleted notes until the filter is turned on, then reads them all", async () => {
      const { store, deletedReads } = harness({
        deletedPages: [
          { notes: [item("x")], nextCursor: "c1" },
          { notes: [item("y")], nextCursor: null },
        ],
      })
      await store.open(groupId, null)
      expect(deletedReads).toEqual([])

      await store.setShowDeleted(true)

      expect(store.deletedNotes.value.map((note) => note.id)).toEqual(["x", "y"])
      await store.setShowDeleted(false)
      expect(store.showDeleted.value).toBe(false)
    })

    it("rereads the deleted notes together with the list while the filter is on", async () => {
      const { store, deletedReads } = harness()
      await store.open(groupId, null)
      await store.setShowDeleted(true)

      await store.refresh()

      expect(deletedReads).toEqual([groupId, groupId])
    })

    it("restores a deleted note from the deleted list into the live list", async () => {
      const { store } = harness({
        deletedPages: [{ notes: [item("x", 3, "Old"), item("y")], nextCursor: null }],
      })
      await store.open(groupId, null)
      await store.setShowDeleted(true)

      expect(await store.restore("x")).toBe(true)

      expect(store.deletedNotes.value.map((note) => note.id)).toEqual(["y"])
      expect(store.notes.value.map((note) => note.id)).toEqual(["x"])
      expect(store.restoreError.value.form).toBe(null)
    })

    it("keeps the note deleted and carries the plan's refusal when the group is full", async () => {
      const { store } = harness({
        deletedPages: [{ notes: [item("x")], nextCursor: null }],
        restore: () => Promise.reject(planRefused()),
      })
      await store.open(groupId, null)
      await store.setShowDeleted(true)

      expect(await store.restore("x")).toBe(false)

      expect(store.deletedNotes.value.map((note) => note.id)).toEqual(["x"])
      expect(store.notes.value).toEqual([])
      expect(store.restoreError.value.plan?.entitlement).toBe("maxNotes")
    })

    it("says so when a note is no longer deleted, and rereads the deleted list", async () => {
      const { store, deletedReads } = harness({
        deletedPages: [{ notes: [item("x")], nextCursor: null }],
        restore: () => Promise.reject(notFound()),
      })
      await store.open(groupId, null)
      await store.setShowDeleted(true)

      expect(await store.restore("x")).toBe(false)

      expect(store.restoreError.value.form).toBe(NOTE_MESSAGES.restoreGone)
      expect(deletedReads).toHaveLength(2)
    })

    it("tells a person offline that restoring needs a connection", async () => {
      const { store } = harness({
        restore: () => Promise.reject(new TypeError("Failed to fetch")),
      })
      await store.open(groupId, null)

      expect(await store.restore("x")).toBe(false)

      expect(store.restoreError.value.form).toBe(NOTE_MESSAGES.restoreOffline)
    })

    it("forgets the filter, the deleted notes and the offer when another group opens", async () => {
      const { store } = harness({
        pages: [{ notes: [item("a")], nextCursor: null }],
        deletedPages: [{ notes: [item("x")], nextCursor: null }],
      })
      await store.open(groupId, null)
      await store.remove({ id: "a", version: 1 })
      await store.setShowDeleted(true)

      await store.open("g-2", null)

      expect(store.showDeleted.value).toBe(false)
      expect(store.deletedNotes.value).toEqual([])
      expect(store.undo.value).toBe(null)
    })
  })
})

describe("restoreWhileReachable", () => {
  it("refuses at once, without sending, when the server cannot be reached", async () => {
    let sent = 0
    const send = () => {
      sent++
      return Promise.resolve({ note: item("a") })
    }
    await expect(restoreWhileReachable({ groupId, id: "a" }, () => false, send)).rejects.toThrow(
      "the server cannot be reached",
    )
    expect(sent).toBe(0)
  })

  it("sends the restore when the server can be reached", async () => {
    const result = await restoreWhileReachable(
      { groupId, id: "a" },
      () => true,
      () => Promise.resolve({ note: item("a") }),
    )
    expect(result.note.id).toBe("a")
  })
})
