import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  ADMIN_GROUP_DEFAULT_SORT,
  ADMIN_GROUP_NO_FILTER,
  ADMIN_GROUP_SEARCH_MAX_LENGTH,
  adminGroupFilterQuery,
  parseAdminGroupFilter,
} from "./admin-groups.ts"

describe("the operator's group list filter", () => {
  it("reads the search, status, sort and page from the address", () => {
    const filter = parseAdminGroupFilter(
      new URLSearchParams(`q=+family+&status=deleted&sort=memberCount:desc,name:asc&page=3`),
    )
    expect(filter).toEqual({
      query: `family`,
      status: `deleted`,
      sort: [{ key: `memberCount`, direction: `desc` }, { key: `name`, direction: `asc` }],
      page: 3,
    })
  })

  it("falls back to every group, newest first, page 1 for values it does not understand", () => {
    const filter = parseAdminGroupFilter(
      new URLSearchParams(`status=gone&sort=title:asc&page=-2`),
    )
    expect(filter).toEqual(ADMIN_GROUP_NO_FILTER)
    expect(parseAdminGroupFilter(new URLSearchParams(`page=1.5`)).page).toBe(1)
  })

  it("cuts a search longer than the limit", () => {
    const filter = parseAdminGroupFilter(new URLSearchParams({ q: `a`.repeat(500) }))
    expect(filter.query.length).toBe(ADMIN_GROUP_SEARCH_MAX_LENGTH)
  })

  it("writes only the parts that differ from the default, and reads them back", () => {
    expect(adminGroupFilterQuery(ADMIN_GROUP_NO_FILTER)).toBe(``)
    const filter = {
      query: `ada lovelace`,
      status: `active` as const,
      sort: [{ key: `name` as const, direction: `asc` as const }],
      page: 2,
    }
    const query = adminGroupFilterQuery(filter)
    expect(query).toBe(`q=ada+lovelace&status=active&sort=name%3Aasc&page=2`)
    expect(parseAdminGroupFilter(new URLSearchParams(query))).toEqual(filter)
    expect(adminGroupFilterQuery({ ...filter, sort: ADMIN_GROUP_DEFAULT_SORT })).not.toContain(
      `sort`,
    )
  })
})
