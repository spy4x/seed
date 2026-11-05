/**
 * The account's address: its status, a change and the code that proves it, wired from
 * `createSignIn`. Not `@server/auth/email-verification.ts`, which stores the codes and the waiting
 * change.
 *
 * - **Proving the address (#140).** `verifyEmail` checks a code from
 *   `@spy4x/server/auth/email-code` and proves the address it was sent to. A reset code proves the
 *   address too; when it was unproven until then, the reset also removes any second factor, since
 *   whoever set it up never showed they own the mailbox. A new address waits in `email_changes`
 *   until its code proves it; only then does the password key move to it, so the account signs in
 *   with the old address until that moment. Then a Google or GitHub key that carried the old
 *   address loses it and keeps signing in (#403): the old address no longer opens the account
 *   through another provider identity that vouches for it.
 *
 * @module
 */
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AuthConflictError, normalizeEmail } from "@spy4x/server/auth"
import { EmailCodeError } from "@spy4x/server/auth/email-code"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { type EmailStatus, emailToVerify, UserMFAStatus } from "@domain/identity"
import {
  dropCodeKeys,
  passwordKeyOf,
  proveEmailCode,
  readEmailStatus,
  releaseAddress,
} from "@server/auth/email-verification.ts"
import type { AppAuthState } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link EmailChangeOperations.requestEmailChange} did. */
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

/** What {@link EmailChangeOperations.verifyEmail} did. */
export enum EmailVerifyOutcome {
  Verified = 1,
  /** Wrong, expired, used up or never sent: one answer for all, so a guesser learns nothing. */
  WrongCode = 2,
  /** The code was right, but another account owns the address. The change is dropped. */
  Taken = 3,
  /** The address is proven and no change waits: no code can prove anything. */
  NothingToVerify = 4,
}

/** The address operations the routes call. */
export interface EmailChangeOperations {
  /** Where the user's address stands. */
  emailStatus(state: AppAuthState): Promise<EmailStatus>
  /**
   * Checks the current password, then records `email` as the address to move to once a code sent
   * there proves it. The account keeps signing in with its old address until then. The password
   * is asked so that a stolen session cannot point the account, and its reset codes, elsewhere.
   * An account with no password is asked for a provider sign-in a moment ago instead
   * ({@link PasswordOperations.confirmedByProvider}). The password is counted as
   * {@link PasswordOperations.checkPassword} counts it.
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
}

/** Builds the address operations over the sign-in's own parts. */
export function createEmailChangeOperations(own: SignInParts): EmailChangeOperations {
  const { db, hasher, cookie, sessionsOver, signOutOthers, countedPasswordCheck, oauth, deviceOf } =
    own
  return {
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
          await signOutOthers(tx, user.id, session.id)
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
        // This device's notifications move to its new session before the old one ends.
        await tx.pushTokens.moveToSession(user.id, session.id, created.session.id)
        await tx.authStore.deleteKey(user.id, key.id)
        if (status.email !== null) await releaseAddress(tx.authStore, user.id, status.email)
        await signOutOthers(tx, user.id, created.session.id)
        await tx.emailChange.remove(user.id)
        return { outcome: EmailVerifyOutcome.Verified, created }
      })
      if (result.created) await cookie.set(c, result.created.session, result.created.cookieValue)
      return result.outcome
    },
  }
}
