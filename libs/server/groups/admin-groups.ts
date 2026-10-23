/**
 * The operator area's reads and writes over groups (#426): the searchable group list, one group's
 * page, its files, and the actions an operator takes on a group (revoke an invitation, remove a
 * member, transfer ownership, remove a file).
 *
 * Nothing written inside a group leaves here: no note or tag text, no group description, no note
 * title from the activity log, no invitation token or its hash. Counts and account facts only.
 *
 * Who may call these is the API's business (`apps/api/routes/admin/groups.ts`), except the rules
 * that decide an action on locked rows: an operator never acts on themselves, never on a person
 * whose product role is theirs or higher, and only a supervisor transfers a group.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import type { SortRule } from "@spy4x/platform/universal/sort"
import { isUuid } from "@spy4x/platform/universal/uuid"
import { BillingStatus, FREE_PLAN_ID } from "@domain/billing"
import {
  ADMIN_GROUP_ACTIVITY_LIMIT,
  ADMIN_GROUP_DEFAULT_SORT,
  ADMIN_GROUP_FILE_LIMIT,
  ADMIN_GROUP_INVITATION_LIMIT,
  ADMIN_GROUP_TRANSFER_ROLE,
  type AdminGroupActivityEvent,
  type AdminGroupDetail,
  type AdminGroupFiles,
  type AdminGroupFilter,
  type AdminGroupInvitation,
  type AdminGroupMember,
  type AdminGroupPerson,
  type AdminGroupRow,
  type AdminGroupSortKey,
  type AdminInvitationState,
  type AuditDetails,
  type GroupColor,
  GroupError,
  GroupRole,
  OPERATOR_DETAIL,
} from "@domain/groups"
import type { UserRole } from "@domain/identity"
import { handOverBilling } from "@server/billing/handover.ts"
import { apiTokenRows } from "@server/api-tokens/api-tokens.ts"
import { removeAttachmentRow } from "@server/notes/postgres-attachment-repository.ts"
import { writeAuditEvent } from "./audit.ts"
import { recordAccessChange } from "./group-change-log.ts"
import { notifyOwnershipReceived, notifyRemoved } from "./group-notifications.ts"
import { INVITATION_EVENTS, revokeInvitationsOf } from "./invitation-revocation.ts"
import { likeContains } from "@spy4x/server/db"

/** The kinds the group's own actions write; the same strings the members' actions write. */
const MEMBER_REMOVED_EVENT = "group.member_removed"
const OWNERSHIP_TRANSFERRED_EVENT = "group.ownership_transferred"

// The operator's mark on an audit row lives with the log that reads it; the writers here use it.
export { OPERATOR_DETAIL }

/** The password method's name in `auth_keys`, as `@spy4x/server/auth/password` stores it. */
const PASSWORD_METHOD = "password"

/** The operator taking an action: their id and their product role. */
export interface AdminGroupOperator {
  id: number
  role: UserRole
}

/** How an operator's action on a group ended. */
export enum AdminGroupActOutcome {
  Done = 1,
  /** The group, the member or the invitation is not there. */
  NotFound = 2,
  /** The group is in the trash: nothing in it changes until it is restored. */
  GroupDeleted = 3,
  /** The operator named their own account. */
  Self = 4,
  /** A person the action touches has a product role at or above the operator's. */
  Outranked = 5,
  /** The operator's role is below what the action takes. */
  RoleTooLow = 6,
  /** The invitation is no longer pending, or the member already owns the group. */
  Unchanged = 7,
  /** The member to remove owns the group: the group is handed over first. */
  IsOwner = 8,
  /** The member to remove has no other group, and a person always keeps one. */
  LastGroup = 9,
  /** The group's subscription still renews, so its owner cancels it before a transfer. */
  SubscriptionRenews = 10,
  /** The member to hand the group to is blocked: they could not sign in to run it. */
  RecipientBlocked = 11,
}

