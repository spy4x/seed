import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections } from "@spy4x/realtime/collections"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import type { TagItem, TagsDependencies } from "../state/tags.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import type { TagPayload } from "./tags-cache.ts"
import { offlineTags, tagsCollection } from "./tags-collection.ts"

const groupId = "g-1"

function tag(id: string, name = id, version = 1): TagItem {
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

/** The tags of user 1 on a device in memory, with a socket the test switches off and on. */
function layerWith(state: { socket: boolean }) {
  const tagsCache = createMemoryTagsCache()
  const calls: CallPort = {
    command: (_name, payload) =>
      Promise.resolve({ tag: tag(String((payload as { id: string }).id), "sent") }),
    query: () => Promise.reject(new Error("the test reads no tag")),
  }
  const definition = tagsCollection({
    userId: 1,
    cache: tagsCache,
    store: createMemoryOutboxStore<TagPayload, TagItem>(),
  })
  const collections = createCollections({
    collections: [definition],
    calls,
    canSend: () => state.socket,
    now: () => "2026-10-03T00:00:00.000Z",
  })
  return { tagsCache, tags: collections.get(definition) }
}

/** Server-side dependencies whose network the test switches off and on. */
function network(list: TagItem[]) {
  const state = { up: true }
  const online: TagsDependencies = {
    fetchList() {
      return state.up ? Promise.resolve(list) : Promise.reject(new TypeError("Failed to fetch"))
    },
    create: () => Promise.reject(new Error("the store must not call the network to write")),
    update: () => Promise.reject(new Error("the store must not call the network to write")),
    delete: () => Promise.reject(new Error("the store must not call the network to write")),
    newId: () => "new-id",
  }
  return { state, online }
}

describe("tags with the offline layer", () => {
  it("answers the list from the device when the server is unreachable", async () => {
    const { state, online } = network([tag("b", "Beta"), tag("a", "Alpha")])
    const layer = layerWith({ socket: false })
    const deps = offlineTags(online, () => layer)
    await deps.fetchList(groupId)
    state.up = false

    const shown = await deps.fetchList(groupId)

    expect(shown.map((t) => t.name)).toEqual(["Alpha", "Beta"])
  })

  it("lists a tag created offline at once, sorted by name among the others", async () => {
    const { online } = network([tag("a", "Alpha"), tag("z", "Zulu")])
    const layer = layerWith({ socket: false })
    const deps = offlineTags(online, () => layer)
    await deps.fetchList(groupId)

    await deps.create({ groupId, id: "m", name: "Mid", color: "#1d4ed8" })

    expect((await deps.fetchList(groupId)).map((t) => t.name)).toEqual(["Alpha", "Mid", "Zulu"])
  })

  it("answers the write with the server's tag once it was sent", async () => {
    const { online } = network([])
    const layer = layerWith({ socket: true })
    const deps = offlineTags(online, () => layer)

    const { tag: created } = await deps.create({
      groupId,
      id: "t-1",
      name: "Urgent",
      color: "#b91c1c",
    })

    expect([created.id, created.name]).toEqual(["t-1", "sent"])
    expect(layer.tags.outbox.entries()).toEqual([])
  })

  it("goes to the server alone when no layer runs", async () => {
    const { online } = network([tag("a", "Alpha")])
    const sent: string[] = []
    const recorded: TagsDependencies = {
      ...online,
      create: (input) => (sent.push(`create ${input.id}`), Promise.resolve({ tag: tag(input.id) })),
      update: (input) => (sent.push(`update ${input.id}`), Promise.resolve({ tag: tag(input.id) })),
      delete: (input) => (sent.push(`delete ${input.id}`), Promise.resolve({})),
    }
    const deps = offlineTags(recorded, () => null)

    expect((await deps.fetchList(groupId)).map((t) => t.id)).toEqual(["a"])
    expect(await deps.readLocal?.(groupId)).toEqual([])
    await deps.create({ groupId, id: "n", name: "New", color: "#b91c1c" })
    await deps.update({ groupId, id: "a", name: "Alpha", color: "#b91c1c", version: 1 })
    await deps.delete({ groupId, id: "a", version: 1 })
    expect(sent).toEqual(["create n", "update a", "delete a"])
  })
})
