import type { CqrsMiddleware } from "@spy4x/platform/cqrs"
import { secondFactorSatisfied } from "@spy4x/server/sign-in"
import { AccessError, type Actor, UserMFAStatus } from "@domain/identity"
import { assertTokenMayDispatch, TOKEN_MESSAGES, type TokenNeed } from "./token-scope.ts"

// deno-lint-ignore no-explicit-any
type MessageConstructor = new (...args: any[]) => { data: unknown }

/**
 * Throws `MFA_REQUIRED` unless the actor's session is strong enough for user-facing work.
 *
 * The rule is the one `@spy4x/server/sign-in` applies in `isAuthenticated2FA`, so a route guarded
 * by that middleware and a message guarded by the session gate give the same answer: a session
 * that completed the second factor passes; a session created without one passes only while the
 * user has no second factor configured; anything else, including a status this code does not
 * know, is refused.
 */
export function assertSecondFactorSatisfied(actor: Actor): void {
  if (
    secondFactorSatisfied(actor.sessionSecondFactor, actor.userMfa === UserMFAStatus.CONFIGURED)
  ) {
    return
  }
  throw new AccessError("MFA_REQUIRED", "Second factor has not been completed for this session")
}

function actorOf(data: unknown): Actor | null {
  if (typeof data !== "object" || data === null || !("actor" in data)) return null
  const actor = (data as { actor: unknown }).actor
  return typeof actor === "object" && actor !== null ? actor as Actor : null
}

/**
 * Guards every dispatch unless the message is explicitly exempted.
 *
 * The default is deny, because the two mistakes are not equal. Forgetting to exempt a genuinely
 * anonymous message fails loudly the first time it runs. Forgetting to guard a user-facing one
 * fails silently, in production, as a missing authorization check.
 *
 * Exemptions are listed in one place, the app's `sessionGate` below, so the whole authorization
 * posture can be read in one screen and reviewed as a diff when it changes.
 *
 * Exempted messages are anonymous by construction: sign-in before a session exists, or a worker
 * draining the outbox. A guarded message that arrives without an actor is a wiring bug, not an
 * anonymous request, so it is rejected rather than waved through.
 *
 * An actor built from a personal API token (`actor.token`) passes only for the messages in
 * `tokenMessages`, in the token's group, and only for reads when the token is read-only
 * (`./token-scope.ts`).
 */
export function createSessionGate(
  anonymous: Iterable<MessageConstructor> = [],
  tokenMessages: ReadonlyMap<MessageConstructor, TokenNeed> = TOKEN_MESSAGES,
): CqrsMiddleware {
  const exempt = new Set<unknown>(anonymous)
  return (message, next) => {
    if (exempt.has(message.constructor)) {
      return next()
    }
    const actor = actorOf(message.data)
    if (!actor) {
      throw new AccessError(
        "AUTH_REQUIRED",
        `${message.constructor.name} carries no actor and is not registered as anonymous`,
      )
    }
    assertSecondFactorSatisfied(actor)
    if (actor.token) assertTokenMayDispatch(message, actor.token, tokenMessages)
    return next()
  }
}

/**
 * The app's gate, attached to both bus singletons where they are built (`services/commandBus.ts`
 * and `services/queryBus.ts`), so no dispatch can reach a handler without passing it.
 *
 * Deny by default: a message only skips the gate by being listed here, and the list is empty
 * because every message currently carries an actor. Anonymous flows - sign-in, sign-up, password
 * reset - are REST services rather than CQRS messages today; if they become messages, add them
 * here.
 */
export const sessionGate: CqrsMiddleware = createSessionGate([])
