import { createDataCache } from "@spy4x/platform/browser/data-cache"
import type { OutboxEntry } from "@spy4x/realtime/outbox"
import type { TagColor } from "@domain/tags"
import type { TagItem } from "../state/tags.ts"
import { databasePrefix } from "./notes-cache.ts"

/** What the person wrote in a queued tag write: the outbox's payload. */
export interface TagPayload {
  groupId: string
  name: string
  color: TagColor
}

/** One queued tag write, as the outbox from `@spy4x/realtime/outbox` keeps it. */
export type TagEntry = OutboxEntry<TagPayload, TagItem>

/** The tags the server last sent, kept on this device for one signed-in user. */
export interface TagsCache {
  /** A group's tags as the server last answered, in the server's order. */
  readTags(groupId: string): Promise<TagItem[]>
  /** Replaces a group's tags with a full server answer. */
  replaceTags(groupId: string, tags: readonly TagItem[]): Promise<void>
  putTag(tag: TagItem): Promise<void>
  removeTag(tagId: string): Promise<void>
  /**
   * Drops every tag. The queue is another database and stays. The copy is finished after this: a
   * write that arrives later saves nothing, as with the notes (`NotesCache.clear`).
   */
  clear(): Promise<void>
}

/** The name of the queue database of one user's tags. */
export function tagsQueueDatabase(userId: number): string {
  return `${databasePrefix(userId)}:tags-outbox`
}

/**
 * The tags of one user on this browser, in a database named for the user. Each group is a scope.
 * `indexedDB` defaults to the browser's; a test passes its own.
 */
export function openTagsCache(userId: number, indexedDB?: IDBFactory): TagsCache {
  const tags = createDataCache<TagItem>({
    name: `${databasePrefix(userId)}:tags`,
    getId: (tag) => tag.id,
    indexedDB,
  })
  return {
    readTags: (groupId) => tags.read(groupId),
    replaceTags: (groupId, next) => tags.replace(groupId, next),
    putTag: (tag) => tags.batch([{ op: "put", scope: tag.groupId, item: tag }]),
    async removeTag(tagId) {
      const scopes = await tags.scopes()
      await tags.batch(scopes.map((scope) => ({ op: "delete" as const, scope, id: tagId })))
    },
    // `finish` and not `clearAll`: a late write saves nothing (`openNotesCache`).
    clear: () => tags.finish(),
  }
}
