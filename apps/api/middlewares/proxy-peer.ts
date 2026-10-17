/**
 * The proxies the API trusts when `PROXY_HOSTS` is unset: this machine's own loopback. The check
 * itself is `createProxyPeers` and `requireProxyForForwardedHeaders` from
 * `@spy4x/server/http/trusted-proxy`.
 */
export const DEFAULT_PROXY_HOSTS: readonly string[] = ["127.0.0.1", "::1"]
