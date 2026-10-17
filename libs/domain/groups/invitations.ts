import type { Command, Query } from "@spy4x/platform/cqrs"
import { isRecord } from "@spy4x/platform/universal/is-record"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { Actor } from "@domain/identity"
import { canManageMember, GroupError, GroupRole, type SelectedGroup } from "./+lib.ts"

/** How long an invitation works when its creator picks nothing else. */
export const INVITATION_DEFAULT_DAYS = 7

/** The longest an invitation may work. */
export const INVITATION_MAX_DAYS = 30

/** The most people one invitation may let in: a team link. */
export const INVITATION_MAX_USES = 100

/** Random bytes in an invitation's token: 256 bits, 43 base64url characters. */
export const INVITATION_TOKEN_BYTES = 32

/** Why an invitation was refused. */
export type InvitationErrorCode =
  /**
   * The creator's own address is not proven (#411). Whoever signed up with somebody else's address
   * could otherwise let a second account of theirs into the group before the owner takes the
   * account back with a password reset.
   */
  | "ADDRESS_NOT_PROVEN"
  | "ALREADY_MEMBER"
  | "INVITATION_ALREADY_USED"
  | "INVITATION_EXPIRED"
  | "INVITATION_NOT_FOUND"
  | "INVITATION_REVOKED"
  | "INVITATION_USED_UP"
  | "INVITATION_WRONG_ACCOUNT"
  /**
   * The group is billed per member, and the create did not confirm that each person who joins
   * raises the bill (`acceptSeatPrice`).
   */
  | "SEAT_PRICE_NOT_ACCEPTED"

export class InvitationError extends Error {
  constructor(
    public readonly code: InvitationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "InvitationError"
  }
}

/** A pending invitation, as the group's Invitations section lists it. Never carries its token. */
export interface GroupInvitation {
  id: string
  groupId: string
  /** The role the person gets on accepting. */
  role: GroupRole
  /** The only address whose proven owner may accept it, or `null` for a link anyone may use. */
  email: string | null
  maxUses: number
  uses: number
  expiresAt: Date
  createdAt: Date
  /** Who created it: their id and their name, empty when they set none. */
  createdBy: { userId: number; name: string }
}

/** What the person invited sees before they accept: the group, who asked and the role. */
export interface InvitationPreview {
  id: string
  groupId: string
  groupName: string
  /** The name of whoever created it; empty when they set none. */
  inviterName: string
  role: GroupRole
  /** It is tied to one e-mail address, so only the account that proved it may accept. */
  addressed: boolean
  /**
   * The person asking may accept it: a link anyone may use, or one tied to an address they proved.
   * The address itself is never shown, so a forwarded link does not reveal it.
   */
  forYou: boolean
  expiresAt: Date
}

/** An invitation named by its link's token, or by its id for one tied to the person's address. */
export type InvitationRef = { token: string } | { invitationId: string }

/** What a creator asks for. Every field but `role` has a default. */
export interface InvitationCreateInput {
  role: GroupRole
  /** Days until it stops working: 1 to {@link INVITATION_MAX_DAYS}. */
  expiresInDays: number
  /** How many people it lets in: 1 to {@link INVITATION_MAX_USES}; always 1 with an address. */
  maxUses: number
  /** The address it is tied to, as typed; `null` for a link anyone may use. */
  email: string | null
  /** Mail the link to `email`. Off unless asked for. */
  sendEmail: boolean
  /**
   * The creator saw the per-member price the group pays and accepts that each person who joins
   * adds a seat. Required while the group is billed per member; off unless sent.
   */
  acceptSeatPrice: boolean
}

export interface GroupInvitationCreatePayload extends InvitationCreateInput {
  actor: Actor
  groupId: string
  requestId?: string
}

/** The new invitation and its token, which is shown here once and never stored. */
export interface GroupInvitationCreateResult {
  invitation: GroupInvitation
  token: string
  /** Whether the link was mailed: `false` when no mail was asked for, mail is off or it failed. */
  mailSent: boolean
}

/**
 * Creates an invitation, by {@link assertCanInvite}. Not idempotent on purpose: its answer carries
 * the token, which must never be stored, and the idempotency store keeps answers. A retry makes a
 * second invitation, which the creator can revoke.
 */
export class GroupInvitationCreateCommand
  implements Command<GroupInvitationCreatePayload, GroupInvitationCreateResult> {
  __resultType?: GroupInvitationCreateResult
  /** The group's member cap, from the entitlement gate; `null` for none. */
  allowance?: number | null
  constructor(public data: GroupInvitationCreatePayload) {}
}

