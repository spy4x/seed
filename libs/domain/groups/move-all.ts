import type { Command } from "@spy4x/platform/cqrs"
import type { Actor } from "@domain/identity"
import { canMutateNotes, GroupError, type GroupRole, parseGroupId } from "./+lib.ts"

/**
 * The events a move of all of a group's data writes, once per group: to the source's activity log
 * and change sequence ("out") and to the target's ("in"). A product's aggregates add no event of
 * their own to this move; they only register what moves (`docs/aggregate-lifecycle.md`).
 */
export const GROUP_DATA_EVENTS = {
  movedOut: "group.data_moved_out",
  movedIn: "group.data_moved_in",
} as const

export interface GroupMoveAllPayload {
  actor: Actor
  /** The group whose data moves out. */
  groupId: string
  /** The group the data goes to. The actor needs an editor's rights in both. */
  toGroupId: string
  requestId?: string
  /** Makes a retry of this command safe; see the idempotency middleware on the command bus. */
  idempotencyKey?: string
}

/** What a move of all of a group's data moved: the total, and how many of each kind. */
export interface GroupMoveAllResult {
  moved: number
  /** One entry per registered aggregate (`MovableAggregate.kind`), such as `{ notes: 12 }`. */
  counts: Record<string, number>
}

/**
 * Moves every registered aggregate of one group into another, all or nothing: either all of it
 * moves, or the move is refused and nothing does. Each moved entity keeps its id and its history.
 * It counts against every cap of the target group's plan (`maxNotes` for notes), and a group with
 * nothing to move is refused with `NOTHING_TO_MOVE`. It does not delete the source group; that stays a
 * separate, confirmed step.
 */
export class GroupMoveAllCommand implements Command<GroupMoveAllPayload, GroupMoveAllResult> {
  __resultType?: GroupMoveAllResult
  /** Every cap of the target group's plan, set by the entitlement gate; `null` is no cap. */
  allowances?: MoveAllAllowances
  constructor(public data: GroupMoveAllPayload) {}
}

/** The target group's caps by name (`maxNotes`), as the entitlement gate read them; `null` is no cap. */
export type MoveAllAllowances = Readonly<Record<string, number | null>>

export interface GroupMoveAllInput {
  fromGroupId: string
  toGroupId: string
  requestId?: string
}

/** Where a move of all of a group's data is made. The handler checks the rights first. */
export interface GroupDataMover {
  /**
   * Throws `GROUP_NOT_FOUND` or `ROLE_INSUFFICIENT` unless the actor is an editor or above in both
   * groups (checked on the locked membership rows), `NOTHING_TO_MOVE` when the source holds no
   * data, and a `PlanError` when the target would pass one of `allowances`. Records one change
   * and one audit event on each group.
   */
  moveAll(
    input: GroupMoveAllInput,
    actorId: number,
    allowances: MoveAllAllowances,
  ): Promise<GroupMoveAllResult>
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === keys.join(",")
}

/** The body of `POST /api/groups/:groupId/move-all`: exactly `{ toGroupId }`. */
export function parseMoveAllBody(value: unknown, fromGroupId: string): { toGroupId: string } {
  if (!exactKeys(value, ["toGroupId"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly toGroupId")
  }
  return parseTarget(value.toGroupId, fromGroupId)
}

/** The socket payload of `group.moveAll`: exactly `{ groupId, toGroupId }`. */
export function parseMoveAllRequest(
  value: unknown,
): { groupId: string; toGroupId: string } {
  if (!exactKeys(value, ["groupId", "toGroupId"])) {
    throw new GroupError("INVALID_REQUEST", "Expected exactly groupId and toGroupId")
  }
  const groupId = parseGroupId(value.groupId)
  return { groupId, ...parseTarget(value.toGroupId, groupId) }
}

function parseTarget(value: unknown, fromGroupId: string): { toGroupId: string } {
  const toGroupId = parseGroupId(value)
  if (toGroupId === fromGroupId) {
    throw new GroupError("SAME_GROUP", "The data is in that group already")
  }
  return { toGroupId }
}

/**
 * Throws unless `role` may move the group's data out of, or into, a group: an editor or above, as
 * for writing a note. `null` means the actor is not a member, which answers "group not found" so a
 * stranger cannot tell a group exists.
 */
export function assertCanMoveGroupData(role: GroupRole | null): void {
  if (role === null) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  if (!canMutateNotes(role)) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only an editor can move the group's data")
  }
}
