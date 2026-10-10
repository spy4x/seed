import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { UserMFAStatus } from "@domain/identity"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  mountRoute,
  testSessionGuards,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import { createSocketRoute } from "./socket-route.ts"
import type { AppAuthState } from "./sign-in.ts"

function buildApp(auth: AppAuthState | null = buildAuthData({ user: { id: 7 } })) {
  const upgrades: number[] = []
  const route = createSocketRoute({
    auth: testSessionGuards(),
    expectedOrigin: WEB_APP_URL,
    realtime: { attach: () => true },
    upgrade: (_c, state) => {
      upgrades.push(state.user.id)
      return new Response(null, { status: 200 })
    },
  })
  return { app: mountRoute("/ws", route, auth), upgrades }
}

/** The socket's address. The page of user 7 names them in the handshake's subprotocol. */
const SOCKET_URL = `${API_URL}/ws`

/** A signed-in browser's WebSocket handshake, with `origin` as its Origin header when given. */
function handshake(origin?: string, extra: Record<string, string> = {}): RequestInit {
  const headers: Record<string, string> = {
    upgrade: "websocket",
    connection: "Upgrade",
    cookie: "sessionIdToken=1:token",
    "sec-websocket-protocol": "user.7",
    ...extra,
  }
  if (origin !== undefined) headers.origin = origin
  return { headers }
}

describe("socket route", () => {
  it("refuses an upgrade from a foreign origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(SOCKET_URL, handshake("https://attacker.example"))
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade from a sibling subdomain", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(SOCKET_URL, handshake("https://grafana.example.com"))
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade without an Origin header", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(SOCKET_URL, handshake())
    expect(response.status).toBe(403)
    expect(upgrades).toEqual([])
  })

  it("upgrades the signed-in user when Origin is the web app's origin", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(SOCKET_URL, handshake(WEB_APP_URL))
    expect(response.status).toBe(200)
    expect(upgrades).toEqual([7])
  })

  it("answers the upgrade with the subprotocol the page offered, which a browser requires", async () => {
    // No fake upgrade here: the route's own, so the answer is the real handshake's.
    const route = createSocketRoute({
      auth: testSessionGuards(),
      expectedOrigin: WEB_APP_URL,
      realtime: { attach: () => true },
    })
    const app = mountRoute("/ws", route, buildAuthData({ user: { id: 7 } }))
    const response = await app.request(
      SOCKET_URL,
      handshake(WEB_APP_URL, {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "chat, user.7",
      }),
    )
    expect([response.status, response.headers.get("sec-websocket-protocol")]).toEqual([
      101,
      "user.7",
    ])
  })

  it("refuses an upgrade whose page names another user than the session's, or names none", async () => {
    const { app, upgrades } = buildApp()
    for (const offered of ["user.8", "", "user.07", "chat, user.8"]) {
      const response = await app.request(
        SOCKET_URL,
        handshake(WEB_APP_URL, { "sec-websocket-protocol": offered }),
      )
      expect(response.status).toBe(401)
    }
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade without a session, whatever the Origin", async () => {
    const { app, upgrades } = buildApp(null)
    const response = await app.request(SOCKET_URL, handshake(WEB_APP_URL))
    expect(response.status).toBe(401)
    expect(upgrades).toEqual([])
  })

  it("refuses an upgrade from a session that still owes its second factor", async () => {
    const { app, upgrades } = buildApp(
      buildAuthData({
        user: { id: 7, mfa: UserMFAStatus.CONFIGURED },
        session: { secondFactor: SecondFactorStatus.Pending },
      }),
    )
    const response = await app.request(SOCKET_URL, handshake(WEB_APP_URL))
    expect(response.status).toBe(401)
    expect(upgrades).toEqual([])
  })

  it("asks a plain GET from the right origin to upgrade", async () => {
    const { app, upgrades } = buildApp()
    const response = await app.request(SOCKET_URL, {
      headers: { origin: WEB_APP_URL, cookie: "sessionIdToken=1:token" },
    })
    expect(response.status).toBe(426)
    expect(upgrades).toEqual([])
  })
})
