import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { MAX_LIST_LIMIT, parseListLimit } from "./list-limit.ts"

class TestError extends Error {}
const invalid = () => new TestError("bad limit")

describe("parseListLimit", () => {
  it("answers the fallback when the limit is absent", () => {
    expect(parseListLimit(undefined, 25, invalid)).toBe(25)
  })

  it("answers a whole number within the cap", () => {
    expect(parseListLimit(`7`, 25, invalid)).toBe(7)
    expect(parseListLimit(String(MAX_LIST_LIMIT), 25, invalid)).toBe(MAX_LIST_LIMIT)
  })

  it("throws the caller's error for a limit over the cap, zero or not a number", () => {
    for (const value of [String(MAX_LIST_LIMIT + 1), `0`, `-1`, `abc`, `1.5`]) {
      expect(() => parseListLimit(value, 25, invalid)).toThrow(TestError)
    }
  })
})
