import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { RealtimeRequestError } from "@spy4x/realtime"
import { createTagsStore, TAG_MESSAGES, type TagItem, type TagsDependencies } from "./tags.ts"

const groupId = "g-1"

function item(id: string, name = id, version = 1): TagItem {
  return {
    id,
    groupId,
    name,
    color: "#4b5563",
    version,
    changeSequence: "1",
    createdByUserId: 1,
    updatedByUserId: 1,
    createdAt: "2026-10-02T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  }
}

function refused(code: string) {
  return new RealtimeRequestError("conflict", "Refused", { code })
}

function harness(overrides: Partial<TagsDependencies> = {}) {
  const calls: { name: string; input: unknown }[] = []
  const store = createTagsStore({
    fetchList: () => Promise.resolve([item("b", "Beta"), item("a", "alpha")]),
    create(input) {
      calls.push({ name: "create", input })
      return Promise.resolve({ tag: item(input.id, input.name) })
    },
    update(input) {
      calls.push({ name: "update", input })
      return Promise.resolve({ tag: item(input.id, input.name, input.version + 1) })
    },
    delete(input) {
      calls.push({ name: "delete", input })
      return Promise.resolve({})
    },
    newId: () => "new-1",
    ...overrides,
  })
  return { store, calls }
}

describe("tags store", () => {
  it("lists the group's tags once it is opened", async () => {
    const { store } = harness()
    await store.open(groupId)
    expect(store.tags.value.map((tag) => tag.id)).toEqual(["b", "a"])
    expect(store.loading.value).toBe(false)
  })

  it("shows the device's copy while the read is still running", async () => {
    let answer: (all: TagItem[]) => void = () => {}
    const { store } = harness({
      fetchList: () => new Promise((resolve) => answer = resolve),
      readLocal: () => Promise.resolve([item("local")]),
    })
    const opened = store.open(groupId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(store.tags.value.map((tag) => tag.id)).toEqual(["local"])
    answer([item("server")])
    await opened
    expect(store.tags.value.map((tag) => tag.id)).toEqual(["server"])
  })

  it("creates a tag with a new id, keeps the list sorted by name and goes on editing the new tag", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "  Cherry  " })
    expect(store.unsaved.value).toBe(true)
    expect((await store.save())?.id).toBe("new-1")
    expect(calls).toEqual([{
      name: "create",
      input: { groupId, id: "new-1", name: "Cherry", color: "#4b5563" },
    }])
    expect(store.tags.value.map((tag) => tag.name)).toEqual(["alpha", "Beta", "Cherry"])
    expect(store.form.value?.id).toBe("new-1")
    expect(store.unsaved.value).toBe(false)
  })

  it("keeps a tag's note count through a save, which does not send it, and counts a new tag at 0", async () => {
    const { store } = harness({
      fetchList: () => Promise.resolve([{ ...item("a", "alpha"), noteCount: 4 }]),
    })
    await store.open(groupId)
    store.startEdit("a")
    store.change({ ...store.form.value!, name: "Alpha" })
    expect((await store.save())?.noteCount).toBe(4)
    expect(store.tags.value.find((tag) => tag.id === "a")?.noteCount).toBe(4)

    store.startCreate()
    store.change({ ...store.form.value!, name: "Cherry" })
    await store.save()
    expect(store.tags.value.find((tag) => tag.id === "new-1")?.noteCount).toBe(0)
  })

  it("keeps what was typed into the create form when the create page opens again", async () => {
    const { store } = harness()
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "Draft" })
    store.startCreate()
    expect(store.form.value?.name).toBe("Draft")
  })

  it("keeps the create form when the group changes, and creates the tag in the new group", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "Errands" })
    await store.open("g-2")
    expect(store.form.value).toMatchObject({ id: null, name: "Errands" })
    store.change({ ...store.form.value!, color: "#15803d" })
    expect((await store.save())?.name).toBe("Errands")
    expect(calls).toEqual([{
      name: "create",
      input: { groupId: "g-2", id: "new-1", name: "Errands", color: "#15803d" },
    }])
  })

  it("drops an edited tag's form when the group changes, since the tag is in the old group", async () => {
    const { store } = harness()
    await store.open(groupId)
    store.startEdit("b")
    await store.open("g-2")
    expect(store.form.value).toBeNull()
  })

  it("counts a changed name or colour as unsaved, and puts the saved values back on revert", async () => {
    const { store } = harness()
    await store.open(groupId)
    store.startEdit("b")
    expect(store.unsaved.value).toBe(false)
    store.change({ ...store.form.value!, color: "#b91c1c" })
    expect(store.unsaved.value).toBe(true)
    store.revert()
    expect(store.form.value).toMatchObject({ id: "b", name: "Beta", color: "#4b5563" })
    expect(store.unsaved.value).toBe(false)
  })

  it("keeps unsaved changes when the tag is opened again, and follows the tag when nothing changed", async () => {
    const { store } = harness()
    await store.open(groupId)
    store.startEdit("b")
    store.change({ ...store.form.value!, name: "Typed" })
    store.startEdit("b")
    expect(store.form.value?.name).toBe("Typed")

    store.revert()
    store.tags.value = [item("b", "Renamed elsewhere", 2), item("a", "alpha")]
    store.startEdit("b")
    expect(store.form.value).toMatchObject({ name: "Renamed elsewhere", version: 2 })
  })

  it("refuses an empty name without calling the server", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startCreate()
    expect(await store.save()).toBeNull()
    expect(store.formErrors.value.name).toBe(TAG_MESSAGES.nameRequired)
    expect(calls).toEqual([])
  })

  it("renames a tag at the version the person opened", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startEdit("b")
    store.change({ ...store.form.value!, name: "Gamma" })
    await store.save()
    expect(calls[0]).toEqual({
      name: "update",
      input: { groupId, id: "b", name: "Gamma", color: "#4b5563", version: 1 },
    })
  })

  it("puts a taken name on the name field and keeps the form open", async () => {
    const { store } = harness({ create: () => Promise.reject(refused("TAG_NAME_TAKEN")) })
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "alpha" })
    expect(await store.save()).toBeNull()
    expect(store.formErrors.value.name).toBe(TAG_MESSAGES.nameTaken)
    expect(store.form.value).not.toBeNull()
  })

  it("reads again when the tag moved on, and shows it as it is now with a message", async () => {
    let reads = 0
    const { store } = harness({
      fetchList: () => (reads++, Promise.resolve([item("a", reads > 1 ? "Alpha 2" : "alpha", 5)])),
      update: () => Promise.reject(refused("VERSION_CONFLICT")),
    })
    await store.open(groupId)
    store.startEdit("a")
    store.change({ ...store.form.value!, name: "Mine" })
    expect(await store.save()).toBeNull()
    expect(store.formErrors.value.form).toBe(TAG_MESSAGES.conflict)
    expect(store.form.value).toMatchObject({ id: "a", name: "Alpha 2", version: 5 })
    expect(store.unsaved.value).toBe(false)
    expect(reads).toBe(2)
  })

  it("closes the editor and says the tag was deleted when a rename finds it gone", async () => {
    let reads = 0
    const { store } = harness({
      fetchList: () => Promise.resolve(reads++ ? [item("b", "Beta")] : [item("a"), item("b")]),
      update: () => Promise.reject(refused("TAG_NOT_FOUND")),
    })
    await store.open(groupId)
    store.startEdit("a")
    expect(await store.save()).toBeNull()
    expect(store.formErrors.value.form).toBe(TAG_MESSAGES.gone)
    expect(store.form.value).toBeNull()
    expect(store.tags.value.map((tag) => tag.id)).toEqual(["b"])
  })

  it("deletes a tag at its version, drops it from the list and closes its editor", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startEdit("a")
    expect(await store.remove("a")).toBe(true)
    expect(store.form.value).toBeNull()
    expect(calls).toEqual([{ name: "delete", input: { groupId, id: "a", version: 1 } }])
    expect(store.tags.value.map((tag) => tag.id)).toEqual(["b"])
  })

  it("says the tag is gone when a delete finds it deleted", async () => {
    const { store } = harness({ delete: () => Promise.reject(refused("TAG_NOT_FOUND")) })
    await store.open(groupId)
    expect(await store.remove("a")).toBe(false)
    expect(store.listError.value).toBe(TAG_MESSAGES.gone)
  })
})
