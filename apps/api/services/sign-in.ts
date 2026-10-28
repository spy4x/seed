/**
 * The app's sign-in, wired onto `@spy4x/server/sign-in` and `@spy4x/server/auth`: sessions, the
 * session cookie, the guards, password hashing and authenticator-app codes all come from the
 * package; this file decides what the template adds on top of them.
 *
 * - **E-mail addresses, and the usernames of older accounts.** Sign-up takes an address: the
 *   package's `createPasswordSignIn` writes one `password` key whose subject and `email` are the
 *   address as `normalizeEmail` leaves it (trimmed, lower-cased), unproven. Accounts made before
 *   that signed up with a username: their key's subject is the normalised username and its `email`
 *   is null. Sign-in takes either: a login `normalizeEmail` accepts goes to the address provider,
 *   anything else to a username provider over the same keys, so an older account signs in as before.
 *   The address is attached to the key, not to `users`: nullable (older keys), unique through the
 *   key's `(method, subject)` constraint, and compared after normalisation.
 * - **Password reset by link.** `resetPassword` spends a code from `password-reset.ts`, proves the
 *   address (whoever holds the mailbox owns the account that signs in with it), sets the new
 *   password, signs out every session of the user, deletes every API token and removes every
 *   push subscription (#409). It signs nobody in: the person signs in again with the new
 *   password, and their second factor if they have one. When the address was not proven
 *   before, the second factor and every other sign-in method of the account go too (#404):
 *   whoever added them never proved they own the address. An account waiting to be deleted is
 *   restored by the reset (#388).
 * - **One sign-up transaction.** The auth user and key, the session, the `users` profile row (same
 *   id) and the first group are written in one `db.begin()`: the sign-up provider is built over
 *   that transaction's stores.
 * - **Authenticator app.** Secret and last accepted time step live in `user_totp`; `users.mfa`
 *   keeps its three states. An account whose address is not proven cannot turn one on: whoever
 *   squats someone else's address must not lock its owner out with a second factor (#140).
 * - **Proving the address (#140).** `verifyEmail` checks a code from
 *   `@spy4x/server/auth/email-code` and proves the address it was sent to. A reset link proves the
 *   address too; when it was unproven until then, the reset also removes any second factor, since
 *   whoever set it up never showed they own the mailbox. A new address waits in `email_changes`
 *   until its code proves it; only then does the password key move to it, so the account signs in
 *   with the old address until that moment. Then a Google or GitHub key that carried the old
 *   address loses it and keeps signing in (#403): the old address no longer opens the account
 *   through another provider identity that vouches for it.
 * - **Audit rows in the same transaction (#191).** Sign-up, sign-in and sign-out each write their
 *   `auth_audits` row inside the transaction that changes the session, so a failed row undoes the
 *   action. Sign-in checks the password with the package's `checkCredentials` first and creates
 *   the session itself, so the transaction holds no connection while a hash is verified.
 * - **Signed-in devices (#151).** Every new session records a device name parsed once from the user
 *   agent and the address with its last part hidden, in the transaction that creates it when there
 *   is one; requests and live sockets record when it was last used, at most every few minutes. A
 *   person lists their live sessions and ends any other one, or all others, which deletes their
 *   rows: every statement names the user, so another person's session is out of reach and looks
 *   missing. A password change ends every other session unless the person asks to keep them.
 * - **Deleting the account (#144).** `deleteAccount` soft-deletes the profile, writes the waiting
 *   request with its two jobs and signs out every session, in one transaction, after checking
 *   again under row locks that no group stops it (`@server/auth/account-deletion.ts`). A correct
 *   password during the wait restores the account before the sign-in goes on as usual, second
 *   factor included: the password alone cancels the deletion but still lets nobody in who lacks
 *   the second factor.
 * - **An account with no password (#384).** One made with Google or GitHub confirms a deletion, a
 *   first password and a new address with a provider sign-in a moment ago (`oauth.proofUntil`)
 *   where the others give the password. Its first password is a new `password` key on the
 *   address the account already has, proven. Its new address has no password key to move to, so
 *   the key the code proved (`email-code`, which nobody signs in with here) holds it, and
 *   `readEmailStatus` reads it before the provider's own address.
 *
 * Reads no environment and imports no singleton, so the integration tests construct it against
 * their own schema.
 *
 * @module
 */

import type { Context } from "hono"
import {
  type Auth,
  type AuthState,
  createAuth,
  createPasswordHasher,
  generateTotpSecret,
  type PasswordHasher,
  secondFactorSatisfied,
  SecondFactorStatus,
  SessionCookie,
  type SessionDevice,
  SessionManager,
  SessionStatus,
  type SessionStore,
  totpEnrolment,
  verifyTotp,
} from "@spy4x/server/sign-in"
import {
  AuthConflictError,
  type AuthKey,
  type AuthSessionRecord,
  normalizeEmail,
} from "@spy4x/server/auth"
import { EmailCodeError } from "@spy4x/server/auth/email-code"
import { ChallengeOutcome } from "@spy4x/server/auth"
import { createSignedPayloadCodec } from "@spy4x/platform/signed-payload"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { type } from "arktype"
import {
  createPasswordSignIn,
  PASSWORD_METHOD,
  type PasswordSignIn,
  PasswordSignInError,
  type PasswordSignInOptions,
} from "@spy4x/server/auth/password"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { ipHint } from "@spy4x/net/ip"
import { deviceName } from "@spy4x/net/user-agent"
import type { MiddlewareHandler } from "hono"
import { GroupError } from "@domain/groups"
import {
  type AccountDeletionBlocker,
  type AuthAuditBase,
  AuthAuditEventType,
  type EmailStatus,
  emailToVerify,
  SIGN_IN_LINK_METHOD,
  type SignedInDevice,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import { consumePasswordReset } from "@server/auth/password-reset.ts"
import {
  dropCodeKeys,
  passwordKeyOf,
  proveEmailCode,
  readEmailStatus,
  releaseAddress,
} from "@server/auth/email-verification.ts"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  accountUsing,
  attemptSignUpCode,
  type ExistingAccount,
  SIGN_UP_TTL_MINUTES,
  signUpExpiry,
  type SignUpRequest,
} from "@server/auth/sign-up-requests.ts"
import { createOAuthOperations, type OAuthOperations, type OAuthOptions } from "./oauth-sign-in.ts"
import {
  createPasskeyOperations,
  type PasskeyOperations,
  type PasskeyOptions,
} from "./passkey-sign-in.ts"
import { PasswordLockedError } from "./password-locked.ts"
import { createGuestOperations, type GuestOperations } from "./guest-sign-in.ts"
import { consumeSignInLink, type SignInLinkRequest } from "@server/auth/sign-in-links.ts"

/** Longest username, in characters (code points), after normalisation. */
export const USERNAME_MAX_LENGTH = 50

/** What `c.get("auth")` holds for a signed-in request. */
export type AppAuthState = AuthState<AuthSessionRecord, User>

/** A user who just signed up or signed in, and the session the cookie now carries. */
export interface SignedIn {
  user: User
  session: AuthSessionRecord
}

/** The answer of {@link SignIn.connectTotpStart}: an error, or the enrolment to show. */
export type TotpConnectStart =
  | { error: string; qrcode: null; secret: null }
  | { error: null; qrcode: string; secret: string }

/** Why connecting an authenticator app was refused before it started. */
export const TOTP_NEEDS_PROVEN_EMAIL = "Verify your e-mail address before you turn on two-factor"

/** What {@link SignIn.requestEmailChange} did. */
export enum EmailChangeOutcome {
  /** The new address waits for its code; mail it one. */
  Requested = 1,
  /** The address is the one the account already has: any waiting change is dropped. */
  Kept = 2,
  /** Not an address `normalizeEmail` accepts. */
  InvalidEmail = 3,
  /** The current password is wrong. Nothing changed. */
  WrongPassword = 4,
  /** The account has no password and its session is no recent provider sign-in. Nothing changed. */
  ProofRequired = 5,
  /**
   * The account has no password, and another of its sign-in methods carries the address already.
   * Such an account reads its address from those methods, so the change would change nothing.
   */
  AlreadyCarried = 6,
}

/** What {@link SignIn.setPassword} did. */
export enum PasswordSetOutcome {
  /** The account now signs in with its address and this password too. */
  Set = 1,
  /** The account has a password already: it is changed, not set. Nothing changed. */
  AlreadySet = 2,
  /** The session is no recent provider sign-in. Nothing changed. */
  ProofRequired = 3,
  /** The account has no address to sign in with beside the password. Nothing changed. */
  NoAddress = 4,
  /** The password cannot be stored, or another account signs in with this address. */
  Refused = 5,
}

/** What {@link SignIn.verifyEmail} did. */
export enum EmailVerifyOutcome {
  Verified = 1,
  /** Wrong, expired, used up or never sent: one answer for all, so a guesser learns nothing. */
  WrongCode = 2,
  /** The code was right, but another account owns the address. The change is dropped. */
  Taken = 3,
  /** The address is proven and no change waits: no code can prove anything. */
  NothingToVerify = 4,
}

/** Options for {@link createSignIn}. */
export interface SignInOptions {
  db: AppDbBase
  /** Pepper for password hashes and session tokens, at least 32 characters. */
  pepper: string
  /** Secret that signs the session cookie, at least 32 characters. */
  cookieSecret: string
  /** Adds `Secure` to the cookies. `false` only for local development over plain HTTP. */
  secureCookie: boolean
  /** Session lifetime in minutes. */
  sessionMinutes: number
  /** Service name shown in the authenticator app. */
  totpIssuer: string
  /** Hashes and verifies passwords. Defaults to `createPasswordHasher` with `pepper`. */
  hasher?: PasswordHasher
  /** Sign-in with Google and GitHub (`oauth-sign-in.ts`). Left out, every provider is off. */
  oauth?: OAuthOptions
  /** Sign-in with passkeys (`passkey-sign-in.ts`). Left out, passkeys are off. */
  passkeys?: PasskeyOptions
  /** Guest accounts (#224, `guest-sign-in.ts`): one click into the app. Left out, on. */
  guests?: boolean
}

