import {
  classifyByCode,
  type Collection,
  type CollectionDefinition,
  defineCollection,
} from "@spy4x/realtime/collections"
import type { OutboxStore } from "@spy4x/realtime/outbox"
import { isProxyAnswer, isRefusal, isUnreachable } from "@spy4x/realtime/read-cache"
import { DEFAULT_TAG_COLOR } from "@domain/tags"
import type { TagItem, TagsDependencies } from "../state/tags.ts"
import { type TagEntry, type TagPayload, type TagsCache, tagsQueueDatabase } from "./tags-cache.ts"

/**
 * The tags adapter: what is the tags' own about being offline-writable (ADR 003, level 3), as
 * `notes-collection.ts` is for notes. Tags are registered before notes, so a note created offline
 * can name a tag created offline: the library sends the tag first and holds the note back until
 * the tag has left the queue.
 */

/** The name of the collection, which the notes adapter names as its parent. */
export const TAGS_COLLECTION = "tags"

/** The tags as a collection: a tag is the entity and the row, its name and colour the payload. */
export type TagsCollection = Collection<TagPayload, TagItem, TagItem>

/** What {@link tagsCollection} is built from. */
export interface TagsCollectionOptions {
  userId: number
  /** The device's copy of the tags, kept in step with the server's answers. */
  cache: TagsCache
  /** A queue to use instead of IndexedDB: the tests, which have none. */
  store?: OutboxStore<TagPayload, TagItem>
}

/**
 * Reads a failed tag call: unreachable (try later) or the server's refusal and its code. A write
 * answered `unauthorized` stays queued: the library's default.
 */
export const classifyTagError = classifyByCode({
  version: "VERSION_CONFLICT",
  notFound: "TAG_NOT_FOUND",
  alreadyExists: "ID_ALREADY_EXISTS",
})

/** The tags of one user as an offline-writable collection. */
export function tagsCollection(
  { userId, cache, store }: TagsCollectionOptions,
): CollectionDefinition<TagPayload, TagItem, TagItem> {
  return defineCollection<TagPayload, TagItem, TagItem>({
    name: TAGS_COLLECTION,
    database: tagsQueueDatabase(userId),
    store,
    toCall({ kind, entityId, payload, baseVersion }) {
      const base = { groupId: payload.groupId, id: entityId }
      if (kind === "delete") {
        return { name: "tag.delete", payload: { ...base, version: baseVersion } }
      }
      const fields = { name: payload.name, color: payload.color }
      return kind === "create"
        ? { name: "tag.create", payload: { ...base, ...fields } }
        : { name: "tag.update", payload: { ...base, ...fields, version: baseVersion } }
    },
    toQuery: (id, payload) => ({ name: "tag.get", payload: { groupId: payload.groupId, id } }),
    entityFrom: (answer) => (answer as { tag?: TagItem } | undefined)?.tag,
    classify: classifyTagError,
    // Keys of the `app` catalog, kept with the queued write. `OfflineStatus` shows the one a
    // conflict holds through `messageText`, in the person's language at that time; an entry queued
    // in English before #275 holds English, which it shows as it is. A refusal that carries the
    // server's own words keeps those instead of `rejected`, and they show as they came.
    messages: { version: `TagSync.version`, gone: `TagSync.gone`, rejected: `TagSync.rejected` },
    cache: {
      put: (tag) => cache.putTag(tag),
      remove: (tagId) => cache.removeTag(tagId),
    },
    itemId: (tag) => tag.id,
    // A tag created offline shows with version 0: the server has not seen it.
    queuedItem: (entry) => ({
      id: entry.entityId,
      groupId: entry.payload.groupId,
      name: entry.payload.name,
      color: entry.payload.color,
      version: 0,
      changeSequence: "0",
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: entry.queuedAt,
      updatedAt: entry.queuedAt,
    }),
    applyEdit: (tag, entry) => ({ ...tag, name: entry.payload.name, color: entry.payload.color }),
    inScope: (entry, groupId) => entry.payload.groupId === groupId,
  })
}

/** What the tags dependencies need of the running layer. */
export interface TagsLayer {
  /** The device's copy of the tags. */
  tagsCache: TagsCache
  /** The queue of tag writes and its overlay. */
  tags: TagsCollection
}

function byName(a: TagItem, b: TagItem): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)
}

/**
 * Puts the device's copy and the queue behind the tags store's dependencies, as `offlineNotes`
 * does for notes: a read asks the server and keeps the answer (or answers from the copy when the
 * server is unreachable or a proxy answers for it) with the queued writes applied, and a group the
 * server refuses loses its copy; a write is queued and sent at once when
 * the server is reachable. Without a running layer every call goes to `online` untouched.
 */
export function offlineTags(
  online: TagsDependencies,
  current: () => TagsLayer | null,
): TagsDependencies {
  async function visible(layer: TagsLayer, groupId: string): Promise<TagItem[]> {
    const shown = await layer.tags.overlay(await layer.tagsCache.readTags(groupId), groupId)
    return shown.sort(byName)
  }

  async function answer(
    layer: TagsLayer,
    outcome: Awaited<ReturnType<TagsCollection["outbox"]["submit"]>>,
    groupId: string,
    id: string,
  ): Promise<{ tag: TagItem }> {
    if (outcome.kind === "failed") throw outcome.error
    const tag = (await visible(layer, groupId)).find((candidate) => candidate.id === id)
    if (!tag) throw new Error("The tag is not in the local store")
    return { tag }
  }

  return {
    ...online,
    async fetchList(groupId) {
      const layer = current()
      if (!layer) return await online.fetchList(groupId)
      let base: TagItem[]
      try {
        base = await online.fetchList(groupId)
        await layer.tagsCache.replaceTags(groupId, base)
      } catch (error) {
        // The person left the group, or it is gone: its tags must not come back offline later.
        if (isRefusal(error)) {
          await layer.tagsCache.replaceTags(groupId, []).catch((failure) =>
            console.warn(`The saved tags of group ${groupId} could not be deleted.`, failure)
          )
        }
        // A proxy's answer, such as a 502 during a deploy, is an unreachable server too.
        if (!isUnreachable(error) && !isProxyAnswer(error)) throw error
        base = await layer.tagsCache.readTags(groupId)
      }
      return (await layer.tags.overlay(base, groupId)).sort(byName)
    },
    async create(input) {
      const layer = current()
      if (!layer) return await online.create(input)
      const outcome = await layer.tags.outbox.submit({
        kind: "create",
        entityId: input.id,
        payload: { groupId: input.groupId, name: input.name, color: input.color },
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async update(input) {
      const layer = current()
      if (!layer) return await online.update(input)
      const outcome = await layer.tags.outbox.submit({
        kind: "update",
        entityId: input.id,
        payload: { groupId: input.groupId, name: input.name, color: input.color },
        version: input.version,
      })
      return await answer(layer, outcome, input.groupId, input.id)
    },
    async delete(input) {
      const layer = current()
      if (!layer) return await online.delete(input)
      const known = (await visible(layer, input.groupId)).find((tag) => tag.id === input.id)
      const outcome = await layer.tags.outbox.submit({
        kind: "delete",
        entityId: input.id,
        payload: {
          groupId: input.groupId,
          name: known?.name ?? "",
          color: known?.color ?? DEFAULT_TAG_COLOR,
        },
        version: input.version,
      })
      if (outcome.kind === "failed") throw outcome.error
      return undefined
    },
    async readLocal(groupId) {
      const layer = current()
      return layer ? await visible(layer, groupId) : []
    },
  }
}

export type { TagEntry }
