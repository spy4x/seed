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
  authPasswordSetSchema,
  authSignInLinkRedeemSchema,
  authSignInLinkSchema,
  authSignInSchema,
  authSignUpSchema,
  authTotpDisconnectSchema,
  emailToVerify,
  SIGN_IN_LINK_ASKED_ELSEWHERE_CODE,
  type SignInLinkRedeemed,
  signInMethodProofSchema,
  type SignUpAccountExistsResponse,
  type SignUpGuestTakenResponse,
  type User,
  UserMFAStatus,
  type WaitingPasswordSignUpResponse,
} from "@domain/identity"
import {
  EmailChangeOutcome,
  EmailVerifyOutcome,
  PasswordSetOutcome,
  type SignIn,
  SignInLinkOutcome,
  SignUpOutcome,
} from "@api/services/sign-in.ts"
import { pageOrNull } from "@api/services/oauth-sign-in.ts"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { Lockout } from "@spy4x/server/lockout"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import type { RateLimitDecision } from "@spy4x/platform/rate-limit"
import { readApiJson } from "@api/services/json-body.ts"
import { passwordFailureSubject } from "@api/services/password-failures.ts"
import { PasswordLockedError, passwordLockedMessage } from "@api/services/password-locked.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  /** Without the provider sign-in: `auth-oauth.ts` has those routes. */
  signIn: Omit<SignIn, "oauth" | "passkeys" | "guests">
  /** Announces a sign-out, so the person's open sockets close. Audit rows are not events (#191). */
  emit(event: UserSignedOutEvent): void
  mutationGuards: MutationGuards
  rateLimits: AuthRateLimits
  /** Persistent count of wrong one-time codes per user, with a growing lock. */
  totpFailures: Lockout
  /**
   * Persistent count of wrong passwords per sign-in name, from every network address together,
   * with a short lock (`services/password-failures.ts`).
   */
  passwordFailures: Lockout
  /**
   * Queues a reset link for a normalised address. The worker sends it only when an account signs
   * in with the address, so this call does the same work either way.
   */
  requestPasswordReset(email: string): Promise<void>
  /**
   * Queues a sign-in link for a normalised address, with the checked page to open after sign-in
   * (#391). The same work for every address: the link decides what happens once it is opened.
   * `requestedBy` is the guest account that asks, else `null`: a guest uses only a link it asked for.
   */
  requestSignInLink(email: string, next: string | null, requestedBy: number | null): Promise<void>
  /** Persistent count of wrong e-mail codes per user, with a growing lock. */
  emailCodeFailures: Lockout
  /** Queues a mail with a new code for `email`, the address the user's account must prove. */
  requestEmailCode(userId: number, email: string): Promise<void>
}

/** The answer to a reset request that was accepted, whether or not the address has an account. */
export const PASSWORD_RESET_REQUESTED = {
  success: true,
  message: "If an account uses this address, a link to reset its password is on its way.",
}

/**
 * The answer to a sign-up that was accepted: a code is on its way to the address. The same for
 * every address, whether or not an account uses it (#142).
 */
export const SIGN_UP_REQUESTED = { success: true }

/** The answer when no sign-up waits for a code: it took too long, or its code was guessed at. */
export const SIGN_UP_EXPIRED = "This sign-up expired. Start again."

/** The answer when the address's code budget is spent; the same for every address. */
export const SIGN_UP_CODES_TOO_MANY = "Too many codes for this address, try again later."

/** The answer to a link request that was accepted: the same for every address (#391). */
export const SIGN_IN_LINK_REQUESTED = { success: true }

/** The answer to an address `normalizeEmail` refuses, on the link request. */
export const SIGN_IN_LINK_BAD_ADDRESS = "Enter an e-mail address, such as name@example.com."

/** The answer when the address's link budget is spent; the same for every address. */
export function signInLinksTooMany(retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / 60_000))
  return `Too many links were asked for this address. Try again in ${minutes} ${
    minutes === 1 ? "minute" : "minutes"
  }.`
}

