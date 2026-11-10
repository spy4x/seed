/**
 * Who may make an account (`SIGN_UP`, docs/deploy.md "Who may sign up"). With `open` anyone may;
 * with `invite` only a person a member invited. Every flow of `createSignIn` that writes a new
 * `users` row accepts the invitation in the transaction that writes it ({@link joinInvitedGroup}),
 * so each sign-up uses one up and joins its group. The password sign-up also asks
 * {@link signUpAllowed} before it mails a code, so a refused one sends nothing. The operator
 * command line and the demo seed build their sign-in without a mode, so they stay `open` and never
 * meet the gate.
 *
 * @module
 */
import { normalizeEmail } from "@spy4x/server/auth"
import { PlanError } from "@domain/billing"
import { GroupError, InvitationError } from "@domain/groups"
import { SIGN_UP_CLOSED_MESSAGE } from "@domain/identity"
import {
  invitationLookup,
  type InvitationPlan,
  type PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"

/** `open`: anyone may make an account. `invite`: only a person a member invited. */
export type SignUpMode = `open` | `invite`

/** Thrown by a flow that would make an account the gate refused; routes answer `SIGN_UP_CLOSED`. */
export class SignUpClosedError extends Error {
  constructor() {
    super(SIGN_UP_CLOSED_MESSAGE)
    this.name = `SignUpClosedError`
  }
}

/**
 * Whether a new account for `email` may be made. Always with `open`. With `invite`, only when
 * `invitation` is the token of an invitation that still works (`usable`) and admits the address:
 * one tied to an address admits only that address, normalised; a link invitation, tied to none,
 * admits any, since whoever holds the link was invited. `email` is the address the step proved,
 * or `null` when it proved none, which only a link invitation admits.
 */
export async function signUpAllowed(
  mode: SignUpMode,
  invitations: Pick<PostgresInvitationRepository, `usable`>,
  invitation: string | null | undefined,
  email: string | null,
): Promise<boolean> {
  if (mode === `open`) return true
  if (!invitation) return false
  const found = await invitations.usable(await invitationLookup({ token: invitation }))
  if (found === null) return false
  if (found.email === null) return true
  return email !== null && normalizeEmail(email) === found.email
}

/**
 * Accepts the sign-up's `invitation` for the new account `userId`, through `invitations` built over
 * the transaction that wrote its `users` row: the use is counted and the person joins the
 * invitation's group, or the whole sign-up rolls back. Nothing with `open`, which ignores an
 * invitation. Every refusal of the accept (none given, used up, revoked, another address, the
 * group full) throws {@link SignUpClosedError}, so a stranger learns nothing of the group.
 */
export async function joinInvitedGroup(
  mode: SignUpMode,
  invitations: Pick<PostgresInvitationRepository, `find` | `accept`>,
  planOf: (groupId: string) => Promise<InvitationPlan>,
  invitation: string | null | undefined,
  userId: number,
): Promise<void> {
  if (mode === `open`) return
  if (!invitation) throw new SignUpClosedError()
  const lookup = await invitationLookup({ token: invitation })
  const target = await invitations.find(lookup)
  if (target === null) throw new SignUpClosedError()
  try {
    await invitations.accept(lookup, userId, await planOf(target.groupId))
  } catch (error) {
    const refused = error instanceof InvitationError || error instanceof GroupError ||
      error instanceof PlanError
    throw refused ? new SignUpClosedError() : error
  }
}
