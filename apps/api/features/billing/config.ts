import type { BillingHandlerDependencies } from "./handlers.ts"
import type { BillingSetup } from "@server/billing/setup.ts"
import {
  type BillingRepository,
  effectivePlanId,
  entitlementsOf,
  isSeatBilled,
  type Plan,
  UNLIMITED,
} from "@domain/billing"
import type { InvitationPlan } from "@server/groups/postgres-invitation-repository.ts"
import { canManageInvitations, type GroupRole } from "@domain/groups"

/** What the API decides a group's plan with: the setup's grace period and the system clock. */
export interface PlanClock {
  graceDays: number
  now: () => Date
}

/**
 * The {@link PlanClock} of a running API. The billing read and the command bus's plan check both
 * take it from here, so neither can drift to another clock or grace period.
 */
export function planClockOf(setup: Pick<BillingSetup, "graceDays">): PlanClock {
  return { graceDays: setup.graceDays, now: () => new Date() }
}

/**
 * The settings the billing handlers take from the setup: the {@link PlanClock} and whether a trial
 * asks for a card. The API's wiring spreads this, so a setting the setup reads reaches the handlers.
 */
export function billingSettingsOf(
  setup: Pick<BillingSetup, "graceDays" | "trialRequiresCard">,
): Pick<BillingHandlerDependencies, "graceDays" | "now" | "trialRequiresCard"> {
  return { ...planClockOf(setup), trialRequiresCard: setup.trialRequiresCard }
}

/** The plan a group is on at this moment, for the command bus's plan check. */
export function createPlanOf(
  billing: Pick<BillingRepository, "get">,
  setup: Pick<BillingSetup, "graceDays">,
): (groupId: string) => Promise<string> {
  const { graceDays, now } = planClockOf(setup)
  return async (groupId) => effectivePlanId(await billing.get(groupId), now(), graceDays)
}

/**
 * What a group's plan allows an invitation, as the entitlement gate reads it: the member cap and
 * whether roles other than the default may be given. Everything while billing is off. The accept
 * route and a sign-up by invitation both read it here.
 */
export function createInvitationPlanOf(
  billing: Pick<BillingRepository, "get">,
  setup: Pick<BillingSetup, "graceDays" | "provider">,
): (groupId: string) => Promise<InvitationPlan> {
  const planOf = createPlanOf(billing, setup)
  return async (groupId) => {
    const { limits, features } = setup.provider === null
      ? UNLIMITED
      : entitlementsOf(await planOf(groupId), true)
    return { maxMembers: limits.maxMembers, memberRoles: features.memberRoles }
  }
}

/**
 * Whether a new invitation to the group needs its creator to confirm the per-member price: billing
 * is on, the creator may manage invitations, and the group pays per member. Anyone else learns
 * nothing about the group's bill from the answer. `plans` is the catalog, `PLANS` unless a test
 * passes its own.
 */
export function createSeatPriced(
  billing: Pick<BillingRepository, "get">,
  roleOf: (groupId: string, userId: number) => Promise<GroupRole | null>,
  enabled: boolean,
  plans?: readonly Plan[],
): (groupId: string, userId: number) => Promise<boolean> {
  return async (groupId, userId) => {
    if (!enabled) return false
    const role = await roleOf(groupId, userId)
    if (role === null || !canManageInvitations(role)) return false
    return isSeatBilled(await billing.get(groupId), plans)
  }
}
