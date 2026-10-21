import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import {
  assertCanExportGroup,
  GroupExportCommand,
  type GroupFilePorter,
  GroupImportCheckQuery,
  GroupImportCommand,
  type GroupRole,
  type MoveAllAllowances,
} from "@domain/groups"

/** What the export and import handlers run on. */
export interface GroupFileHandlerDependencies {
  /** The actor's role in the group, from Postgres; `null` for a stranger. */
  roleOf(groupId: string, userId: number): Promise<GroupRole | null>
  porter: GroupFilePorter
  /** The caps of the plan a new group starts on: the free plan's, or none while billing is off. */
  newGroupAllowances(): MoveAllAllowances
}

/**
 * Only the owner exports. A stranger is told the group does not exist; any other member is refused
 * with `ROLE_INSUFFICIENT`, before anything is read.
 */
export function createGroupExportHandler(
  dependencies: GroupFileHandlerDependencies,
): CommandHandler<GroupExportCommand> {
  return async ({ data }) => {
    assertCanExportGroup(await dependencies.roleOf(data.groupId, data.actor.userId))
    return await dependencies.porter.exportGroup(data.groupId, data.actor.userId, data.requestId)
  }
}

/** Anyone who may create a group may check a file: it reads no group and writes nothing. */
export function createGroupImportCheckHandler(
  dependencies: GroupFileHandlerDependencies,
): QueryHandler<GroupImportCheckQuery> {
  return ({ data }) =>
    Promise.resolve(dependencies.porter.check(data.file, dependencies.newGroupAllowances()))
}

/** Anyone who may create a group may import one: the new group is theirs, and nothing else moves. */
export function createGroupImportHandler(
  dependencies: GroupFileHandlerDependencies,
): CommandHandler<GroupImportCommand> {
  return async ({ data }) =>
    await dependencies.porter.importGroup(
      { file: data.file, name: data.name, requestId: data.requestId },
      data.actor.userId,
      dependencies.newGroupAllowances(),
    )
}
