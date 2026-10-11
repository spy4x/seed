import { Hono } from "hono"
import type { Context } from "hono"
import { validate } from "@spy4x/validation"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { normalizeEmail } from "@spy4x/server/auth"
import {
  accountDeleteSchema,
  authEmailChangeSchema,
  authEmailCodeSchema,
  authOTPSchema,
  authPasswordChangeSchema,
  authPasswordForgotSchema,
  authPasswordResetSchema,
  authSignInSchema,
  authSignUpSchema,
  emailToVerify,
  type User,
  UserMFAStatus,
} from "@domain/identity"
import { EmailChangeOutcome, EmailVerifyOutcome, type SignIn } from "@api/services/sign-in.ts"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { Lockout } from "@spy4x/server/lockout"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import type { RateLimitDecision } from "@spy4x/platform/rate-limit"
import { readApiJson } from "@api/services/json-body.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  signIn: SignIn
  /** Announces a sign-out, so the person's open sockets close. Audit rows are not events (#191). */
  emit(event: UserSignedOutEvent): void
  mutationGuards: MutationGuards
  rateLimits: AuthRateLimits
  /** Persistent count of wrong one-time codes per user, with a growing lock. */
  totpFailures: Lockout
  /**
   * Queues a reset link for a normalised address. The worker sends it only when an account signs
   * in with the address, so this call does the same work either way.
   */
  requestPasswordReset(email: string): Promise<void>
  /** Persistent count of wrong e-mail codes per user, with a growing lock. */
  emailCodeFailures: Lockout
  /** Queues a mail with a new code for `email`, the address the user's account must prove. */
  requestEmailCode(userId: number, email: string): Promise<void>
  /** Told when the code mail after a sign-up could not be queued; the sign-up still stands. */
  logError(message: string, error: unknown): void
}

/** The answer to a reset request that was accepted, whether or not the address has an account. */
export const PASSWORD_RESET_REQUESTED = {
  success: true,
  message: "If an account uses this address, a link to reset its password is on its way.",
}

/** The answer to a reset link that cannot be used. */
export const PASSWORD_RESET_REFUSED = "This link is invalid, used or expired. Ask for a new one."

/** The answer to an e-mail code that cannot be used: wrong, expired or used up alike. */
export const EMAIL_CODE_REFUSED = "This code is wrong or has expired. Ask for a new one."

/** The answer when the address is proven and no change waits, so no code is due. */
export const EMAIL_NOTHING_TO_VERIFY = "Your e-mail address is already verified."

/** The answer when a right code proves an address another account owns. */
export const EMAIL_TAKEN = "Another account already uses this address."

/**
 * The answer when a code mail to an address the account wants to move to is refused. One wording
 * for both budgets, so it tells nothing about who owns the address.
 */
export const EMAIL_CHANGE_TOO_MANY = "Too many address changes, try again later."

/**
 * Spends a code mail to `email`, an address the account wants to move to: first from the
 * account's budget, then from the address's change budget. The owner's own code budget stays
 * untouched, since the address may be someone else's.
 */
async function spendChangeMail(
  rateLimits: AuthRateLimits,
  userId: number,
  email: string,
): Promise<RateLimitDecision> {
  const byUser = await rateLimits.emailChangeByUser(userId)
  return byUser.allowed ? await rateLimits.emailChangeByAddress(email) : byUser
}

/** The answer when groups stop the account from being deleted. */
export const ACCOUNT_DELETE_BLOCKED =
  "You own groups other people still use or pay for. Deal with them first."

/**
 * The answer for a session that cannot be ended from the devices list: another person's, one that
 * does not exist or already ended, and a malformed id alike, so the answer tells nothing.
 */
export const SESSION_NOT_FOUND = "This session has already ended."

/** The answer when the devices list is asked to end the request's own session. */
export const SESSION_IS_CURRENT = "This is the device you are using. Sign out instead."

/** A session id as the devices list sends it: a positive integer without leading zeros. */
const SESSION_ID = /^[1-9][0-9]{0,9}$/

/** The largest id `auth_sessions.id` (a Postgres `integer`) can hold. */
const MAX_SESSION_ID = 2_147_483_647

/** The answer when the account has two-factor on and the request carries no code. */
export const ACCOUNT_DELETE_CODE_REQUIRED = "Enter the code from your authenticator app"

