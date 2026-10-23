import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { MiddlewareHandler } from "hono"
import type { BillingError, BillingProvider, PaidPayment, Subscription } from "@spy4x/billing"
import { RefundStatus, SubscriptionStatus } from "@spy4x/billing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  type AdminBillingCustomer,
  BILLING_AUDIT_EVENTS,
  BillingStatus,
  PRO_PLAN_ID,
} from "@domain/billing"
import { UserRole } from "@domain/identity"
import {
  type AdminBillingAuditRow,
  type AdminBillingClaim,
  AdminBillingClaimOutcome,
  type AdminBillingRecord,
} from "@server/billing/admin-billing.ts"
import { readSiteUrl, readSubscribersSetup } from "@server/subscribers/subscribers.ts"
import type { APIContext } from "../../_types.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  sameOriginWithoutCookieHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../../_testing/mutation-requests.ts"
import { createAdminRoute } from "./+routes.ts"
import {
  ADMIN_BILLING_KEY_REUSED,
  ADMIN_BILLING_MEMBER,
  ADMIN_BILLING_OFF,
  ADMIN_BILLING_PAYMENT_CHANGED,
  ADMIN_BILLING_SUPERVISOR,
  ADMIN_BILLING_UNKNOWN,
  adminBillingSettings,
  type AdminBillingStore,
  createAdminBillingRoutes,
} from "./billing.ts"
import type { AdminModuleContext } from "./module.ts"
import { apiError } from "../../_testing/api-error.ts"

const GROUP = `0199f0a0-0000-7000-8000-000000000001`
const NOW = new Date(`2026-10-17T12:00:00.000Z`)
const OPERATOR_ID = 7

const customer: AdminBillingCustomer = {
  groupId: GROUP,
  groupName: `Acme`,
  groupDeletedAt: null,
  owner: { id: 1, name: `Ann`, email: `ann@example.com` },
  planId: PRO_PLAN_ID,
  status: BillingStatus.Active,
  quantity: 2,
  currentPeriodEnd: `2026-11-12T00:00:00.000Z`,
  cancelAtPeriodEnd: false,
  trialEnd: null,
  pastDueSince: null,
  everActive: true,
  updatedAt: `2026-10-12T00:00:00.000Z`,
}

const record: AdminBillingRecord = {
  customer,
  providerSubscriptionId: `sub_acme`,
  providerCustomerId: `cus_acme`,
  customerSince: `2026-09-01T00:00:00.000Z`,
  history: [],
}

const payment: PaidPayment = {
  id: `pi_server`,
  invoiceId: `in_1`,
  amount: 1800,
  currency: `EUR`,
  decimals: 2,
  paidAt: new Date(`2026-10-12T00:00:00.000Z`),
  amountRefunded: 0,
  refunded: false,
}

const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

interface Setup {
  role?: UserRole
  member?: boolean
  claim?: AdminBillingClaimOutcome
  claimedUntil?: Date | null
  billingOn?: boolean
  failure?: BillingError
  stored?: AdminBillingRecord
}

