import { GroupExportCommand, GroupImportCommand } from "@domain/groups"
import type { CommandHandler } from "@spy4x/platform/cqrs"
import { createGroupExportHandler, createGroupImportHandler } from "../../features/groups/files.ts"
import { groupFileDependencies } from "../group-file-dependencies.ts"

export const groupExportHandler: CommandHandler<GroupExportCommand> = createGroupExportHandler(
  groupFileDependencies,
)

export const groupImportHandler: CommandHandler<GroupImportCommand> = createGroupImportHandler(
  groupFileDependencies,
)
