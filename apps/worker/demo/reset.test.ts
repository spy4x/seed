/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { demoDay, demoResetTask } from "./reset.ts"

Deno.test("demoDay follows Los Angeles, daylight saving included", () => {
  // 06:59 UTC in summer is 23:59 the day before in Los Angeles; 07:00 is midnight.
  expect(demoDay(new Date("2026-07-02T06:59:00Z"))).toBe("2026-07-01")
  expect(demoDay(new Date("2026-07-02T07:00:00Z"))).toBe("2026-07-02")
  // In winter midnight is 08:00 UTC.
  expect(demoDay(new Date("2026-12-02T07:59:00Z"))).toBe("2026-12-01")
  expect(demoDay(new Date("2026-12-02T08:00:00Z"))).toBe("2026-12-02")
})

/** A task over a clock the test moves, counting resets. */
function harness(seeded: boolean) {
  let now = new Date("2026-07-01T20:00:00Z")
  let resets = 0
  let fail = false
  const task = demoResetTask({
    isSeeded: () => Promise.resolve(seeded),
    reset: () => {
      if (fail) return Promise.reject(new Error("db down"))
      resets++
      return Promise.resolve()
    },
    now: () => now,
  })
  return {
    task,
    resets: () => resets,
    at: (iso: string) => (now = new Date(iso)),
    failing: (value: boolean) => (fail = value),
  }
}

Deno.test("the reset keeps a seeded demo after a start and wipes it at the next midnight", async () => {
  const h = harness(true)
  await h.task()
  await h.task()
  expect(h.resets()).toBe(0)
  h.at("2026-07-02T06:59:00Z")
  await h.task()
  expect(h.resets()).toBe(0)
  h.at("2026-07-02T07:00:30Z")
  await h.task()
  await h.task()
  expect(h.resets()).toBe(1)
})

Deno.test("the reset seeds at once when the demo is missing", async () => {
  const h = harness(false)
  await h.task()
  expect(h.resets()).toBe(1)
  await h.task()
  expect(h.resets()).toBe(1)
})

Deno.test("a failed reset is tried again on the next check", async () => {
  const h = harness(true)
  await h.task()
  h.at("2026-07-02T07:01:00Z")
  h.failing(true)
  await expect(h.task()).rejects.toThrow("db down")
  h.failing(false)
  await h.task()
  expect(h.resets()).toBe(1)
})
