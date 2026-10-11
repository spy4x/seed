import type postgres from "postgres"
import type { GroupRole, MoveAllAllowances } from "@domain/groups"

/** What an aggregate's move of a whole group needs to know, in the move's own transaction. */
export interface MoveAllContext {
  fromGroupId: string
  toGroupId: string
  actorId: number
  /** The actor's role in the target group, which a plan refusal needs to tell who may upgrade. */
  targetRole: GroupRole
  /**
   * The sequence of the change recorded on the target group for this move. Rows moved into the
   * target are stamped with it, like any row written in a change.
   */
  changeSequence: string
  /** The target group's caps, as the entitlement gate read them; `null` is no cap. */
  allowances: MoveAllAllowances
  /** The request the move came from, for the audit events an aggregate writes itself. */
  requestId?: string
}

/**
 * An aggregate that joins "move all of a group's data" (`docs/aggregates.md`, "Making an aggregate
 * movable"). The mover locks both groups, checks the actor's rights, records the changes and the
 * audit events, and calls each registered aggregate in the same transaction, so one that throws
 * takes the others' moves back with it.
 */
export interface MovableAggregate {
  /** Names the aggregate in the move's result and its audit details, such as `notes`. */
  kind: string
  /**
   * Moves every live row of the source group into the target, keeping ids and history, and
   * returns how many it moved. It refuses with the aggregate's own cap (a `PlanError`, or a
   * domain error such as a tag's `TAG_LIMIT_REACHED`) when the target would pass it, and moves
   * nothing it cannot move together with what it references.
   */
  moveAll(sql: postgres.TransactionSql, context: MoveAllContext): Promise<number>
}
