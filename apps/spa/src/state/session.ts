import { signal } from "@preact/signals"
import type { User } from "@domain/identity"
export type SessionUser = User
/** What the API answers with (202) while the session still owes its one-time code. */
export type PendingSecondFactor = { secondFactor: "Pending" }

export type SessionState = {
  isReady: boolean
  user: SessionUser | null
  isMfaRequired: boolean
  wsStatus: "idle" | "connecting" | "open" | "closed"
  /**
   * How the page came back to the app while the socket was not open: "quiet" for the first
   * seconds, when a reconnect is expected and nothing should warn, "slow" once it took longer.
   * "none" at every other time. Read through `connectionDisplay`.
   */
  wsResume: "none" | "quiet" | "slow"
}

export const sessionState = signal<SessionState>({
  isReady: false,
  user: null,
  isMfaRequired: false,
  wsStatus: "idle",
  wsResume: "none",
})

/**
 * Whether the person ended the last session themselves: a sign-out (also one still owed to the
 * server) or an account deletion. The app then deletes everything it kept on the device, the queue
 * of unsent writes included; a session the server ended (it expired, or was ended elsewhere) keeps
 * that person's queue for their next sign-in (#612). Cleared when someone signs in.
 */
export const signOutChosen = signal(false)

/**
 * Whether the public frame offers "Sign out": a session that owes its one-time code has no user
 * yet, but it still holds a cookie the person must be able to end.
 */
export function canSignOut(state: Pick<SessionState, "user" | "isMfaRequired">): boolean {
  return state.user !== null || state.isMfaRequired
}
