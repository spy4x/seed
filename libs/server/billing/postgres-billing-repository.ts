import type postgres from "postgres"
import {
  type BillingEvent,
  BillingEventType,
  type SubscriptionEvent,
  SubscriptionStatus,
} from "@spy4x/billing"
import {
  BILLING_EVENTS,
  type BillingApplyOutcome,
  BillingNoticeKind,
  type BillingRepository,
  findPlan,
  type StoredSubscription,
} from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  GroupNotActiveError,
  lockActorRole,
  recordGroupChange,
} from "@server/groups/group-change-log.ts"
import { PostgresInvitationRepository } from "@server/groups/postgres-invitation-repository.ts"
import { scheduleBillingNotice, trialNoticeAt } from "./billing-notices.ts"
import { queueSeatSync } from "./seat-sync.ts"

interface SubscriptionRow extends postgres.Row, StoredSubscription {}

interface CustomerRow extends postgres.Row {
  providerCustomerId: string
}

/** What the group held before an event, as far as deciding what changed needs. */
interface HeldRow extends postgres.Row {
  planId: string | null
  status: number
  cancelAtPeriodEnd: boolean
  trialEnd: Date | null
}

interface GroupOwnerRow extends postgres.Row {
  id: string
  ownerUserId: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * How events of one second are ordered. The provider stamps events in whole seconds, so a creation
 * and its first update can share one; a creation never follows an update, and nothing follows the
 * end of a subscription.
 */
const EVENT_RANK: Record<SubscriptionEvent["type"], number> = {
  [BillingEventType.SubscriptionCreated]: 1,
  [BillingEventType.SubscriptionUpdated]: 2,
  [BillingEventType.SubscriptionCanceled]: 3,
}

/** The statuses of a subscription that pays for its plan: a trial, or an active one. */
const PAYING_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.Trialing,
  SubscriptionStatus.Active,
]

/**
 * Billing in Postgres: each group's subscription and customer, and every webhook event already
 * handled. It checks no role; the handlers decide who may call it, and the webhook is trusted only
 * after its signature passes.
 */
