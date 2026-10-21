import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { createNotesStore, NOTE_MESSAGES, type NoteItem } from "./notes.ts"

const OPEN = "0190a000-0000-7000-8000-000000000001"
const OTHER = "0190a000-0000-7000-8000-000000000002"

function item(id: string, groupId = OPEN, title = id): NoteItem {
  return {
    id,
    groupId,
    title,
    body: "",
    tagIds: [],
    version: 1,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

/** A notes store over fakes, with `OPEN` open and one note in it; `create` answers with `answer`. */
async function opened(answer?: () => Promise<{ note: NoteItem }>) {
  const created: unknown[] = []
  const unused = () => Promise.reject(new Error("unused"))
  const store = createNotesStore({
    fetchPage: () => Promise.resolve({ notes: [item("old")], nextCursor: null }),
    get: unused,
    create: (input) => {
      created.push(input)
      return answer?.() ?? Promise.resolve({ note: item(input.id, input.groupId, input.title) })
    },
    update: unused,
    delete: unused,
    restore: unused,
    move: unused,
    newId: () => "draft",
  })
  await store.open(OPEN, null)
  return { store, created }
}

describe("notes store quick create", () => {
  it("refuses an empty title without calling the API", async () => {
    const { store, created } = await opened()
    expect(await store.quickCreate({ groupId: OPEN, id: "n-1", title: "   " })).toEqual({
      errors: { title: NOTE_MESSAGES.titleRequired, form: null },
    })
    expect(created).toEqual([])
  })

  it("sends the trimmed title with an empty body and no tags, and lists it first in the open group", async () => {
    const { store, created } = await opened()
    const outcome = await store.quickCreate({ groupId: OPEN, id: "n-1", title: "  Buy milk " })
    expect(created).toEqual([{ groupId: OPEN, id: "n-1", title: "Buy milk", body: "", tagIds: [] }])
    expect("note" in outcome && outcome.note.title).toBe("Buy milk")
    expect(store.notes.value.map((note) => note.id)).toEqual(["n-1", "old"])
  })

  it("leaves the open list alone for a note added to another group", async () => {
    const { store } = await opened()
    await store.quickCreate({ groupId: OTHER, id: "n-2", title: "Elsewhere" })
    expect(store.notes.value.map((note) => note.id)).toEqual(["old"])
  })

  it("hands back the plan's refusal at the note cap, as the notes page does", async () => {
    const refusal = {
      code: "PLAN_LIMIT_REACHED",
      entitlement: "maxNotes",
      limit: 10,
      canUpgrade: false,
    }
    const { store } = await opened(() =>
      Promise.reject(new RealtimeRequestError("forbidden", "The note limit is reached", refusal))
    )
    expect(await store.quickCreate({ groupId: OPEN, id: "n-3", title: "Eleventh" })).toEqual({
      errors: { title: null, form: "The note limit is reached", plan: refusal },
    })
  })
})
