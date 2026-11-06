import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader, type EnvReader } from "@spy4x/server/config"
import { BillingPeriod } from "@spy4x/billing"
import { DEFAULT_GRACE_DAYS, type Plan, PRO_PLAN_ID } from "@domain/billing"
import { TEST_PAID_PLANS } from "../../domain/billing/test-plans.ts"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  DEV_PRO_PRICE_ID,
  DEV_PRO_YEARLY_PRICE_ID,
  DEV_WEBHOOK_SECRET,
} from "../../../e2e/fixtures/billing.ts"
import {
  BillingConfigError,
  BillingMode,
  createFakeBilling,
  FAKE_PRO_PRICE_ID,
  FAKE_PRO_YEARLY_PRICE_ID,
  FAKE_WEBHOOK_SECRET,
  readBillingSetup,
  stripeDashboardUrl,
} from "./setup.ts"

const STRIPE_KEYS = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_PRO: "price_placeholder",
}

/** The API's options: it verifies Stripe's webhooks. Pro is sold monthly only, on the test catalog. */
const API = { webhooks: true, plans: TEST_PAID_PLANS }
/** The worker's options: it changes subscriptions and verifies no webhook. */
const WORKER = { webhooks: false, plans: TEST_PAID_PLANS }

describe("billing configuration", () => {
  it("starts with billing off in production when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "prod", API)

    expect(setup).toEqual({
      mode: BillingMode.Off,
      provider: null,
      dashboardUrl: null,
      graceDays: DEFAULT_GRACE_DAYS,
      trialRequiresCard: true,
    })
  })

  it("starts with the development provider in development when no billing variable is set", () => {
    const setup = readBillingSetup(createEnvReader({}), "dev", API)

    expect(setup.mode).toBe(BillingMode.Fake)
    expect(setup.provider).not.toBeNull()
  })

  it("stops a process that verifies webhooks when Stripe lacks a key, the webhook secret included", () => {
    const env = createEnvReader({
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test_x",
    })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(
      new BillingConfigError(
        "BILLING_PROVIDER=stripe needs STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO (see docs/billing.md)",
      ),
    )
  })

  it("runs Stripe when it has every key", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })

    const setup = readBillingSetup(env, "prod", API)

    expect(setup.mode).toBe(BillingMode.Stripe)
    expect(setup.provider).not.toBeNull()
  })

  describe("a Pro sold yearly", () => {
    const yearly = TEST_PAID_PLANS.map((plan) => ({ ...plan, yearlyAmount: plan.amount * 10 }))

    it("stops start-up while Stripe lacks the yearly price", () => {
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })

      expect(() => readBillingSetup(env, "prod", { ...API, plans: yearly })).toThrow(
        new BillingConfigError(
          "BILLING_PROVIDER=stripe needs STRIPE_PRICE_PRO_YEARLY (see docs/billing.md)",
        ),
      )
    })

    it("runs Stripe once the yearly price is set", () => {
      const env = createEnvReader({
        BILLING_PROVIDER: "stripe",
        ...STRIPE_KEYS,
        STRIPE_PRICE_PRO_YEARLY: "price_yearly_placeholder",
      })

      expect(readBillingSetup(env, "prod", { ...API, plans: yearly }).mode)
        .toBe(BillingMode.Stripe)
    })
  })

  it("stops start-up on a yearly price for a Pro sold monthly only, since it could never sell", () => {
    const env = createEnvReader({
      BILLING_PROVIDER: "stripe",
      ...STRIPE_KEYS,
      STRIPE_PRICE_PRO_YEARLY: "price_yearly_placeholder",
    })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(
      new BillingConfigError(
        "STRIPE_PRICE_PRO_YEARLY is set, but Pro has no yearly price (see docs/billing.md)",
      ),
    )
  })

  it("refuses the development provider in production", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "fake" })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(BillingConfigError)
  })

  it("refuses an unknown provider name", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "paypal" })

    expect(() => readBillingSetup(env, "prod", API)).toThrow(BillingConfigError)
  })

  it("keeps billing off when asked to, even with Stripe's keys present", () => {
    const env = createEnvReader({ BILLING_PROVIDER: "off", ...STRIPE_KEYS })

    expect(readBillingSetup(env, "prod", API)).toMatchObject({
      mode: BillingMode.Off,
      provider: null,
    })
  })

  it("reads the grace period for failed payments in whole days, seven when unset or blank", () => {
    const days = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_GRACE_DAYS: value }),
        "dev",
        API,
      )
        .graceDays

    expect(days()).toBe(7)
    expect(days("")).toBe(7)
    expect(days("0")).toBe(0)
    expect(days("14")).toBe(14)
    expect(days("90")).toBe(90)
  })

  it("stops start-up on a grace period that is not a whole number of days from 0 to 90", () => {
    for (const value of ["-1", "1.5", "7d", "91", "1e1", " 7"]) {
      const env = createEnvReader({ BILLING_GRACE_DAYS: value })

      expect(() => readBillingSetup(env, "prod", API)).toThrow(
        new BillingConfigError("BILLING_GRACE_DAYS must be a whole number of days from 0 to 90"),
      )
    }
  })

  it("reads whether a trial asks for a card, yes when unset or blank", () => {
    const requiresCard = (value?: string) =>
      readBillingSetup(
        createEnvReader(value === undefined ? {} : { BILLING_TRIAL_REQUIRES_CARD: value }),
        "dev",
        API,
      ).trialRequiresCard

    expect([requiresCard(), requiresCard(""), requiresCard("true"), requiresCard("false")])
      .toEqual([true, true, true, false])
  })

  it("stops start-up on a trial card setting that is not true or false", () => {
    for (const value of ["yes", "0", "FALSE", " false"]) {
      const env = createEnvReader({ BILLING_TRIAL_REQUIRES_CARD: value })

      expect(() => readBillingSetup(env, "prod", API)).toThrow(
        new BillingConfigError("BILLING_TRIAL_REQUIRES_CARD must be true or false"),
      )
    }
  })

  it("shares its webhook secret and Pro prices with the e2e fixture that signs events", () => {
    expect([FAKE_WEBHOOK_SECRET, FAKE_PRO_PRICE_ID, FAKE_PRO_YEARLY_PRICE_ID])
      .toEqual([DEV_WEBHOOK_SECRET, DEV_PRO_PRICE_ID, DEV_PRO_YEARLY_PRICE_ID])
  })

  describe("the Stripe price a checkout bills", () => {
    const YEARLY_PLANS = TEST_PAID_PLANS.map((plan) => ({
      ...plan,
      yearlyAmount: plan.amount * 10,
    }))

    /** Opens a Pro checkout for `period` and answers the price Stripe was asked to bill, if any. */
    async function billedPrice(
      plans: readonly Plan[],
      period: BillingPeriod,
      extra: Record<string, string> = {},
    ): Promise<{ ok: boolean; price: string | null }> {
      let price: string | null = null
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS, ...extra })
      const setup = readBillingSetup(env, "prod", {
        ...API,
        plans,
        fetch: async (_input, init) => {
          price = new URLSearchParams(String(init?.body)).get("line_items[0][price]")
          return Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" })
        },
      })
      const result = await setup.provider!.createCheckout({
        planId: PRO_PLAN_ID,
        period,
        successUrl: "https://app.example.com/done",
        cancelUrl: "https://app.example.com/back",
      })
      return { ok: result.ok, price }
    }

    it("bills the monthly price for a Pro sold monthly only, and has no yearly one to bill", async () => {
      expect(await billedPrice(TEST_PAID_PLANS, BillingPeriod.Monthly))
        .toEqual({ ok: true, price: "price_placeholder" })
      expect(await billedPrice(TEST_PAID_PLANS, BillingPeriod.Yearly)).toEqual({
        ok: false,
        price: null,
      })
    })

    it("bills the yearly price for a yearly checkout once Pro is sold yearly", async () => {
      const extra = { STRIPE_PRICE_PRO_YEARLY: "price_yearly_placeholder" }

      expect(await billedPrice(YEARLY_PLANS, BillingPeriod.Yearly, extra))
        .toEqual({ ok: true, price: "price_yearly_placeholder" })
      expect(await billedPrice(YEARLY_PLANS, BillingPeriod.Monthly, extra))
        .toEqual({ ok: true, price: "price_placeholder" })
    })
  })

  it("answers a seat change in development with the asked quantity on the Pro plan", async () => {
    const result = await createFakeBilling("price_dev").updateQuantity({
      subscriptionId: "sub_dev",
      quantity: 4,
      idempotencyKey: "seats:1:4",
    })

    expect(result).toMatchObject({
      ok: true,
      value: { id: "sub_dev", quantity: 4, planId: "pro", priceId: "price_dev" },
    })
  })

  it("links a test key to Stripe's test dashboard and a live key to the live one", () => {
    expect(stripeDashboardUrl("sk_test_x")).toBe("https://dashboard.stripe.com/test")
    expect(stripeDashboardUrl("rk_test_x")).toBe("https://dashboard.stripe.com/test")
    expect(stripeDashboardUrl("sk_live_x")).toBe("https://dashboard.stripe.com")
    const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })
    expect(readBillingSetup(env, "prod", API).dashboardUrl).toBe(
      "https://dashboard.stripe.com/test",
    )
    expect(readBillingSetup(createEnvReader({}), "dev", API).dashboardUrl).toBeNull()
  })

  it("gives each development checkout, portal session and refund a version 7 id", async () => {
    const billing = createFakeBilling("price_dev")
    const url = "http://app.localhost/groups/g/billing"
    const checkout = await billing.createCheckout({
      planId: PRO_PLAN_ID,
      successUrl: url,
      cancelUrl: url,
      reference: "g",
    })
    const portal = await billing.createPortalSession({ customerId: "cus_fake", returnUrl: url })
    const payment = await billing.readLastPayment({ subscriptionId: "sub_dev" })
    if (!checkout.ok || !portal.ok || !payment.ok || payment.value === null) {
      throw new Error("expected a checkout, a portal session and a payment")
    }
    const refund = await billing.refundPayment({ paymentId: payment.value.id, idempotencyKey: "k" })
    if (!refund.ok) throw new Error("expected a refund")

    const ids = [
      ["cs_fake_", checkout.value.id],
      ["bps_fake_", portal.value.id],
      ["re_fake_", refund.value.id],
    ]
    for (const [prefix, id] of ids) {
      expect(id.startsWith(prefix)).toBe(true)
      expect(isUuid(id.slice(prefix.length), 7)).toBe(true)
    }
  })

  it("refunds the development payment once, and answers a retry with the same refund", async () => {
    const billing = createFakeBilling("price_dev")
    const read = await billing.readLastPayment({ subscriptionId: "sub_dev" })
    if (!read.ok || read.value === null) throw new Error("expected a payment")
    expect(read.value.refunded).toBe(false)

    const key = "refund-key-1"
    const first = await billing.refundPayment({ paymentId: read.value.id, idempotencyKey: key })
    const retry = await billing.refundPayment({ paymentId: read.value.id, idempotencyKey: key })
    const other = await billing.refundPayment({ paymentId: read.value.id, idempotencyKey: "k2" })

    expect(first.ok).toBe(true)
    expect(retry).toEqual(first)
    expect(other).toMatchObject({ ok: false, error: { code: "provider_error" } })
    expect(await billing.readLastPayment({ subscriptionId: "sub_dev" })).toMatchObject({
      ok: true,
      value: { refunded: true, amountRefunded: 900 },
    })
  })

  it("answers the development payment from its payments port, refunds included", async () => {
    const paidAt = new Date("2026-09-20T08:00:00Z")
    const facts = new Map([
      ["sub_paying", { amount: 5400, paidAt, refunded: false }],
      ["sub_refunded", { amount: 8100, paidAt, refunded: true }],
    ])
    const billing = createFakeBilling("price_dev", (id) => Promise.resolve(facts.get(id) ?? null))

    // A trial has paid nothing yet.
    expect(await billing.readLastPayment({ subscriptionId: "sub_trial" })).toEqual({
      ok: true,
      value: null,
    })
    const paying = await billing.readLastPayment({ subscriptionId: "sub_paying" })
    expect(paying).toMatchObject({
      ok: true,
      value: { amount: 5400, paidAt, refunded: false, amountRefunded: 0 },
    })
    expect(await billing.readLastPayment({ subscriptionId: "sub_refunded" })).toMatchObject({
      ok: true,
      value: { amount: 8100, refunded: true, amountRefunded: 8100 },
    })
    // A refund gives back what was paid, not one seat.
    if (!paying.ok || paying.value === null) throw new Error("expected a payment")
    const refund = await billing.refundPayment({ paymentId: paying.value.id, idempotencyKey: "k" })
    expect(refund).toMatchObject({ ok: true, value: { amount: 5400 } })
  })

  describe("a process that verifies no webhook, as the worker", () => {
    it("runs Stripe on the secret key and the Pro price alone", () => {
      const env = createEnvReader({
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_PRICE_PRO: "price_placeholder",
      })

      const setup = readBillingSetup(env, "prod", WORKER)

      expect(setup.mode).toBe(BillingMode.Stripe)
      expect(setup.provider).not.toBeNull()
    })

    it("stops start-up when Stripe lacks the secret key or the Pro price, naming each", () => {
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", STRIPE_WEBHOOK_SECRET: "whsec_x" })

      expect(() => readBillingSetup(env, "prod", WORKER)).toThrow(
        new BillingConfigError(
          "BILLING_PROVIDER=stripe needs STRIPE_SECRET_KEY, STRIPE_PRICE_PRO (see docs/billing.md)",
        ),
      )
    })

    it("never reads the webhook secret, even when it is set", () => {
      const env = createEnvReader({ BILLING_PROVIDER: "stripe", ...STRIPE_KEYS })
      const read: string[] = []
      const recording: EnvReader = {
        ...env,
        get: (name: string) => {
          read.push(name)
          return env.get(name)
        },
      }

      readBillingSetup(recording, "prod", WORKER)

      expect(read).toContain("STRIPE_SECRET_KEY")
      expect(read).not.toContain("STRIPE_WEBHOOK_SECRET")
    })
  })
})
