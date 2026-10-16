import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { AdminHealth, backupHealth, queueHealth, worstHealth } from "./+lib.ts"

const NOW = new Date("2026-10-16T12:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(NOW.valueOf() - minutes * 60_000)
const hoursAgo = (hours: number) => minutesAgo(hours * 60)

describe("system health", () => {
  it("the worst of several states wins, and none is OK", () => {
    expect(worstHealth()).toBe(AdminHealth.OK)
    expect(worstHealth(AdminHealth.OK, AdminHealth.ERROR, AdminHealth.WARNING)).toBe(
      AdminHealth.ERROR,
    )
  })

  it("a queue is OK while its oldest due job waits five minutes or less", () => {
    expect(queueHealth(null, 0, NOW)).toBe(AdminHealth.OK)
    expect(queueHealth(minutesAgo(5), 0, NOW)).toBe(AdminHealth.OK)
  })

  it("a queue warns past five minutes and is an error past thirty", () => {
    expect(queueHealth(minutesAgo(6), 0, NOW)).toBe(AdminHealth.WARNING)
    expect(queueHealth(minutesAgo(30), 0, NOW)).toBe(AdminHealth.WARNING)
    expect(queueHealth(minutesAgo(31), 0, NOW)).toBe(AdminHealth.ERROR)
  })

  it("a queue warns while a failed job is left", () => {
    expect(queueHealth(null, 1, NOW)).toBe(AdminHealth.WARNING)
  })

  it("a backup warns past 26 hours and is an error past 48 or when there is none", () => {
    expect(backupHealth(hoursAgo(26), NOW)).toBe(AdminHealth.OK)
    expect(backupHealth(hoursAgo(27), NOW)).toBe(AdminHealth.WARNING)
    expect(backupHealth(hoursAgo(48), NOW)).toBe(AdminHealth.WARNING)
    expect(backupHealth(hoursAgo(49), NOW)).toBe(AdminHealth.ERROR)
    expect(backupHealth(null, NOW)).toBe(AdminHealth.ERROR)
  })
})
