/**
 * Deleting one's own account (#144): what stops it, the request that starts the wait, the restore
 * that a sign-in during the wait performs, and the delete for good once the wait is over.
 *
 * - **The wait.** A request soft-deletes the `users` row (the caller does that through its cached
 *   user methods, so the cache entry goes too) and writes one `account_deletions` row with
 *   `delete_after` {@link ACCOUNT_DELETION_GRACE_DAYS} days ahead, on the database clock. A
 *   soft-deleted person is already hidden from every group query and refused by sign-in.
 * - **What stops it.** A group the person owns that other active people still use, and any group
 *   of theirs whose subscription is not cancelled: deleting it would drop the others' content or
 *   leave the provider charging a card nobody can reach. The person hands the group over, removes
 *   the members or cancels the plan first. The same check runs again under row locks inside the
 *   request, and once more before the delete for good.
 * - **The delete for good.** Removes the person's owned groups (their notes, members, billing and
 *   invitations go with them), their outbox rows, then the auth user. Everything else that pointed
 *   at the person either goes with the auth user (keys, sessions, profile, settings, push devices,
 *   audit rows) or is emptied (authors of notes, who added a member, who acted in a group's audit
 *   log), so content in shared groups stays, by "Deleted user".
 *
 * Reads no environment and imports no singleton: the API and the worker both use it.
 *
 * @module
 */

import type postgres from "postgres"
import { BillingStatus } from "@domain/billing"
import {
  ACCOUNT_DELETION_GRACE_DAYS,
  type AccountDeletionBlocker,
  AccountDeletionBlockReason,
} from "@domain/identity"
import { INVITATION_EVENTS } from "../groups/invitation-revocation.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** One waiting request, as {@link recordAccountDeletion} wrote it. */
export interface AccountDeletionRequest {
  /** The id the worker's jobs point at. */
  id: string
  deleteAfter: Date
}

/** What {@link hardDeleteAccount} did with one request. */
export enum HardDeleteOutcome {
  /** The auth user and everything that hung off it are gone. */
  Deleted = 1,
  /** No due request with that id: the person signed in meanwhile, or it ran already. */
  NothingDue = 2,
  /** Something stops it again, such as a subscription stored after the request: kept for later. */
  Blocked = 3,
}

/**
 * The groups that stop `userId` from deleting their account, by name. A live group they own counts
 * while another person is a member who is active or waiting to be deleted, since a sign-in may
 * still restore that one; any group they own, deleted ones included, counts while
 * its subscription is not cancelled, since the delete for good would remove that group too, even one
 * cancelled at the end of its period: that one names the day it ends. A group with both reasons is
 * listed once, for its members: handing it over takes its billing along.
 */
export async function accountDeletionBlockers(
  sql: postgres.Sql,
  userId: number,
): Promise<AccountDeletionBlocker[]> {
  return await sql<AccountDeletionBlocker[]>`
    WITH owned AS (
      SELECT
        groups.id,
        groups.name,
        groups.deleted_at IS NULL AND EXISTS (
          SELECT 1 FROM group_members
          INNER JOIN users ON users.id = group_members.user_id AND (
            users.deleted_at IS NULL
            OR EXISTS (SELECT 1 FROM account_deletions WHERE account_deletions.user_id = users.id)
          )
          WHERE group_members.group_id = groups.id AND group_members.user_id <> ${userId}
        ) AS shared,
        EXISTS (
          SELECT 1 FROM subscriptions
          WHERE subscriptions.group_id = groups.id
            AND subscriptions.status <> ${BillingStatus.Canceled}
        ) AS paid,
        EXISTS (
          SELECT 1 FROM subscriptions
          WHERE subscriptions.group_id = groups.id
            AND subscriptions.status <> ${BillingStatus.Canceled}
            AND NOT (subscriptions.cancel_at_period_end
              AND subscriptions.current_period_end IS NOT NULL)
        ) AS renewing,
        (
          SELECT max(subscriptions.current_period_end) FROM subscriptions
          WHERE subscriptions.group_id = groups.id
            AND subscriptions.status <> ${BillingStatus.Canceled}
        ) AS ends_at
      FROM groups
      WHERE groups.owner_user_id = ${userId}
    )
    SELECT
      id AS "groupId",
      name,
      CASE WHEN shared THEN ${AccountDeletionBlockReason.Members}::int
        WHEN renewing THEN ${AccountDeletionBlockReason.Subscription}::int
        ELSE ${AccountDeletionBlockReason.PlanEnding}::int END AS reason,
      CASE WHEN NOT shared AND NOT renewing
        THEN to_char(ends_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      END AS "endsAt"
    FROM owned
    WHERE shared OR paid
    ORDER BY name, id
  `
}

/**
 * Locks, until the transaction ends, the person's live `users` row and every group they own. The
 * group locks conflict with the one an invitation's acceptance takes, so nobody joins a group of
 * theirs between the check and the request. `false` when the user is gone or already deleted.
 */
