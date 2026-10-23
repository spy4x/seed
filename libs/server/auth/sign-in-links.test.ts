import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { MemoryAuthStore } from "@spy4x/server/auth/memory-store"
import {
  consumeSignInLink,
  issueSignInLink,
  SIGN_IN_LINK_PATH,
  SIGN_IN_LINK_TTL_MINUTES,
  type SignInLinkRequest,
  signInLinkUrl,
} from "./sign-in-links.ts"

const NOW = new Date("2026-10-23T10:00:00Z")
const minutesLater = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000)

const ANN_FIRST = "01900000-0000-7000-8000-000000000001"
const ANN_SECOND = "01900000-0000-7000-8000-000000000002"
const BOB = "01900000-0000-7000-8000-000000000003"

/** The request table in memory, as `signInLinkRequests` keeps it in Postgres. */
function memoryRequests(...rows: SignInLinkRequest[]) {
  const all = new Map(rows.map((row) => [row.id, row]))
  return {
    all,
    find: (id: string) => Promise.resolve(all.get(id) ?? null),
    removeFor: (email: string) => {
      for (const [id, row] of all) if (row.email === email) all.delete(id)
      return Promise.resolve()
    },
  }
}

const ann = (id: string): SignInLinkRequest => ({
  id,
  email: "ann@example.com",
  next: "/notes",
  requestedBy: null,
})

describe("sign-in links", () => {
  it("spends a link once: the first use answers its request, the second nothing", async () => {
    const store = new MemoryAuthStore()
    const requests = memoryRequests(ann(ANN_FIRST))
    const { token, expiresAt } = await issueSignInLink(store, ann(ANN_FIRST), NOW)

    expect(token).toMatch(new RegExp(`^${ANN_FIRST}\\.[A-Za-z0-9_-]{43}$`))
    expect(expiresAt).toEqual(minutesLater(SIGN_IN_LINK_TTL_MINUTES))
    expect(await consumeSignInLink(store, requests, token, NOW)).toEqual(ann(ANN_FIRST))
    expect(await consumeSignInLink(store, requests, token, NOW)).toBe(null)
  })

  it("refuses a link after its fifteen minutes", async () => {
    const store = new MemoryAuthStore()
    const requests = memoryRequests(ann(ANN_FIRST))
    const { token } = await issueSignInLink(store, ann(ANN_FIRST), NOW)

    const late = minutesLater(SIGN_IN_LINK_TTL_MINUTES + 1)
    expect(await consumeSignInLink(store, requests, token, late)).toBe(null)
  })

  it("refuses a wrong secret, a token without one and a malformed id alike", async () => {
    const store = new MemoryAuthStore()
    const requests = memoryRequests(ann(ANN_FIRST))
    await issueSignInLink(store, ann(ANN_FIRST), NOW)

    for (const token of [`${ANN_FIRST}.wrong`, `${ANN_FIRST}.`, ANN_FIRST, "nope.secret", 42]) {
      expect(await consumeSignInLink(store, requests, token, NOW)).toBe(null)
    }
  })

  it("keeps an earlier link working after a newer one is sent", async () => {
    const store = new MemoryAuthStore()
    const requests = memoryRequests(ann(ANN_FIRST), ann(ANN_SECOND))
    const first = await issueSignInLink(store, ann(ANN_FIRST), NOW)
    await issueSignInLink(store, ann(ANN_SECOND), NOW)

    expect(await consumeSignInLink(store, requests, first.token, NOW)).toEqual(ann(ANN_FIRST))
  })

  it("stops the address's other links once one of them is used", async () => {
    const store = new MemoryAuthStore()
    const requests = memoryRequests(ann(ANN_FIRST), ann(ANN_SECOND))
    const first = await issueSignInLink(store, ann(ANN_FIRST), NOW)
    const second = await issueSignInLink(store, ann(ANN_SECOND), NOW)

    expect(await consumeSignInLink(store, requests, second.token, NOW)).toEqual(ann(ANN_SECOND))
    expect(await consumeSignInLink(store, requests, first.token, NOW)).toBe(null)
  })

  it("leaves another address's link working when one address's link is used", async () => {
    const store = new MemoryAuthStore()
    const bob: SignInLinkRequest = {
      id: BOB,
      email: "bob@example.com",
      next: null,
      requestedBy: null,
    }
    const requests = memoryRequests(ann(ANN_FIRST), bob)
    const annLink = await issueSignInLink(store, ann(ANN_FIRST), NOW)
    const bobLink = await issueSignInLink(store, bob, NOW)

    await consumeSignInLink(store, requests, annLink.token, NOW)

    expect(await consumeSignInLink(store, requests, bobLink.token, NOW)).toEqual(bob)
  })

  it("puts the token in the link's fragment, never in its path or query", () => {
    const url = new URL(signInLinkUrl("https://app.example.com", `${ANN_FIRST}.secret`))

    expect(url.pathname).toBe(SIGN_IN_LINK_PATH)
    expect(url.search).toBe("")
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(`${ANN_FIRST}.secret`)
  })
})