/** What {@link SignIn.deleteAccount} did. */
export type AccountDeleteResult =
  /** The account waits to be deleted until `deleteAfter`; every session is signed out. */
  | { deleteAfter: Date; blockers?: undefined }
  /** These groups stop it; nothing changed. */
  | { deleteAfter?: undefined; blockers: AccountDeletionBlocker[] }

/** What {@link SignIn.completeSignUp} did with a code. */
export enum SignUpOutcome {
  /** The account is created, its address proven, and the person signed in. */
  Created = 1,
  /** An account already uses the address. Nothing was created, and the sign-up is gone. */
  AccountExists = 2,
  /** The code is wrong, or expired, or used up; the sign-up still waits. */
  WrongCode = 3,
  /** No sign-up waits: it took too long, the code was guessed at too often, or none was started. */
  Expired = 4,
  /** A guest's sign-up (#224): the address and password were added to the guest, now kept. */
  GuestKept = 5,
  /**
   * A guest's sign-up whose address belongs to an account with a password: nothing changed, and
   * the switch page offers to sign in to that account with its password.
   */
  GuestTaken = 6,
}

/** The answer of {@link SignIn.completeSignUp}. */
export type SignUpCompletion =
  | { outcome: SignUpOutcome.Created; signedIn: SignedIn }
  | { outcome: SignUpOutcome.AccountExists; email: string; account: ExistingAccount }
  | { outcome: SignUpOutcome.GuestKept; signedIn: SignedIn }
  | { outcome: SignUpOutcome.WrongCode | SignUpOutcome.Expired | SignUpOutcome.GuestTaken }

/** What {@link SignIn.redeemSignInLink} did with a link (#391). */
export enum SignInLinkOutcome {
  /** The link's address belongs to an account: it is signed in, its second factor still owed. */
  SignedIn = 1,
  /** No account used the address: a new one is made with it proven, and signed in. */
  Created = 2,
  /** A guest's link to a new address: the address became the guest's, now kept (#224). */
  GuestKept = 3,
  /**
   * A guest's link to an address another account owns: nothing changed, and the switch page asks
   * what happens to the guest's work.
   */
  GuestTaken = 4,
  /** Unknown, expired or used; or the account is blocked or gone. One answer for all. */
  Refused = 5,
  /**
   * An account signs in with the address by password but never proved it: the link proves the
   * mailbox, not that account, so nothing happens. A password reset proves it.
   */
  Unconfirmed = 6,
  /**
   * A guest opened a link another browser asked for: nothing changed, the guest's session stays,
   * and the link is spent. A guest key has no secret, so a session lost here loses the account.
   */
  AskedElsewhere = 7,
}

/** The answer of {@link SignIn.redeemSignInLink}. */
export type SignInLinkRedemption =
  | {
    outcome: SignInLinkOutcome.SignedIn | SignInLinkOutcome.Created | SignInLinkOutcome.GuestKept
    signedIn: SignedIn
    /** The address the link proved. */
    email: string
    /** The page to open next, as the request stored it. */
    next: string | null
  }
  | { outcome: SignInLinkOutcome.GuestTaken; next: string | null }
  | {
    outcome:
      | SignInLinkOutcome.Refused
      | SignInLinkOutcome.Unconfirmed
      | SignInLinkOutcome.AskedElsewhere
  }

/** A sign-up waiting for its code, as the page that asks for the code reads it back. */
export interface WaitingSignUp {
  email: string
  expiresAt: Date
}

/** The cookie that ties a browser to its waiting sign-up (#142). */
export const PASSWORD_SIGN_UP_COOKIE = "password_sign_up"

/** The only path the sign-up cookie is sent to: the routes of the waiting sign-up. */
const PASSWORD_SIGN_UP_COOKIE_PATH = "/api/auth/password/sign-up"

/** The sign-up cookie's payload: the waiting sign-up's id, signed with the cookie secret. */
const signUpCookieSchema = type({ id: "string > 0" })

/** The sign-in operations the routes call. */
export interface SignIn {
  /** Middleware and guards from `createAuth`. */
  auth: Auth<AuthSessionRecord, User>
  /**
   * Creates the auth user, password key, profile, first group, session and audit row in one
   * transaction and sets the cookie. `null` when the address is not one `normalizeEmail` accepts, or an account
   * already signs in with it.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a random UUID.
   */
  signUp(
    c: Context,
    email: string,
    password: string,
    firstGroupId?: string,
  ): Promise<SignedIn | null>
  /**
   * Starts a sign-up that proves its address first (#142): hashes the password, writes the
   * waiting sign-up, queues its code mail and sets the cookie that names it. The same work and
   * the same answer for every address: it never asks whether an account uses `email`, which must
   * be normalised already. `false` only for a password the hasher refuses.
   */
  requestSignUp(
    c: Context,
    email: string,
    password: string,
    guestUserId?: number | null,
    /** The asking page's language, for the code mail (#277). */
    language?: string | null,
  ): Promise<boolean>
  /** The sign-up the request's cookie names while it waits, or `null`. */
  waitingSignUp(c: Context): Promise<WaitingSignUp | null>
  /**
   * Queues a new code for the waiting sign-up and gives it a fresh lifetime. `false` when none
   * waits. The caller spends the address's code budget first.
   */
  resendSignUpCode(c: Context): Promise<boolean>
  /** Forgets the waiting sign-up, its password hash included, and clears the cookie. */
  cancelSignUp(c: Context): Promise<void>
  /**
   * Checks `code` for the waiting sign-up. The right one creates the account, as `signUp` does but
   * with its address proven, and signs it in; or, when an account already uses the address, it
   * creates nothing and says how that account signs in. Either way the waiting sign-up is gone.
   *
   * @param firstGroupId The id of the person's first group. Defaults to a random UUID.
   */
  completeSignUp(c: Context, code: string, firstGroupId?: string): Promise<SignUpCompletion>
  /**
   * Spends a sign-in link's token (#391) and signs in to the account that owns its address, or
   * makes one with the address proven. An account with an authenticator app still owes its code.
   * A guest who asked for the link keeps their account with the address, or is offered the switch
   * when another account owns it; any other guest is refused and keeps their session. A full
   * account's session the browser held before is replaced.
   *
   * @param firstGroupId The id of a new account's first group. Defaults to a random UUID.
   */
  redeemSignInLink(c: Context, token: string, firstGroupId?: string): Promise<SignInLinkRedemption>
  /**
   * Checks the password of the account that signs in with `login`, an address or an older
   * account's username, then starts a session, records the time and writes the audit row in one
   * transaction, and sets the cookie. `null` when refused.
   */
  signIn(c: Context, login: string, password: string): Promise<SignedIn | null>
  /**
   * Signs out the session in the request's cookie, if any, and clears the cookie. A signed-in
   * request also gets its audit row, in the same transaction.
   */
  signOut(c: Context): Promise<void>
  /**
   * Starts authenticator-app enrolment, or returns the unfinished one. The caller checks the
   * password, or the provider sign-in of an account without one, first (#406).
   */
  connectTotpStart(state: AppAuthState): Promise<TotpConnectStart>
  /** Finishes enrolment with a code; signs out every other session of the user. */
  connectTotpFinish(state: AppAuthState, code: string): Promise<boolean>
  /** Gives the second factor for this session. A code is never accepted twice. */
  checkTotp(c: Context, state: AppAuthState, code: string): Promise<boolean>
  /**
   * Removes a finished enrolment, and lets the user's other sessions that still owed the second
   * factor through without it.
   */
  disconnectTotp(state: AppAuthState): Promise<boolean>
  /**
   * Replaces the password. With `signOutOthers` (the default) it also signs out every other session
   * and gives this one a new session and cookie; without it every session stays as it is. Either
   * way it revokes every personal API token of the user, each with its audit row, in the same
   * transaction as the password, so a failed revoke leaves the old password in place, and answers
   * how many: a token is what a stolen session leaves behind, and a person who changes the
   * password after a break-in expects it gone (#293). `null` when the current password is wrong or
   * the new one is refused. The current password is counted as {@link checkPassword} counts it.
   */
  changePassword(
    c: Context,
    state: AppAuthState,
    password: string,
    newPassword: string,
    signOutOthers?: boolean,
  ): Promise<{ revokedTokens: number } | null>
  /**
   * Spends the reset code for `email` and, when it was the live one, proves the address, replaces
   * the password, signs out every session of the user and revokes every API token, with an audit
   * row each, and removes every push subscription of the user (#409). An account waiting to be
   * deleted is restored too: the link proved the mailbox, so the person is back (#388). `c`,
   * when given, names the request in the restore's audit row.
   * `false`, and the password unchanged, when the code is wrong, expired, already used or
   * replaced, the new password is refused, or no live account signs in with the address.
   */
  resetPassword(email: string, code: string, newPassword: string, c?: Context): Promise<boolean>
  /**
   * Whether `password` is the current password of user `userId`, checked as a password change
   * checks it. A step that must not run on a stolen session alone, such as handing a group to
   * someone else, asks for it. `false` for an account with no password.
   *
   * Counted per user (#406): a wrong password counts, a right one gives its count back, and while
   * the account is locked the password is not looked at and {@link PasswordLockedError} is thrown,
   * right password or not. An account with no password has nothing to guess and is not counted.
   */
  checkPassword(userId: number, password: string): Promise<boolean>
  /**
   * Runs `check`, which looks at a password of user `userId` and answers whether it was right,
   * under the count {@link checkPassword} keeps: while the account is locked `check` does not run
   * and {@link PasswordLockedError} is thrown; `false` counts as a wrong password; `true`, and
   * `null` for a check that looked at no password, give the count back. For a caller that checks
   * the password inside a transaction with {@link verifyPassword}: the count needs a connection of
   * its own, so it goes around the transaction, never inside it.
   */
  countPasswordCheck<Right extends boolean | null>(
    userId: number,
    check: () => Promise<Right>,
  ): Promise<Right>
  /**
   * Whether `password` is the current password of user `userId`, read through `over`, the
   * transaction of a caller that holds the user's row lock (a token create). Not counted: call it
   * only inside {@link countPasswordCheck}. `false` for an account with no password.
   */
  verifyPassword(userId: number, password: string, over: AppDbBase): Promise<boolean>
  /** Whether user `userId` has a password at all, read through `over` when given. */
  hasPassword(userId: number, over?: AppDbBase): Promise<boolean>
  /**
   * Whether the request's session confirms a step that an account with no password cannot give a
   * password for: a sign-in with Google or GitHub started it less than `PROVIDER_PROOF_MINUTES`
   * ago.
   */
  confirmedByProvider(state: AppAuthState): Promise<boolean>
  /**
   * Gives an account that has no password its first one, after a provider sign-in a moment ago
   * ({@link confirmedByProvider}): a new password key on the address the account has, proven, and
   * an audit row, in one transaction. Every other session of the user ends, as a password change
   * ends them; this one keeps its cookie (#406).
   */
  setPassword(c: Context, state: AppAuthState, newPassword: string): Promise<PasswordSetOutcome>
  /**
   * Whether `code` is the user's current authenticator code, spending it so it never works twice.
   * Leaves the session as it is: for a step that asks for the code again, such as deleting the
   * account. `false` without a confirmed enrolment.
   */
  verifyTotpCode(state: AppAuthState, code: string): Promise<boolean>
  /** The groups that stop the user from deleting their account now. */
  accountDeletionBlockers(state: AppAuthState): Promise<AccountDeletionBlocker[]>
  /**
   * Starts the deletion of the user's account, in one transaction under row locks: checks the
   * blockers again, soft-deletes the profile, writes the request and its jobs, signs out every
   * session and writes the audit row. Then clears the cookie. The caller checks the password and
   * the second factor first, and announces the sign-out.
   */
  deleteAccount(c: Context, state: AppAuthState): Promise<AccountDeleteResult>
  /** Where the user's address stands. */
  emailStatus(state: AppAuthState): Promise<EmailStatus>
  /**
   * Checks the current password, then records `email` as the address to move to once a code sent
   * there proves it. The account keeps signing in with its old address until then. The password
   * is asked so that a stolen session cannot point the account, and its reset links, elsewhere.
   * An account with no password is asked for a provider sign-in a moment ago instead
   * ({@link confirmedByProvider}). The password is counted as {@link checkPassword} counts it.
   */
  requestEmailChange(
    state: AppAuthState,
    password: string | undefined,
    email: string,
  ): Promise<EmailChangeOutcome>
  /**
   * Checks a code for the address that needs one (`emailToVerify`) and proves it. For a waiting
   * change, the password key then moves to the new address and a new session on it gets the
   * cookie; an account with no password has the key the code proved hold the new address, and an
   * address held that way before goes. Either way every other session of the user ends (#406). A
   * wrong code is counted in the same transaction and changes nothing else.
   */
  verifyEmail(c: Context, state: AppAuthState, code: string): Promise<EmailVerifyOutcome>
  /** Marks every active session that has run out as expired. */
  expireSessions(): Promise<void>
  /** The user's live sessions, this one first, then the rest by when they were last used. */
  listSessions(state: AppAuthState): Promise<SignedInDevice[]>
  /**
   * Ends session `sessionId` of the user by deleting it, with an audit row, in one transaction.
   * `false` when the user has no such session, the answer for another person's session too, and
   * for the request's own session, which signs out instead.
   */
  endSession(c: Context, state: AppAuthState, sessionId: number): Promise<boolean>
  /** Ends every session of the user but this one, with an audit row. Returns how many ended. */
  endOtherSessions(c: Context, state: AppAuthState): Promise<number>
  /**
   * The session and its user as they are now, or `null` when the session may no longer act: it was
   * signed out or expired, its user is gone, or it still owes a second factor. The rules are the
   * ones `parseAuth` and `isAuthenticated2FA` apply to a request, read from the database instead
   * of a cookie, so a socket that authenticated once can be checked again without the cookie.
   */
  entitledSession(sessionId: number): Promise<AppAuthState | null>
  /** Sign-in with Google and GitHub, and the account's sign-in methods (`oauth-sign-in.ts`). */
  oauth: OAuthOperations
  /** Adding passkeys and signing in with them (`passkey-sign-in.ts`). */
  passkeys: PasskeyOperations
  /** Guest accounts: one click into the app, kept later with a sign-in method (#224). */
  guests: GuestOperations
}

