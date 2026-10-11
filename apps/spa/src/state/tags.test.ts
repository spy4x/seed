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
    color: "gray",
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

  it("creates a tag with a new id and keeps the list sorted by name", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "  Cherry  " })
    expect(await store.save()).toBe(true)
    expect(calls).toEqual([{
      name: "create",
      input: { groupId, id: "new-1", name: "Cherry", color: "gray" },
    }])
    expect(store.tags.value.map((tag) => tag.name)).toEqual(["alpha", "Beta", "Cherry"])
    expect(store.form.value).toBeNull()
  })

  it("refuses an empty name without calling the server", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    store.startCreate()
    expect(await store.save()).toBe(false)
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
      input: { groupId, id: "b", name: "Gamma", color: "gray", version: 1 },
    })
  })

  it("puts a taken name on the name field and keeps the form open", async () => {
    const { store } = harness({ create: () => Promise.reject(refused("TAG_NAME_TAKEN")) })
    await store.open(groupId)
    store.startCreate()
    store.change({ ...store.form.value!, name: "alpha" })
    expect(await store.save()).toBe(false)
    expect(store.formErrors.value.name).toBe(TAG_MESSAGES.nameTaken)
    expect(store.form.value).not.toBeNull()
  })

  it("closes the form and reads again when the tag moved on", async () => {
    let reads = 0
    const { store } = harness({
      fetchList: () => (reads++, Promise.resolve([item("a", "alpha", 5)])),
      update: () => Promise.reject(refused("VERSION_CONFLICT")),
    })
    await store.open(groupId)
    store.startEdit("a")
    await store.save()
    expect(store.listError.value).toBe(TAG_MESSAGES.conflict)
    expect(store.form.value).toBeNull()
    expect(reads).toBe(2)
  })

  it("says above the list that the tag was deleted when a rename finds it gone", async () => {
    const { store } = harness({ update: () => Promise.reject(refused("TAG_NOT_FOUND")) })
    await store.open(groupId)
    store.startEdit("a")
    expect(await store.save()).toBe(false)
    expect(store.listError.value).toBe(TAG_MESSAGES.gone)
    expect(store.form.value).toBeNull()
  })

  it("deletes a tag at its version and drops it from the list", async () => {
    const { store, calls } = harness()
    await store.open(groupId)
    expect(await store.remove("a")).toBe(true)
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
