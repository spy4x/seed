import type postgres from "postgres"
import { GROUP_AGGREGATE, type GroupRole } from "@domain/groups"
import { announceJson } from "@spy4x/server/db/notify"
import { GROUP_ACCESS_LOST_CHANNEL, type GroupAccessLoss } from "./group-change-notify.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The group is missing or deleted, so nothing may be written inside it. */
export class GroupNotActiveError extends Error {
  constructor(readonly groupId: string) {
    super(`Group ${groupId} is deleted or missing`)
    this.name = "GroupNotActiveError"
  }
}

interface ChangeSequenceRow extends postgres.Row {
  sequence: string
}

/**
 * Locks an active group for a write by `actorId` and reads the actor's role in it, in the write's
 * own transaction. Returns `null` when the actor is not an active member; throws
 * {@link GroupNotActiveError} when the group is missing or deleted.
 *
 * A role checked before the transaction can be stale by the time the write commits: the owner may
 * remove or demote the actor in between. Every group-scoped write therefore calls this first and
 * checks the role it returns. The group row is locked first, in the order every member change
 * takes (group, then membership), so the two wait for each other instead of deadlocking; the
 * membership row is read `FOR SHARE`, so a removal or a role change committed first is seen, and
 * one that comes later waits until this write commits.
 */
export async function lockActorRole(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
): Promise<GroupRole | null> {
  const active = await sql`
    SELECT 1 FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
  `
  if (active.length === 0) throw new GroupNotActiveError(groupId)
  const member = (
    await sql<{ role: GroupRole }[]>`
      SELECT group_members.role
      FROM group_members
      INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
      WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${actorId}
      FOR SHARE OF group_members
    `
  )[0]
  return member?.role ?? null
}

/**
 * Stamps one committed change on a group: takes the group's next sequence and writes the outbox
 * row that announces it. Returns the sequence, as a decimal string. Every write to a group or to
 * anything inside one (a note) calls it, so one sequence orders all of a group's changes.
 *
 * It must run in the transaction of the change it records, so a change that rolls back takes its
 * sequence and its outbox row with it, and no push is ever sent for it. The `UPDATE` locks the
 * group row, which is what hands two concurrent changes two different sequences in commit order.
 * The outbox row carries the group as its aggregate and the sequence as its version, so the
 * publisher can name both without reading the group again; `eventKind` says what changed.
 *
 * A deleted group takes no change: the `UPDATE` matches no row and {@link GroupNotActiveError} is
 * thrown, which rolls back the write it belongs to. That is what stops a note saved a moment after
 * its group was deleted: the role check before the write cannot see the delete, this can, because
 * the `UPDATE` waits for the deleting transaction and then re-reads the group. The delete itself
 * records its change with `allowDeleted`, as it has just set `deleted_at`.
 */
export async function recordGroupChange(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
  eventKind: string,
  options: { allowDeleted?: boolean } = {},
): Promise<string> {
  const allowDeleted = options.allowDeleted === true
  const stamped = (
    await sql<ChangeSequenceRow[]>`
      UPDATE groups
      SET next_change_sequence = next_change_sequence + 1
      WHERE id = ${groupId} AND (deleted_at IS NULL OR ${allowDeleted})
      RETURNING (next_change_sequence - 1)::text AS sequence
    `
  )[0]
  if (!stamped) {
    throw new GroupNotActiveError(groupId)
  }
  await sql`
    INSERT INTO outbox_events (
      id,
      event_kind,
      aggregate_type,
      aggregate_id,
      aggregate_version,
      group_id,
      actor_user_id
    ) VALUES (
      ${uuidV7()},
      ${eventKind},
      ${GROUP_AGGREGATE},
      ${groupId},
      ${stamped.sequence}::bigint,
      ${groupId},
      ${actorId}
    )
  `
  return stamped.sequence
}

/**
 * Most user ids in one access-loss notification. Postgres refuses a payload of 8000 bytes or more;
 * 500 ids of up to ten digits keep one well under it, so a larger group is announced in several.
 */
const ACCESS_LOSS_IDS_PER_NOTIFICATION = 500

/** What {@link recordAccessChange} stamped: the change's sequence and the group's new revision. */
export interface RecordedAccessChange {
  sequence: string
  authorizationRevision: string
}

/**
 * Records a change that alters who may see a group or what they may do in it: a delete or a
 * restore today; a member removed or a role changed next. Call it instead of
 * {@link recordGroupChange}, in the transaction of the change, after the change is written.
 *
 * It stamps the change like {@link recordGroupChange} does (sequence and outbox row), raises the
 * group's `authorization_revision` by one, and names `lostAccess`, the users who can no longer see
 * the group because of this change, on {@link GROUP_ACCESS_LOST_CHANNEL}. A demoted member who may
 * still read the group has not lost access: they keep getting the group's hints.
 *
 * The order of commit and notification is what makes this safe. `pg_notify` inside a transaction
 * is delivered when the transaction commits, so the API's hint, and the read the page makes when it
 * gets it, always see the change; a change that rolls back takes the revision, the outbox row and
 * the notification with it. The group's own hint goes out later through the outbox, to the members
 * who can see the group when it is sent, which no longer includes the users named here.
 */
export async function recordAccessChange(
  sql: postgres.TransactionSql,
  groupId: string,
  actorId: number,
  eventKind: string,
  lostAccess: readonly number[],
  options: { allowDeleted?: boolean } = {},
): Promise<RecordedAccessChange> {
  const sequence = await recordGroupChange(sql, groupId, actorId, eventKind, options)
  const bumped = (
    await sql<{ authorizationRevision: string }[]>`
      UPDATE groups
      SET authorization_revision = authorization_revision + 1
      WHERE id = ${groupId}
      RETURNING authorization_revision::text AS authorization_revision
    `
  )[0]
  const userIds = [...new Set(lostAccess)]
  for (let start = 0; start < userIds.length; start += ACCESS_LOSS_IDS_PER_NOTIFICATION) {
    const loss: GroupAccessLoss = {
      groupId,
      sequence: Number(sequence),
      userIds: userIds.slice(start, start + ACCESS_LOSS_IDS_PER_NOTIFICATION),
    }
    await announceJson(sql, GROUP_ACCESS_LOST_CHANNEL, loss)
  }
  return { sequence, authorizationRevision: bumped.authorizationRevision }
}
