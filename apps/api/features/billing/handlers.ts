import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { BillingProvider } from "@spy4x/billing"
import {
  assertCanManageBilling,
  assertCanReadBilling,
  BillingCheckoutCommand,
  BillingError,
  BillingGetQuery,
  BillingPortalCommand,
  type BillingRepository,
  BillingTrialQuery,
  type GroupRoleLookup,
  handoverTrialDays,
  hasLiveSubscription,
  LONGEST_TRIAL_DAYS,
  PAID_PLANS,
  type StoredSubscription,
  toGroupBilling,
} from "@domain/billing"

/** What every billing handler needs. */
export interface BillingHandlerDependencies {
  billing: BillingRepository
  groups: GroupRoleLookup
  /** `null` when this deployment takes no payments. */
  provider: BillingProvider | null
  /** The web app's own URL, such as `https://app.example.com`: where the provider sends people back. */
  webAppUrl: string
  /** Where a provider failure is written; the person sees only `PROVIDER_ERROR`. */
  log: (message: string, detail?: unknown) => void
  /** Days a past-due group keeps its plan (`BILLING_GRACE_DAYS`). */
  graceDays: number
  /** Whether a trial's checkout asks for a card (`BILLING_TRIAL_REQUIRES_CARD`). */
  trialRequiresCard: boolean
  /** The current time; tests pass a fixed one. */
  now: () => Date
}

/**
 * The billing handlers. Any member reads the group's plan; only the owner opens checkout or the
 * portal, and a stranger is told the group does not exist. The role is read from Postgres on every
 * call, never from a cache.
 */
export function createBillingGetHandler(
  { billing, groups, provider, graceDays, now }: BillingHandlerDependencies,
): QueryHandler<BillingGetQuery> {
  return async ({ data }) => {
    const role = await groups.roleOf(data.groupId, data.actor.userId)
    assertCanReadBilling(role)
    const [subscription, customerId, members, handedOver] = provider
      ? await Promise.all([
        billing.get(data.groupId),
        billing.customerOf(data.groupId),
        billing.membersOf(data.groupId),
        billing.handedOver(data.groupId),
      ])
      : [null, null, 0, false]
    return {
      billing: toGroupBilling(
        subscription,
        role,
        provider !== null,
        customerId !== null,
        now(),
        graceDays,
        members,
        handedOver,
      ),
    }
  }
}

export function createBillingCheckoutHandler(
  dependencies: BillingHandlerDependencies,
): CommandHandler<BillingCheckoutCommand> {
  return async ({ data }) => {
    const provider = await authorize(dependencies, data.groupId, data.actor.userId)
    const plan = PAID_PLANS.find((candidate) => candidate.id === data.planId)
    if (!plan) throw new BillingError("UNKNOWN_PLAN", "No such plan")
    // A second checkout would start a second subscription and charge twice; the portal changes the
    // plan of the one the group has. Any subscription that is not cancelled counts, even a paused,
    // incomplete or unknown-price one that shows as the free plan. The one exception is a
    // subscription the previous owner pays after a transfer and has cancelled at its period's end:
    // the new owner checks out with a customer of their own, first charged when it ends (#250).
    const [current, customerId, handedOver] = await Promise.all([
      dependencies.billing.get(data.groupId),
      dependencies.billing.customerOf(data.groupId),
      dependencies.billing.handedOver(data.groupId),
    ])
    if (hasLiveSubscription(current) && !(handedOver && current!.cancelAtPeriodEnd)) {
      throw new BillingError("ALREADY_SUBSCRIBED", "The group already has a subscription")
    }
    const result = await provider.createCheckout({
      planId: data.planId,
      successUrl: appUrl(dependencies, `/groups/${data.groupId}/billing?checkout=done`),
      cancelUrl: appUrl(dependencies, `/groups/${data.groupId}/billing`),
      reference: data.groupId,
      // A per-member plan starts with a seat for every member; the worker keeps it in step after.
      ...(plan.perSeat ? { quantity: await dependencies.billing.membersOf(data.groupId) } : {}),
      // Only a group's first checkout starts with a trial: a group that ever paid, or tried, has a
      // customer already. After a transfer the new owner gets no customer of the old owner's, and
      // a trial only for the plan time the old owner already paid for, with a card always asked.
      // Otherwise the trial is the owner's one trial, which goes to the first group they check out.
      ...(customerId
        ? { customerId }
        : handedOver
        ? handoverTrial(current, dependencies)
        : plan.trialDays > 0 &&
            await dependencies.billing.claimTrial(data.actor.userId, data.groupId)
        ? trialOf(plan.trialDays, dependencies.trialRequiresCard)
        : {}),
      // The client's key is scoped to the group and the person, so one person's key can never
      // replay a checkout the provider made for another group or person.
      ...(data.idempotencyKey
        ? { idempotencyKey: `${data.groupId}:${data.actor.userId}:${data.idempotencyKey}` }
        : {}),
    })
    if (!result.ok) {
      dependencies.log("error: billing checkout failed", result.error)
      throw new BillingError("PROVIDER_ERROR", "The payment provider did not answer")
    }
    return { url: result.value.url }
  }
}

