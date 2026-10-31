import type { ChangesAggregate } from "@server/groups/group-changes.ts"
import { PostgresTagRepository } from "./postgres-tag-repository.ts"

/**
 * Tags in the changes pull of a group: the tags written after the cursor. A deleted tag is a
 * tombstone. Its links go with it and no note's sequence moves (ADR 003, section 5, rule 3), so a
 * device drops the ids of tags it no longer holds from its notes.
 */
export const tagChanges: ChangesAggregate = {
  kind: "tags",
  sequences: (sql, groupId, after) =>
    sql`
      SELECT change_sequence AS sequence FROM tags
      WHERE group_id = ${groupId} AND change_sequence > ${after}
    `,
  rows: (sql, groupId, after, through) =>
    new PostgresTagRepository(sql).listChanged(groupId, after, through),
}
