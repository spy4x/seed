import type postgres from "postgres"
import {
  assertCanMoveGroupData,
  GROUP_DATA_EVENTS,
  type GroupDataMover,
  GroupError,
  type GroupMoveAllInput,
  type GroupMoveAllResult,
  type GroupRole,
  type MoveAllAllowances,
} from "@domain/groups"
import { writeAuditEvent } from "./audit.ts"
import { GroupNotActiveError, lockActorRole, recordGroupChange } from "./group-change-log.ts"
import type { MovableAggregate } from "./movable.ts"

/**
 * Moves all of a group's data to another group in one transaction. Both groups are locked in id
 * order, so two moves in opposite directions wait for each other instead of deadlocking, and each
 * role is read on its locked membership row. Then one change is recorded on each group, every
 * registered aggregate moves its rows, and one audit event per group says how many items moved.
 * Any refusal rolls back the lot.
 */
export class PostgresGroupDataMover implements GroupDataMover {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly movables: readonly MovableAggregate[],
  ) {}

  async moveAll(
    input: GroupMoveAllInput,
    actorId: number,
    allowances: MoveAllAllowances,
  ): Promise<GroupMoveAllResult> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const roles = new Map<string, GroupRole>()
      for (const groupId of [input.fromGroupId, input.toGroupId].sort()) {
        roles.set(groupId, await writerNow(transaction, groupId, actorId))
      }
      await recordGroupChange(transaction, input.fromGroupId, actorId, GROUP_DATA_EVENTS.movedOut)
      const sequence = await recordGroupChange(
        transaction,
        input.toGroupId,
        actorId,
        GROUP_DATA_EVENTS.movedIn,
      )
      const counts: Record<string, number> = {}
      let moved = 0
      for (const movable of this.movables) {
        counts[movable.kind] = await movable.moveAll(transaction, {
          fromGroupId: input.fromGroupId,
          toGroupId: input.toGroupId,
          actorId,
          targetRole: roles.get(input.toGroupId)!,
          changeSequence: sequence,
          allowances,
          requestId: input.requestId,
        })
        moved += counts[movable.kind]
      }
      if (moved === 0) throw new GroupError("NOTHING_TO_MOVE", "The group has no data to move")
      const target = (
        await transaction<{ name: string }[]>`SELECT name FROM groups WHERE id = ${input.toGroupId}`
      )[0]
      // The log of the group the data left names where it went; the other says only how much.
      for (
        const [groupId, kind, details] of [
          [input.fromGroupId, GROUP_DATA_EVENTS.movedOut, {
            ...counts,
            count: moved,
            groupName: target.name,
          }],
          [input.toGroupId, GROUP_DATA_EVENTS.movedIn, { ...counts, count: moved }],
        ] as const
      ) {
        await writeAuditEvent(transaction, {
          eventKind: kind,
          actorId,
          groupId,
          requestId: input.requestId,
          details,
        })
      }
      return { moved, counts }
    })
  }
}

/**
 * Checks, in the move's own transaction, that the actor may still write in the group: the
 * handler's check ran before it, and the owner may have removed or demoted the actor since. A
 * group deleted since is answered as a missing group.
 */
async function writerNow(
  transaction: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole> {
  let role: GroupRole | null
  try {
    role = await lockActorRole(transaction, groupId, actorId)
  } catch (error) {
    if (error instanceof GroupNotActiveError) {
      throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    }
    throw error
  }
  assertCanMoveGroupData(role)
  return role!
}
