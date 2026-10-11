import type postgres from "postgres"
import { randomBase64Url, sha256Hex } from "@spy4x/platform/tokens"
import { assertRoomFor, PlanError } from "@domain/billing"
import {
  assertCanInvite,
  canManageBilling,
  canManageInvitations,
  GroupError,
  type GroupInvitation,
  type GroupInvitationAcceptResult,
  GroupRole,
  INVITATION_TOKEN_BYTES,
  InvitationError,
  type InvitationPreview,
  type InvitationRef,
  invitationRefusal,
  type InvitationState,
} from "@domain/groups"
import { recordAccessChange } from "./group-change-log.ts"
import { type AuditEventInput, writeAuditEvent } from "./audit.ts"
import { notifyInvitationReceived } from "./group-notifications.ts"
import { INVITATION_EVENTS } from "./invitation-revocation.ts"
import { storeSelection } from "./postgres-group-repository.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

export { INVITATION_EVENTS } from "./invitation-revocation.ts"

/** Most pending invitations the Invitations section lists, and most a person sees for themselves. */
const INVITATION_LIST_LIMIT = 100

/** What a create stores. The token itself never reaches this layer: only its hash. */
export interface InvitationCreateRecord {
  groupId: string
  role: GroupRole
  expiresInDays: number
  maxUses: number
  /** Already normalised; `null` for a link anyone may use. */
  email: string | null
  tokenHash: string
  requestId?: string
}

/**
 * How a stored invitation is found: by the SHA-256 of its link's token, or by its id for one tied
 * to an address. The raw token never reaches this layer.
 */
export type InvitationLookup = { tokenHash: string } | { invitationId: string }

/**
 * What the group's plan allows an invitation, read outside the write the way the entitlement gate
 * reads it: the member cap (`null` for none) and whether it may carry a role above viewer.
 */
export interface InvitationPlan {
  maxMembers: number | null
  memberRoles: boolean
}

/** A new link's token: random, shown to its creator once, and stored only as its hash. */
export function newInvitationToken(): string {
  return randomBase64Url(INVITATION_TOKEN_BYTES)
}

/** How the store finds the invitation a request names: a token by its SHA-256, an id as it is. */
export async function invitationLookup(ref: InvitationRef): Promise<InvitationLookup> {
  return "token" in ref ? { tokenHash: await sha256Hex(ref.token) } : ref
}

/** An invitation found by its token or id: what the accept needs before it locks anything. */
export interface InvitationTarget {
  id: string
  groupId: string
  email: string | null
}

interface InvitationRow extends postgres.Row, InvitationState {
  id: string
  groupId: string
  role: GroupRole
  email: string | null
  createdByUserId: number
}

interface ListedRow extends postgres.Row {
  id: string
  groupId: string
  role: GroupRole
  email: string | null
  maxUses: number
  uses: number
  expiresAt: Date
  createdAt: Date
  createdByUserId: number
  createdByName: string
}

interface PreviewRow extends postgres.Row, InvitationState {
  id: string
  groupId: string
  groupName: string
  inviterName: string
  role: GroupRole
  email: string | null
  forYou: boolean
}

/**
 * Invitations to a group, in Postgres. A link's token is looked up by its SHA-256 only: the raw
 * token is never written or compared. An equality lookup on a unique index of a 256-bit token's
 * hash leaks nothing an attacker can use, so no constant-time compare is needed here; there is no
 * stored secret a guess is compared against byte by byte.
 *
 * Every write runs in one transaction with its audit row, and locks in the order every group write
 * uses: the user, then the group, then rows under it.
 */
export class PostgresInvitationRepository {
  constructor(private readonly sql: postgres.Sql) {}

  /** The group's members, the owner included: the usage the entitlement gate checks `maxMembers` on. */
  async countMembers(groupId: string): Promise<number> {
    return await countMembers(this.sql, groupId)
  }