function buildApp(setup: Setup = {}, auth?: APIContext["Variables"]["auth"]) {
  const calls: unknown[][] = []
  const audits: AdminBillingAuditRow[] = []
  const claims: AdminBillingClaim[] = []
  const store: AdminBillingStore = {
    figures: () => Promise.reject(new Error(`not used`)),
    list: () =>
      Promise.resolve({
        customers: [],
        total: 0,
        counts: { paying: 0, trial: 0, past_due: 0, ending: 0, cancelled: 0, all: 0 },
      }),
    record: (groupId) => Promise.resolve(groupId === GROUP ? setup.stored ?? record : null),
    isOwnerOrMember: () => Promise.resolve(setup.member ?? false),
    claim: (claim) => {
      claims.push(claim)
      const outcome = setup.claim ?? AdminBillingClaimOutcome.Claimed
      return Promise.resolve({
        outcome,
        until: setup.claimedUntil === undefined ? claim.until ?? null : setup.claimedUntil,
      })
    },
    release: (key) => (calls.push([`release`, key]), Promise.resolve()),
    audit: (_key, row) => (audits.push(row), Promise.resolve(true)),
  }
  const answered = (subscriptionId: string): Promise<{ ok: true; value: Subscription }> =>
    Promise.resolve({
      ok: true,
      value: {
        id: subscriptionId,
        customerId: `cus_acme`,
        status: SubscriptionStatus.Active,
        planId: PRO_PLAN_ID,
        priceId: `price_pro`,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        quantity: 2,
        reference: null,
      },
    })
  const fail = () => Promise.resolve({ ok: false as const, error: setup.failure! })
  const provider = {
    readLastPayment: (
      request,
    ) => (calls.push([`readLastPayment`, request]), Promise.resolve({ ok: true, value: payment })),
    refundPayment: (request) => {
      calls.push([`refundPayment`, request])
      if (setup.failure) return fail()
      return Promise.resolve({
        ok: true,
        value: {
          id: `re_1`,
          paymentId: request.paymentId,
          amount: 1800,
          currency: `EUR`,
          decimals: 2,
          status: RefundStatus.Succeeded,
        },
      })
    },
    setTrialEnd: (request) => {
      calls.push([`setTrialEnd`, request])
      return setup.failure ? fail() : answered(request.subscriptionId)
    },
    cancelNow: (request) => {
      calls.push([`cancelNow`, request])
      return setup.failure ? fail() : answered(request.subscriptionId)
    },
    setCancelAtPeriodEnd: (request) => {
      calls.push([`setCancelAtPeriodEnd`, request])
      return setup.failure ? fail() : answered(request.subscriptionId)
    },
  } as Partial<Required<BillingProvider>> as Required<BillingProvider>
  const route = createAdminRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    modules: [
      createAdminBillingRoutes({
        limit: passThrough,
        store,
        billing: setup.billingOn === false ? null : {
          provider,
          graceDays: 7,
          dashboardUrl: `https://dashboard.stripe.com/test`,
          pricingUrl: `https://www.example.com/pricing`,
        },
        now: () => NOW,
      }),
    ],
  })
  const user = auth !== undefined
    ? auth
    : buildAuthData({ user: { id: OPERATOR_ID, role: setup.role ?? UserRole.OPERATOR } })
  return { app: mountRoute(`/admin`, route, user), calls, audits, claims }
}

function post(
  app: ReturnType<typeof buildApp>[`app`],
  path: string,
  body: unknown,
  headers: Record<string, string> = sameOriginHeaders,
) {
  return app.request(`${API_URL}/admin/billing/${GROUP}/${path}`, {
    method: `POST`,
    headers: { ...headers },
    body: JSON.stringify(body),
  })
}

/** Every write of the module, each with a body that passes its validation. */
const ACTIONS = () => [
  { path: `refund`, body: { idempotencyKey: uuidV7(), paymentId: `pi_server` } },
  { path: `time`, body: { idempotencyKey: uuidV7(), length: `30d` } },
  { path: `cancel`, body: { idempotencyKey: uuidV7(), when: `period_end` } },
  { path: `cancel`, body: { idempotencyKey: uuidV7(), when: `now` } },
  { path: `undo-cancel`, body: { idempotencyKey: uuidV7() } },
]

