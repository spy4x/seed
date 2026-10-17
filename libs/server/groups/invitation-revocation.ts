import type postgres from "postgres"
import { type AuditDetails, type GroupRole, invitableRoles } from "@domain/groups"
import { writeAuditEvent } from "./audit.ts"

/** The audit and change kinds an invitation writes. */
export const INVITATION_EVENTS = {
  created: "group.invitation_created",
  accepted: "group.invitation_accepted",
  revoked: "group.invitation_revoked",
  declined: "group.invitation_declined",
  /** The group's change when someone joins: their membership is new access. */
  memberJoined: "group.member_joined",
} as const

/**
 * Revokes the pending invitations `creatorId` made in the group that they may no longer give:
 * every one when `role` is `null` (they left or were removed), else those whose role `role` may not
 * invite with. Without this, a removed admin could rejoin through their own link, and a demoted
 * one could leave and come back as an editor. Runs in the caller's transaction, under its lock on
 * the group, with one audit row per revoked invitation, carrying `details` when given; answers how
 * many it revoked.
 */
export async function revokeInvitationsOf(
  tx: postgres.Sql,
  groupId: string,
  creatorId: number,
  role: GroupRole | null,
  actorId: number,
  requestId: string | undefined,
  details?: AuditDetails,
): Promise<number> {
  const kept = role === null ? [] : invitableRoles(role)
  const revoked = await tx<{ id: string }[]>`
    UPDATE group_invitations
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE group_id = ${groupId}
      AND created_by_user_id = ${creatorId}
      AND revoked_at IS NULL
      AND declined_at IS NULL
      AND uses < max_uses
      AND expires_at > CURRENT_TIMESTAMP
      ${kept.length > 0 ? tx`AND role NOT IN ${tx(kept)}` : tx``}
    RETURNING id
  `
  for (const { id } of revoked) {
    await writeAuditEvent(tx, {
      eventKind: INVITATION_EVENTS.revoked,
      actorId,
      groupId,
      requestId,
      entityType: "invitation",
      entityId: id,
      details,
    })
  }
  return revoked.length
}

/**
 * Revokes every pending invitation `creatorId` made, in every group: the password reset that takes
 * a squatted account back calls it (#411), so a link the squatter made lets nobody in afterwards.
 * Runs in the caller's transaction, with one audit row per revoked invitation, the creator as its
 * actor; answers how many it revoked.
 */
export async function revokeAllInvitationsOf(tx: postgres.Sql, creatorId: number): Promise<number> {
  const revoked = await tx<{ id: string; groupId: string }[]>`
    UPDATE group_invitations
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE created_by_user_id = ${creatorId}
      AND revoked_at IS NULL
      AND declined_at IS NULL
      AND uses < max_uses
      AND expires_at > CURRENT_TIMESTAMP
    RETURNING id, group_id
  `
  for (const { id, groupId } of revoked) {
    await writeAuditEvent(tx, {
      eventKind: INVITATION_EVENTS.revoked,
      actorId: creatorId,
      groupId,
      entityType: "invitation",
      entityId: id,
    })
  }
  return revoked.length
}
