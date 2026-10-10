import {
  GroupCreateCommand,
  GroupDeleteCommand,
  GroupDeletedListQuery,
  GroupError,
  GroupGetQuery,
  GroupLeaveCommand,
  GroupMemberRemoveCommand,
  GroupMemberRoleCommand,
  GroupMembersQuery,
  GroupMoveAllCommand,
  GroupRenameCommand,
  GroupRestoreCommand,
  GroupSelectCommand,
  GroupSelectedQuery,
  GroupUpdateDetailsCommand,
  parseCreateGroupRequest,
  parseGroupDetailsRequest,
  parseGroupId,
  parseGroupIdRequest,
  parseMemberRequest,
  parseMemberRoleRequest,
  parseMoveAllRequest,
  parseRenameGroupRequest,
} from "@domain/groups"
import type {
  DeletedGroupSummary,
  GroupCreateResult,
  GroupGetResult,
  GroupMembersResult,
  GroupMemberSummary,
  GroupMoveAllResult,
  GroupSummary,
  SelectedGroup,
} from "@domain/groups"
import type { Actor } from "@domain/identity"
import type { Operations } from "@spy4x/realtime/operations"
import { type GroupListDependencies, listGroupsPage, parseListPayload } from "./list.ts"

/** What the group socket requests need from the app. */
export interface GroupOperationDependencies extends GroupListDependencies {
  create(command: GroupCreateCommand): Promise<GroupCreateResult>
  get(query: GroupGetQuery): Promise<GroupGetResult>
  select(command: GroupSelectCommand): Promise<SelectedGroup>
  selected(query: GroupSelectedQuery): Promise<SelectedGroup>
  rename(command: GroupRenameCommand): Promise<{ group: GroupSummary }>
  updateDetails(command: GroupUpdateDetailsCommand): Promise<{ group: GroupSummary }>
  delete(command: GroupDeleteCommand): Promise<{ group: DeletedGroupSummary }>
  restore(command: GroupRestoreCommand): Promise<{ group: GroupSummary }>
  deleted(query: GroupDeletedListQuery): Promise<{ groups: DeletedGroupSummary[] }>
  members(query: GroupMembersQuery): Promise<GroupMembersResult>
  setRole(command: GroupMemberRoleCommand): Promise<{ member: GroupMemberSummary }>
  removeMember(command: GroupMemberRemoveCommand): Promise<{ removed: true }>
  leave(command: GroupLeaveCommand): Promise<{ left: true }>
  moveAll(command: GroupMoveAllCommand): Promise<GroupMoveAllResult>
}

/**
 * The group commands and queries the socket serves. Each parses its payload with the same code the
 * REST route uses and dispatches on the same bus; none holds a business rule or an authorization
 * check of its own.
 */
export function createGroupOperations(dependencies: GroupOperationDependencies): Operations<Actor> {
  return {
    "group.create": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const input = parseCreateGroupRequest(payload)
        return await dependencies.create(
          new GroupCreateCommand({
            actor,
            id: input.id,
            name: input.name,
            requestId,
            idempotencyKey,
          }),
        )
      },
    },
    "group.get": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const keys = payload && typeof payload === "object" ? Object.keys(payload) : []
        if (keys.length !== 1 || keys[0] !== "groupId") {
          throw new GroupError("INVALID_REQUEST", "Expected exactly groupId")
        }
        const groupId = parseGroupId((payload as { groupId: unknown }).groupId)
        return await dependencies.get(new GroupGetQuery({ actor, groupId }))
      },
    },
    "group.select": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.select(
          new GroupSelectCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.rename": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, name } = parseRenameGroupRequest(payload)
        return await dependencies.rename(
          new GroupRenameCommand({ actor, groupId, name, requestId, idempotencyKey }),
        )
      },
    },
    "group.updateDetails": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, ...details } = parseGroupDetailsRequest(payload)
        return await dependencies.updateDetails(
          new GroupUpdateDetailsCommand({
            actor,
            groupId,
            ...details,
            requestId,
            idempotencyKey,
          }),
        )
      },
    },
    "group.delete": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.delete(
          new GroupDeleteCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.restore": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.restore(
          new GroupRestoreCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.members": {
      kind: "query",
      handle: async ({ actor, payload }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.members(new GroupMembersQuery({ actor, groupId }))
      },
    },
    "group.setRole": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, userId, role } = parseMemberRoleRequest(payload)
        return await dependencies.setRole(
          new GroupMemberRoleCommand({ actor, groupId, userId, role, requestId, idempotencyKey }),
        )
      },
    },
    "group.removeMember": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, userId } = parseMemberRequest(payload)
        return await dependencies.removeMember(
          new GroupMemberRemoveCommand({ actor, groupId, userId, requestId, idempotencyKey }),
        )
      },
    },
    "group.leave": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId } = parseGroupIdRequest(payload)
        return await dependencies.leave(
          new GroupLeaveCommand({ actor, groupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.moveAll": {
      kind: "command",
      handle: async ({ actor, requestId, payload, idempotencyKey }) => {
        const { groupId, toGroupId } = parseMoveAllRequest(payload)
        return await dependencies.moveAll(
          new GroupMoveAllCommand({ actor, groupId, toGroupId, requestId, idempotencyKey }),
        )
      },
    },
    "group.deleted": {
      kind: "query",
      handle: async ({ actor }) => await dependencies.deleted(new GroupDeletedListQuery({ actor })),
    },
    "group.selected": {
      kind: "query",
      handle: async ({ actor }) => await dependencies.selected(new GroupSelectedQuery({ actor })),
    },
    "group.list": {
      kind: "query",
      handle: async ({ actor, payload }) =>
        await listGroupsPage(dependencies, actor, parseListPayload(payload)),
    },
  }
}
