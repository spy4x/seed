import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ADMIN_STATS_DAYS } from "@domain/identity"
import { fillDays, statsDays } from "./admin-stats.ts"

describe("admin stats days", () => {
  it("covers the 30 UTC days that end on today's, oldest first", () => {
    // Late evening west of UTC: the UTC day has already turned.
    const days = statsDays(new Date("2026-03-01T02:30:00.000Z"))

    expect(days.length).toBe(ADMIN_STATS_DAYS)
    expect(days[0]).toBe("2026-01-31")
    expect(days.at(-1)).toBe("2026-03-01")
    expect(days).toContain("2026-02-28")
    expect(new Set(days).size).toBe(ADMIN_STATS_DAYS)
  })

  it("fills a day no row names with 0 and ignores a row outside the days", () => {
    const series = fillDays(["2026-10-14", "2026-10-15", "2026-10-16"], [
      { day: "2026-10-16", count: 4 },
      { day: "2026-10-14", count: 2 },
      { day: "2026-09-01", count: 9 },
    ])

    expect(series).toEqual([
      { day: "2026-10-14", count: 2 },
      { day: "2026-10-15", count: 0 },
      { day: "2026-10-16", count: 4 },
    ])
  })
})
