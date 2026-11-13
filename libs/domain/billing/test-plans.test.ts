import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { UNLIMITED } from "./+lib.ts"
import { TEST_FREE_PLAN, TEST_PRO_PLAN, testLimits, testUsage } from "./test-plans.ts"

const KEYS = Object.keys(UNLIMITED.limits).sort()

describe("the test catalog's helpers", () => {
  it("give every limit key the product defines a value, overrides first", () => {
    const zero = Object.fromEntries(KEYS.map((key) => [key, 0]))

    expect(testLimits(0, { maxMembers: 1 })).toEqual({ ...zero, maxMembers: 1 })
  })

  it("give the test plans every limit key the product defines", () => {
    expect(Object.keys(TEST_FREE_PLAN.entitlements.limits).sort()).toEqual(KEYS)
    expect(Object.keys(TEST_PRO_PLAN.entitlements.limits).sort()).toEqual(KEYS)
  })

  it("give the gate a count for every limit key, failing loudly on one the test did not give", async () => {
    const usage = testUsage({ maxNotes: () => Promise.resolve(4) })

    expect(Object.keys(usage).sort()).toEqual(KEYS)
    expect(await usage.maxNotes("group")).toBe(4)
    await expect(usage.maxMembers("group")).rejects.toThrow("not part of this test")
  })
})
