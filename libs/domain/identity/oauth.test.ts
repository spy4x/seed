import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { OAUTH_NOTICES, oauthNotice, oauthProviderId, providerAvatarUrl } from "./+lib.ts"

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

describe("providerAvatarUrl", () => {
  it("keeps a picture on Google's or GitHub's image host", () => {
    for (
      const url of [
        "https://lh3.googleusercontent.com/a/ann=s96-c",
        "https://avatars.githubusercontent.com/u/1?v=4",
      ]
    ) {
      expect(providerAvatarUrl(url)).toBe(url)
    }
  })

  it("drops a picture from any other host, scheme or with credentials, so the page shows initials", () => {
    for (
      const url of [
        "https://avatars.example.com/u/1",
        "http://avatars.githubusercontent.com/u/1",
        "https://lh4.googleusercontent.com/a/ann",
        "https://user:pass@avatars.githubusercontent.com/u/1",
        "javascript:alert(1)",
        "not a url",
        null,
        42,
      ]
    ) {
      expect(providerAvatarUrl(url)).toBe(null)
    }
  })
})
