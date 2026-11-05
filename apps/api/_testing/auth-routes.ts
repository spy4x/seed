/**
 * The fakes and request helpers the auth route tests share: a fake sign-in that records its
 * calls, the app built over it, and the route lists the cross-cutting tests walk.
 *
 * @module
 */
import type { APIContext } from "../_types.ts"
import type { SignedIn, SignIn } from "../services/sign-in.ts"
import { EmailChangeOutcome, EmailVerifyOutcome } from "../services/email-change.ts"
import { PasswordResetOutcome } from "../services/password-reset.ts"
import { PasswordSetOutcome } from "../services/password.ts"
import { SignInCodeOutcome } from "../services/sign-in-codes.ts"
import { SignUpOutcome } from "../services/sign-up.ts"
import type { EmailStatus, SignedInDevice } from "@domain/identity"
import type { UserSignedOutEvent } from "../cqrs/events.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "./fake-auth.ts"
import {
  API_URL,
  mountRoute,
  type MutationCase,
  testMutationGuards,
  testSessionGuards,
} from "./mutation-requests.ts"
import { type AuthRateLimits, createAuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import type { Lockout } from "@spy4x/server/lockout"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { createAuthRoute } from "../routes/auth.ts"

/** When the fake sign-in's waiting sign-up stops working. */
export const WAITING_UNTIL = new Date("2026-10-17T10:10:00.000Z")

/** When the fake sign-in says a deleted account goes for good. */
export const DELETE_AFTER = new Date("2026-10-11T08:00:00.000Z")

/** The device of the fake session (id 1), and another device of the same person. */
export const CURRENT_DEVICE: SignedInDevice = {
  id: 1,
  deviceName: "Firefox on Linux",
  ipHint: "203.0.113.*",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: "2026-10-04T08:00:00.000Z",
  current: true,
}
export const OTHER_DEVICE: SignedInDevice = {
  ...CURRENT_DEVICE,
  id: 2,
  deviceName: "Safari on iPhone",
  current: false,
}

/** An address the user still has to prove, and one already proven. */
export const UNPROVEN: EmailStatus = { email: "alice@example.com", proven: false, pending: null }
export const PROVEN: EmailStatus = { email: "alice@example.com", proven: true, pending: null }

/**
 * A failure counter that records its calls in `calls`, and answers `lockedForMs` to `begin`
 * (0 = not locked).
 */
export function fakeTotpFailures(calls: string[], lockedForMs = 0): Lockout {
  return {
    begin: () => (calls.push("begin"), Promise.resolve(lockedForMs)),
    refund: () => (calls.push("refund"), Promise.resolve()),
    fail: () => (calls.push("fail"), Promise.resolve()),
  }
}

/**
 * A sign-in whose operations only record that the route called them. With `succeed: false`, every
 * check of a password or a one-time code fails.
 */
export function fakeSignIn(
  calls: string[],
  succeed = true,
  secondFactor = SecondFactorStatus.NotRequired,
  logins: string[] = [],
): Omit<SignIn, "oauth" | "passkeys" | "guests"> {
  const signedIn = (): Promise<SignedIn> => {
    const { user, session } = buildAuthData({ session: { secondFactor } })
    return Promise.resolve({ user, session })
  }
  return {
    auth: testSessionGuards(),
    signUp: (_c, email) => (
      calls.push("signUp"), logins.push(email), succeed ? signedIn() : Promise.resolve(null)
    ),
    // Without success the hasher refuses the password, and the code is wrong.
    requestSignUp: (_c, email) => (
      calls.push("requestSignUp"), logins.push(email), Promise.resolve(succeed)
    ),
    waitingSignUp: () => Promise.resolve({ email: "alice@example.com", expiresAt: WAITING_UNTIL }),
    resendSignUpCode: () => (calls.push("resendSignUpCode"), Promise.resolve(succeed)),
    cancelSignUp: () => (calls.push("cancelSignUp"), Promise.resolve()),
    completeSignUp: async () => {
      calls.push("completeSignUp")
      return succeed
        ? { outcome: SignUpOutcome.Created, signedIn: await signedIn() }
        : { outcome: SignUpOutcome.WrongCode }
    },
    requestSignInCode: () => (calls.push("requestSignInCode"), Promise.resolve()),
    waitingSignInCode: () => Promise.resolve({ email: "alice@example.com" }),
    resendSignInCode: () => (calls.push("resendSignInCode"), Promise.resolve(succeed)),
    cancelSignInCode: () => (calls.push("cancelSignInCode"), Promise.resolve()),
    // Without success the code is wrong.
    completeSignInCode: async () => {
      calls.push("completeSignInCode")
      return succeed
        ? {
          outcome: SignInCodeOutcome.SignedIn,
          signedIn: await signedIn(),
          email: "alice@example.com",
          next: "/notes",
        }
        : { outcome: SignInCodeOutcome.WrongCode }
    },
    requestPasswordReset: () => (calls.push("requestPasswordReset"), Promise.resolve()),
    waitingPasswordReset: () => Promise.resolve({ email: "alice@example.com" }),
    resendPasswordReset: () => (calls.push("resendPasswordReset"), Promise.resolve(succeed)),
    cancelPasswordReset: () => (calls.push("cancelPasswordReset"), Promise.resolve()),
    verifyPasswordReset: () => (
      calls.push("verifyPasswordReset"),
        Promise.resolve(
          succeed
            ? { outcome: PasswordResetOutcome.Verified, token: "a-reset-token" }
            : { outcome: PasswordResetOutcome.WrongCode },
        )
    ),
    finishPasswordReset: () => (calls.push("finishPasswordReset"), Promise.resolve(succeed)),
    signIn: (_c, login) => (
      calls.push("signIn"), logins.push(login), succeed ? signedIn() : Promise.resolve(null)
    ),
    signOut: () => (calls.push("signOut"), Promise.resolve()),
    connectTotpStart: () => (
      calls.push("connectTotpStart"), Promise.resolve({ error: null, qrcode: "qr", secret: "s" })
    ),
    connectTotpFinish: () => (calls.push("connectTotpFinish"), Promise.resolve(succeed)),
    checkTotp: () => (calls.push("checkTotp"), Promise.resolve(succeed)),
    disconnectTotp: () => (calls.push("disconnectTotp"), Promise.resolve(true)),
    changePassword: () => (
      calls.push("changePassword"), Promise.resolve(succeed ? { revokedTokens: 2 } : null)
    ),
    resetPassword: () => (calls.push("resetPassword"), Promise.resolve(succeed)),
    checkPassword: () => (calls.push("checkPassword"), Promise.resolve(succeed)),
    countPasswordCheck: (_userId, check) => check(),
    verifyPassword: () => (calls.push("verifyPassword"), Promise.resolve(succeed)),
    hasPassword: () => Promise.resolve(true),
    confirmedByProvider: () => Promise.resolve(false),
    setPassword: () => (
      calls.push("setPassword"),
        Promise.resolve(succeed ? PasswordSetOutcome.Set : PasswordSetOutcome.ProofRequired)
    ),
    verifyTotpCode: () => (calls.push("verifyTotpCode"), Promise.resolve(succeed)),
    accountDeletionBlockers: () => (calls.push("accountDeletionBlockers"), Promise.resolve([])),
    deleteAccount: () => (
      calls.push("deleteAccount"), Promise.resolve({ deleteAfter: DELETE_AFTER })
    ),
    // Without success there is nothing to prove, the code is wrong and the password too.
    emailStatus: () => (calls.push("emailStatus"), Promise.resolve(succeed ? UNPROVEN : PROVEN)),
    requestEmailChange: () => (
      calls.push("requestEmailChange"),
        Promise.resolve(succeed ? EmailChangeOutcome.Requested : EmailChangeOutcome.WrongPassword)
    ),
    verifyEmail: () => (
      calls.push("verifyEmail"),
        Promise.resolve(succeed ? EmailVerifyOutcome.Verified : EmailVerifyOutcome.WrongCode)
    ),
    listSessions:
      () => (calls.push("listSessions"), Promise.resolve([CURRENT_DEVICE, OTHER_DEVICE])),
    // Without success the session is another user's or already gone.
    endSession: () => (calls.push("endSession"), Promise.resolve(succeed)),
    endOtherSessions: () => (calls.push("endOtherSessions"), Promise.resolve(1)),
    expireSessions: () => Promise.resolve(),
    entitledSession: () => Promise.resolve(null),
  }
}

/** A new in-process store each call, standing in for one limiter's share of Valkey. */
export function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

/** A store whose every call fails, as Valkey does while it is down. */
export function brokenStore(): RateLimitStore {
  const down = () => Promise.reject(new Error("valkey is down"))
  return { read: down, write: down, delete: down, consume: down, release: down }
}

/** Limits no test outside the rate-limit block reaches. */
export const generousLimits = {
  windowMs: 60_000,
  strictLimit: 1_000,
  limit: 1_000,
  otpWindowMs: 900_000,
  otpLimit: 1_000,
  store: memoryStore,
  onStoreError: () => {},
}

export function buildApp(
  auth: APIContext["Variables"]["auth"] = buildAuthData(),
  {
    rateLimits = createAuthRateLimits(generousLimits),
    succeed = true,
    secondFactor,
    lockedForMs,
    codeLockedForMs,
    passwordLockedForMs,
    passwordFailures,
    signIn: overrides = {},
  }: {
    rateLimits?: AuthRateLimits
    /** How long the failure counter says the user is locked; 0 or left out means not locked. */
    lockedForMs?: number
    /** The same for the e-mail code counter. */
    codeLockedForMs?: number
    /** The same for the wrong-password counter of the sign-in name. */
    passwordLockedForMs?: number
    /** Replaces the fake wrong-password counter, for a test that runs the real lock. */
    passwordFailures?: Lockout
    succeed?: boolean
    /** The second-factor state of the session that `signIn` and `signUp` hand back. */
    secondFactor?: SecondFactorStatus
    /** Replaces operations of the fake sign-in. */
    signIn?: Partial<SignIn>
  } = {},
) {
  const calls: string[] = []
  const failureCalls: string[] = []
  const codeFailureCalls: string[] = []
  const passwordFailureCalls: string[] = []
  /** Every address a code mail was queued for. */
  const mailed: string[] = []
  /** Every address a reset code was asked for, as the route passed it. */
  const queued: string[] = []
  /** Every sign-in code the route asked for: the address and the page to open after. */
  const codes: { email: string; next: string | null }[] = []
  /** What the route handed `signUp` and `signIn` as the address or login. */
  const logins: string[] = []
  /** Every sign-out the route announced. */
  const emitted: UserSignedOutEvent[] = []
  const route = createAuthRoute({
    signIn: {
      ...fakeSignIn(calls, succeed, secondFactor, logins),
      requestPasswordReset: (_c, email) => (
        calls.push("requestPasswordReset"), queued.push(email), Promise.resolve()
      ),
      requestSignInCode: (_c, email, next) => (
        calls.push("requestSignInCode"), codes.push({ email, next }), Promise.resolve()
      ),
      ...overrides,
    },
    emit: (event) => void emitted.push(event),
    mutationGuards: testMutationGuards,
    rateLimits,
    totpFailures: fakeTotpFailures(failureCalls, lockedForMs),
    passwordFailures: passwordFailures ??
      fakeTotpFailures(passwordFailureCalls, passwordLockedForMs),
    emailCodeFailures: fakeTotpFailures(codeFailureCalls, codeLockedForMs),
    requestEmailCode: (_userId, email) => (mailed.push(email), Promise.resolve()),
  })
  return {
    app: mountRoute("/auth", route, auth),
    calls,
    failureCalls,
    codeFailureCalls,
    passwordFailureCalls,
    queued,
    codes,
    logins,
    mailed,
    emitted,
  }
}

/** `body` with its `email` replaced, or `body` itself when it has none. */
export function withEmail(body: unknown, email: string): unknown {
  return typeof body === "object" && body !== null && "email" in body ? { ...body, email } : body
}

export function send(
  app: ReturnType<typeof buildApp>["app"],
  { method, path, body }: MutationCase,
  headers: Readonly<Record<string, string>>,
) {
  return app.request(`${API_URL}${path}`, {
    method,
    headers: { ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export const credentials = { login: "alice@example.com", password: "correct-horse" }
export const signUpBody = { email: "alice@example.com", password: "correct-horse" }
export const resetBody = {
  token: "a-reset-token",
  newPassword: "battery-staple",
}

/** Routes a browser without a session may call. */
export const anonymousRoutes: (MutationCase & { operation: string })[] = [
  { method: "POST", path: "/auth/sign-out", body: undefined, operation: "signOut" },
  { method: "POST", path: "/auth/password/check", body: credentials, operation: "signIn" },
  {
    method: "POST",
    path: "/auth/password/sign-up",
    body: signUpBody,
    operation: "requestSignUp",
  },
  {
    method: "POST",
    path: "/auth/password/sign-up/verify",
    body: { code: "abcd1234" },
    operation: "completeSignUp",
  },
  {
    method: "POST",
    path: "/auth/password/sign-up/resend",
    body: undefined,
    operation: "resendSignUpCode",
  },
  {
    method: "POST",
    path: "/auth/password/sign-up/cancel",
    body: undefined,
    operation: "cancelSignUp",
  },
  {
    method: "POST",
    path: "/auth/password/forgot",
    body: { email: "alice@example.com" },
    operation: "requestPasswordReset",
  },
  {
    method: "POST",
    path: "/auth/password/reset/verify",
    body: { code: "abcd1234" },
    operation: "verifyPasswordReset",
  },
  {
    method: "POST",
    path: "/auth/password/reset/resend",
    body: undefined,
    operation: "resendPasswordReset",
  },
  {
    method: "POST",
    path: "/auth/password/reset/cancel",
    body: undefined,
    operation: "cancelPasswordReset",
  },
  {
    method: "POST",
    path: "/auth/password/reset",
    body: resetBody,
    operation: "finishPasswordReset",
  },
  {
    method: "POST",
    path: "/auth/code",
    body: { email: "alice@example.com" },
    operation: "requestSignInCode",
  },
  {
    method: "POST",
    path: "/auth/code/verify",
    body: { code: "abcd1234" },
    operation: "completeSignInCode",
  },
  {
    method: "POST",
    path: "/auth/code/resend",
    body: undefined,
    operation: "resendSignInCode",
  },
  {
    method: "POST",
    path: "/auth/code/cancel",
    body: undefined,
    operation: "cancelSignInCode",
  },
]

/**
 * A route behind a session. `calls` lists what a route that runs more than its `operation` calls,
 * when its checks pass and when they fail.
 */
export interface SessionRoute extends MutationCase {
  operation: string
  calls?: { succeeded: string[]; failed: string[] }
}

/** What `route` calls once, when its checks pass (`succeeded`) or fail. */
export function callsOf(route: SessionRoute, succeeded: boolean): string[] {
  return route.calls?.[succeeded ? "succeeded" : "failed"] ?? [route.operation]
}

/** Routes behind `isAuthenticated1FA` or `isAuthenticated2FA`. */
export const sessionRoutes: SessionRoute[] = [
  { method: "POST", path: "/auth/totp/check", body: { otp: "123456" }, operation: "checkTotp" },
  {
    method: "POST",
    path: "/auth/totp/connect/start",
    body: { password: "correct-horse" },
    operation: "connectTotpStart",
    calls: { succeeded: ["checkPassword", "connectTotpStart"], failed: ["checkPassword"] },
  },
  {
    method: "POST",
    path: "/auth/totp/connect/finish",
    body: { otp: "123456" },
    operation: "connectTotpFinish",
  },
  {
    method: "POST",
    path: "/auth/totp/disconnect",
    body: { password: "correct-horse" },
    operation: "disconnectTotp",
    calls: { succeeded: ["checkPassword", "disconnectTotp"], failed: ["checkPassword"] },
  },
  {
    method: "POST",
    path: "/auth/password/change",
    body: { password: "correct-horse", newPassword: "battery-staple" },
    operation: "changePassword",
  },
  {
    method: "POST",
    path: "/auth/password/set",
    body: { newPassword: "battery-staple" },
    operation: "setPassword",
  },
  // Reads no body: it sends a code to the address that needs one.
  { method: "POST", path: "/auth/email/send", body: undefined, operation: "emailStatus" },
  {
    method: "POST",
    path: "/auth/email/verify",
    body: { code: "Ab3_x-9Q" },
    operation: "verifyEmail",
  },
  {
    method: "POST",
    path: "/auth/email/change",
    body: { email: "new@example.com", password: "correct-horse" },
    operation: "requestEmailChange",
  },
  {
    method: "POST",
    path: "/auth/account/delete",
    body: { password: "correct-horse" },
    operation: "deleteAccount",
    calls: {
      succeeded: ["accountDeletionBlockers", "checkPassword", "deleteAccount"],
      failed: ["accountDeletionBlockers", "checkPassword"],
    },
  },
  { method: "DELETE", path: "/auth/sessions/2", body: undefined, operation: "endSession" },
  {
    method: "DELETE",
    path: "/auth/sessions/others",
    body: undefined,
    operation: "endOtherSessions",
  },
]
