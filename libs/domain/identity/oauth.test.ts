import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { OAUTH_NOTICES, oauthNotice, oauthProviderId } from "./+lib.ts"

describe("oauthProviderId", () => {
  it("accepts the two providers by their exact name", () => {
    expect(oauthProviderId("google")).toBe("google")
    expect(oauthProviderId("github")).toBe("github")
  })

  it("refuses every other value", () => {
    for (const value of ["Google", "password", "", "toString", undefined, null, 1]) {
      expect(oauthProviderId(value), String(value)).toBe(null)
    }
  })
})

describe("oauthNotice", () => {
  it("accepts every notice that has a message", () => {
    for (const notice of Object.keys(OAUTH_NOTICES)) expect(oauthNotice(notice)).toBe(notice)
  })

  it("refuses a value with no message, an inherited name included", () => {
    for (const value of ["nope", "", "toString", "constructor", undefined, null, 4]) {
      expect(oauthNotice(value), String(value)).toBe(null)
    }
  })
})
