import { entitlementsOf, FREE_PLAN_ID } from "@domain/billing"
import type { GroupFileHandlerDependencies } from "../features/groups/files.ts"
import { billingSetup } from "../services/billing.ts"
import { db } from "../services/db.ts"

/**
 * What the export and import handlers run on. A new group has no subscription, so it starts on the
 * free plan, whose caps an import must fit.
 */
export const groupFileDependencies: GroupFileHandlerDependencies = {
  roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  porter: db.groupFiles,
  newGroupAllowances: () => entitlementsOf(FREE_PLAN_ID, billingSetup.provider !== null).limits,
}
