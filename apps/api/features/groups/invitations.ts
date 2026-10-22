import type { CommandHandler, QueryHandler } from "@spy4x/platform/cqrs"
import type { EmailSender } from "@spy4x/email/sender"
import type { RateLimitDecision } from "@spy4x/platform/rate-limit"
import { normalizeEmail } from "@spy4x/server/auth"
import {
  GroupError,
  type GroupInvitation,
  type GroupInvitationAcceptCommand,
  type GroupInvitationAcceptResult,
  type GroupInvitationCreateCommand,
  type GroupInvitationDeclineCommand,
  type GroupInvitationRevokeCommand,
  type GroupInvitationsQuery,
  GroupRole,
  InvitationError,
  type InvitationPreview,
  type InvitationPreviewQuery,
  type MyInvitationsQuery,
} from "@domain/groups"
import {
  type InvitationCreateRecord,
  type InvitationLookup,
  invitationLookup,
  type InvitationPlan,
  type InvitationTarget,
  newInvitationToken,
} from "@server/groups/postgres-invitation-repository.ts"
import { invitationMail, type MailBrand } from "@server/mail/mail.ts"
import { sha256Hex } from "@spy4x/platform/tokens"
import { GroupSelectedEvent } from "../../cqrs/events.ts"

/** Why an account whose address is not proven may not invite; the SPA shows it under the form. */
export const INVITE_NEEDS_PROVEN_EMAIL =
  "Verify your e-mail address in your profile before you invite anyone."

/** The path of an invitation's page in both apps. */
export function invitationPath(token: string): string {
  return `/invite/${token}`
}

/** What the invitation handlers need from the store: `PostgresInvitationRepository`'s shape. */
export interface InvitationStore {
  create(
    record: InvitationCreateRecord,
    actorId: number,
    plan: InvitationPlan,
  ): Promise<{ invitation: GroupInvitation; groupName: string } | null>
  listPending(groupId: string, actorId: number): Promise<GroupInvitation[] | null>
  revoke(
    groupId: string,
    invitationId: string,
    actorId: number,
    requestId?: string,
  ): Promise<boolean>
  preview(ref: InvitationLookup, userId: number): Promise<InvitationPreview>
  listForUser(userId: number): Promise<InvitationPreview[]>
  find(ref: InvitationLookup): Promise<InvitationTarget | null>
  accept(
    ref: InvitationLookup,
    userId: number,
    plan: InvitationPlan,
    requestId?: string,
  ): Promise<GroupInvitationAcceptResult>
  decline(ref: InvitationLookup, userId: number, requestId?: string): Promise<void>
}

/** How an invitation's link is mailed. */
export interface InvitationMail {
  /** `null` when mail is off: nothing is sent and the create answers `mailSent: false`. */
  sender: EmailSender | null
  brand: MailBrand
  /** Spends one of the address's mails for the hour; a refusal sends nothing. */
  byAddress(email: string): Promise<RateLimitDecision>
  /** Told when a send fails. Gets no address, token or link. */
  log(line: string): void
}

export interface InvitationHandlerDependencies {
  invitations: InvitationStore
  /** The user who proved `email`, or `null`: `provenAddressOwner`. */
  ownerOf(email: string): Promise<number | null>
  /** Whether the user's own address is proven: `hasProvenAddress`. */
  addressProven(userId: number): Promise<boolean>
  /**
   * What the group's plan allows an invitation now, read as the entitlement gate reads it: no cap
   * and every role while billing is off.
   */
  planOf(groupId: string): Promise<InvitationPlan>
  /**
   * The group is billed per member and `actorId` may invite to it, so a create must confirm the
   * price. `false` for anyone who may not invite: the store then refuses them as it always does,
   * and they learn nothing of the group's plan.
   */
  seatPriced(groupId: string, actorId: number): Promise<boolean>
  mail: InvitationMail
  emit(event: GroupSelectedEvent): void
}

const ROLE_NAMES: Record<GroupRole, string> = {
  [GroupRole.VIEWER]: "a viewer",
  [GroupRole.EDITOR]: "an editor",
  [GroupRole.ADMIN]: "an admin",
  [GroupRole.OWNER]: "the owner",
}

/**
 * Creates an invitation and, when asked, mails its link. The token is made here and handed back
 * once; the store keeps only its hash. Only an account whose own address is proven may invite, by
 * link or by address (#411): whoever signed up first with somebody else's address could otherwise
 * let a second account of theirs in, and keep it in the group after the owner takes the account
 * back with a password reset. Who may invite with which role, whether the plan allows that role,
 * and the group's member cap are checked by the store on locked rows. A mail that is not sent
 * leaves the invitation in place: the answer says `mailSent: false` and the creator copies the
 * link instead.
 */
