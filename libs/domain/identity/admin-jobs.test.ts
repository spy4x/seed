import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { ADMIN_JOB_NO_FILTER, adminJobFilterQuery, parseAdminJobFilter } from "./+lib.ts"

const parse = (query: string) => parseAdminJobFilter(new URLSearchParams(query))

describe("admin jobs filter", () => {
  it("reads the search, the state chip and the page from the address", () => {
    expect(parse(`q=%20reset%20mail%20&state=failed&page=3`)).toEqual({
      query: `reset mail`,
      state: `failed`,
      page: 3,
    })
  })

  it("falls back to every run on the first page for values it does not know", () => {
    expect(parse(`state=lost&page=0`)).toEqual(ADMIN_JOB_NO_FILTER)
    expect(parse(`page=1.5`)).toEqual(ADMIN_JOB_NO_FILTER)
    expect(parse(`page=100001`)).toEqual(ADMIN_JOB_NO_FILTER)
  })

  it("cuts a search to 64 characters", () => {
    expect(parse(`q=${`a`.repeat(80)}`).query).toHaveLength(64)
  })

  it("writes back only what differs from the default, so the plain list has a plain address", () => {
    expect(adminJobFilterQuery(ADMIN_JOB_NO_FILTER)).toBe(``)
    const filter = { query: `reset`, state: `retrying` as const, page: 2 }
    expect(adminJobFilterQuery(filter)).toBe(`q=reset&state=retrying&page=2`)
    expect(parse(adminJobFilterQuery(filter))).toEqual(filter)
  })
})