/** Sets `Retry-After` and answers 429 with `error`. */
function tooMany(c: Context<APIContext>, retryAfterMs: number, error: string): Response {
  c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
  return c.json({ error }, 429)
}

/**
 * Runs one one-time-code check under the failure counter. While the user is locked the check does
 * not run at all, so not even a correct code gets through, and the answer is 429 with
 * `Retry-After`. A wrong code is recorded, a correct one gives its slot back.
 */
async function checkUnderFailureCount(
  c: Context<APIContext>,
  totpFailures: Lockout,
  userId: number,
  check: () => Promise<boolean>,
  wrongAnswer: () => Response,
): Promise<Response | true> {
  const waitMs = await totpFailures.begin(userId)
  if (waitMs > 0) {
    c.header("Retry-After", String(Math.ceil(waitMs / 1000)))
    return c.json({ error: "Too many wrong codes, try again later." }, 429)
  }
  if (!(await check())) {
    await totpFailures.fail(userId)
    return wrongAnswer()
  }
  await totpFailures.refund(userId)
  return true
}

/**
 * The body of a sign-in answer. A session that still owes its one-time code gets 202 and only
 * `{ secondFactor: "Pending" }`: the profile stays behind the second factor, like `/users/me`.
 */
function signInAnswer(
  c: Context<APIContext>,
  { user, session }: { user: User; session: { secondFactor: SecondFactorStatus } },
) {
  if (session.secondFactor === SecondFactorStatus.Pending) {
    return c.json({ secondFactor: "Pending" }, 202)
  }
  return c.json(user, 200)
}

