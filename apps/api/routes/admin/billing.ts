import { type Context, Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { type } from "arktype"
import type postgres from "postgres"
import type { BillingError, BillingProvider, PaidPayment } from "@spy4x/billing"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_BILLING_PAGE_SIZE,
  ADMIN_BILLING_SUPERVISOR_ACTIONS,
  type AdminBillingActionKind,
  adminBillingActionRefusal,
  adminBillingCancelSchema,
  type AdminBillingDetail,
  type AdminBillingFigures,
  type AdminBillingFilter,
  type AdminBillingPayment,
  adminBillingRefundSchema,
  adminBillingTimeSchema,
  adminBillingUndoSchema,
  BILLING_AUDIT_EVENTS,
  type BillingAuditFacts,
  billingAuditIdentifier,
  type Money,
  noChargeUntil,
  parseAdminBillingFilter,
} from "@domain/billing"
import { UserRole } from "@domain/identity"
import {
  type AdminBillingAuditRow,
  type AdminBillingClaim,
  AdminBillingClaimOutcome,
  type AdminBillingRecord,
  auditAdminBillingAction,
  claimAdminBillingAction,
  isOwnerOrMember,
  listAdminBillingCustomers,
  readAdminBillingFigures,
  readAdminBillingRecord,
  releaseAdminBillingAction,
} from "@server/billing/admin-billing.ts"
import { readFeatureJson } from "@api/services/json-body.ts"
import type { APIContext } from "../../_types.ts"
import type { AdminApiModule, AdminModuleContext } from "./module.ts"
import { errorResponse, validationResponse } from "../../services/error-response.ts"

/** The answer to every customer route while billing is off (decision 10 of #196). */
export const ADMIN_BILLING_OFF = `Billing is not set up`
export const ADMIN_BILLING_NOT_FOUND = `This group has no subscription`
export const ADMIN_BILLING_MEMBER =
  `You own or belong to this group, so another operator handles its billing.`
export const ADMIN_BILLING_SUPERVISOR = {
  refund: `Only a supervisor or an administrator can refund a payment.`,
  cancel_now: `Only a supervisor or an administrator can cancel a subscription at once.`,
} as const
export const ADMIN_BILLING_KEY_REUSED =
  `This request was already used for another action. Close the dialog and open it again.`
export const ADMIN_BILLING_NO_PAYMENT = `This subscription has no payment to refund.`
export const ADMIN_BILLING_ALREADY_REFUNDED = `This payment is already refunded in full.`
export const ADMIN_BILLING_PAYMENT_CHANGED =
  `The last payment changed since the dialog opened. Close it and check the payment again.`
/** After no answer, or an answer that may hide a change: the action may or may not have happened. */
export const ADMIN_BILLING_UNKNOWN =
  `Stripe did not answer clearly, so we cannot tell whether this happened. Check the customer in Stripe, or try again: a retry with the same request acts once.`

/** The provider and settings the module acts through; `null` while billing is off. */
export interface AdminBillingSettings {
  provider: Required<BillingProvider>
  graceDays: number
  /** The provider's dashboard, for the link on a customer's page, or `null`. */
  dashboardUrl: string | null
  /** The public website's pricing page, or `null` while `MPA_DOMAIN` is unset. */
  pricingUrl: string | null
}

/** What the routes read and write, over the app's database. Tests pass a fake. */
export interface AdminBillingStore {
  figures(now: Date): Promise<AdminBillingFigures>
  list(filter: AdminBillingFilter, pageSize: number): ReturnType<typeof listAdminBillingCustomers>
  record(groupId: string): Promise<AdminBillingRecord | null>
  isOwnerOrMember(groupId: string, userId: number): Promise<boolean>
  claim(claim: AdminBillingClaim): ReturnType<typeof claimAdminBillingAction>
  release(idempotencyKey: string): Promise<void>
  audit(idempotencyKey: string, row: AdminBillingAuditRow): Promise<boolean>
}

export interface AdminBillingRouteDependencies {
  limit: MiddlewareHandler<APIContext>
  store: AdminBillingStore
  billing: AdminBillingSettings | null
  now(): Date
}

/** The store over one `sql` client. It reads nothing until called. */
export function createAdminBillingStore(sql: postgres.Sql): AdminBillingStore {
  return {
    figures: (now) => readAdminBillingFigures(sql, now),
    list: (filter, pageSize) => listAdminBillingCustomers(sql, filter, pageSize),
    record: (groupId) => readAdminBillingRecord(sql, groupId),
    isOwnerOrMember: (groupId, userId) => isOwnerOrMember(sql, groupId, userId),
    claim: (claim) => claimAdminBillingAction(sql, claim),
    release: (idempotencyKey) => releaseAdminBillingAction(sql, idempotencyKey),
    audit: (idempotencyKey, row) => auditAdminBillingAction(sql, idempotencyKey, row),
  }
}

