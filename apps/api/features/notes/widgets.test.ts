import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import type { DateRange } from "@spy4x/time/date"
import { GroupRole } from "@domain/groups"
import { UserMFAStatus } from "@domain/identity"
import { NOTE_WIDGETS, NoteError } from "@domain/notes"
import {
  createNoteAddedWidgetHandler,
  createNoteSeriesWidgetHandler,
  createNoteTotalWidgetHandler,
  createNoteWidgetOperations,
} from "./widgets.ts"

const groupId = "0199c3a0-0000-7000-8000-000000000003"
const actor = {
  userId: 7,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
}
const signal = new AbortController().signal

/**
 * The widget operations on the real handlers, over a group whose total on a day is its day of the
 * month and which adds 3 notes in any range. `role` is the actor's role; `startDay` the day the
 * group was created.
 */
function harness(role: GroupRole | null, startDay = "2020-01-01") {
  const asked: { method: string; groupId: string; range?: DateRange; timeZone: string }[] = []
  const dependencies = {
    groups: { roleOf: (_groupId: string, _userId: number) => Promise.resolve(role) },
    overview: {
      dailyTotals(groupId: string, range: DateRange, timeZone: string) {
        asked.push({ method: "dailyTotals", groupId, range, timeZone })
        const days: number[] = []
        for (let day = Number(range.from.slice(8)); day <= Number(range.to.slice(8)); day++) {
          days.push(day)
        }
        return Promise.resolve(days)
      },
      added(groupId: string, range: DateRange, timeZone: string) {
        asked.push({ method: "added", groupId, range, timeZone })
        return Promise.resolve(3)
      },
      startDay(groupId: string, timeZone: string) {
        asked.push({ method: "startDay", groupId, timeZone })
        return Promise.resolve(startDay)
      },
    },
  }
  const total = createNoteTotalWidgetHandler(dependencies)
  const added = createNoteAddedWidgetHandler(dependencies)
  const series = createNoteSeriesWidgetHandler(dependencies)
  const operations = createNoteWidgetOperations({
    total: (query) => total(query),
    added: (query) => added(query),
    series: (query) => series(query),
  })
  const call = (name: string, payload: unknown) =>
    Promise.resolve(operations[name].handle({ actor, requestId: "req-1", signal, payload }))
  return { call, asked }
}

const payload = { groupId, from: "2026-10-11", to: "2026-10-20", timeZone: "Europe/Berlin" }
const [totalOp, addedOp, seriesOp] = NOTE_WIDGETS.map((widget) => widget.operation)

describe("the note widget queries", () => {
  it("serves one query operation per note widget", () => {
    const operations = createNoteWidgetOperations({
      total: () => Promise.reject(new Error("not used")),
      added: () => Promise.reject(new Error("not used")),
      series: () => Promise.reject(new Error("not used")),
    })
    expect(Object.fromEntries(Object.entries(operations).map(([name, op]) => [name, op.kind])))
      .toEqual({
        "note.widget.total": "query",
        "note.widget.added": "query",
        "note.widget.series": "query",
      })
  })

  it("answers a viewer with the total at the end of the range and of the period before", async () => {
    const { call } = harness(GroupRole.VIEWER)

    expect(await call(totalOp, payload)).toEqual({ current: 20, previous: 10 })
  })

  it("counts the notes added in the range and in the ten days before it", async () => {
    const { call, asked } = harness(GroupRole.VIEWER)

    expect(await call(addedOp, payload)).toEqual({ current: 3, previous: 3 })
    expect(asked.filter((a) => a.method === "added").map((a) => a.range)).toEqual([
      { from: "2026-10-11", to: "2026-10-20" },
      { from: "2026-10-01", to: "2026-10-10" },
    ])
  })

  it("answers the chart with every day of the range and the previous period's days", async () => {
    const { call } = harness(GroupRole.EDITOR)

    expect(await call(seriesOp, { ...payload, from: "2026-10-18" })).toEqual({
      days: ["2026-10-18", "2026-10-19", "2026-10-20"],
      current: [18, 19, 20],
      previous: [15, 16, 17],
    })
  })

  it("leaves the comparison out for a group created inside the previous period", async () => {
    const { call } = harness(GroupRole.OWNER, "2026-10-02")

    expect(await call(totalOp, payload)).toEqual({ current: 20, previous: null })
    expect(await call(addedOp, payload)).toEqual({ current: 3, previous: null })
    expect((await call(seriesOp, payload) as { previous: unknown }).previous).toBeNull()
  })

  it("keeps the comparison for a group created on the previous period's first day", async () => {
    const { call } = harness(GroupRole.OWNER, "2026-10-01")

    expect(await call(totalOp, payload)).toEqual({ current: 20, previous: 10 })
  })

  for (const operation of [totalOp, addedOp, seriesOp]) {
    it(`tells a person outside the group it does not exist, reading nothing (${operation})`, async () => {
      const { call, asked } = harness(null)

      const error = await call(operation, payload).catch((e) => e)

      expect(error).toBeInstanceOf(NoteError)
      expect(error).toMatchObject({ code: "GROUP_NOT_FOUND" })
      expect(asked).toEqual([])
    })
  }

  it("reads only the group the payload names, in the payload's zone", async () => {
    const { call, asked } = harness(GroupRole.VIEWER)

    await call(seriesOp, payload)

    expect(new Set(asked.map((a) => a.groupId))).toEqual(new Set([groupId]))
    expect(new Set(asked.map((a) => a.timeZone))).toEqual(new Set(["Europe/Berlin"]))
  })

  const invalid: [string, unknown][] = [
    ["a reversed range", { ...payload, from: "2026-10-21" }],
    ["a range longer than a year", { ...payload, from: "2025-10-19" }],
    ["a day that does not exist", { ...payload, to: "2026-02-30" }],
    ["an unknown time zone", { ...payload, timeZone: "Mars/Olympus" }],
    ["a group id that is no UUID", { ...payload, groupId: "1" }],
    ["an extra field", { ...payload, userId: 1 }],
  ]
  for (const [name, body] of invalid) {
    it(`refuses ${name} with INVALID_REQUEST`, async () => {
      const { call } = harness(GroupRole.OWNER)

      const error = await call(totalOp, body).catch((e) => e)

      expect(error).toBeInstanceOf(NoteError)
      expect(error).toMatchObject({ code: "INVALID_REQUEST" })
    })
  }

  it("accepts a whole leap year of days", async () => {
    const { call } = harness(GroupRole.OWNER)

    const result = await call(addedOp, { ...payload, from: "2024-01-01", to: "2024-12-31" })

    expect(result).toEqual({ current: 3, previous: 3 })
  })
})
