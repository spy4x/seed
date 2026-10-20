import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { readMpaConfig } from "./config.ts"

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] }
}

describe("readMpaConfig", () => {
  const prod = {
    ENV: "prod",
    DOMAIN: "app.example.com",
    MPA_DOMAIN: "www.example.com",
    API_URL: "http://api:8000",
  }

  it("serves MPA_DOMAIN over https outside development, and keeps DOMAIN's origin for the API", () => {
    expect(readMpaConfig(env(prod))).toEqual({
      apiUrl: "http://api:8000",
      webAppOrigin: "https://www.example.com",
      apiOrigin: "https://app.example.com",
    })
  })

  it("expects the browser at plain http in development", () => {
    const config = readMpaConfig(
      env({ ...prod, ENV: "dev", DOMAIN: "app.localhost:8080", MPA_DOMAIN: "www.localhost:8080" }),
    )
    expect(config.webAppOrigin).toBe("http://www.localhost:8080")
    expect(config.apiOrigin).toBe("http://app.localhost:8080")
  })

  it("refuses to start without its own host instead of taking the SPA's", () => {
    const { MPA_DOMAIN: _, ...withoutHost } = prod
    expect(() => readMpaConfig(env(withoutHost))).toThrow("MPA_DOMAIN is required")
    expect(() => readMpaConfig(env({ ...prod, MPA_DOMAIN: "" }))).toThrow("MPA_DOMAIN is required")
  })

  it("refuses an MPA_DOMAIN that carries a scheme instead of serving the host `https`", () => {
    expect(() => readMpaConfig(env({ ...prod, MPA_DOMAIN: "https://www.example.com" }))).toThrow(
      "MPA_DOMAIN must be a host",
    )
  })

  it("refuses to start without the API's address", () => {
    const { API_URL: _, ...withoutApi } = prod
    expect(() => readMpaConfig(env(withoutApi))).toThrow("API_URL is required")
  })

  it("leaves analytics off when neither Umami value is set", () => {
    expect(readMpaConfig(env(prod)).analytics).toBeUndefined()
    expect(
      readMpaConfig(env({ ...prod, MPA_UMAMI_ORIGIN: "", MPA_UMAMI_WEBSITE_ID: "" })).analytics,
    ).toBeUndefined()
  })

  it("turns analytics on with both Umami values, keeping only the origin of the address", () => {
    const config = readMpaConfig(
      env({
        ...prod,
        MPA_UMAMI_ORIGIN: "https://stats.example.com/",
        MPA_UMAMI_WEBSITE_ID: "0199f1a2-0000-7000-8000-000000000001",
      }),
    )
    expect(config.analytics).toEqual({
      origin: "https://stats.example.com",
      websiteId: "0199f1a2-0000-7000-8000-000000000001",
    })
  })

  it("refuses to start with only one Umami value instead of quietly counting nothing", () => {
    expect(() => readMpaConfig(env({ ...prod, MPA_UMAMI_ORIGIN: "https://stats.example.com" })))
      .toThrow("set together or not at all")
    expect(() => readMpaConfig(env({ ...prod, MPA_UMAMI_WEBSITE_ID: "0199f1a2" })))
      .toThrow("set together or not at all")
  })

  it("refuses a Umami origin that is not a web address", () => {
    for (const origin of ["stats.example.com", "javascript:alert(1)"]) {
      expect(() =>
        readMpaConfig(env({ ...prod, MPA_UMAMI_ORIGIN: origin, MPA_UMAMI_WEBSITE_ID: "id" }))
      ).toThrow("MPA_UMAMI_ORIGIN must be an address")
    }
  })
})