  /**
   * Creates an invitation, checking on locked rows that the actor may invite with its role, that
   * the plan allows that role and that the group has room for one more member. Pending
   * invitations do not count as members. Answers the group's name too, for the mail. `null` when
   * the group is missing or deleted.
   */
  async create(
    record: InvitationCreateRecord,
    actorId: number,
    plan: InvitationPlan,
  ): Promise<{ invitation: GroupInvitation; groupName: string } | null> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      const groupName = await lockActiveGroup(tx, record.groupId)
      if (groupName === null) return null
      const actorRole = await lockRole(tx, record.groupId, actorId)
      assertCanInvite(actorRole, record.role)
      assertRoleOnPlan(plan, record.role, actorRole!)
      if (plan.maxMembers !== null) {
        assertRoomFor(
          "maxMembers",
          plan.maxMembers,
          await countMembers(tx, record.groupId),
          actorRole!,
        )
      }
      const id = uuidV7()
      await tx`
        INSERT INTO group_invitations (
          id, group_id, token_hash, role, email, max_uses, created_by_user_id, expires_at
        ) VALUES (
          ${id}, ${record.groupId}, ${record.tokenHash}, ${record.role}, ${record.email},
          ${record.maxUses}, ${actorId},
          CURRENT_TIMESTAMP + make_interval(days => ${record.expiresInDays})
        )
      `
      await audit(tx, record.groupId, actorId, INVITATION_EVENTS.created, record.requestId, {
        entityType: "invitation",
        entityId: id,
        details: { role: record.role },
      })
      if (record.email !== null) {
        await notifyInvitationReceived(tx, record.groupId, record.email, record.role)
      }
      return { invitation: (await listInvitations(tx, record.groupId, { id }))[0], groupName }
    })
  }

  /**
   * The group's pending invitations, newest first. `null` when the group is missing or the actor
   * is not a member; `ROLE_INSUFFICIENT` for a member who may not manage invitations.
   */
  async listPending(groupId: string, actorId: number): Promise<GroupInvitation[] | null> {
    const role = await readRole(this.sql, groupId, actorId)
    if (role === null) return null
    if (!canManageInvitations(role)) {
      throw new GroupError("ROLE_INSUFFICIENT", "Only the owner or an admin sees the invitations")
    }
    return await listInvitations(this.sql, groupId, {})
  }

  /**
   * Revokes a pending invitation at once, for an actor who could create it (an admin cannot revoke
   * an admin's invitation the owner made). Revoking one that is no longer pending changes nothing.
   * `false` when the group is missing or deleted.
   */
  async revoke(
    groupId: string,
    invitationId: string,
    actorId: number,
    requestId?: string,
  ): Promise<boolean> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      if (await lockActiveGroup(tx, groupId) === null) return false
      const actorRole = await lockRole(tx, groupId, actorId)
      if (actorRole === null) return false
      const [invitation] = await tx<InvitationRow[]>`
        SELECT * FROM group_invitations
        WHERE id = ${invitationId} AND group_id = ${groupId}
        FOR UPDATE
      `
      if (!invitation) throw notFound()
      assertCanInvite(actorRole, invitation.role)
      if (invitationRefusal(invitation, new Date()) === null) {
        await tx`UPDATE group_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = ${invitationId}`
        await audit(tx, groupId, actorId, INVITATION_EVENTS.revoked, requestId, {
          entityType: "invitation",
          entityId: invitationId,
          details: { role: invitation.role },
        })
      }
      return true
    })
  }

  /**
   * The invitation a link or an id names, as `userId` would see it before accepting; refused with
   * the reason when it no longer works. By id only an invitation tied to an address: a link's own
   * invitation is found by its token alone, so knowing an id lets nobody in.
   */
  async preview(ref: InvitationLookup, userId: number): Promise<InvitationPreview> {
    const [row] = await this.sql<PreviewRow[]>`
      SELECT
        group_invitations.*,
        groups.name AS group_name,
        btrim(concat_ws(' ', inviter.first_name, inviter.last_name)) AS inviter_name,
        (
          group_invitations.email IS NULL OR EXISTS (
            SELECT 1 FROM auth_email_owners
            WHERE auth_email_owners.email = group_invitations.email
              AND auth_email_owners.user_id = ${userId}
          )
        ) AS for_you
      FROM group_invitations
      INNER JOIN groups ON groups.id = group_invitations.group_id AND groups.deleted_at IS NULL
      INNER JOIN users inviter ON inviter.id = group_invitations.created_by_user_id
      WHERE ${refFilter(this.sql, ref)}
    `
    if (!row) throw notFound()
    const refusal = invitationRefusal(row, new Date())
    if (refusal) throw refusal
    return toPreview(row)
  }

  /**
   * The pending invitations tied to an address `userId` has proven, for groups they are not in yet,
   * newest first.
   */
  async listForUser(userId: number): Promise<InvitationPreview[]> {
    const rows = await this.sql<PreviewRow[]>`
      SELECT
        group_invitations.*,
        groups.name AS group_name,
        btrim(concat_ws(' ', inviter.first_name, inviter.last_name)) AS inviter_name,
        TRUE AS for_you
      FROM group_invitations
      INNER JOIN auth_email_owners
        ON auth_email_owners.email = group_invitations.email
       AND auth_email_owners.user_id = ${userId}
      INNER JOIN groups ON groups.id = group_invitations.group_id AND groups.deleted_at IS NULL
      INNER JOIN users inviter ON inviter.id = group_invitations.created_by_user_id
      WHERE group_invitations.revoked_at IS NULL
        AND group_invitations.declined_at IS NULL
        AND group_invitations.uses < group_invitations.max_uses
        AND group_invitations.expires_at > CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM group_members
          WHERE group_members.group_id = group_invitations.group_id
            AND group_members.user_id = ${userId}
        )
      ORDER BY group_invitations.created_at DESC, group_invitations.id
      LIMIT ${INVITATION_LIST_LIMIT}
    `
    return rows.map(toPreview)
  }

  /** The group and address of the invitation `ref` names, or `null`; see {@link preview}. */
  async find(ref: InvitationLookup): Promise<InvitationTarget | null> {
    const [row] = await this.sql<InvitationTarget[]>`
      SELECT id, group_id, email FROM group_invitations WHERE ${refFilter(this.sql, ref)}
    `
    return row ?? null
  }

  /**
   * Accepts an invitation, in one transaction: on locked rows it checks that the invitation still
   * works, that an address-bound one belongs to `userId`, that they are not a member yet, that
   * they never accepted it before (a removed member cannot rejoin through the same link), that the
   * plan allows its role and that the group has room. It adds the membership with the invitation's
   * role, records who accepted, counts the use, writes the audit row, records the group's change
   * and makes the group the person's selected one.
   */
  async accept(
    ref: InvitationLookup,
    userId: number,
    plan: InvitationPlan,
    requestId?: string,
  ): Promise<GroupInvitationAcceptResult> {
    return await this.sql.begin(async (tx: postgres.TransactionSql) => {
      const [user] = await tx`
        SELECT id FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR NO KEY UPDATE
      `
      if (!user) throw new GroupError("USER_NOT_ACTIVE", "User is not active")
      const [target] = await tx<InvitationTarget[]>`
        SELECT id, group_id, email FROM group_invitations WHERE ${refFilter(tx, ref)}
      `
      if (!target || await lockActiveGroup(tx, target.groupId) === null) throw notFound()
      const [invitation] = await tx<InvitationRow[]>`
        SELECT * FROM group_invitations WHERE id = ${target.id} FOR UPDATE
      `
      const refusal = invitationRefusal(invitation, new Date())
      if (refusal) throw refusal
      if (await lockRole(tx, invitation.groupId, userId) !== null) {
        throw new InvitationError("ALREADY_MEMBER", "You are already a member of this group")
      }
      if (invitation.email !== null && !await ownsAddress(tx, invitation.email, userId)) {
        throw wrongAccount()
      }
      const [acceptedBefore] = await tx`
        SELECT 1 FROM group_invitation_acceptances
        WHERE invitation_id = ${invitation.id} AND user_id = ${userId}
      `
      if (acceptedBefore) {
        throw new InvitationError(
          "INVITATION_ALREADY_USED",
          "You have already joined through this invitation. Ask for a new one to join again.",
        )
      }
      // Not a member, so they cannot change the plan: the refusal tells them to ask the owner.
      assertRoleOnPlan(plan, invitation.role, GroupRole.VIEWER)
      if (plan.maxMembers !== null) {
        assertRoomFor(
          "maxMembers",
          plan.maxMembers,
          await countMembers(tx, invitation.groupId),
          invitation.role,
        )
      }
      await tx`
        INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
        VALUES (${invitation.groupId}, ${userId}, ${invitation.role}, ${invitation.createdByUserId})
      `
      await tx`
        INSERT INTO group_invitation_acceptances (invitation_id, user_id)
        VALUES (${invitation.id}, ${userId})
      `
      await tx`UPDATE group_invitations SET uses = uses + 1 WHERE id = ${invitation.id}`
      await audit(tx, invitation.groupId, userId, INVITATION_EVENTS.accepted, requestId, {
        entityType: "invitation",
        entityId: invitation.id,
        details: { role: invitation.role },
      })
      // Nobody loses access; the raised revision and the group's hint tell its open pages.
      await recordAccessChange(tx, invitation.groupId, userId, INVITATION_EVENTS.memberJoined, [])
      const selected = await storeSelection(tx, userId, invitation.groupId)
      return { groupId: invitation.groupId, role: invitation.role, selected }
    })
  }

  /**
   * Declines an invitation tied to `userId`'s address: it stops working, with an audit row. A link
   * anyone may use is left as it is, and one that no longer works changes nothing.
   */
  async decline(ref: InvitationLookup, userId: number, requestId?: string): Promise<void> {
    await this.sql.begin(async (tx: postgres.TransactionSql) => {
      const [invitation] = await tx<InvitationRow[]>`
        SELECT * FROM group_invitations WHERE ${refFilter(tx, ref)} FOR UPDATE
      `
      if (!invitation) throw notFound()
      if (invitation.email === null) return
      if (!await ownsAddress(tx, invitation.email, userId)) throw wrongAccount()
      if (invitationRefusal(invitation, new Date()) !== null) return
      await tx`UPDATE group_invitations SET declined_at = CURRENT_TIMESTAMP WHERE id = ${invitation.id}`
      await audit(tx, invitation.groupId, userId, INVITATION_EVENTS.declined, requestId, {
        entityType: "invitation",
        entityId: invitation.id,
      })
    })
  }
}

