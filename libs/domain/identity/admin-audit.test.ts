import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  ADMIN_AUDIT_NO_FILTER,
  ADMIN_AUDIT_SEARCH_MAX,
  adminAuditFilterQuery,
  isAdminAuditFiltered,
  parseAdminAuditFilter,
  parseAuditEvent,
} from "./+lib.ts"

const parse = (query: string) => parseAdminAuditFilter(new URLSearchParams(query))

describe("audit log filter", () => {
  it("an empty address is the whole log", () => {
    expect(parse("")).toEqual(ADMIN_AUDIT_NO_FILTER)
    expect(isAdminAuditFiltered(parse(""))).toBe(false)
  })

  it("reads every filter of the audit log from the address", () => {
    expect(
      parse(
        "event=activity:note.created&person=%20ada%20&operator=7&from=2026-10-01&to=2026-10-16&ip=2001:db8:",
      ),
    )
      .toEqual({
        event: "activity:note.created",
        person: "ada",
        operator: 7,
        from: "2026-10-01",
        to: "2026-10-16",
        ip: "2001:db8:",
      })
  })

  it("drops every filter value that is not well formed instead of refusing the page", () => {
    expect(
      parse("event=account:0&operator=-1&from=2026-02-30&to=yesterday&ip=10.0.0.1%25"),
    ).toEqual(ADMIN_AUDIT_NO_FILTER)
    expect(parse("event=activity:DROP TABLE").event).toBeNull()
    expect(parse("operator=99999999999").operator).toBeNull()
    expect(parse("operator=2147483648").operator).toBeNull()
  })

  it("swaps days given in the wrong order", () => {
    expect(parse("from=2026-10-16&to=2026-10-01")).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-16",
    })
  })

  it("cuts a long person search to its limit", () => {
    expect(parse(`person=${"a".repeat(300)}`).person).toHaveLength(ADMIN_AUDIT_SEARCH_MAX)
  })

  it("writes a filter back to the same address it was read from", () => {
    const query =
      "event=account%3A16&person=ada&operator=7&from=2026-10-01&to=2026-10-16&ip=192.0.2"
    expect(adminAuditFilterQuery(parse(query))).toBe(query)
    expect(adminAuditFilterQuery(ADMIN_AUDIT_NO_FILTER)).toBe("")
  })

  it("splits an event into its table and its value", () => {
    expect(parseAuditEvent("account:16")).toEqual({ source: "account", eventType: 16 })
    expect(parseAuditEvent("activity:group.member_removed")).toEqual({
      source: "activity",
      kind: "group.member_removed",
    })
    expect(parseAuditEvent("other:1")).toBeNull()
    expect(parseAuditEvent(null)).toBeNull()
  })
})
