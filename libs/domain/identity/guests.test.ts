import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { guestTooManyMessage } from "./guests.ts"

describe("guestTooManyMessage", () => {
  it("names the real wait in whole minutes, rounded up, and an hour when the wait is unknown", () => {
    expect(guestTooManyMessage(2520)).toBe(
      "Try again in 42 minutes, or create an account with your e-mail address.",
    )
    expect(guestTooManyMessage(61)).toBe(
      "Try again in 2 minutes, or create an account with your e-mail address.",
    )
    expect(guestTooManyMessage(30)).toBe(
      "Try again in 1 minute, or create an account with your e-mail address.",
    )
    expect(guestTooManyMessage(null)).toBe(
      "Try again in an hour, or create an account with your e-mail address.",
    )
  })
})
