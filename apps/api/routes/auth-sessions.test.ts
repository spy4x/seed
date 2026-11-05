import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { UserMFAStatus } from "@domain/identity"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
} from "../_testing/mutation-requests.ts"
import { SESSION_IS_CURRENT, SESSION_NOT_FOUND } from "./auth-sessions.ts"
import { apiError } from "../_testing/api-error.ts"
import { buildApp, CURRENT_DEVICE, OTHER_DEVICE, send } from "../_testing/auth-routes.ts"

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
