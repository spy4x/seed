import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  ADMIN_DEFAULT_SORT,
  ADMIN_NO_FILTER,
  type AdminUserFilter,
  adminUserFilterQuery,
  parseAdminUserFilter,
} from "./+lib.ts"

describe("admin user filter sort", () => {
  it("reads sort rules from the address, most significant first", () => {
    const filter = parseAdminUserFilter(new URLSearchParams("sort=name:asc,lastSeenAt:desc"))

    expect(filter.sort).toEqual([
      { key: "name", direction: "asc" },
      { key: "lastSeenAt", direction: "desc" },
    ])
  })

  it("falls back to newest first for a missing, empty or unknown sort", () => {
    for (const query of ["", "sort=", "sort=password:asc", "sort=name:sideways"]) {
      expect(parseAdminUserFilter(new URLSearchParams(query)).sort).toEqual(ADMIN_DEFAULT_SORT)
    }
  })

  it("keeps a sort the operator turned off, so the address says so", () => {
    const filter = parseAdminUserFilter(new URLSearchParams("sort=none"))

    expect(filter.sort).toEqual([])
    expect(adminUserFilterQuery(filter)).toBe("sort=none")
  })

  it("writes a sort into the address only when it is not the default, and reads it back", () => {
    expect(adminUserFilterQuery(ADMIN_NO_FILTER)).toBe("")
    const sort: AdminUserFilter["sort"] = [{ key: "role", direction: "asc" }]
    const query = adminUserFilterQuery({ ...ADMIN_NO_FILTER, sort })

    expect(query).toBe("sort=role%3Aasc")
    expect(parseAdminUserFilter(new URLSearchParams(query)).sort).toEqual(sort)
  })
})
