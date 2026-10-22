import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { siteOriginOf } from "./demo.ts"

describe("siteOriginOf", () => {
  it("is the website's HTTPS origin, plain HTTP only in development, and nothing without a host", () => {
    expect(siteOriginOf("www.example.com", "prod")).toBe("https://www.example.com")
    expect(siteOriginOf("seed.localhost", "dev")).toBe("http://seed.localhost")
    expect(siteOriginOf("", "prod")).toBe(null)
    expect(siteOriginOf(undefined, "prod")).toBe(null)
    expect(siteOriginOf("https://www.example.com", "prod")).toBe(null)
  })
})
