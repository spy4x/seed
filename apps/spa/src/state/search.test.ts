import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ConnectionLostError, RealtimeRequestError } from "@spy4x/realtime"
import type { NoteItem } from "./notes.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"
import { NOTE_SEARCH_LIMIT, NOTE_SEARCH_MAX_LENGTH } from "@domain/notes"
import { createNoteSearch, type NoteSearchSources } from "./search.ts"

const HOME = "group-home"
const LEFT = "group-left"

function note(
  id: string,
  groupId: string,
  title: string,
  body = "",
  updatedAt = "2026-10-01",
): NoteItem {
  return {
    id,
    groupId,
    title,
    body,
    tagIds: [],
    version: 1,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: updatedAt,
    updatedAt,
  }
}

/** The device holds Home's notes and a group the person has since left. */
const DEVICE: Record<string, NoteItem[]> = {
  [HOME]: [
    note("n-old", HOME, "Weekly plan", "call the bank", "2026-10-01"),
    note("n-new", HOME, "Café list", "flat white", "2026-10-05"),
  ],
  [LEFT]: [note("n-left", LEFT, "Weekly secrets", "", "2026-10-09")],
}

function sources(overrides: Partial<NoteSearchSources> = {}): NoteSearchSources & {
  asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    canCall: () => true,
    server: (q) => {
      asked.push(q)
      return Promise.resolve({
        notes: [{ id: "s1", groupId: HOME, title: "From server", snippet: "…x…", updatedAt: "" }],
      })
    },
    groupIds: () => [HOME],
    selectedGroupId: () => HOME,
    loadedNotes: () => null,
    deviceNotes: (groupId) => Promise.resolve(DEVICE[groupId] ?? []),
    ...overrides,
  }
}

const signal = new AbortController().signal
const ids = (answer: { notes: readonly { id: string }[] }) => answer.notes.map((n) => n.id)

