import type { TagItem } from "../state/tags.ts"
import type { TagsCache } from "./tags-cache.ts"

/** A `TagsCache` in memory, for the tests of the offline layer: Deno has no IndexedDB. */
export function createMemoryTagsCache(): TagsCache {
  let tags: TagItem[] = []
  return {
    readTags: (groupId) =>
      Promise.resolve(tags.filter((tag) => tag.groupId === groupId).map((t) => ({ ...t }))),
    replaceTags(groupId, next) {
      tags = [...tags.filter((tag) => tag.groupId !== groupId), ...next.map((t) => ({ ...t }))]
      return Promise.resolve()
    },
    putTag(tag) {
      const at = tags.findIndex((existing) => existing.id === tag.id)
      if (at === -1) tags = [{ ...tag }, ...tags]
      else tags[at] = { ...tag }
      return Promise.resolve()
    },
    removeTag(tagId) {
      tags = tags.filter((tag) => tag.id !== tagId)
      return Promise.resolve()
    },
    clear() {
      tags = []
      return Promise.resolve()
    },
  }
}
