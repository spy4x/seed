import { expect } from "@std/expect"
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd"
import type { CallPort } from "@spy4x/realtime/calls"
import { createCollections } from "@spy4x/realtime/collections"
import { createMemoryOutboxStore } from "@spy4x/realtime/outbox"
import { type NoteItem, onlineNotes } from "../state/notes.ts"
import { sessionState } from "../state/session.ts"
import { onlineTags, type TagItem } from "../state/tags.ts"
import { createMemoryNotesCache } from "./memory-notes-cache.ts"
import { createMemoryTagsCache } from "./memory-tags-cache.ts"
import type { NotePayload } from "./notes-cache.ts"
import { notesCollection, offlineNotes } from "./notes-collection.ts"
import type { TagPayload } from "./tags-cache.ts"
import { offlineTags, tagsCollection } from "./tags-collection.ts"

/**
 * What the notes and tags lists do with their saved copy when the server answers with an error:
 * the same rules as every other list (`apps/spa/src/state/read-refusals.test.ts`). The readers are
 * the production ones (`onlineNotes`, `onlineTags`) behind the offline layer; only the network is
 * replaced, by a `fetch` that answers with a real `Response`.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const signedOut = sessionState.value
const stamps = {
  version: 1,
  changeSequence: "1",
  createdByUserId: 1,
  updatedByUserId: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
}
const note: NoteItem = { id: "n-1", groupId, title: "Plan", body: "", tagIds: [], ...stamps }
const tag: TagItem = { id: "t-1", groupId, name: "Urgent", color: "#4b5563", ...stamps }

/** A device in memory holding the notes and tags of user 1, with nothing queued. */
function device() {
  const cache = createMemoryNotesCache()
  const tagsCache = createMemoryTagsCache()
  const calls: CallPort = {
    command: () => Promise.reject(new Error("the test writes nothing")),
    query: () => Promise.reject(new Error("the test reads no single note or tag")),
  }
  const tagsDefinition = tagsCollection({
    userId: 1,
    cache: tagsCache,
    store: createMemoryOutboxStore<TagPayload, TagItem>(),
  })
  const notesDefinition = notesCollection({
    userId: 1,
    cache,
    store: createMemoryOutboxStore<NotePayload, NoteItem>(),
  })
  const collections = createCollections({
    collections: [tagsDefinition, notesDefinition],
    calls,
    canSend: () => false,
  })
  return {
    cache,
    tagsCache,
    notes: collections.get(notesDefinition),
    tags: collections.get(tagsDefinition),
  }
}

interface Case {
  name: string
  /** What the server answers to a read that works. */
  body: unknown
  /** Reads the list through the offline layer; rejects when the screen would show an error. */
  read(layer: ReturnType<typeof device>): Promise<string[]>
}

const CASES: Case[] = [
  {
    name: "the notes of a group",
    body: { notes: [note], nextCursor: null },
    read: async (layer) =>
      (await offlineNotes(onlineNotes, () => layer).fetchPage(groupId, null)).notes.map((n) =>
        n.id
      ),
  },
  {
    name: "the tags of a group",
    body: { tags: [tag] },
    read: async (layer) =>
      (await offlineTags(onlineTags, () => layer).fetchList(groupId)).map((t) => t.id),
  },
]

/** A status with the API's error body, a page with that status and no error code, or no network. */
type Answer = number | { proxy: number } | "offline"

