/**
 * The app's sign-in: `createSignIn` joins the flow files beside it into the one object the routes
 * call, and holds the password sign-in and sign-out itself. `auth.ts` builds the app's instance.
 *
 * The flows: `sign-up.ts`, `sign-in-codes.ts`, `password-reset.ts`, `password.ts`, `totp.ts`,
 * `email-change.ts`, `sessions.ts`, `account-deletion.ts`, `oauth-sign-in.ts`,
 * `passkey-sign-in.ts` and `guest-sign-in.ts`. Each gets the parts built here (`sign-in-parts.ts`).
 * They are wired onto JSR's `@spy4x/server/sign-in` and `@spy4x/server/auth`: sessions, the
 * session cookie, the guards, password hashing and authenticator-app codes all come from the
 * package; these files decide what the template adds on top of them. The local `@server/auth`
 * (`libs/server/auth`) holds the stores they use.
 *
 * - **E-mail addresses, and the usernames of older accounts.** Sign-up takes an address: the
 *   package's `createPasswordSignIn` writes one `password` key whose subject and `email` are the
 *   address as `normalizeEmail` leaves it (trimmed, lower-cased), unproven. Accounts made before
 *   that signed up with a username: their key's subject is the normalised username and its `email`
 *   is null. Sign-in takes either: a login `normalizeEmail` accepts goes to the address provider,
 *   anything else to a username provider over the same keys, so an older account signs in as before.
 *   The address is attached to the key, not to `users`: nullable (older keys), unique through the
 *   key's `(method, subject)` constraint, and compared after normalisation.
 * - **Audit rows in the same transaction (#191).** Sign-up, sign-in and sign-out each write their
 *   `auth_audits` row inside the transaction that changes the session, so a failed row undoes the
 *   action. Sign-in checks the password with the package's `checkCredentials` first and creates
 *   the session itself, so the transaction holds no connection while a hash is verified.
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

import type { Context, MiddlewareHandler } from "hono"
import {
  type Auth,
  type AuthState,
  createAuth,
  createPasswordHasher,
  type PasswordHasher,
  SecondFactorStatus,
  SessionCookie,
  type SessionDevice,
  SessionManager,
  type SessionStore,
} from "@spy4x/server/sign-in"
import { type AuthSessionRecord, normalizeEmail } from "@spy4x/server/auth"
import {
  createPasswordSignIn,
  type PasswordSignIn,
  PasswordSignInError,
  type PasswordSignInOptions,
} from "@spy4x/server/auth/password"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { ipHint } from "@spy4x/net/ip"
import { deviceName } from "@spy4x/net/user-agent"
import { GroupError } from "@domain/groups"
import {
  type AuthAuditBase,
  AuthAuditEventType,
  type User,
  UserMFAStatus,
  UserRole,
} from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import { hasUnstorableTextCharacters } from "@spy4x/platform/universal/text"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { createOAuthOperations, type OAuthOperations, type OAuthOptions } from "./oauth-sign-in.ts"
import {
  createPasskeyOperations,
  type PasskeyOperations,
  type PasskeyOptions,
} from "./passkey-sign-in.ts"
import { PasswordLockedError } from "./password-locked.ts"
import type { SignInParts } from "./sign-in-parts.ts"
import { createGuestOperations, type GuestOperations } from "./guest-sign-in.ts"
import { createSignUpOperations, type SignUpOperations } from "./sign-up.ts"
import { createSignInCodeOperations, type SignInCodeOperations } from "./sign-in-codes.ts"
import { createPasswordResetOperations, type PasswordResetOperations } from "./password-reset.ts"
import { createPasswordOperations, type PasswordOperations } from "./password.ts"
import { createTotpOperations, type TotpOperations } from "./totp.ts"
import { createEmailChangeOperations, type EmailChangeOperations } from "./email-change.ts"
import { createSessionOperations, type SessionOperations } from "./sessions.ts"
import {
  type AccountDeletionOperations,
  createAccountDeletionOperations,
} from "./account-deletion.ts"

/** Longest username, in characters (code points), after normalisation. */
export const USERNAME_MAX_LENGTH = 50

