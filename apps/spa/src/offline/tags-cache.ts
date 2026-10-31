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

/** The tags the server sent, kept on this device for one signed-in user, as `NotesCache`. */
export interface TagsCache {
  /** A group's tags on the device, each with the count of the device's notes that carry it. */
  readTags(groupId: string): Promise<TagItem[]>
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
