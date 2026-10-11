import type postgres from "postgres"
import type { BillingProvider } from "@spy4x/billing"
import type { OutboxEvent, OutboxPublisher } from "@spy4x/server/outbox"
import { BillingStatus, PLANS } from "@domain/billing"
import {
  INVITATION_EVENTS,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { JOB_AGGREGATE, type JobHandler } from "@server/jobs/jobs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The worker's job that sets a per-member subscription's quantity to the group's member count. */
export const SEAT_SYNC_JOB = "billing.seat-sync"

/**
 * The group changes that move the member count: a member joined through an invitation, was
 * removed, or left. The last two are written by `PostgresGroupRepository`; the integration tests
 * pin all three by making each change and watching a seat sync follow.
 */
export const MEMBERSHIP_EVENTS: readonly string[] = [
  INVITATION_EVENTS.memberJoined,
  "group.member_removed",
  "group.member_left",
]

/** The plans billed per member. */
const SEAT_PLAN_IDS = PLANS.filter((plan) => plan.perSeat).map((plan) => plan.id)

/**
 * A condition on `subscriptions` rows: the subscription's own customer has not been handed over by
 * a transfer of ownership (#250). The previous owner's subscription only runs out its period, and
 * the app never changes what their card is billed for a group they no longer own.
 */
function notHandedOver(sql: postgres.Sql): postgres.PendingQuery<postgres.Row[]> {
  return sql`NOT EXISTS (
    SELECT 1 FROM billing_handed_over_customers AS handed
    WHERE handed.provider_customer_id = subscriptions.provider_customer_id
  )`
}

/**
 * Queues a seat sync for the group, to run at once. The queue time is the row's version, so two
 * changes in one millisecond queue one sync; each sync reads the count when it runs, so one is
 * enough.
 */
export async function queueSeatSync(
  sql: postgres.Sql,
  groupId: string,
  at = new Date(),
): Promise<void> {
  await sql`
    INSERT INTO outbox_events (
      id, event_kind, aggregate_type, aggregate_id, aggregate_version, available_at
    ) VALUES (
      ${uuidV7()}, ${SEAT_SYNC_JOB}, ${JOB_AGGREGATE}, ${groupId}, ${at.getTime()}, ${at}
    )
    ON CONFLICT (aggregate_type, aggregate_id, aggregate_version, event_kind) DO NOTHING
  `
}

interface SeatRow extends postgres.Row {
  providerSubscriptionId: string
  quantity: number | null
}

/**
 * Sets the group's subscription quantity to its member count, through the provider, when the group
 * is billed per member and the two differ. A failed call throws, so the outbox tries again with
 * backoff: the member stays added while the provider is down, and the quantity catches up when it
 * is back. The provider prorates; this app computes no money. A group not billed per member, or
 * already in step, is left alone.
 */
export function seatSyncJob(
  { sql, provider }: { sql: postgres.Sql; provider: BillingProvider },
): JobHandler {
  return async (event) => {
    const groupId = event.aggregateId
    const row = (
      await sql<SeatRow[]>`
        SELECT provider_subscription_id, quantity FROM subscriptions
        WHERE group_id = ${groupId}
          AND status <> ${BillingStatus.Canceled}
          AND plan_id IN ${sql(SEAT_PLAN_IDS)}
          AND ${notHandedOver(sql)}
      `
    )[0]
    if (!row) return
    const members = await new PostgresInvitationRepository(sql).countMembers(groupId)
    if (members < 1 || row.quantity === members) return
    // No lock is held over the provider call. A transfer of ownership that commits between the
    // read above and this call still lets one change through; a transfer moves no member count, so
    // that change is the one the old owner's group already needed.
    const result = await provider.updateQuantity({
      subscriptionId: row.providerSubscriptionId,
      quantity: members,
      // A retry of this row asks for the same count with the same key; a later count gets its own.
      idempotencyKey: `seats:${event.id}:${members}`,
    })
    if (!result.ok) {
      throw new Error(
        `seat sync of group ${groupId} failed: ${result.error.code} ${result.error.message}`,
      )
    }
    await sql`
      UPDATE subscriptions SET quantity = ${result.value.quantity}, updated_at = CURRENT_TIMESTAMP
      WHERE group_id = ${groupId} AND provider_subscription_id = ${row.providerSubscriptionId}
    `
  }
}

/**
 * Passes every group change on to `inner`, and queues a seat sync after a change that moves the
 * member count. The group's change is committed already, so a provider that is down never holds a
 * member back.
 */
export class SeatSyncPublisher implements OutboxPublisher {
  constructor(private readonly sql: postgres.Sql, private readonly inner: OutboxPublisher) {}

  async publish(event: OutboxEvent): Promise<void> {
    if (MEMBERSHIP_EVENTS.includes(event.eventKind)) {
      await queueSeatSync(this.sql, event.aggregateId)
    }
    await this.inner.publish(event)
  }
}

/**
 * Queues a seat sync for every group billed per member whose stored quantity differs from its
 * member count, and returns how many. The nightly job runs it: it catches a sync the outbox gave up
 * on after a long outage, and a count that moved without a group change, such as a member's account
 * being deleted.
 */
export async function queueSeatDrift(sql: postgres.Sql, now = new Date()): Promise<number> {
  const billed = await sql<{ groupId: string; quantity: number | null }[]>`
    SELECT group_id, quantity FROM subscriptions
    WHERE status <> ${BillingStatus.Canceled} AND plan_id IN ${sql(SEAT_PLAN_IDS)}
      AND ${notHandedOver(sql)}
  `
  // Counted the way `maxMembers` is, one group at a time: few groups pay, and one count stays the
  // only definition of a seat.
  const members = new PostgresInvitationRepository(sql)
  let queued = 0
  for (const { groupId, quantity } of billed) {
    if (quantity === await members.countMembers(groupId)) continue
    await queueSeatSync(sql, groupId, now)
    queued++
  }
  return queued
}
