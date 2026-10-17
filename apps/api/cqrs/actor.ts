import type { Actor } from "@domain/identity"
import type { AppAuthState } from "@api/services/sign-in.ts"

/**
 * The {@link Actor} for a signed-in request: who the user is and how strong the session is.
 * Routes put it on every command and query they dispatch; the session gate reads it.
 */
export function actorFromAuth(auth: AppAuthState): Actor {
  return {
    userId: auth.user.id,
    userMfa: auth.user.mfa,
    sessionSecondFactor: auth.session.secondFactor,
    sessionId: auth.session.id,
  }
}
