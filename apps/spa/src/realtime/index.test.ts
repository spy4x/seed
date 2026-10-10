import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { User } from "@domain/identity"
import { connectionDisplay, sessionGate } from "./index.ts"
import { sessionState } from "../state/session.ts"

const realFetch = globalThis.fetch

function meAnswers(status: number, body: unknown) {
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )
}

afterEach(() => {
  globalThis.fetch = realFetch
  sessionState.value = { ...sessionState.value, user: null, isMfaRequired: false, wsStatus: "idle" }
})

describe("sessionGate", () => {
  it("lets the socket reconnect while the cookie still belongs to the page's user", async () => {
    meAnswers(200, { id: 1 })
    expect((await sessionGate(1)()).allowed).toBe(true)
  })

  it("refuses the reconnect and signs the page out when the cookie now belongs to another user", async () => {
    sessionState.value = { ...sessionState.value, user: { id: 1 } as User }
    meAnswers(200, { id: 2 })
    expect((await sessionGate(1)()).allowed).toBe(false)
    expect(sessionState.value.user).toBeNull()
  })

  it("lets the socket try again when the server cannot be reached", async () => {
    globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"))
    expect((await sessionGate(1)()).allowed).toBe(true)
  })
})

describe("connectionDisplay", () => {
  it("shows the socket's own status when the page did not just return", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "none" })).toBe("closed")
    expect(connectionDisplay({ wsStatus: "open", wsResume: "none" })).toBe("open")
  })

  it("shows no disconnect while the page has just returned and the socket is not open yet", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "quiet" })).toBe("open")
    expect(connectionDisplay({ wsStatus: "connecting", wsResume: "quiet" })).toBe("open")
  })

  it("shows Reconnecting once the reconnect took longer than the quiet period", () => {
    expect(connectionDisplay({ wsStatus: "closed", wsResume: "slow" })).toBe("reconnecting")
  })

  it("shows open as soon as the socket is open, whatever the resume state", () => {
    expect(connectionDisplay({ wsStatus: "open", wsResume: "slow" })).toBe("open")
  })
})
