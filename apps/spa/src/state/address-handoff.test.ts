import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { handOffAddress, takeHandedOffAddress } from "./address-handoff.ts"

describe("address handoff", () => {
  it("hands the address to the first page that takes it, and to no other", () => {
    handOffAddress("ann@example.com")

    expect(takeHandedOffAddress()).toBe("ann@example.com")
    expect(takeHandedOffAddress()).toBe(null)
  })
})
