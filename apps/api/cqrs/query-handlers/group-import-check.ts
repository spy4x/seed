import { GroupImportCheckQuery } from "@domain/groups"
import type { QueryHandler } from "@spy4x/platform/cqrs"
import { createGroupImportCheckHandler } from "../../features/groups/files.ts"
import { groupFileDependencies } from "../group-file-dependencies.ts"

export const groupImportCheckHandler: QueryHandler<GroupImportCheckQuery> =
  createGroupImportCheckHandler(groupFileDependencies)
