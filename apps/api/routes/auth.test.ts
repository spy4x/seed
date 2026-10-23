import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import {
  EmailChangeOutcome,
  EmailVerifyOutcome,
  PasswordSetOutcome,
  type SignedIn,
  type SignIn,
  SignInLinkOutcome,
  SignUpOutcome,
} from "../services/sign-in.ts"
import {
  AccountDeletionBlockReason,
  type EmailStatus,
  type SignedInDevice,
  UserMFAStatus,
} from "@domain/identity"
import type { UserSignedOutEvent } from "../cqrs/events.ts"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  type MutationCase,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import { MALFORMED_JSON, oversizedJson } from "../_testing/json-bodies.ts"
import {
  type AuthRateLimits,
  createAuthRateLimits,
  EMAIL_CHANGE_MAILS_PER_ACCOUNT,
  EMAIL_CHANGE_MAILS_PER_ADDRESS,
  EMAIL_CODE_MAILS_PER_ADDRESS,
  RESET_MAILS_PER_ADDRESS,
  SIGN_IN_LINK_MAILS_PER_ADDRESS,
  SIGN_IN_LINK_MAILS_PER_CLIENT,
  SIGN_UP_CODE_MAILS_PER_ADDRESS,
  SIGN_UP_CODE_MAILS_PER_CLIENT,
} from "../middlewares/auth-rate-limits.ts"
import { createLockout, type Lockout } from "@spy4x/server/lockout"
import { MemoryLockoutStore } from "@spy4x/server/lockout/memory-store"
import { PASSWORD_LOCK_POLICY } from "../services/password-failures.ts"
import { PasswordLockedError } from "../services/password-locked.ts"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import {
  ACCOUNT_DELETE_BLOCKED,
  ACCOUNT_DELETE_CODE_REQUIRED,
  createAuthRoute,
  EMAIL_ALREADY_CARRIED,
  EMAIL_CHANGE_TOO_MANY,
  EMAIL_CODE_REFUSED,
  EMAIL_NOTHING_TO_VERIFY,
  EMAIL_TAKEN,
  PASSWORD_ALREADY_SET,
  PASSWORD_NEEDS_ADDRESS,
  PASSWORD_RESET_REFUSED,
  PASSWORD_RESET_REQUESTED,
  PASSWORD_SET_REFUSED,
  PROVIDER_PROOF_REQUIRED,
  SESSION_IS_CURRENT,
  SESSION_NOT_FOUND,
  SIGN_IN_LINK_BAD_ADDRESS,
  SIGN_IN_LINK_REFUSED,
  SIGN_IN_LINK_REQUESTED,
  SIGN_IN_LINK_UNCONFIRMED,
  SIGN_UP_CODES_TOO_MANY,
  SIGN_UP_EXPIRED,
  SIGN_UP_REQUESTED,
  TOTP_DISCONNECT_PROOF_REQUIRED,
} from "./auth.ts"
import { apiError } from "../_testing/api-error.ts"

/** When the fake sign-in's waiting sign-up stops working. */
const WAITING_UNTIL = new Date("2026-10-17T10:10:00.000Z")

/** When the fake sign-in says a deleted account goes for good. */
const DELETE_AFTER = new Date("2026-10-11T08:00:00.000Z")

/** The device of the fake session (id 1), and another device of the same person. */
const CURRENT_DEVICE: SignedInDevice = {
  id: 1,
  deviceName: "Firefox on Linux",
  ipHint: "203.0.113.*",
  createdAt: "2026-10-01T08:00:00.000Z",
  lastUsedAt: "2026-10-04T08:00:00.000Z",
  current: true,
}
const OTHER_DEVICE: SignedInDevice = {
  ...CURRENT_DEVICE,
  id: 2,
  deviceName: "Safari on iPhone",
  current: false,
}

/** An address the user still has to prove, and one already proven. */
const UNPROVEN: EmailStatus = { email: "alice@example.com", proven: false, pending: null }
const PROVEN: EmailStatus = { email: "alice@example.com", proven: true, pending: null }

/**
 * A failure counter that records its calls in `calls`, and answers `lockedForMs` to `begin`
 * (0 = not locked).
 */
