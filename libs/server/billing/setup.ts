import type { EnvReader } from "@spy4x/server/config"
import { parseBoundedInteger } from "@spy4x/platform/universal/bounded-integer"
import {
  type BillingProvider,
  createStripeBilling,
  type PlanRef,
  type Refund,
  RefundStatus,
  type Subscription,
  SubscriptionStatus,
} from "@spy4x/billing"
import { DEFAULT_GRACE_DAYS, PRO_PLAN_ID } from "@domain/billing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import type { FakePayments } from "./fake-payments.ts"

/**
 * The webhook signing secret of the development provider. It is public on purpose: the e2e tests
 * and a developer sign recorded Stripe events with it (`e2e/fixtures/billing.ts` keeps a copy, and
 * a test checks the two match). Production refuses the development provider, so it never verifies
 * a real webhook.
 */
export const FAKE_WEBHOOK_SECRET = "whsec_template_development_only"

/** The price the development provider maps to the Pro plan when `STRIPE_PRICE_PRO` is unset. */
export const FAKE_PRO_PRICE_ID = "price_fake_pro"

/** Which provider takes payments. */
export enum BillingMode {
  /** No payments: every group is on the free plan and the billing routes answer 404. */
  Off = 1,
  /** Stripe, with the keys from the environment. */
  Stripe = 2,
  /** Development only: checkout and portal return straight to the app, webhooks are signed locally. */
  Fake = 3,
}

export interface BillingSetup {
  mode: BillingMode
  /** `null` when billing is off. Every optional call is there: the operator area uses them. */
  provider: Required<BillingProvider> | null
  /**
   * The provider's dashboard, where an operator checks a customer: Stripe's test-mode dashboard for
   * a test key, its live one otherwise. `null` when billing is off or the development provider runs,
   * since neither has a dashboard to open.
   */
  dashboardUrl: string | null
  /** Days a past-due group keeps its plan while the provider retries the charge. */
  graceDays: number
  /** Whether starting a trial asks for a card (`BILLING_TRIAL_REQUIRES_CARD`, default true). */
  trialRequiresCard: boolean
}

/** What a process asks of {@link readBillingSetup}. */
export interface BillingSetupOptions {
  /**
   * Whether this process verifies the provider's webhooks. The API does, so Stripe also needs
   * `STRIPE_WEBHOOK_SECRET`. The worker does not, so that variable is neither required nor read.
   */
  webhooks: boolean
  /** Replaces the network for Stripe's API calls; tests pass one, the apps never do. */
  fetch?: typeof fetch
  /**
   * Where the development provider reads a subscription's last payment (`postgresFakePayments`).
   * Without it, every subscription's last payment is one Pro seat paid now.
   */
  fakePayments?: FakePayments
}

/** Thrown at start-up when billing is asked for but cannot run. Names variables, never values. */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BillingConfigError"
  }
}

/** The Stripe variables every process with billing needs. */
const STRIPE_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO"] as const

/** The longest grace period `BILLING_GRACE_DAYS` accepts. */
export const MAX_GRACE_DAYS = 90

/**
 * Reads `BILLING_PROVIDER` (`stripe`, `fake` or `off`) and builds the provider,
 * `BILLING_GRACE_DAYS`, a whole number of days from 0 to {@link MAX_GRACE_DAYS} (unset:
 * {@link DEFAULT_GRACE_DAYS}), and `BILLING_TRIAL_REQUIRES_CARD`, `true` or `false` (unset: true).
 *
 * - Unset, it is `fake` in development and `off` in production, so a deployment with no billing
 *   keys starts and keeps every group on the free plan.
 * - `stripe` needs `STRIPE_SECRET_KEY` and `STRIPE_PRICE_PRO`, and `STRIPE_WEBHOOK_SECRET` too when
 *   `options.webhooks` is true; a missing one stops start-up with an error naming it.
 * - `fake` is refused in production.
 */
