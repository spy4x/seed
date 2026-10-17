import type { MiddlewareHandler } from "hono"
import {
  type Clock,
  createStoreLimiter,
  type RateLimitDecision,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"
import {
  createRateLimitMiddleware,
  denoServeRemoteAddr,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import type { APIContext } from "../_types.ts"

/** Confirm mails one address may be sent per {@link SUBSCRIBE_RECIPIENT_WINDOW_MS}, from any IP. */
export const SUBSCRIBE_MAILS_PER_RECIPIENT = 3

/** The window of {@link SUBSCRIBE_MAILS_PER_RECIPIENT}: one hour. */
export const SUBSCRIBE_RECIPIENT_WINDOW_MS = 60 * 60_000

/** The limits of the subscriber routes, none of which knows a user. */
export interface SubscriberRateLimits {
  /** Subscribe requests per client IP: the strict auth budget's size and window, in its own store. */
  subscribeByIp: MiddlewareHandler<APIContext>
  /** Opening and using a confirm or unsubscribe link, per client IP, in a budget of its own. */
  tokenByIp: MiddlewareHandler<APIContext>
  /**
   * Spends one of the address's {@link SUBSCRIBE_MAILS_PER_RECIPIENT} confirm mails, whatever the
   * IP, so many clients cannot flood one inbox. Keyed by {@link SubscriberRateLimitSettings.recipientKey}:
   * Valkey never holds an address.
   */
  mailByRecipient(email: string): Promise<RateLimitDecision>
}

export interface SubscriberRateLimitSettings {
  windowMs: number
  strictLimit: number
  /** Builds the store of one limiter; `name` is its key prefix. See `AuthRateLimitSettings.store`. */
  store: (name: string) => RateLimitStore
  /** The budget key of an address: a keyed hash, so a key cannot be matched to a guessed address. */
  recipientKey: (email: string) => Promise<string>
  /** Injected by tests. */
  clock?: Clock
}

export function createSubscriberRateLimits(
  settings: SubscriberRateLimitSettings,
): SubscriberRateLimits {
  const { windowMs, clock, store } = settings
  const subscribe = createStoreLimiter(store(`ratelimit-subscribe`), {
    windowMs,
    limit: settings.strictLimit,
    clock,
  })
  const token = createStoreLimiter(store(`ratelimit-subscriber-token`), {
    windowMs,
    limit: settings.strictLimit,
    clock,
  })
  const recipient = createStoreLimiter(store(`ratelimit-subscribe-recipient`), {
    windowMs: SUBSCRIBE_RECIPIENT_WINDOW_MS,
    limit: SUBSCRIBE_MAILS_PER_RECIPIENT,
    clock,
  })
  const byIp = userThenIp<APIContext>(() => undefined, { trustedProxy: `x-real-ip` })
  return {
    subscribeByIp: createRateLimitMiddleware(subscribe, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byIp,
      keyPrefix: `subscribe:`,
    }),
    tokenByIp: createRateLimitMiddleware(token, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byIp,
      keyPrefix: `subscriber-token:`,
    }),
    mailByRecipient: async (email) =>
      await recipient.check(`subscribe-recipient:${await settings.recipientKey(email)}`),
  }
}
