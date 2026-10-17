import type { MiddlewareHandler } from "hono"
import {
  type Clock,
  createStoreLimiter,
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
import type { APIContext } from "../../_types.ts"
import type { AppAuthState } from "../../services/sign-in.ts"

/** Invitations one person may create per {@link INVITATION_WINDOW_MS}, across all their groups. */
export const INVITATIONS_PER_USER = 20

/** Invitation mails one address may be sent per {@link INVITATION_WINDOW_MS}, from anyone. */
export const INVITATION_MAILS_PER_ADDRESS = 3

/** The window of the invitation limits: one hour. */
export const INVITATION_WINDOW_MS = 60 * 60_000

/** The rate limits the invitation routes mount. A middleware answers 429 with `Retry-After`. */
export interface InvitationRateLimits {
  /** {@link INVITATIONS_PER_USER} creates per signed-in person. */
  createByUser: MiddlewareHandler<APIContext>
  /**
   * Opening, accepting and declining an invitation, per client IP: the strict auth budget's size
   * and window, in a budget of its own. A token is 256 random bits, so this stops a flood, not a
   * guess.
   */
  answerByIp: MiddlewareHandler<APIContext>
  /** Spends one of the address's {@link INVITATION_MAILS_PER_ADDRESS} mails; see `InvitationMail`. */
  mailByAddress(email: string): Promise<RateLimitDecision>
}

/** The strict auth limit's window and size, from `config.rateLimiter`, and the stores. */
export interface InvitationRateLimitSettings {
  windowMs: number
  strictLimit: number
  /** Builds the store of one limiter; `name` is its key prefix. See `AuthRateLimitSettings.store`. */
  store: (name: string) => RateLimitStore
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Builds the invitation limits. Every one refuses the request when its store fails (Hono answers
 * 500), like the strict auth limits: they stand between an attacker and someone else's inbox or a
 * flood of rows. The mail budget is keyed by a hash of the address, so the store never holds one.
 * The client IP comes from `X-Real-IP`, which only a trusted proxy may send, as
 * `createAuthRateLimits` explains.
 */
export function createInvitationRateLimits(
  settings: InvitationRateLimitSettings,
): InvitationRateLimits {
  const { clock, store } = settings
  const create = createStoreLimiter(store("ratelimit-invitation-create"), {
    windowMs: INVITATION_WINDOW_MS,
    limit: INVITATIONS_PER_USER,
    clock,
  })
  const answer = createStoreLimiter(store("ratelimit-invitation-answer"), {
    windowMs: settings.windowMs,
    limit: settings.strictLimit,
    clock,
  })
  const mail = createStoreLimiter(store("ratelimit-invitation-mail"), {
    windowMs: INVITATION_WINDOW_MS,
    limit: INVITATION_MAILS_PER_ADDRESS,
    clock,
  })
  const userId = (_: Request, context: RateLimitContext<APIContext>) =>
    (context.get?.("auth") as AppAuthState | null | undefined)?.user.id?.toString()
  return {
    createByUser: createRateLimitMiddleware(create, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: userThenIp<APIContext>(userId, { trustedProxy: "x-real-ip" }),
      keyPrefix: "invitation-create:",
    }),
    answerByIp: createRateLimitMiddleware(answer, {
      remoteAddr: denoServeRemoteAddr,
      keyResolver: userThenIp<APIContext>(() => undefined, { trustedProxy: "x-real-ip" }),
      keyPrefix: "invitation-answer:",
    }),
    mailByAddress: async (email) => await mail.check(`invitation-mail:${await sha256Hex(email)}`),
  }
}
