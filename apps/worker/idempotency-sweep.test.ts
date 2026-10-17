import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { TimerPort } from "@spy4x/platform/server/throttled-saver"
import { startIdempotencySweep } from "./idempotency-sweep.ts"

/** Timers that never fire by themselves: the test fires a tick by hand. */
function fakeTimers() {
  const pending = new Map<number, () => void>()
  const calls = { set: 0, clear: 0 }
  let next = 1
  const timers: TimerPort = {
    set(fn) {
      calls.set++
      const handle = next++
      pending.set(handle, () => {
        pending.delete(handle)
        fn()
      })
      return handle
    },
    clear(handle) {
      calls.clear++
      pending.delete(handle)
    },
  }
  return { timers, pending, calls }
}

/** Lets the runner's async tick finish. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("startIdempotencySweep", () => {
  it("starts no timer and no sweep when the signal is already aborted", async () => {
    const fake = fakeTimers()
    let sweeps = 0

    startIdempotencySweep({
      signal: AbortSignal.abort(),
      sweep: () => Promise.resolve(void sweeps++),
      onError: () => {},
      intervalMs: 1000,
      timers: fake.timers,
    })
    await settle()

    expect(fake.calls.set).toBe(0)
    expect(sweeps).toBe(0)
  })

  it("sweeps once at start, before any timer fires, and then sets one timer", async () => {
    const fake = fakeTimers()
    let sweeps = 0

    startIdempotencySweep({
      signal: new AbortController().signal,
      sweep: () => Promise.resolve(void sweeps++),
      onError: () => {},
      intervalMs: 1000,
      timers: fake.timers,
    })
    await settle()

    expect(sweeps).toBe(1)
    expect(fake.pending.size).toBe(1)
  })

  it("clears the timer when the signal aborts later", async () => {
    const fake = fakeTimers()
    const controller = new AbortController()
    startIdempotencySweep({
      signal: controller.signal,
      sweep: () => Promise.resolve(),
      onError: () => {},
      intervalMs: 1000,
      timers: fake.timers,
    })
    await settle()

    controller.abort()

    expect(fake.pending.size).toBe(0)
  })

  it("reports a failing sweep to onError", async () => {
    const fake = fakeTimers()
    const reported: unknown[] = []
    const failure = new Error("database is down")

    startIdempotencySweep({
      signal: new AbortController().signal,
      sweep: () => Promise.reject(failure),
      onError: (error) => reported.push(error),
      intervalMs: 1000,
      timers: fake.timers,
    })
    await settle()

    expect(reported).toEqual([failure])
  })
})
