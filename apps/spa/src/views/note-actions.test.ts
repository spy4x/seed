/** The note page's palette commands: which are offered, and what Copy link and Duplicate do. */
import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import { NOTE_TITLE_MAX_LENGTH } from "@domain/notes"
import { NOTE_PATHS } from "@ui/progressive.tsx"
import app from "@i18n/app/en.ts"
import type { NoteItem } from "../state/notes.ts"
import { copyNoteLink, duplicateNote, duplicateTitle, offeredNoteActions } from "./note-actions.ts"

/** The `app` catalog's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })

const GROUP = "0190a000-0000-7000-8000-000000000001"
const COPY_ID = "0190a000-0000-7000-8000-0000000000c1"

/** A toast list that records what it was asked to show. */
function recordedToasts() {
  const shown: { kind: string; title: string; body?: string; dataE2E?: string }[] = []
  return {
    shown,
    toasts: {
      success: (toast: { title: string; body?: string; dataE2E?: string }) =>
        void shown.push({ kind: "success", ...toast }),
      error: (toast: { title: string; body?: string }) =>
        void shown.push({ kind: "error", ...toast }),
    } as unknown as Parameters<typeof copyNoteLink>[2]["toasts"],
  }
}

function item(input: { groupId: string; id: string; title: string }): NoteItem {
  return {
    ...input,
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

describe("offeredNoteActions", () => {
  const noop = () => {}
  const run = { attach: noop, copyLink: noop, duplicate: noop, move: noop, delete: noop }
  const offered = (page: { canWrite: boolean; noteOpen: boolean; canMove: boolean }) =>
    Object.keys(offeredNoteActions(page, run))

  it("offers an editor of an open note every command, Move only with another group to go to", () => {
    expect(offered({ canWrite: true, noteOpen: true, canMove: true })).toEqual([
      "attach",
      "duplicate",
      "move",
      "copyLink",
      "delete",
    ])
    expect(offered({ canWrite: true, noteOpen: true, canMove: false })).not.toContain("move")
  })

  it("offers a reader of a note only Copy link, never Delete, Duplicate or Move", () => {
    expect(offered({ canWrite: false, noteOpen: true, canMove: true })).toEqual(["copyLink"])
  })

  it("offers only Attach until a note is open, and nothing to a reader", () => {
    expect(offered({ canWrite: true, noteOpen: false, canMove: true })).toEqual(["attach"])
    expect(offered({ canWrite: false, noteOpen: false, canMove: false })).toEqual([])
  })
})

describe("copyNoteLink", () => {
  it("copies the note's full address and says only the group's people can open it", async () => {
    const copied: string[] = []
    const { shown, toasts } = recordedToasts()
    await copyNoteLink(EN, { id: "n-1", groupName: "Home" }, {
      base: "https://app.example.com/notes/n-1?x=1",
      copy: (text) => {
        copied.push(text)
        return Promise.resolve(true)
      },
      toasts,
    })
    expect(copied).toEqual([`https://app.example.com${NOTE_PATHS.note("n-1")}`])
    expect(shown).toEqual([{
      kind: "success",
      title: "Link copied",
      body: "Only people in ⁨Home⁩ can open it.",
      dataE2E: "note-link-copied",
    }])
  })

  it("tells the person the copy failed when the clipboard refuses", async () => {
    const { shown, toasts } = recordedToasts()
    await copyNoteLink(EN, { id: "n-1" }, {
      base: "https://app.example.com/",
      copy: () => Promise.resolve(false),
      toasts,
    })
    expect(shown.map((toast) => [toast.kind, toast.title])).toEqual([
      ["error", "Could not copy the link"],
    ])
  })
})

describe("duplicateTitle", () => {
  it("adds the copy suffix to a short title", () => {
    expect(duplicateTitle(EN, "Groceries")).toBe("Groceries (copy)")
  })

  it("cuts a long title so the copy's title is exactly at the limit, counting an emoji as one", () => {
    const title = "😀".repeat(NOTE_TITLE_MAX_LENGTH)
    const copy = duplicateTitle(EN, title)
    expect(Array.from(copy).length).toBe(NOTE_TITLE_MAX_LENGTH)
    expect(copy.endsWith("😀 (copy)")).toBe(true)
  })
})

describe("duplicateNote", () => {
  const saved = { groupId: GROUP, title: "Groceries", body: "Milk", tagIds: ["tag-1"] }

  it("creates the copy in the note's group with its text and tags, then opens it", async () => {
    const created: unknown[] = []
    const navigated: string[] = []
    const { shown, toasts } = recordedToasts()
    await duplicateNote(EN, saved, {
      create: (input) => {
        created.push(input)
        return Promise.resolve({ note: item(input) })
      },
      newId: () => COPY_ID,
      navigate: (to) => void navigated.push(to),
      toasts,
    })
    expect(created).toEqual([{
      groupId: GROUP,
      id: COPY_ID,
      title: "Groceries (copy)",
      body: "Milk",
      tagIds: ["tag-1"],
    }])
    expect(navigated).toEqual([NOTE_PATHS.note(COPY_ID)])
    expect(shown.map((toast) => [toast.kind, toast.dataE2E])).toEqual([
      ["success", "note-duplicated"],
    ])
  })

  it("stays on the note and shows the store's message when the create is refused", async () => {
    const navigated: string[] = []
    const { shown, toasts } = recordedToasts()
    await duplicateNote(EN, saved, {
      create: () => Promise.resolve({ errors: { title: null, form: "The note limit is reached" } }),
      newId: () => COPY_ID,
      navigate: (to) => void navigated.push(to),
      toasts,
    })
    expect(navigated).toEqual([])
    expect(shown).toEqual([{
      kind: "error",
      title: "Could not duplicate the note",
      body: "The note limit is reached",
    }])
  })
})
