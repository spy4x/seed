/**
 * The authenticator app (two-factor), wired from `createSignIn`. Not `totp-failures.ts`, which
 * counts wrong codes for the routes.
 *
 * - **Authenticator app.** Secret and last accepted time step live in `user_totp`; `users.mfa`
 *   keeps its three states. An account whose address is not proven cannot turn one on: whoever
 *   squats someone else's address must not lock its owner out with a second factor.
 *
 * @module
 */
import type { Context } from "hono"
import { generateTotpSecret, totpEnrolment, verifyTotp } from "@spy4x/server/sign-in"
import type { AuthKey } from "@spy4x/server/auth"
import { SIGN_IN_LINK_METHOD, UserMFAStatus } from "@domain/identity"
import { readEmailStatus } from "@server/auth/email-verification.ts"
import type { AppAuthState } from "./sign-in.ts"
import type { SignInParts } from "./sign-in-parts.ts"

/** The answer of {@link TotpOperations.connectTotpStart}: an error, or the enrolment to show. */
export type TotpConnectStart =
  | { error: string; qrcode: null; secret: null }
  | { error: null; qrcode: string; secret: string }

/** Why connecting an authenticator app was refused before it started. */
export const TOTP_NEEDS_PROVEN_EMAIL = "Verify your e-mail address before you turn on two-factor"

/** The authenticator-app operations the routes call. */
export interface TotpOperations {
  /**
   * Starts authenticator-app enrolment, or returns the unfinished one. The caller checks the
   * password, or the provider sign-in of an account without one, first.
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
   * Whether `code` is the user's current authenticator code, spending it so it never works twice.
   * Leaves the session as it is: for a step that asks for the code again, such as deleting the
   * account. `false` without a confirmed enrolment.
   */
  verifyTotpCode(state: AppAuthState, code: string): Promise<boolean>
}

/** Builds the authenticator-app operations over the sign-in's own parts. */
export function createTotpOperations(own: SignInParts): TotpOperations {
  const { db, options, sessions, sessionsOver, signOutOthers, restoreInTx } = own
  return {
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
        // A code key's subject is an id: the account's address names it instead.
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
          await sessionsOver(tx.sessionStore).completeSecondFactor(session.id)
          await signOutOthers(tx, user.id, session.id)
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

    async verifyTotpCode({ user }, code) {
      const enrolment = await db.userTotp.find(user.id)
      if (!enrolment || enrolment.confirmedAt === null) return false
      const step = verifyTotp(enrolment.secret, code, {
        lastAcceptedStep: enrolment.lastAcceptedStep,
      })
      return step !== null && await db.userTotp.acceptStep(user.id, step)
    },
  }
}

/**
 * Whether the key's user may turn on a second factor: not while the address it signs in with is
 * unproven. A username key carries no address, so there is nothing to prove.
 */
function mayAddSecondFactor(key: AuthKey): boolean {
  return key.email === null || key.provenAt !== null
}

/**
 * An issuer or label the key URI format accepts: `:` separates the two there, so it is replaced,
 * and an empty result falls back.
 */
function accountPart(value: string, fallback: string): string {
  const cleaned = value.replaceAll(":", " ").trim()
  return cleaned === "" ? fallback : cleaned
}
