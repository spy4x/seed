import type { MovableAggregate } from "@server/groups/movable.ts"
import { moveNoteRows } from "./postgres-note-repository.ts"

/**
 * Notes in "move all of a group's data": every live note of the source moves to the target through
 * the same code as a move of chosen notes (`PostgresNoteRepository.move`), counted against the
 * target's `maxNotes`. Deleted notes stay behind and go with the group.
 */
export const noteMovable: MovableAggregate = {
  kind: "notes",
  moveAll: (transaction, context) =>
    moveNoteRows(transaction, {
      fromGroupId: context.fromGroupId,
      toGroupId: context.toGroupId,
      noteIds: null,
      actorId: context.actorId,
      changeSequence: context.changeSequence,
      allowance: context.allowances.maxNotes ?? null,
      targetRole: context.targetRole,
      requestId: context.requestId,
    }),
}
