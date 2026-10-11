import type { TagHandlerDependencies } from "../features/tags/handlers.ts"
import { db } from "../services/db.ts"

/**
 * What the tag handlers run on: the tags table, and the actor's role read from the group's
 * membership in Postgres (never from a cache, since it decides who may write).
 */
export const tagDependencies: TagHandlerDependencies = {
  tags: db.tag,
  groups: {
    roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  },
}