/** The columns of a person, read from the `users` row aliased `alias`. */
function personColumns(sql: postgres.Sql, alias: string, prefix: string) {
  const user = sql(alias)
  return sql`
    ${user}.id AS ${sql(`${prefix}_id`)},
    btrim(concat_ws(' ', ${user}.first_name, ${user}.last_name)) AS ${sql(`${prefix}_name`)},
    (
      SELECT COALESCE(k.email, CASE WHEN k.method = ${PASSWORD_METHOD} THEN k.subject END)
      FROM auth_keys k
      WHERE k.user_id = ${user}.id
      ORDER BY (k.method = ${PASSWORD_METHOD}) DESC, k.email IS NULL, k.id
      LIMIT 1
    ) AS ${sql(`${prefix}_email`)}
  `
}

interface GroupRowRaw {
  id: string
  name: string
  emoji: string | null
  color: GroupColor | null
  ownerId: number
  ownerName: string
  ownerEmail: string | null
  memberCount: number
  noteCount: number
  planId: string
  createdAt: Date
  lastActivityAt: Date | null
  deletedAt: Date | null
}

/** How many members the group `g` has. */
function memberCount(sql: postgres.Sql) {
  return sql`(SELECT COUNT(*)::int FROM group_members m WHERE m.group_id = g.id)`
}

/** When the newest audit event of the group `g` happened, or null. */
function lastActivityAt(sql: postgres.Sql) {
  return sql`(
    SELECT a.created_at FROM audit_events a WHERE a.group_id = g.id ORDER BY a.id DESC LIMIT 1
  )`
}

/** The columns of {@link AdminGroupRow} over `groups g` joined to its owner `o`. */
function groupColumns(sql: postgres.Sql) {
  return sql`
    g.id, g.name, g.emoji, g.color, g.created_at, g.deleted_at,
    ${personColumns(sql, `o`, `owner`)},
    ${memberCount(sql)} AS member_count,
    (
      SELECT COUNT(*)::int FROM notes n WHERE n.group_id = g.id AND n.deleted_at IS NULL
    ) AS note_count,
    COALESCE(
      (
        SELECT s.plan_id FROM subscriptions s
        WHERE s.group_id = g.id AND s.status IN ${
    sql([BillingStatus.Trialing, BillingStatus.Active, BillingStatus.PastDue])
  }
      ),
      ${FREE_PLAN_ID}
    ) AS plan_id,
    ${lastActivityAt(sql)} AS last_activity_at
  `
}

function toPerson(id: number, name: string | null, email: string | null): AdminGroupPerson {
  return { id, name: name ?? ``, email }
}