/**
 * Lower-cases and trims a username, as the template always did. `null` when it is not a string, or
 * the result is empty, longer than {@link USERNAME_MAX_LENGTH}, or holds text Postgres cannot store
 * as given (NUL, a lone surrogate). Never throws: the package's `normalizeSubject` must not.
 */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const username = raw.trim().toLowerCase()
  const length = Array.from(username).length
  if (length < 1 || length > USERNAME_MAX_LENGTH) return null
  if (hasUnstorableTextCharacters(username)) return null
  return username
}

/**
 * The `auth_audits` row of an action by `userId` in this request. The address is read as the API
 * always read it, trusting `X-Forwarded-For` and `X-Real-IP` from the proxy in front of it.
 */
export function auditRow(
  c: Context,
  userId: number,
  eventType: AuthAuditEventType,
  identifier: string | null = null,
): AuthAuditBase {
  const request = requestInfoFromContext(c, { trustedProxy: true })
  return {
    userId,
    eventType,
    identifier,
    ip: request.ip || null,
    userAgent: request.userAgent || null,
  }
}

/**
 * Ends the person's Telegram link (#269), with its audit row naming why and which Telegram
 * account: `password-reset telegram:<id>`, and every link code and "Link" press made before, so
 * one prepared with a stolen session cannot link after the recovery.
 */
async function unlinkTelegramOf(
  tx: AppDbBase,
  c: Context | undefined,
  userId: number,
  reason: string,
): Promise<void> {
  await tx.telegram.dropPending(userId)
  const telegramUserId = await tx.telegram.unlink(userId)
  if (telegramUserId === null) return
  const eventType = AuthAuditEventType.TELEGRAM_UNLINKED
  const identifier = `${reason} telegram:${telegramUserId}`
  await tx.authAudit.insert(
    c ? auditRow(c, userId, eventType, identifier) : {
      userId,
      eventType,
      identifier,
      ip: null,
      userAgent: null,
    },
  )
}

/** The device a request comes from, as a new session records it. */
function deviceOf(c: Context): SessionDevice {
  // Only `X-Real-IP`: Traefik rewrites it, but passes a client's `CF-Connecting-IP` through, so
  // trusting every header would let a client choose the address shown for its session.
  const request = requestInfoFromContext(c, { trustedProxy: "x-real-ip" })
  return { deviceName: deviceName(request.userAgent), ipHint: ipHint(request.ip) }
}

