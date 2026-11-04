import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import {
  type BillingEvent,
  BillingEventType,
  BillingPeriod,
  SubscriptionStatus,
} from "@spy4x/billing"
import type { BillingApplyOutcome } from "@domain/billing"
import type { APIContext } from "../_types.ts"
import { createFakeBilling, FAKE_PRO_PRICE_ID } from "@server/billing/setup.ts"
import {
  DEV_PRO_YEARLY_PRICE_ID,
  stripeSignature,
  subscriptionEvent,
} from "../../../e2e/fixtures/billing.ts"
import { createBillingWebhookRoute } from "./billing-webhook.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"

function webhook(
  { enabled = true, apply }: {
    enabled?: boolean
    apply?: (event: BillingEvent) => Promise<BillingApplyOutcome>
  } = {},
) {
  const applied: BillingEvent[] = []
  const logged: string[] = []
  const app = new Hono<APIContext>()
  app.route(
    "/webhooks/billing",
    createBillingWebhookRoute({
      provider: enabled ? createFakeBilling(FAKE_PRO_PRICE_ID) : null,
      applyEvent: (event) => {
        applied.push(event)
        return apply ? apply(event) : Promise.resolve("applied")
      },
      log: (message) => logged.push(message),
    }),
  )
  const post = (body: string, signature: string | null) =>
    app.request("http://local/webhooks/billing", {
      method: "POST",
      headers: signature === null ? {} : { "stripe-signature": signature },
      body,
    })
  return { applied, logged, post }
}

describe("the billing webhook", () => {
  it("applies a signed subscription event for the group its checkout named", async () => {
    const { applied, post } = webhook()
    const body = subscriptionEvent({ eventId: "evt_1", reference: groupId })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(200)
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({
      id: "evt_1",
      type: BillingEventType.SubscriptionCreated,
      subscription: { reference: groupId, planId: "pro", status: SubscriptionStatus.Active },
    })
  })

  it("refuses an unsigned event, a forged one and a replay outside the window, and applies none", async () => {
    const { applied, post } = webhook()
    const body = subscriptionEvent({ reference: groupId })
    const forged = await stripeSignature(body, "whsec_someone_else")
    const old = await stripeSignature(body, undefined, Math.floor(Date.now() / 1000) - 3600)
    const tampered = await stripeSignature(body)

    const responses = [
      await post(body, null),
      await post(body, forged),
      await post(body, old),
      await post(body.replace("active", "canceled"), tampered),
    ]

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400])
    expect(applied).toEqual([])
  })

  it("answers a signed body it cannot read with 200, so the provider stops sending it", async () => {
    const { applied, post } = webhook()
    const body = JSON.stringify({ id: "evt_2", type: "customer.subscription.created" })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(200)
    expect(applied).toEqual([])
  })

  it("answers a signed event of a kind it does not handle with 200 and applies nothing", async () => {
    const { applied, post } = webhook()
    const body = subscriptionEvent({ reference: groupId, type: "customer.created" })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(200)
    expect(applied).toEqual([])
  })

  it("answers 500 when the event could not be applied, so the provider sends it again", async () => {
    const { post } = webhook({ apply: () => Promise.reject(new Error("database down")) })
    const body = subscriptionEvent({ reference: groupId })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(500)
  })

  it("reads the billing period from the price the event bills, never from anything else", async () => {
    const { applied, post } = webhook()
    const yearly = subscriptionEvent({ reference: groupId, priceId: DEV_PRO_YEARLY_PRICE_ID })
    const monthly = subscriptionEvent({ reference: groupId })

    await post(yearly, await stripeSignature(yearly))
    await post(monthly, await stripeSignature(monthly))

    expect(applied.map((event) => "subscription" in event && event.subscription))
      .toMatchObject([
        { planId: "pro", priceId: DEV_PRO_YEARLY_PRICE_ID, period: BillingPeriod.Yearly },
        { planId: "pro", period: BillingPeriod.Monthly },
      ])
  })

  it("logs an event for a price no plan maps to, with no plan or period, and answers 200", async () => {
    const { applied, logged, post } = webhook({ apply: () => Promise.resolve("unknown_price") })
    const body = subscriptionEvent({ reference: groupId, priceId: "price_nobody_sells" })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(200)
    expect("subscription" in applied[0] && applied[0].subscription).toMatchObject({
      planId: null,
      priceId: "price_nobody_sells",
    })
    expect("subscription" in applied[0] && applied[0].subscription).not.toHaveProperty("period")
    expect(logged).toEqual(["warn: billing event bills a price no plan maps to"])
  })

  it("answers 404 and reads nothing while billing is off", async () => {
    const { applied, post } = webhook({ enabled: false })
    const body = subscriptionEvent({ reference: groupId })

    const response = await post(body, await stripeSignature(body))

    expect(response.status).toBe(404)
    expect(applied).toEqual([])
  })
})
