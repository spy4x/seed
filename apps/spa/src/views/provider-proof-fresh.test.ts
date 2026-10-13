import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { isProviderProofFresh } from "./provider-proof-fresh.ts"

describe("isProviderProofFresh", () => {
  const now = Date.parse("2026-10-13T08:00:00.000Z")

  it("holds until the time the server gave", () => {
    expect(isProviderProofFresh("2026-10-13T08:00:01.000Z", now)).toBe(true)
  })

  it("is over at that time and after it", () => {
    expect(isProviderProofFresh("2026-10-13T08:00:00.000Z", now)).toBe(false)
    expect(isProviderProofFresh("2026-10-13T07:59:00.000Z", now)).toBe(false)
  })

  it("is not there for a session no provider sign-in started", () => {
    expect(isProviderProofFresh(null, now)).toBe(false)
  })
})
