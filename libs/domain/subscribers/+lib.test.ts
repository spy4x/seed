import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  ADMIN_SUBSCRIBERS_NO_FILTER,
  adminSubscriberFilterQuery,
  DEFAULT_SUBSCRIBER_LIST,
  isExampleAddress,
  isSubscriberList,
  parseAdminSubscriberFilter,
  SUBSCRIBER_LISTS,
} from "./+lib.ts"

describe("subscriber lists", () => {
  it("knows the lists the template ships and refuses any other name", () => {
    expect(SUBSCRIBER_LISTS).toContain(DEFAULT_SUBSCRIBER_LIST)
    expect(isSubscriberList(`news`)).toBe(true)
    expect(isSubscriberList(`admin`)).toBe(false)
    expect(isSubscriberList(undefined)).toBe(false)
  })
})

describe("example addresses", () => {
  it("recognises every domain reserved for examples, in any case and with subdomains", () => {
    for (
      const email of [
        `ann@example.com`,
        `ann@EXAMPLE.ORG`,
        `ann@example.net`,
        `ann@mail.example.com`,
        `ann@shop.example`,
        `ann@example.com.`,
      ]
    ) {
      expect({ email, example: isExampleAddress(email) }).toEqual({ email, example: true })
    }
  })

  it("leaves real domains and the testing domain mailable", () => {
    for (
      const email of [
        `ann@gmail.com`,
        `ann@example.co`,
        `ann@myexample.com`,
        `ann@example.com.au`,
        `ann@seed.test`,
      ]
    ) {
      expect({ email, example: isExampleAddress(email) }).toEqual({ email, example: false })
    }
  })
})

describe("the operator's subscriber filter", () => {
  it("reads the search, the status, the language and the page from the query string", () => {
    const params = new URLSearchParams(`q=+ada+&status=pending&language=pt-BR&page=3`)
    expect(parseAdminSubscriberFilter(params)).toEqual({
      query: `ada`,
      status: `pending`,
      language: `pt-BR`,
      page: 3,
    })
  })

  it("reads a language the apps do not ship as every language (#527)", () => {
    expect(parseAdminSubscriberFilter(new URLSearchParams(`language=xx`)).language).toBe(`any`)
  })

  it("falls back to the default for a status or page it does not know", () => {
    for (const query of [`status=unsubscribed&page=0`, `status=&page=1.5`, `page=100001`]) {
      expect(parseAdminSubscriberFilter(new URLSearchParams(query))).toEqual(
        ADMIN_SUBSCRIBERS_NO_FILTER,
      )
    }
  })

  it("cuts a search longer than the search box takes", () => {
    const params = new URLSearchParams({ q: `a`.repeat(500) })
    expect(parseAdminSubscriberFilter(params).query.length).toBe(100)
  })

  it("writes back only what differs from the default, so a reload reads the same filter", () => {
    expect(adminSubscriberFilterQuery(ADMIN_SUBSCRIBERS_NO_FILTER)).toBe(``)
    const filter = { query: `a b`, status: `confirmed` as const, language: `de` as const, page: 2 }
    const query = adminSubscriberFilterQuery(filter)
    expect(query).toBe(`q=a+b&status=confirmed&language=de&page=2`)
    expect(parseAdminSubscriberFilter(new URLSearchParams(query))).toEqual(filter)
  })
})
