import { attachmentRulesOf, entitlementsOf } from "@domain/billing"
import { attachmentKinds } from "@server/attachments/registry.ts"
import type { AttachmentHandlerDependencies } from "../features/attachments/attachments.ts"
import { createPlanOf } from "../features/billing/config.ts"
import { billingSetup } from "../services/billing.ts"
import { db } from "../services/db.ts"
import { files } from "../services/files.ts"
import { config } from "../services/config.ts"

const billingEnabled = billingSetup.provider !== null
const planOf = createPlanOf(db.billing, billingSetup)

/** The attachment kinds the API serves: `attachmentKinds` under the notes' switch. */
export const servedAttachmentKinds = attachmentKinds(config.notes)

/**
 * What the attachment handlers run on: each kind's table, the file store, the actor's role read
 * from Postgres (never a cache, since it decides who may write) and the group's plan, read the way
 * the command bus's plan check reads it.
 */
export const attachmentDependencies: AttachmentHandlerDependencies = {
  kinds: servedAttachmentKinds,
  attachments: (kind) => db.attachments(servedAttachmentKinds, kind),
  files,
  budget: config.attachmentUploadBudget,
  groups: {
    roleOf: async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
  },
  plans: {
    of: async (groupId) => {
      const plan = await planOf(groupId)
      return {
        limits: entitlementsOf(plan, billingEnabled).limits,
        rules: attachmentRulesOf(plan, billingEnabled),
      }
    },
  },
}
