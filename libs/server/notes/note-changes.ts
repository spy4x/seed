import type { ChangesAggregate } from "@server/groups/group-changes.ts"
import { PostgresNoteRepository } from "./postgres-note-repository.ts"

/**
 * Notes in the changes pull of a group: the live notes written after the cursor, in the shape a
 * list returns. A deleted note or one moved away is a tombstone (`group_change_tombstones`), never
 * a row, so a deleted note's title and body never reach a device through it.
 */
export const noteChanges: ChangesAggregate = {
  kind: "notes",
  sequences: (sql, groupId, after) =>
    sql`
      SELECT change_sequence AS sequence FROM notes
      WHERE group_id = ${groupId} AND deleted_at IS NULL AND change_sequence > ${after}
    `,
  rows: (sql, groupId, after, through) =>
    new PostgresNoteRepository(sql).listChanged(groupId, after, through),
}