export class PostgresBillingRepository implements BillingRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async get(groupId: string): Promise<StoredSubscription | null> {
    const row = (
      await this.sql<SubscriptionRow[]>`
        SELECT
          group_id,
          provider_subscription_id,
          plan_id,
          status,
          current_period_end,
          cancel_at_period_end,
          past_due_since,
          trial_end,
          quantity,
          ever_active
        FROM subscriptions
        WHERE group_id = ${groupId}
      `
    )[0]
    return row
      ? {
        groupId: row.groupId,
        providerSubscriptionId: row.providerSubscriptionId,
        planId: row.planId,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd,
        pastDueSince: row.pastDueSince,
        trialEnd: row.trialEnd,
        quantity: row.quantity,
        everActive: row.everActive,
      }
      : null
  }

  /**
   * The actor's role through `lockActorRole`, in a transaction of its own. The transaction ends
   * before the caller talks to the provider, so no group lock is held over the network.
   */
  async lockedRoleOf(groupId: string, userId: number): Promise<GroupRole | null> {
    try {
      return await this.sql.begin((transaction: postgres.TransactionSql) =>
        lockActorRole(transaction, groupId, userId)
      )
    } catch (error) {
      if (error instanceof GroupNotActiveError) return null
      throw error
    }
  }

  async customerOf(groupId: string): Promise<string | null> {
    const row = (
      await this.sql<CustomerRow[]>`
        SELECT provider_customer_id FROM billing_customers
        WHERE group_id = ${groupId} AND NOT EXISTS (
          SELECT 1 FROM billing_handed_over_customers AS handed
          WHERE handed.provider_customer_id = billing_customers.provider_customer_id
        )
      `
    )[0]
    return row?.providerCustomerId ?? null
  }

  async handedOver(groupId: string): Promise<boolean> {
    const rows = await this.sql`
      SELECT 1 FROM billing_handed_over_customers AS handed
      WHERE handed.group_id = ${groupId} AND (
        handed.provider_customer_id IN (
          SELECT provider_customer_id FROM billing_customers WHERE group_id = ${groupId}
        )
        OR handed.provider_customer_id IN (
          SELECT provider_customer_id FROM subscriptions WHERE group_id = ${groupId}
        )
      )
    `
    return rows.length > 0
  }

  /** Counted by the invitations' own count, so a seat and the `maxMembers` cap never disagree. */
  async membersOf(groupId: string): Promise<number> {
    return await new PostgresInvitationRepository(this.sql).countMembers(groupId)
  }

  /**
   * One conditional `UPDATE`: Postgres locks the person's row, so a second checkout of another
   * group that runs at the same time re-reads it after the first commits and finds the trial gone.
   * The time is kept from the first claim.
   */
  async claimTrial(userId: number, groupId: string): Promise<boolean> {
    const rows = await this.sql`
      UPDATE users SET
        trial_group_id = ${groupId},
        trial_used_at = COALESCE(trial_used_at, now())
      WHERE id = ${userId} AND (trial_group_id IS NULL OR trial_group_id = ${groupId})
      RETURNING id
    `
    return rows.length > 0
  }

  async trialGroupOf(userId: number): Promise<string | null> {
    const [row] = await this.sql<{ trialGroupId: string | null }[]>`
      SELECT trial_group_id FROM users WHERE id = ${userId}
    `
    return row?.trialGroupId ?? null
  }

  /**
   * Applies one verified webhook event in a single transaction: the event id is stored first, so a
   * second delivery finds it and changes nothing; then the group's subscription is replaced only
   * when the event is not older than the one it holds, and the change is recorded on the group
   * (`group.plan.changed` in the outbox). A failure rolls back the event id too, so the provider's
   * retry is applied in full.
   *
   * The group comes from the checkout's `reference` (the group id), or else from the customer an
   * earlier event stored. An event that names no group of this app is stored and ignored.
   */
  async applyEvent(event: BillingEvent): Promise<BillingApplyOutcome> {
    return await this.sql.begin(async (transaction: postgres.TransactionSql) => {
      const stored = await transaction`
        INSERT INTO billing_events (id, event_type) VALUES (${event.id}, ${event.type})
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `
      if (stored.length === 0) return "duplicate"
      if (!isSubscriptionEvent(event)) return "ignored"

      const group = await findGroup(transaction, event)
      if (!group) return "ignored"

      const subscription = event.subscription
      const rank = EVENT_RANK[event.type]
      // A different subscription than the one held takes over when it pays, whatever the held one's
      // status, or when the held one has ended. One that does not pay, such as a late failed charge
      // or the end of an old subscription, never takes the plan of the one held (#242).
      const paying = PAYING_STATUSES.includes(subscription.status)
      // The grace period counts from the first past-due event of this subscription: a later one
      // (Stripe's `unpaid` arrives as past due too) keeps the stored start, and any other status
      // clears it.
      const pastDue = subscription.status === SubscriptionStatus.PastDue
      // Only a subscription that has paid gets the grace period (#247): `ever_active` turns true at
      // its first active event and stays true while the same subscription is held.
      const active = subscription.status === SubscriptionStatus.Active
      // A customer handed over by a transfer of ownership (#250) only runs out the subscription
      // the group holds: none of its subscriptions takes the group back, even one that pays.
      const handedOver = (await transaction`
        SELECT 1 FROM billing_handed_over_customers
        WHERE provider_customer_id = ${subscription.customerId}
      `).length > 0
      const before = (
        await transaction<HeldRow[]>`
          SELECT plan_id, status, cancel_at_period_end, trial_end
          FROM subscriptions WHERE group_id = ${group.id} FOR UPDATE
        `
      )[0]
      const written = await transaction`
        INSERT INTO subscriptions (
          group_id,
          provider_subscription_id,
          plan_id,
          status,
          current_period_end,
          cancel_at_period_end,
          provider_event_at,
          provider_event_rank,
          past_due_since,
          trial_end,
          quantity,
          ever_active,
          provider_customer_id
        ) VALUES (
          ${group.id},
          ${subscription.id},
          ${subscription.planId},
          ${subscription.status},
          ${subscription.currentPeriodEnd},
          ${subscription.cancelAtPeriodEnd},
          ${event.occurredAt},
          ${rank},
          ${pastDue ? event.occurredAt : null},
          ${subscription.trialEnd},
          ${subscription.quantity},
          ${active},
          ${subscription.customerId}
        )
        ON CONFLICT (group_id) DO UPDATE SET
          provider_subscription_id = EXCLUDED.provider_subscription_id,
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          current_period_end = EXCLUDED.current_period_end,
          cancel_at_period_end = EXCLUDED.cancel_at_period_end,
          provider_event_at = EXCLUDED.provider_event_at,
          provider_event_rank = EXCLUDED.provider_event_rank,
          past_due_since = CASE
            WHEN EXCLUDED.past_due_since IS NULL THEN NULL
            WHEN subscriptions.provider_subscription_id = EXCLUDED.provider_subscription_id
              THEN COALESCE(subscriptions.past_due_since, EXCLUDED.past_due_since)
            ELSE EXCLUDED.past_due_since
          END,
          trial_end = EXCLUDED.trial_end,
          quantity = EXCLUDED.quantity,
          ever_active = EXCLUDED.ever_active OR (
            subscriptions.ever_active
            AND subscriptions.provider_subscription_id = EXCLUDED.provider_subscription_id
          ),
          provider_customer_id = EXCLUDED.provider_customer_id,
          updated_at = CURRENT_TIMESTAMP
        WHERE (subscriptions.provider_event_at, subscriptions.provider_event_rank)
            <= (EXCLUDED.provider_event_at, EXCLUDED.provider_event_rank)
          AND (subscriptions.provider_subscription_id = EXCLUDED.provider_subscription_id
            OR (NOT ${handedOver}
              AND (subscriptions.status = ${SubscriptionStatus.Canceled} OR ${paying})))
        RETURNING group_id
      `
      if (written.length === 0) {
        // A late active event changes nothing else, but still proves that the subscription paid.
        if (active) {
          await transaction`
            UPDATE subscriptions SET ever_active = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE group_id = ${group.id} AND provider_subscription_id = ${subscription.id}
              AND NOT ever_active
          `
        }
        return "stale"
      }

      // One customer pays for one group. A customer another group already holds stays with it, so
      // an event naming it is still applied instead of failing on the unique index forever. A
      // handed-over customer written back here stays handed over: `customerOf` reads through
      // `billing_handed_over_customers` (#250).
      await transaction`
        INSERT INTO billing_customers (group_id, provider_customer_id)
        SELECT ${group.id}, ${subscription.customerId}
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_customers
          WHERE provider_customer_id = ${subscription.customerId} AND group_id <> ${group.id}
        )
        ON CONFLICT (group_id) DO UPDATE SET provider_customer_id = EXCLUDED.provider_customer_id
      `
      await scheduleNotices(transaction, group.id, event.occurredAt, before, subscription)
      // A per-member subscription that bills another count than the group has, such as a checkout
      // started before someone joined, is corrected by the worker.
      if (
        subscription.status !== SubscriptionStatus.Canceled &&
        subscription.planId !== null && findPlan(subscription.planId)?.perSeat &&
        subscription.quantity !==
          await new PostgresInvitationRepository(transaction).countMembers(group.id)
      ) {
        await queueSeatSync(transaction, group.id)
      }
      // Only a new plan or status is news to the group's pages; a renewal that moves the period's end
      // is not. The owner pays, so the change is theirs; a deleted group still records it, so a
      // restore shows the plan the provider reported meanwhile.
      const changed = before === undefined || before.planId !== subscription.planId ||
        before.status !== subscription.status
      if (!changed) return "applied"
      await recordGroupChange(
        transaction,
        group.id,
        group.ownerUserId,
        BILLING_EVENTS.planChanged,
        {
          allowDeleted: true,
        },
      )
      return "applied"
    })
  }
}