export function readBillingSetup(
  env: EnvReader,
  appEnv: "dev" | "prod",
  options: BillingSetupOptions,
): BillingSetup {
  const graceDays = readGraceDays(env.get("BILLING_GRACE_DAYS"))
  const trialRequiresCard = readTrialRequiresCard(env.get("BILLING_TRIAL_REQUIRES_CARD"))
  const chosen = env.get("BILLING_PROVIDER") ?? (appEnv === "dev" ? "fake" : "off")
  switch (chosen) {
    case "off":
      return {
        mode: BillingMode.Off,
        provider: null,
        dashboardUrl: null,
        graceDays,
        trialRequiresCard,
      }
    case "fake":
      if (appEnv !== "dev") {
        throw new BillingConfigError(
          "BILLING_PROVIDER=fake is for development only; use stripe or off in production",
        )
      }
      return {
        mode: BillingMode.Fake,
        provider: createFakeBilling(
          env.get("STRIPE_PRICE_PRO") ?? FAKE_PRO_PRICE_ID,
          options.fakePayments,
        ),
        dashboardUrl: null,
        graceDays,
        trialRequiresCard,
      }
    case "stripe": {
      const required = options.webhooks
        ? ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO"]
        : STRIPE_KEYS
      const missing = required.filter((name) => env.get(name) === undefined)
      if (missing.length > 0) {
        throw new BillingConfigError(
          `BILLING_PROVIDER=stripe needs ${missing.join(", ")} (see docs/billing.md)`,
        )
      }
      return {
        mode: BillingMode.Stripe,
        provider: createStripeBilling({
          secretKey: env.get("STRIPE_SECRET_KEY")!,
          // The adapter requires a signing secret. A process that verifies no webhook gets a random
          // one, so its provider can never accept a delivery.
          webhookSecret: options.webhooks
            ? env.get("STRIPE_WEBHOOK_SECRET")!
            : `whsec_unused_${crypto.randomUUID()}`,
          plans: planRefs(env.get("STRIPE_PRICE_PRO")!),
          fetch: options.fetch,
        }),
        dashboardUrl: stripeDashboardUrl(env.get("STRIPE_SECRET_KEY")!),
        graceDays,
        trialRequiresCard,
      }
    }
    default:
      throw new BillingConfigError("BILLING_PROVIDER must be stripe, fake or off")
  }
}

/**
 * Stripe's dashboard for a secret key: a test key (`sk_test_…`, or a restricted `rk_test_…`) only
 * sees test-mode customers, which live under `/test`.
 */
export function stripeDashboardUrl(secretKey: string): string {
  return /^(sk|rk)_test_/.test(secretKey)
    ? "https://dashboard.stripe.com/test"
    : "https://dashboard.stripe.com"
}

function readTrialRequiresCard(value: string | undefined): boolean {
  if (value === undefined || value === "true") return true
  if (value === "false") return false
  throw new BillingConfigError("BILLING_TRIAL_REQUIRES_CARD must be true or false")
}

function readGraceDays(value: string | undefined): number {
  const days = parseBoundedInteger(value, {
    fallback: DEFAULT_GRACE_DAYS,
    min: 0,
    max: MAX_GRACE_DAYS,
  })
  if (days === null) {
    throw new BillingConfigError(
      `BILLING_GRACE_DAYS must be a whole number of days from 0 to ${MAX_GRACE_DAYS}`,
    )
  }
  return days
}

function planRefs(proPriceId: string): PlanRef[] {
  return [{ planId: PRO_PLAN_ID, priceId: proPriceId }]
}

/**
 * The development provider. Checkout and the portal send the person straight back to the app, as if
 * they had paid or closed the portal; the plan changes only when a signed webhook says so, exactly
 * as with Stripe. Webhooks are verified and parsed by the real Stripe adapter with
 * {@link FAKE_WEBHOOK_SECRET}, and its network is a `fetch` that refuses every call.
 *
 * The operator calls answer as Stripe would, without a webhook following: a subscription's last
 * payment comes from `payments` (one Pro seat paid now without it), refundable once per provider,
 * and the subscription changes are only answered. A retried refund with the same idempotency key
 * answers the same refund.
 */