/** The provider's dashboard page of a customer, or `null` without a dashboard or a customer. */
function providerUrlOf(dashboardUrl: string | null, customerId: string | null): string | null {
  if (dashboardUrl === null || customerId === null) return null
  return `${dashboardUrl}/customers/${encodeURIComponent(customerId)}`
}

function paymentOf(payment: PaidPayment): AdminBillingPayment {
  return {
    id: payment.id,
    amount: payment.amount,
    currency: payment.currency,
    decimals: payment.decimals,
    paidAt: payment.paidAt.toISOString(),
    amountRefunded: payment.amountRefunded,
    refunded: payment.refunded,
  }
}

/**
 * Whether a failed call may have changed something anyway: no answer, an answer this app cannot
 * read, or a server error on the provider's side. Only a refusal (4xx) or this app's own check
 * means nothing changed.
 */
function resultUnknown(error: BillingError): boolean {
  if (error.code === `network_error` || error.code === `malformed_response`) return true
  return error.code === `provider_error` && (error.status === null || error.status >= 500)
}

/** The answer to a failed provider call: `unknown` when it may have acted, else `refused`. */
function providerFailure(c: Context<APIContext>, error: BillingError) {
  if (resultUnknown(error)) {
    return errorResponse(c, `internal`, {
      message: ADMIN_BILLING_UNKNOWN,
      reason: `result_unknown` as const,
      status: 502,
    })
  }
  const reason = error.message.replace(/[.\s]+$/, ``)
  return errorResponse(c, `internal`, {
    message: `Stripe refused this: ${reason}. Nothing changed.`,
    reason: `provider_refused` as const,
    status: 502,
  })
}

/** The name the provider's idempotency key carries, so one key never serves two actions. */
function providerKey(action: AdminBillingActionKind, groupId: string, key: string): string {
  return `admin:${action}:${groupId}:${key}`
}

/**
 * The billing routes of the operator area (#196), mounted at `/api/admin` behind the gate in
 * `+routes.ts`: only an operator with a full session reaches them, and every write is same-site.
 *
 * - `GET /billing/figures` and `GET /billing/customers?q=&status=&page=` answer
 *   `{ enabled: false }` while billing is off.
 * - `GET /billing/:groupId` is one customer's stored facts and operator history;
 *   `GET /billing/:groupId/payment` reads the last payment from the provider.
 * - `POST /billing/:groupId/refund`, `/time`, `/cancel` and `/undo-cancel` act through the provider
 *   with the idempotency key the page sends, and write one audit row on the operator's trail. The
 *   refund and the immediate cancellation need a supervisor. Nobody acts on a group they own or
 *   belong to. The subscription itself changes when the provider's webhook lands.
 */
