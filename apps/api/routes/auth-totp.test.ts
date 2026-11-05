import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { sameOriginHeaders } from "../_testing/mutation-requests.ts"
import { PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"
import { TOTP_DISCONNECT_PROOF_REQUIRED } from "./auth-totp.ts"
import { apiError } from "../_testing/api-error.ts"
import { buildApp, send, sessionRoutes } from "../_testing/auth-routes.ts"

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