export function createFakeBilling(
  proPriceId: string,
  payments?: FakePayments,
): Required<BillingProvider> {
  const stripe = createStripeBilling({
    secretKey: "sk_test_fake",
    webhookSecret: FAKE_WEBHOOK_SECRET,
    plans: planRefs(proPriceId),
    fetch: () => Promise.reject(new Error("The development billing provider makes no requests")),
  })
  const known = new Set([PRO_PLAN_ID])
  const refunds = new Map<string, Refund>()
  const refunded = new Set<string>()
  const amounts = new Map<string, number>()
  const paymentIdOf = (subscriptionId: string) => `pi_fake_${subscriptionId}`
  const answered = (
    subscriptionId: string,
    change: Partial<Subscription>,
  ): Promise<{ ok: true; value: Subscription }> =>
    Promise.resolve({
      ok: true,
      value: {
        id: subscriptionId,
        customerId: "cus_fake",
        status: SubscriptionStatus.Active,
        planId: PRO_PLAN_ID,
        priceId: proPriceId,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        quantity: 1,
        reference: null,
        ...change,
      },
    })
  return {
    createCheckout(request) {
      if (!known.has(request.planId)) {
        return Promise.resolve({
          ok: false,
          error: { code: "unknown_plan", message: "unknown plan", status: null },
        })
      }
      return Promise.resolve({
        ok: true,
        value: { id: `cs_fake_${uuidV7()}`, url: request.successUrl },
      })
    },
    // Nothing is billed in development, so the change is only answered: the subscription as it
    // would stand, on the Pro plan.
    updateQuantity(request) {
      return Promise.resolve({
        ok: true,
        value: {
          id: request.subscriptionId,
          customerId: "cus_fake",
          status: SubscriptionStatus.Active,
          planId: PRO_PLAN_ID,
          priceId: proPriceId,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          trialEnd: null,
          quantity: request.quantity,
          reference: null,
        },
      })
    },
    createPortalSession(request) {
      return Promise.resolve({
        ok: true,
        value: { id: `bps_fake_${uuidV7()}`, url: request.returnUrl },
      })
    },
    async readLastPayment(request) {
      const id = paymentIdOf(request.subscriptionId)
      const payment = payments
        ? await payments(request.subscriptionId)
        : { amount: 900, paidAt: new Date(), refunded: false }
      if (payment === null) return { ok: true, value: null }
      amounts.set(id, payment.amount)
      const done = payment.refunded || refunded.has(id)
      return {
        ok: true,
        value: {
          id,
          invoiceId: `in_fake_${request.subscriptionId}`,
          amount: payment.amount,
          currency: "EUR",
          decimals: 2,
          paidAt: payment.paidAt,
          amountRefunded: done ? payment.amount : 0,
          refunded: done,
        },
      }
    },
    refundPayment(request) {
      const again = refunds.get(request.idempotencyKey)
      if (again) return Promise.resolve({ ok: true, value: again })
      if (!request.paymentId.startsWith("pi_fake_") || refunded.has(request.paymentId)) {
        return Promise.resolve({
          ok: false,
          error: {
            code: "provider_error",
            message: "Stripe answered 400: this payment cannot be refunded",
            status: 400,
          },
        })
      }
      const refund: Refund = {
        id: `re_fake_${uuidV7()}`,
        paymentId: request.paymentId,
        amount: amounts.get(request.paymentId) ?? 900,
        currency: "EUR",
        decimals: 2,
        status: RefundStatus.Succeeded,
      }
      refunded.add(request.paymentId)
      refunds.set(request.idempotencyKey, refund)
      return Promise.resolve({ ok: true, value: refund })
    },
    setTrialEnd: (request) =>
      answered(request.subscriptionId, {
        status: SubscriptionStatus.Trialing,
        trialEnd: request.trialEnd,
        currentPeriodEnd: request.trialEnd,
      }),
    cancelNow: (request) =>
      answered(request.subscriptionId, { status: SubscriptionStatus.Canceled }),
    setCancelAtPeriodEnd: (request) =>
      answered(request.subscriptionId, { cancelAtPeriodEnd: request.cancelAtPeriodEnd }),
    parseEvent: (rawBody, headers) => stripe.parseEvent(rawBody, headers),
  }
}
