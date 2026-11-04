import type { MiddlewareHandler } from "hono"
import {
  type Clock,
  createStoreLimiter,
  failOpenLimiter,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"
import {
  createRateLimitMiddleware,
  serveRemoteAddr,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import type { APIContext } from "../_types.ts"

/**
 * Reads of the public blog one client IP may make per {@link PUBLIC_READS_WINDOW_MS} (#416). Every
 * page of the blog is one read, and the website forwards the visitor's IP, so a person reading
 * fast, a feed reader and a search engine's crawler stay far below it; a script fetching every
 * post over and over does not.
 */
export const PUBLIC_READS_PER_IP = 300

/** The window of {@link PUBLIC_READS_PER_IP}: one minute. */
export const PUBLIC_READS_WINDOW_MS = 60_000

export interface PublicReadRateLimitSettings {
  /** Builds the store of the limiter; `name` is its key prefix. See `AuthRateLimitSettings.store`. */
  store: (name: string) => RateLimitStore
  /** Told each time a store failure lets a request pass. */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/**
 * The limit of the public read routes, per client IP from `X-Real-IP`, which only a trusted proxy
 * may send. It answers 429 with `Retry-After` past the limit, and fails open: an outage of Valkey
 * must not take the public blog down.
 */
export function createPublicReadRateLimit(
  settings: PublicReadRateLimitSettings,
): MiddlewareHandler<APIContext> {
  const { store, onStoreError, clock } = settings
  const limit = PUBLIC_READS_PER_IP
  return createRateLimitMiddleware(
    failOpenLimiter(
      createStoreLimiter(store(`ratelimit-public-read`), {
        windowMs: PUBLIC_READS_WINDOW_MS,
        limit,
        clock,
      }),
      { limit, onError: onStoreError },
    ),
    {
      remoteAddr: serveRemoteAddr,
      keyResolver: userThenIp<APIContext>(() => undefined, { trustedProxy: `x-real-ip` }),
      keyPrefix: `public-read:`,
    },
  )
}