export interface GroupInvitationRevokePayload {
  actor: Actor
  groupId: string
  invitationId: string
  requestId?: string
}

/** Revokes a pending invitation at once. The owner and an admin may, for roles they could give. */
export class GroupInvitationRevokeCommand
  implements Command<GroupInvitationRevokePayload, { revoked: true }> {
  __resultType?: { revoked: true }
  constructor(public data: GroupInvitationRevokePayload) {}
}

export interface GroupInvitationAnswerPayload {
  actor: Actor
  invitation: InvitationRef
  requestId?: string
}

/** What an accept changed: the group joined, the role given, and the person's new selection. */
export interface GroupInvitationAcceptResult {
  groupId: string
  role: GroupRole
  selected: SelectedGroup
}

/**
 * Accepts an invitation: the person joins with its role, and the group becomes their selected one.
 * Refused when it expired, was revoked or declined, is used up, is tied to another person's address,
 * or the group is full for its plan.
 */
export class GroupInvitationAcceptCommand
  implements Command<GroupInvitationAnswerPayload, GroupInvitationAcceptResult> {
  __resultType?: GroupInvitationAcceptResult
  constructor(public data: GroupInvitationAnswerPayload) {}
}

/**
 * Declines an invitation. One tied to the person's address stops working; a link anyone may use
 * stays as it is, since someone else may still be meant to use it.
 */
export class GroupInvitationDeclineCommand
  implements Command<GroupInvitationAnswerPayload, { declined: true }> {
  __resultType?: { declined: true }
  constructor(public data: GroupInvitationAnswerPayload) {}
}

export interface GroupInvitationsPayload {
  actor: Actor
  groupId: string
}

/** The group's pending invitations, newest first: for the owner and admins. */
export class GroupInvitationsQuery
  implements Query<GroupInvitationsPayload, { invitations: GroupInvitation[] }> {
  __resultType?: { invitations: GroupInvitation[] }
  constructor(public data: GroupInvitationsPayload) {}
}

export interface InvitationPreviewPayload {
  actor: Actor
  token: string
}

/** The invitation behind a link, as the person invited sees it, or why it no longer works. */
export class InvitationPreviewQuery
  implements Query<InvitationPreviewPayload, { invitation: InvitationPreview }> {
  __resultType?: { invitation: InvitationPreview }
  constructor(public data: InvitationPreviewPayload) {}
}

export interface MyInvitationsPayload {
  actor: Actor
}

/** The pending invitations tied to an address the person has proven, newest first. */
export class MyInvitationsQuery
  implements Query<MyInvitationsPayload, { invitations: InvitationPreview[] }> {
  __resultType?: { invitations: InvitationPreview[] }
  constructor(public data: MyInvitationsPayload) {}
}

/** What the invitation store needs from a row to say whether it still works. */
export interface InvitationState {
  revokedAt: Date | null
  declinedAt: Date | null
  expiresAt: Date
  uses: number
  maxUses: number
}

/**
 * Why an invitation no longer works at `now`, or `null` when it does. Revoked or declined comes
 * first, then used up, then expired, so the answer names the act that ended it.
 */
export function invitationRefusal(state: InvitationState, now: Date): InvitationError | null {
  if (state.revokedAt !== null || state.declinedAt !== null) {
    return new InvitationError("INVITATION_REVOKED", "This invitation was withdrawn or declined")
  }
  if (state.uses >= state.maxUses) {
    return new InvitationError("INVITATION_USED_UP", "This invitation has been used up")
  }
  if (state.expiresAt.getTime() <= now.getTime()) {
    return new InvitationError("INVITATION_EXPIRED", "This invitation has expired")
  }
  return null
}

/**
 * The roles `actor` may invite with: by {@link canManageMember}, as if giving a new viewer that
 * role. The owner invites up to admin, an admin up to editor, and an editor or viewer invites
 * nobody.
 */
export function invitableRoles(actor: GroupRole): GroupRole[] {
  return [GroupRole.VIEWER, GroupRole.EDITOR, GroupRole.ADMIN].filter((role) =>
    canManageMember(actor, GroupRole.VIEWER, role)
  )
}

/**
 * The roles `actor` may invite with on a plan: {@link invitableRoles}, or only a viewer when the
 * plan lacks `memberRoles`, since joining as an editor or admin is what that feature sells.
 */
export function invitableRolesOnPlan(actor: GroupRole, memberRoles: boolean): GroupRole[] {
  const roles = invitableRoles(actor)
  return memberRoles ? roles : roles.filter((role) => role === GroupRole.VIEWER)
}

/** Whether `actor` may see and manage the group's invitations: the owner and admins. */
export function canManageInvitations(actor: GroupRole): boolean {
  return invitableRoles(actor).length > 0
}

