import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { signInRedirect, signOutRedirect } from "./sign-in-gate.ts"
import { SPA_ROUTE_PATHS, SPA_ROUTES } from "./spa-paths.ts"

const signedOut = { user: null, isMfaRequired: false }
const codeOwed = { user: null, isMfaRequired: true }
const signedIn = {
  user: { id: 1, firstName: "Ada", lastName: "", mfa: 1 },
  isMfaRequired: false,
} as unknown as Parameters<typeof signInRedirect>[2]

describe("where a visit goes before sign-in is finished", () => {
  it("sends a signed-out visit to a note to sign-in, with the note as next", () => {
    expect(signInRedirect("/notes/abc", "", signedOut)).toBe("/sign-in?next=%2Fnotes%2Fabc")
  })

  it("keeps the page's query in next", () => {
    expect(signInRedirect("/notes", "cursor=x", signedOut))
      .toBe("/sign-in?next=%2Fnotes%3Fcursor%3Dx")
  })

  it("sends the groups and the profile pages to sign-in too", () => {
    expect(signInRedirect("/groups", "", signedOut)).toBe("/sign-in?next=%2Fgroups")
    expect(signInRedirect("/groups/g1", "", signedOut)).toBe("/sign-in?next=%2Fgroups%2Fg1")
    expect(signInRedirect("/profile/account", "", signedOut))
      .toBe("/sign-in?next=%2Fprofile%2Faccount")
  })

  it("sends the tags and the notifications pages to sign-in, with the page as next", () => {
    expect(signInRedirect("/tags", "", signedOut)).toBe("/sign-in?next=%2Ftags")
    expect(signInRedirect("/notifications", "", signedOut)).toBe("/sign-in?next=%2Fnotifications")
  })

  it("sends every route that is not open to sign-in, and leaves every open one", () => {
    for (const pattern of SPA_ROUTE_PATHS) {
      const path = pattern.replace(/:\w+/g, "abc")
      const page = path.startsWith("/invite/") ? "/sign-up" : "/sign-in"
      expect(signInRedirect(path, "", signedOut), pattern)
        .toBe(SPA_ROUTES[pattern].open ? null : `${page}?next=${encodeURIComponent(path)}`)
    }
  })

  it("sends an invitation link to sign-up first, with the invitation as next", () => {
    expect(signInRedirect("/invite/AbC_9", "", signedOut)).toBe("/sign-up?next=%2Finvite%2FAbC_9")
  })

  it("sends an invitation to the code page while the code is owed", () => {
    expect(signInRedirect("/invite/AbC_9", "", codeOwed)).toBe("/totp?next=%2Finvite%2FAbC_9")
  })

  it("sends a session that owes its code to the code page, with the page as next", () => {
    expect(signInRedirect("/notes/abc", "", codeOwed)).toBe("/totp?next=%2Fnotes%2Fabc")
  })

  it("leaves the pages open to anyone where they are", () => {
    for (const path of ["/", "/sign-in", "/sign-up", "/totp", "/forgot-password", "/notesy"]) {
      expect(signInRedirect(path, "", signedOut)).toBe(null)
    }
  })

  it("leaves a signed-in person where they are", () => {
    expect(signInRedirect("/notes/abc", "", signedIn)).toBe(null)
  })
})

describe("where a sign-out goes first", () => {
  it("leaves a page for signed-in people for plain sign-in, with no next", () => {
    expect(signOutRedirect("/notes/abc", "")).toBe("/sign-in")
    expect(signOutRedirect("/profile/account", "")).toBe("/sign-in")
    expect(signOutRedirect("/groups/g1", "x=1")).toBe("/sign-in")
    expect(signOutRedirect("/tags", "")).toBe("/sign-in")
    expect(signOutRedirect("/notifications", "")).toBe("/sign-in")
  })

  it("leaves an auth page that carries next for plain sign-in", () => {
    expect(signOutRedirect("/totp", "next=%2Fnotes%2Fabc")).toBe("/sign-in")
  })

  it("leaves a page open to anyone where it is", () => {
    expect(signOutRedirect("/", "")).toBe(null)
    expect(signOutRedirect("/totp", "")).toBe(null)
  })
})
