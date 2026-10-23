import type { MiddlewareHandler } from "hono"
import {
  GUEST_REFUSAL_CODE,
  GUEST_REFUSAL_MESSAGE,
  type GuestLimitedAction,
  type GuestRefusal,
} from "@domain/identity"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"

/** The body of a guest refusal for `action`: 403, with a reason the screens recognise. */
export function guestRefusal(action: GuestLimitedAction): GuestRefusal {
  return {
    error: {
      code: `forbidden`,
      message: GUEST_REFUSAL_MESSAGE,
      reason: GUEST_REFUSAL_CODE,
      details: { action },
    },
  }
}

/**
 * Refuses `action` to a guest (#224) with 403 and {@link guestRefusal}: inviting, push, API
 * tokens, uploads and checkout need a sign-in method first. Anyone else, and a request with no
 * session, passes untouched; the route's own guard answers for those. `onRefused` runs after the
 * refusal is decided, for the reminder an invite attempt sends; its failure never changes the
 * answer.
 */
export function refuseGuests(
  action: GuestLimitedAction,
  onRefused?: (userId: number) => Promise<void>,
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const user = c.get("auth")?.user
    if (!user?.guestSince) return await next()
    await onRefused?.(user.id).catch(() => {})
    const { error } = guestRefusal(action)
    return errorResponse(c, error.code, error)
  }
}

/**
 * The paths each limited action is reached by, as the API's app mounts them (`index.ts`). Only
 * `POST`: reading what exists stays open.
 */
export const GUEST_LIMITED_PATHS: Record<GuestLimitedAction, readonly string[]> = {
  invite: ["/groups/:groupId/invitations"],
  push: ["/push"],
  "api-token": ["/tokens"],
  upload: ["/groups/import", "/groups/import/check"],
  billing: ["/groups/:groupId/billing/checkout"],
  telegram: ["/telegram/code"],
}
