import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { APIContext } from "../_types.ts"
import {
  EmailChangeOutcome,
  EmailVerifyOutcome,
  type SignedIn,
  type SignIn,
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
} from "../middlewares/auth-rate-limits.ts"
import type { Lockout } from "@spy4x/server/lockout"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import {
  ACCOUNT_DELETE_BLOCKED,
  ACCOUNT_DELETE_CODE_REQUIRED,
  createAuthRoute,
  EMAIL_CHANGE_TOO_MANY,
  EMAIL_CODE_REFUSED,
  EMAIL_NOTHING_TO_VERIFY,
  EMAIL_TAKEN,
  PASSWORD_RESET_REFUSED,
  PASSWORD_RESET_REQUESTED,
  SESSION_IS_CURRENT,
  SESSION_NOT_FOUND,
} from "./auth.ts"

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
): SignIn {
  const signedIn = (): Promise<SignedIn> => {
    const { user, session } = buildAuthData({ session: { secondFactor } })
    return Promise.resolve({ user, session })
  }
  return {
    auth: testSessionGuards(),
    signUp: (_c, email) => (
      calls.push("signUp"), logins.push(email), succeed ? signedIn() : Promise.resolve(null)
    ),
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
    changePassword: () => (calls.push("changePassword"), Promise.resolve(succeed)),
    resetPassword: () => (calls.push("resetPassword"), Promise.resolve(succeed)),
    checkPassword: () => (calls.push("checkPassword"), Promise.resolve(succeed)),
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
    signIn: overrides = {},
    queueFails = false,
  }: {
    rateLimits?: AuthRateLimits
    /** How long the failure counter says the user is locked; 0 or left out means not locked. */
    lockedForMs?: number
    /** The same for the e-mail code counter. */
    codeLockedForMs?: number
    succeed?: boolean
    /** The second-factor state of the session that `signIn` and `signUp` hand back. */
    secondFactor?: SecondFactorStatus
    /** Replaces operations of the fake sign-in. */
    signIn?: Partial<SignIn>
    /** Queueing a code mail fails. */
    queueFails?: boolean
  } = {},
) {
  const calls: string[] = []
  const failureCalls: string[] = []
  const codeFailureCalls: string[] = []
  /** Every address a code mail was queued for, and every error the route logged. */
  const mailed: string[] = []
  const logged: string[] = []
  /** Every address a reset link was queued for, as the route passed it. */
  const queued: string[] = []
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
    requestPasswordReset: (email) => (
      calls.push("requestPasswordReset"), queued.push(email), Promise.resolve()
    ),
    emailCodeFailures: fakeTotpFailures(codeFailureCalls, codeLockedForMs),
    requestEmailCode: (_userId, email) =>
      queueFails
        ? Promise.reject(new Error("outbox down"))
        : (mailed.push(email), Promise.resolve()),
    logError: (message) => void logged.push(message),
  })
  return {
    app: mountRoute("/auth", route, auth),
    calls,
    failureCalls,
    codeFailureCalls,
    queued,
    logins,
    mailed,
    logged,
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
  { method: "POST", path: "/auth/password/sign-up", body: signUpBody, operation: "signUp" },
  {
    method: "POST",
    path: "/auth/password/forgot",
    body: { email: "alice@example.com" },
    operation: "requestPasswordReset",
  },
  { method: "POST", path: "/auth/password/reset", body: resetBody, operation: "resetPassword" },
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
    body: undefined,
    operation: "connectTotpStart",
  },
  {
    method: "POST",
    path: "/auth/totp/connect/finish",
    body: { otp: "123456" },
    operation: "connectTotpFinish",
  },
  { method: "POST", path: "/auth/totp/disconnect", body: undefined, operation: "disconnectTotp" },
  {
    method: "POST",
    path: "/auth/password/change",
    body: { password: "correct-horse", newPassword: "battery-staple" },
    operation: "changePassword",
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
        requestPasswordReset: () => Promise.resolve(),
        emailCodeFailures: fakeTotpFailures([]),
        requestEmailCode: () => Promise.resolve(),
        logError: () => {},
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
    expect(await response.json()).toEqual({ error: PASSWORD_RESET_REFUSED })
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

describe("auth routes prove an e-mail address with a code", () => {
  const route = (path: string) => sessionRoutes.find((candidate) => candidate.path === path)!
  const verify = route("/auth/email/verify")
  const sendCode = route("/auth/email/send")
  const change = route("/auth/email/change")
  const signUp = anonymousRoutes.find((candidate) => candidate.path === "/auth/password/sign-up")!

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
    expect(await response.json()).toEqual({ error: EMAIL_CODE_REFUSED })
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
    expect(await response.json()).toEqual({ error: EMAIL_TAKEN })
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
    expect(await response.json()).toEqual({ error: EMAIL_NOTHING_TO_VERIFY })
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
    expect(await resend.json()).toEqual({ error: EMAIL_CHANGE_TOO_MANY })
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
    expect(await responses.at(-1)!.json()).toEqual({ error: EMAIL_CHANGE_TOO_MANY })
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

  it("queues a code for the address a new account signed up with", async () => {
    const { app, mailed } = buildApp(null)
    await send(
      app,
      { ...signUp, body: { ...signUpBody, email: " Ada@Example.COM" } },
      sameOriginWithoutCookieHeaders,
    )

    expect(mailed).toEqual(["ada@example.com"])
  })

  it("keeps a sign-up and logs the error when its code mail cannot be queued", async () => {
    const { app, logged } = buildApp(null, { queueFails: true })
    const response = await send(app, signUp, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(logged).toEqual(["error: the code mail after a sign-up was not queued"])
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
    expect(await response.json()).toEqual({ error: ACCOUNT_DELETE_BLOCKED, blockers: [blocker] })
    expect(calls).toEqual([])
  })

  it("refuses a wrong password with 400 and deletes nothing", async () => {
    const { app, calls, emitted } = buildApp(undefined, { succeed: false })
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid password" })
    expect(calls).toEqual(["accountDeletionBlockers", "checkPassword"])
    expect(emitted).toEqual([])
  })

  it("asks for the authenticator code when two-factor is on, and deletes nothing", async () => {
    const { app, calls } = buildApp(twoFactorAuth())
    const response = await send(app, deleteRoute, sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: ACCOUNT_DELETE_CODE_REQUIRED })
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
    expect((await response.json()).blockers).toEqual([blocker])
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
    expect(await foreign.json()).toEqual({ error: SESSION_NOT_FOUND })
    expect(await missing.json()).toEqual({ error: SESSION_NOT_FOUND })
    expect(emitted).toEqual([])
  })

  it("refuses to end this device's own session, which signing out does", async () => {
    const { app, calls, emitted } = buildApp()
    const response = await send(app, endRoute("1"), sameOriginHeaders)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: SESSION_IS_CURRENT })
    expect(calls).toEqual([])
    expect(emitted).toEqual([])
  })

  for (const id of ["0", "abc", "1.5", "-2", "01", "2147483648", "99999999999"]) {
    it(`answers the id "${id}" with 404 without asking the database`, async () => {
      const { app, calls } = buildApp()
      const response = await send(app, endRoute(id), sameOriginHeaders)

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: SESSION_NOT_FOUND })
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
          asked.push(signOutOthers), Promise.resolve(true)
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