/**
 * Throws unless `actor` may invite with `role`. `null` is a non-member, who is told the group does
 * not exist.
 */
export function assertCanInvite(actor: GroupRole | null, role: GroupRole): void {
  if (actor === null) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
  const roles = invitableRoles(actor)
  if (roles.length === 0) {
    throw new GroupError("ROLE_INSUFFICIENT", "Only the owner or an admin can invite people")
  }
  if (!roles.includes(role)) {
    throw new GroupError(
      "ROLE_INSUFFICIENT",
      "An admin can invite viewers and editors only; the owner can invite admins",
    )
  }
}

const CREATE_KEYS = ["acceptSeatPrice", "email", "expiresInDays", "maxUses", "role", "sendEmail"]
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

/**
 * The body of an invitation create: `role`, and optionally `expiresInDays` (default
 * {@link INVITATION_DEFAULT_DAYS}), `maxUses` (default 1), `email` (default none), `sendEmail`
 * (default `false`) and `acceptSeatPrice` (default `false`). An empty `email` means none. A mail
 * needs an address, and an invitation tied to an address lets one person in. Shape only: the
 * address itself is checked where it is read.
 */
export function parseInvitationCreateBody(value: unknown): InvitationCreateInput {
  if (!isRecord(value) || !Object.keys(value).every((key) => CREATE_KEYS.includes(key))) {
    throw invalid(
      "Expected role, and optionally expiresInDays, maxUses, email, sendEmail and acceptSeatPrice",
    )
  }
  const role = value.role
  if (role !== GroupRole.VIEWER && role !== GroupRole.EDITOR && role !== GroupRole.ADMIN) {
    throw invalid("Role must be 1 (viewer), 2 (editor) or 3 (admin)")
  }
  const expiresInDays = value.expiresInDays ?? INVITATION_DEFAULT_DAYS
  if (!isWholeBetween(expiresInDays, 1, INVITATION_MAX_DAYS)) {
    throw invalid(`An invitation works for 1 to ${INVITATION_MAX_DAYS} days`)
  }
  const maxUses = value.maxUses ?? 1
  if (!isWholeBetween(maxUses, 1, INVITATION_MAX_USES)) {
    throw invalid(`An invitation lets in 1 to ${INVITATION_MAX_USES} people`)
  }
  const rawEmail = value.email ?? ""
  if (typeof rawEmail !== "string" || rawEmail.length > 254) {
    throw invalid("The e-mail address is invalid")
  }
  const email = rawEmail.trim() === "" ? null : rawEmail.trim()
  const sendEmail = value.sendEmail ?? false
  if (typeof sendEmail !== "boolean") throw invalid("sendEmail must be true or false")
  if (sendEmail && email === null) throw invalid("Enter the e-mail address to send the link to")
  if (email !== null && maxUses !== 1) {
    throw invalid("An invitation for one e-mail address lets in one person")
  }
  const acceptSeatPrice = value.acceptSeatPrice ?? false
  if (typeof acceptSeatPrice !== "boolean") throw invalid("acceptSeatPrice must be true or false")
  return { role, expiresInDays, maxUses, email, sendEmail, acceptSeatPrice }
}

/** An invitation's id from a request: a lowercase UUID of any version, or `INVALID_REQUEST`. */
export function parseInvitationId(value: unknown): string {
  if (!isUuid(value)) {
    throw invalid("Invitation id must be a lowercase UUID")
  }
  return value
}

/** An invitation token from a request: 43 base64url characters, or `INVALID_REQUEST`. */
export function parseInvitationToken(value: unknown): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw invalid("The invitation link is incomplete")
  }
  return value
}

/** The body of a preview: exactly `{ token }`. */
export function parseInvitationTokenBody(value: unknown): { token: string } {
  if (!isRecord(value) || Object.keys(value).join(",") !== "token") {
    throw invalid("Expected exactly token")
  }
  return { token: parseInvitationToken(value.token) }
}

/** The body of an accept or decline: exactly `{ token }` or exactly `{ invitationId }`. */
export function parseInvitationRef(value: unknown): InvitationRef {
  const keys = isRecord(value) ? Object.keys(value).join(",") : ""
  if (isRecord(value) && keys === "token") return { token: parseInvitationToken(value.token) }
  if (isRecord(value) && keys === "invitationId") {
    return { invitationId: parseInvitationId(value.invitationId) }
  }
  throw invalid("Expected exactly token or exactly invitationId")
}

function invalid(message: string): GroupError {
  return new GroupError("INVALID_REQUEST", message)
}

function isWholeBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}