function fakeTotpFailures(calls: string[], lockedForMs = 0): Lockout {
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
function fakeSignIn(
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
    redeemSignInLink: async () => {
      calls.push("redeemSignInLink")
      return succeed
        ? {
          outcome: SignInLinkOutcome.SignedIn,
          signedIn: await signedIn(),
          email: "alice@example.com",
          next: "/notes",
        }
        : { outcome: SignInLinkOutcome.Refused }
    },
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
function memoryStore(): RateLimitStore {
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
function brokenStore(): RateLimitStore {
  const down = () => Promise.reject(new Error("valkey is down"))
  return { read: down, write: down, delete: down, consume: down, release: down }
}

/** Limits no test outside the rate-limit block reaches. */
const generousLimits = {
  windowMs: 60_000,
  strictLimit: 1_000,
  limit: 1_000,
  otpWindowMs: 900_000,
  otpLimit: 1_000,
  store: memoryStore,
  onStoreError: () => {},
}

function buildApp(
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
  /** Every address a reset link was queued for, as the route passed it. */
  const queued: string[] = []
  /** Every sign-in link the route queued: the address and the page to open after. */
  const links: { email: string; next: string | null }[] = []
  /** What the route handed `signUp` and `signIn` as the address or login. */
  const logins: string[] = []
  /** Every sign-out the route announced. */
  const emitted: UserSignedOutEvent[] = []
  const route = createAuthRoute({
    signIn: { ...fakeSignIn(calls, succeed, secondFactor, logins), ...overrides },
    emit: (event) => void emitted.push(event),
    mutationGuards: testMutationGuards,
    rateLimits,
    totpFailures: fakeTotpFailures(failureCalls, lockedForMs),
    passwordFailures: passwordFailures ??
      fakeTotpFailures(passwordFailureCalls, passwordLockedForMs),
    requestPasswordReset: (email) => (
      calls.push("requestPasswordReset"), queued.push(email), Promise.resolve()
    ),
    requestSignInLink: (email, next) => (
      calls.push("requestSignInLink"), links.push({ email, next }), Promise.resolve()
    ),
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
    links,
    logins,
    mailed,
    emitted,
  }
}

/** `body` with its `email` replaced, or `body` itself when it has none. */
function withEmail(body: unknown, email: string): unknown {
  return typeof body === "object" && body !== null && "email" in body ? { ...body, email } : body
}

function send(
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

const credentials = { login: "alice@example.com", password: "correct-horse" }
const signUpBody = { email: "alice@example.com", password: "correct-horse" }
const resetBody = {
  email: "alice@example.com",
  code: "a-code-from-the-link",
  newPassword: "battery-staple",
}

/** Routes a browser without a session may call. */
const anonymousRoutes: (MutationCase & { operation: string })[] = [
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
  { method: "POST", path: "/auth/password/reset", body: resetBody, operation: "resetPassword" },
  {
    method: "POST",
    path: "/auth/link",
    body: { email: "alice@example.com" },
    operation: "requestSignInLink",
  },
  {
    method: "POST",
    path: "/auth/link/redeem",
    body: { token: "a-token-from-the-link" },
    operation: "redeemSignInLink",
  },
]

/**
 * A route behind a session. `calls` lists what a route that runs more than its `operation` calls,
 * when its checks pass and when they fail.
 */
interface SessionRoute extends MutationCase {
  operation: string
  calls?: { succeeded: string[]; failed: string[] }
}

/** What `route` calls once, when its checks pass (`succeeded`) or fail. */
function callsOf(route: SessionRoute, succeeded: boolean): string[] {
  return route.calls?.[succeeded ? "succeeded" : "failed"] ?? [route.operation]
}

/** Routes behind `isAuthenticated1FA` or `isAuthenticated2FA`. */
const sessionRoutes: SessionRoute[] = [
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

describe("auth routes refuse cross-site requests", () => {
  for (const route of [...anonymousRoutes, ...sessionRoutes]) {
    it(`refuses a cross-site ${route.method} ${route.path} with 403`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes a browser without a session may call", () => {
  for (const route of anonymousRoutes) {
    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy without a cookie`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.ok).toBe(true)
      expect(calls).toEqual([route.operation])
    })
  }
})

describe("auth routes behind a session", () => {
  for (const route of sessionRoutes) {
    it(`accepts a same-origin ${route.method} ${route.path} through the TLS proxy`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, route, sameOriginHeaders)

      expect(response.ok).toBe(true)
      expect(calls).toEqual(callsOf(route, true))
    })

    it(`answers ${route.method} ${route.path} without a session with 401, not 403`, async () => {
      const { app, calls } = buildApp(null)
      const response = await send(app, route, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes cap the JSON body", () => {
  const bodyRoutes = [...anonymousRoutes, ...sessionRoutes].filter((route) => route.body)
  for (const route of bodyRoutes) {
    const headers = anonymousRoutes.includes(route)
      ? sameOriginWithoutCookieHeaders
      : sameOriginHeaders
    it(`answers an oversized body on ${route.method} ${route.path} with 413`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined)
      const response = await app.request(`${API_URL}${route.path}`, {
        method: route.method,
        headers: { ...headers },
        body: oversizedJson(route.body),
      })

      expect(response.status).toBe(413)
      expect(calls).toEqual([])
    })

    it(`answers malformed JSON on ${route.method} ${route.path} with 400`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined)
      const response = await app.request(`${API_URL}${route.path}`, {
        method: route.method,
        headers: { ...headers },
        body: MALFORMED_JSON,
      })

      expect(response.status).toBe(400)
      expect(calls).toEqual([])
    })
  }
})

describe("auth routes rate-limit", () => {
  /**
   * Three attempts per minute on the strict limit, two on the normal one, and the shipped five per
   * 15 minutes on the one-time-code limit.
   */
  const tightLimits = {
    windowMs: 60_000,
    strictLimit: 3,
    limit: 2,
    otpWindowMs: 900_000,
    otpLimit: 5,
    store: memoryStore,
    onStoreError: () => {},
  }

  const otpPaths = ["/auth/totp/check", "/auth/totp/connect/finish"]
  const strictByIpRoutes = anonymousRoutes.filter((route) => route.body)
  const otpRoutes = sessionRoutes.filter((route) => otpPaths.includes(route.path))
  const strictByUserRoutes = sessionRoutes.filter((route) =>
    route.body && !otpPaths.includes(route.path)
  )
  const normalRoutes = [
    ...anonymousRoutes.filter((route) => !route.body),
    ...sessionRoutes.filter((route) => !route.body),
  ]

  for (const route of strictByIpRoutes) {
    it(`answers the 4th failed ${route.path} from one IP with 429 and Retry-After`, async () => {
      const { app, calls } = buildApp(null, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const headers = { ...sameOriginWithoutCookieHeaders, "x-real-ip": "192.0.2.1" }
      const responses = []
      for (let attempt = 0; attempt < 4; attempt++) {
        // A fresh address each time, so only the IP's budget can run out.
        const body = withEmail(route.body, `person${attempt}@example.com`)
        responses.push(await send(app, { ...route, body }, headers))
      }

      expect(responses.slice(0, 3).map((response) => response.status)).not.toContain(429)
      expect(responses[3].status).toBe(429)
      expect(Number(responses[3].headers.get("retry-after"))).toBeGreaterThan(0)
      expect(calls).toEqual([route.operation, route.operation, route.operation])
    })
  }

  it("gives another IP its own budget for password/check", async () => {
    const { app } = buildApp(null, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const route = strictByIpRoutes[0]
    for (let attempt = 0; attempt < 4; attempt++) {
      await send(app, route, { ...sameOriginWithoutCookieHeaders, "x-real-ip": "192.0.2.1" })
    }
    const other = await send(app, route, {
      ...sameOriginWithoutCookieHeaders,
      "x-real-ip": "192.0.2.2",
    })

    expect(other.status).toBe(401)
  })

  it("keys password/check on X-Real-IP, not on a forged CF-Connecting-IP or X-Forwarded-For", async () => {
    const { app } = buildApp(null, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const route = strictByIpRoutes[0]
    const statuses = []
    for (let attempt = 0; attempt < 4; attempt++) {
      const forged = `198.51.100.${attempt + 1}`
      const response = await send(app, route, {
        ...sameOriginWithoutCookieHeaders,
        "x-real-ip": "192.0.2.1",
        "cf-connecting-ip": forged,
        "x-forwarded-for": forged,
      })
      statuses.push(response.status)
    }

    expect(statuses).toEqual([401, 401, 401, 429])
  })

  for (const route of strictByUserRoutes) {
    it(`answers the 4th failed ${route.path} from one user with 429, whatever the IP`, async () => {
      const { app, calls } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const statuses = []
      for (let attempt = 0; attempt < 4; attempt++) {
        const headers = { ...sameOriginHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
        statuses.push((await send(app, route, headers)).status)
      }

      expect(statuses.slice(3)).toEqual([429])
      expect(statuses.slice(0, 3)).not.toContain(429)
      expect(calls).toEqual([1, 2, 3].flatMap(() => callsOf(route, false)))
    })
  }

  for (const route of otpRoutes) {
    it(`answers the 6th failed ${route.path} in 15 minutes from one user with 429, whatever the IP`, async () => {
      const { app, calls } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const statuses = []
      for (let attempt = 0; attempt < 6; attempt++) {
        const headers = { ...sameOriginHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
        statuses.push((await send(app, route, headers)).status)
      }

      expect(statuses.slice(5)).toEqual([429])
      expect(statuses.slice(0, 5)).not.toContain(429)
      expect(calls).toEqual(Array(5).fill(route.operation))
    })
  }

  for (const route of otpRoutes) {
    it(`lets six correct ${route.path} calls in 15 minutes all succeed`, async () => {
      const { app } = buildApp(undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: true,
      })
      const statuses = []
      for (let attempt = 0; attempt < 6; attempt++) {
        statuses.push((await send(app, route, sameOriginHeaders)).status)
      }

      expect(statuses).toEqual(Array(6).fill(200))
    })
  }

  it("still refuses the 6th wrong code after correct ones in between", async () => {
    let correct = true
    const calls: string[] = []
    const route = otpRoutes[0]
    const signIn = fakeSignIn(calls)
    signIn.checkTotp = () => Promise.resolve(correct)
    const app = mountRoute(
      "/auth",
      createAuthRoute({
        signIn,
        emit: () => {},
        mutationGuards: testMutationGuards,
        rateLimits: createAuthRateLimits(tightLimits),
        totpFailures: fakeTotpFailures([]),
        passwordFailures: fakeTotpFailures([]),
        requestPasswordReset: () => Promise.resolve(),
        requestSignInLink: () => Promise.resolve(),
        emailCodeFailures: fakeTotpFailures([]),
        requestEmailCode: () => Promise.resolve(),
      }),
      buildAuthData(),
    )
    const statuses = []
    for (const isCorrect of [false, false, true, false, true, false, false, false, false]) {
      correct = isCorrect
      statuses.push((await send(app, route, sameOriginHeaders)).status)
    }

    expect(statuses).toEqual([401, 401, 200, 401, 200, 401, 401, 429, 429])
  })

  it("counts totp/check and totp/connect/finish against one one-time-code budget", async () => {
    const { app, calls } = buildApp(undefined, {
      rateLimits: createAuthRateLimits(tightLimits),
      succeed: false,
    })
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await send(app, otpRoutes[attempt % 2], sameOriginHeaders)).status)
    }

    expect(statuses.slice(5)).toEqual([429])
    expect(calls).toHaveLength(5)
  })

  it("keeps refusing one-time codes after the one-minute window, until 15 minutes pass", async () => {
    let now = 0
    const { app } = buildApp(undefined, {
      rateLimits: createAuthRateLimits({ ...tightLimits, clock: () => now }),
      succeed: false,
    })
    const route = otpRoutes[0]
    for (let attempt = 0; attempt < 5; attempt++) {
      await send(app, route, sameOriginHeaders)
    }
    now = 14 * 60_000
    const beforeWindowEnds = await send(app, route, sameOriginHeaders)
    now = 15 * 60_000 + 1
    const afterWindowEnds = await send(app, route, sameOriginHeaders)

    expect(beforeWindowEnds.status).toBe(429)
    expect(afterWindowEnds.status).toBe(401)
  })

  it("gives another user their own budget for totp/check", async () => {
    const rateLimits = createAuthRateLimits(tightLimits)
    const first = buildApp(buildAuthData({ user: { id: 1 } }), { rateLimits, succeed: false })
    const second = buildApp(buildAuthData({ user: { id: 2 } }), { rateLimits, succeed: false })
    const route = otpRoutes[0]
    for (let attempt = 0; attempt < 6; attempt++) {
      await send(first.app, route, sameOriginHeaders)
    }
    const other = await send(second.app, route, sameOriginHeaders)

    expect(other.status).toBe(401)
  })

  for (const route of normalRoutes) {
    it(`answers the 3rd ${route.method} ${route.path} in one window with 429`, async () => {
      const { app, calls } = buildApp(undefined, { rateLimits: createAuthRateLimits(tightLimits) })
      const statuses = []
      for (let attempt = 0; attempt < 3; attempt++) {
        statuses.push((await send(app, route, sameOriginHeaders)).status)
      }

      expect(statuses).toEqual([200, 200, 429])
      expect(calls).toEqual([route.operation, route.operation])
    })
  }

  for (const route of [...anonymousRoutes, ...sessionRoutes]) {
    it(`spends no budget on a refused cross-site ${route.method} ${route.path}`, async () => {
      const { app, calls } = buildApp(anonymousRoutes.includes(route) ? null : undefined, {
        rateLimits: createAuthRateLimits(tightLimits),
        succeed: false,
      })
      const headers = anonymousRoutes.includes(route)
        ? sameOriginWithoutCookieHeaders
        : sameOriginHeaders
      for (let attempt = 0; attempt < 6; attempt++) {
        await send(app, route, crossSiteHeaders)
      }
      const sameOrigin = await send(app, route, headers)

      expect(sameOrigin.status).not.toBe(429)
      expect(calls).toEqual(callsOf(route, false))
    })
  }

  it("answers GET /auth/me with 202 while the session owes its second factor", async () => {
    const { app } = buildApp(
      buildAuthData({ session: { secondFactor: SecondFactorStatus.Pending } }),
    )

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ secondFactor: "Pending" })
  })

  it("answers POST /auth/password/check with 202 and no profile while the second factor is pending", async () => {
    const { app } = buildApp(undefined, { secondFactor: SecondFactorStatus.Pending })

    const response = await app.request(`${API_URL}/auth/password/check`, {
      method: "POST",
      headers: { ...sameOriginHeaders, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ secondFactor: "Pending" })
  })

  it("answers POST /auth/password/check with the user when no second factor is pending", async () => {
    const { app } = buildApp()

    const response = await app.request(`${API_URL}/auth/password/check`, {
      method: "POST",
      headers: { ...sameOriginHeaders, "content-type": "application/json" },
      body: JSON.stringify(credentials),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).id).toBe(1)
  })

  for (
    const secondFactor of [SecondFactorStatus.NotRequired, SecondFactorStatus.Completed]
  ) {
    it(`answers GET /auth/me with 200 when the second factor is ${SecondFactorStatus[secondFactor]}`, async () => {
      const { app } = buildApp(buildAuthData({ session: { secondFactor } }))

      const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

      expect(response.status).toBe(200)
    })
  }

  it("answers GET /auth/me with 401 without a session", async () => {
    const { app } = buildApp(null)

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(401)
  })

  it("answers the 3rd GET /auth/me in one window with 429", async () => {
    const { app } = buildApp(undefined, { rateLimits: createAuthRateLimits(tightLimits) })
    const statuses = []
    for (let attempt = 0; attempt < 3; attempt++) {
      statuses.push(
        (await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })).status,
      )
    }

    expect(statuses).toEqual([200, 200, 429])
  })

  const guessingRoutes = [
    ...strictByIpRoutes.map((route) => ({
      route,
      auth: null,
      headers: sameOriginWithoutCookieHeaders,
    })),
    ...[...strictByUserRoutes, ...otpRoutes].map((route) => ({
      route,
      auth: undefined,
      headers: sameOriginHeaders,
    })),
  ]
  for (const { route, auth, headers } of guessingRoutes) {
    it(`refuses ${route.path} without calling ${route.operation} while its limit's store is down`, async () => {
      const { app, calls } = buildApp(auth, {
        rateLimits: createAuthRateLimits({ ...tightLimits, store: brokenStore }),
      })

      const response = await send(app, route, headers)

      expect(response.status).toBe(500)
      expect(calls).toEqual([])
    })
  }

  it("keeps a correct one-time code's answer and reports it when its slot cannot be given back", async () => {
    const errors: unknown[] = []
    /** Works for the check, then fails, as Valkey going down while the code is checked. */
    const storeThatDiesAfterCheck = (): RateLimitStore => {
      const store = memoryStore()
      let checked = false
      const down = () => Promise.reject(new Error("valkey is down"))
      return {
        read: (key, now) => store.read(key, now),
        // The refund deletes the window it empties, or rewrites a shorter one.
        delete: (key) => checked ? down() : store.delete(key),
        write: (...args) => checked ? down() : (checked = true, store.write(...args)),
      }
    }
    const { app, calls } = buildApp(undefined, {
      rateLimits: createAuthRateLimits({
        ...tightLimits,
        store: storeThatDiesAfterCheck,
        onStoreError: (error) => errors.push(error),
      }),
    })

    const response = await send(app, otpRoutes[0], sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual([otpRoutes[0].operation])
    expect(errors.map((error) => (error as Error).message)).toEqual(["valkey is down"])
  })

  it("lets GET /auth/me through and reports the error while the normal limit's store is down", async () => {
    const errors: unknown[] = []
    const { app } = buildApp(undefined, {
      rateLimits: createAuthRateLimits({
        ...tightLimits,
        store: brokenStore,
        onStoreError: (error) => errors.push(error),
      }),
    })

    const response = await app.request(`${API_URL}/auth/me`, { headers: sameOriginHeaders })

    expect(response.status).toBe(200)
    expect(errors.map((error) => (error as Error).message)).toEqual(["valkey is down"])
  })
})

describe("auth routes count wrong one-time codes per user", () => {
  const otpRoutes = sessionRoutes.filter((route) =>
    ["/auth/totp/check", "/auth/totp/connect/finish"].includes(route.path)
  )

  for (const route of otpRoutes) {
    it(`answers ${route.path} with 429 and Retry-After while the user is locked, without checking the code`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { lockedForMs: 90_500 })
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("91")
      expect(failureCalls).toEqual(["begin"])
      expect(calls).toEqual([])
    })

    it(`counts the check before running it and gives the slot back after a correct ${route.path}`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { succeed: true })
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(200)
      expect(failureCalls).toEqual(["begin", "refund"])
      expect(calls).toEqual([route.operation])
    })

    it(`records a wrong ${route.path}`, async () => {
      const { app, calls, failureCalls } = buildApp(undefined, { succeed: false })
      await send(app, route, sameOriginHeaders)

      expect(failureCalls).toEqual(["begin", "fail"])
      expect(calls).toEqual([route.operation])
    })
  }
})

describe("auth routes ask for proof before turning two-factor off", () => {
  const disconnect = (body: unknown) => ({
    method: "POST" as const,
    path: "/auth/totp/disconnect",
    body,
  })

  for (const [name, body] of [["an empty body", {}], ["no body", undefined]] as const) {
    it(`refuses ${name}, with neither a password nor a code, and leaves two-factor on`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, disconnect(body), sameOriginHeaders)

      expect(response.status).toBe(400)
      if (body) expect((await apiError(response)).message).toBe(TOTP_DISCONNECT_PROOF_REQUIRED)
      expect(calls).toEqual([])
    })
  }

  it("refuses a wrong password and leaves two-factor on", async () => {
    const { app, calls } = buildApp(undefined, { succeed: false })
    const response = await send(app, disconnect({ password: "wrong-horse" }), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Invalid password")
    expect(calls).toEqual(["checkPassword"])
  })

  it("turns two-factor off for the account's password", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, disconnect({ password: "correct-horse" }), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["checkPassword", "disconnectTotp"])
  })

  it("turns two-factor off for a current code without asking for a password, as an account with none needs", async () => {
    const { app, calls, failureCalls } = buildApp(undefined, {
      signIn: { checkPassword: () => Promise.reject(new Error("no password was sent")) },
    })
    const response = await send(app, disconnect({ otp: "123456" }), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["verifyTotpCode", "disconnectTotp"])
    expect(failureCalls).toEqual(["begin", "refund"])
  })

  it("refuses a wrong code, counts it and leaves two-factor on", async () => {
    const { app, calls, failureCalls } = buildApp(undefined, { succeed: false })
    const response = await send(app, disconnect({ otp: "123456" }), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Code is incorrect")
    expect(calls).toEqual(["verifyTotpCode"])
    expect(failureCalls).toEqual(["begin", "fail"])
  })

  it("refuses a code while the user is locked after wrong codes, without checking it", async () => {
    const { app, calls } = buildApp(undefined, { lockedForMs: 90_500 })
    const response = await send(app, disconnect({ otp: "123456" }), sameOriginHeaders)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("91")
    expect(calls).toEqual([])
  })

  it("refuses a code that is not six digits", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, disconnect({ otp: "12345" }), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe("auth routes ask for proof before turning two-factor on (#406)", () => {
  const start = (body: unknown) => ({
    method: "POST" as const,
    path: "/auth/totp/connect/start",
    body,
  })

  it("refuses an account with a password that sends none, and starts nothing", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, start({}), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Invalid password")
    expect(calls).toEqual([])
  })

  it("refuses a wrong password and starts nothing", async () => {
    const { app, calls } = buildApp(undefined, { succeed: false })
    const response = await send(app, start({ password: "wrong-horse" }), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Invalid password")
    expect(calls).toEqual(["checkPassword"])
  })

  it("starts the set-up for the account's password", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, start({ password: "correct-horse" }), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ qrcode: "qr", secret: "s" })
    expect(calls).toEqual(["checkPassword", "connectTotpStart"])
  })

  it("refuses an account without a password whose provider sign-in is not recent", async () => {
    const { app, calls } = buildApp(undefined, {
      signIn: { hasPassword: () => Promise.resolve(false) },
    })
    const response = await send(app, start({}), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PROVIDER_PROOF_REQUIRED)
    expect(calls).toEqual([])
  })

  it("starts the set-up for an account without a password after a provider sign-in a moment ago", async () => {
    const { app, calls } = buildApp(undefined, {
      signIn: {
        hasPassword: () => Promise.resolve(false),
        confirmedByProvider: () => Promise.resolve(true),
      },
    })
    const response = await send(app, start({}), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["connectTotpStart"])
  })
})

describe("auth routes refuse a password step while the account's wrong passwords lock it (#406)", () => {
  const locked = () => Promise.reject(new PasswordLockedError(90_500))
  const cases: { route: MutationCase; signIn: Partial<SignIn> }[] = [
    {
      route: { method: "POST", path: "/auth/totp/connect/start", body: { password: "pw-12345" } },
      signIn: { checkPassword: locked },
    },
    {
      route: { method: "POST", path: "/auth/totp/disconnect", body: { password: "pw-12345" } },
      signIn: { checkPassword: locked },
    },
    {
      route: { method: "POST", path: "/auth/account/delete", body: { password: "pw-12345" } },
      signIn: { checkPassword: locked },
    },
    {
      route: {
        method: "POST",
        path: "/auth/password/change",
        body: { password: "pw-12345", newPassword: "battery-staple" },
      },
      signIn: { changePassword: locked },
    },
    {
      route: {
        method: "POST",
        path: "/auth/email/change",
        body: { email: "new@example.com", password: "pw-12345" },
      },
      signIn: { requestEmailChange: locked },
    },
  ]
  for (const { route, signIn } of cases) {
    it(`answers ${route.path} with 429, the time to wait and no change`, async () => {
      const { app, calls, mailed } = buildApp(undefined, { signIn })
      const response = await send(app, route, sameOriginHeaders)

      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("91")
      expect(await apiError(response)).toMatchObject({
        message: "Too many wrong passwords. Try again in 2 minutes.",
      })
      expect(calls.filter((call) => call !== "accountDeletionBlockers")).toEqual([])
      expect(mailed).toEqual([])
    })
  }
})

describe("auth routes lock a sign-in name after repeated wrong passwords", () => {
  const signInRoute = anonymousRoutes.find((route) => route.path === "/auth/password/check")!
  const RIGHT = "correct-horse"
  const from = (attempt: number) => ({
    ...sameOriginWithoutCookieHeaders,
    "x-real-ip": `192.0.2.${attempt + 1}`,
  })

  /** The real lock over an in-memory store and a clock the test moves; one password is right. */
  function lockedApp() {
    const clock = { ms: Date.UTC(2026, 9, 13, 8), now: () => clock.ms }
    const built = buildApp(null, {
      passwordFailures: createLockout({
        store: new MemoryLockoutStore(),
        clock,
        ...PASSWORD_LOCK_POLICY,
      }),
      signIn: {
        signIn: (_c, _login, password) => {
          built.calls.push("signIn")
          if (password !== RIGHT) return Promise.resolve(null)
          const { user, session } = buildAuthData()
          return Promise.resolve({ user, session })
        },
      },
    })
    const signIn = (attempt: number, login: string, password: string) =>
      send(built.app, { ...signInRoute, body: { login, password } }, from(attempt))
    return { ...built, clock, signIn }
  }

  it("locks the name for a minute after six wrong passwords from six addresses, and says when to try again", async () => {
    const { signIn, calls } = lockedApp()
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++) {
      statuses.push((await signIn(attempt, "alice@example.com", "wrong-horse")).status)
    }
    const locked = await signIn(6, "alice@example.com", "wrong-horse")

    expect(statuses).toEqual([401, 401, 401, 401, 401, 401])
    expect(locked.status).toBe(429)
    expect(locked.headers.get("retry-after")).toBe("60")
    expect(await apiError(locked)).toMatchObject({
      message: "Too many wrong passwords. Try again in 1 minute.",
    })
    // The seventh request never reached the password check.
    expect(calls).toHaveLength(6)
  })

  it("refuses the right password while the lock runs and takes it once the lock ends", async () => {
    const { signIn, calls, clock } = lockedApp()
    for (let attempt = 0; attempt < 6; attempt++) {
      await signIn(attempt, "alice@example.com", "wrong-horse")
    }

    clock.ms += 59_000
    const early = await signIn(7, "alice@example.com", RIGHT)
    expect(early.status).toBe(429)
    expect(early.headers.get("retry-after")).toBe("1")
    expect(calls).toHaveLength(6)

    clock.ms += 1_000
    expect((await signIn(8, "alice@example.com", RIGHT)).status).toBe(200)
  })

  it("counts the name as the sign-in normalises it, and gives another name its own count", async () => {
    const { signIn } = lockedApp()
    for (let attempt = 0; attempt < 6; attempt++) {
      await signIn(attempt, attempt % 2 ? " Alice@Example.com" : "alice@example.com", "wrong-horse")
    }

    expect((await signIn(6, "alice@example.com", RIGHT)).status).toBe(429)
    expect((await signIn(7, "bob@example.com", RIGHT)).status).toBe(200)
  })

  it("doubles the lock with each wrong password after it, up to 15 minutes", async () => {
    const { signIn, clock } = lockedApp()
    for (let attempt = 0; attempt < 5; attempt++) {
      await signIn(attempt, "alice@example.com", "wrong-horse")
    }
    const waits = []
    for (let attempt = 5; attempt < 12; attempt++) {
      await signIn(attempt, "alice@example.com", "wrong-horse")
      const locked = await signIn(attempt, "alice@example.com", "wrong-horse")
      const seconds = Number(locked.headers.get("retry-after"))
      waits.push(seconds / 60)
      clock.ms += seconds * 1_000
    }

    expect(waits).toEqual([1, 2, 4, 8, 15, 15, 15])
  })

  it("starts the count again after an hour without a wrong password", async () => {
    const { signIn, clock } = lockedApp()
    for (let attempt = 0; attempt < 5; attempt++) {
      await signIn(attempt, "alice@example.com", "wrong-horse")
    }
    clock.ms += 60 * 60_000
    const statuses = []
    for (let attempt = 5; attempt < 10; attempt++) {
      statuses.push((await signIn(attempt, "alice@example.com", "wrong-horse")).status)
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401])
    expect((await signIn(10, "alice@example.com", RIGHT)).status).toBe(200)
  })

  it("answers 429 with Retry-After while the name is locked, without checking the password", async () => {
    const { app, calls, passwordFailureCalls } = buildApp(null, { passwordLockedForMs: 90_500 })
    const response = await send(app, signInRoute, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("91")
    expect(await apiError(response)).toMatchObject({
      message: "Too many wrong passwords. Try again in 2 minutes.",
    })
    expect(passwordFailureCalls).toEqual(["begin"])
    expect(calls).toEqual([])
  })

  it("counts the check before the password is looked at and gives the slot back after a right one", async () => {
    const { app, passwordFailureCalls } = buildApp(null)
    await send(app, signInRoute, sameOriginWithoutCookieHeaders)

    expect(passwordFailureCalls).toEqual(["begin", "refund"])
  })

  it("records a wrong password", async () => {
    const { app, passwordFailureCalls } = buildApp(null, { succeed: false })
    await send(app, signInRoute, sameOriginWithoutCookieHeaders)

    expect(passwordFailureCalls).toEqual(["begin", "fail"])
  })
})

