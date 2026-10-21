import type { MiddlewareHandler } from "hono"
import { type Clock, createStoreLimiter, type RateLimitStore } from "@spy4x/platform/rate-limit"
import {
  createRateLimitMiddleware,
  denoServeRemoteAddr,
  type RateLimitContext,
  userThenIp,
} from "@spy4x/platform/rate-limit/hono"
import type { APIContext } from "../../_types.ts"
import type { AppAuthState } from "../../services/sign-in.ts"

/** Imports one person may run per {@link GROUP_IMPORT_WINDOW_MS}: each writes a whole group. */
export const GROUP_IMPORTS_PER_USER = 10

/**
 * File checks one person may run per {@link GROUP_IMPORT_WINDOW_MS}. A check reads a file of up to
 * 5 MiB and writes nothing, so a person who picks the wrong file a few times is never stopped.
 */
export const GROUP_IMPORT_CHECKS_PER_USER = 60

/**
 * Exports one person may start per {@link GROUP_IMPORT_WINDOW_MS}. Each reads a whole group and
 * keeps a request open while the file downloads; an owner backing up a few groups a day is never
 * stopped.
 */
export const GROUP_EXPORTS_PER_USER = 30

/** The window of the export and import limits: one hour. */
export const GROUP_IMPORT_WINDOW_MS = 60 * 60_000

/** The limits the export and import routes mount. Each answers 429 with `Retry-After`. */
export interface GroupFileRateLimits {
  exportByUser: MiddlewareHandler<APIContext>
  checkByUser: MiddlewareHandler<APIContext>
  importByUser: MiddlewareHandler<APIContext>
}

/** The stores of the limits, as `InvitationRateLimitSettings` takes them. */
export interface GroupFileRateLimitSettings {
  /** Builds the store of one limiter; `name` is its key prefix. */
  store: (name: string) => RateLimitStore
  /** Injected by tests. */
  clock?: Clock
}

/**
 * Builds the export and import limits, per signed-in person. They refuse the request when their store fails
 * (Hono answers 500), like the invitation limits: they stand between one account and a flood of
 * written rows. The client IP, for a request with no session, comes from `X-Real-IP`, which only
 * a trusted proxy may send.
 */
export function createGroupFileRateLimits(
  settings: GroupFileRateLimitSettings,
): GroupFileRateLimits {
  const { clock, store } = settings
  const userId = (_: Request, context: RateLimitContext<APIContext>) =>
    (context.get?.("auth") as AppAuthState | null | undefined)?.user.id?.toString()
  const limit = (name: string, count: number) =>
    createRateLimitMiddleware(
      createStoreLimiter(store(`ratelimit-${name}`), {
        windowMs: GROUP_IMPORT_WINDOW_MS,
        limit: count,
        clock,
      }),
      {
        remoteAddr: denoServeRemoteAddr,
        keyResolver: userThenIp<APIContext>(userId, { trustedProxy: "x-real-ip" }),
        keyPrefix: `${name}:`,
      },
    )
  return {
    exportByUser: limit("group-export", GROUP_EXPORTS_PER_USER),
    checkByUser: limit("group-import-check", GROUP_IMPORT_CHECKS_PER_USER),
    importByUser: limit("group-import", GROUP_IMPORTS_PER_USER),
  }
}
