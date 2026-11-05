import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { AccountDeletionBlockReason, UserMFAStatus } from "@domain/identity"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
} from "../_testing/mutation-requests.ts"
import { ACCOUNT_DELETE_BLOCKED, ACCOUNT_DELETE_CODE_REQUIRED } from "./auth-account-deletion.ts"
import { PROVIDER_PROOF_REQUIRED } from "./auth-answers.ts"
import { apiError } from "../_testing/api-error.ts"
import { buildApp, DELETE_AFTER, send } from "../_testing/auth-routes.ts"

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