export function createAuthRoute(
  {
    signIn,
    emit,
    mutationGuards,
    rateLimits,
    totpFailures,
    requestPasswordReset,
    emailCodeFailures,
    requestEmailCode,
    logError,
  }: AuthRouteDependencies,
): Hono<APIContext> {
  const { isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
  /** Announces that sessions of `userId` ended, so the realtime hub closes their sockets. */
  const emitSignOut = (c: Context<APIContext>, userId: number) =>
    emit(
      new UserSignedOutEvent({
        userId,
        // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
        request: requestInfoFromContext(c, { trustedProxy: true }),
      }),
    )
  return new Hono<APIContext>()
    .post(`/sign-out`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      const authData = c.get("auth")
      await signIn.signOut(c)
      if (authData) {
        emit(
          new UserSignedOutEvent({
            userId: authData.user.id,
            // trustedProxy: true keeps the old behaviour of trusting X-Forwarded-For / X-Real-IP.
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
      }
      return c.json({ success: true })
    })
    .get(`/me`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      // 202, like `password/check`: the session still owes its second factor. A reloaded page
      // learns that here, since it has no memory of the sign-in response.
      return signInAnswer(c, authData)
    })
    .post(`password/check`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { login, password } = validationResult.data
      const signedIn = await signIn.signIn(c, login, password)
      if (!signedIn) {
        return c.json({ error: "Invalid e-mail, username or password" }, 401)
      }
      return signInAnswer(c, signedIn)
    })
    .post(`/password/sign-up`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignUpSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return c.json({ error: "Enter a valid e-mail address" }, 400)
      }
      const signedUp = await signIn.signUp(c, email, validationResult.data.password)
      if (!signedUp) {
        // Sign-up necessarily tells that an address is taken; "Forgot password" is the way in.
        return c.json({ error: "This e-mail address cannot be used to sign up" }, 401)
      }
      try {
        await requestEmailCode(signedUp.user.id, email)
      } catch (error) {
        // The account exists and the cookie is set; the banner offers a new code.
        logError("error: the code mail after a sign-up was not queued", error)
      }
      return signInAnswer(c, signedUp)
    })
    .post(`/password/forgot`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordForgotSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return c.json({ error: "Enter a valid e-mail address" }, 400)
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account.
      const decision = await rateLimits.resetByAddress(email)
      if (!decision.allowed) {
        c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)))
        return c.json({ error: "Too many reset links for this address, try again later." }, 429)
      }
      await requestPasswordReset(email)
      return c.json(PASSWORD_RESET_REQUESTED)
    })
    .post(`/password/reset`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordResetSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { email, code, newPassword } = validationResult.data
      if (!(await signIn.resetPassword(email, code, newPassword))) {
        return c.json({ error: PASSWORD_RESET_REFUSED }, 400)
      }
      return c.json({ success: true })
    })
    .use(isAuthenticated1FA)
    .use(mutationGuards.signedIn)
    .post(`/totp/check`, rateLimits.otpByUser, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return c.json({ error: "User not signed in" }, 401)
      }
      const body = await readApiJson(c)
      try {
        const validationResult = validate(authOTPSchema, body)
        if (validationResult.error) {
          return c.json({ error: validationResult.error.description }, 400)
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.checkTotp(c, authData, validationResult.data.otp),
          () => c.json({ error: "Invalid token" }, 401),
        )
        return outcome === true ? c.json(authData.user) : outcome
      } catch (_error) {
        return c.json({ error: "Invalid request format" }, 400)
      }
    })
    .post(`/totp/connect/start`, rateLimits.normal, async (c) => {
      const { error, qrcode, secret } = await signIn.connectTotpStart(c.get("auth")!)
      if (error) {
        return c.json({ error }, 400)
      }
      return c.json({ qrcode, secret })
    })
    .post(`/totp/connect/finish`, rateLimits.otpByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authOTPSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const authData = c.get("auth")!
      const outcome = await checkUnderFailureCount(
        c,
        totpFailures,
        authData.user.id,
        () => signIn.connectTotpFinish(authData, validationResult.data.otp),
        () => c.json({ error: "Code is incorrect" }, 400),
      )
      return outcome === true ? c.json({ success: true }) : outcome
    })
    .use(isAuthenticated2FA)
    .post(`/totp/disconnect`, rateLimits.normal, async (c) => {
      const isSuccess = await signIn.disconnectTotp(c.get("auth")!)
      if (!isSuccess) {
        return c.json({ error: "OTP already disabled for your account" }, 400)
      }
      return c.json({ success: true })
    })
    .get(`/email`, rateLimits.normal, async (c) => {
      return c.json(await signIn.emailStatus(c.get("auth")!))
    })
    // The normal limit, and an hourly mail budget: the account's own address spends its own, an
    // address the account wants to move to spends the change budgets, as `/email/change` does.
    .post(`/email/send`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const status = await signIn.emailStatus(authData)
      const email = emailToVerify(status)
      if (email === null) return c.json({ error: EMAIL_NOTHING_TO_VERIFY }, 400)
      if (status.pending !== null) {
        const decision = await spendChangeMail(rateLimits, authData.user.id, email)
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, EMAIL_CHANGE_TOO_MANY)
      } else {
        const decision = await rateLimits.emailCodeByAddress(email)
        if (!decision.allowed) {
          return tooMany(
            c,
            decision.retryAfterMs,
            "Too many codes for this address, try again later.",
          )
        }
      }
      await requestEmailCode(authData.user.id, email)
      return c.json({ success: true, message: `A new code is on its way to ${email}.` })
    })
    .post(`/email/verify`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authEmailCodeSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const authData = c.get("auth")!
      const waitMs = await emailCodeFailures.begin(authData.user.id)
      if (waitMs > 0) return tooMany(c, waitMs, "Too many wrong codes, try again later.")
      const outcome = await signIn.verifyEmail(c, authData, validationResult.data.code)
      if (outcome === EmailVerifyOutcome.WrongCode) {
        await emailCodeFailures.fail(authData.user.id)
        return c.json({ error: EMAIL_CODE_REFUSED }, 400)
      }
      await emailCodeFailures.refund(authData.user.id)
      if (outcome === EmailVerifyOutcome.Taken) return c.json({ error: EMAIL_TAKEN }, 409)
      if (outcome === EmailVerifyOutcome.NothingToVerify) {
        return c.json({ error: EMAIL_NOTHING_TO_VERIFY }, 400)
      }
      return c.json({ success: true })
    })
    .post(`/email/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authEmailChangeSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const authData = c.get("auth")!
      const { email: rawEmail, password } = validationResult.data
      const email = normalizeEmail(rawEmail)
      if (email === null) return c.json({ error: "Enter a valid e-mail address" }, 400)
      const outcome = await signIn.requestEmailChange(authData, password, email)
      if (outcome === EmailChangeOutcome.WrongPassword) {
        return c.json({ error: "Invalid password" }, 400)
      }
      if (outcome === EmailChangeOutcome.InvalidEmail) {
        return c.json({ error: "Enter a valid e-mail address" }, 400)
      }
      if (outcome === EmailChangeOutcome.Kept) {
        return c.json({ success: true, message: "Your address stays as it is." })
      }
      // The change waits either way; a refused mail is asked for again later with /email/send.
      const decision = await spendChangeMail(rateLimits, authData.user.id, email)
      if (!decision.allowed) return tooMany(c, decision.retryAfterMs, EMAIL_CHANGE_TOO_MANY)
      await requestEmailCode(authData.user.id, email)
      return c.json({
        success: true,
        message: `A code is on its way to ${email}. Your address changes once you enter it.`,
      })
    })
    .post(`/password/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordChangeSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const { password, newPassword, signOutOthers = true } = validationResult.data
      const authData = c.get("auth")!
      const changed = await signIn.changePassword(
        c,
        authData,
        password,
        newPassword,
        signOutOthers,
      )
      if (!changed) {
        return c.json({ error: "Invalid password" }, 400)
      }
      // The other devices' sockets close now rather than at the next periodic check.
      if (signOutOthers) emitSignOut(c, authData.user.id)
      // How many API tokens the change revoked, so the page can say so.
      return c.json({ success: true, revokedTokens: changed.revokedTokens })
    })
    .get(`/sessions`, rateLimits.normal, async (c) => {
      return c.json({ sessions: await signIn.listSessions(c.get("auth")!) })
    })
    // Before `/sessions/:id`, which would otherwise take "others" as an id.
    .delete(`/sessions/others`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const ended = await signIn.endOtherSessions(c, authData)
      if (ended > 0) emitSignOut(c, authData.user.id)
      return c.json({ success: true, ended })
    })
    .delete(`/sessions/:id`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")!
      const raw = c.req.param("id")
      const sessionId = SESSION_ID.test(raw) ? Number(raw) : 0
      if (sessionId < 1 || sessionId > MAX_SESSION_ID) {
        return c.json({ error: SESSION_NOT_FOUND }, 404)
      }
      if (sessionId === authData.session.id) return c.json({ error: SESSION_IS_CURRENT }, 400)
      if (!(await signIn.endSession(c, authData, sessionId))) {
        return c.json({ error: SESSION_NOT_FOUND }, 404)
      }
      emitSignOut(c, authData.user.id)
      return c.json({ success: true })
    })
    .get(`/account/deletion`, rateLimits.normal, async (c) => {
      return c.json({ blockers: await signIn.accountDeletionBlockers(c.get("auth")!) })
    })
    // Asks again for what a stolen session lacks: the password, and the authenticator code when
    // two-factor is on, as the sign-in does. Groups that stop it are named before anything is
    // checked, so the person learns what to do first without typing the password in vain.
    .post(`/account/delete`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(accountDeleteSchema, body)
      if (validationResult.error) {
        return c.json({ error: validationResult.error.description }, 400)
      }
      const authData = c.get("auth")!
      const { password, otp } = validationResult.data
      const blockers = await signIn.accountDeletionBlockers(authData)
      if (blockers.length > 0) return c.json({ error: ACCOUNT_DELETE_BLOCKED, blockers }, 409)
      if (!(await signIn.checkPassword(authData.user.id, password))) {
        return c.json({ error: "Invalid password" }, 400)
      }
      if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
        if (otp === undefined) return c.json({ error: ACCOUNT_DELETE_CODE_REQUIRED }, 400)
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => c.json({ error: "Code is incorrect" }, 400),
        )
        if (outcome !== true) return outcome
      }
      const result = await signIn.deleteAccount(c, authData)
      if (result.blockers) {
        if (result.blockers.length === 0) return c.json({ error: "User not signed in" }, 401)
        return c.json({ error: ACCOUNT_DELETE_BLOCKED, blockers: result.blockers }, 409)
      }
      emit(
        new UserSignedOutEvent({
          userId: authData.user.id,
          request: requestInfoFromContext(c, { trustedProxy: true }),
        }),
      )
      return c.json({ success: true, deleteAfter: result.deleteAfter.toISOString() })
    })
}
