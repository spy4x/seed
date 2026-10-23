/** `filterNotes`: what the notes list keeps and in which order, from the notes it holds. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { defaultDirection, filterNotes, NO_NOTE_FILTERS, type NoteFilters } from "./notes-filter.ts"

const design = "tag-design"
const plans = "tag-plans"
const notes = [
  {
    title: "Q4 planning: hiring and budget",
    body: "Two designers in November",
    tagIds: [design, plans],
    authorId: "7",
    createdAt: "2026-03-12T09:00:00.000Z",
    updatedAt: "2026-10-21T09:00:00.000Z",
  },
  {
    title: "Welcome",
    body: "Start here",
    tagIds: [],
    authorId: "1",
    createdAt: "2026-03-01T09:00:00.000Z",
    updatedAt: "2026-03-01T09:00:00.000Z",
  },
  {
    title: "Список покупок",
    body: "молоко",
    tagIds: [design],
    authorId: null,
    createdAt: "2026-05-01T09:00:00.000Z",
    updatedAt: "2026-06-01T09:00:00.000Z",
  },
]
const context = { youId: "1", knownTagIds: [design, plans] }

/** The titles `filterNotes` keeps for these filters, in its order. */
function titles(filters: Partial<NoteFilters>, youId: string | null = "1"): string[] {
  return filterNotes(notes, { ...NO_NOTE_FILTERS, ...filters }, { ...context, youId })
    .map((note) => note.title)
}

describe("filterNotes", () => {
  it("orders by the last change by default, newest first", () => {
    expect(titles({})).toEqual(["Q4 planning: hiring and budget", "Список покупок", "Welcome"])
  })

  it("orders by the day a note was made, newest first", () => {
    expect(titles({ sort: "created" })).toEqual([
      "Список покупок",
      "Q4 planning: hiring and budget",
      "Welcome",
    ])
  })

  it("orders by title from A to Z", () => {
    expect(titles({ sort: "title", direction: "asc" })).toEqual([
      "Q4 planning: hiring and budget",
      "Welcome",
      "Список покупок",
    ])
  })

  it("runs each order the other way: oldest first, or Z to A", () => {
    expect(titles({ direction: "asc" })).toEqual([
      "Welcome",
      "Список покупок",
      "Q4 planning: hiring and budget",
    ])
    expect(titles({ sort: "title", direction: "desc" })).toEqual([
      "Список покупок",
      "Welcome",
      "Q4 planning: hiring and budget",
    ])
  })

  it("puts an undated note last whichever way the dates run", () => {
    const undated = [...notes, { title: "Undated", body: "", tagIds: [], authorId: "1" }]
    for (const direction of ["asc", "desc"] as const) {
      const order = filterNotes(undated, { ...NO_NOTE_FILTERS, direction }, context)
      expect(order.at(-1)?.title).toBe("Undated")
    }
  })

  it("starts dates newest first and titles A to Z", () => {
    expect(defaultDirection("updated")).toBe("desc")
    expect(defaultDirection("created")).toBe("desc")
    expect(defaultDirection("title")).toBe("asc")
  })

  it("finds words in the title or the text, in any order, by the start of a word", () => {
    expect(titles({ q: "budget hiring" })).toEqual(["Q4 planning: hiring and budget"])
    expect(titles({ q: "design nov" })).toEqual(["Q4 planning: hiring and budget"])
    expect(titles({ q: "start" })).toEqual(["Welcome"])
  })

  it("finds a note with one typo, in the other keyboard layout, or in the other script", () => {
    expect(titles({ q: "welcme" })).toEqual(["Welcome"])
    // "Welcome" typed on a Russian layout.
    expect(titles({ q: "цуд" })).toEqual(["Welcome"])
    expect(titles({ q: "spisok" })).toEqual(["Список покупок"])
  })

  it("keeps the notes with any of the chosen tags, or with all of them", () => {
    expect(titles({ tagIds: [design, plans] })).toEqual([
      "Q4 planning: hiring and budget",
      "Список покупок",
    ])
    expect(titles({ tagIds: [design, plans], match: "all" })).toEqual([
      "Q4 planning: hiring and budget",
    ])
  })

  it("ignores a tag the group no longer has", () => {
    expect(titles({ tagIds: ["gone"] })).toHaveLength(3)
  })

  it("keeps the notes of one author, and the person's own for Created by me", () => {
    expect(titles({ author: "7" })).toEqual(["Q4 planning: hiring and budget"])
    expect(titles({ mine: true })).toEqual(["Welcome"])
    expect(titles({ mine: true }, null)).toEqual([])
  })

  it("leaves the notes it was given as they were", () => {
    const before = notes.map((note) => note.title)
    filterNotes(notes, { ...NO_NOTE_FILTERS, sort: "title" }, context)
    expect(notes.map((note) => note.title)).toEqual(before)
  })
})
