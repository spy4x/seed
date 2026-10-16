import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { GroupDataMover, GroupRepository } from "@domain/groups"
import { GroupOwnershipTransferredEvent, GroupSelectedEvent } from "../../cqrs/events.ts"
import {
  assertCanChangeRole,
  assertCanDelete,
  assertCanEditDetails,
  assertCanLeave,
  assertCanMoveGroupData,
  assertCanRemoveMember,
  assertCanRename,
  assertCanTransfer,
  assertTransferNameMatches,
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupError,
  GroupGetQuery,
  GroupLeaveCommand,
  GroupListQuery,
  GroupMemberRemoveCommand,
  GroupMemberRoleCommand,
  GroupMembersQuery,
  GroupMoveAllCommand,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
  GroupTransferCommand,
  GroupUpdateDetailsCommand,
} from "@domain/groups"

/**
 * Business logic only. Session strength is enforced by a CQRS middleware that
 * runs on every dispatch, so it is neither repeated here nor skippable by a
 * transport. Group-scoped authorization - membership and role - is a business
 * rule and stays in the repository queries, which are membership-scoped.
 */
export function createGroupCreateHandler(
  repository: GroupRepository,
): CommandHandler<GroupCreateCommand> {
  return async (command) => {
    const { id, name, description, color, emoji, requestId } = command.data
    return await repository.create(
      { id, name, description, color, emoji, requestId },
      command.data.actor.userId,
    )
  }
}

export function createGroupListHandler(
  repository: GroupRepository,
): QueryHandler<GroupListQuery> {
  return async (query) => await repository.listForUser(query.data.actor.userId, query.data.page)
}

