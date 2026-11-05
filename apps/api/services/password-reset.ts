/**
 * Password reset by a mailed code, wired from `createSignIn`. Not `@server/auth/password-reset.ts`,
 * which stores the request, its code and the reset token.
 *
 * - **Password reset by code (#752).** The browser that asks waits for a mailed code; the right
 *   code buys a reset token, and `resetPassword` spends that token
 *   (`@server/auth/password-reset.ts`), proves the address (whoever holds the mailbox owns the
 *   account that signs in with it), sets the new password, signs out every session of the user, deletes every API token and removes every
 *   push subscription (#409). It signs nobody in: the person signs in again with the new
 *   password, and their second factor if they have one. When the address was not proven
 *   before, the second factor and every other sign-in method of the account go too (#404):
 *   whoever added them never proved they own the address. An account waiting to be deleted is
 *   restored by the reset (#388).
 *
 * @module
 */
import type { Context } from "hono"
import { AuthConflictError, ChallengeOutcome, normalizeEmail } from "@spy4x/server/auth"
import { PASSWORD_METHOD } from "@spy4x/server/auth/password"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  consumePasswordReset,
  issuePasswordReset,
  PASSWORD_RESET_CODES,
  PASSWORD_RESET_TTL_MINUTES,
  passwordResetExpiry,
} from "@server/auth/password-reset.ts"
import { waitingCookie } from "./sign-in-codes.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** What {@link PasswordResetOperations.verifyPasswordReset} did with a code (#752). */
export enum PasswordResetOutcome {
  /** The right code: the token that sets the new password comes with it. */
  Verified = 1,
  /** Not the request's code: the guess is counted and the request keeps waiting. */
  WrongCode = 2,
  /** No request waits in this browser, it expired or its guesses ran out. The request ends. */
  Expired = 3,
}

/** The answer of {@link PasswordResetOperations.verifyPasswordReset}. */
export type PasswordResetVerification =
  | { outcome: PasswordResetOutcome.Verified; token: string }
  | { outcome: PasswordResetOutcome.WrongCode | PasswordResetOutcome.Expired }

/** The cookie that ties a browser to the password-reset code it waits for (#752). */
export const PASSWORD_RESET_COOKIE = "password_reset"

/** The password-reset operations the routes call. */
export interface PasswordResetOperations {
  /**
   * Asks for a password-reset code to `email`, already normalised (#752): writes the request and
   * its mail job, and names the request in this browser's cookie. The same work for every address;
   * the worker mails the code only when an account signs in with a password and that address.
   */
  requestPasswordReset(c: Context, email: string): Promise<void>
  /** The address of the reset this browser waits for, or `null`. */
  waitingPasswordReset(c: Context): Promise<{ email: string } | null>
  /** As {@link SignInCodeOperations.resendSignInCode}, for the reset this browser waits for. */
  resendPasswordReset(c: Context): Promise<boolean>
  /** Forgets this browser's reset request and its cookie. */
  cancelPasswordReset(c: Context): Promise<void>
  /**
   * Checks `code` against this browser's reset request. The right code answers a token that
   * {@link finishPasswordReset} takes with the new password, and keeps the request waiting as long
   * as the token works.
   */
  verifyPasswordReset(c: Context, code: string): Promise<PasswordResetVerification>
  /**
   * Sets the new password with `token`, for the address of this browser's reset request, as
   * {@link resetPassword} does. On success every reset request and code of the address ends and
   * the cookie goes. `false` when no request waits or the reset is refused.
   */
  finishPasswordReset(c: Context, token: string, newPassword: string): Promise<boolean>
  /**
   * Spends the reset token for `email` and, when it was the live one, proves the address, replaces
   * the password, signs out every session of the user and revokes every API token, with an audit
   * row each, and removes every push subscription of the user (#409). An account waiting to be
   * deleted is restored too: the code proved the mailbox, so the person is back (#388). `c`,
   * when given, names the request in the restore's audit row.
   * `false`, and the password unchanged, when the token is wrong, expired, already used or
   * replaced, the new password is refused, or no live account signs in with the address.
   */
  resetPassword(email: string, code: string, newPassword: string, c?: Context): Promise<boolean>
}

