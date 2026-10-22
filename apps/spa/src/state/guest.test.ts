import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { refusedAction } from "./guest-refusal.ts"
import { hideGuestBanner, isGuestBannerHidden, nextPacificMidnight } from "./guest.ts"

/** A `Storage` in memory, or one whose every call throws, as a blocked one does. */
function memoryStorage(blocked = false): Storage {
  const items = new Map<string, string>()
  const guard = () => {
    if (blocked) throw new DOMException("blocked", "SecurityError")
  }
  return {
    getItem: (key: string) => (guard(), items.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), void items.set(key, value)),
  } as Storage
}

describe("refusedAction", () => {
  it("names the limited action from the refused request's path", () => {
    expect(refusedAction("/api/groups/0190/invitations")).toBe("invite")
    expect(refusedAction("/api/groups/0190/billing/checkout")).toBe("billing")
    expect(refusedAction("/api/groups/import/check")).toBe("upload")
    expect(refusedAction("/api/tokens")).toBe("api-token")
    expect(refusedAction("/api/push?device=1")).toBe("push")
    expect(refusedAction("/api/notes")).toBeNull()
  })
})

describe("the demo's nightly wipe", () => {
  it("is the next midnight in Los Angeles, in winter and in summer time", () => {
    // 20:00 UTC on 15 January is 12:00 in Los Angeles (UTC-8): midnight is 08:00 UTC next day.
    expect(nextPacificMidnight(new Date("2026-01-15T20:00:00Z")).toISOString())
      .toBe("2026-01-16T08:00:00.000Z")
    // In July Los Angeles is UTC-7.
    expect(nextPacificMidnight(new Date("2026-07-15T20:00:00Z")).toISOString())
      .toBe("2026-07-16T07:00:00.000Z")
  })
})

describe("the guest banner's hide", () => {
  it("is remembered per account, and a blocked storage never hides it", () => {
    const storage = memoryStorage()
    expect(isGuestBannerHidden(7, storage)).toBe(false)
    hideGuestBanner(7, storage)
    expect(isGuestBannerHidden(7, storage)).toBe(true)
    expect(isGuestBannerHidden(8, storage)).toBe(false)

    const blocked = memoryStorage(true)
    hideGuestBanner(7, blocked)
    expect(isGuestBannerHidden(7, blocked)).toBe(false)
  })
})
