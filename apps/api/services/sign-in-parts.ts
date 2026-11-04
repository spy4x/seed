/**
 * The parts `createSignIn` (`sign-in.ts`) builds once and hands every flow file beside it, such as
 * `sign-up.ts` and `totp.ts`: the database, the hasher, the session cookie and managers, and the
 * checks more than one flow runs.
 *
 * @module
 */

import type { Context } from "hono"
import type {
  PasswordHasher,
  SecondFactorStatus,
  SessionCookie,
  SessionDevice,
  SessionManager,
  SessionStore,
} from "@spy4x/server/sign-in"
import type { AuthSessionRecord } from "@spy4x/server/auth"
import type { PasswordSignIn, PasswordSignInOptions } from "@spy4x/server/auth/password"
import type { AuthAuditBase, AuthAuditEventType, User } from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import type { GuestOperations } from "./guest-sign-in.ts"
import type { OAuthOperations } from "./oauth-sign-in.ts"
import type { AppAuthState, SignInOptions } from "./sign-in.ts"

/** What `createSignIn` hands each flow file of its own parts. */
export interface SignInParts {
  db: AppDbBase
  options: SignInOptions
  hasher: PasswordHasher
  cookie: SessionCookie
  /** The session manager over the pool's store. */
  sessions: SessionManager<AuthSessionRecord>
  /** A session manager over `store`, such as a transaction's. */
  sessionsOver(
    store: SessionStore<AuthSessionRecord>,
    minutes?: number,
  ): SessionManager<AuthSessionRecord>
  /** Signs out every session of `userId` but `keep`, with their push subscriptions, inside `tx`. */
  signOutOthers(tx: AppDbBase, userId: number, keep: number): Promise<void>
  /** Runs one password check of `userId` under the account's count: see `countPasswordCheck`. */
  countedPasswordCheck<Right extends boolean | null>(
    userId: number,
    verify: () => Promise<Right>,
  ): Promise<Right>
  /** The user a session belongs to, or `null` when the user is gone or may not sign in. */
  loadUser(userId: number): Promise<User | null>
  hasSecondFactor(user: User): boolean
  /** Records that a session was used, without making the caller wait. */
  touchSession(sessionId: number, userId: number): void
  /** What `secondFactorFor` answers for the auth user's `users` row. */
  secondFactorFrom(
    decide: (user: User | null) => SecondFactorStatus,
  ): (authUser: { id: number }) => Promise<SecondFactorStatus>
  /** The package's password provider, by address, with the sign-in's hasher. */
  passwordsOver(
    options: Pick<PasswordSignInOptions, "store" | "sessions"> & Partial<PasswordSignInOptions>,
  ): PasswordSignIn
  /** The second factor a sign-in owes; throws for an auth user with no profile row. */
  signInSecondFactor(authUser: { id: number }): Promise<SecondFactorStatus>
  /** The profile of `userId` while it waits to be deleted with two-factor on, else `null`. */
  waitingForCode(userId: number): Promise<User | null>
  /** Restores the account of `userId` inside `tx`; `true` when it is live afterwards. */
  restoreInTx(tx: AppDbBase, c: Context | undefined, userId: number): Promise<boolean>
  /** Restores the account of `userId` if it waits to be deleted; `true` when sign-in may go on. */
  restoreIfWaiting(c: Context, userId: number): Promise<boolean>
  guests: GuestOperations
  oauth: OAuthOperations
  /** The profile, first group, starter data and `SIGNED_UP` audit row of a new auth user. */
  createProfile(
    c: Context,
    tx: AppDbBase,
    authUserId: number,
    email: string | null,
    firstGroupId: string,
  ): Promise<User>
  /** Sets the cookie of a new session and ends the one the browser held before, if any. */
  replaceSession(
    c: Context,
    previous: AppAuthState | null | undefined,
    started: { session: AuthSessionRecord; cookieValue: string },
  ): Promise<void>
  /** The `auth_audits` row of an action by `userId` in this request. */
  auditRow(
    c: Context,
    userId: number,
    eventType: AuthAuditEventType,
    identifier?: string | null,
  ): AuthAuditBase
  /** The device a request comes from, as a new session records it. */
  deviceOf(c: Context): SessionDevice
  /** Ends the person's Telegram link inside `tx`, with its audit row naming `reason`. */
  unlinkTelegramOf(
    tx: AppDbBase,
    c: Context | undefined,
    userId: number,
    reason: string,
  ): Promise<void>
  /** Whether `error` is the refusal `signInSecondFactor` throws for a missing profile. */
  isMissingProfile(error: unknown): boolean
}