describe(`operator billing routes`, () => {
  for (const { path, body } of ACTIONS()) {
    it(`refuses a cross-site ${path} with 403 and calls nothing`, async () => {
      const { app, calls, claims } = buildApp({ role: UserRole.ADMIN })
      const response = await post(app, path, body, crossSiteHeaders)

      expect(response.status).toBe(403)
      expect(calls).toEqual([])
      expect(claims).toEqual([])
    })

    it(`answers 404 to a viewer's ${path} and calls nothing`, async () => {
      const { app, calls } = buildApp({ role: UserRole.VIEWER })
      const response = await post(app, path, body)

      expect(response.status).toBe(404)
      expect(calls).toEqual([])
    })

    it(`answers 401 to a signed-out ${path}`, async () => {
      const { app, calls } = buildApp({}, null)
      const response = await post(app, path, body, sameOriginWithoutCookieHeaders)

      expect(response.status).toBe(401)
      expect(calls).toEqual([])
    })

    it(`refuses ${path} on a group the operator belongs to`, async () => {
      const { app, calls, claims } = buildApp({ role: UserRole.ADMIN, member: true })
      const response = await post(app, path, body)

      expect(response.status).toBe(403)
      expect((await apiError(response)).message).toBe(ADMIN_BILLING_MEMBER)
      expect(calls).toEqual([])
      expect(claims).toEqual([])
    })
  }

  it(`refuses a refund to an operator: only a supervisor or above refunds`, async () => {
    const { app, calls } = buildApp({ role: UserRole.OPERATOR })
    const response = await post(app, `refund`, ACTIONS()[0].body)

    expect(response.status).toBe(403)
    expect((await apiError(response)).message).toBe(ADMIN_BILLING_SUPERVISOR.refund)
    expect(calls).toEqual([])
  })

  it(`refuses an immediate cancellation to an operator, but lets them cancel at period end`, async () => {
    const { app, calls, audits } = buildApp({ role: UserRole.OPERATOR })
    const now = await post(app, `cancel`, ACTIONS()[3].body)
    expect(now.status).toBe(403)
    expect((await apiError(now)).message).toBe(ADMIN_BILLING_SUPERVISOR.cancel_now)
    expect(calls).toEqual([])

    const later = await post(app, `cancel`, ACTIONS()[2].body)
    expect(later.status).toBe(200)
    expect(audits.map((row) => row.eventType)).toEqual([BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd])
  })

  it(`refunds the payment it read for the group, with the key scoped to the action and group`, async () => {
    const { app, calls, audits } = buildApp({ role: UserRole.SUPERVISOR })
    const key = uuidV7()
    const response = await post(app, `refund`, { idempotencyKey: key, paymentId: `pi_server` })

    expect(response.status).toBe(200)
    expect((await response.json()).refunded).toEqual({ amount: 1800, currency: `EUR` })
    expect(calls).toEqual([
      [`readLastPayment`, { subscriptionId: `sub_acme` }],
      [`refundPayment`, { paymentId: `pi_server`, idempotencyKey: `admin:refund:${GROUP}:${key}` }],
    ])
    expect(audits).toEqual([{
      operatorId: OPERATOR_ID,
      eventType: BILLING_AUDIT_EVENTS.paymentRefunded,
      identifier: `group:${GROUP} obj:pi_server amount:1800 EUR 2 note:`,
      ip: null,
      userAgent: null,
    }])
  })

  it(`never refunds a payment id the request names but the server did not read`, async () => {
    const { app, calls, audits } = buildApp({ role: UserRole.SUPERVISOR })
    const response = await post(app, `refund`, { idempotencyKey: uuidV7(), paymentId: `pi_other` })

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(ADMIN_BILLING_PAYMENT_CHANGED)
    expect(calls.filter(([name]) => name === `refundPayment`)).toEqual([])
    expect(audits).toEqual([])
  })

  it(`says the result is unknown, never that nothing changed, when a refund gets no answer`, async () => {
    const { app, audits } = buildApp({
      role: UserRole.SUPERVISOR,
      failure: { code: `network_error`, message: `timed out`, status: null },
    })
    const response = await post(app, `refund`, ACTIONS()[0].body)
    const answer = await apiError(response)

    expect(response.status).toBe(502)
    expect(answer).toMatchObject({
      code: `internal`,
      message: ADMIN_BILLING_UNKNOWN,
      reason: `result_unknown`,
    })
    expect(answer.message).not.toContain(`Nothing changed`)
    expect(audits).toEqual([])
  })

  it(`treats a server error at Stripe as an unknown result too`, async () => {
    const { app } = buildApp({
      stored: { ...record, customer: { ...customer, cancelAtPeriodEnd: true } },
      failure: { code: `provider_error`, message: `Stripe answered 500: oops`, status: 500 },
    })
    const response = await post(app, `undo-cancel`, { idempotencyKey: uuidV7() })

    expect((await apiError(response)).reason).toBe(`result_unknown`)
  })

  it(`says nothing changed when Stripe refuses the request`, async () => {
    const stored = { ...record, customer: { ...customer, cancelAtPeriodEnd: true } }
    const { app } = buildApp({
      stored,
      failure: {
        code: `provider_error`,
        message: `Stripe answered 400: No such sub.`,
        status: 400,
      },
    })
    const response = await post(app, `undo-cancel`, { idempotencyKey: uuidV7() })

    expect(await apiError(response)).toMatchObject({
      message: `Stripe refused this: Stripe answered 400: No such sub. Nothing changed.`,
      reason: `provider_refused`,
    })
  })

  it(`refuses a key already used for another action, before calling Stripe`, async () => {
    const { app, calls } = buildApp({ claim: AdminBillingClaimOutcome.Conflict })
    const response = await post(app, `time`, ACTIONS()[1].body)

    expect(response.status).toBe(409)
    expect((await apiError(response)).message).toBe(ADMIN_BILLING_KEY_REUSED)
    expect(calls).toEqual([])
  })

  it(`refuses a request whose idempotency key is no UUID`, async () => {
    const { app, calls, claims } = buildApp()
    const response = await post(app, `time`, { idempotencyKey: `retry-1`, length: `30d` })

    expect(response.status).toBe(400)
    expect(calls).toEqual([])
    expect(claims).toEqual([])
  })

  it(`gives time from the end of the paid period, and a retry sends the first try's date`, async () => {
    const first = buildApp()
    await post(first.app, `time`, ACTIONS()[1].body)
    expect(first.calls[0][1]).toMatchObject({ trialEnd: new Date(`2026-12-12T00:00:00.000Z`) })
    expect(first.audits[0].identifier).toContain(`until:2026-12-12T00:00:00.000Z`)

    const stored = new Date(`2026-12-01T00:00:00.000Z`)
    const retry = buildApp({ claim: AdminBillingClaimOutcome.Retry, claimedUntil: stored })
    const response = await post(retry.app, `time`, ACTIONS()[1].body)
    expect(response.status).toBe(200)
    expect(retry.calls[0][1]).toMatchObject({ trialEnd: stored })
  })

  it(`refuses an action the subscription's state does not allow, and gives the key back`, async () => {
    const stored = { ...record, customer: { ...customer, status: BillingStatus.Canceled } }
    const { app, calls } = buildApp({ stored })
    const body = { idempotencyKey: uuidV7(), when: `period_end` }
    const response = await post(app, `cancel`, body)

    expect(response.status).toBe(409)
    expect(calls).toEqual([[`release`, body.idempotencyKey]])
  })

  it(`answers that billing is not set up while it is off`, async () => {
    const { app, calls } = buildApp({ billingOn: false })
    const figures = await app.request(`${API_URL}/admin/billing/figures`, {
      headers: { ...sameOriginHeaders },
    })
    expect(await figures.json()).toEqual({ enabled: false })
    const customers = await app.request(`${API_URL}/admin/billing/customers`, {
      headers: { ...sameOriginHeaders },
    })
    expect(await customers.json()).toEqual({ enabled: false })
    const action = await post(app, `undo-cancel`, { idempotencyKey: uuidV7() })
    expect(action.status).toBe(404)
    expect((await apiError(action)).message).toBe(ADMIN_BILLING_OFF)
    expect(calls).toEqual([])
  })

  it(`links the customer to Stripe's dashboard on their page`, async () => {
    const { app } = buildApp()
    const response = await app.request(`${API_URL}/admin/billing/${GROUP}`, {
      headers: { ...sameOriginHeaders },
    })

    expect(response.status).toBe(200)
    expect((await response.json()).providerUrl).toBe(
      `https://dashboard.stripe.com/test/customers/cus_acme`,
    )
  })

  it(`sends the website's pricing page with the list, for the action of an empty list`, async () => {
    const { app } = buildApp()
    const response = await app.request(`${API_URL}/admin/billing/customers`, {
      headers: { ...sameOriginHeaders },
    })

    expect(response.status).toBe(200)
    expect((await response.json()).pricingUrl).toBe(`https://www.example.com/pricing`)
  })

  it(`links the website's pricing page whenever MPA_DOMAIN is set, with the newsletter off too`, () => {
    // Built as apps/api/index.ts builds it, in production without SUBSCRIBERS_SECRET.
    const context = (vars: Record<string, string>) => {
      const env = { get: (name: string) => vars[name] }
      return {
        subscribers: readSubscribersSetup(env, `prod`),
        siteUrl: readSiteUrl(env, `prod`),
        billing: { provider: {}, graceDays: 7, dashboardUrl: null },
      } as unknown as AdminModuleContext
    }

    expect(adminBillingSettings(context({ MPA_DOMAIN: `www.example.com` }))?.pricingUrl).toBe(
      `https://www.example.com/pricing`,
    )
    expect(adminBillingSettings(context({}))?.pricingUrl).toBe(null)
  })
})
