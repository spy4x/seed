import type postgres from "postgres"
import { TAG_MAX_PER_GROUP, TagError } from "@domain/tags"
import type { MovableAggregate, MoveAllContext } from "@server/groups/movable.ts"

/**
 * Moves every tag of the source group into the target, in the move's transaction, and returns how
 * many left the source. A tag whose name the target has already (compared without regard to case,
 * as the group's unique index does) joins that tag: its notes link to the target's tag and the
 * source's row goes. Every other tag changes group, keeping its id, its creator and its history;
 * its version grows by one and it is stamped with the target's change.
 *
 * It runs before the notes (`MOVABLE_AGGREGATES`), so the live notes, which move next, already
 * point at the target's tags and `mapTagsOnMove` finds nothing left to copy. A note in the trash
 * stays in the source and loses its links to the tags that left: a link never crosses groups.
 *
 * The target's cap (`TAG_MAX_PER_GROUP`) is counted after the move, under the lock on the target
 * that a `tag.create` there waits for. A move that would pass it is refused whole with
 * `TAG_LIMIT_REACHED`, and the caller's transaction takes everything back. A move that only joins
 * tags the target has is never refused.
 */
export async function moveAllTagRows(
  transaction: postgres.TransactionSql,
  context: Pick<MoveAllContext, "fromGroupId" | "toGroupId" | "actorId" | "changeSequence">,
): Promise<number> {
  const { fromGroupId, toGroupId } = context
  await transaction`
    INSERT INTO note_tags (note_id, tag_id)
    SELECT links.note_id, target.id
    FROM note_tags links
    INNER JOIN tags source ON source.id = links.tag_id AND source.group_id = ${fromGroupId}
    INNER JOIN tags target
      ON target.group_id = ${toGroupId} AND lower(target.name) = lower(source.name)
    ON CONFLICT DO NOTHING
  `
  const joined = await transaction`
    DELETE FROM tags source
    USING tags target
    WHERE source.group_id = ${fromGroupId}
      AND target.group_id = ${toGroupId}
      AND lower(target.name) = lower(source.name)
    RETURNING source.id
  `
  const moved = await transaction`
    UPDATE tags
    SET group_id = ${toGroupId},
        version = version + 1,
        updated_by_user_id = ${context.actorId},
        updated_at = CURRENT_TIMESTAMP,
        change_sequence = ${context.changeSequence}::bigint
    WHERE group_id = ${fromGroupId}
    RETURNING id
  `
  if (moved.length > 0) {
    const [{ count }] = await transaction<{ count: number }[]>`
      SELECT count(*)::int AS count FROM tags WHERE group_id = ${toGroupId}
    `
    if (count > TAG_MAX_PER_GROUP) {
      throw new TagError(
        "TAG_LIMIT_REACHED",
        `The other group has no room for these tags: it can hold ${TAG_MAX_PER_GROUP}`,
      )
    }
  }
  await transaction`
    DELETE FROM note_tags
    USING notes, tags
    WHERE note_tags.note_id = notes.id
      AND notes.group_id = ${fromGroupId}
      AND notes.deleted_at IS NOT NULL
      AND note_tags.tag_id = tags.id
      AND tags.group_id = ${toGroupId}
  `
  return joined.length + moved.length
}

/**
 * Tags in "move all of a group's data" (#357, decision 8): every tag moves, the ones no note uses
 * too, so the emptied group keeps none. See {@link moveAllTagRows}.
 */
export const tagMovable: MovableAggregate = {
  kind: "tags",
  moveAll: (transaction, context) => moveAllTagRows(transaction, context),
}