export async function lockAccountForDeletion(tx: postgres.Sql, userId: number): Promise<boolean> {
  const [user] = await tx`
    SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE
  `
  if (!user) return false
  await tx`SELECT id FROM groups WHERE owner_user_id = ${userId} ORDER BY id FOR UPDATE`
  return true
}

/**
 * Writes the waiting request and revokes every pending invitation the person made or that leads
 * into a group they own, with one audit row each, so nobody joins one of their groups while it
 * waits to be deleted. Inside the caller's transaction, after {@link lockAccountForDeletion}. A
 * restore does not bring the invitations back: they are made again in a moment.
 */
export async function recordAccountDeletion(
  tx: postgres.Sql,
  userId: number,
): Promise<AccountDeletionRequest> {
  const [request] = await tx<AccountDeletionRequest[]>`
    INSERT INTO account_deletions (id, user_id, delete_after)
    VALUES (
      ${uuidV7()}, ${userId},
      now() + make_interval(days => ${ACCOUNT_DELETION_GRACE_DAYS})
    )
    RETURNING id, delete_after AS "deleteAfter"
  `
  const revoked = await tx<{ groupId: string }[]>`
    UPDATE group_invitations
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE revoked_at IS NULL
      AND declined_at IS NULL
      AND uses < max_uses
      AND expires_at > CURRENT_TIMESTAMP
      AND (
        created_by_user_id = ${userId}
        OR group_id IN (SELECT id FROM groups WHERE owner_user_id = ${userId})
      )
    RETURNING group_id AS "groupId"
  `
  for (const { groupId } of revoked) {
    await tx`
      INSERT INTO audit_events (event_kind, actor_user_id, group_id)
      VALUES (${INVITATION_EVENTS.revoked}, ${userId}, ${groupId})
    `
  }
  return request
}

/**
 * Removes the waiting request of `userId`, inside the caller's transaction. `true` when there was
 * one: the sign-in that called it then restores the `users` row. A request whose delete for good
 * is running holds its row lock, so this waits, then finds nothing.
 */
export async function cancelAccountDeletion(tx: postgres.Sql, userId: number): Promise<boolean> {
  const removed = await tx`DELETE FROM account_deletions WHERE user_id = ${userId} RETURNING id`
  return removed.length === 1
}

/** `true` while `userId` has a deletion request waiting. */
export async function isAccountDeletionWaiting(
  sql: postgres.Sql,
  userId: number,
): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM account_deletions WHERE user_id = ${userId}`
  return rows.length === 1
}

/**
 * Deletes for good the account of request `deletionId` once its wait is over, in one transaction.
 * Nothing happens when the request is gone (the person signed in) or not due yet. When something
 * stops it again, the request is kept for the nightly run and the account stays soft-deleted.
 */
export async function hardDeleteAccount(
  sql: postgres.Sql,
  deletionId: string,
): Promise<HardDeleteOutcome> {
  return await sql.begin(async (tx) => {
    const [request] = await tx<{ userId: number }[]>`
      SELECT user_id AS "userId" FROM account_deletions
      WHERE id = ${deletionId} AND delete_after <= now()
      FOR UPDATE
    `
    if (!request) return HardDeleteOutcome.NothingDue
    const { userId } = request
    const [user] = await tx<{ live: boolean }[]>`
      SELECT deleted_at IS NULL AS live FROM users WHERE id = ${userId} FOR UPDATE
    `
    // Restored without its request removed: nothing writes that, but a live account is never
    // deleted by a stale row.
    if (user?.live) {
      await tx`DELETE FROM account_deletions WHERE id = ${deletionId}`
      return HardDeleteOutcome.NothingDue
    }
    await tx`SELECT id FROM groups WHERE owner_user_id = ${userId} ORDER BY id FOR UPDATE`
    if ((await accountDeletionBlockers(tx, userId)).length > 0) return HardDeleteOutcome.Blocked
    // Their group-change rows in other groups name them as actor; the rows of their own groups
    // go with those groups.
    await tx`DELETE FROM outbox_events WHERE actor_user_id = ${userId}`
    await tx`DELETE FROM groups WHERE owner_user_id = ${userId}`
    await tx`DELETE FROM auth_users WHERE id = ${userId}`
    return HardDeleteOutcome.Deleted
  })
}

/** What one nightly run of {@link hardDeleteDueAccounts} did. */
export interface DueDeletions {
  deleted: number
  blocked: number
}

/**
 * Deletes for good every account whose wait is over: the backstop for a job that gave up, and the
 * retry of one that was blocked. Each account in its own transaction, so one blocked account
 * holds up no other.
 */
export async function hardDeleteDueAccounts(sql: postgres.Sql): Promise<DueDeletions> {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM account_deletions WHERE delete_after <= now() ORDER BY delete_after
  `
  const result: DueDeletions = { deleted: 0, blocked: 0 }
  for (const { id } of due) {
    const outcome = await hardDeleteAccount(sql, id)
    if (outcome === HardDeleteOutcome.Deleted) result.deleted++
    if (outcome === HardDeleteOutcome.Blocked) result.blocked++
  }
  return result
}
