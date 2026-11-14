import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { SignIn } from "../services/sign-in.ts"
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
} from "../_testing/mutation-requests.ts"
import { MALFORMED_JSON, oversizedJson } from "../_testing/json-bodies.ts"
import { createAuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { createLockout } from "@spy4x/server/lockout"
import { MemoryLockoutStore } from "@spy4x/server/lockout/memory-store"
import { PASSWORD_LOCK_POLICY } from "../services/password-failures.ts"
import { PasswordLockedError } from "../services/password-locked.ts"
import type { RateLimitStore } from "@spy4x/platform/rate-limit"
import { createAuthRoute } from "./auth.ts"
import { DEMO_ADMIN_ELSEWHERE } from "../middlewares/admin-host.ts"
import { PUBLIC_DEMO_ADMIN } from "@server/auth/demo-accounts.ts"
import { apiError } from "../_testing/api-error.ts"
import {
  anonymousRoutes,
  brokenStore,
  buildApp,
  callsOf,
  credentials,
  fakeSignIn,
  fakeTotpFailures,
  memoryStore,
  send,
  sessionRoutes,
  withEmail,
} from "../_testing/auth-routes.ts"

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

describe("auth routes on the public demo (docs/demo.md)", () => {
  /** The request's own host, so the test's same-origin headers still pass the mutation guard. */
  const HERE = new URL(API_URL).host
  const demoLogin = { login: ` Demo-Admin@Example.com `, password: PUBLIC_DEMO_ADMIN.password }
  const checkPassword = (app: ReturnType<typeof buildApp>["app"], body: unknown) =>
    app.request(`${API_URL}/auth/password/check`, {
      method: "POST",
      headers: { ...sameOriginWithoutCookieHeaders, "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  it("publishes the public admin account only while the demo is on", async () => {
    const off = buildApp(null).app
    const on = buildApp(null, { demo: { adminHost: HERE } }).app

    expect(await (await off.request(`${API_URL}/auth/demo`)).json()).toEqual({ admin: null })
    expect(await (await on.request(`${API_URL}/auth/demo`)).json()).toEqual({
      admin: { email: PUBLIC_DEMO_ADMIN.email, password: PUBLIC_DEMO_ADMIN.password },
    })
  })

  it("refuses the public admin account's sign-in outside the admin host, password unchecked", async () => {
    for (const adminHost of [`admin.example.com`, null]) {
      const { app, calls } = buildApp(null, { demo: { adminHost } })
      const response = await checkPassword(app, demoLogin)

      expect(response.status).toBe(403)
      expect(await apiError(response)).toMatchObject({
        message: DEMO_ADMIN_ELSEWHERE,
        reason: "DEMO_ADMIN_ELSEWHERE",
      })
      expect(calls).toEqual([])
    }
  })

  it("signs the public admin account in on the admin host, with no lock on its name", async () => {
    const { app, passwordFailureCalls } = buildApp(null, {
      demo: { adminHost: HERE },
      passwordLockedForMs: 60_000,
    })

    expect((await checkPassword(app, demoLogin)).status).toBe(200)
    expect(passwordFailureCalls).toEqual([])
  })

  it("answers a wrong password for the public admin account with 401 and counts nothing", async () => {
    const { app, passwordFailureCalls } = buildApp(null, {
      demo: { adminHost: HERE },
      succeed: false,
    })

    expect((await checkPassword(app, demoLogin)).status).toBe(401)
    expect(passwordFailureCalls).toEqual([])
  })

  it("treats the address as any other outside the demo, and other names as usual on it", async () => {
    const off = buildApp(null)
    expect((await checkPassword(off.app, demoLogin)).status).toBe(200)
    expect(off.passwordFailureCalls).toEqual([`begin`, `refund`])

    const other = buildApp(null, { demo: { adminHost: `admin.example.com` } })
    expect((await checkPassword(other.app, credentials)).status).toBe(200)
    expect(other.passwordFailureCalls).toEqual([`begin`, `refund`])
  })
})
