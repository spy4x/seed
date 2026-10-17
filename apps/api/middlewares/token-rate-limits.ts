import type { MiddlewareHandler } from "hono"
import {
  type Clock,
  createStoreLimiter,
  failOpenLimiter,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"
import {
  createRateLimitMiddleware,
  denoServeRemoteAddr,
  type RateLimitContext,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import type { TokenApiContext } from "../routes/token-api.ts"

/** The limits of the token API (`routes/token-api.ts`). Each answers 429 with `Retry-After`. */
export interface TokenRateLimits {
  /**
   * Refused requests per client IP, spent before the token is checked: guessing tokens, or using a
   * revoked one, runs out of budget. A request that succeeds gives its slot back, so a client that
   * runs several tokens from one address is held only by each token's own budget.
   */
  failuresByIp: MiddlewareHandler<TokenApiContext>
  /** Requests per token, whatever the address: each token has a budget of its own. */
  byToken: MiddlewareHandler<TokenApiContext>
  /**
   * Whether one more refused request may be audited under `key`, a token's id and the reason:
   * {@link REFUSAL_AUDITS_PER_WINDOW} per {@link REFUSAL_AUDIT_WINDOW_MS}. A flood of refused
   * requests with one token therefore writes a few `auth_audits` rows an hour, not one each.
   * Unlike the two limits above it throws when the store fails: the caller then writes no row, so
   * the bound holds while Valkey is down.
   */
  refusalAudit(key: string): Promise<boolean>
}

/** The window of {@link TokenRateLimits.refusalAudit}: five minutes, as a token's use is audited. */
export const REFUSAL_AUDIT_WINDOW_MS = 5 * 60_000

/** Audit rows per token and reason in one window. */
export const REFUSAL_AUDITS_PER_WINDOW = 1

/** Limits per window, from `config.rateLimiter`. */
export interface TokenRateLimitSettings {
  windowMs: number
  /** Requests per window, for each budget: the normal signed-in limit. */
  limit: number
  /**
   * Builds the store of one limiter; `name` is its key prefix, `ratelimit-api-token`,
   * `ratelimit-api-token-ip` or `ratelimit-api-token-refusal`. See `AuthRateLimitSettings.store`.
   */
  store: (name: string) => RateLimitStore
  /** Told each time a store failure is let pass. */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Builds the token API's limits. The two request limits fail open when the store fails, as the normal auth limit
 * does: a token is 128 random bits, so the IP budget slows guessing but is not what stops it, and
 * the API keeps answering while Valkey is down. The client IP is read as the auth limits read it:
 * `X-Real-IP` from Traefik, else the connection's address.
 */
export function createTokenRateLimits(settings: TokenRateLimitSettings): TokenRateLimits {
  const { windowMs, limit, clock, store, onStoreError } = settings
  const failOpen = (name: string) =>
    failOpenLimiter(createStoreLimiter(store(name), { windowMs, limit, clock }), {
      limit,
      onError: onStoreError,
    })
  const tokenId = (_: Request, context: RateLimitContext<TokenApiContext>) =>
    (context.get?.("apiToken") as { id?: string } | undefined)?.id
  const refusals = createStoreLimiter(store(`ratelimit-api-token-refusal`), {
    windowMs: REFUSAL_AUDIT_WINDOW_MS,
    limit: REFUSAL_AUDITS_PER_WINDOW,
    clock,
  })
  return {
    refusalAudit: async (key) => (await refusals.check(`api-token-refusal:${key}`)).allowed,
    failuresByIp: createRateLimitMiddleware(failOpen(`ratelimit-api-token-ip`), {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: userThenIp<TokenApiContext>(() => undefined, { trustedProxy: `x-real-ip` }),
      keyPrefix: `api-token-ip:`,
      skipSuccessful: true,
      onRefundError: onStoreError,
    }),
    byToken: createRateLimitMiddleware(failOpen(`ratelimit-api-token`), {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: userThenIp<TokenApiContext>(tokenId, { trustedProxy: `x-real-ip` }),
      keyPrefix: `api-token:`,
    }),
  }
}