describe("auth routes reset a password by e-mail link", () => {
  const forgot = anonymousRoutes.find((route) => route.path === "/auth/password/forgot")!
  const reset = anonymousRoutes.find((route) => route.path === "/auth/password/reset")!
  const json = (body: unknown) => ({ ...forgot, body })

  it("queues the link for the address as normalizeEmail leaves it", async () => {
    const { app, queued } = buildApp(null)

    const response = await send(
      app,
      json({ email: "  Alice@Example.COM " }),
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(200)
    expect(queued).toEqual(["alice@example.com"])
  })

  it("answers with the same body whatever the address, so it tells nothing about an account", async () => {
    const { app } = buildApp(null)
    const bodies = []
    for (const email of ["alice@example.com", "nobody@example.com"]) {
      const response = await send(app, json({ email }), sameOriginWithoutCookieHeaders)
      bodies.push({ status: response.status, body: await response.json() })
    }

    expect(bodies[0]).toEqual({ status: 200, body: PASSWORD_RESET_REQUESTED })
    expect(bodies[1]).toEqual(bodies[0])
  })

  it("refuses a value that is not an e-mail address with 400 and queues nothing", async () => {
    const { app, calls } = buildApp(null)

    const response = await send(app, json({ email: "alice" }), sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it(`answers request ${RESET_MAILS_PER_ADDRESS + 1} for one address in an hour with 429, from any IP`, async () => {
    const { app, queued } = buildApp(null)
    const statuses = []
    for (let attempt = 0; attempt <= RESET_MAILS_PER_ADDRESS; attempt++) {
      const headers = { ...sameOriginWithoutCookieHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
      // The case changes too: the budget belongs to the normalised address.
      const email = attempt % 2 ? "ALICE@example.com" : "alice@example.com"
      statuses.push((await send(app, json({ email }), headers)).status)
    }

    expect(statuses).toEqual([...Array(RESET_MAILS_PER_ADDRESS).fill(200), 429])
    expect(queued).toHaveLength(RESET_MAILS_PER_ADDRESS)
  })

  it("gives each address its own reset budget", async () => {
    const { app, queued } = buildApp(null)
    for (let attempt = 0; attempt < RESET_MAILS_PER_ADDRESS; attempt++) {
      await send(app, json({ email: "alice@example.com" }), sameOriginWithoutCookieHeaders)
    }

    const other = await send(
      app,
      json({ email: "bob@example.com" }),
      sameOriginWithoutCookieHeaders,
    )

    expect(other.status).toBe(200)
    expect(queued.at(-1)).toBe("bob@example.com")
  })

  it("refuses a reset request without queueing it while the address budget's store is down", async () => {
    const { app, calls } = buildApp(null, {
      rateLimits: createAuthRateLimits({
        ...generousLimits,
        store: (name) => name === "ratelimit-reset" ? brokenStore() : memoryStore(),
      }),
    })

    const response = await send(app, forgot, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(500)
    expect(calls).toEqual([])
  })

  it("answers a link the sign-in refuses with 400 and says to ask for a new one", async () => {
    const { app, calls } = buildApp(null, { succeed: false })

    const response = await send(app, reset, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PASSWORD_RESET_REFUSED)
    expect(calls).toEqual(["resetPassword"])
  })

  it("refuses a new password shorter than 8 characters before spending the link", async () => {
    const { app, calls } = buildApp(null)

    const response = await send(
      app,
      { ...reset, body: { ...resetBody, newPassword: "short" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })
})

describe("auth routes sign in and sign up by e-mail link (#391)", () => {
  const request = anonymousRoutes.find((route) => route.path === "/auth/link")!
  const redeem = anonymousRoutes.find((route) => route.path === "/auth/link/redeem")!
  /** The headers of an anonymous request from `ip`. */
  const from = (ip: string) => ({ ...sameOriginWithoutCookieHeaders, "x-real-ip": ip })
  const askFor = (body: unknown, ip = "192.0.2.1") => ({ route: { ...request, body }, ip })

  it("answers the same for every address and queues the link with the address normalised", async () => {
    const { app, links } = buildApp(null)
    const answers = []
    for (const email of ["  Known@Example.com ", "nobody@example.com"]) {
      const { route, ip } = askFor({ email })
      const response = await send(app, route, from(ip))
      answers.push({ status: response.status, body: await response.json() })
    }

    expect(answers).toEqual([
      { status: 200, body: SIGN_IN_LINK_REQUESTED },
      { status: 200, body: SIGN_IN_LINK_REQUESTED },
    ])
    expect(links.map((link) => link.email)).toEqual(["known@example.com", "nobody@example.com"])
  })

  it("keeps a page of the app as the link's next page and drops any other", async () => {
    const { app, links } = buildApp(null)
    for (const next of ["/notes?tag=work", "//evil.example.com", "/api/auth/me"]) {
      const { route, ip } = askFor({ email: "alice@example.com", next })
      await send(app, route, from(ip))
    }

    expect(links.map((link) => link.next)).toEqual(["/notes?tag=work", null, null])
  })

  it("refuses an address it cannot normalise, and queues nothing", async () => {
    const { app, links } = buildApp(null)
    const { route, ip } = askFor({ email: "not an address" })
    const response = await send(app, route, from(ip))

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(SIGN_IN_LINK_BAD_ADDRESS)
    expect(links).toEqual([])
  })

  it("leaves the address's owner a link after a stranger keeps asking for it", async () => {
    const { app, links } = buildApp(null)
    const stranger = []
    for (let attempt = 0; attempt <= SIGN_IN_LINK_MAILS_PER_ADDRESS; attempt++) {
      const { route } = askFor({ email: "alice@example.com" })
      stranger.push((await send(app, route, from("192.0.2.1"))).status)
    }
    const owner = await send(
      app,
      askFor({ email: "alice@example.com" }).route,
      from("198.51.100.7"),
    )

    expect(stranger).toEqual([
      ...Array(SIGN_IN_LINK_MAILS_PER_CLIENT).fill(200),
      ...Array(SIGN_IN_LINK_MAILS_PER_ADDRESS + 1 - SIGN_IN_LINK_MAILS_PER_CLIENT).fill(429),
    ])
    expect(owner.status).toBe(200)
    expect(links).toHaveLength(SIGN_IN_LINK_MAILS_PER_CLIENT + 1)
  })

  it("caps one address's links from many networks together, and says how long to wait", async () => {
    const { app } = buildApp(null)
    const statuses = []
    for (let network = 1; statuses.length < SIGN_IN_LINK_MAILS_PER_ADDRESS; network++) {
      for (let mail = 0; mail < SIGN_IN_LINK_MAILS_PER_CLIENT; mail++) {
        const { route } = askFor({ email: "alice@example.com" })
        statuses.push((await send(app, route, from(`192.0.2.${network}`))).status)
      }
    }
    const refused = await send(
      app,
      askFor({ email: "alice@example.com" }).route,
      from("198.51.100.7"),
    )
    const otherAddress = await send(
      app,
      askFor({ email: "bob@example.com" }).route,
      from("198.51.100.7"),
    )

    expect(statuses.slice(0, SIGN_IN_LINK_MAILS_PER_ADDRESS)).not.toContain(429)
    expect(refused.status).toBe(429)
    expect(refused.headers.get("retry-after")).not.toBe(null)
    expect((await apiError(refused)).message).toMatch(
      /^Too many links were asked for this address\. Try again in \d+ minutes?\.$/,
    )
    expect(otherAddress.status).toBe(200)
  })

  it("answers a used, expired or unknown link with one refusal", async () => {
    const { app } = buildApp(null, { succeed: false })
    const response = await send(app, redeem, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(410)
    expect((await apiError(response)).message).toBe(SIGN_IN_LINK_REFUSED)
  })

  it("answers a signed-in link with the address, the next page and whether a code is owed", async () => {
    const { app } = buildApp(null, { secondFactor: SecondFactorStatus.Pending })
    const response = await send(app, redeem, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      email: "alice@example.com",
      next: "/notes",
      created: false,
      secondFactorPending: true,
    })
  })

  it("says a new account was made, and sends a guest whose address is taken to the switch", async () => {
    const created = buildApp(null, {
      signIn: {
        redeemSignInLink: async () => ({
          outcome: SignInLinkOutcome.Created,
          signedIn: buildAuthData(),
          email: "new@example.com",
          next: null,
        }),
      },
    })
    const taken = buildApp(null, {
      signIn: {
        redeemSignInLink: () =>
          Promise.resolve({ outcome: SignInLinkOutcome.GuestTaken, next: null }),
      },
    })

    const made = await send(created.app, redeem, sameOriginWithoutCookieHeaders)
    const switched = await send(taken.app, redeem, sameOriginWithoutCookieHeaders)

    expect(await made.json()).toEqual({
      email: "new@example.com",
      next: null,
      created: true,
      secondFactorPending: false,
    })
    expect(await switched.json()).toEqual({ guestTaken: true })
  })

  it("tells the mailbox's holder that an unconfirmed account uses the address", async () => {
    const { app } = buildApp(null, {
      signIn: {
        redeemSignInLink: () => Promise.resolve({ outcome: SignInLinkOutcome.Unconfirmed }),
      },
    })
    const response = await send(app, redeem, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(SIGN_IN_LINK_UNCONFIRMED)
  })
})

describe("auth routes sign up with an e-mail address", () => {
  const signUp = anonymousRoutes.find((route) => route.path === "/auth/password/sign-up")!
  const signInRoute = anonymousRoutes.find((route) => route.path === "/auth/password/check")!

  it("signs up with the address as normalizeEmail leaves it", async () => {
    const { app, logins } = buildApp(null)

    const response = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "  Ada@Example.COM " } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(200)
    expect(logins).toEqual(["ada@example.com"])
  })

  it("refuses a sign-up with a username instead of an address with 400, before sign-up runs", async () => {
    const { app, calls } = buildApp(null)

    const response = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "ada" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  it("hands sign-in the login as typed, so an older account's username still reaches it", async () => {
    const { app, logins } = buildApp(null)

    const response = await send(
      app,
      { ...signInRoute, body: { login: "Ada", password: "correct-horse" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(response.status).toBe(200)
    expect(logins).toEqual(["Ada"])
  })
})

describe("auth routes prove the address before a sign-up creates anything (#142)", () => {
  const route = (path: string) => anonymousRoutes.find((candidate) => candidate.path === path)!
  const signUp = route("/auth/password/sign-up")
  const verify = route("/auth/password/sign-up/verify")
  const resend = route("/auth/password/sign-up/resend")

  it("answers a free and a taken address alike, with the same body and no session", async () => {
    const { app, calls } = buildApp(null)
    const answers = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const response = await send(
        app,
        { ...signUp, body: { ...signUpBody, email } },
        sameOriginWithoutCookieHeaders,
      )
      answers.push({ status: response.status, body: await response.text() })
    }

    expect(answers[0]).toEqual({ status: 200, body: JSON.stringify(SIGN_UP_REQUESTED) })
    expect(answers[1]).toEqual(answers[0])
    expect(calls).toEqual(["requestSignUp", "requestSignUp"])
  })

  it("refuses past one client's code budget for an address with one answer for every address", async () => {
    const { app, calls } = buildApp(null)
    const refusals = []
    for (const email of ["free@example.com", "taken@example.com"]) {
      const body = { ...signUpBody, email }
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        await send(app, { ...signUp, body }, sameOriginWithoutCookieHeaders)
      }
      const refused = await send(app, { ...signUp, body }, sameOriginWithoutCookieHeaders)
      refusals.push({
        status: refused.status,
        retryAfter: refused.headers.get("retry-after"),
        // Only the request's own id may differ between the two addresses.
        body: { ...await apiError(refused), requestId: undefined },
      })
    }

    expect(refusals[0].status).toBe(429)
    expect(refusals[0].body).toMatchObject({
      code: "rate_limited",
      message: SIGN_UP_CODES_TOO_MANY,
    })
    expect(refusals[1]).toEqual(refusals[0])
    expect(calls).toEqual(Array(2 * SIGN_UP_CODE_MAILS_PER_CLIENT).fill("requestSignUp"))
  })

  /** The headers of an anonymous request from `ip`. */
  const from = (ip: string) => ({ ...sameOriginWithoutCookieHeaders, "x-real-ip": ip })

  it("leaves the address's owner a code after a stranger keeps signing the address up (#494)", async () => {
    const { app, calls } = buildApp(null)
    const stranger = []
    for (let attempt = 0; attempt <= SIGN_UP_CODE_MAILS_PER_ADDRESS; attempt++) {
      stranger.push((await send(app, signUp, from("192.0.2.1"))).status)
    }
    const owner = await send(app, signUp, from("198.51.100.7"))

    expect(stranger).toEqual([
      ...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200),
      ...Array(SIGN_UP_CODE_MAILS_PER_ADDRESS + 1 - SIGN_UP_CODE_MAILS_PER_CLIENT).fill(429),
    ])
    expect(owner.status).toBe(200)
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT + 1).fill("requestSignUp"))
  })

  it("counts every /64 of one IPv6 /48 as one client (#176)", async () => {
    const { app } = buildApp(null)
    const statuses = []
    for (let attempt = 0; attempt <= SIGN_UP_CODE_MAILS_PER_CLIENT; attempt++) {
      // A different /64 each time, all inside 2001:db8:1::/48, as one tunnel broker's /48 gives.
      statuses.push((await send(app, signUp, from(`2001:db8:1:${attempt + 1}::1`))).status)
    }
    const nextNetwork = await send(app, signUp, from(`2001:db8:2::1`))

    expect(statuses).toEqual([...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200), 429])
    expect(nextNetwork.status).toBe(200)
  })

  it("leaves the address's owner a code after a stranger signs it up from every /64 of one /48 (#176)", async () => {
    const { app, calls } = buildApp(null)
    const stranger = []
    // More /64s than the address's whole total, so per /64 the stranger would spend all of it.
    for (let network = 1; network <= SIGN_UP_CODE_MAILS_PER_ADDRESS + 1; network++) {
      stranger.push((await send(app, signUp, from(`2001:db8:1:${network.toString(16)}::1`))).status)
    }
    const owner = await send(app, signUp, from(`2001:db8:feed::7`))

    expect(stranger.filter((status) => status === 200)).toHaveLength(SIGN_UP_CODE_MAILS_PER_CLIENT)
    expect(owner.status).toBe(200)
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT + 1).fill("requestSignUp"))
  })

  it("caps sign-up codes to one address from many networks together", async () => {
    const { app, calls } = buildApp(null)
    const statuses = []
    for (let network = 1; statuses.length <= SIGN_UP_CODE_MAILS_PER_ADDRESS; network++) {
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        statuses.push((await send(app, signUp, from(`192.0.2.${network}`))).status)
      }
    }
    const fresh = await send(app, signUp, from("198.51.100.7"))
    const otherAddress = await send(
      app,
      { ...signUp, body: { ...signUpBody, email: "bob@example.com" } },
      from("198.51.100.7"),
    )

    expect(statuses.slice(0, SIGN_UP_CODE_MAILS_PER_ADDRESS)).toEqual(
      Array(SIGN_UP_CODE_MAILS_PER_ADDRESS).fill(200),
    )
    expect(statuses.slice(SIGN_UP_CODE_MAILS_PER_ADDRESS)).not.toContain(200)
    expect(fresh.status).toBe(429)
    expect(otherAddress.status).toBe(200)
    expect(calls).toHaveLength(SIGN_UP_CODE_MAILS_PER_ADDRESS + 1)
  })

  it("leaves a signed-in account's own code budget whole after strangers sign its address up", async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const anonymous = buildApp(null, { rateLimits })
    for (let network = 1; network <= 4; network++) {
      for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
        await send(anonymous.app, signUp, from(`192.0.2.${network}`))
      }
    }
    const signedIn = buildApp(undefined, { rateLimits })
    const sendCode = sessionRoutes.find((candidate) => candidate.path === "/auth/email/send")!
    const response = await send(signedIn.app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(signedIn.mailed).toEqual(["alice@example.com"])
  })

  it("signs in the account a right code created", async () => {
    const { app } = buildApp(null)
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty("id")
  })

  it("tells the holder of the mailbox how the account that uses the address signs in", async () => {
    const { app } = buildApp(null, {
      signIn: {
        completeSignUp: () =>
          Promise.resolve({
            outcome: SignUpOutcome.AccountExists,
            email: "alice@example.com",
            account: { userId: 7, password: false, providers: ["google"] },
          }),
      },
    })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      accountExists: { email: "alice@example.com", password: false, providers: ["google"] },
    })
  })

  it("answers a wrong code with the e-mail code message", async () => {
    const { app } = buildApp(null, { succeed: false })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_CODE_REFUSED)
  })

  it("answers 410 when no sign-up waits for a code", async () => {
    const { app } = buildApp(null, {
      signIn: { completeSignUp: () => Promise.resolve({ outcome: SignUpOutcome.Expired }) },
    })
    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(410)
    expect((await apiError(response)).message).toBe(SIGN_UP_EXPIRED)
  })

  it("sends no new code when no sign-up waits", async () => {
    const { app, calls } = buildApp(null, {
      signIn: { waitingSignUp: () => Promise.resolve(null) },
    })
    const response = await send(app, resend, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(410)
    expect(calls).toEqual([])
  })

  it("spends the client's sign-up code budget for the waiting address on a new code", async () => {
    const { app, calls } = buildApp(null)
    const statuses = []
    for (let mail = 0; mail <= SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
      statuses.push((await send(app, resend, sameOriginWithoutCookieHeaders)).status)
    }

    expect(statuses).toEqual([...Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill(200), 429])
    expect(calls).toEqual(Array(SIGN_UP_CODE_MAILS_PER_CLIENT).fill("resendSignUpCode"))
  })

  it("shares one client's sign-up code budget between a sign-up and its new codes", async () => {
    const { app } = buildApp(null)
    for (let mail = 0; mail < SIGN_UP_CODE_MAILS_PER_CLIENT; mail++) {
      await send(app, signUp, sameOriginWithoutCookieHeaders)
    }
    const response = await send(app, resend, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(429)
  })

  it("reads back the waiting sign-up's address for the page that asks for the code", async () => {
    const { app } = buildApp(null)
    const response = await app.request(`${API_URL}/auth/password/sign-up`)

    expect(await response.json()).toEqual({
      pending: { email: "alice@example.com", expiresAt: WAITING_UNTIL.toISOString() },
    })
  })
})

describe("auth routes prove an e-mail address with a code", () => {
  const route = (path: string) => sessionRoutes.find((candidate) => candidate.path === path)!
  const verify = route("/auth/email/verify")
  const sendCode = route("/auth/email/send")
  const change = route("/auth/email/change")

  it("counts a code check before running it and gives the slot back when the code is right", async () => {
    const { app, codeFailureCalls } = buildApp()
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(codeFailureCalls).toEqual(["begin", "refund"])
  })

  it("answers a wrong or expired code with one message and records the failure", async () => {
    const { app, codeFailureCalls } = buildApp(undefined, { succeed: false })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_CODE_REFUSED)
    expect(codeFailureCalls).toEqual(["begin", "fail"])
  })

  it("answers 429 with Retry-After while the user is locked, without checking the code", async () => {
    const { app, calls, codeFailureCalls } = buildApp(undefined, { codeLockedForMs: 60_200 })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("61")
    expect(codeFailureCalls).toEqual(["begin"])
    expect(calls).toEqual([])
  })

  it("answers 409 when a right code proves an address another account owns", async () => {
    const { app, codeFailureCalls } = buildApp(undefined, {
      signIn: { verifyEmail: () => Promise.resolve(EmailVerifyOutcome.Taken) },
    })
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(EMAIL_TAKEN)
    expect(codeFailureCalls).toEqual(["begin", "refund"])
  })

  it("queues a new code for the unproven address", async () => {
    const { app, mailed } = buildApp()
    const response = await send(app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(mailed).toEqual(["alice@example.com"])
  })

  it("queues a new code for the address waiting to replace a proven one", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: "new@example.com" }) },
    })
    await send(app, sendCode, sameOriginHeaders)

    expect(mailed).toEqual(["new@example.com"])
  })

  it("queues no code when the address is proven and no change waits", async () => {
    const { app, mailed } = buildApp(undefined, { succeed: false })
    const response = await send(app, sendCode, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_NOTHING_TO_VERIFY)
    expect(mailed).toEqual([])
  })

  it(`answers code mail ${EMAIL_CODE_MAILS_PER_ADDRESS + 1} to one address in an hour with 429`, async () => {
    const { app, mailed } = buildApp()
    const statuses = []
    for (let attempt = 0; attempt <= EMAIL_CODE_MAILS_PER_ADDRESS; attempt++) {
      statuses.push((await send(app, sendCode, sameOriginHeaders)).status)
    }

    expect(statuses).toEqual([...Array(EMAIL_CODE_MAILS_PER_ADDRESS).fill(200), 429])
    expect(mailed).toHaveLength(EMAIL_CODE_MAILS_PER_ADDRESS)
  })

  it(`answers address change ${EMAIL_CHANGE_MAILS_PER_ACCOUNT + 1} from one account to one address in an hour with 429`, async () => {
    const { app, mailed } = buildApp()
    const statuses = []
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      statuses.push((await send(app, change, sameOriginHeaders)).status)
    }
    const refused = await send(app, change, sameOriginHeaders)

    expect(statuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    expect(refused.headers.get("retry-after")).toMatch(/^\d+$/)
    expect(mailed).toHaveLength(EMAIL_CHANGE_MAILS_PER_ACCOUNT)
  })

  it(`leaves the owner a code and a reset link after ${EMAIL_CHANGE_MAILS_PER_ACCOUNT} requests from another account to move to their address`, async () => {
    // One set of limits, as one API process holds; the stranger is user 2, the owner user 1.
    const rateLimits = createAuthRateLimits(generousLimits)
    const owned = "alice@example.com"
    const stranger = buildApp(buildAuthData({ user: { id: 2 } }), {
      rateLimits,
      signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: owned }) },
    })
    const toOwned = { ...change, body: { email: owned, password: "correct-horse" } }
    const strangerStatuses = []
    for (let attempt = 0; attempt < EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      strangerStatuses.push((await send(stranger.app, toOwned, sameOriginHeaders)).status)
    }
    // A resend of the stranger's pending change spends the stranger's budget too.
    const resend = await send(stranger.app, sendCode, sameOriginHeaders)
    strangerStatuses.push(resend.status)
    const owner = buildApp(undefined, { rateLimits })
    const anonymous = buildApp(null, { rateLimits })

    const code = await send(owner.app, sendCode, sameOriginHeaders)
    const reset = await send(
      anonymous.app,
      { method: "POST", path: "/auth/password/forgot", body: { email: owned } },
      sameOriginWithoutCookieHeaders,
    )

    expect(reset.status).toBe(200)
    expect(anonymous.queued).toEqual([owned])
    expect(code.status).toBe(200)
    expect(owner.mailed).toEqual([owned])
    expect(strangerStatuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    // The same words as a refused change, so a refusal tells nothing about who owns the address.
    expect((await apiError(resend)).message).toBe(EMAIL_CHANGE_TOO_MANY)
  })

  it(`answers change mail ${EMAIL_CHANGE_MAILS_PER_ADDRESS + 1} to one address from as many accounts with 429, and leaves the owner a code and a reset link`, async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const owned = "alice@example.com"
    const toOwned = { ...change, body: { email: owned, password: "correct-horse" } }
    const responses = []
    let strangerMails = 0
    // Users 2, 3, … each ask once, so no account's own budget is near its end.
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ADDRESS; attempt++) {
      const stranger = buildApp(buildAuthData({ user: { id: attempt + 2 } }), { rateLimits })
      responses.push(await send(stranger.app, toOwned, sameOriginHeaders))
      strangerMails += stranger.mailed.length
    }
    const owner = buildApp(undefined, { rateLimits })
    const anonymous = buildApp(null, { rateLimits })

    const code = await send(owner.app, sendCode, sameOriginHeaders)
    const reset = await send(
      anonymous.app,
      { method: "POST", path: "/auth/password/forgot", body: { email: owned } },
      sameOriginWithoutCookieHeaders,
    )

    expect(responses.map((response) => response.status))
      .toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ADDRESS).fill(200), 429])
    expect(await apiError(responses.at(-1)!)).toMatchObject({ message: EMAIL_CHANGE_TOO_MANY })
    expect(strangerMails).toBe(EMAIL_CHANGE_MAILS_PER_ADDRESS)
    expect(code.status).toBe(200)
    expect(owner.mailed).toEqual([owned])
    expect(reset.status).toBe(200)
    expect(anonymous.queued).toEqual([owned])
  })

  it("gives each account its own change budget, whatever the addresses", async () => {
    const rateLimits = createAuthRateLimits(generousLimits)
    const changeTo = (email: string) => ({
      ...change,
      body: { email, password: "correct-horse" },
    })
    const first = buildApp(buildAuthData({ user: { id: 2 } }), { rateLimits })
    const second = buildApp(buildAuthData({ user: { id: 3 } }), { rateLimits })
    const firstStatuses = []
    // A new address each time, so only the account's budget runs out.
    for (let attempt = 0; attempt <= EMAIL_CHANGE_MAILS_PER_ACCOUNT; attempt++) {
      const email = `first-${attempt}@example.com`
      firstStatuses.push((await send(first.app, changeTo(email), sameOriginHeaders)).status)
    }

    const other = await send(second.app, changeTo("second@example.com"), sameOriginHeaders)

    expect(firstStatuses).toEqual([...Array(EMAIL_CHANGE_MAILS_PER_ACCOUNT).fill(200), 429])
    expect(other.status).toBe(200)
    expect(second.mailed).toEqual(["second@example.com"])
  })

  for (const broken of ["ratelimit-email-change", "ratelimit-email-change-address"]) {
    it(`refuses an address change and a pending resend without mailing while ${broken} is down`, async () => {
      const { app, mailed } = buildApp(undefined, {
        rateLimits: createAuthRateLimits({
          ...generousLimits,
          store: (name) => name === broken ? brokenStore() : memoryStore(),
        }),
        signIn: { emailStatus: () => Promise.resolve({ ...PROVEN, pending: "new@example.com" }) },
      })

      const changed = await send(app, change, sameOriginHeaders)
      const resent = await send(app, sendCode, sameOriginHeaders)

      expect(changed.status).toBe(500)
      expect(resent.status).toBe(500)
      expect(mailed).toEqual([])
    })
  }

  it("queues a code for the new address as normalizeEmail leaves it", async () => {
    const { app, mailed } = buildApp()
    const response = await send(
      app,
      { ...change, body: { email: " New@Example.COM ", password: "correct-horse" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(200)
    expect(mailed).toEqual(["new@example.com"])
  })

  it("queues nothing when the password for an address change is wrong", async () => {
    const { app, mailed } = buildApp(undefined, { succeed: false })
    const response = await send(app, change, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(mailed).toEqual([])
  })

  it("queues nothing when the new address is the one the account has", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.Kept) },
    })
    const response = await send(app, change, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(mailed).toEqual([])
  })

  it("queues nothing when an account with no password has no recent provider sign-in", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.ProofRequired) },
    })
    const response = await send(
      app,
      { ...change, body: { email: "new@example.com" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PROVIDER_PROOF_REQUIRED)
    expect(mailed).toEqual([])
  })

  it("refuses, and queues nothing, when another sign-in method of the account carries the address", async () => {
    const { app, mailed } = buildApp(undefined, {
      signIn: { requestEmailChange: () => Promise.resolve(EmailChangeOutcome.AlreadyCarried) },
    })
    const response = await send(
      app,
      { ...change, body: { email: "new@example.com" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(EMAIL_ALREADY_CARRIED)
    expect(mailed).toEqual([])
  })

  it("announces a sign-out once a code proved a new address, so the other devices' sockets close", async () => {
    const { app, emitted } = buildApp()
    const response = await send(app, verify, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(emitted.map((event) => event.data.userId)).toEqual([buildAuthData().user.id])
  })

  it("announces no sign-out for a wrong code", async () => {
    const { app, emitted } = buildApp(undefined, { succeed: false })
    await send(app, verify, sameOriginHeaders)

    expect(emitted).toEqual([])
  })
})

describe("deleting one's own account", () => {
  const deletePath = "/auth/account/delete"
  const deleteRoute = { method: "POST", path: deletePath, body: { password: "correct-horse" } }
  const withCode = { ...deleteRoute, body: { password: "correct-horse", otp: "123456" } }
  const blocker = {
    groupId: "8c3f1d9e-6b2a-4c5d-9e8f-0a1b2c3d4e5f",
    name: "Family",
    reason: AccountDeletionBlockReason.Members,
    endsAt: null,
  }
  /** A session of a user with two-factor on, who gave the code at sign-in. */
  const twoFactorAuth = () =>
    buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Completed },
    })

  it("refuses a cross-site request with 403 and deletes nothing", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, deleteRoute, crossSiteHeaders)

    expect(response.status).toBe(403)
    expect(calls).toEqual([])
  })

  it("answers 401 without a session and deletes nothing", async () => {
    const { app, calls } = buildApp(null)
    const response = await send(app, deleteRoute, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("refuses a session that still owes its authenticator code and deletes nothing", async () => {
    const owing = buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Pending },
    })
    const { app, calls } = buildApp(owing)
    const response = await send(app, withCode, sameOriginHeaders)

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("names the groups that stop it with 409, before the password is checked", async () => {
    const { app, calls } = buildApp(undefined, {
      signIn: { accountDeletionBlockers: () => Promise.resolve([blocker]) },
    })
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      message: ACCOUNT_DELETE_BLOCKED,
      details: { blockers: [blocker] },
    })
    expect(calls).toEqual([])
  })

  it("refuses a wrong password with 400 and deletes nothing", async () => {
    const { app, calls, emitted } = buildApp(undefined, { succeed: false })
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Invalid password")
    expect(calls).toEqual(["accountDeletionBlockers", "checkPassword"])
    expect(emitted).toEqual([])
  })

  it("deletes an account that has no password after a provider sign-in a moment ago", async () => {
    const { app, calls, emitted } = buildApp(undefined, {
      signIn: {
        hasPassword: () => Promise.resolve(false),
        confirmedByProvider: () => Promise.resolve(true),
      },
    })
    const response = await send(app, { ...deleteRoute, body: {} }, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["accountDeletionBlockers", "deleteAccount"])
    expect(emitted.length).toBe(1)
  })

  it("refuses an account that has no password when its provider sign-in is not recent", async () => {
    const { app, calls, emitted } = buildApp(undefined, {
      signIn: { hasPassword: () => Promise.resolve(false) },
    })
    const response = await send(app, { ...deleteRoute, body: {} }, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PROVIDER_PROOF_REQUIRED)
    expect(calls).toEqual(["accountDeletionBlockers"])
    expect(emitted).toEqual([])
  })

  it("still asks an account that has a password for it after a provider sign-in", async () => {
    const { app, calls } = buildApp(undefined, {
      signIn: { confirmedByProvider: () => Promise.resolve(true) },
    })
    const response = await send(app, { ...deleteRoute, body: {} }, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe("Invalid password")
    expect(calls).toEqual(["accountDeletionBlockers"])
  })

  it("asks for the authenticator code when two-factor is on, and deletes nothing", async () => {
    const { app, calls } = buildApp(twoFactorAuth())
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(ACCOUNT_DELETE_CODE_REQUIRED)
    expect(calls).toEqual(["accountDeletionBlockers", "checkPassword"])
  })

  it("counts a wrong authenticator code and deletes nothing", async () => {
    const { app, calls, failureCalls } = buildApp(twoFactorAuth(), {
      signIn: { verifyTotpCode: () => Promise.resolve(false) },
    })
    const response = await send(app, withCode, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(failureCalls).toEqual(["begin", "fail"])
    expect(calls).not.toContain("deleteAccount")
  })

  it("refuses with 429 while wrong codes lock the user, without checking the code", async () => {
    const { app, calls } = buildApp(twoFactorAuth(), { lockedForMs: 60_000 })
    const response = await send(app, withCode, sameOriginHeaders)

    expect(response.status).toBe(429)
    expect(response.headers.get("Retry-After")).toBe("60")
    expect(calls).toEqual(["accountDeletionBlockers", "checkPassword"])
  })

  it("deletes with the password and the code, announces the sign-out and answers the day it goes", async () => {
    const { app, calls, emitted, failureCalls } = buildApp(twoFactorAuth())
    const response = await send(app, withCode, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      deleteAfter: DELETE_AFTER.toISOString(),
    })
    expect(calls).toEqual([
      "accountDeletionBlockers",
      "checkPassword",
      "verifyTotpCode",
      "deleteAccount",
    ])
    expect(failureCalls).toEqual(["begin", "refund"])
    expect(emitted.map((event) => event.data.userId)).toEqual([1])
  })

  it("deletes with the password alone when two-factor is off", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(calls).toEqual(["accountDeletionBlockers", "checkPassword", "deleteAccount"])
  })

  it("answers 409 when a group started to stop it while the password was checked", async () => {
    const { app, emitted } = buildApp(undefined, {
      signIn: { deleteAccount: () => Promise.resolve({ blockers: [blocker] }) },
    })
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(409)
    expect((await apiError(response)).details).toEqual({ blockers: [blocker] })
    expect(emitted).toEqual([])
  })

  it("lists the groups that stop it on GET /auth/account/deletion", async () => {
    const { app } = buildApp(undefined, {
      signIn: { accountDeletionBlockers: () => Promise.resolve([blocker]) },
    })
    const response = await app.request(`${API_URL}/auth/account/deletion`, {
      headers: { ...sameOriginHeaders },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ blockers: [blocker] })
  })
})

