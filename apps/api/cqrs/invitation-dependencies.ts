import { entitlementsOf, UNLIMITED } from "@domain/billing"
import { hasProvenAddress, provenAddressOwner } from "@server/auth/email-verification.ts"
import { createMailSender, readMailSetup } from "@server/mail/mail.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import { createRedisRateLimitStore } from "@spy4x/server/kv"
import type { InvitationHandlerDependencies } from "../features/groups/invitations.ts"
import { createInvitationRateLimits } from "../features/groups/invitation-rate-limits.ts"
import { createPlanOf, createSeatPriced } from "../features/billing/config.ts"
import { billingSetup } from "../services/billing.ts"
import { kv } from "../services/cache.ts"
import { config } from "../services/config.ts"
import { db, sql } from "../services/db.ts"
import { eventBus } from "../services/eventBus.ts"
import { log } from "../services/log.ts"

/** The invitation limits, over Valkey like the auth limits. The routes mount two of them. */
export const invitationRateLimits = createInvitationRateLimits({
  ...config.rateLimiter,
  store: (keyPrefix) => createRedisRateLimitStore(kv, { keyPrefix }),
})

/**
 * What the invitation handlers run on. The plan of an invitation's group is read here, the way the
 * entitlement gate reads it.
 */
// The same plan reading, clock and grace period as the entitlement gate's.
const planOf = createPlanOf(db.billing, billingSetup)

export const invitationDependencies: InvitationHandlerDependencies = {
  invitations: new PostgresInvitationRepository(sql),
  ownerOf: (email) => provenAddressOwner(db.authStore, email),
  addressProven: (userId) => hasProvenAddress(db.authStore, userId),
  planOf: async (groupId) => {
    const { limits, features } = billingSetup.provider === null
      ? UNLIMITED
      : entitlementsOf(await planOf(groupId), true)
    return { maxMembers: limits.maxMembers, memberRoles: features.memberRoles }
  },
  seatPriced: createSeatPriced(
    db.billing,
    async (groupId, userId) => (await db.group.getForMember(groupId, userId))?.role ?? null,
    billingSetup.provider !== null,
  ),
  mail: {
    sender: createMailSender(readMailSetup(Deno.env), sql),
    brand: { webAppUrl: config.webAppUrl },
    byAddress: invitationRateLimits.mailByAddress,
    log,
  },
  emit: (event) => eventBus.emit(event),
}