/**
 * The `WHERE` of an invitation named by `ref`. By id it matches only an invitation tied to an
 * address, whose acceptance the address's owner alone can make.
 */
function refFilter(sql: postgres.Sql, ref: InvitationLookup) {
  return "tokenHash" in ref
    ? sql`group_invitations.token_hash = ${ref.tokenHash}`
    : sql`group_invitations.id = ${ref.invitationId} AND group_invitations.email IS NOT NULL`
}

/**
 * Refuses a role above viewer on a plan without `memberRoles`, with the plan's refusal; `actorRole`
 * says whether the person asking may change the plan.
 */
function assertRoleOnPlan(plan: InvitationPlan, role: GroupRole, actorRole: GroupRole): void {
  if (plan.memberRoles || role === GroupRole.VIEWER) return
  throw new PlanError(
    "PLAN_FEATURE_MISSING",
    "memberRoles",
    null,
    canManageBilling(actorRole),
    "The group's plan lets an invitation add viewers only",
  )
}

function notFound(): InvitationError {
  return new InvitationError("INVITATION_NOT_FOUND", "This invitation does not exist")
}

function wrongAccount(): InvitationError {
  return new InvitationError(
    "INVITATION_WRONG_ACCOUNT",
    "This invitation is for another e-mail address. Sign in with the account that uses it.",
  )
}

