import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { PasswordSetOutcome } from "../services/password.ts"
import { UserMFAStatus } from "@domain/identity"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { sameOriginHeaders } from "../_testing/mutation-requests.ts"
import { PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"
import {
  PASSWORD_ALREADY_SET,
  PASSWORD_NEEDS_ADDRESS,
  PASSWORD_SET_REFUSED,
} from "./auth-password.ts"
import { apiError } from "../_testing/api-error.ts"
import { buildApp, send } from "../_testing/auth-routes.ts"

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

  it("refuses an account with no address before it spends the authenticator code", async () => {
    const { app, calls, failureCalls } = buildApp(
      buildAuthData({
        user: { mfa: UserMFAStatus.CONFIGURED },
        session: { secondFactor: SecondFactorStatus.Completed },
      }),
      {
        signIn: {
          hasPassword: () => Promise.resolve(false),
          confirmedByProvider: () => Promise.resolve(true),
          emailStatus: () => Promise.resolve({ email: null, proven: false, pending: null }),
        },
      },
    )
    const response = await send(
      app,
      { ...setRoute, body: { newPassword: "battery-staple", otp: "123456" } },
      sameOriginHeaders,
    )

    expect(response.status).toBe(400)
    expect((await apiError(response)).message).toBe(PASSWORD_NEEDS_ADDRESS)
    expect(calls).toEqual([])
    expect(failureCalls).toEqual([])
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