/** The answer to a link that is unknown, expired or used: one answer for all. */
export const SIGN_IN_LINK_REFUSED = "This link no longer works."

/**
 * The answer when an account signs in with the link's address by password but never confirmed
 * it: the link proved the mailbox, not that account. Told only to whoever holds the mailbox.
 */
export const SIGN_IN_LINK_UNCONFIRMED =
  "An account uses this address but never confirmed it. Reset its password to sign in."

/**
 * The answer to a guest who opens a link another browser asked for, with the code
 * `SIGN_IN_LINK_ASKED_ELSEWHERE_CODE`: the link is spent, and the guest stays signed in as before.
 */
export const SIGN_IN_LINK_ASKED_ELSEWHERE =
  "This link was asked for in another browser. Ask for a new one in this browser."

/** The answer to a reset link that cannot be used. */
export const PASSWORD_RESET_REFUSED = "This link is invalid, used or expired. Ask for a new one."

/** The answer to an e-mail code that cannot be used: wrong, expired or used up alike. */
export const EMAIL_CODE_REFUSED = "This code is wrong or has expired. Ask for a new one."

/**
 * The answer when an account with no password asks to move to an address another of its sign-in
 * methods carries: the change would change nothing.
 */
export const EMAIL_ALREADY_CARRIED =
  "Your account already has this address through another sign-in method."

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

/** The same answer for a first password: with two-factor on, it needs the code too. */
export const PASSWORD_SET_CODE_REQUIRED = ACCOUNT_DELETE_CODE_REQUIRED

/**
 * The answer when an account with no password asks for a step that the others confirm with their
 * password, and its session is no sign-in with Google or GitHub of a moment ago.
 */
export const PROVIDER_PROOF_REQUIRED =
  "Sign in with Google or GitHub again, then repeat this within a few minutes."

/** The answer when a first password is asked for by an account that has one. */
export const PASSWORD_ALREADY_SET = "This account has a password already. Change it instead."

/** The answer when a first password is asked for by an account with no address to sign in with. */
export const PASSWORD_NEEDS_ADDRESS = "Add an e-mail address first: you sign in with it."

/** The answer when a first password cannot be stored. */
export const PASSWORD_SET_REFUSED = "This password cannot be set. Try another one."

/** The answer when turning two-factor off is asked for with neither a password nor a code. */
export const TOTP_DISCONNECT_PROOF_REQUIRED =
  "Enter your password or the code from your authenticator app"

