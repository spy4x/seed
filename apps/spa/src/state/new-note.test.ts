import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { NewNoteErrors } from "@ui/new-note-dialog.tsx"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }
import { messageText } from "@ui/message.ts"
import { createNewNoteStore } from "./new-note.ts"

/** The `app` catalog's English, as the dialog shows the store's message. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })
import type { NoteItem } from "./notes.ts"

const ACME = { id: "0190a000-0000-7000-8000-000000000001", name: "Acme" }

type Outcome = { note: NoteItem } | { errors: NewNoteErrors }

/** A store over a fake create that answers with the queued outcomes and records each call. */
function store(...outcomes: Outcome[]) {
  const calls: { groupId: string; id: string; title: string }[] = []
  let next = 0
  const newNote = createNewNoteStore({
    create: (input) => {
      calls.push(input)
      return Promise.resolve(outcomes.shift()!)
    },
    newId: () => `id-${++next}`,
  })
  return { newNote, calls }
}

function note(title: string, version: number): NoteItem {
  return { id: "id-1", title, version } as unknown as NoteItem
}

describe("new note store", () => {
  it("keeps the unsent title across close and open, and clears the last success line", async () => {
    const { newNote } = store({ note: note("One", 1) })
    newNote.show()
    newNote.title.value = "One"
    await newNote.add(ACME)
    newNote.title.value = "Half typed"
    newNote.close()
    expect(newNote.open.value).toBe(false)
    newNote.show()
    expect(newNote.title.value).toBe("Half typed")
    expect(newNote.added.value).toBeNull()
  })

  it("retries a failed add with the same id, and uses a new id after a success", async () => {
    const { newNote, calls } = store(
      { errors: { form: "You are offline." } },
      { note: note("Buy milk", 1) },
      { note: note("Next", 1) },
    )
    newNote.title.value = "Buy milk"
    expect(await newNote.add(ACME)).toBeNull()
    expect(newNote.errors.value).toEqual({ form: "You are offline." })
    expect(newNote.title.value).toBe("Buy milk")
    await newNote.add(ACME)
    expect(newNote.title.value).toBe("")
    expect(newNote.errors.value).toEqual({})
    newNote.title.value = "Next"
    await newNote.add(ACME)
    expect(calls.map((call) => call.id)).toEqual(["id-1", "id-1", "id-2"])
  })

  it("asks for a group, without calling the API, when there is none", async () => {
    const { newNote, calls } = store()
    newNote.title.value = "Buy milk"
    expect(await newNote.add(null)).toBeNull()
    expect(messageText(EN, newNote.errors.value.group)).toBe("Choose a group for this note.")
    expect(calls).toEqual([])
  })

  it("says a note the server has not seen yet is saved on this device", async () => {
    const { newNote } = store({ note: note("Offline", 0) }, { note: note("Online", 3) })
    await newNote.add(ACME)
    expect(newNote.added.value).toMatchObject({
      title: "Offline",
      groupName: "Acme",
      onDevice: true,
    })
    await newNote.add(ACME)
    expect(newNote.added.value?.onDevice).toBe(false)
  })

  it("forgets the draft and the dialog on sign-out", async () => {
    const { newNote } = store()
    newNote.show()
    newNote.title.value = "Private"
    newNote.groupId.value = ACME.id
    newNote.reset()
    expect([newNote.open.value, newNote.title.value, newNote.groupId.value]).toEqual([
      false,
      "",
      null,
    ])
  })
})