describe("a first password", () => {
  const setRoute = {
    method: "POST",
    path: "/auth/password/set",
    body: { newPassword: "battery-staple" },
  }

  it("sets it and says so", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, setRoute, sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(calls).toEqual(["setPassword"])
  })

  it("announces a sign-out once it is set, so the other devices' sockets close", async () => {
    const { app, emitted } = buildApp()
    await send(app, setRoute, sameOriginHeaders)

    expect(emitted.map((event) => event.data.userId)).toEqual([buildAuthData().user.id])
  })

  it("announces no sign-out when it is refused", async () => {
    const { app, emitted } = buildApp(undefined, { succeed: false })
    await send(app, setRoute, sameOriginHeaders)

    expect(emitted).toEqual([])
  })

  it("refuses a password shorter than eight characters without trying to set it", async () => {
    const { app, calls } = buildApp()
    const response = await send(
      app,
      { ...setRoute, body: { newPassword: "short" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })

  for (
    const [outcome, message] of [
      [PasswordSetOutcome.AlreadySet, PASSWORD_ALREADY_SET],
      [PasswordSetOutcome.ProofRequired, PROVIDER_PROOF_REQUIRED],
      [PasswordSetOutcome.NoAddress, PASSWORD_NEEDS_ADDRESS],
      [PasswordSetOutcome.Refused, PASSWORD_SET_REFUSED],
    ] as const
  ) {
    it(`answers 400 with "${message}"`, async () => {
      const { app } = buildApp(undefined, {
        signIn: { setPassword: () => Promise.resolve(outcome) },
      })
      const response = await send(app, setRoute, sameOriginHeaders)

      expect(response.status).toBe(400)
      expect((await apiError(response)).message).toBe(message)
    })
  }
})

describe("signed-in devices", () => {
  const endRoute = (id: string) => ({
    method: "DELETE",
    path: `/auth/sessions/${id}`,
    body: undefined,
  })
  const passwordRoute = (body: Record<string, unknown>) => ({
    method: "POST",
    path: "/auth/password/change",
    body: { password: "correct-horse", newPassword: "battery-staple", ...body },
  })

  it("lists the person's devices on GET /auth/sessions", async () => {
    const { app, calls } = buildApp()
    const response = await app.request(`${API_URL}/auth/sessions`, {
      headers: { ...sameOriginHeaders },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessions: [CURRENT_DEVICE, OTHER_DEVICE] })
    expect(calls).toEqual(["listSessions"])
  })

  it("answers GET /auth/sessions without a session with 401 and reads nothing", async () => {
    const { app, calls } = buildApp(null)
    const response = await app.request(`${API_URL}/auth/sessions`, {
      headers: { ...sameOriginWithoutCookieHeaders },
    })

    expect(response.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("refuses a session that still owes its authenticator code, and lists or ends nothing", async () => {
    const owing = buildAuthData({
      user: { mfa: UserMFAStatus.CONFIGURED },
      session: { secondFactor: SecondFactorStatus.Pending },
    })
    const { app, calls } = buildApp(owing)
    const listed = await app.request(`${API_URL}/auth/sessions`, {
      headers: { ...sameOriginHeaders },
    })
    const ended = await send(app, endRoute("others"), sameOriginHeaders)

    expect(listed.status).toBe(401)
    expect(ended.status).toBe(401)
    expect(calls).toEqual([])
  })

  it("ends another device's session and announces the sign-out so its socket closes", async () => {
    let ended: number | null = null
    const { app, emitted } = buildApp(undefined, {
      signIn: { endSession: (_c, _state, id) => (ended = id, Promise.resolve(true)) },
    })
    const response = await send(app, endRoute("2"), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(ended).toBe(2)
    expect(emitted.map((event) => event.data.userId)).toEqual([1])
  })

  it("answers a session of someone else exactly like a missing one, and announces nothing", async () => {
    const { app, emitted } = buildApp(undefined, { succeed: false })
    const foreign = await send(app, endRoute("2"), sameOriginHeaders)
    const missing = await send(app, endRoute("999999"), sameOriginHeaders)

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect((await apiError(foreign)).message).toBe(SESSION_NOT_FOUND)
    expect((await apiError(missing)).message).toBe(SESSION_NOT_FOUND)
    expect(emitted).toEqual([])
  })

  it("refuses to end this device's own session, which signing out does", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, endRoute("1"), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(SESSION_IS_CURRENT)
    expect(calls).toEqual([])
    expect(emitted).toEqual([])
  })

  for (const id of ["0", "abc", "1.5", "-2", "01", "2147483648", "99999999999"]) {
    it(`answers the id "${id}" with 404 without asking the database`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, endRoute(id), sameOriginHeaders)

      expect(response.status).toBe(404)
      expect((await apiError(response)).message).toBe(SESSION_NOT_FOUND)
      expect(calls).toEqual([])
    })
  }

  it("signs out every other device and announces it", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, endRoute("others"), sameOriginHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, ended: 1 })
    expect(calls).toEqual(["endOtherSessions"])
    expect(emitted.map((event) => event.data.userId)).toEqual([1])
  })

  it("announces nothing when there was no other device to sign out", async () => {
    const { app, emitted } = buildApp(undefined, {
      signIn: { endOtherSessions: () => Promise.resolve(0) },
    })
    const response = await send(app, endRoute("others"), sameOriginHeaders)

    expect(await response.json()).toEqual({ success: true, ended: 0 })
    expect(emitted).toEqual([])
  })

  it("signs the other devices out on a password change unless asked not to", async () => {
    const asked: (boolean | undefined)[] = []
    const { app, emitted } = buildApp(undefined, {
      signIn: {
        changePassword: (_c, _state, _old, _new, signOutOthers) => (
          asked.push(signOutOthers), Promise.resolve({ revokedTokens: 0 })
        ),
      },
    })
    await send(app, passwordRoute({}), sameOriginHeaders)
    expect(emitted).toHaveLength(1)
    await send(app, passwordRoute({ signOutOthers: true }), sameOriginHeaders)
    expect(emitted).toHaveLength(2)
    const kept = await send(app, passwordRoute({ signOutOthers: false }), sameOriginHeaders)

    expect(kept.status).toBe(200)
    expect(asked).toEqual([true, true, false])
    expect(emitted).toHaveLength(2)
  })

  it("answers a password change with how many API tokens it revoked", async () => {
    const { app } = buildApp()
    const response = await send(app, passwordRoute({}), sameOriginHeaders)

    expect(await response.json()).toEqual({ success: true, revokedTokens: 2 })
  })

  it("answers a wrong current password with 400, never 401, which would sign the page out", async () => {
    const { app } = buildApp(undefined, { succeed: false })
    const response = await send(app, passwordRoute({}), sameOriginHeaders)

    expect(response.status).toBe(400)
  })

  it("refuses a sign-out choice that is not true or false", async () => {
    const { app, calls } = buildApp()
    const response = await send(app, passwordRoute({ signOutOthers: "yes" }), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
  })
})
