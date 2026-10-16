import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { OAUTH_PAGES } from "@domain/identity"
import { isMembersOnlyPath, isSpaPath, SPA_ROUTE_PATHS, SPA_ROUTES } from "./spa-paths.ts"

/** An address the pattern matches: every `:name` filled in. */
const addressOf = (pattern: string) => pattern.replace(/:\w+/g, "abc")

describe("isSpaPath", () => {
  it("knows the SPA's own paths", () => {
    for (
      const path of [
        "/",
        "/notes",
        "/notes/new",
        "/tags",
        "/notifications",
        "/groups",
        "/invite/AbC_9",
        "/sign-in",
        "/totp",
        "/email",
        "/subscribe",
        "/subscribe/confirm",
        "/unsubscribe",
      ]
    ) {
      expect(isSpaPath(path), path).toBe(true)
    }
  })

  it("owns an address of every route in the table", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(isSpaPath(addressOf(pattern)), pattern).toBe(true)
    }
  })

  it("routes no page whose address starts with /api, which the proxy sends to the API", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(pattern.startsWith("/api"), pattern).toBe(false)
    }
  })

  it("leaves server paths to the browser", () => {
    for (const path of ["/api/ws", "/notesx", "/assets/app.js", "notes"]) {
      expect(isSpaPath(path), path).toBe(false)
    }
  })
})

describe("isMembersOnlyPath", () => {
  it("is true for an address of every route that is not open, and false for every open one", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      expect(isMembersOnlyPath(addressOf(pattern)), pattern).toBe(!SPA_ROUTES[pattern].open)
    }
  })

  it("counts every address under a members' page, and none outside the app", () => {
    expect(isMembersOnlyPath("/notes/abc/history")).toBe(true)
    for (const path of ["/notesy", "/api/groups", "/assets/app.js"]) {
      expect(isMembersOnlyPath(path), path).toBe(false)
    }
  })

  it("leaves open the pages a signed-out person needs to sign in or read", () => {
    const open = SPA_ROUTE_PATHS.filter((pattern) => SPA_ROUTES[pattern].open)
    expect(open).toEqual([
      "/sign-up",
      "/sign-up/confirm",
      "/sign-up/code",
      "/sign-in",
      "/totp",
      "/forgot-password",
      "/reset-password",
      "/subscribe",
      "/subscribe/confirm",
      "/unsubscribe",
      "/",
    ])
  })
})

describe("the pages a provider's callback redirects to", () => {
  it("are all routed, and open to a person who is not signed in yet", () => {
    for (const path of Object.values(OAUTH_PAGES)) {
      expect(SPA_ROUTE_PATHS as string[], path).toContain(path)
      expect(isMembersOnlyPath(path), path).toBe(false)
    }
  })
})