describe("the palette's note search", () => {
  it("asks the server, and answers its notes as not from the device", async () => {
    const from = sources()

    const answer = await createNoteSearch(from)("plan", signal)

    expect(from.asked).toEqual(["plan"])
    expect(answer).toEqual({
      notes: [{ id: "s1", groupId: HOME, title: "From server", snippet: "…x…" }],
      onDevice: false,
    })
  })

  it("searches the device when the server cannot be reached, never a group the person left", async () => {
    const search = createNoteSearch(sources({
      server: () => Promise.reject(new ConnectionLostError("offline")),
    }))

    const answer = await search("weekly", signal)

    expect(answer).toEqual({
      notes: [{ id: "n-old", groupId: HOME, title: "Weekly plan", snippet: "call the bank" }],
      onDevice: true,
    })
  })

  it("searches the device without asking when no call can be made, by title or body, folding accents", async () => {
    const from = sources({ canCall: () => false })

    expect(ids(await createNoteSearch(from)("cafe", signal))).toEqual(["n-new"])
    expect(ids(await createNoteSearch(from)("bank", signal))).toEqual(["n-old"])
    expect(from.asked).toEqual([])
  })

  it("finds saved notes offline despite a typo or the other keyboard layout", async () => {
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () => Promise.resolve([note("n-1", HOME, "Shopping note", "milk")]),
    }))

    expect(ids(await search("notse", signal))).toEqual(["n-1"])
    expect(ids(await search("тщеу", signal))).toEqual(["n-1"])
  })

  it("ranks the best match first offline, the newest first among equal matches", async () => {
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () =>
        Promise.resolve([
          note("n-body", HOME, "Errands", "buy a lamp", "2026-10-09"),
          note("n-title-old", HOME, "Lamp", "", "2026-10-01"),
          note("n-title-new", HOME, "Lamp", "", "2026-10-05"),
        ]),
    }))

    expect(ids(await search("lamp", signal))).toEqual(["n-title-new", "n-title-old", "n-body"])
  })

  it("shows the text around a match in the body offline, else the body's start", async () => {
    const long = `${"filler ".repeat(30)}the receipt is here ${"tail ".repeat(30)}`
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () =>
        Promise.resolve([
          note("n-body", HOME, "Taxes", long),
          note("n-title", HOME, "Receipt box", "on the shelf"),
        ]),
    }))

    const { notes } = await search("receipt", signal)

    expect(notes.find((n) => n.id === "n-title")?.snippet).toBe("on the shelf")
    const around = notes.find((n) => n.id === "n-body")?.snippet ?? ""
    expect(around).toContain("the receipt is here")
    expect(around.startsWith("…")).toBe(true)
  })

  it(`answers at most ${NOTE_SEARCH_LIMIT} notes offline`, async () => {
    const many = Array.from(
      { length: NOTE_SEARCH_LIMIT + 5 },
      (_, i) => note(`n-${i}`, HOME, "Plan"),
    )
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () => Promise.resolve(many),
    }))

    expect((await search("plan", signal)).notes).toHaveLength(NOTE_SEARCH_LIMIT)
  })

  it(`searches the device for the first ${NOTE_SEARCH_MAX_LENGTH} characters of a longer query only`, async () => {
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () => Promise.resolve([note("n-1", HOME, "Plan")]),
    }))

    expect(ids(await search(`plan${" ".repeat(NOTE_SEARCH_MAX_LENGTH)}unmatched`, signal)))
      .toEqual(["n-1"])
  })

  it("finds a saved note by the text it was changed to since the last search offline", async () => {
    let saved = [note("n-1", HOME, "Plan", "", "2026-10-01")]
    const search = createNoteSearch(sources({
      canCall: () => false,
      deviceNotes: () => Promise.resolve(saved),
    }))
    expect(ids(await search("plan", signal))).toEqual(["n-1"])

    saved = [note("n-1", HOME, "Budget", "", "2026-10-02")]

    expect(ids(await search("plan", signal))).toEqual([])
    expect(ids(await search("budget", signal))).toEqual(["n-1"])
  })

  it("answers a saved note in the group it was moved to, though its date did not change, offline", async () => {
    const WORK = "group-work"
    let device: Record<string, NoteItem[]> = { [HOME]: [note("n-1", HOME, "Plan")], [WORK]: [] }
    const search = createNoteSearch(sources({
      canCall: () => false,
      groupIds: () => [HOME, WORK],
      deviceNotes: (groupId) => Promise.resolve(device[groupId] ?? []),
    }))
    const groups = async () => (await search("plan", signal)).notes.map((n) => n.groupId)
    expect(await groups()).toEqual([HOME])

    device = { [HOME]: [], [WORK]: [note("n-1", WORK, "Plan")] }

    expect(await groups()).toEqual([WORK])
  })

  it("searches the device when a proxy answers for the server", async () => {
    const answer = await createNoteSearch(sources({
      server: () => Promise.reject(new ReadRefused("Bad gateway", 502)),
    }))("plan", signal)

    expect(answer.onDevice).toBe(true)
  })

  it("passes on a refusal of the server, such as the rate limit", async () => {
    const refusal = new RealtimeRequestError("rate_limited", "Too many searches")
    const search = createNoteSearch(sources({ server: () => Promise.reject(refusal) }))

    await expect(search("plan", signal)).rejects.toBe(refusal)
  })

  it("answers the selected group's newest notes first for the empty query", async () => {
    const answer = await createNoteSearch(sources())("", signal)

    expect(ids(answer)).toEqual(["n-new", "n-old"])
    expect(answer.onDevice).toBe(false)
  })

  it("prefers the notes the page already holds for the empty query", async () => {
    const loaded = [note("n-page", HOME, "On the page")]
    const answer = await createNoteSearch(sources({ loadedNotes: () => loaded }))("", signal)

    expect(ids(answer)).toEqual(["n-page"])
  })

  it("answers no recent notes for a selected group the person is no longer in", async () => {
    const answer = await createNoteSearch(sources({ selectedGroupId: () => LEFT }))("", signal)

    expect(answer.notes).toEqual([])
  })
})
