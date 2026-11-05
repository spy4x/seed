/**
 * Checking, changing and setting the password, wired from `createSignIn`. The hashing and the
 * provider are JSR's `@spy4x/server/auth/password`; the count of wrong passwords per sign-in name
 * is `password-failures.ts`.
 *
 * @module
 */
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AuthConflictError } from "@spy4x/server/auth"
import { PASSWORD_METHOD, PasswordSignInError } from "@spy4x/server/auth/password"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { AuthAuditEventType, hasPasswordAddress, UserMFAStatus } from "@domain/identity"
import type { AppDbBase } from "./db-base.ts"
import { dropCodeKeys, passwordKeyOf, readEmailStatus } from "@server/auth/email-verification.ts"
import type { AppAuthState } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link PasswordOperations.setPassword} did. */
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

/** The password operations the routes call. */
export interface PasswordOperations {
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
}

/** Builds the password operations over the sign-in's own parts. */
export function createPasswordOperations(own: SignInParts): PasswordOperations {
  const {
    db,
    hasher,
    cookie,
    sessionsOver,
    signOutOthers,
    countedPasswordCheck,
    secondFactorFrom,
    passwordsOver,
    oauth,
    auditRow,
    deviceOf,
    unlinkTelegramOf,
  } = own
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
  return {
    async changePassword(c, { user, session: current }, password, newPassword, endOthers = true) {
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
          if (endOthers) {
            session = (await passwords.changePassword({ ...change, device: deviceOf(c) })).session
            // Every session ended and this device got a new one: its notifications move to it,
            // and every other device's go (#181).
            await tx.pushTokens.moveToSession(user.id, current.id, session.session.id)
            await tx.pushTokens.removeAllBut(user.id, session.session.id)
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
          // A key deleted between the check and this write reads as "invalid-credentials" too, so
          // a right password then counts as wrong once (#178). Rare, and left as it is.
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
          const status = await readEmailStatus(tx.emailChange, tx.authStore, user.id)
          // The password needs a name to sign in with, and the account's address is the only one.
          if (!hasPasswordAddress(status)) return PasswordSetOutcome.NoAddress
          const { email, pending } = status
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
          await signOutOthers(tx, user.id, session.id)
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
  }
}