/**
 * Queues the owner's mails this change calls for: a payment that just failed, a cancellation just
 * made, and, for a trial whose end is new, the notice {@link trialNoticeAt} before that end. Each
 * job checks again when it runs that its notice still holds.
 */
async function scheduleNotices(
  sql: postgres.Sql,
  groupId: string,
  occurredAt: Date,
  before: HeldRow | undefined,
  after: SubscriptionEvent["subscription"],
): Promise<void> {
  const live = after.status !== SubscriptionStatus.Canceled
  if (
    after.status === SubscriptionStatus.PastDue && before?.status !== SubscriptionStatus.PastDue
  ) {
    await scheduleBillingNotice(sql, BillingNoticeKind.PaymentFailed, groupId, occurredAt)
  }
  if (live && after.cancelAtPeriodEnd && !before?.cancelAtPeriodEnd) {
    await scheduleBillingNotice(sql, BillingNoticeKind.PlanEnding, groupId, occurredAt)
  }
  if (
    after.status === SubscriptionStatus.Trialing && after.trialEnd !== null &&
    before?.trialEnd?.getTime() !== after.trialEnd.getTime()
  ) {
    await scheduleBillingNotice(
      sql,
      BillingNoticeKind.TrialEnding,
      groupId,
      trialNoticeAt(after.trialEnd),
    )
  }
}

function isSubscriptionEvent(event: BillingEvent): event is SubscriptionEvent {
  return "subscription" in event
}

/**
 * The group an event is about, with its row locked. The group is locked before the subscription and
 * the customer, the order a transfer of ownership takes them in (`handOverBilling`), so the two
 * never wait on each other.
 */
async function findGroup(
  sql: postgres.Sql,
  event: SubscriptionEvent,
): Promise<GroupOwnerRow | null> {
  const reference = event.subscription.reference
  if (reference !== null && UUID.test(reference)) {
    const row = (
      await sql<GroupOwnerRow[]>`
        SELECT id, owner_user_id FROM groups WHERE id = ${reference} FOR NO KEY UPDATE
      `
    )[0]
    if (row) return row
  }
  const row = (
    await sql<GroupOwnerRow[]>`
      SELECT groups.id, groups.owner_user_id
      FROM billing_customers
      JOIN groups ON groups.id = billing_customers.group_id
      WHERE billing_customers.provider_customer_id = ${event.subscription.customerId}
      FOR NO KEY UPDATE OF groups
    `
  )[0]
  return row ?? null
}