export function createInvitationCreateHandler(
  { invitations, addressProven, planOf, seatPriced, mail }: InvitationHandlerDependencies,
): CommandHandler<GroupInvitationCreateCommand> {
  return async (command) => {
    const { data, allowance } = command
    // The gate sets it on every create it lets through; without it the cap would go unchecked.
    if (allowance === undefined) {
      throw new Error(
        "GroupInvitationCreateCommand reached its handler without the entitlement gate",
      )
    }
    const email = data.email === null ? null : normalizeEmail(data.email)
    if (data.email !== null && email === null) {
      throw new GroupError("INVALID_REQUEST", "The e-mail address is invalid")
    }
    if (!(await addressProven(data.actor.userId))) {
      throw new InvitationError("ADDRESS_NOT_PROVEN", INVITE_NEEDS_PROVEN_EMAIL)
    }
    // Each person who joins adds a seat to the bill, so the creator confirms the price first.
    if (!data.acceptSeatPrice && await seatPriced(data.groupId, data.actor.userId)) {
      throw new InvitationError(
        "SEAT_PRICE_NOT_ACCEPTED",
        "Confirm that each person who joins adds a member to the group's bill",
      )
    }
    const token = newInvitationToken()
    const created = await invitations.create(
      {
        groupId: data.groupId,
        role: data.role,
        expiresInDays: data.expiresInDays,
        maxUses: data.maxUses,
        email,
        tokenHash: await sha256Hex(token),
        requestId: data.requestId,
      },
      data.actor.userId,
      // The gate's cap, and the plan's word on the role, which the gate cannot also check.
      { ...await planOf(data.groupId), maxMembers: allowance },
    )
    if (!created) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    const mailSent = data.sendEmail && email !== null
      ? await sendInvitation(mail, {
        to: email,
        token,
        groupName: created.groupName,
        inviterName: created.invitation.createdBy.name,
        role: data.role,
        validDays: data.expiresInDays,
      })
      : false
    return { invitation: created.invitation, token, mailSent }
  }
}

async function sendInvitation(
  mail: InvitationMail,
  input: {
    to: string
    token: string
    groupName: string
    inviterName: string
    role: GroupRole
    validDays: number
  },
): Promise<boolean> {
  if (!mail.sender) return false
  if (!(await mail.byAddress(input.to)).allowed) return false
  try {
    const result = await mail.sender.send(
      invitationMail(mail.brand, {
        to: input.to,
        link: new URL(invitationPath(input.token), mail.brand.webAppUrl).toString(),
        groupName: input.groupName,
        inviterName: input.inviterName,
        roleName: ROLE_NAMES[input.role],
        validDays: input.validDays,
      }),
    )
    if (!result.ok) mail.log("error: an invitation mail was not sent")
    return result.ok
  } catch {
    mail.log("error: an invitation mail failed to send")
    return false
  }
}

/** The group's pending invitations: the owner and admins; a stranger is told it does not exist. */
export function createInvitationListHandler(
  { invitations }: InvitationHandlerDependencies,
): QueryHandler<GroupInvitationsQuery> {
  return async ({ data }) => {
    const list = await invitations.listPending(data.groupId, data.actor.userId)
    if (!list) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { invitations: list }
  }
}

/** Revokes an invitation at once. */
export function createInvitationRevokeHandler(
  { invitations }: InvitationHandlerDependencies,
): CommandHandler<GroupInvitationRevokeCommand> {
  return async ({ data }) => {
    const done = await invitations.revoke(
      data.groupId,
      data.invitationId,
      data.actor.userId,
      data.requestId,
    )
    if (!done) throw new GroupError("GROUP_NOT_FOUND", "Group not found")
    return { revoked: true }
  }
}

/** The invitation behind a link, for the signed-in person who opened it. */
export function createInvitationPreviewHandler(
  { invitations }: InvitationHandlerDependencies,
): QueryHandler<InvitationPreviewQuery> {
  return async ({ data }) => ({
    invitation: await invitations.preview(
      await invitationLookup({ token: data.token }),
      data.actor.userId,
    ),
  })
}

/** The invitations waiting for an address the person proved. */
export function createMyInvitationsHandler(
  { invitations }: InvitationHandlerDependencies,
): QueryHandler<MyInvitationsQuery> {
  return async ({ data }) => ({ invitations: await invitations.listForUser(data.actor.userId) })
}

/**
 * Accepts an invitation. An address-bound one is checked with `ownerOf` first, the one check that
 * trusts an address to name a person, and again by the store on locked rows. The group's plan
 * (member cap and roles) is read for the invitation's group, which only the invitation names, so
 * the entitlement gate cannot check it before the handler; the store counts under the group's lock
 * instead. Then the person's other tabs are told about their new selected group.
 */
export function createInvitationAcceptHandler(
  { invitations, ownerOf, planOf, emit }: InvitationHandlerDependencies,
): CommandHandler<GroupInvitationAcceptCommand> {
  return async ({ data }) => {
    const lookup = await invitationLookup(data.invitation)
    const target = await invitations.find(lookup)
    if (!target) throw new InvitationError("INVITATION_NOT_FOUND", "This invitation does not exist")
    if (target.email !== null && await ownerOf(target.email) !== data.actor.userId) {
      throw new InvitationError(
        "INVITATION_WRONG_ACCOUNT",
        "This invitation is for another e-mail address. Sign in with the account that uses it.",
      )
    }
    const result = await invitations.accept(
      lookup,
      data.actor.userId,
      await planOf(target.groupId),
      data.requestId,
    )
    emit(new GroupSelectedEvent({ userId: data.actor.userId, groupId: result.groupId }))
    return result
  }
}

/** Declines an invitation; see `GroupInvitationDeclineCommand`. */
export function createInvitationDeclineHandler(
  { invitations }: InvitationHandlerDependencies,
): CommandHandler<GroupInvitationDeclineCommand> {
  return async ({ data }) => {
    await invitations.decline(
      await invitationLookup(data.invitation),
      data.actor.userId,
      data.requestId,
    )
    return { declined: true }
  }
}