/** A group the person is not a member of answers exactly as a missing one: no existence leak. */
export function createGroupGetHandler(
  repository: GroupRepository,
): QueryHandler<GroupGetQuery> {
  return async ({ data }) => {
    const group = await repository.getSummaryForMember(data.groupId, data.actor.userId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/** A group the person is not a member of answers exactly as a missing one: no existence leak. */
export function createGroupSelectHandler(
  repository: GroupRepository,
  { emit }: { emit(event: GroupSelectedEvent): void },
): CommandHandler<GroupSelectCommand> {
  return async ({ data }) => {
    const selected = await repository.select(data.actor.userId, data.groupId)
    if (!selected) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    // After the write: the person's other tabs read the new selection.
    emit(new GroupSelectedEvent({ userId: data.actor.userId, groupId: data.groupId }))
    return selected
  }
}

export function createGroupSelectedHandler(
  repository: GroupRepository,
): QueryHandler<GroupSelectedQuery> {
  return async ({ data }) => await repository.getSelected(data.actor.userId)
}

/**
 * Renames a group. The role is read from the group's membership in Postgres and checked first:
 * an admin or the owner may, a viewer or editor is refused, and a person who is not a member is
 * told the group does not exist.
 */
export function createGroupRenameHandler(
  repository: GroupRepository,
): CommandHandler<GroupRenameCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanRename(access?.role ?? null)
    const group = await repository.rename(
      data.groupId,
      data.name,
      data.actor.userId,
      data.requestId,
    )
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/**
 * Sets a group's description, colour and emoji. The rule is the rename rule: an admin or the owner
 * may, a viewer or editor is refused, and a person who is not a member is told the group does not
 * exist. The repository writes and announces the change like a rename.
 */
export function createGroupUpdateDetailsHandler(
  repository: GroupRepository,
): CommandHandler<GroupUpdateDetailsCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanEditDetails(access?.role ?? null)
    const group = await repository.updateDetails(
      data.groupId,
      { description: data.description, color: data.color, emoji: data.emoji },
      data.actor.userId,
      data.requestId,
    )
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/**
 * Deletes a group, softly: only the owner may, and the repository refuses the owner's last group.
 * Every member's page learns of it from the group's change hint, which the worker announces.
 */
export function createGroupDeleteHandler(
  repository: GroupRepository,
): CommandHandler<GroupDeleteCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanDelete(access?.role ?? null)
    const group = await repository.softDelete(data.groupId, data.actor.userId, data.requestId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

/** Restores a group deleted in the last 30 days: only its owner may. */
export function createGroupRestoreHandler(
  repository: GroupRepository,
): CommandHandler<GroupRestoreCommand> {
  return async ({ data }) => {
    const access = await repository.getRestorableForMember(data.groupId, data.actor.userId)
    assertCanDelete(access?.role ?? null)
    const group = await repository.restore(data.groupId, data.actor.userId, data.requestId)
    if (!group) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { group }
  }
}

export function createGroupDeletedListHandler(
  repository: GroupRepository,
): QueryHandler<GroupDeletedListQuery> {
  return async ({ data }) => ({ groups: await repository.listRestorable(data.actor.userId) })
}

/** The members of a group, for any member; a person who is not one is told it does not exist. */
export function createGroupMembersHandler(
  repository: GroupRepository,
): QueryHandler<GroupMembersQuery> {
  return async ({ data }) => {
    const read = await repository.listMembers(data.groupId, data.actor.userId)
    if (!read) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return read
  }
}

/**
 * Changes a member's role. The owner and an admin may give a role below their own to a member
 * below them; nobody gives or takes the owner role here. Checked first on the roles read now, and
 * again by the repository on locked rows.
 */
export function createGroupMemberRoleHandler(
  repository: GroupRepository,
): CommandHandler<GroupMemberRoleCommand> {
  return async ({ data }) => {
    const actor = await repository.getForMember(data.groupId, data.actor.userId)
    const target = actor ? await repository.getForMember(data.groupId, data.userId) : null
    assertCanChangeRole(actor?.role ?? null, target?.role ?? null, data.role)
    const member = await repository.changeMemberRole(
      data.groupId,
      data.userId,
      data.role,
      data.actor.userId,
      data.requestId,
    )
    if (!member) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { member }
  }
}

/**
 * Removes a member: the owner and an admin may remove a member below them. The removed person's
 * open pages lose the group through the access-lost hint the repository records.
 */
export function createGroupMemberRemoveHandler(
  repository: GroupRepository,
): CommandHandler<GroupMemberRemoveCommand> {
  return async ({ data }) => {
    const actor = await repository.getForMember(data.groupId, data.actor.userId)
    const target = actor ? await repository.getForMember(data.groupId, data.userId) : null
    assertCanRemoveMember(actor?.role ?? null, target?.role ?? null)
    const removed = await repository.removeMember(
      data.groupId,
      data.userId,
      data.actor.userId,
      data.requestId,
    )
    if (!removed) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { removed: true }
  }
}

/** Leaves a group: any member but the owner, and never the person's last group. */
export function createGroupLeaveHandler(
  repository: GroupRepository,
): CommandHandler<GroupLeaveCommand> {
  return async ({ data }) => {
    const access = await repository.getForMember(data.groupId, data.actor.userId)
    assertCanLeave(access?.role ?? null)
    const left = await repository.leave(data.groupId, data.actor.userId, data.requestId)
    if (!left) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { left: true }
  }
}

/**
 * Hands the group to another member. The checks run cheapest first, and the password last, so a
 * request the role or the name already refuses spends no password attempt: only the owner, to a
 * member, with the group's name typed as it is and their current password. The repository checks
 * the roles again on locked rows; the new owner is told by web push after the write.
 */
export function createGroupTransferHandler(
  repository: GroupRepository,
  { checkPassword, emit }: {
    checkPassword(userId: number, password: string): Promise<boolean>
    emit(event: GroupOwnershipTransferredEvent): void
  },
): CommandHandler<GroupTransferCommand> {
  return async ({ data }) => {
    const actorId = data.actor.userId
    const access = await repository.getForMember(data.groupId, actorId)
    const target = await repository.getForMember(data.groupId, data.userId)
    assertCanTransfer(access?.role ?? null, target?.role ?? null)
    assertTransferNameMatches(data.name, access!.group.name)
    if (!await checkPassword(actorId, data.password)) {
      throw new GroupError("PASSWORD_INVALID", "The password is incorrect")
    }
    const moved = await repository.transferOwnership(
      data.groupId,
      data.userId,
      actorId,
      data.requestId,
    )
    if (!moved) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    emit(
      new GroupOwnershipTransferredEvent({
        groupId: data.groupId,
        groupName: access!.group.name,
        newOwnerId: data.userId,
      }),
    )
    return { transferred: true }
  }
}

/**
 * Moving all of a group's data needs an editor's rights in both groups. The source is checked
 * first, so a person who cannot write there is told so before anything about the target; a target
 * the person does not belong to is "group not found". The mover checks both again on locked rows.
 */
export function createGroupMoveAllHandler(
  repository: GroupRepository,
  mover: GroupDataMover,
): CommandHandler<GroupMoveAllCommand> {
  return async (command) => {
    const { data, allowance } = command
    // The gate sets it on every move it lets through; without it the target's cap goes unchecked.
    if (allowance === undefined) {
      throw new Error("GroupMoveAllCommand reached its handler without the entitlement gate")
    }
    const actorId = data.actor.userId
    assertCanMoveGroupData((await repository.getForMember(data.groupId, actorId))?.role ?? null)
    assertCanMoveGroupData((await repository.getForMember(data.toGroupId, actorId))?.role ?? null)
    return await mover.moveAll(
      { fromGroupId: data.groupId, toGroupId: data.toGroupId, requestId: data.requestId },
      actorId,
      { maxNotes: allowance },
    )
  }
}
