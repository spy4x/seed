import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import {
  assertCanReadTags,
  assertCanWriteTags,
  TagCreateCommand,
  TagDeleteCommand,
  TagError,
  TagGetQuery,
  TagListQuery,
  type TagRepository,
  TagUpdateCommand,
} from "@domain/tags"
import type { GroupRoleLookup } from "@domain/notes"

/** What every tag handler needs: the tags, and the actor's role in the tag's group. */
export interface TagHandlerDependencies {
  tags: TagRepository
  groups: GroupRoleLookup
}

/**
 * The tag handlers. Each one decides who may act before it touches a tag: every member of the
 * group reads, an editor or above writes, and a stranger is told the group does not exist. Session
 * strength is checked earlier, by the session gate on both buses.
 */
export function createTagCreateHandler(
  { tags, groups }: TagHandlerDependencies,
): CommandHandler<TagCreateCommand> {
  return async ({ data }) => {
    assertCanWriteTags(await groups.roleOf(data.groupId, data.actor.userId))
    return await tags.create(
      {
        groupId: data.groupId,
        id: data.id,
        name: data.name,
        color: data.color,
        requestId: data.requestId,
      },
      data.actor.userId,
    )
  }
}

export function createTagUpdateHandler(
  { tags, groups }: TagHandlerDependencies,
): CommandHandler<TagUpdateCommand> {
  return async ({ data }) => {
    assertCanWriteTags(await groups.roleOf(data.groupId, data.actor.userId))
    const tag = await tags.update(
      {
        groupId: data.groupId,
        id: data.id,
        name: data.name,
        color: data.color,
        expectedVersion: data.version,
        requestId: data.requestId,
      },
      data.actor.userId,
    )
    return { tag }
  }
}

export function createTagDeleteHandler(
  { tags, groups }: TagHandlerDependencies,
): CommandHandler<TagDeleteCommand> {
  return async ({ data }) => {
    assertCanWriteTags(await groups.roleOf(data.groupId, data.actor.userId))
    const tag = await tags.delete(
      {
        groupId: data.groupId,
        id: data.id,
        expectedVersion: data.version,
        requestId: data.requestId,
      },
      data.actor.userId,
    )
    return { tag }
  }
}

export function createTagListHandler(
  { tags, groups }: TagHandlerDependencies,
): QueryHandler<TagListQuery> {
  return async ({ data }) => {
    assertCanReadTags(await groups.roleOf(data.groupId, data.actor.userId))
    return { tags: await tags.list(data.groupId) }
  }
}

export function createTagGetHandler(
  { tags, groups }: TagHandlerDependencies,
): QueryHandler<TagGetQuery> {
  return async ({ data }) => {
    assertCanReadTags(await groups.roleOf(data.groupId, data.actor.userId))
    const tag = await tags.get(data.groupId, data.id)
    if (!tag) throw new TagError("TAG_NOT_FOUND", "Tag not found")
    return { tag }
  }
}