/** Locks the group's row while it is active and answers its name; `null` when it is not. */
async function lockActiveGroup(sql: postgres.Sql, groupId: string): Promise<string | null> {
  const [row] = await sql<{ name: string }[]>`
    SELECT name FROM groups WHERE id = ${groupId} AND deleted_at IS NULL FOR NO KEY UPDATE
  `
  return row?.name ?? null
}

/** Locks `userId`'s membership of the group and answers its role, or `null` for a non-member. */
async function lockRole(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
): Promise<GroupRole | null> {
  const [row] = await sql<{ role: GroupRole }[]>`
    SELECT group_members.role
    FROM group_members
    INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
    WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${userId}
    FOR UPDATE OF group_members
  `
  return row?.role ?? null
}

/** `userId`'s role in an active group, or `null` for a non-member or a missing group. */
async function readRole(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
): Promise<GroupRole | null> {
  const [row] = await sql<{ role: GroupRole }[]>`
    SELECT group_members.role
    FROM group_members
    INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
    INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
    WHERE group_members.group_id = ${groupId} AND group_members.user_id = ${userId}
  `
  return row?.role ?? null
}

/** The group's members, the owner included: what the plan's `maxMembers` caps. */
async function countMembers(sql: postgres.Sql, groupId: string): Promise<number> {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM group_members
    INNER JOIN users ON users.id = group_members.user_id AND users.deleted_at IS NULL
    WHERE group_members.group_id = ${groupId}
  `
  return row.count
}

/** Whether `userId` proved `email`: the same table `provenAddressOwner` reads. */
async function ownsAddress(sql: postgres.Sql, email: string, userId: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM auth_email_owners WHERE email = ${email} AND user_id = ${userId}
  `
  return rows.length > 0
}