function toGroupRow(row: GroupRowRaw): AdminGroupRow {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    color: row.color,
    owner: toPerson(row.ownerId, row.ownerName, row.ownerEmail),
    memberCount: row.memberCount,
    noteCount: row.noteCount,
    planId: row.planId,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

/**
 * The `ORDER BY` of one sort key and direction over the list's derived table `r`. Only these
 * fragments reach the query: the key and direction come from the page's address.
 */
function sortColumn(sql: postgres.Sql, rule: SortRule<AdminGroupSortKey>) {
  const desc = rule.direction === `desc`
  switch (rule.key) {
    case `name`:
      return desc ? sql`lower(r.name) DESC` : sql`lower(r.name) ASC`
    case `memberCount`:
      return desc ? sql`r.member_count DESC` : sql`r.member_count ASC`
    case `lastActivityAt`:
      return desc ? sql`r.last_activity_at DESC NULLS LAST` : sql`r.last_activity_at ASC NULLS LAST`
    case `createdAt`:
      return desc ? sql`r.created_at DESC` : sql`r.created_at ASC`
  }
}

/** The rules a list sorts by: `sort`, or newest first when it is empty. */
function sortRules(sort: readonly SortRule<AdminGroupSortKey>[]) {
  return sort.length > 0 ? sort : ADMIN_GROUP_DEFAULT_SORT
}

/** Each rule of `sort` in turn (newest first when empty), then the id, so pages never overlap. */
function orderBy(sql: postgres.Sql, sort: readonly SortRule<AdminGroupSortKey>[]) {
  const rules = sortRules(sort)
  let clause = sortColumn(sql, rules[0])
  for (const rule of rules.slice(1)) clause = sql`${clause}, ${sortColumn(sql, rule)}`
  return rules[0].direction === `desc` ? sql`${clause}, r.id DESC` : sql`${clause}, r.id ASC`
}

/**
 * One page of groups in the order of `filter.sort`, with how many match in all. Each word of
 * `filter.query` must appear, in any case, in the group's name, its owner's first or last name, or
 * an address the owner signs in with; a query that is a group's id finds that group.
 */
export async function listAdminGroups(
  sql: postgres.Sql,
  filter: AdminGroupFilter,
  pageSize: number,
): Promise<{ groups: AdminGroupRow[]; total: number }> {
  const words = filter.query.split(/\s+/).filter(Boolean)
  let where = sql`TRUE`
  if (isUuid(filter.query)) {
    where = sql`g.id = ${filter.query}`
  } else {
    for (const word of words) {
      const pattern = likeContains(word)
      where = sql`${where} AND (
        g.name ILIKE ${pattern} OR o.first_name ILIKE ${pattern} OR o.last_name ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM auth_keys k
          WHERE k.user_id = o.id
            AND (
              k.email ILIKE ${pattern}
              OR (k.method = ${PASSWORD_METHOD} AND k.subject ILIKE ${pattern})
            )
        )
      )`
    }
  }
  if (filter.status === `active`) where = sql`${where} AND g.deleted_at IS NULL`
  if (filter.status === `deleted`) where = sql`${where} AND g.deleted_at IS NOT NULL`
  const [{ total }] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total
    FROM groups g JOIN users o ON o.id = g.owner_user_id
    WHERE ${where}
  `
  // The page is chosen first, reading only the columns its sort needs; the figures of a row (its
  // owner's address, notes, plan) are read for the page's rows alone, not for every match (#462).
  const keys = new Set(sortRules(filter.sort).map((rule) => rule.key))
  const rows = await sql<GroupRowRaw[]>`
    WITH page AS (
      SELECT r.id FROM (
        SELECT g.id, g.name, g.created_at
          ${keys.has(`memberCount`) ? sql`, ${memberCount(sql)} AS member_count` : sql``}
          ${keys.has(`lastActivityAt`) ? sql`, ${lastActivityAt(sql)} AS last_activity_at` : sql``}
        FROM groups g JOIN users o ON o.id = g.owner_user_id
        WHERE ${where}
      ) r
      ORDER BY ${orderBy(sql, filter.sort)}
      LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
    )
    SELECT * FROM (
      SELECT ${groupColumns(sql)}
      FROM page p JOIN groups g ON g.id = p.id JOIN users o ON o.id = g.owner_user_id
    ) r
    ORDER BY ${orderBy(sql, filter.sort)}
  `
  return { groups: rows.map(toGroupRow), total }
}

interface MemberRowRaw {
  memberId: number
  memberName: string
  memberEmail: string | null
  pictureId: string | null
  role: GroupRole
  userRole: UserRole
  blocked: boolean
  joinedAt: Date
}

interface InvitationRowRaw {
  id: string
  role: GroupRole
  email: string | null
  uses: number
  maxUses: number
  state: AdminInvitationState
  creatorId: number | null
  creatorName: string | null
  creatorEmail: string | null
  createdAt: Date
  expiresAt: Date
}

interface ActivityRowRaw {
  id: string
  kind: string
  at: Date
  actorId: number | null
  actorName: string | null
  actorEmail: string | null
  targetId: number | null
  targetName: string | null
  targetEmail: string | null
  details: AuditDetails
}

/**
 * The invitation's state, in the order its own refusal checks it: revoked, declined, used up,
 * expired, else pending.
 */
function invitationState(sql: postgres.Sql) {
  return sql`
    CASE
      WHEN i.revoked_at IS NOT NULL THEN 'revoked'
      WHEN i.declined_at IS NOT NULL THEN 'declined'
      WHEN i.uses >= i.max_uses THEN 'used'
      WHEN i.expires_at <= CURRENT_TIMESTAMP THEN 'expired'
      ELSE 'pending'
    END
  `
}

/**
 * Only the numeric facts of an audit row's details: roles and counts. A note's title, a tag's name
 * or a group's old name are strings, and never leave the API. The operator marker becomes
 * {@link AdminGroupActivityEvent.byOperator} instead.
 */
export function numericDetails(details: AuditDetails): Record<string, number> {
  const kept: Record<string, number> = {}
  for (const [key, value] of Object.entries(details ?? {})) {
    if (key !== OPERATOR_DETAIL && typeof value === `number`) kept[key] = value
  }
  return kept
}

/**
 * One group's page: the group as the list shows it, its counts, its subscription, every member,
 * its newest invitations and the newest entries of its activity log. A group in the trash is shown
 * too. `null` when there is no such group.
 */
export async function readAdminGroup(
  sql: postgres.Sql,
  groupId: string,
): Promise<AdminGroupDetail | null> {
  const [group] = await sql<GroupRowRaw[]>`
    SELECT ${groupColumns(sql)}
    FROM groups g JOIN users o ON o.id = g.owner_user_id
    WHERE g.id = ${groupId}
  `
  if (!group) return null
  const [counts] = await sql<
    {
      deletedNotes: number
      tags: number
      pendingInvitations: number
      files: number
      fileBytes: string
    }[]
  >`
    SELECT
      (
        SELECT COUNT(*)::int FROM note_attachments a JOIN notes n ON n.id = a.note_id
        WHERE n.group_id = ${groupId}
      ) AS files,
      (
        SELECT COALESCE(SUM(a.size_bytes), 0)::text FROM note_attachments a
        JOIN notes n ON n.id = a.note_id WHERE n.group_id = ${groupId}
      ) AS file_bytes,
      (
        SELECT COUNT(*)::int FROM notes WHERE group_id = ${groupId} AND deleted_at IS NOT NULL
      ) AS deleted_notes,
      (SELECT COUNT(*)::int FROM tags WHERE group_id = ${groupId}) AS tags,
      (
        SELECT COUNT(*)::int FROM group_invitations i
        WHERE i.group_id = ${groupId} AND ${invitationState(sql)} = 'pending'
      ) AS pending_invitations
  `
  const [billing] = await sql<
    {
      planId: string | null
      status: number
      cancelAtPeriodEnd: boolean
      currentPeriodEnd: Date | null
    }[]
  >`
    SELECT plan_id, status, cancel_at_period_end, current_period_end
    FROM subscriptions WHERE group_id = ${groupId}
  `
  const members = await sql<MemberRowRaw[]>`
    SELECT
      ${personColumns(sql, `u`, `member`)},
      u.picture_id, m.role, u.role AS user_role, (u.blocked_at IS NOT NULL) AS blocked,
      m.created_at AS joined_at
    FROM group_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ${groupId}
    ORDER BY m.role DESC, lower(concat_ws(' ', u.first_name, u.last_name)), u.id
  `
  const invitations = await sql<InvitationRowRaw[]>`
    SELECT
      i.id, i.role, i.email, i.uses, i.max_uses, ${invitationState(sql)} AS state,
      ${personColumns(sql, `c`, `creator`)},
      i.created_at, i.expires_at
    FROM group_invitations i
    LEFT JOIN users c ON c.id = i.created_by_user_id
    WHERE i.group_id = ${groupId}
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${ADMIN_GROUP_INVITATION_LIMIT}
  `
  const [imported] = await sql<
    {
      at: Date
      creatorId: number | null
      creatorName: string | null
      creatorEmail: string | null
    }[]
  >`
    SELECT g.imported_at AS at, ${personColumns(sql, `c`, `creator`)}
    FROM groups g LEFT JOIN users c ON c.id = g.created_by_user_id
    WHERE g.id = ${groupId} AND g.imported_at IS NOT NULL
  `
  const activity = await sql<ActivityRowRaw[]>`
    SELECT
      a.id::text AS id, a.event_kind AS kind, a.created_at AS at,
      ${personColumns(sql, `actor`, `actor`)},
      ${personColumns(sql, `target`, `target`)},
      a.details
    FROM audit_events a
    LEFT JOIN users actor ON actor.id = a.actor_user_id
    LEFT JOIN users target ON target.id = a.target_user_id
    WHERE a.group_id = ${groupId}
    ORDER BY a.id DESC
    LIMIT ${ADMIN_GROUP_ACTIVITY_LIMIT}
  `
  return {
    group: toGroupRow(group),
    counts: {
      notes: group.noteCount,
      deletedNotes: counts.deletedNotes,
      tags: counts.tags,
      pendingInvitations: counts.pendingInvitations,
      files: counts.files,
      fileBytes: Number(counts.fileBytes),
    },
    billing: billing
      ? {
        planId: billing.planId,
        status: billing.status,
        cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
        currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
      }
      : null,
    imported: imported
      ? {
        at: imported.at.toISOString(),
        by: imported.creatorId === null
          ? null
          : toPerson(imported.creatorId, imported.creatorName, imported.creatorEmail),
      }
      : null,
    members: members.map((row): AdminGroupMember => ({
      ...toPerson(row.memberId, row.memberName, row.memberEmail),
      pictureId: row.pictureId,
      role: row.role,
      userRole: row.userRole,
      blocked: row.blocked,
      joinedAt: row.joinedAt.toISOString(),
    })),
    invitations: invitations.map((row): AdminGroupInvitation => ({
      id: row.id,
      role: row.role,
      email: row.email,
      uses: row.uses,
      maxUses: row.maxUses,
      state: row.state,
      createdBy: row.creatorId === null
        ? null
        : toPerson(row.creatorId, row.creatorName, row.creatorEmail),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
    activity: activity.map((row): AdminGroupActivityEvent => ({
      id: row.id,
      kind: row.kind,
      at: row.at.toISOString(),
      actor: { userId: row.actorId, name: row.actorName || row.actorEmail || `` },
      target: row.targetId === null
        ? null
        : { userId: row.targetId, name: row.targetName || row.targetEmail || `` },
      details: numericDetails(row.details),
      byOperator: row.details?.[OPERATOR_DETAIL] === 1,
    })),
  }
}

/** Locks the group's row; its state, or `null` when there is no such group. */
async function lockGroup(
  tx: postgres.TransactionSql,
  groupId: string,
): Promise<{ deleted: boolean } | null> {
  const [row] = await tx<{ deleted: boolean }[]>`
    SELECT (deleted_at IS NOT NULL) AS deleted FROM groups WHERE id = ${groupId} FOR NO KEY UPDATE
  `
  return row ?? null
}

/**
 * Locks the active accounts of `userIds` in id order, the order the members' own actions lock
 * them in, so the two wait for each other instead of deadlocking. Their product roles by id.
 */
async function lockUsers(
  tx: postgres.TransactionSql,
  userIds: number[],
): Promise<Map<number, UserRole>> {
  const rows = await tx<{ id: number; role: UserRole }[]>`
    SELECT id, role FROM users
    WHERE deleted_at IS NULL AND id IN ${tx(userIds)}
    ORDER BY id
    FOR NO KEY UPDATE
  `
  return new Map(rows.map((row) => [row.id, row.role]))
}

/** Locks the memberships of `userIds` in the group, in id order; the group role of each. */
async function lockMemberRoles(
  tx: postgres.TransactionSql,
  groupId: string,
  userIds: number[],
): Promise<Map<number, GroupRole>> {
  const rows = await tx<{ userId: number; role: GroupRole }[]>`
    SELECT user_id, role FROM group_members
    WHERE group_id = ${groupId} AND user_id IN ${tx(userIds)}
    ORDER BY user_id
    FOR UPDATE
  `
  return new Map(rows.map((row) => [row.userId, row.role]))
}

/**
 * Revokes one pending invitation of the group, as its admins can, and writes the group's audit row
 * naming the operator. A group in the trash and an invitation that is no longer pending are left
 * as they are.
 */
export async function revokeInvitationAsOperator(
  sql: postgres.Sql,
  operator: AdminGroupOperator,
  groupId: string,
  invitationId: string,
): Promise<AdminGroupActOutcome> {
  return await sql.begin(async (tx) => {
    const group = await lockGroup(tx, groupId)
    if (!group) return AdminGroupActOutcome.NotFound
    const [invitation] = await tx<{ role: GroupRole; state: AdminInvitationState }[]>`
      SELECT i.role, ${invitationState(tx)} AS state
      FROM group_invitations i
      WHERE i.id = ${invitationId} AND i.group_id = ${groupId}
      FOR UPDATE
    `
    if (!invitation) return AdminGroupActOutcome.NotFound
    if (group.deleted) return AdminGroupActOutcome.GroupDeleted
    if (invitation.state !== `pending`) return AdminGroupActOutcome.Unchanged
    await tx`
      UPDATE group_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = ${invitationId}
    `
    await writeAuditEvent(tx, {
      eventKind: INVITATION_EVENTS.revoked,
      actorId: operator.id,
      groupId,
      entityType: `invitation`,
      entityId: invitationId,
      details: { role: invitation.role, [OPERATOR_DETAIL]: 1 },
    })
    return AdminGroupActOutcome.Done
  }) as AdminGroupActOutcome
}

/**
 * Removes `userId` from the group the way an admin of the group does: the membership goes, their
 * API tokens for the group and their own pending invitations are revoked, they get a notice, and
 * their open pages lose the group. The owner is never removed (the group is transferred first),
 * nor a person this group is the only one of: the product always leaves a person one group.
 */
export async function removeMemberAsOperator(
  sql: postgres.Sql,
  operator: AdminGroupOperator,
  groupId: string,
  userId: number,
): Promise<AdminGroupActOutcome> {
  if (userId === operator.id) return AdminGroupActOutcome.Self
  return await sql.begin(async (tx) => {
    const roles = await lockUsers(tx, [userId])
    const group = await lockGroup(tx, groupId)
    if (!group) return AdminGroupActOutcome.NotFound
    const memberRoles = await lockMemberRoles(tx, groupId, [userId])
    const userRole = roles.get(userId)
    const groupRole = memberRoles.get(userId)
    if (userRole === undefined || groupRole === undefined) return AdminGroupActOutcome.NotFound
    if (group.deleted) return AdminGroupActOutcome.GroupDeleted
    if (userRole >= operator.role) return AdminGroupActOutcome.Outranked
    if (groupRole === GroupRole.OWNER) return AdminGroupActOutcome.IsOwner
    const [other] = await tx`
      SELECT 1 FROM group_members m
      JOIN groups g ON g.id = m.group_id AND g.deleted_at IS NULL
      WHERE m.user_id = ${userId} AND m.group_id <> ${groupId}
      LIMIT 1
    `
    if (!other) return AdminGroupActOutcome.LastGroup
    await tx`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}`
    await apiTokenRows(tx).revoke({ userId, groupId }, `membership-ended`)
    await writeAuditEvent(tx, {
      eventKind: MEMBER_REMOVED_EVENT,
      actorId: operator.id,
      groupId,
      targetUserId: userId,
      details: { role: groupRole, [OPERATOR_DETAIL]: 1 },
    })
    await notifyRemoved(tx, groupId, userId)
    // Their own links would let them back in.
    await revokeInvitationsOf(tx, groupId, userId, null, operator.id, undefined, {
      [OPERATOR_DETAIL]: 1,
    })
    await recordAccessChange(tx, groupId, operator.id, MEMBER_REMOVED_EVENT, [userId])
    return AdminGroupActOutcome.Done
  }) as AdminGroupActOutcome
}

/**
 * Hands the group to the member `userId` the way its owner does: the old owner becomes an admin,
 * the subscription's customer is handed over (a subscription that still renews refuses it), the
 * new owner gets a notice, and the old owner's admin invitations are revoked. Only a supervisor or
 * an admin of the product does this, and never when either owner is the operator or outranks them,
 * nor to a blocked member.
 */
export async function transferOwnershipAsOperator(
  sql: postgres.Sql,
  operator: AdminGroupOperator,
  groupId: string,
  userId: number,
): Promise<AdminGroupActOutcome> {
  if (operator.role < ADMIN_GROUP_TRANSFER_ROLE) return AdminGroupActOutcome.RoleTooLow
  if (userId === operator.id) return AdminGroupActOutcome.Self
  try {
    return await sql.begin(async (tx) => {
      const [owner] = await tx<{ ownerUserId: number }[]>`
        SELECT owner_user_id FROM groups WHERE id = ${groupId}
      `
      if (!owner) return AdminGroupActOutcome.NotFound
      const ownerId = owner.ownerUserId
      if (ownerId === operator.id) return AdminGroupActOutcome.Self
      const roles = await lockUsers(tx, [ownerId, userId])
      const group = await lockGroup(tx, groupId)
      if (!group) return AdminGroupActOutcome.NotFound
      // The owner read before the lock may have changed since: read it again under the lock.
      const [locked] = await tx<{ ownerUserId: number }[]>`
        SELECT owner_user_id FROM groups WHERE id = ${groupId}
      `
      if (locked.ownerUserId !== ownerId) return AdminGroupActOutcome.Unchanged
      const memberRoles = await lockMemberRoles(tx, groupId, [ownerId, userId])
      const userRole = roles.get(userId)
      const groupRole = memberRoles.get(userId)
      if (userRole === undefined || groupRole === undefined) return AdminGroupActOutcome.NotFound
      if (group.deleted) return AdminGroupActOutcome.GroupDeleted
      if (groupRole === GroupRole.OWNER) return AdminGroupActOutcome.Unchanged
      const ownerRole = roles.get(ownerId)
      if (userRole >= operator.role || (ownerRole ?? 0) >= operator.role) {
        return AdminGroupActOutcome.Outranked
      }
      const [blocked] = await tx`
        SELECT 1 FROM users WHERE id = ${userId} AND blocked_at IS NOT NULL
      `
      if (blocked) return AdminGroupActOutcome.RecipientBlocked
      await handOverBilling(tx, groupId)
      await tx`
        UPDATE group_members SET role = ${GroupRole.ADMIN}, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ${groupId} AND user_id = ${ownerId}
      `
      await tx`
        UPDATE group_members SET role = ${GroupRole.OWNER}, updated_at = CURRENT_TIMESTAMP
        WHERE group_id = ${groupId} AND user_id = ${userId}
      `
      await tx`UPDATE groups SET owner_user_id = ${userId} WHERE id = ${groupId}`
      await writeAuditEvent(tx, {
        eventKind: OWNERSHIP_TRANSFERRED_EVENT,
        actorId: operator.id,
        groupId,
        targetUserId: userId,
        details: { previousOwnerId: ownerId, [OPERATOR_DETAIL]: 1 },
      })
      await notifyOwnershipReceived(tx, groupId, userId)
      // The old owner is now an admin: their admin links go, their viewer and editor links stay.
      await revokeInvitationsOf(tx, groupId, ownerId, GroupRole.ADMIN, operator.id, undefined, {
        [OPERATOR_DETAIL]: 1,
      })
      await recordAccessChange(tx, groupId, operator.id, OWNERSHIP_TRANSFERRED_EVENT, [])
      return AdminGroupActOutcome.Done
    }) as AdminGroupActOutcome
  } catch (error) {
    if (error instanceof GroupError && error.code === `SUBSCRIPTION_RENEWS`) {
      return AdminGroupActOutcome.SubscriptionRenews
    }
    throw error
  }
}

/**
 * The group's newest {@link ADMIN_GROUP_FILE_LIMIT} files, those of notes in the trash included,
 * with the group's totals. Their type, size, uploader and date only, never a name or a title.
 * `null` when there is no such group.
 */
export async function readAdminGroupFiles(
  sql: postgres.Sql,
  groupId: string,
): Promise<Pick<AdminGroupFiles, "files"> & { total: number; bytes: number } | null> {
  const [group] = await sql`SELECT 1 FROM groups WHERE id = ${groupId}`
  if (!group) return null
  const rows = await sql<
    {
      id: string
      contentType: string
      size: number
      createdAt: Date
      noteDeleted: boolean
      uploaderId: number | null
      uploaderName: string | null
      uploaderEmail: string | null
    }[]
  >`
    SELECT
      a.id, a.content_type, a.size_bytes AS size, a.created_at,
      (n.deleted_at IS NOT NULL) AS note_deleted,
      ${personColumns(sql, `u`, `uploader`)}
    FROM note_attachments a
    JOIN notes n ON n.id = a.note_id
    LEFT JOIN users u ON u.id = a.created_by_user_id
    WHERE n.group_id = ${groupId}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${ADMIN_GROUP_FILE_LIMIT}
  `
  const [totals] = await sql<{ files: number; bytes: string }[]>`
    SELECT COUNT(*)::int AS files, COALESCE(SUM(a.size_bytes), 0)::text AS bytes
    FROM note_attachments a JOIN notes n ON n.id = a.note_id
    WHERE n.group_id = ${groupId}
  `
  return {
    files: rows.map((row) => ({
      id: row.id,
      contentType: row.contentType,
      size: row.size,
      uploader: row.uploaderId === null
        ? null
        : toPerson(row.uploaderId, row.uploaderName, row.uploaderEmail),
      createdAt: row.createdAt.toISOString(),
      noteDeleted: row.noteDeleted,
    })),
    total: totals.files,
    bytes: Number(totals.bytes),
  }
}

/**
 * Removes one file of the group, from a live note or one in the trash, and writes the group's
 * audit row marked as the operator's. Its object is queued for deletion, and the worker's nightly
 * clean-up deletes it. A group in the trash is left as it is.
 */
export async function removeFileAsOperator(
  sql: postgres.Sql,
  operator: AdminGroupOperator,
  groupId: string,
  fileId: string,
): Promise<AdminGroupActOutcome> {
  return await sql.begin(async (tx) => {
    const group = await lockGroup(tx, groupId)
    if (!group) return AdminGroupActOutcome.NotFound
    if (group.deleted) return AdminGroupActOutcome.GroupDeleted
    const key = await removeAttachmentRow(tx, groupId, fileId, operator.id, { operator: true })
    return key === null ? AdminGroupActOutcome.NotFound : AdminGroupActOutcome.Done
  }) as AdminGroupActOutcome
}

/** Every read and action of this module over one `sql` client: the shape `db.adminGroups` gives. */
export function adminGroupRows(sql: postgres.Sql) {
  return {
    list: (filter: AdminGroupFilter, pageSize: number) => listAdminGroups(sql, filter, pageSize),
    find: (groupId: string) => readAdminGroup(sql, groupId),
    revokeInvitation: (operator: AdminGroupOperator, groupId: string, invitationId: string) =>
      revokeInvitationAsOperator(sql, operator, groupId, invitationId),
    removeMember: (operator: AdminGroupOperator, groupId: string, userId: number) =>
      removeMemberAsOperator(sql, operator, groupId, userId),
    transferOwnership: (operator: AdminGroupOperator, groupId: string, userId: number) =>
      transferOwnershipAsOperator(sql, operator, groupId, userId),
    files: (groupId: string) => readAdminGroupFiles(sql, groupId),
    removeFile: (operator: AdminGroupOperator, groupId: string, fileId: string) =>
      removeFileAsOperator(sql, operator, groupId, fileId),
  }
}