describe("the saved notes and tags and the answer of the server", () => {
  const realFetch = globalThis.fetch
  let answer: Answer = 200
  let body: unknown = null

  beforeEach(() => {
    globalThis.fetch = (() => {
      if (answer === "offline") return Promise.reject(new TypeError("Failed to fetch"))
      if (typeof answer === "object") {
        return Promise.resolve(new Response("<h1>Bad Gateway</h1>", { status: answer.proxy }))
      }
      return Promise.resolve(
        answer === 200 ? Response.json(body) : Response.json(
          // The API's own refusal names its reason; `code` is the one its status stands for.
          {
            error: { code: answer === 500 ? "internal" : "forbidden", message: "No", reason: "NO" },
          },
          { status: answer },
        ),
      )
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    sessionState.value = signedOut
  })

  for (const list of CASES) {
    describe(list.name, () => {
      /** One read that worked, then one that got `status`, then the network goes. */
      async function afterAnswer(status: Exclude<Answer, "offline">) {
        body = list.body
        const layer = device()
        answer = 200
        const shownOnline = await list.read(layer)
        answer = status
        const shownThen = await list.read(layer).catch((error: Error) => error)
        answer = "offline"
        return { shownOnline, shownThen, shownOffline: await list.read(layer) }
      }

      for (const status of [401, 403, 404]) {
        it(`are deleted when the server answers ${status}, so they are not shown offline later`, async () => {
          const { shownOnline, shownThen, shownOffline } = await afterAnswer(status)
          expect(shownOnline.length).toBe(1)
          expect(shownThen).toBeInstanceOf(Error)
          expect(shownOffline).toEqual([])
        })
      }

      it("show the error and are kept when the server answers 500 with its error code", async () => {
        const { shownOnline, shownThen, shownOffline } = await afterAnswer(500)
        expect((shownThen as Error).message).toBe("Something went wrong on our side. Try again.")
        expect(shownOffline).toEqual(shownOnline)
      })

      for (const status of [401, 403]) {
        it(`are deleted on a ${status} without an error code`, async () => {
          const { shownOnline, shownOffline } = await afterAnswer({ proxy: status })
          expect(shownOnline.length).toBe(1)
          expect(shownOffline).toEqual([])
        })
      }

      // 502 and a bare 404 are the proxy's during a deploy; the API's own rate limit (429) and
      // unhandled error (500) carry no code either, and are answered the same way.
      for (const status of [502, 404, 429, 500]) {
        it(`are shown and kept on a ${status} without an error code`, async () => {
          const { shownOnline, shownThen, shownOffline } = await afterAnswer({ proxy: status })
          expect(shownOnline.length).toBe(1)
          expect(shownThen).toEqual(shownOnline)
          expect(shownOffline).toEqual(shownOnline)
        })
      }

      it("show the server's refusal and warn when the device cannot delete the copy", async () => {
        body = list.body
        const layer = device()
        answer = 200
        await list.read(layer)
        const broken = () => Promise.reject(new Error("the device is full"))
        layer.cache.replaceNotes = broken
        layer.tagsCache.replaceTags = broken
        const warnings: unknown[][] = []
        const realWarn = console.warn
        console.warn = (...args: unknown[]) => void warnings.push(args)
        try {
          answer = 403
          const shown = await list.read(layer).catch((error: Error) => error)

          expect((shown as Error).message).toBe("No")
          expect(warnings.length).toBe(1)
          expect(String(warnings[0][0])).toContain(`of group ${groupId} could not be deleted`)
          expect((warnings[0][1] as Error).message).toBe("the device is full")
        } finally {
          console.warn = realWarn
        }
      })

      it("keep another group's copy when one group is refused", async () => {
        body = list.body
        const layer = device()
        const other = "0d7d3a3e-4f65-4d0e-9d0c-6a1a3f2b9c11"
        await layer.cache.replaceNotes(other, [{ ...note, id: "n-2", groupId: other }])
        await layer.tagsCache.replaceTags(other, [{ ...tag, id: "t-2", groupId: other }])
        answer = 200
        await list.read(layer)
        answer = 403
        await list.read(layer).catch(() => {})

        expect((await layer.cache.readNotes(other)).map((n) => n.id)).toEqual(["n-2"])
        expect((await layer.tagsCache.readTags(other)).map((t) => t.id)).toEqual(["t-2"])
      })
    })
  }
})
