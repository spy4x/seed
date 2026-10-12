import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
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
