import { GroupChangesQuery } from "@domain/groups"
import { db } from "../../services/db.ts"
import { createGroupChangesHandler } from "../../features/groups/handlers.ts"
import type { QueryHandler } from "@spy4x/platform/cqrs"

export const groupChangesHandler: QueryHandler<GroupChangesQuery> = createGroupChangesHandler(
  db.group,
  db.groupChanges,
)
