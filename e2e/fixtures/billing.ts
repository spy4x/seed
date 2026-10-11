import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
/**
 * Signed Stripe webhooks for the tests, made without the network. The event below is Stripe's
 * recorded `customer.subscription.created` (as in spy4x/ts-libs `billing/fixtures/stripe`), trimmed
 * to the fields the adapter reads; `subscriptionEvent` fills in the ids a test needs.
 *
 * This file is copied next to the e2e specs and imports nothing, so the signing is written out here.
 */

/**
 * The development provider's webhook secret, the same as `FAKE_WEBHOOK_SECRET` in
 * `libs/server/billing/setup.ts` (a unit test checks the two match). It is public: only the
 * development provider accepts it, and production refuses that provider.
 */
export const DEV_WEBHOOK_SECRET = "whsec_template_development_only"

/** The price the development provider maps to the Pro plan. */
export const DEV_PRO_PRICE_ID = "price_fake_pro"

/** The webhook path of the API. */
export const BILLING_WEBHOOK_PATH = "/api/webhooks/billing"

export interface SubscriptionEventInput {
  /** `customer.subscription.created`, `.updated` or `.deleted`. */
  type?: string
  eventId?: string
  /** The group the checkout was for: Stripe returns it as the subscription's metadata. */
  reference: string | null
  subscriptionId?: string
  customerId?: string
  priceId?: string
  status?: string
  /** The event's `created`, in seconds. */
  createdAt?: number
  currentPeriodEnd?: number
  cancelAtPeriodEnd?: boolean
}

/** A recorded subscription event with the given ids, as the JSON Stripe sends. */
export function subscriptionEvent(input: SubscriptionEventInput): string {
  const subscriptionId = input.subscriptionId ?? "sub_1MowQVLkdIwHu7ixeRlqHVzs"
  const priceId = input.priceId ?? DEV_PRO_PRICE_ID
  const created = input.createdAt ?? 1679609768
  return JSON.stringify({
    id: input.eventId ?? `evt_${uuidV7().replace(/-/g, "")}`,
    object: "event",
    api_version: "2026-09-30.endive",
    created,
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        created: 1679609767,
        currency: "eur",
        customer: input.customerId ?? "cus_Na6dX7aXxi11N4",
        items: {
          object: "list",
          data: [{
            id: "si_Na6dzxczY5fwHx",
            object: "subscription_item",
            created: 1679609768,
            current_period_end: input.currentPeriodEnd ?? 1682288167,
            current_period_start: 1679609767,
            price: {
              id: priceId,
              object: "price",
              currency: "eur",
              recurring: { interval: "month", interval_count: 1 },
              type: "recurring",
              unit_amount: 900,
            },
            quantity: 1,
            subscription: subscriptionId,
          }],
          has_more: false,
        },
        livemode: false,
        metadata: input.reference === null ? {} : { reference: input.reference },
        status: input.status ?? "active",
        trial_end: null,
      },
    },
    livemode: false,
    type: input.type ?? "customer.subscription.created",
  })
}

/**
 * The `Stripe-Signature` header for `body`: `t=<seconds>,v1=<hex HMAC-SHA256 of "t.body">`, the
 * scheme Stripe signs with.
 */
export async function stripeSignature(
  body: string,
  secret = DEV_WEBHOOK_SECRET,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${nowSeconds}.${body}`))
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `t=${nowSeconds},v1=${hex}`
}

/**
 * The request that puts `groupId` on the Pro plan: a signed `customer.subscription.created` with a
 * subscription and a customer of its own, so tests that upgrade side by side never share one. Post
 * it to {@link BILLING_WEBHOOK_PATH}.
 */
export async function proWebhook(
  groupId: string,
): Promise<{ headers: Record<string, string>; data: string }> {
  const id = uuidV7().replace(/-/g, "")
  const data = subscriptionEvent({
    reference: groupId,
    subscriptionId: `sub_${id}`,
    customerId: `cus_${id}`,
  })
  return {
    headers: {
      "content-type": "application/json",
      "stripe-signature": await stripeSignature(data),
    },
    data,
  }
}
