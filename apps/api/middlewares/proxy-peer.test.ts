import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { APIContext } from "../_types.ts"
import {
  createProxyPeers,
  PROXY_ADDRESS_MAX_AGE_MS,
  PROXY_LOOKUP_RETRY_MS,
  requireProxyForForwardedHeaders,
} from "./proxy-peer.ts"

const TRAEFIK = "172.18.0.2"
const NEIGHBOUR = "172.18.0.9"

/** A resolver that answers from `table` and counts its lookups. */
function fakeResolver(table: Record<string, string[] | Error>) {
  const lookups: string[] = []
  return {
    lookups,
    resolve(name: string) {
      lookups.push(name)
      const answer = table[name]
      if (answer instanceof Error) return Promise.reject(answer)
      return Promise.resolve(answer ?? [])
    },
  }
}

/** A clock the test moves by hand. */
function fakeClock() {
  let time = 1_000_000
  return { now: () => time, advance: (ms: number) => time += ms }
}

describe("createProxyPeers", () => {
  it("trusts the address a proxy's name resolves to, and no other", async () => {
    const resolver = fakeResolver({ traefik: [TRAEFIK] })
    const isProxy = createProxyPeers({ hosts: ["traefik"], resolver })

    expect(await isProxy(TRAEFIK)).toBe(true)
    expect(await isProxy(NEIGHBOUR)).toBe(false)
    expect(await isProxy(undefined)).toBe(false)
    expect(await isProxy("not an address")).toBe(false)
  })

  it("trusts an IP address in the list without a lookup, in any spelling", async () => {
    const resolver = fakeResolver({})
    const isProxy = createProxyPeers({ hosts: ["127.0.0.1", "::1"], resolver })

    expect(await isProxy("::ffff:127.0.0.1")).toBe(true)
    expect(await isProxy("0:0:0:0:0:0:0:1")).toBe(true)
    expect(await isProxy(NEIGHBOUR)).toBe(false)
    expect(resolver.lookups).toEqual([])
  })

  it("stops trusting a proxy's old address once it is looked up again", async () => {
    const table: Record<string, string[]> = { traefik: [TRAEFIK] }
    const clock = fakeClock()
    const isProxy = createProxyPeers({
      hosts: ["traefik"],
      resolver: fakeResolver(table),
      ...clock,
    })
    expect(await isProxy(TRAEFIK)).toBe(true)

    // Traefik is recreated at a new address, and its old one goes to another container.
    table.traefik = ["172.18.0.3"]
    clock.advance(PROXY_ADDRESS_MAX_AGE_MS)

    expect(await isProxy(TRAEFIK)).toBe(false)
    expect(await isProxy("172.18.0.3")).toBe(true)
  })

  it("looks up again for an unknown peer, at most once a second", async () => {
    const table: Record<string, string[]> = { traefik: [TRAEFIK] }
    const clock = fakeClock()
    const resolver = fakeResolver(table)
    const isProxy = createProxyPeers({ hosts: ["traefik"], resolver, ...clock })
    expect(await isProxy(TRAEFIK)).toBe(true)

    table.traefik = ["172.18.0.3"]
    expect(await isProxy("172.18.0.3")).toBe(false)
    expect(await isProxy(NEIGHBOUR)).toBe(false)
    expect(resolver.lookups).toEqual(["traefik"])

    clock.advance(PROXY_LOOKUP_RETRY_MS)
    expect(await isProxy("172.18.0.3")).toBe(true)
    expect(resolver.lookups).toEqual(["traefik", "traefik"])
    // A known address starts no lookup before the addresses grow old.
    expect(await isProxy("172.18.0.3")).toBe(true)
    expect(resolver.lookups).toEqual(["traefik", "traefik"])
  })

  it("keeps a name's last addresses when a lookup fails, and reports the failure", async () => {
    const table: Record<string, string[] | Error> = { traefik: [TRAEFIK] }
    const clock = fakeClock()
    const errors: string[] = []
    const isProxy = createProxyPeers({
      hosts: ["traefik"],
      resolver: fakeResolver(table),
      ...clock,
      onError: (host) => errors.push(host),
    })
    expect(await isProxy(TRAEFIK)).toBe(true)

    table.traefik = new Error("SERVFAIL")
    clock.advance(PROXY_ADDRESS_MAX_AGE_MS)

    expect(await isProxy(TRAEFIK)).toBe(true)
    expect(errors).toEqual(["traefik"])
  })

  it("trusts every name in the list, and nothing for a name that does not resolve", async () => {
    const resolver = fakeResolver({ traefik: [TRAEFIK], "app-mpa": ["172.18.0.4"] })
    const isProxy = createProxyPeers({ hosts: ["traefik", "app-mpa", "gone"], resolver })

    expect(await isProxy(TRAEFIK)).toBe(true)
    expect(await isProxy("172.18.0.4")).toBe(true)
    expect(await isProxy(NEIGHBOUR)).toBe(false)
  })
})

describe("requireProxyForForwardedHeaders", () => {
  /** The check in front of a route that answers 200, with Traefik at {@link TRAEFIK}. */
  function buildApp() {
    const isProxy = createProxyPeers({
      hosts: ["traefik"],
      resolver: fakeResolver({ traefik: [TRAEFIK] }),
    })
    const app = new Hono<APIContext>()
    app.use("*", requireProxyForForwardedHeaders(isProxy))
    app.all("*", (c) => c.text("reached"))
    return app
  }

  /** The status of a request with `headers`, from a connection whose other end is `peer`. */
  async function statusFrom(peer: string, headers: Record<string, string> = {}) {
    const env = { remoteAddr: { transport: "tcp", hostname: peer, port: 40000 } }
    return (await buildApp().request("http://api.test/api/auth/password/check", { headers }, env))
      .status
  }

  it("refuses a forged client address from a container beside the proxy", async () => {
    expect(await statusFrom(NEIGHBOUR, { "x-real-ip": "192.0.2.1" })).toBe(403)
    expect(await statusFrom(NEIGHBOUR, { "x-forwarded-for": "192.0.2.1" })).toBe(403)
    expect(await statusFrom(NEIGHBOUR, { "cf-connecting-ip": "192.0.2.1" })).toBe(403)
  })

  it("passes the proxy's client address, and a neighbour that names no client", async () => {
    expect(await statusFrom(TRAEFIK, { "x-real-ip": "192.0.2.1" })).toBe(200)
    expect(await statusFrom(NEIGHBOUR)).toBe(200)
  })

  it("refuses a forwarded header on a request with no peer address", async () => {
    const response = await buildApp().request("http://api.test/api/health", {
      headers: { "x-real-ip": "192.0.2.1" },
    })
    expect(response.status).toBe(403)
  })
})
