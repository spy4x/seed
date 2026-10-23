import { Hono } from "hono"
import type { BillingEvent, BillingProvider } from "@spy4x/billing"
import { readBoundedBody } from "@spy4x/net/bounded-body"
import type { BillingApplyOutcome } from "@domain/billing"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"

/** The largest webhook body read. Stripe's events are a few KiB; this leaves room and no more. */
export const MAX_WEBHOOK_BODY_BYTES = 512 * 1024

export interface BillingWebhookDependencies {
  /** `null` when billing is off: the route answers 404 and reads nothing. */
  provider: BillingProvider | null
  /** Stores the event id and applies the event in one transaction. */
  applyEvent(event: BillingEvent): Promise<BillingApplyOutcome>
  log: (message: string, detail?: unknown) => void
}

/**
 * The provider's webhook, mounted at `/api/webhooks/billing`. It takes no session: the signature is
 * the only proof, and it is checked before the body is parsed.
 *
 * - A bad or missing signature, or one outside the time window: 400, nothing applied.
 * - A verified event this app does not handle, or a body it cannot read: 200, so the provider stops
 *   sending it.
 * - A verified event: applied once (a repeat changes nothing), then 200.
 * - A failure while applying: 500, so the provider retries; nothing of it was kept.
 */
export function createBillingWebhookRoute(
  dependencies: BillingWebhookDependencies,
): Hono<APIContext> {
  return new Hono<APIContext>().post("/", async (c) => {
    const provider = dependencies.provider
    if (!provider) return errorResponse(c, `not_found`, { message: "Billing is off" })
    let body: Uint8Array
    try {
      body = await readBoundedBody(c.req.raw, { maxBytes: MAX_WEBHOOK_BODY_BYTES })
    } catch {
      return errorResponse(c, `bad_request`, { message: "Body unreadable or too large" })
    }
    const parsed = await provider.parseEvent(body, c.req.raw.headers)
    if (!parsed.ok) {
      if (parsed.reason === "malformed_payload") {
        dependencies.log("warn: billing webhook with an unreadable payload", parsed.message)
        return c.json({ received: true })
      }
      return errorResponse(c, `bad_request`, { message: "Signature rejected" })
    }
    if (parsed.event === null) return c.json({ received: true })
    try {
      const outcome = await dependencies.applyEvent(parsed.event)
      if (outcome === "ignored" && "subscription" in parsed.event) {
        dependencies.log("warn: billing event names no group", parsed.event.id)
      }
      return c.json({ received: true, outcome })
    } catch (error) {
      dependencies.log("error: billing event failed to apply", error)
      return errorResponse(c, `internal`, { message: "Not applied" })
    }
  })
}