/** What `c.get("auth")` holds for a signed-in request. */
export type AppAuthState = AuthState<AuthSessionRecord, User>

/** A user who just signed up or signed in, and the session the cookie now carries. */
export interface SignedIn {
  user: User
  session: AuthSessionRecord
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

/** The sign-in operations the routes call. */
export interface SignIn
  extends
    SignUpOperations,
    SignInCodeOperations,
    PasswordResetOperations,
    PasswordOperations,
    TotpOperations,
    EmailChangeOperations,
    SessionOperations,
    AccountDeletionOperations {
  /** Middleware and guards from `createAuth`. */
  auth: Auth<AuthSessionRecord, User>
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
  /**
   * Signs out every session of `userId` but `keep`, and removes the push subscriptions those
   * sessions stored, so a device signed out from elsewhere stops getting the account's
   * notifications at once (#181). Runs inside the caller's transaction.
   */
  const signOutOthers = async (tx: AppDbBase, userId: number, keep: number) => {
    await sessionsOver(tx.sessionStore).signOutUser(userId, { except: keep })
    await tx.pushTokens.removeAllBut(userId, keep)
  }
  /**
   * Ends `previous`, the session this browser held before it signed in as `next`, inside the
   * caller's transaction (#572). The browser's notifications follow it when the same person signed
   * in again, and stop when someone else did: a second person on a shared browser must not keep
   * receiving the first person's.
   */
  const endReplaced = async (tx: AppDbBase, previous: AppAuthState, next: AuthSessionRecord) => {
    const { user, session } = previous
    if (user.id === next.userId) await tx.pushTokens.moveToSession(user.id, session.id, next.id)
    else await tx.pushTokens.removeOfSession(user.id, session.id)
    await sessionsOver(tx.sessionStore).deleteForUser(user.id, session.id)
  }
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
    // A `verify` that throws keeps the count `begin` took: a token create that fails after a right
    // password leaves one (#178). Rare, and left as it is.
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
  // The guest operations call the password and code checks the returned object defines; they run
  // only on requests, long after `api` below is assigned.
  const guests = createGuestOperations({
    db,
    enabled: options.guests ?? true,
    sessionsOver,
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
    endReplaced,
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
    endReplaced,
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

  /** Sets the cookie of a new session and ends the one the browser held before, if any. */
  async function replaceSession(
    c: Context,
    previous: AppAuthState | null | undefined,
    started: { session: AuthSessionRecord; cookieValue: string },
  ): Promise<void> {
    await cookie.set(c, started.session, started.cookieValue)
    if (previous) await db.begin((tx) => endReplaced(tx, previous, started.session))
  }

  const parts: SignInParts = {
    db,
    options,
    hasher,
    cookie,
    sessions,
    sessionsOver,
    signOutOthers,
    countedPasswordCheck,
    loadUser,
    hasSecondFactor,
    touchSession,
    secondFactorFrom,
    passwordsOver,
    signInSecondFactor,
    waitingForCode,
    restoreInTx,
    restoreIfWaiting,
    guests,
    oauth,
    createProfile,
    replaceSession,
    auditRow,
    deviceOf,
    unlinkTelegramOf,
    isMissingProfile: (error) => error instanceof MissingProfileError,
  }

  const api: SignIn = {
    auth,
    oauth,
    passkeys,
    guests,
    ...createSignUpOperations(parts),
    ...createSignInCodeOperations(parts),
    ...createPasswordResetOperations(parts),
    ...createPasswordOperations(parts),
    ...createTotpOperations(parts),
    ...createEmailChangeOperations(parts),
    ...createSessionOperations(parts),
    ...createAccountDeletionOperations(parts),

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
      // The session this browser held before ends, as after a code, provider or passkey sign-in:
      // a second person on a shared browser must not keep the first person's notifications (#572).
      await replaceSession(c, c.get("auth") as AppAuthState | null | undefined, created)
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
  }
  return api
}

/** Thrown by sign-in's `secondFactorFor` when the auth user has no `users` row: a refusal. */
class MissingProfileError extends Error {
  constructor() {
    super("the auth user has no profile row")
    this.name = "MissingProfileError"
  }
}