/** The group's pending invitations, newest first; with `id`, that one whatever its state. */
async function listInvitations(
  sql: postgres.Sql,
  groupId: string,
  { id }: { id?: string },
): Promise<GroupInvitation[]> {
  const rows = await sql<ListedRow[]>`
    SELECT
      group_invitations.id,
      group_invitations.group_id,
      group_invitations.role,
      group_invitations.email,
      group_invitations.max_uses,
      group_invitations.uses,
      group_invitations.expires_at,
      group_invitations.created_at,
      group_invitations.created_by_user_id,
      btrim(concat_ws(' ', users.first_name, users.last_name)) AS created_by_name
    FROM group_invitations
    INNER JOIN users ON users.id = group_invitations.created_by_user_id
    WHERE group_invitations.group_id = ${groupId}
      AND ${
    id === undefined
      ? sql`
        group_invitations.revoked_at IS NULL
        AND group_invitations.declined_at IS NULL
        AND group_invitations.uses < group_invitations.max_uses
        AND group_invitations.expires_at > CURRENT_TIMESTAMP`
      : sql`group_invitations.id = ${id}`
  }
    ORDER BY group_invitations.created_at DESC, group_invitations.id
    LIMIT ${INVITATION_LIST_LIMIT}
  `
  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    role: row.role,
    email: row.email,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    createdBy: { userId: row.createdByUserId, name: row.createdByName },
  }))
}

function toPreview(row: PreviewRow): InvitationPreview {
  return {
    id: row.id,
    groupId: row.groupId,
    groupName: row.groupName,
    inviterName: row.inviterName,
    role: row.role,
    addressed: row.email !== null,
    forYou: row.forYou,
    expiresAt: row.expiresAt,
  }
}

/** Writes one audit row in the current transaction. */
async function audit(
  sql: postgres.Sql,
  groupId: string,
  actorId: number,
  eventKind: string,
  requestId: string | undefined,
  facts: Pick<AuditEventInput, "entityType" | "entityId" | "details"> = {},
): Promise<void> {
  await writeAuditEvent(sql, { eventKind, actorId, groupId, requestId, ...facts })
}
