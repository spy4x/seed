import type { MiddlewareHandler } from "hono"
import { defaultResolver, type DnsResolver } from "@spy4x/net"
import { normalizeIp } from "@spy4x/net/ip"
import type { APIContext } from "../_types.ts"

/**
 * The headers in which a request names the client it came from. The API reads them (the rate
 * limits, the audit rows, a session's device), so only a proxy may send them.
 */
export const FORWARDED_HEADERS = ["x-real-ip", "x-forwarded-for", "cf-connecting-ip"] as const

/** The proxies the API trusts when `PROXY_HOSTS` is unset: this machine's own loopback. */
export const DEFAULT_PROXY_HOSTS: readonly string[] = ["127.0.0.1", "::1"]

/** How long a looked-up address of a proxy is trusted before it is looked up again. */
export const PROXY_ADDRESS_MAX_AGE_MS = 10_000

/** The least time between two lookups that a request from an unknown peer starts. */
export const PROXY_LOOKUP_RETRY_MS = 1_000

/** Tells whether a connection's peer address is one of the trusted proxies. */
export type IsProxyPeer = (peer: string | undefined) => Promise<boolean>

/** Options for {@link createProxyPeers}. */
export interface ProxyPeersOptions {
  /** Container names to look up, or IP addresses taken as they are. */
  hosts: readonly string[]
  /** Looks a name up; defaults to the system resolver (Docker's own DNS in a container). */
  resolver?: DnsResolver
  /** The clock, in milliseconds. */
  now?: () => number
  /** Told when a lookup fails; that name keeps the addresses it had. */
  onError?: (host: string, error: unknown) => void
}

/**
 * The trusted proxies of the API, by address. An IP address in `hosts` is trusted as it is. A name
 * is looked up, and its addresses are trusted for {@link PROXY_ADDRESS_MAX_AGE_MS}: a proxy that is
 * recreated gets a new address, and its old one may go to another container. A peer that is not
 * among them starts a fresh lookup, at most once per {@link PROXY_LOOKUP_RETRY_MS}, so a recreated
 * proxy is trusted again within a second. A lookup that fails keeps the name's last addresses, so a
 * DNS hiccup does not shut the proxy out. A name that does not resolve (the website, when its
 * profile is off) trusts nothing.
 */
export function createProxyPeers(options: ProxyPeersOptions): IsProxyPeer {
  const resolver = options.resolver ?? defaultResolver
  const now = options.now ?? Date.now
  const onError = options.onError ?? (() => {})
  const fixed = new Set<string>()
  const names: string[] = []
  for (const host of options.hosts) {
    const ip = normalizeIp(host)
    if (ip === null) names.push(host)
    else fixed.add(ip)
  }
  const resolved = new Map<string, string[]>()
  let lookedUpAt: number | undefined
  let pending: Promise<void> | undefined

  const lookUp = () => {
    pending ??= (async () => {
      await Promise.all(names.map(async (name) => {
        try {
          const addresses = await resolver.resolve(name)
          resolved.set(name, addresses.map((a) => normalizeIp(a)).filter((a) => a !== null))
        } catch (error) {
          onError(name, error)
        }
      }))
      lookedUpAt = now()
    })().finally(() => {
      pending = undefined
    })
    return pending
  }
  const isResolved = (ip: string) => [...resolved.values()].some((list) => list.includes(ip))

  return async (peer) => {
    const ip = peer === undefined ? null : normalizeIp(peer.trim())
    if (ip === null) return false
    if (fixed.has(ip)) return true
    if (names.length === 0) return false
    const age = lookedUpAt === undefined ? Infinity : now() - lookedUpAt
    if (age >= PROXY_ADDRESS_MAX_AGE_MS || (!isResolved(ip) && age >= PROXY_LOOKUP_RETRY_MS)) {
      await lookUp()
    }
    return isResolved(ip)
  }
}

/** The address of the connection's other end, as `deno serve` hands it to Hono in `env`. */
function peerOf(env: unknown): string | undefined {
  return (env as { remoteAddr?: { hostname?: string } } | undefined)?.remoteAddr?.hostname
}

/**
 * Refuses, with 403, a request that carries one of the {@link FORWARDED_HEADERS} and does not come
 * from a trusted proxy. Every container on the shared `proxy` network reaches the API directly;
 * without this, one of them could name any address it liked in `X-Real-IP` and get a fresh
 * sign-in budget for each (spy4x/template#381). A request without those headers passes, and the
 * API counts it under the connection's own address.
 */
export function requireProxyForForwardedHeaders(
  isProxyPeer: IsProxyPeer,
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const forwarded = FORWARDED_HEADERS.some((name) => c.req.raw.headers.has(name))
    if (forwarded && !(await isProxyPeer(peerOf(c.env)))) {
      return c.json({ error: "Forwarded headers are accepted from the proxy only" }, 403)
    }
    await next()
  }
}
