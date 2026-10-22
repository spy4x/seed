import type { Context, MiddlewareHandler } from "hono"
import {
  clientIp,
  clientIpBucket,
  type Clock,
  createStoreLimiter,
  failOpenLimiter,
  type RateLimitDecision,
  type RateLimitStore,
} from "@spy4x/platform/rate-limit"
import { sha256Hex } from "@spy4x/platform/tokens"
import {
  createRateLimitMiddleware,
  denoServeRemoteAddr,
  type RateLimitContext,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import { GUEST_STARTS_PER_HOUR } from "@domain/identity"
import type { APIContext } from "../_types.ts"
import type { AppAuthState } from "../services/sign-in.ts"

/** Reset links one address may be sent per {@link RESET_ADDRESS_WINDOW_MS}, from any IP. */
export const RESET_MAILS_PER_ADDRESS = 3

/** The window of {@link RESET_MAILS_PER_ADDRESS}: one hour. */
export const RESET_ADDRESS_WINDOW_MS = 60 * 60_000

/**
 * Code mails a signed-in account may have sent to its own address per
 * {@link EMAIL_CODE_ADDRESS_WINDOW_MS}. A sign-up spends {@link SIGN_UP_CODE_MAILS_PER_CLIENT} and
 * {@link SIGN_UP_CODE_MAILS_PER_ADDRESS} instead, so a stranger's sign-ups cannot run it out.
 */
export const EMAIL_CODE_MAILS_PER_ADDRESS = 3

/** The window of {@link EMAIL_CODE_MAILS_PER_ADDRESS}: one hour. */
export const EMAIL_CODE_ADDRESS_WINDOW_MS = 60 * 60_000

/** The store prefix of {@link EMAIL_CODE_MAILS_PER_ADDRESS}. */
export const EMAIL_CODE_STORE = `ratelimit-email-code`

/** The key of one address's {@link EMAIL_CODE_MAILS_PER_ADDRESS}: a hash, never the address. */
export async function emailCodeBudgetKey(email: string): Promise<string> {
  return `auth-email-code:${await sha256Hex(email)}`
}

/**
 * Sign-up code mails one client, an IPv4 address or an IPv6 /48, may have sent to one address per
 * {@link SIGN_UP_CODE_WINDOW_MS}: a sign-up or a new code for one. Keyed by the address and the
 * client together, so a stranger who starts sign-ups for an address spends only their own share,
 * and the address's owner, from their own network, still gets a code.
 */
export const SIGN_UP_CODE_MAILS_PER_CLIENT = 3

/**
 * Sign-up code mails all clients together may have sent to one address per
 * {@link SIGN_UP_CODE_WINDOW_MS}, so many networks together still cannot flood an inbox. Higher
 * than {@link SIGN_UP_CODE_MAILS_PER_CLIENT}, so a stranger needs several networks to reach it.
 */
export const SIGN_UP_CODE_MAILS_PER_ADDRESS = 10

/** The window of both sign-up code budgets: one hour. */
export const SIGN_UP_CODE_WINDOW_MS = 60 * 60_000

/** The store prefix of both sign-up code budgets. */
export const SIGN_UP_CODE_STORE = `ratelimit-sign-up-code`

/**
 * The keys of one address's sign-up code budgets, the whole address's and one client's: hashes,
 * never the address. `client` is what {@link signUpClient} answers.
 */
export async function signUpCodeBudgetKeys(
  email: string,
  client: string,
): Promise<{ address: string; client: string }> {
  const hash = await sha256Hex(email)
  return { address: `auth-sign-up-code:${hash}`, client: `auth-sign-up-code:${hash}:${client}` }
}

/**
 * The IPv6 network one client counts as for {@link SIGN_UP_CODE_MAILS_PER_CLIENT}: a /48, wider than
 * the /64 of the per-IP limits. A free tunnel broker hands anyone a /48, which holds 65,536 /64s, so
 * per /64 one stranger could spend the address's whole {@link SIGN_UP_CODE_MAILS_PER_ADDRESS}; per
 * /48 that stranger gets one share. Neighbours behind one /48 share it too, which costs them at most
 * a wait for a sign-up code to one address.
 */
export const SIGN_UP_CLIENT_IPV6_PREFIX = 48

/**
 * The client a request counts as for {@link SIGN_UP_CODE_MAILS_PER_CLIENT}: its IPv4 address, or its
 * IPv6 /48 ({@link SIGN_UP_CLIENT_IPV6_PREFIX}), read the same way as for the per-IP limits
 * (`X-Real-IP`, else the connection).
 */
export function signUpClient(c: Context<APIContext>): string {
  // `c.env` is what `deno serve` hands Hono, the same object the per-IP limits read.
  const remoteAddr = denoServeRemoteAddr({ req: c.req.raw, env: c.env } as RateLimitContext)
  return clientIpBucket(clientIp(c.req.raw, remoteAddr, "x-real-ip"), {
    ipv6Prefix: SIGN_UP_CLIENT_IPV6_PREFIX,
  })
}

/**
 * Sign-in links one client, as {@link signUpClient} counts it, may have sent to one address per
 * {@link SIGN_IN_LINK_WINDOW_MS} (#391). Keyed by the address and the client together, like the
 * sign-up codes: a stranger who keeps asking for an address's links spends only their own share.
 */
export const SIGN_IN_LINK_MAILS_PER_CLIENT = 3

/** Sign-in links all clients together may have sent to one address per window. */
export const SIGN_IN_LINK_MAILS_PER_ADDRESS = 10

/** The window of both sign-in link budgets: one hour. */
export const SIGN_IN_LINK_WINDOW_MS = 60 * 60_000

/** The store prefix of both sign-in link budgets. */
export const SIGN_IN_LINK_STORE = `ratelimit-sign-in-link`

/** The keys of one address's sign-in link budgets: hashes, never the address. */
export async function signInLinkBudgetKeys(
  email: string,
  client: string,
): Promise<{ address: string; client: string }> {
  const hash = await sha256Hex(email)
  return { address: `auth-sign-in-link:${hash}`, client: `auth-sign-in-link:${hash}:${client}` }
}

/**
 * Code mails one account may send to an address it wants to move to, per
 * {@link EMAIL_CHANGE_ACCOUNT_WINDOW_MS}, whatever the address. The account pays, not the address:
 * the address may belong to someone else, whose own budget must stay theirs.
 */
export const EMAIL_CHANGE_MAILS_PER_ACCOUNT = 3

/** The window of {@link EMAIL_CHANGE_MAILS_PER_ACCOUNT}: one hour. */
export const EMAIL_CHANGE_ACCOUNT_WINDOW_MS = 60 * 60_000

/**
 * Code mails all accounts together may send to one address they want to move to, per
 * {@link EMAIL_CHANGE_ADDRESS_WINDOW_MS}. Separate from {@link EMAIL_CODE_MAILS_PER_ADDRESS}, so
 * many accounts cannot flood an inbox, yet cannot run its owner's own budget out either.
 */
export const EMAIL_CHANGE_MAILS_PER_ADDRESS = 3

/** The window of {@link EMAIL_CHANGE_MAILS_PER_ADDRESS}: one hour. */
export const EMAIL_CHANGE_ADDRESS_WINDOW_MS = 60 * 60_000

/** The rate limits the auth routes mount. Each one answers 429 with `Retry-After` when spent. */
export interface AuthRateLimits {
  /**
   * Strict limit per client IP, for sign-in, sign-up, asking for a reset link and using one, where
   * no user is known yet. A sign-in with Google or GitHub spends one attempt when the provider
   * sends the browser back, and a second one when the person then confirms a new account;
   * leaving for the provider spends the normal limit.
   */
  strictByIp: MiddlewareHandler<APIContext>
  /**
   * Strict limit per signed-in user, for every step that checks the current password: changing it
   * or the address, and handing a group to another member (`/groups/:groupId/transfer`).
   */
  strictByUser: MiddlewareHandler<APIContext>
  /**
   * Slow limit per signed-in user, for checking a six-digit one-time code: `/totp/check` and
   * `/totp/connect/finish` share one budget. Only failed checks (status 400 and above) spend it.
   */
  otpByUser: MiddlewareHandler<APIContext>
  /**
   * Spends one of the client's {@link GUEST_STARTS_PER_HOUR} new guest accounts an hour (#224),
   * counted per address as the sign-up mails are (an IPv6 client by its prefix), and says whether
   * it was allowed. Refuses the same way as `emailCodeByAddress` when the store fails: this budget
   * stands between a script and a database full of empty accounts.
   */
  guestStart(c: Context<APIContext>): Promise<RateLimitDecision>
  /** Normal limit per signed-in user, else per client IP, for every other auth route. */
  normal: MiddlewareHandler<APIContext>
  /**
   * Spends one of the address's {@link RESET_MAILS_PER_ADDRESS} reset links, whatever the IP, and
   * says whether it was allowed. Called by the route once it has read the address from the body.
   * A store failure throws, like the strict limit: this budget stands between an attacker and a
   * flood of mail to someone else's inbox.
   */
  resetByAddress(email: string): Promise<RateLimitDecision>
  /**
   * Spends one of the address's {@link EMAIL_CODE_MAILS_PER_ADDRESS} code mails, the same way
   * `resetByAddress` spends a reset link, and refuses the same way when the store fails.
   */
  emailCodeByAddress(email: string): Promise<RateLimitDecision>
  /**
   * Spends one of the client's {@link SIGN_UP_CODE_MAILS_PER_CLIENT} sign-up code mails to the
   * address, then one of the address's {@link SIGN_UP_CODE_MAILS_PER_ADDRESS}, and says whether
   * both allowed it. A client past its own share spends nothing of the address's, so one network
   * that keeps asking cannot run the address's budget out. Refuses the same way as
   * `emailCodeByAddress` when the store fails.
   */
  signUpCode(c: Context<APIContext>, email: string): Promise<RateLimitDecision>
  /**
   * Spends one of the client's {@link SIGN_IN_LINK_MAILS_PER_CLIENT} sign-in links to the address,
   * then one of the address's {@link SIGN_IN_LINK_MAILS_PER_ADDRESS}, as `signUpCode` does, and
   * refuses the same way when the store fails.
   */
  signInLink(c: Context<APIContext>, email: string): Promise<RateLimitDecision>
  /**
   * Spends one of the account's {@link EMAIL_CHANGE_MAILS_PER_ACCOUNT} code mails to a new address,
   * and refuses the same way as `emailCodeByAddress` when the store fails.
   */
  emailChangeByUser(userId: number): Promise<RateLimitDecision>
  /**
   * Spends one of the address's {@link EMAIL_CHANGE_MAILS_PER_ADDRESS} code mails from accounts
   * that want to move to it, and refuses the same way as `emailCodeByAddress` when the store fails.
   */
  emailChangeByAddress(email: string): Promise<RateLimitDecision>
}

/** Limits per window, from `config.rateLimiter`. */
export interface AuthRateLimitSettings {
  windowMs: number
  strictLimit: number
  limit: number
  /** Window of the one-time-code limit, much longer than `windowMs`. */
  otpWindowMs: number
  /** One-time-code checks per `otpWindowMs`. */
  otpLimit: number
  /**
   * Builds the store one limiter keeps its budgets in. `name` is that limiter's own key prefix:
   * `ratelimit-strict`, `ratelimit-otp`, `ratelimit-reset`, `ratelimit-email-code`,
   * `ratelimit-sign-up-code`, `ratelimit-email-change`, `ratelimit-email-change-address`,
   * `ratelimit-guest` or `ratelimit-normal`. Production passes `createRedisRateLimitStore` over Valkey; tests pass an
   * in-process store.
   */
  store: (name: string) => RateLimitStore
  /**
   * Told each time a store failure is let pass: the normal limit allowing a request, or a correct
   * one-time code whose slot could not be given back.
   */
  onStoreError: (error: unknown) => void
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Build the auth rate limits over the stores `settings.store` builds. In production that is Valkey
 * through the atomic `createRedisRateLimitStore`, so every budget survives an API restart or
 * deploy, and any number of API instances share one exact budget per client. Compose runs Valkey
 * without persistence (`--save ""`), so restarting Valkey itself still empties every budget. Compose
 * also runs Valkey with `--maxmemory-policy allkeys-lru`, so under memory pressure a budget may be
 * evicted like any cached key; a budget under attack is touched on every attempt and is the last to
 * go, and the Postgres failure counter still bounds one-time-code guesses.
 *
 * When Valkey fails, the strict, one-time-code, reset and code-mail limits refuse the request (the
 * error reaches Hono's error handler, which answers 500): they stand between an attacker and a
 * password, a six-digit code or someone else's inbox, and letting attempts through unseen is the
 * attack they exist to stop. The normal
 * limit lets the request through and reports the error through `settings.onStoreError`, so sign-out
 * and `/me` keep working while Valkey is down, as the rest of the signed-in API does. The normal
 * limit uses `failOpenLimiter` for that; the others must never be wrapped in it. A correct
 * one-time code whose slot cannot be given back keeps its response (the session cookie included),
 * and the slot stays spent; that error is reported through `settings.onStoreError` too.
 *
 * Shared budgets, on purpose: sign-in, sign-up and both halves of a password reset from one IP
 * spend one strict budget, since each guesses or probes an account. Asking for a reset link also
 * spends the address's own budget (`resetByAddress`), so many IPs together still cannot flood one
 * inbox. `/totp/check` and `/totp/connect/finish` spend one user's one-time-code
 * budget, so switching routes buys no extra guesses. The e-mail address routes (asking for a code,
 * checking one, changing the address) spend the user's strict budget. A code mail to the account's
 * own address also spends that address's budget (`emailCodeByAddress`). A code mail to an address
 * the account wants to move to spends the account's budget (`emailChangeByUser`) and a separate
 * budget of that address for change mails (`emailChangeByAddress`) instead: the address may be
 * someone else's, and a stranger must not run its owner's budget out, while many strangers
 * together still cannot flood it. A sign-up and a new code for one prove nothing yet, so they spend
 * neither of those: they spend the client's share of the address's sign-up mails and the
 * address's sign-up total (`signUpCode`), so a stranger who signs an address up runs out of their
 * own share, not of its owner's. Every other auth route spends one normal budget per user, else
 * per IP. Each route mounts its limiter after its cross-site check, so a
 * refused cross-site request spends nobody's budget.
 *
 * The one-time-code limit is separate because a six-digit code is a small secret: one random guess
 * succeeds about once in 333,000 tries, so it needs far fewer attempts per day than a password.
 * Only wrong codes spend it (`skipSuccessful`), so a user who signs in six times in one window is
 * never refused. The failure counter in `services/totp-failures.ts` lives in Postgres and is what
 * limits guesses over days and years.
 *
 * Client address: the client IP comes from `X-Real-IP`, which Traefik overwrites on every request.
 * The connection's own address, which `deno serve` hands Hono as `env.remoteAddr`, is the
 * fallback. `CF-Connecting-IP` and `X-Forwarded-For` are not read here. Only a trusted proxy may
 * send `X-Real-IP`: `requireProxyForForwardedHeaders` (`@spy4x/server/http/trusted-proxy`), in
 * front of every route, refuses a request that carries it, or either other header, from any other
 * peer, so a container on the shared `proxy` network that calls the API directly is counted under
 * its own address. The trusted proxies are `PROXY_HOSTS`: Traefik and this project's website in
 * the compose stack. One setup still breaks this: behind Cloudflare's proxy, Traefik sets
 * `X-Real-IP` to a Cloudflare address, so users share budgets per Cloudflare edge instead of per
 * client.
 */
export function createAuthRateLimits(settings: AuthRateLimitSettings): AuthRateLimits {
  const { windowMs, clock, store } = settings
  const strict = createStoreLimiter(store("ratelimit-strict"), {
    windowMs,
    limit: settings.strictLimit,
    clock,
  })
  const otp = createStoreLimiter(store("ratelimit-otp"), {
    windowMs: settings.otpWindowMs,
    limit: settings.otpLimit,
    clock,
  })
  // Its own store: a sliding window an hour long, keyed by a hash of the address, so Valkey never
  // holds an address.
  const reset = createStoreLimiter(store("ratelimit-reset"), {
    windowMs: RESET_ADDRESS_WINDOW_MS,
    limit: RESET_MAILS_PER_ADDRESS,
    clock,
  })
  const emailCode = createStoreLimiter(store(EMAIL_CODE_STORE), {
    windowMs: EMAIL_CODE_ADDRESS_WINDOW_MS,
    limit: EMAIL_CODE_MAILS_PER_ADDRESS,
    clock,
  })
  // Both sign-up budgets share one store: a client's share and the whole address's, so a stranger
  // cannot run the owner's share out, and many strangers together cannot flood the inbox.
  const signUpStore = store(SIGN_UP_CODE_STORE)
  const signUpByClient = createStoreLimiter(signUpStore, {
    windowMs: SIGN_UP_CODE_WINDOW_MS,
    limit: SIGN_UP_CODE_MAILS_PER_CLIENT,
    clock,
  })
  const signUpByAddress = createStoreLimiter(signUpStore, {
    windowMs: SIGN_UP_CODE_WINDOW_MS,
    limit: SIGN_UP_CODE_MAILS_PER_ADDRESS,
    clock,
  })
  // The same two budgets for sign-in links (#391), in a store of their own.
  const linkStore = store(SIGN_IN_LINK_STORE)
  const linkByClient = createStoreLimiter(linkStore, {
    windowMs: SIGN_IN_LINK_WINDOW_MS,
    limit: SIGN_IN_LINK_MAILS_PER_CLIENT,
    clock,
  })
  const linkByAddress = createStoreLimiter(linkStore, {
    windowMs: SIGN_IN_LINK_WINDOW_MS,
    limit: SIGN_IN_LINK_MAILS_PER_ADDRESS,
    clock,
  })
  // Keyed by the account, so asking to move to someone else's address spends only the asker's.
  const emailChange = createStoreLimiter(store("ratelimit-email-change"), {
    windowMs: EMAIL_CHANGE_ACCOUNT_WINDOW_MS,
    limit: EMAIL_CHANGE_MAILS_PER_ACCOUNT,
    clock,
  })
  // Keyed by a hash of the target address: all accounts that ask to move to it share this one.
  const emailChangeAddress = createStoreLimiter(store("ratelimit-email-change-address"), {
    windowMs: EMAIL_CHANGE_ADDRESS_WINDOW_MS,
    limit: EMAIL_CHANGE_MAILS_PER_ADDRESS,
    clock,
  })
  // An hour long, so a script cannot fill the database with empty accounts.
  const guest = createStoreLimiter(store("ratelimit-guest"), {
    windowMs: 60 * 60_000,
    limit: GUEST_STARTS_PER_HOUR,
    clock,
  })
  const normal = failOpenLimiter(
    createStoreLimiter(store("ratelimit-normal"), { windowMs, limit: settings.limit, clock }),
    { limit: settings.limit, onError: settings.onStoreError },
  )
  const userId = (_: Request, context: RateLimitContext<APIContext>) =>
    (context.get?.("auth") as AppAuthState | null | undefined)?.user.id?.toString()
  const noUser = () => undefined
  const byIp = userThenIp<APIContext>(noUser, { trustedProxy: "x-real-ip" })
  const byUser = userThenIp<APIContext>(userId, { trustedProxy: "x-real-ip" })
  return {
    strictByIp: createRateLimitMiddleware(strict, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byIp,
      keyPrefix: "auth-strict:",
    }),
    strictByUser: createRateLimitMiddleware(strict, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth-strict:",
    }),
    otpByUser: createRateLimitMiddleware(otp, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth-otp:",
      // A correct code gives its slot back: only wrong codes run the budget out.
      skipSuccessful: true,
      onRefundError: (error) => settings.onStoreError(error),
    }),
    normal: createRateLimitMiddleware(normal, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: byUser,
      keyPrefix: "auth:",
    }),
    resetByAddress: async (email) => await reset.check(`auth-reset:${await sha256Hex(email)}`),
    emailCodeByAddress: async (email) => await emailCode.check(await emailCodeBudgetKey(email)),
    signUpCode: async (c, email) => {
      const keys = await signUpCodeBudgetKeys(email, signUpClient(c))
      const own = await signUpByClient.check(keys.client)
      if (!own.allowed) return own
      return await signUpByAddress.check(keys.address)
    },
    signInLink: async (c, email) => {
      const keys = await signInLinkBudgetKeys(email, signUpClient(c))
      const own = await linkByClient.check(keys.client)
      if (!own.allowed) return own
      return await linkByAddress.check(keys.address)
    },
    guestStart: async (c) => await guest.check(`auth-guest:${signUpClient(c)}`),
    emailChangeByUser: async (userId) => await emailChange.check(`auth-email-change:${userId}`),
    emailChangeByAddress: async (email) =>
      await emailChangeAddress.check(`auth-email-change-address:${await sha256Hex(email)}`),
  }
}