/** Builds the app's sign-in over the package building blocks. */
export function createSignIn(options: SignInOptions): SignIn {
  const { db } = options
  const sessionsOver = (store: SessionStore<AuthSessionRecord>, minutes = options.sessionMinutes) =>
    new SessionManager<AuthSessionRecord>({
      store,
      pepper: options.pepper,
      durationMinutes: minutes,
    })
  const sessions = sessionsOver(db.sessionStore)
  const cookie = new SessionCookie({ secret: options.cookieSecret, secure: options.secureCookie })
  const hasher = options.hasher ?? createPasswordHasher({ pepper: options.pepper })

  /**
   * Runs `verify`, one password check of user `userId`, under the account's count (#406): see
   * {@link SignIn.countPasswordCheck}. The count runs on the pool, never inside a transaction:
   * it needs a connection of its own.
   */
  async function countedPasswordCheck<Right extends boolean | null>(
    userId: number,
    verify: () => Promise<Right>,
  ): Promise<Right> {
    const passwordChecks = db.passwordCheckFailures
    const waitMs = await passwordChecks.begin(userId)
    if (waitMs > 0) throw new PasswordLockedError(waitMs)
    const right = await verify()
    if (right === false) await passwordChecks.fail(userId)
    else await passwordChecks.refund(userId)
    return right
  }

  /**
   * The user a session belongs to, or `null` when the user is gone or may not sign in. A blocked
   * user (#146) gets `null` here, so every request and every socket of a session they still hold
   * is refused, whatever ended or did not end it.
   */
  async function loadUser(userId: number): Promise<User | null> {
    const user = await db.user.findOne({ id: userId })
    // An account waiting to be deleted with two-factor on is restored only by its code, so its
    // session owes that code and reaches nothing else (`hasSecondFactor` is true for it).
    if (!user) {
      const waiting = await waitingForCode(userId)
      return waiting?.blockedAt ? null : waiting
    }
    if (user.blockedAt) return null
    try {
      await db.group.ensureFirst({ id: uuidV7(), name: "Personal" }, user.id)
    } catch (error) {
      if (error instanceof GroupError && error.code === "USER_NOT_ACTIVE") return null
      throw error
    }
    return user
  }
  const hasSecondFactor = (user: User) => user.mfa === UserMFAStatus.CONFIGURED

  const packageAuth = createAuth<AuthSessionRecord, User>({
    sessions,
    cookie,
    loadUser,
    hasSecondFactor,
  })

  /**
   * Records that a session was used, for the devices list, without making the caller wait. A
   * failed write is logged and the request goes on: the time it shows is a convenience, never a
   * reason to refuse or slow anyone.
   */
  function touchSession(sessionId: number, userId: number): void {
    sessions.touch(userId, sessionId).catch((error) => {
      console.error("error: cannot record when a session was last used", error)
    })
    // The person's own "last seen" (#152): the same activity, throttled per person in the query.
    db.userSeen.touch(userId).catch((error) => {
      console.error("error: cannot record when a user was last seen", error)
    })
  }

  // The package's middleware, then the time of use of a valid session.
  const parseAuth: MiddlewareHandler<{ Variables: { auth: AppAuthState | null } }> = async (
    c,
    next,
  ) =>
    await packageAuth.parseAuth(c, async () => {
      const state = c.get("auth")
      if (state) {
        touchSession(state.session.id, state.session.userId)
        // A guest's session is the only way back in, so a day of use renews it to a year (#224).
        if (state.user.guestSince) {
          await guests.renew(c, state).catch((error) => {
            console.error("error: cannot renew a guest's session", error)
          })
        }
      }
      await next()
    })
  const auth: Auth<AuthSessionRecord, User> = { ...packageAuth, parseAuth }

  /** What `secondFactorFor` answers for the auth user's `users` row, or `null` without one. */
  const secondFactorFrom =
    (decide: (user: User | null) => SecondFactorStatus) =>
    async (authUser: { id: number }): Promise<SecondFactorStatus> =>
      decide(await db.user.findOne({ id: authUser.id }) ?? null)

  /**
   * The package's password provider, by address. Each instance makes one dummy hash with its
   * hasher when it is created, for the equal work of a sign-in to a missing account.
   */
  const passwordsOver = (
    options: Pick<PasswordSignInOptions, "store" | "sessions"> & Partial<PasswordSignInOptions>,
  ): PasswordSignIn => createPasswordSignIn({ hasher, ...options })

  // Sign-in: a user with an authenticator app owes it. A user without a profile row gets no
  // session at all, as before: the throw comes before the session is created.
  const signInSecondFactor = secondFactorFrom((user) => {
    if (!user) throw new MissingProfileError()
    return user.mfa === UserMFAStatus.CONFIGURED
      ? SecondFactorStatus.Pending
      : SecondFactorStatus.NotRequired
  })
  /**
   * The profile of `userId` while it waits to be deleted with two-factor on, else `null`. A sign-in
   * to it gets a session that owes the code, and only the code restores the account: the password
   * alone must not undo a deletion the person asked for.
   */
  async function waitingForCode(userId: number): Promise<User | null> {
    const profile = await db.user.findOne({ id: userId, includeDeleted: true })
    if (!profile || profile.deletedAt === null) return null
    if (profile.mfa !== UserMFAStatus.CONFIGURED) return null
    return (await db.accountDeletion.waiting(userId)) ? profile : null
  }

  /**
   * Restores the account of `userId` inside `tx`: the request goes, the profile comes back, the
   * audit row is written and the mail that says so is queued. `true` when the account is live
   * afterwards: just restored, or restored by a sign-in running alongside. `false` for a profile
   * deleted with no request waiting: one disabled some other way, or deleted for good meanwhile.
   * The audit row names the request's address and browser when `c` is given, and none otherwise.
   */
  async function restoreInTx(
    tx: AppDbBase,
    c: Context | undefined,
    userId: number,
  ): Promise<boolean> {
    if (!(await tx.accountDeletion.cancel(userId))) {
      return (await tx.user.findOne({ id: userId })) !== null
    }
    await tx.user.undeleteOne({ id: userId })
    const eventType = AuthAuditEventType.ACCOUNT_RESTORED
    await tx.authAudit.insert(
      c
        ? auditRow(c, userId, eventType)
        : { userId, eventType, identifier: null, ip: null, userAgent: null },
    )
    await tx.accountDeletion.restored(userId)
    return true
  }

  /**
   * Restores the account of `userId` when it waits to be deleted, before a password sign-in goes
   * on. `true` when the sign-in may go on (see {@link restoreInTx}); a live profile needs nothing.
   */
  async function restoreIfWaiting(c: Context, userId: number): Promise<boolean> {
    const profile = await db.user.findOne({ id: userId, includeDeleted: true })
    if (!profile || profile.deletedAt === null) return true
    return await db.begin((tx) => restoreInTx(tx, c, userId))
  }

  // Sign-in only checks the password through these; it creates the session itself (`signIn`).
  const signInOptions = { store: db.authStore, sessions }
  const signInByAddress = passwordsOver(signInOptions)
  // Older accounts sign in with their username. Both providers read the same `password` keys.
  const signInByUsername = passwordsOver({
    ...signInOptions,
    normalizeSubject: normalizeUsername,
  })
  // Password change: the session that changed it already gave the second factor. Built over the
  // change's transaction, so the new password and the new session join it.
  const changePasswordsOver = (tx: AppDbBase) =>
    passwordsOver({
      store: tx.authStore,
      sessions: sessionsOver(tx.sessionStore),
      secondFactorFor: secondFactorFrom((user) =>
        user?.mfa === UserMFAStatus.CONFIGURED
          ? SecondFactorStatus.Completed
          : SecondFactorStatus.NotRequired
      ),
    })

  // The guest operations call the password and code checks the returned object defines; they run
  // only on requests, long after `api` below is assigned.
  const guests = createGuestOperations({
    db,
    enabled: options.guests ?? true,
    sessionsOver,
    sessionMinutes: options.sessionMinutes,
    cookie,
    auditRow,
    deviceOf,
    checkPassword: (userId, password) => api.checkPassword(userId, password),
    verifyTotpCode: (state, code) => api.verifyTotpCode(state as AppAuthState, code),
  })

  const oauth = createOAuthOperations(options.oauth, {
    guests,
    db,
    sessionsOver,
    cookie,
    cookieSecret: options.cookieSecret,
    secureCookie: options.secureCookie,
    auditRow,
    deviceOf,
    // As a password sign-in: an account that waits to be deleted is restored, unless only its
    // authenticator code may do that, and then the session owes the code.
    secondFactorFor: (c) => async (authUser) => {
      // A blocked user is refused before anything is restored or a session is made (#146).
      if (await db.admin.isBlocked(authUser.id)) throw new MissingProfileError()
      if (await waitingForCode(authUser.id)) return SecondFactorStatus.Pending
      if (!(await restoreIfWaiting(c, authUser.id))) throw new MissingProfileError()
      return await signInSecondFactor(authUser)
    },
    secondFactorAtSignUp: secondFactorFrom((user) =>
      user?.mfa === UserMFAStatus.CONFIGURED
        ? SecondFactorStatus.Pending
        : SecondFactorStatus.NotRequired
    ),
    waitingForCode,
    isRefusal: (error) => error instanceof MissingProfileError,
  })

  const passkeys = createPasskeyOperations(options.passkeys, {
    guests,
    db,
    sessionsOver,
    cookie,
    auditRow,
    deviceOf,
    // A passkey proves the person and the device at once: the library asks the device to verify
    // the person on every ceremony, so it counts as both factors and owes no authenticator code.
    // An account with an authenticator app gets `Completed`, which the 2FA gate accepts, as after
    // a code. The exception is an account that waits to be deleted with two-factor on: only the
    // code restores it, as after a password.
    admit: async (c, userId) => {
      if (await db.admin.isBlocked(userId)) return null
      if (await waitingForCode(userId)) return SecondFactorStatus.Pending
      const user = await db.user.findOne({ id: userId, includeDeleted: true })
      if (!user) return null
      if (!(await restoreIfWaiting(c, userId))) return null
      return hasSecondFactor(user) ? SecondFactorStatus.Completed : SecondFactorStatus.NotRequired
    },
    waitingForCode,
  })

  /**
   * The profile, first group, starter data and `SIGNED_UP` audit row of a new auth user, written
   * in the sign-up's transaction `tx`.
   */
  async function createProfile(
    c: Context,
    tx: AppDbBase,
    authUserId: number,
    email: string | null,
    firstGroupId: string,
  ): Promise<User> {
    const user = await tx.user.createForAuthUser(authUserId, {
      firstName: "",
      lastName: "",
      mfa: UserMFAStatus.NOT_CONFIGURED,
      role: UserRole.VIEWER,
      lastLoginAt: new Date(),
    })
    await tx.group.createFirst({ id: firstGroupId, name: "Personal" }, user.id)
    // The worker makes the welcome note, so a slow job never holds up the sign-up.
    await tx.starterData.queue(user.id)
    await tx.authAudit.insert(auditRow(c, user.id, AuthAuditEventType.SIGNED_UP, email))
    return user
  }

  /**
   * The right code of a guest's sign-up (#224): the address and password become the guest's first
   * sign-in method, so the account is kept with the same user id and everything in it. The
   * browser must still carry that guest's session. When an account already uses the address and
   * has a password, nothing changes and the switch page asks for that password; one without a
   * password is answered as a sign-up is, with how it signs in.
   */
  async function keepGuestByAddress(
    c: Context,
    request: SignUpRequest,
    now: Date,
  ): Promise<SignUpCompletion> {
    const state = c.get("auth") as AppAuthState | null | undefined
    const guestId = request.guestUserId!
    if (!state || state.user.id !== guestId || !state.user.guestSince) {
      await endSignUp(c, request.id)
      return { outcome: SignUpOutcome.Expired }
    }
    const account = await accountUsing(db.authStore, request.email)
    if (account !== null) {
      await endSignUp(c, request.id)
      const key = account.password
        ? await db.authStore.findKey(PASSWORD_METHOD, request.email)
        : null
      if (key && key.userId !== guestId) {
        await guests.taken(guestId, key, true)
        return { outcome: SignUpOutcome.GuestTaken }
      }
      return { outcome: SignUpOutcome.AccountExists, email: request.email, account }
    }
    try {
      const kept = await db.begin(async (tx) => {
        await tx.lockUser(guestId)
        const key = await tx.authStore.addKey(guestId, {
          method: PASSWORD_METHOD,
          subject: request.email,
          email: request.email,
          secret: request.secret,
          provenAt: now,
        })
        if (!(await guests.keep(c, tx, guestId, key.id, PASSWORD_METHOD))) return null
        await tx.signUpRequest.remove(request.id)
        return await tx.user.findOne({ id: guestId })
      })
      deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
      if (!kept) return { outcome: SignUpOutcome.Expired }
      return {
        outcome: SignUpOutcome.GuestKept,
        signedIn: { user: kept, session: state.session },
      }
    } catch (error) {
      // Another account took the address between the check and the write.
      if (error instanceof AuthConflictError) {
        await endSignUp(c, request.id)
        return { outcome: SignUpOutcome.Expired }
      }
      throw error
    }
  }

  const signUpCookie = createSignedPayloadCodec({
    secret: options.cookieSecret,
    purpose: "app.password-sign-up",
    version: 1,
    schema: signUpCookieSchema,
  })
  const signUpCookieOptions = {
    httpOnly: true,
    secure: options.secureCookie,
    sameSite: "Lax",
    path: PASSWORD_SIGN_UP_COOKIE_PATH,
  } as const

  /** Names the waiting sign-up `id` in the browser's cookie for as long as the sign-up works. */
  async function setSignUpCookie(c: Context, id: string): Promise<void> {
    setCookie(c, PASSWORD_SIGN_UP_COOKIE, await signUpCookie.sign({ id }), {
      ...signUpCookieOptions,
      maxAge: SIGN_UP_TTL_MINUTES * 60,
    })
  }

  /**
   * The id in the request's sign-up cookie, or `null`. A cookie this API did not sign, or one
   * changed since, is no cookie.
   */
  async function signUpIdOf(c: Context): Promise<string | null> {
    const raw = getCookie(c, PASSWORD_SIGN_UP_COOKIE)
    const read = raw ? await signUpCookie.verify(raw) : null
    return read?.ok ? read.value.id : null
  }

  /** Forgets the waiting sign-up `id` and the cookie that names it. */
  async function endSignUp(c: Context, id: string): Promise<void> {
    await db.signUpRequest.remove(id)
    deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
  }

  /**
   * The key a sign-in link signs user `userId` in through (#391), added the first time. It holds
   * no secret and no address: the link proved the mailbox, and the account's own keys hold its
   * address. Its sessions show as e-mail-link sessions, and a link sign-up's key carries the new
   * address itself (see {@link signInByLink}).
   */
  async function linkKeyOf(tx: AppDbBase, userId: number): Promise<AuthKey> {
    const keys = await tx.authStore.listKeys(userId)
    return keys.find((key) => key.method === SIGN_IN_LINK_METHOD) ??
      await tx.authStore.addKey(userId, {
        method: SIGN_IN_LINK_METHOD,
        subject: uuidV7(),
        email: null,
        secret: null,
        provenAt: null,
      })
  }

  /** Sets the cookie of a new session and ends the one the browser held before, if any. */
  async function replaceSession(
    c: Context,
    previous: AppAuthState | null | undefined,
    started: { session: AuthSessionRecord; cookieValue: string },
  ): Promise<void> {
    await cookie.set(c, started.session, started.cookieValue)
    if (previous) await sessions.deleteForUser(previous.user.id, previous.session.id)
  }

  /**
   * What a spent link does (#391), for the link's normalised address `email`:
   *
   * - **A guest who did not ask for the link** is refused, and nothing changes: replacing the
   *   guest's session would lose the guest account for good, since a guest key has no secret.
   * - **An owner of the proven address** is signed in, as a password would sign them in: a blocked
   *   account is refused, one waiting to be deleted is restored (or owes its code first), and an
   *   authenticator app is still owed. A guest is offered the switch to that account instead.
   * - **A password key that claims the address without having proven it** is left alone: the link
   *   proves the mailbox, not that account, whose password may be someone else's.
   * - **Nobody** has the address: a new account is made with a link key that carries it, proven;
   *   a guest keeps theirs with that key instead (#224).
   *
   * When someone proves the address between the read and the write, the write fails and this runs
   * once more, then finds that owner.
   */
  async function signInByLink(
    c: Context,
    link: SignInLinkRequest,
    now: Date,
    firstGroupId: string,
    retried = false,
  ): Promise<SignInLinkRedemption> {
    const { email, next } = link
    const state = c.get("auth") as AppAuthState | null | undefined
    // A guest uses only a link the guest asked for. Attaching the address of someone else's link
    // would let that person, signing in with it later, own the guest's data; signing the browser
    // in instead would end the guest's only session and lose the account.
    if (state?.user.guestSince && link.requestedBy !== state.user.id) {
      return { outcome: SignInLinkOutcome.AskedElsewhere }
    }
    const guest = state?.user.guestSince ? state : null
    const owner = await db.authStore.findUserIdByProvenEmail(email)
    if (owner === null) {
      if (await db.authStore.findKey(PASSWORD_METHOD, email)) {
        return { outcome: SignInLinkOutcome.Unconfirmed }
      }
      const linkKey = {
        method: SIGN_IN_LINK_METHOD,
        subject: uuidV7(),
        email,
        secret: null,
        provenAt: now,
      }
      try {
        if (guest) {
          const kept = await db.begin(async (tx) => {
            await tx.lockUser(guest.user.id)
            const key = await tx.authStore.addKey(guest.user.id, linkKey)
            if (!(await guests.keep(c, tx, guest.user.id, key.id, SIGN_IN_LINK_METHOD))) return null
            return await tx.user.findOne({ id: guest.user.id })
          })
          if (!kept) return { outcome: SignInLinkOutcome.Refused }
          return {
            outcome: SignInLinkOutcome.GuestKept,
            signedIn: { user: kept, session: guest.session },
            email,
            next,
          }
        }
        const created = await db.begin(async (tx) => {
          const signedUp = await tx.authStore.createUserWithKey(linkKey)
          const started = await sessionsOver(tx.sessionStore).create({
            userId: signedUp.user.id,
            keyId: signedUp.key.id,
            secondFactor: SecondFactorStatus.NotRequired,
          }, deviceOf(c))
          const user = await createProfile(
            c,
            tx,
            signedUp.user.id,
            SIGN_IN_LINK_METHOD,
            firstGroupId,
          )
          return { user, ...started }
        })
        await replaceSession(c, state, created)
        return {
          outcome: SignInLinkOutcome.Created,
          signedIn: { user: created.user, session: created.session },
          email,
          next,
        }
      } catch (error) {
        if (error instanceof AuthConflictError && !retried) {
          return await signInByLink(c, link, now, firstGroupId, true)
        }
        throw error
      }
    }

    if (guest) {
      const key = await db.begin((tx) => linkKeyOf(tx, owner))
      await guests.taken(guest.user.id, { id: key.id, userId: owner, method: key.method }, false)
      return { outcome: SignInLinkOutcome.GuestTaken, next }
    }
    const authUser = await db.authStore.findUser(owner)
    if (!authUser || authUser.deletedAt !== null) return { outcome: SignInLinkOutcome.Refused }
    if (await db.admin.isBlocked(owner)) return { outcome: SignInLinkOutcome.Refused }
    const waiting = await waitingForCode(owner)
    let secondFactor: SecondFactorStatus
    if (waiting) {
      secondFactor = SecondFactorStatus.Pending
    } else {
      if (!(await restoreIfWaiting(c, owner))) return { outcome: SignInLinkOutcome.Refused }
      try {
        secondFactor = await signInSecondFactor(authUser)
      } catch (error) {
        if (error instanceof MissingProfileError) return { outcome: SignInLinkOutcome.Refused }
        throw error
      }
    }
    // The session, the last sign-in time and the audit row are kept or undone together.
    const started = await db.begin(async (tx) => {
      const key = await linkKeyOf(tx, owner)
      const begun = await sessionsOver(tx.sessionStore).create({
        userId: owner,
        keyId: key.id,
        secondFactor,
      }, deviceOf(c))
      const user = waiting ??
        await tx.user.updateOne({ id: owner, data: { lastLoginAt: new Date() } })
      if (!user) throw new Error("User not found")
      await tx.authAudit.insert(
        auditRow(c, owner, AuthAuditEventType.SIGNED_IN, SIGN_IN_LINK_METHOD),
      )
      return { user, ...begun }
    })
    await replaceSession(c, state, started)
    return {
      outcome: SignInLinkOutcome.SignedIn,
      signedIn: { user: started.user, session: started.session },
      email,
      next,
    }
  }

  const api: SignIn = {
    auth,
    oauth,
    passkeys,
    guests,

    async signUp(c, rawEmail, password, firstGroupId = uuidV7()) {
      // Checked here too, so a refused address opens no transaction and makes no provider.
      if (normalizeEmail(rawEmail) === null) return null
      // Hashed before `db.begin()`, as before the package provider, so no pool connection is held
      // for the length of a PBKDF2 hash. A password the hasher refuses (not a string, too long) is
      // the same refusal the provider gives it: `invalid-password`, answered as `null`.
      let secret: string
      try {
        secret = await hasher.hash(password)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return null
        throw error
      }
      // The per-transaction provider hashes nothing itself: its `hash` returns the secret made
      // above, both for the new key and for the dummy hash it makes at creation. Its dummy only
      // serves its own `signIn`, which is never called; sign-in runs on `signInPasswords`, whose
      // dummy is a real hash from the real hasher.
      const precomputed: PasswordHasher = {
        hash: () => Promise.resolve(secret),
        verify: (candidate, stored) => hasher.verify(candidate, stored),
      }
      let created
      try {
        created = await db.begin(async (tx) => {
          // Built over the transaction's stores, so the auth user, key and session join it.
          const signedUp = await passwordsOver({
            store: tx.authStore,
            sessions: sessionsOver(tx.sessionStore),
            hasher: precomputed,
            // The route schema is the sign-up length rule (8 to 50 UTF-16 units), as before; the
            // package's own minimum counts code points and would refuse some passwords it accepts.
            minPasswordLength: 1,
          }).signUp({ email: rawEmail, password, device: deviceOf(c) })
          const user = await createProfile(
            c,
            tx,
            signedUp.user.id,
            normalizeEmail(rawEmail),
            firstGroupId,
          )
          return { user, ...signedUp.session }
        })
      } catch (error) {
        if (error instanceof PasswordSignInError) return null
        throw error
      }
      await cookie.set(c, created.session, created.cookieValue)
      return { user: created.user, session: created.session }
    },

    async requestSignUp(c, email, password, guestUserId = null, language = null) {
      // Hashed before anything is written, as `signUp` does, so no pool connection waits on it.
      let secret: string
      try {
        secret = await hasher.hash(password)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return false
        throw error
      }
      const id = uuidV7()
      await db.begin(async (tx) => {
        await tx.signUpRequest.create({
          id,
          email,
          secret,
          expiresAt: signUpExpiry(new Date()),
          guestUserId,
          language,
        })
        await tx.signUpRequest.queueCode(id)
      })
      await setSignUpCookie(c, id)
      return true
    },

    async waitingSignUp(c) {
      const id = await signUpIdOf(c)
      const request = id === null ? null : await db.signUpRequest.find(id)
      return request && { email: request.email, expiresAt: request.expiresAt }
    },

    async resendSignUpCode(c) {
      const id = await signUpIdOf(c)
      if (id === null) return false
      const extended = await db.begin(async (tx) => {
        if (!(await tx.signUpRequest.extend(id, signUpExpiry(new Date())))) return false
        await tx.signUpRequest.queueCode(id)
        return true
      })
      if (extended) await setSignUpCookie(c, id)
      return extended
    },

    async cancelSignUp(c) {
      const id = await signUpIdOf(c)
      if (id !== null) await endSignUp(c, id)
      else deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
    },

    async completeSignUp(c, code, firstGroupId = uuidV7()) {
      const now = new Date()
      const id = await signUpIdOf(c)
      const request = id === null ? null : await db.signUpRequest.find(id, now)
      if (request === null) return { outcome: SignUpOutcome.Expired }
      // Counted outside any transaction, so a wrong guess stays counted whatever follows.
      const checked = await attemptSignUpCode(db.authStore, request, code, now)
      if (checked === ChallengeOutcome.LockedOut) {
        await endSignUp(c, request.id)
        return { outcome: SignUpOutcome.Expired }
      }
      if (checked !== ChallengeOutcome.Matched) return { outcome: SignUpOutcome.WrongCode }

      // Only now, with the mailbox proven, may the answer tell that an account uses the address.
      const existing = async (): Promise<SignUpCompletion> => {
        const account = await accountUsing(db.authStore, request.email)
        await endSignUp(c, request.id)
        if (account === null) return { outcome: SignUpOutcome.Expired }
        return { outcome: SignUpOutcome.AccountExists, email: request.email, account }
      }
      if (request.guestUserId) return await keepGuestByAddress(c, request, now)
      if (await accountUsing(db.authStore, request.email)) return await existing()

      let created
      try {
        created = await db.begin(async (tx) => {
          // Proven from the start: the code just showed that this person holds the mailbox. The
          // key claims the address, so a sign-up of the same address that won the race makes this
          // one throw, and nothing of it is kept.
          const signedUp = await tx.authStore.createUserWithKey({
            method: PASSWORD_METHOD,
            subject: request.email,
            email: request.email,
            secret: request.secret,
            provenAt: now,
          })
          const started = await sessionsOver(tx.sessionStore).create({
            userId: signedUp.user.id,
            keyId: signedUp.key.id,
            secondFactor: SecondFactorStatus.NotRequired,
          }, deviceOf(c))
          const user = await createProfile(c, tx, signedUp.user.id, request.email, firstGroupId)
          await tx.signUpRequest.remove(request.id)
          return { user, ...started }
        })
      } catch (error) {
        if (error instanceof AuthConflictError) return await existing()
        throw error
      }
      deleteCookie(c, PASSWORD_SIGN_UP_COOKIE, signUpCookieOptions)
      await cookie.set(c, created.session, created.cookieValue)
      return {
        outcome: SignUpOutcome.Created,
        signedIn: { user: created.user, session: created.session },
      }
    },

    async redeemSignInLink(c, token, firstGroupId = uuidV7()) {
      const now = new Date()
      // Spent outside any transaction, so the link is used up whatever follows.
      const link = await consumeSignInLink(db.authStore, db.signInLink, token, now)
      if (link === null) return { outcome: SignInLinkOutcome.Refused }
      return await signInByLink(c, link, now, firstGroupId)
    },

    async signIn(c, login, password) {
      // Either path runs exactly one hash verification, so neither tells an unknown login apart.
      const provider = normalizeEmail(login) === null ? signInByUsername : signInByAddress
      let checked
      let secondFactor
      let waiting: User | null
      try {
        // The hash is verified before `db.begin()`, so no pool connection waits on it.
        checked = await provider.checkCredentials({ email: login, password })
        // A blocked user (#146) gets the same answer as a wrong password, before an account
        // waiting to be deleted is restored or a session is made.
        if (await db.admin.isBlocked(checked.user.id)) return null
        waiting = await waitingForCode(checked.user.id)
        if (waiting) {
          secondFactor = SecondFactorStatus.Pending
        } else {
          if (!(await restoreIfWaiting(c, checked.user.id))) return null
          secondFactor = await signInSecondFactor(checked.user)
        }
      } catch (error) {
        if (error instanceof PasswordSignInError || error instanceof MissingProfileError) {
          return null
        }
        throw error
      }
      // The session, the last sign-in time and the audit row are kept or undone together.
      const created = await db.begin(async (tx) => {
        const started = await sessionsOver(tx.sessionStore).create({
          userId: checked.user.id,
          keyId: checked.key.id,
          secondFactor,
        }, deviceOf(c))
        // A deleted row takes no update; the code that restores it comes later.
        const user = waiting ?? await tx.user.updateOne({
          id: checked.user.id,
          data: { lastLoginAt: new Date() },
        })
        // `updateOne` returns `undefined` only when the row vanished after the password check - a
        // race, not a normal "not found".
        if (!user) throw new Error("User not found")
        await tx.authAudit.insert(auditRow(c, user.id, AuthAuditEventType.SIGNED_IN))
        return { user, ...started }
      })
      await cookie.set(c, created.session, created.cookieValue)
      return { user: created.user, session: created.session }
    },

    async signOut(c) {
      // What `auth.endSession` does, with the audit row in the sign-out's transaction. A request
      // without a valid session writes no row, as before; a failed row keeps the session and cookie.
      const state: AppAuthState | null = c.get("auth") ?? null
      const value = await cookie.read(c)
      if (value !== null || state !== null) {
        await db.begin(async (tx) => {
          if (value !== null) await sessionsOver(tx.sessionStore).signOut(value)
          if (state) {
            await tx.authAudit.insert(auditRow(c, state.user.id, AuthAuditEventType.SIGNED_OUT))
          }
        })
      }
      cookie.clear(c)
      c.set("auth", null)
    },

    async connectTotpStart({ user, session }) {
      if (user.mfa === UserMFAStatus.CONFIGURED) {
        return { error: "OTP already activated for your account", qrcode: null, secret: null }
      }
      const key = await db.authStore.findKeyById(session.keyId)
      if (!key) return { error: "User not found", qrcode: null, secret: null }
      if (!mayAddSecondFactor(key)) {
        return { error: TOTP_NEEDS_PROVEN_EMAIL, qrcode: null, secret: null }
      }

      const existing = await db.userTotp.find(user.id)
      let secret: string
      if (existing && existing.confirmedAt === null) {
        secret = existing.secret
      } else {
        secret = generateTotpSecret()
        const saved = await db.begin(async (tx) => {
          if (!(await tx.userTotp.savePending(user.id, secret))) return false
          await tx.user.updateOne({
            id: user.id,
            data: { mfa: UserMFAStatus.CONFIGURATION_NOT_FINISHED },
          })
          return true
        })
        if (!saved) {
          return { error: "OTP already activated for your account", qrcode: null, secret: null }
        }
      }
      const { qrCodeSvg } = totpEnrolment(secret, {
        issuer: accountPart(options.totpIssuer, "App"),
        // A link key's subject is an id: the account's address names it instead (#391).
        label: accountPart(
          key.method === SIGN_IN_LINK_METHOD
            ? (await readEmailStatus(db.emailChange, db.authStore, user.id)).email ?? ""
            : key.subject,
          `user ${user.id}`,
        ),
      })
      return { error: null, qrcode: qrCodeSvg, secret }
    },

    async connectTotpFinish({ user, session }, code) {
      // Checked again here: an enrolment started before this rule existed must not finish either.
      const key = await db.authStore.findKeyById(session.keyId)
      if (!key || !mayAddSecondFactor(key)) return false
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt !== null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      if (step === null) return false
      try {
        return await db.begin(async (tx) => {
          if (!(await tx.userTotp.confirm(user.id, step))) return false
          await tx.user.updateOne({ id: user.id, data: { mfa: UserMFAStatus.CONFIGURED } })
          const txSessions = sessionsOver(tx.sessionStore)
          await txSessions.completeSecondFactor(session.id)
          await txSessions.signOutUser(user.id, { except: session.id })
          return true
        })
      } catch (error) {
        console.error(error)
        return false
      }
    },

    async checkTotp(c, { user, session }, code) {
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt === null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      if (step === null) return false
      if (!(await db.userTotp.acceptStep(user.id, step))) return false
      if (user.deletedAt === null) return await sessions.completeSecondFactor(session.id)
      // The code of an account waiting to be deleted restores it, with the session it completes.
      return await db.begin(async (tx) => {
        if (!(await restoreInTx(tx, c, user.id))) return false
        return await sessionsOver(tx.sessionStore).completeSecondFactor(session.id)
      })
    },

    async disconnectTotp({ user }) {
      if (user.mfa === UserMFAStatus.NOT_CONFIGURED) return false
      try {
        return await db.begin(async (tx) => {
          if (!(await tx.userTotp.deleteConfirmed(user.id))) return false
          await tx.user.updateOne({ id: user.id, data: { mfa: UserMFAStatus.NOT_CONFIGURED } })
          // Sessions still waiting for the removed factor would be refused for good otherwise.
          await sessionsOver(tx.sessionStore).clearPendingSecondFactors(user.id)
          return true
        })
      } catch (error) {
        console.error(error)
        return false
      }
    },

    async changePassword(c, { user }, password, newPassword, signOutOthers = true) {
      const change = { userId: user.id, currentPassword: password, newPassword }
      const request = requestInfoFromContext(c, { trustedProxy: true })
      // One transaction (#293): the password and the tokens change together or not at all, so a
      // failed revoke never leaves a new password with live tokens. The provider is built over
      // the transaction's stores, as at sign-up. The connection is held for one hash and one
      // verify.
      const run = () =>
        db.begin(async (tx) => {
          // Key first, then the user's row: the order a reset takes them in. A token create holds
          // the user's row while it checks the password and inserts, so it either commits before
          // this revoke runs or sees the new password.
          await tx.lockPasswordKey({ userId: user.id })
          await tx.lockUser(user.id)
          const passwords = changePasswordsOver(tx)
          // The person may choose to stay signed in elsewhere: the password is replaced after the
          // same checks, and no session is touched or created, so this device keeps its cookie.
          let session = null
          if (signOutOthers) {
            session = (await passwords.changePassword({ ...change, device: deviceOf(c) })).session
          } else {
            await passwords.changePassword({ ...change, keepSessions: true })
          }
          const revokedTokens = await tx.apiTokens.revoke(
            { userId: user.id },
            "password-change",
            { ip: request.ip || null, userAgent: request.userAgent || null },
          )
          await unlinkTelegramOf(tx, c, user.id, "password-change")
          return { session, revokedTokens }
        })
      const outcome: { changed?: Awaited<ReturnType<typeof run>> } = {}
      // Counted as every password check of a signed-in step is (#406). Only a wrong current
      // password is a guess; a new password the provider refuses gives the count back.
      await countedPasswordCheck(user.id, async () => {
        try {
          outcome.changed = await run()
          return true
        } catch (error) {
          if (error instanceof PasswordSignInError) return error.reason !== "invalid-credentials"
          throw error
        }
      })
      const { changed } = outcome
      if (!changed) return null
      // After the commit: a cookie for a session that was rolled back would sign the device out.
      if (changed.session) {
        await cookie.set(c, changed.session.session, changed.session.cookieValue)
      }
      return { revokedTokens: changed.revokedTokens }
    },

    async resetPassword(rawEmail, code, newPassword, c) {
      const email = normalizeEmail(rawEmail)
      if (email === null) return false
      // Hashed before the transaction, as at sign-up, so no pool connection waits on PBKDF2.
      let secret: string
      try {
        secret = await hasher.hash(newPassword)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) return false
        throw error
      }
      const now = new Date()
      // One transaction, but a wrong code still counts: the refusal returns, it does not throw.
      return await db.begin(async (tx) => {
        // Taken first: an address move of this account waits, or this reset waits for it.
        await tx.lockPasswordKey({ subject: email })
        if (!(await consumePasswordReset(tx.authStore, email, code, now))) return false
        const key = await tx.authStore.findKey(PASSWORD_METHOD, email)
        if (!key || key.email === null) return false
        const user = await tx.authStore.findUser(key.userId)
        if (!user || user.deletedAt !== null) return false
        // An account waiting to be deleted comes back (#357, decision 5): the link reached the
        // mailbox, as a sign-in would prove the password. Its request row goes before the user row
        // is locked, the order a sign-in's restore and the delete for good take them in.
        const profile = await tx.user.findOne({ id: user.id, includeDeleted: true })
        if (profile && profile.deletedAt !== null) await restoreInTx(tx, c, user.id)
        // A token create holds this row while it checks the password and inserts (#293), so the
        // revoke below runs after it and ends its token too.
        await tx.lockUser(user.id)
        // A linked Telegram chat acts as the person too (#269): one linked with a stolen session
        // goes, as the tokens below do. First, so the key clean-up of an unproven address does
        // not take it without its audit row.
        await unlinkTelegramOf(tx, c, user.id, "password-reset")
        // The link reached the mailbox, so the address is proven: this user now owns it. Another
        // user owning it already is a refusal; the code stays spent.
        if (key.provenAt === null) {
          try {
            await tx.authStore.proveKey(key.id, now)
          } catch (error) {
            if (error instanceof AuthConflictError) return false
            throw error
          }
          // Whoever turned on a second factor never proved they own this address: it goes with
          // their claim, so the owner signs in with the new password alone.
          await tx.userTotp.remove(user.id)
          await tx.user.clearSecondFactor(user.id)
          // Every other way in was added before anyone proved the address (#404): a linked Google
          // or GitHub account, and a code key for another address. They go with the claim too, or
          // whoever signed up with the owner's address would sign in again through them. Deleting
          // a key ends its sessions and frees the address it had proven.
          for (const other of await tx.authStore.listKeys(user.id)) {
            if (other.id !== key.id) await tx.authStore.deleteKey(user.id, other.id)
          }
          // An invitation made before the address was proven is a way in for whoever made it
          // (#411): a second account of theirs could still join through the link after this reset.
          await tx.invitationRevocation.allOf(user.id)
        }
        await tx.authStore.updateKeySecret(key.id, secret)
        // The mailbox owner is back in control: an address change someone else asked for goes.
        await tx.emailChange.remove(user.id)
        await sessionsOver(tx.sessionStore).signOutUser(user.id)
        // A reset is account recovery: a token minted with a stolen session goes too (#167), as
        // it does on a password change.
        await tx.apiTokens.revoke({ userId: user.id }, "password-reset")
        // Every browser that switched the account's notifications on stops getting them (#409),
        // whoever it belongs to: the owner switches them on again where they want them.
        await tx.pushTokens.removeAllOf(user.id)
        return true
      })
    },

    async checkPassword(userId, password) {
      const key = await passwordKeyOf(db.authStore, userId)
      const secret = key?.secret
      if (!secret) return false
      return await countedPasswordCheck(
        userId,
        async () => (await hasher.verify(password, secret)).valid,
      )
    },

    countPasswordCheck: countedPasswordCheck,

    async verifyPassword(userId, password, over) {
      const key = await passwordKeyOf(over.authStore, userId)
      return !!key?.secret && (await hasher.verify(password, key.secret)).valid
    },

    async hasPassword(userId, over = db) {
      return !!(await passwordKeyOf(over.authStore, userId))?.secret
    },

    async confirmedByProvider(state) {
      return (await oauth.proofUntil(state)) !== null
    },

    async setPassword(c, state, newPassword) {
      const { user, session } = state
      if (await passwordKeyOf(db.authStore, user.id)) return PasswordSetOutcome.AlreadySet
      if (!(await oauth.proofUntil(state))) return PasswordSetOutcome.ProofRequired
      // Hashed before the transaction, as at sign-up, so no pool connection waits on PBKDF2.
      let secret: string
      try {
        secret = await hasher.hash(newPassword)
      } catch (error) {
        if (error instanceof RangeError || error instanceof TypeError) {
          return PasswordSetOutcome.Refused
        }
        throw error
      }
      try {
        return await db.begin(async (tx) => {
          // Two requests at once: the second reads the key the first one added.
          await tx.lockUser(user.id)
          if (await passwordKeyOf(tx.authStore, user.id)) return PasswordSetOutcome.AlreadySet
          const { email, pending } = await readEmailStatus(
            tx.emailChange,
            tx.authStore,
            user.id,
          )
          // The password needs a name to sign in with, and the account's address is the only one.
          if (email === null) return PasswordSetOutcome.NoAddress
          // Proven: the address read above is one a provider vouched for or a code proved.
          await tx.authStore.addKey(user.id, {
            method: PASSWORD_METHOD,
            subject: email,
            email,
            secret,
            provenAt: new Date(),
          })
          // The password key holds the address from here on. A code key that held it would stay
          // behind, proven, when the address changes again, and would then let whoever has that
          // address later into this account. The key of a change that waits for its code stays.
          await dropCodeKeys(tx.authStore, user.id, pending)
          // A new way in, as a password change is: whoever else holds a session of the account
          // is signed out, and this device stays signed in (#406).
          await sessionsOver(tx.sessionStore).signOutUser(user.id, { except: session.id })
          await tx.authAudit.insert(
            auditRow(c, user.id, AuthAuditEventType.SIGN_IN_METHOD_LINKED, PASSWORD_METHOD),
          )
          return PasswordSetOutcome.Set
        })
      } catch (error) {
        // Another account's key has this sign-in name. The transaction is undone.
        if (error instanceof AuthConflictError) return PasswordSetOutcome.Refused
        throw error
      }
    },

    async verifyTotpCode({ user }, code) {
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt === null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      return step !== null && await db.userTotp.acceptStep(user.id, step)
    },

    async accountDeletionBlockers({ user }) {
      return await db.accountDeletion.blockers(user.id)
    },

    async deleteAccount(c, { user }) {
      const result = await db.begin(async (tx): Promise<AccountDeleteResult> => {
        // Gone or already deleted by a request running alongside: that one signed this out too.
        if (!(await tx.accountDeletion.lock(user.id))) return { blockers: [] }
        const blockers = await tx.accountDeletion.blockers(user.id)
        if (blockers.length > 0) return { blockers }
        await tx.user.deleteOne({ id: user.id })
        const request = await tx.accountDeletion.request(user.id)
        await sessionsOver(tx.sessionStore).signOutUser(user.id)
        await tx.authAudit.insert(
          auditRow(c, user.id, AuthAuditEventType.ACCOUNT_DELETION_REQUESTED),
        )
        return { deleteAfter: request.deleteAfter }
      })
      if (result.deleteAfter) {
        cookie.clear(c)
        c.set("auth", null)
      }
      return result
    },

    async emailStatus({ user }) {
      return await readEmailStatus(db.emailChange, db.authStore, user.id)
    },

    async requestEmailChange(state, password, rawEmail) {
      const { user } = state
      const email = normalizeEmail(rawEmail)
      if (email === null) return EmailChangeOutcome.InvalidEmail
      const key = await passwordKeyOf(db.authStore, user.id)
      if (key) {
        if (!key.secret || password === undefined) return EmailChangeOutcome.WrongPassword
        const secret = key.secret
        const right = await countedPasswordCheck(
          user.id,
          async () => (await hasher.verify(password, secret)).valid,
        )
        if (!right) return EmailChangeOutcome.WrongPassword
      } else if (!(await oauth.proofUntil(state))) {
        return EmailChangeOutcome.ProofRequired
      }
      const current = key
        ? key.email
        : (await readEmailStatus(db.emailChange, db.authStore, user.id)).email
      if (current === email) {
        await db.emailChange.remove(user.id)
        return EmailChangeOutcome.Kept
      }
      // Without a password the address is read from the account's other sign-in methods, and a
      // proof of an address one of them carries adds no key of its own: the change would answer
      // "done" and leave the address as it was.
      if (!key && (await db.authStore.listKeys(user.id)).some((other) => other.email === email)) {
        return EmailChangeOutcome.AlreadyCarried
      }
      await db.emailChange.save(user.id, email)
      return EmailChangeOutcome.Requested
    },

    async verifyEmail(c, { user, session }, code) {
      const now = new Date()
      // One transaction, but a wrong code still counts: the refusal returns, it does not throw.
      const result = await db.begin(async (tx) => {
        // Taken before the password hash is read, so a reset in flight lands first and its new
        // hash is the one that moves, or waits until the move is done.
        await tx.lockPasswordKey({ userId: user.id })
        // An account without a password has no key to lock there: a first password takes this
        // lock, so it lands before the address is read or waits until the move is done.
        await tx.lockUser(user.id)
        const status = await readEmailStatus(tx.emailChange, tx.authStore, user.id)
        const target = emailToVerify(status)
        const key = await passwordKeyOf(tx.authStore, user.id)
        // Without a password key only a waiting change has a code to enter: the address such an
        // account has is one a provider vouched for or a code proved.
        if (target === null || (key === null && status.pending === null)) {
          return { outcome: EmailVerifyOutcome.NothingToVerify }
        }
        const txSessions = sessionsOver(tx.sessionStore)
        try {
          await proveEmailCode(tx.authStore, user.id, target, code)
        } catch (error) {
          if (error instanceof EmailCodeError) return { outcome: EmailVerifyOutcome.WrongCode }
          // Another user owns the address. The code is spent, and the change cannot happen.
          if (error instanceof AuthConflictError) {
            if (status.pending !== null) await tx.emailChange.remove(user.id)
            return { outcome: EmailVerifyOutcome.Taken }
          }
          throw error
        }
        if (status.pending === null) return { outcome: EmailVerifyOutcome.Verified }

        // No password to move (#384): the key `proveAddress` just proved holds the new address.
        // An address held that way before goes, and a provider key that carried the old address
        // keeps signing in but carries it no more (#403), so the account has one address and the
        // old one is free again. Every other session ends, as for an account with a password
        // below (#406).
        if (key === null) {
          await dropCodeKeys(tx.authStore, user.id, target)
          if (status.email !== null) await releaseAddress(tx.authStore, user.id, status.email)
          await tx.emailChange.remove(user.id)
          await txSessions.signOutUser(user.id, { except: session.id })
          return { outcome: EmailVerifyOutcome.Verified }
        }

        // A new address: `proveAddress` gave the user a proven code key for it, which also removed
        // every other user's unproven claim to it. The password moves onto a key for the new
        // address, then every code key of the account and the old key go; deleting the old key
        // ends its sessions. A provider key that carried the old address loses it but stays: the
        // Google or GitHub identity linked before the move keeps signing in by its own user id,
        // while a different identity that only vouches for the old address is no longer matched
        // to this account (#403). No key is left on the old address, so it is free again. The
        // sessions that a provider sign-in started end too: only the new one stays.
        const moved = await tx.authStore.addKey(user.id, {
          method: PASSWORD_METHOD,
          subject: target,
          email: target,
          secret: key.secret,
          provenAt: now,
        })
        await dropCodeKeys(tx.authStore, user.id)
        const created = await txSessions.create({
          userId: user.id,
          keyId: moved.id,
          secondFactor: user.mfa === UserMFAStatus.CONFIGURED
            ? SecondFactorStatus.Completed
            : SecondFactorStatus.NotRequired,
        }, deviceOf(c))
        await tx.authStore.deleteKey(user.id, key.id)
        if (status.email !== null) await releaseAddress(tx.authStore, user.id, status.email)
        await txSessions.signOutUser(user.id, { except: created.session.id })
        await tx.emailChange.remove(user.id)
        return { outcome: EmailVerifyOutcome.Verified, created }
      })
      if (result.created) await cookie.set(c, result.created.session, result.created.cookieValue)
      return result.outcome
    },

    async expireSessions() {
      await sessions.expireStale()
    },

    async entitledSession(sessionId) {
      const session = await db.sessionStore.findById(sessionId)
      if (!session || session.status !== SessionStatus.Active) return null
      if (session.expiresAt.getTime() <= Date.now()) return null
      const user = await loadUser(session.userId)
      if (!user) return null
      if (!secondFactorSatisfied(session.secondFactor, hasSecondFactor(user))) return null
      // A live socket counts as use, so a tab that only talks over it is not shown as idle.
      touchSession(session.id, session.userId)
      return { session, user }
    },

    async listSessions({ session }) {
      const rows = await sessions.listForUser(session.userId)
      const devices = rows.map((row): SignedInDevice => ({
        id: row.id,
        deviceName: row.deviceName,
        ipHint: row.ipHint,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt.toISOString(),
        current: row.id === session.id,
      }))
      // `sort` is stable: the rest keep the database's order, last used first.
      return devices.sort((a, b) => Number(b.current) - Number(a.current))
    },

    async endSession(c, { session, user }, sessionId) {
      if (sessionId === session.id) return false
      return await db.begin(async (tx) => {
        if (!(await sessionsOver(tx.sessionStore).deleteForUser(user.id, sessionId))) return false
        await tx.authAudit.insert(
          auditRow(c, user.id, AuthAuditEventType.SESSIONS_ENDED, String(sessionId)),
        )
        return true
      })
    },

    async endOtherSessions(c, { session, user }) {
      return await db.begin(async (tx) => {
        // Ends nothing unless `session.id` is this user's live session, so a wrong id cannot sign
        // the person out everywhere.
        const ended = await sessionsOver(tx.sessionStore).deleteOthers(user.id, session.id)
        if (ended > 0) {
          await tx.authAudit.insert(
            auditRow(c, user.id, AuthAuditEventType.SESSIONS_ENDED, "all other sessions"),
          )
        }
        return ended
      })
    },
  }
  return api
}

/**
 * Whether the key's user may turn on a second factor: not while the address it signs in with is
 * unproven. A username key carries no address, so there is nothing to prove.
 */
function mayAddSecondFactor(key: AuthKey): boolean {
  return key.email === null || key.provenAt !== null
}

/** Thrown by sign-in's `secondFactorFor` when the auth user has no `users` row: a refusal. */
class MissingProfileError extends Error {
  constructor() {
    super("the auth user has no profile row")
    this.name = "MissingProfileError"
  }
}

/**
 * An issuer or label the key URI format accepts: `:` separates the two there, so it is replaced,
 * and an empty result falls back.
 */
function accountPart(value: string, fallback: string): string {
  const cleaned = value.replaceAll(":", " ").trim()
  return cleaned === "" ? fallback : cleaned
}