/** Sets `Retry-After` and answers 429 with `error`. */
function tooMany(c: Context<APIContext>, retryAfterMs: number, error: string): Response {
  c.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)))
  return errorResponse(c, `rate_limited`, { message: error })
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
    return errorResponse(c, `rate_limited`, { message: "Too many wrong codes, try again later." })
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
    passwordFailures,
    requestPasswordReset,
    requestSignInLink,
    emailCodeFailures,
    requestEmailCode,
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
    // A password check of a signed-in step while the account is locked (#406). Every other error
    // goes on to the app's handler.
    .onError((error, c) => {
      if (!(error instanceof PasswordLockedError)) throw error
      return tooMany(c, error.retryAfterMs, passwordLockedMessage(error.retryAfterMs))
    })
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
        return errorResponse(c, `unauthorized`, { message: "User not signed in" })
      }
      // 202, like `password/check`: the session still owes its second factor. A reloaded page
      // learns that here, since it has no memory of the sign-in response.
      return signInAnswer(c, authData)
    })
    .post(`password/check`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { login, password } = validationResult.data
      // Counted per name and before the password is looked at, whatever address the request comes
      // from and whether or not an account uses the name. While the name is locked not even the
      // right password is checked.
      const subject = await passwordFailureSubject(login)
      const waitMs = await passwordFailures.begin(subject)
      if (waitMs > 0) return tooMany(c, waitMs, passwordLockedMessage(waitMs))
      const signedIn = await signIn.signIn(c, login, password)
      if (!signedIn) {
        await passwordFailures.fail(subject)
        return errorResponse(c, `unauthorized`, { message: "Invalid e-mail, username or password" })
      }
      await passwordFailures.refund(subject)
      return signInAnswer(c, signedIn)
    })
    // Proves the address before anything is created (#142). The same work and the same answer
    // for every well-formed address: nothing here asks whether an account uses it, so neither the
    // answer nor its timing tells a stranger which addresses have accounts.
    .post(`/password/sign-up`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignUpSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account. The
      // sign-up budgets, not the account's own: a stranger's sign-ups must not lock its owner out.
      const decision = await rateLimits.signUpCode(c, email)
      if (!decision.allowed) return tooMany(c, decision.retryAfterMs, SIGN_UP_CODES_TOO_MANY)
      // A guest's sign-up keeps the guest account instead of making a new one (#224).
      const state = c.get("auth")
      const guestUserId = state?.user.guestSince ? state.user.id : null
      if (!(await signIn.requestSignUp(c, email, validationResult.data.password, guestUserId))) {
        return errorResponse(c, `bad_request`, {
          message: "This password cannot be used. Try another one.",
        })
      }
      return c.json(SIGN_UP_REQUESTED)
    })
    .get(`/password/sign-up`, rateLimits.normal, async (c) => {
      const waiting = await signIn.waitingSignUp(c)
      const answer: WaitingPasswordSignUpResponse = {
        pending: waiting && { email: waiting.email, expiresAt: waiting.expiresAt.toISOString() },
      }
      return c.json(answer)
    })
    .post(
      `/password/sign-up/verify`,
      mutationGuards.anonymous,
      rateLimits.strictByIp,
      async (c) => {
        const body = await readApiJson(c)
        const validationResult = validate(authEmailCodeSchema, body)
        if (validationResult.error) {
          return validationResponse(c, validationResult.error.details)
        }
        const result = await signIn.completeSignUp(c, validationResult.data.code)
        switch (result.outcome) {
          case SignUpOutcome.Created:
          case SignUpOutcome.GuestKept:
            return signInAnswer(c, result.signedIn)
          case SignUpOutcome.GuestTaken: {
            const answer: SignUpGuestTakenResponse = { guestTaken: true }
            return c.json(answer)
          }
          case SignUpOutcome.AccountExists: {
            const { password, providers } = result.account
            const answer: SignUpAccountExistsResponse = {
              accountExists: { email: result.email, password, providers },
            }
            return c.json(answer)
          }
          case SignUpOutcome.WrongCode:
            return errorResponse(c, `bad_request`, { message: EMAIL_CODE_REFUSED })
          case SignUpOutcome.Expired:
            return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
      },
    )
    // The normal limit: the address's sign-up code budgets are what stop a flood of mails.
    .post(
      `/password/sign-up/resend`,
      mutationGuards.anonymous,
      rateLimits.normal,
      async (c) => {
        const waiting = await signIn.waitingSignUp(c)
        if (waiting === null) {
          return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
        const decision = await rateLimits.signUpCode(c, waiting.email)
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, SIGN_UP_CODES_TOO_MANY)
        if (!(await signIn.resendSignUpCode(c))) {
          return errorResponse(c, `not_found`, { message: SIGN_UP_EXPIRED, status: 410 })
        }
        return c.json({ success: true })
      },
    )
    .post(`/password/sign-up/cancel`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      await signIn.cancelSignUp(c)
      return c.json({ success: true })
    })
    .post(`/password/forgot`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordForgotSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      // Spent for every address, known or not, so a refusal tells nothing about an account.
      const decision = await rateLimits.resetByAddress(email)
      if (!decision.allowed) {
        c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)))
        return errorResponse(c, `rate_limited`, {
          message: "Too many reset links for this address, try again later.",
        })
      }
      await requestPasswordReset(email)
      return c.json(PASSWORD_RESET_REQUESTED)
    })
    // Sign-in and sign-up by e-mail link (#391). The same work and answer for every well-formed
    // address, as for a sign-up: whether an account uses it is decided only when the link is used.
    .post(`/link`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInLinkSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const email = normalizeEmail(validationResult.data.email)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: SIGN_IN_LINK_BAD_ADDRESS })
      }
      // Spent for every address, known or not; a stranger spends only their own share.
      const decision = await rateLimits.signInLink(c, email)
      if (!decision.allowed) {
        return tooMany(c, decision.retryAfterMs, signInLinksTooMany(decision.retryAfterMs))
      }
      const asker = c.get("auth")?.user
      await requestSignInLink(
        email,
        pageOrNull(validationResult.data.next),
        asker?.guestSince ? asker.id : null,
      )
      return c.json(SIGN_IN_LINK_REQUESTED)
    })
    // A POST the link page sends when the person presses Continue: opening the link spends nothing,
    // so a mail scanner that follows it leaves it working.
    .post(`/link/redeem`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInLinkRedeemSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const result = await signIn.redeemSignInLink(c, validationResult.data.token)
      switch (result.outcome) {
        case SignInLinkOutcome.SignedIn:
        case SignInLinkOutcome.Created:
        case SignInLinkOutcome.GuestKept: {
          const answer: SignInLinkRedeemed = {
            email: result.email,
            next: pageOrNull(result.next),
            created: result.outcome !== SignInLinkOutcome.SignedIn,
            secondFactorPending:
              result.signedIn.session.secondFactor === SecondFactorStatus.Pending,
          }
          return c.json(answer)
        }
        case SignInLinkOutcome.GuestTaken: {
          const answer: SignUpGuestTakenResponse = { guestTaken: true }
          return c.json(answer)
        }
        case SignInLinkOutcome.Unconfirmed:
          return errorResponse(c, `conflict`, { message: SIGN_IN_LINK_UNCONFIRMED })
        case SignInLinkOutcome.Refused:
          return errorResponse(c, `not_found`, { message: SIGN_IN_LINK_REFUSED, status: 410 })
        case SignInLinkOutcome.AskedElsewhere:
          return errorResponse(c, `forbidden`, {
            message: SIGN_IN_LINK_ASKED_ELSEWHERE,
            reason: SIGN_IN_LINK_ASKED_ELSEWHERE_CODE,
          })
      }
    })
    .post(`/password/reset`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordResetSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { email, code, newPassword } = validationResult.data
      if (!(await signIn.resetPassword(email, code, newPassword, c))) {
        return errorResponse(c, `bad_request`, { message: PASSWORD_RESET_REFUSED })
      }
      return c.json({ success: true })
    })
    .use(isAuthenticated1FA)
    .use(mutationGuards.signedIn)
    .post(`/totp/check`, rateLimits.otpByUser, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return errorResponse(c, `unauthorized`, { message: "User not signed in" })
      }
      const body = await readApiJson(c)
      try {
        const validationResult = validate(authOTPSchema, body)
        if (validationResult.error) {
          return validationResponse(c, validationResult.error.details)
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.checkTotp(c, authData, validationResult.data.otp),
          () => errorResponse(c, `unauthorized`, { message: "Invalid token" }),
        )
        return outcome === true ? c.json(authData.user) : outcome
      } catch (_error) {
        return errorResponse(c, `bad_request`, { message: "Invalid request format" })
      }
    })
    // Asks for what the deletion asks (#406): the password, or for an account without one a
    // sign-in with Google or GitHub a moment ago. Finishing the set-up signs every other session
    // out, so a session left open must not be able to lock its owner out with an app of its own.
    .post(`/totp/connect/start`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(signInMethodProofSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password } = validationResult.data
      if (await signIn.hasPassword(authData.user.id)) {
        if (
          password === undefined || !(await signIn.checkPassword(authData.user.id, password))
        ) {
          return errorResponse(c, `bad_request`, { message: "Invalid password" })
        }
      } else if (!(await signIn.confirmedByProvider(authData))) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      const { error, qrcode, secret } = await signIn.connectTotpStart(authData)
      if (error) {
        return errorResponse(c, `bad_request`, { message: error })
      }
      return c.json({ qrcode, secret })
    })
    .post(`/totp/connect/finish`, rateLimits.otpByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authOTPSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const outcome = await checkUnderFailureCount(
        c,
        totpFailures,
        authData.user.id,
        () => signIn.connectTotpFinish(authData, validationResult.data.otp),
        () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
      )
      return outcome === true ? c.json({ success: true }) : outcome
    })
    .use(isAuthenticated2FA)
    // Asks again for what a session left open on a shared machine lacks: the password, or a
    // current authenticator code. An account with no password proves itself with the code.
    .post(`/totp/disconnect`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authTotpDisconnectSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password, otp } = validationResult.data
      if (otp !== undefined) {
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (outcome !== true) return outcome
      } else if (password === undefined) {
        return errorResponse(c, `bad_request`, { message: TOTP_DISCONNECT_PROOF_REQUIRED })
      } else if (!(await signIn.checkPassword(authData.user.id, password))) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      const isSuccess = await signIn.disconnectTotp(authData)
      if (!isSuccess) {
        return errorResponse(c, `bad_request`, { message: "OTP already disabled for your account" })
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
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: EMAIL_NOTHING_TO_VERIFY })
      }
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
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const waitMs = await emailCodeFailures.begin(authData.user.id)
      if (waitMs > 0) return tooMany(c, waitMs, "Too many wrong codes, try again later.")
      const outcome = await signIn.verifyEmail(c, authData, validationResult.data.code)
      if (outcome === EmailVerifyOutcome.WrongCode) {
        await emailCodeFailures.fail(authData.user.id)
        return errorResponse(c, `bad_request`, { message: EMAIL_CODE_REFUSED })
      }
      await emailCodeFailures.refund(authData.user.id)
      if (outcome === EmailVerifyOutcome.Taken) {
        return errorResponse(c, `conflict`, { message: EMAIL_TAKEN })
      }
      if (outcome === EmailVerifyOutcome.NothingToVerify) {
        return errorResponse(c, `bad_request`, { message: EMAIL_NOTHING_TO_VERIFY })
      }
      // A new address signed the other devices out (#406): their sockets close now. Proving the
      // address the account has ends none, and the hub then finds nothing to close.
      emitSignOut(c, authData.user.id)
      return c.json({ success: true })
    })
    .post(`/email/change`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authEmailChangeSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { email: rawEmail, password } = validationResult.data
      const email = normalizeEmail(rawEmail)
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      const outcome = await signIn.requestEmailChange(authData, password, email)
      if (outcome === EmailChangeOutcome.WrongPassword) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      if (outcome === EmailChangeOutcome.ProofRequired) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      if (outcome === EmailChangeOutcome.InvalidEmail) {
        return errorResponse(c, `bad_request`, { message: "Enter a valid e-mail address" })
      }
      if (outcome === EmailChangeOutcome.AlreadyCarried) {
        return errorResponse(c, `bad_request`, { message: EMAIL_ALREADY_CARRIED })
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
        return validationResponse(c, validationResult.error.details)
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
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
      // The other devices' sockets close now rather than at the next periodic check.
      if (signOutOthers) emitSignOut(c, authData.user.id)
      // How many API tokens the change revoked, so the page can say so.
      return c.json({ success: true, revokedTokens: changed.revokedTokens })
    })
    // The first password of an account made with Google or GitHub. There is no password to ask
    // for, so the session itself must be a provider sign-in of a moment ago.
    .post(`/password/set`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authPasswordSetSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { newPassword, otp } = validationResult.data
      // With two-factor on, the code is asked as the deletion asks it: the new password is
      // accepted as proof to turn two-factor off, so it must not cost less than the code.
      if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
        if (otp === undefined) {
          return errorResponse(c, `bad_request`, { message: PASSWORD_SET_CODE_REQUIRED })
        }
        // The cheap refusals first, so a code is not spent on a request that sets nothing.
        if (await signIn.hasPassword(authData.user.id)) {
          return errorResponse(c, `bad_request`, { message: PASSWORD_ALREADY_SET })
        }
        if (!(await signIn.confirmedByProvider(authData))) {
          return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
        }
        const checked = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (checked !== true) return checked
      }
      const outcome = await signIn.setPassword(c, authData, newPassword)
      if (outcome === PasswordSetOutcome.Set) {
        // The other devices were signed out (#406): their sockets close now.
        emitSignOut(c, authData.user.id)
        return c.json({ success: true })
      }
      const refusals = {
        [PasswordSetOutcome.AlreadySet]: PASSWORD_ALREADY_SET,
        [PasswordSetOutcome.ProofRequired]: PROVIDER_PROOF_REQUIRED,
        [PasswordSetOutcome.NoAddress]: PASSWORD_NEEDS_ADDRESS,
        [PasswordSetOutcome.Refused]: PASSWORD_SET_REFUSED,
      }
      return errorResponse(c, `bad_request`, { message: refusals[outcome] })
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
        return errorResponse(c, `not_found`, { message: SESSION_NOT_FOUND })
      }
      if (sessionId === authData.session.id) {
        return errorResponse(c, `bad_request`, { message: SESSION_IS_CURRENT })
      }
      if (!(await signIn.endSession(c, authData, sessionId))) {
        return errorResponse(c, `not_found`, { message: SESSION_NOT_FOUND })
      }
      emitSignOut(c, authData.user.id)
      return c.json({ success: true })
    })
    .get(`/account/deletion`, rateLimits.normal, async (c) => {
      return c.json({ blockers: await signIn.accountDeletionBlockers(c.get("auth")!) })
    })
    // Asks again for what a stolen session lacks: the password, and the authenticator code when
    // two-factor is on, as the sign-in does. An account with no password has signed in with
    // Google or GitHub a moment ago instead (#384). Groups that stop it are named before anything is
    // checked, so the person learns what to do first without typing the password in vain.
    .post(`/account/delete`, rateLimits.strictByUser, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(accountDeleteSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const authData = c.get("auth")!
      const { password, otp } = validationResult.data
      const blockers = await signIn.accountDeletionBlockers(authData)
      if (blockers.length > 0) {
        return errorResponse(c, `conflict`, {
          message: ACCOUNT_DELETE_BLOCKED,
          details: { blockers },
        })
      }
      if (await signIn.hasPassword(authData.user.id)) {
        if (
          password === undefined || !(await signIn.checkPassword(authData.user.id, password))
        ) {
          return errorResponse(c, `bad_request`, { message: "Invalid password" })
        }
      } else if (!(await signIn.confirmedByProvider(authData))) {
        return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
      }
      if (authData.user.mfa === UserMFAStatus.CONFIGURED) {
        if (otp === undefined) {
          return errorResponse(c, `bad_request`, { message: ACCOUNT_DELETE_CODE_REQUIRED })
        }
        const outcome = await checkUnderFailureCount(
          c,
          totpFailures,
          authData.user.id,
          () => signIn.verifyTotpCode(authData, otp),
          () => errorResponse(c, `bad_request`, { message: "Code is incorrect" }),
        )
        if (outcome !== true) return outcome
      }
      const result = await signIn.deleteAccount(c, authData)
      if (result.blockers) {
        if (result.blockers.length === 0) {
          return errorResponse(c, `unauthorized`, { message: "User not signed in" })
        }
        return errorResponse(c, `conflict`, {
          message: ACCOUNT_DELETE_BLOCKED,
          details: { blockers: result.blockers },
        })
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
