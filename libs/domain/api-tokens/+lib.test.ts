import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  API_TOKEN_NAME_MAX_LENGTH,
  ApiTokenAccess,
  ApiTokenError,
  apiTokenExpiresAt,
  isApiTokenFormat,
  parseApiTokenCreateRequest,
} from "./+lib.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

function request(overrides: Record<string, unknown> = {}) {
  return {
    name: "Zapier",
    groupId,
    access: ApiTokenAccess.READ,
    expiresInDays: 90,
    password: "correct horse",
    ...overrides,
  }
}

function refusal(body: unknown): string | undefined {
  try {
    parseApiTokenCreateRequest(body)
  } catch (error) {
    if (error instanceof ApiTokenError) return error.code
    throw error
  }
}

describe("parseApiTokenCreateRequest", () => {
  it("reads a valid request and trims the name", () => {
    expect(parseApiTokenCreateRequest(request({ name: "  Zapier  " }))).toEqual(request())
  })

  it("accepts a token that never expires", () => {
    expect(parseApiTokenCreateRequest(request({ expiresInDays: null })).expiresInDays).toBe(null)
  })

  it("refuses a lifetime that is not offered", () => {
    expect(refusal(request({ expiresInDays: 7 }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ expiresInDays: undefined }))).toBe("INVALID_REQUEST")
  })

  it("refuses an unknown access level", () => {
    expect(refusal(request({ access: 3 }))).toBe("INVALID_REQUEST")
  })

  it("refuses an empty name, a blank one and one over the limit in characters", () => {
    expect(refusal(request({ name: "" }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ name: "   " }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ name: "a".repeat(API_TOKEN_NAME_MAX_LENGTH + 1) }))).toBe(
      "INVALID_REQUEST",
    )
    // Emoji are two UTF-16 units each, but one character: the limit counts characters.
    expect(
      parseApiTokenCreateRequest(request({ name: "🔑".repeat(API_TOKEN_NAME_MAX_LENGTH) })).name,
    )
      .toBe("🔑".repeat(API_TOKEN_NAME_MAX_LENGTH))
  })

  it("refuses a name Postgres cannot store", () => {
    expect(refusal(request({ name: "a\u0000b" }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ name: "a\uD800b" }))).toBe("INVALID_REQUEST")
  })

  it("refuses a name with a line break, a control character or a text-direction character", () => {
    // The name goes into the owner's mail as plain text: a line break would let it fake a line.
    for (const name of ["a\nb", "a\r\nb", "a\tb", "a\u001bb", "a\u2028b", "a\u202eb"]) {
      expect(refusal(request({ name }))).toBe("INVALID_REQUEST")
    }
    expect(parseApiTokenCreateRequest(request({ name: "Zoë's 🔑 script" })).name).toBe(
      "Zoë's 🔑 script",
    )
  })

  it("refuses a request without the password, with an empty one or one longer than a password", () => {
    const { password: _password, ...withoutPassword } = request()
    expect(refusal(withoutPassword)).toBe("INVALID_REQUEST")
    expect(refusal(request({ password: "" }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ password: "a".repeat(51) }))).toBe("INVALID_REQUEST")
    expect(parseApiTokenCreateRequest(request({ password: "a".repeat(50) })).password).toHaveLength(
      50,
    )
  })

  it("refuses a group id that is not a UUID and any extra field", () => {
    expect(refusal(request({ groupId: "personal" }))).toBe("INVALID_REQUEST")
    expect(refusal(request({ secret: "tpl_chosen" }))).toBe("INVALID_REQUEST")
  })
})

describe("isApiTokenFormat", () => {
  it("accepts the prefix and 22 base64url characters only", () => {
    expect(isApiTokenFormat("tpl_AAAAAAAAAAAAAAAAAAAA-_")).toBe(true)
    expect(isApiTokenFormat("tpl_AAAAAAAAAAAAAAAAAAAAA")).toBe(false)
    expect(isApiTokenFormat("xyz_AAAAAAAAAAAAAAAAAAAA-_")).toBe(false)
    expect(isApiTokenFormat("tpl_AAAAAAAAAAAAAAAAAAAA+/")).toBe(false)
  })
})

describe("apiTokenExpiresAt", () => {
  it("adds whole days, and never expires without them", () => {
    const now = new Date("2026-10-04T10:00:00.000Z")
    expect(apiTokenExpiresAt(now, 90)?.toISOString()).toBe("2027-01-02T10:00:00.000Z")
    expect(apiTokenExpiresAt(now, null)).toBe(null)
  })
})
