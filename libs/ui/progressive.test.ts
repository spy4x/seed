import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  afterSignIn,
  checkedNext,
  NOTE_PATHS,
  readNext,
  SCREEN_PATHS,
  withNext,
} from "./progressive.tsx"

describe("the next page of a sign-in", () => {
  it("keeps a page of this app", () => {
    expect(checkedNext("/notes/abc?from=link")).toBe("/notes/abc?from=link")
    expect(checkedNext("/profile/account")).toBe("/profile/account")
  })

  it("falls back to the notes list for another site, a backslash or an API path", () => {
    for (const value of ["//evil.example", "https://evil.example", "/\\evil.example"]) {
      expect(checkedNext(value)).toBe(NOTE_PATHS.list)
    }
    expect(checkedNext("/api/auth/me")).toBe(NOTE_PATHS.list)
    expect(checkedNext("/api")).toBe(NOTE_PATHS.list)
  })

  it("reads a checked next from a query or a form, and nothing when it carries none", () => {
    expect(readNext(new URLSearchParams("next=%2Fnotes%2Fabc"))).toBe("/notes/abc")
    expect(readNext(new URLSearchParams("next=%2F%2Fevil.example"))).toBe(NOTE_PATHS.list)
    const form = new FormData()
    form.set("next", "/groups")
    expect(readNext(form)).toBe("/groups")
    expect(readNext(new URLSearchParams(""))).toBe(null)
    expect(readNext(new URLSearchParams("next="))).toBe(null)
  })

  it("puts next into a path's query, encoded, and leaves the path alone without one", () => {
    expect(withNext(SCREEN_PATHS.signIn, "/notes/abc?x=1"))
      .toBe("/sign-in?next=%2Fnotes%2Fabc%3Fx%3D1")
    expect(withNext(SCREEN_PATHS.signIn, null)).toBe("/sign-in")
  })

  it("goes to next after sign-in, or to the notes list without one", () => {
    expect(afterSignIn("/notes/abc")).toBe("/notes/abc")
    expect(afterSignIn(null)).toBe(NOTE_PATHS.list)
  })
})
