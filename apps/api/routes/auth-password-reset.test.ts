import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { PasswordResetOutcome } from "../services/password-reset.ts"
import { sameOriginWithoutCookieHeaders } from "../_testing/mutation-requests.ts"
import { createAuthRateLimits, RESET_MAILS_PER_ADDRESS } from "../middlewares/auth-rate-limits.ts"
import { MAILED_CODE_DEAD, MAILED_CODE_WRONG } from "./auth-answers.ts"
import {
  PASSWORD_RESET_REFUSED,
  PASSWORD_RESET_REQUESTED,
  PASSWORD_RESET_TOO_MANY,
} from "./auth-password-reset.ts"
import { apiError } from "../_testing/api-error.ts"
import {
  anonymousRoutes,
  brokenStore,
  buildApp,
  generousLimits,
  memoryStore,
  resetBody,
  send,
} from "../_testing/auth-routes.ts"

describe("auth routes reset a password by e-mailed code (#752)", () => {
  const forgot = anonymousRoutes.find((route) => route.path === "/auth/password/forgot")!
  const verify = anonymousRoutes.find((route) => route.path === "/auth/password/reset/verify")!
  const resend = anonymousRoutes.find((route) => route.path === "/auth/password/reset/resend")!
  const reset = anonymousRoutes.find((route) => route.path === "/auth/password/reset")!
  const json = (body: unknown) => ({ ...forgot, body })

  it("asks for the code for the address as normalizeEmail leaves it", async () => {
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

  it("spends the address's reset budget on a new code too", async () => {
    const { app, calls } = buildApp(null)
    for (let attempt = 0; attempt < RESET_MAILS_PER_ADDRESS; attempt++) {
      await send(app, json({ email: "alice@example.com" }), sameOriginWithoutCookieHeaders)
    }

    const response = await send(app, resend, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(429)
    expect((await apiError(response)).message).toBe(PASSWORD_RESET_TOO_MANY)
    expect(calls).not.toContain("resendPasswordReset")
  })

  it("answers the right code with the reset token", async () => {
    const { app } = buildApp(null)

    const response = await send(app, verify, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: "a-reset-token" })
  })

  it("answers a wrong code with 400 and a dead request with 410", async () => {
    const wrong = buildApp(null, { succeed: false })
    const dead = buildApp(null, {
      signIn: {
        verifyPasswordReset: () => Promise.resolve({ outcome: PasswordResetOutcome.Expired }),
      },
    })

    const wrongAnswer = await send(wrong.app, verify, sameOriginWithoutCookieHeaders)
    const deadAnswer = await send(dead.app, verify, sameOriginWithoutCookieHeaders)

    expect(wrongAnswer.status).toBe(400)
    expect((await apiError(wrongAnswer)).message).toBe(MAILED_CODE_WRONG)
    expect(deadAnswer.status).toBe(410)
    expect((await apiError(deadAnswer)).message).toBe(MAILED_CODE_DEAD)
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

  it("answers a token the reset refuses with 400 and says to ask for a new code", async () => {
    const { app, calls } = buildApp(null, { succeed: false })

    const response = await send(app, reset, sameOriginWithoutCookieHeaders)

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PASSWORD_RESET_REFUSED)
    expect(calls).toEqual(["finishPasswordReset"])
  })

  it("refuses a new password shorter than 8 characters before spending the token", async () => {
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
