import { ApiTokenError } from "@domain/api-tokens"
import type { ActorToken } from "@domain/identity"
import { NoteCreateCommand, NoteGetQuery, NoteListQuery } from "@domain/notes"

// deno-lint-ignore no-explicit-any
type MessageConstructor = new (...args: any[]) => { data: unknown }

/** What a message asks of an API token. */
export enum TokenNeed {
  /** Any live token of the group: a read-only one too. */
  READ = 1,
  /** A read-write token of the group. */
  WRITE = 2,
}

/**
 * The messages an API token may send, and what each one needs. Deny by default: anything
 * missing here is refused for a token, whatever the owner could do with a session, so a new
 * command never becomes reachable by a script by accident. Account actions (password, address,
 * deletion, sessions, tokens) are REST services, not messages, and the token API does not route to
 * them; they can never be listed here.
 */
export const TOKEN_MESSAGES: ReadonlyMap<MessageConstructor, TokenNeed> = new Map<
  MessageConstructor,
  TokenNeed
>([
  [NoteListQuery, TokenNeed.READ],
  [NoteGetQuery, TokenNeed.READ],
  [NoteCreateCommand, TokenNeed.WRITE],
])

/**
 * Throws `TOKEN_SCOPE` unless `token` may send `message`: the message is in `allowed`, names the
 * token's group, and needs no write from a read-only token. The owner's role in the group is still
 * checked by the handler, so a token never does more than its owner could.
 */
export function assertTokenMayDispatch(
  message: { constructor: unknown; data: unknown },
  token: ActorToken,
  allowed: ReadonlyMap<MessageConstructor, TokenNeed>,
): void {
  const need = allowed.get(message.constructor as MessageConstructor)
  if (need === undefined) {
    throw new ApiTokenError("TOKEN_SCOPE", "An API token cannot do this")
  }
  if (groupIdOf(message.data) !== token.groupId) {
    throw new ApiTokenError("TOKEN_SCOPE", "This token belongs to another group")
  }
  if (need === TokenNeed.WRITE && !token.canWrite) {
    throw new ApiTokenError("TOKEN_SCOPE", "This token can only read")
  }
}

function groupIdOf(data: unknown): unknown {
  return typeof data === "object" && data !== null && "groupId" in data
    ? (data as { groupId: unknown }).groupId
    : undefined
}