/**
 * The actor's own trial: whether it went to a group already, and how long it lasts. Any signed-in
 * person may ask about their own; nobody can ask about anyone else's.
 */
export function createBillingTrialHandler(
  { billing, provider }: BillingHandlerDependencies,
): QueryHandler<BillingTrialQuery> {
  return async ({ data }) => {
    const groupId = provider === null ? null : await billing.trialGroupOf(data.actor.userId)
    return {
      trial: {
        enabled: provider !== null,
        used: groupId !== null,
        groupId,
        days: provider === null ? 0 : LONGEST_TRIAL_DAYS,
      },
    }
  }
}

/** The new owner's trial after a transfer: the old owner's remaining plan time, or none. */
function handoverTrial(
  current: StoredSubscription | null,
  { now, graceDays }: BillingHandlerDependencies,
): { trialDays?: number } {
  const days = handoverTrialDays(current, now(), graceDays)
  return days === null ? {} : { trialDays: days }
}

/** The checkout's trial fields: none for a plan without trial days. */
function trialOf(
  trialDays: number,
  requiresCard: boolean,
): { trialDays?: number; trialWithoutPaymentMethod?: boolean } {
  if (trialDays <= 0) return {}
  return requiresCard ? { trialDays } : { trialDays, trialWithoutPaymentMethod: true }
}

export function createBillingPortalHandler(
  dependencies: BillingHandlerDependencies,
): CommandHandler<BillingPortalCommand> {
  return async ({ data }) => {
    const provider = await authorize(dependencies, data.groupId, data.actor.userId)
    const customerId = await dependencies.billing.customerOf(data.groupId)
    if (!customerId) throw new BillingError("NO_SUBSCRIPTION", "The group has never paid")
    const result = await provider.createPortalSession({
      customerId,
      returnUrl: appUrl(dependencies, `/groups/${data.groupId}/billing`),
    })
    if (!result.ok) {
      dependencies.log("error: billing portal failed", result.error)
      throw new BillingError("PROVIDER_ERROR", "The payment provider did not answer")
    }
    return { url: result.value.url }
  }
}

/**
 * Only the owner of an active group passes, and only while billing is on. Returns the provider. The
 * role is read the way group writes read it, so an ownership change committed first is seen.
 */
async function authorize(
  { billing, provider }: BillingHandlerDependencies,
  groupId: string,
  userId: number,
): Promise<BillingProvider> {
  assertCanManageBilling(await billing.lockedRoleOf(groupId, userId))
  if (!provider) throw new BillingError("BILLING_DISABLED", "Billing is off")
  return provider
}

function appUrl({ webAppUrl }: BillingHandlerDependencies, path: string): string {
  return new URL(path, webAppUrl).href
}