export function createAdminBillingRoutes(
  dependencies: AdminBillingRouteDependencies,
): Hono<APIContext> {
  const { limit, store, billing, now } = dependencies

  async function detailOf(
    record: AdminBillingRecord,
    settings: AdminBillingSettings,
    userId: number,
  ): Promise<AdminBillingDetail> {
    return {
      customer: record.customer,
      customerSince: record.customerSince,
      providerUrl: providerUrlOf(settings.dashboardUrl, record.providerCustomerId),
      history: record.history,
      operatorIsMember: await store.isOwnerOrMember(record.customer.groupId, userId),
      graceDays: settings.graceDays,
    }
  }

  /** The body of an action, read and checked; a `Response` when it is refused. */
  async function readBody<T>(
    c: Context<APIContext>,
    schema: (input: unknown) => T | type.errors,
  ): Promise<T | Response> {
    let body: unknown
    try {
      body = await readFeatureJson(c, (message) => new Error(message))
    } catch (error) {
      return errorResponse(c, `bad_request`, { message: (error as Error).message })
    }
    const input = schema(body)
    if (input instanceof type.errors) return validationResponse(c, input)
    return input
  }

  interface ActionPlan {
    /** The audit row's event and facts. */
    event: (typeof BILLING_AUDIT_EVENTS)[keyof typeof BILLING_AUDIT_EVENTS]
    facts: BillingAuditFacts
    /** Extra fields of the answer. */
    extra: { refunded?: Money; until?: string }
  }

  /**
   * Every action's path: the checks in order (billing on, body, role, a subscription, not the
   * operator's own group, the key not used elsewhere, the state), then the provider call through
   * `act`, then the audit row and the answer. `act` answers the plan, or a `Response` to send.
   */
  async function runAction<T extends { idempotencyKey: string; note?: string }>(
    c: Context<APIContext>,
    schema: (input: unknown) => T | type.errors,
    actionOf: (input: T) => AdminBillingActionKind,
    act: (input: {
      body: T
      record: AdminBillingRecord
      settings: AdminBillingSettings
      key: string
      claimed: boolean
      until: Date | null
    }) => Promise<ActionPlan | Response>,
    untilOf?: (body: T, record: AdminBillingRecord) => Date,
  ): Promise<Response> {
    const groupId = c.req.param(`groupId`) ?? ``
    if (!isUuid(groupId)) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_NOT_FOUND })
    if (billing === null) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_OFF })
    const body = await readBody(c, schema)
    if (body instanceof Response) return body
    const kind = actionOf(body)
    const { user } = c.get(`auth`)!
    if (ADMIN_BILLING_SUPERVISOR_ACTIONS.has(kind) && user.role < UserRole.SUPERVISOR) {
      const error = ADMIN_BILLING_SUPERVISOR[kind as keyof typeof ADMIN_BILLING_SUPERVISOR]
      return errorResponse(c, `forbidden`, { message: error })
    }
    const record = await store.record(groupId)
    if (!record) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_NOT_FOUND })
    if (await store.isOwnerOrMember(groupId, user.id)) {
      return errorResponse(c, `forbidden`, { message: ADMIN_BILLING_MEMBER })
    }
    const claim = await store.claim({
      idempotencyKey: body.idempotencyKey,
      action: kind,
      groupId,
      operatorId: user.id,
      until: untilOf?.(body, record),
    })
    if (claim.outcome === AdminBillingClaimOutcome.Conflict) {
      return errorResponse(c, `conflict`, { message: ADMIN_BILLING_KEY_REUSED })
    }
    const claimed = claim.outcome === AdminBillingClaimOutcome.Claimed
    // A retry skips the state check: the first try may have changed the state already, and the
    // provider answers the retry with the first try's result.
    const refusal = claimed ? adminBillingActionRefusal(kind, record.customer) : null
    if (refusal !== null) {
      await store.release(body.idempotencyKey)
      return errorResponse(c, `conflict`, { message: refusal })
    }
    const plan = await act({
      body,
      record,
      settings: billing,
      key: providerKey(kind, groupId, body.idempotencyKey),
      claimed,
      until: claim.until,
    })
    if (plan instanceof Response) return plan
    const request = requestInfoFromContext(c, { trustedProxy: true })
    await store.audit(body.idempotencyKey, {
      operatorId: user.id,
      eventType: plan.event,
      identifier: billingAuditIdentifier({ ...plan.facts, note: body.note?.trim() ?? `` }),
      ip: request.ip || null,
      userAgent: request.userAgent?.slice(0, 300) || null,
    })
    const after = (await store.record(groupId)) ?? record
    return c.json({ detail: await detailOf(after, billing, user.id), ...plan.extra })
  }

  return new Hono<APIContext>()
    .get(`/billing/figures`, limit, async (c) => {
      if (billing === null) return c.json({ enabled: false })
      return c.json({ enabled: true, figures: await store.figures(now()) })
    })
    .get(`/billing/customers`, limit, async (c) => {
      if (billing === null) return c.json({ enabled: false })
      const filter = parseAdminBillingFilter(new URL(c.req.url).searchParams)
      const { customers, total, counts } = await store.list(filter, ADMIN_BILLING_PAGE_SIZE)
      return c.json({
        enabled: true,
        customers,
        total,
        page: filter.page,
        pageSize: ADMIN_BILLING_PAGE_SIZE,
        counts,
        graceDays: billing.graceDays,
        pricingUrl: billing.pricingUrl,
      })
    })
    .get(`/billing/:groupId`, limit, async (c) => {
      const groupId = c.req.param(`groupId`)
      if (billing === null) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_OFF })
      const record = isUuid(groupId) ? await store.record(groupId) : null
      if (!record) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_NOT_FOUND })
      return c.json(await detailOf(record, billing, c.get(`auth`)!.user.id))
    })
    .get(`/billing/:groupId/payment`, limit, async (c) => {
      const groupId = c.req.param(`groupId`)
      if (billing === null) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_OFF })
      const record = isUuid(groupId) ? await store.record(groupId) : null
      if (!record) return errorResponse(c, `not_found`, { message: ADMIN_BILLING_NOT_FOUND })
      const read = await billing.provider.readLastPayment({
        subscriptionId: record.providerSubscriptionId,
      })
      if (!read.ok) {
        return errorResponse(c, `internal`, {
          message: `Stripe did not give the last payment. Try again in a moment.`,
          status: 502,
        })
      }
      return c.json({ payment: read.value === null ? null : paymentOf(read.value) })
    })
    .post(`/billing/:groupId/refund`, limit, (c) =>
      runAction(
        c,
        adminBillingRefundSchema,
        () => `refund`,
        async ({ body, record, settings, key, claimed }) => {
          // The payment is read here, for this group's subscription; the body's id only confirms
          // that the dialog showed this payment.
          const read = await settings.provider.readLastPayment({
            subscriptionId: record.providerSubscriptionId,
          })
          if (!read.ok) {
            if (claimed) await store.release(body.idempotencyKey)
            return errorResponse(c, `internal`, {
              message: `Stripe did not give the last payment, so nothing was refunded. Try again.`,
              reason: `provider_refused`,
              status: 502,
            })
          }
          const payment = read.value
          const refusal = payment === null
            ? ADMIN_BILLING_NO_PAYMENT
            : payment.id !== body.paymentId
            ? ADMIN_BILLING_PAYMENT_CHANGED
            : claimed && payment.refunded
            ? ADMIN_BILLING_ALREADY_REFUNDED
            : null
          if (refusal !== null || payment === null) {
            if (claimed) await store.release(body.idempotencyKey)
            return errorResponse(c, `conflict`, { message: refusal ?? ADMIN_BILLING_NO_PAYMENT })
          }
          const refund = await settings.provider.refundPayment({
            paymentId: payment.id,
            idempotencyKey: key,
          })
          if (!refund.ok) return providerFailure(c, refund.error)
          const amount = {
            amount: refund.value.amount,
            currency: refund.value.currency,
            decimals: refund.value.decimals,
          }
          return {
            event: BILLING_AUDIT_EVENTS.paymentRefunded,
            facts: { groupId: record.customer.groupId, objectId: payment.id, amount, note: `` },
            extra: { refunded: { amount: amount.amount, currency: amount.currency } },
          }
        },
      ))
    .post(`/billing/:groupId/time`, limit, (c) =>
      runAction(
        c,
        adminBillingTimeSchema,
        () => `time`,
        async ({ record, settings, key, until }) => {
          const trialEnd = until!
          const result = await settings.provider.setTrialEnd({
            subscriptionId: record.providerSubscriptionId,
            trialEnd,
            idempotencyKey: key,
          })
          if (!result.ok) return providerFailure(c, result.error)
          return {
            event: BILLING_AUDIT_EVENTS.timeGiven,
            facts: {
              groupId: record.customer.groupId,
              objectId: record.providerSubscriptionId,
              until: trialEnd.toISOString(),
              note: ``,
            },
            extra: { until: trialEnd.toISOString() },
          }
        },
        (body, record) => noChargeUntil(record.customer, body.length, now()),
      ))
    .post(`/billing/:groupId/cancel`, limit, (c) =>
      runAction(
        c,
        adminBillingCancelSchema,
        (body) => body.when === `now` ? `cancel_now` : `cancel_period_end`,
        async ({ body, record, settings, key }) => {
          const subscriptionId = record.providerSubscriptionId
          const result = body.when === `now`
            ? await settings.provider.cancelNow({ subscriptionId, idempotencyKey: key })
            : await settings.provider.setCancelAtPeriodEnd({
              subscriptionId,
              cancelAtPeriodEnd: true,
              idempotencyKey: key,
            })
          if (!result.ok) return providerFailure(c, result.error)
          return {
            event: body.when === `now`
              ? BILLING_AUDIT_EVENTS.cancelledNow
              : BILLING_AUDIT_EVENTS.cancelledAtPeriodEnd,
            facts: { groupId: record.customer.groupId, objectId: subscriptionId, note: `` },
            extra: {},
          }
        },
      ))
    .post(`/billing/:groupId/undo-cancel`, limit, (c) =>
      runAction(
        c,
        adminBillingUndoSchema,
        () => `undo`,
        async ({ record, settings, key }) => {
          const subscriptionId = record.providerSubscriptionId
          const result = await settings.provider.setCancelAtPeriodEnd({
            subscriptionId,
            cancelAtPeriodEnd: false,
            idempotencyKey: key,
          })
          if (!result.ok) return providerFailure(c, result.error)
          return {
            event: BILLING_AUDIT_EVENTS.cancellationUndone,
            facts: { groupId: record.customer.groupId, objectId: subscriptionId, note: `` },
            extra: {},
          }
        },
      ))
}

/** The billing settings of the module context, or `null` while billing is off. */
export function adminBillingSettings(context: AdminModuleContext): AdminBillingSettings | null {
  const billing = context.billing
  if (!billing || billing.provider === null) return null
  return {
    provider: billing.provider,
    graceDays: billing.graceDays,
    dashboardUrl: billing.dashboardUrl,
    pricingUrl: context.siteUrl === null ? null : `${context.siteUrl}/pricing`,
  }
}

/** The billing module: the figures, the customers, one customer and the five actions. */
export const billingAdminModule: AdminApiModule = {
  id: `billing`,
  routes: (context) =>
    createAdminBillingRoutes({
      limit: context.limit,
      store: createAdminBillingStore(context.sql),
      billing: adminBillingSettings(context),
      now: context.now,
    }),
}
