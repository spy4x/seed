import type postgres from "postgres"
import { BillingStatus } from "@domain/billing"
import { GroupError } from "@domain/groups"

interface HeldRow extends postgres.Row {
  status: BillingStatus
  cancelAtPeriodEnd: boolean
}

/**
 * The billing half of a transfer of ownership, run in the transfer's transaction after the
 * group row is locked.
 *
 * - A subscription that still renews refuses the transfer (`SUBSCRIPTION_RENEWS`): the old owner
 *   cancels it in the billing portal first, so their card is never charged again for a group they
 *   no longer own. A subscription cancelled at its period's end, or one that has ended, passes.
 * - The group's provider customer, and the held subscription's, are recorded as handed over, for
 *   good: the app opens no portal for them any more, so the new owner never sees the old owner's
 *   card, address or invoices, and the new owner's checkout makes a customer of their own. None of
 *   their subscriptions takes the group back, seat changes skip them, and their notices go to the
 *   owner recorded here.
 *
 * The provider is not called: nothing here can charge anyone, and nothing needs to be undone if the
 * transfer rolls back.
 */
export async function handOverBilling(
  sql: postgres.TransactionSql,
  groupId: string,
): Promise<void> {
  const held = (
    await sql<HeldRow[]>`
      SELECT status, cancel_at_period_end FROM subscriptions WHERE group_id = ${groupId}
    `
  )[0]
  if (held && held.status !== BillingStatus.Canceled && !held.cancelAtPeriodEnd) {
    throw new GroupError(
      "SUBSCRIPTION_RENEWS",
      "Cancel the group's subscription in the billing portal before transferring it",
    )
  }
  // Read before the transfer moves the owner: the owner who paid with these customers.
  await sql`
    INSERT INTO billing_handed_over_customers (provider_customer_id, group_id, previous_owner_user_id)
    SELECT customers.id, ${groupId}, groups.owner_user_id
    FROM groups, (
      SELECT provider_customer_id AS id FROM billing_customers WHERE group_id = ${groupId}
      UNION
      SELECT provider_customer_id FROM subscriptions
      WHERE group_id = ${groupId} AND provider_customer_id IS NOT NULL
    ) AS customers
    WHERE groups.id = ${groupId}
    ON CONFLICT (provider_customer_id) DO NOTHING
  `
}
