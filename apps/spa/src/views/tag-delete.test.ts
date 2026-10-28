import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { deleteAndAnnounce } from "./tag-delete.ts"
import { createTranslator } from "@spy4x/platform/universal/i18n"
import app from "@i18n/app/en.json" with { type: "json" }

/** The `app` catalog's English, as a screen without a provider reads it. */
const EN = createTranslator({ language: `en`, catalogs: [{ source: app }] })

const groupId = "019a0000-0000-7000-8000-000000000001"
const tagId = "019a0000-0000-7000-8000-000000000002"
const otherTag = "019a0000-0000-7000-8000-000000000003"

/** The tags store's slice: one tag, "Urgent", and a delete that works or not. */
function tags(deleted = true) {
  const removed: string[] = []
  const store = {
    byId: { value: new Map([[tagId, { id: tagId, groupId, name: "Urgent" }]]) },
    remove: (id: string) => {
      removed.push(id)
      return Promise.resolve(deleted)
    },
  } as unknown as Parameters<typeof deleteAndAnnounce>[1]
  return { store, removed }
}

/** The notes store's slice: the notes read for `forGroup`, each with its tag ids. */
function notes(tagIds: string[][], { forGroup = groupId, loading = false } = {}) {
  return {
    groupId: { value: forGroup },
    loading: { value: loading },
    notes: { value: tagIds.map((ids) => ({ tagIds: ids })) },
  } as unknown as Parameters<typeof deleteAndAnnounce>[3]
}

/** Deletes "Urgent" and returns whether it went and the toasts it showed. */
async function run(
  tagStore: Parameters<typeof deleteAndAnnounce>[1],
  noteStore: Parameters<typeof deleteAndAnnounce>[3],
) {
  const shown: { title?: string; body?: string; dataE2E?: string }[] = []
  const done = await deleteAndAnnounce(EN, tagStore, tagId, noteStore, {
    success: (toast) => String(shown.push(toast)),
  })
  return { done, shown }
}

describe("deleteAndAnnounce", () => {
  it("names the deleted tag in quotes and counts the notes it was taken off", async () => {
    const { store, removed } = tags()
    const { done, shown } = await run(store, notes([[tagId], [tagId, otherTag], [otherTag], []]))
    expect(done).toBe(true)
    expect(removed).toEqual([tagId])
    expect(shown).toEqual([{
      title: "Tag deleted",
      body: `"Urgent" was deleted and taken off 2 notes.`,
      dataE2E: "tag-deleted",
    }])
  })

  it("says one note, not one notes", async () => {
    const { shown } = await run(tags().store, notes([[tagId], []]))
    expect(shown[0].body).toBe(`"Urgent" was deleted and taken off 1 note.`)
  })

  it("leaves the count out when the tag was on no note", async () => {
    const { shown } = await run(tags().store, notes([[otherTag]]))
    expect(shown[0].body).toBe(`"Urgent" was deleted.`)
  })

  it("leaves the count out rather than guess while another group's notes, or none yet, are read", async () => {
    const other = await run(tags().store, notes([[tagId]], { forGroup: otherTag }))
    expect(other.shown[0].body).toBe(`"Urgent" was deleted.`)
    const loading = await run(tags().store, notes([[tagId]], { loading: true }))
    expect(loading.shown[0].body).toBe(`"Urgent" was deleted.`)
  })

  it("shows no toast when the delete failed", async () => {
    const { done, shown } = await run(tags(false).store, notes([[tagId]]))
    expect(done).toBe(false)
    expect(shown).toEqual([])
  })
})