/** Builds the password-reset operations over the sign-in's own parts. */
export function createPasswordResetOperations(own: SignInParts): PasswordResetOperations {
  const { db, options, hasher, sessionsOver, restoreInTx, unlinkTelegramOf } = own
  const passwordResetCookie = waitingCookie(
    options,
    PASSWORD_RESET_COOKIE,
    "/api/auth/password/reset",
    "app.password-reset",
    PASSWORD_RESET_TTL_MINUTES,
  )

  /** The reset request this browser's cookie names, while it works, or `null`. */
  async function waitingResetRequest(c: Context, now: Date) {
    const id = await passwordResetCookie.idOf(c)
    return id ? await db.passwordReset.find(id, now) : null
  }
  const operations: PasswordResetOperations = {
    async requestPasswordReset(c, email) {
      const id = uuidV7()
      await db.begin(async (tx) => {
        await tx.passwordReset.create({
          id,
          email,
          expiresAt: passwordResetExpiry(new Date()),
          byOperator: false,
        })
        await tx.passwordReset.queueCode(id)
      })
      await passwordResetCookie.set(c, id)
    },

    async waitingPasswordReset(c) {
      const request = await waitingResetRequest(c, new Date())
      return request ? { email: request.email } : null
    },

    async resendPasswordReset(c) {
      const now = new Date()
      const request = await waitingResetRequest(c, now)
      if (!request) return false
      await db.begin(async (tx) => {
        await tx.passwordReset.extend(request.id, passwordResetExpiry(now), now)
        await tx.passwordReset.queueCode(request.id)
      })
      await passwordResetCookie.set(c, request.id)
      return true
    },

    async cancelPasswordReset(c) {
      const id = await passwordResetCookie.idOf(c)
      if (id) await db.passwordReset.remove(id)
      passwordResetCookie.clear(c)
    },

    async verifyPasswordReset(c, code) {
      const now = new Date()
      const request = await waitingResetRequest(c, now)
      const end = async (): Promise<PasswordResetVerification> => {
        if (request) await db.passwordReset.remove(request.id)
        passwordResetCookie.clear(c)
        return { outcome: PasswordResetOutcome.Expired }
      }
      if (!request) return await end()
      const guessed = await PASSWORD_RESET_CODES.attempt(db.authStore, request, code, now)
      if (guessed === ChallengeOutcome.WrongGuess) {
        return { outcome: PasswordResetOutcome.WrongCode }
      }
      if (guessed !== ChallengeOutcome.Matched) return await end()
      // A code is mailed only to an account that resets; one gone since is refused like a late code.
      const issued = await issuePasswordReset(db.authStore, request.email, now)
      if (!issued) return await end()
      // The request waits as long as the token works, so the new password can follow.
      await db.passwordReset.extend(request.id, issued.expiresAt, now)
      await passwordResetCookie.set(c, request.id)
      return { outcome: PasswordResetOutcome.Verified, token: issued.code }
    },

    async finishPasswordReset(c, token, newPassword) {
      const request = await waitingResetRequest(c, new Date())
      if (!request) {
        passwordResetCookie.clear(c)
        return false
      }
      if (!(await operations.resetPassword(request.email, token, newPassword, c))) return false
      await PASSWORD_RESET_CODES.forget(db.authStore, request.email)
      await db.passwordReset.removeFor(request.email)
      passwordResetCookie.clear(c)
      return true
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
        // An account waiting to be deleted comes back (#357, decision 5): the code reached the
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
        // The code reached the mailbox, so the address is proven: this user now owns it. Another
        // user owning it already is a refusal; the token stays spent.
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
  }
  return operations
}
