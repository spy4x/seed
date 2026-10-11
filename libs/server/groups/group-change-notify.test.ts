import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { type } from "arktype"
import {
  groupAccessLossSchema,
  GroupChangeNotifier,
  groupChangeSchema,
} from "./group-change-notify.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

const GROUP_ID = "0b1f3c58-7f55-4a5d-8f6e-6a3a5a9d1a01"

const accepts = (schema: typeof groupChangeSchema | typeof groupAccessLossSchema, value: unknown) =>
  !(schema(value) instanceof type.errors)

describe("groupChangeSchema", () => {
  it("accepts a well-formed change", () => {
    expect(accepts(groupChangeSchema, { groupId: GROUP_ID, sequence: 3 })).toBe(true)
  })

  it("drops anything that is not a group change", () => {
    const payloads = [
      null,
      [],
      { groupId: "not-a-uuid", sequence: 1 },
      { groupId: GROUP_ID, sequence: 0 },
      { groupId: GROUP_ID, sequence: 1.5 },
      { groupId: GROUP_ID, sequence: "3" },
      { sequence: 1 },
    ]
    for (const payload of payloads) expect(accepts(groupChangeSchema, payload)).toBe(false)
  })
})

describe("groupAccessLossSchema", () => {
  it("accepts a well-formed access loss", () => {
    expect(accepts(groupAccessLossSchema, { groupId: GROUP_ID, sequence: 3, userIds: [4, 9] }))
      .toBe(true)
  })

  it("drops anything that is not an access loss", () => {
    const payloads = [
      null,
      { groupId: GROUP_ID, sequence: 3 },
      { groupId: GROUP_ID, sequence: 3, userIds: [] },
      { groupId: GROUP_ID, sequence: 3, userIds: "4" },
      { groupId: GROUP_ID, sequence: 3, userIds: [4, "9"] },
      { groupId: GROUP_ID, sequence: 3, userIds: [0] },
      { groupId: GROUP_ID, sequence: 3, userIds: [1.5] },
      { groupId: GROUP_ID, sequence: 0, userIds: [4] },
      { groupId: "not-a-uuid", sequence: 3, userIds: [4] },
    ]
    for (const payload of payloads) expect(accepts(groupAccessLossSchema, payload)).toBe(false)
  })
})

describe("GroupChangeNotifier", () => {
  function notifierWith(queries: unknown[][]) {
    // A tagged-template stand-in for the postgres client that records what would be sent.
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push([strings.join("?"), ...values])
      return Promise.resolve([])
    }) as unknown as ConstructorParameters<typeof GroupChangeNotifier>[0]
    return new GroupChangeNotifier(sql)
  }
  const event = (aggregateType: string, aggregateVersion: string) => ({
    id: uuidV7(),
    eventKind: "group.created",
    aggregateType,
    aggregateId: GROUP_ID,
    aggregateVersion,
    attemptCount: 1,
  })

  it("announces a group change with its id and sequence and nothing else", async () => {
    const queries: unknown[][] = []

    await notifierWith(queries).publish(event("group", "12"))

    expect(queries.length).toBe(1)
    expect(queries[0][1]).toBe("group_change")
    expect(JSON.parse(queries[0][2] as string)).toEqual({ groupId: GROUP_ID, sequence: 12 })
  })

  it("leaves a row of another aggregate alone", async () => {
    const queries: unknown[][] = []

    await notifierWith(queries).publish(event("note", "1"))

    expect(queries).toEqual([])
  })

  it("fails a row without a usable sequence so the outbox retries it", async () => {
    await expect(notifierWith([]).publish(event("group", "0"))).rejects.toThrow(RangeError)
    await expect(notifierWith([]).publish(event("group", "nine"))).rejects.toThrow(RangeError)
  })
})
