import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import { notificationChangeSchema } from "./notification-hint.ts"

const accepts = (value: unknown) => !(notificationChangeSchema(value) instanceof type.errors)

describe("notificationChangeSchema", () => {
  it("accepts a well-formed inbox change", () => {
    expect(accepts({ userId: 7 })).toBe(true)
  })

  it("drops a payload that does not name a positive integer user", () => {
    for (const bad of [{}, { userId: 0 }, { userId: "7" }, { userId: 1.5 }, [], null]) {
      expect(accepts(bad)).toBe(false)
    }
  })
})
