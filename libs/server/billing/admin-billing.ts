/**
 * The operator area's billing module (#196) over Postgres: the figures, the customer list, one
 * customer's stored facts and operator history, and the bookkeeping that makes each action audited
 * once per idempotency key. It reads what the webhooks stored; it never calls the provider.
 *
 * @module
 */

import type postgres from "postgres"
import { ONE_DAY_IN_MILLISECONDS } from "@spy4x/platform/universal/time-constants"
import { isUuid } from "@spy4x/platform/universal/uuid"
import {
  type AdminBillingCounts,
  type AdminBillingCustomer,
  type AdminBillingFigures,
  type AdminBillingFilter,
  type AdminBillingHistoryEntry,
  type AdminBillingStatusFilter,
  BILLING_AUDIT_EVENT_TYPES,
  type BillingAuditEvent,
  billingAuditPrefix,
  BillingStatus,
  type Money,
  monthlyRevenueOf,
  readBillingAuditIdentifier,
} from "@domain/billing"
import { likeContains } from "@spy4x/server/db"

const PASSWORD_METHOD = `password`
/** A subscription that still runs: it may renew, bill again or be cancelled. */
const LIVE = [BillingStatus.Trialing, BillingStatus.Active, BillingStatus.PastDue]
/** A subscription that pays: its list price counts toward monthly revenue. */
const PAYING = [BillingStatus.Active, BillingStatus.PastDue]

/** The figures above the list, over every stored subscription, a group in the trash included. */
export async function readAdminBillingFigures(
  sql: postgres.Sql,
  now: Date,
): Promise<AdminBillingFigures> {
  const soon = new Date(now.getTime() + 7 * ONE_DAY_IN_MILLISECONDS)
  const rows = await sql<
    {
      planId: string | null
      status: BillingStatus
      quantity: number | null
      cancelAtPeriodEnd: boolean
      endsSoon: boolean
      count: number
    }[]
  >`
    SELECT plan_id, status, quantity, cancel_at_period_end,
      (status = ${BillingStatus.Trialing} AND trial_end > ${now} AND trial_end <= ${soon})
        AS ends_soon,
      COUNT(*)::int AS count
    FROM subscriptions
    GROUP BY 1, 2, 3, 4, 5
  `
  const revenue = new Map<string, number>()
  const figures: AdminBillingFigures = {
    monthlyRevenue: [],
    paying: 0,
    pastDue: 0,
    trials: 0,
    trialsEndingSoon: 0,
    ending: 0,
    lastEventAt: null,
  }
  for (const row of rows) {
    const money = monthlyRevenueOf(row)
    if (money !== null) {
      revenue.set(money.currency, (revenue.get(money.currency) ?? 0) + money.amount * row.count)
    }
    if (PAYING.includes(row.status)) figures.paying += row.count
    if (row.status === BillingStatus.PastDue) figures.pastDue += row.count
    if (row.status === BillingStatus.Trialing) figures.trials += row.count
    if (row.endsSoon) figures.trialsEndingSoon += row.count
    if (row.cancelAtPeriodEnd && LIVE.includes(row.status)) figures.ending += row.count
  }
  figures.monthlyRevenue = [...revenue].map(([currency, amount]): Money => ({ amount, currency }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
  const [{ lastEventAt }] = await sql<{ lastEventAt: Date | null }[]>`
    SELECT MAX(received_at) AS last_event_at FROM billing_events
  `
  figures.lastEventAt = lastEventAt?.toISOString() ?? null
  return figures
}

/** The `WHERE` of one status chip over `subscriptions s`. */
function statusWhere(sql: postgres.Sql, status: AdminBillingStatusFilter) {
  switch (status) {
    case `paying`:
      return sql`s.status IN ${sql(PAYING)}`
    case `trial`:
      return sql`s.status = ${BillingStatus.Trialing}`
    case `past_due`:
      return sql`s.status = ${BillingStatus.PastDue}`
    case `ending`:
      return sql`(s.cancel_at_period_end AND s.status IN ${sql(LIVE)})`
    case `cancelled`:
      return sql`s.status = ${BillingStatus.Canceled}`
    case `all`:
      return sql`TRUE`
  }
}

/**
 * The search's `WHERE` over `subscriptions s`, `groups g` and the owner `o`. A query that is a
 * group's id finds that group, and one that is a provider id (`sub_…`, `cus_…`) finds its
 * subscription; otherwise each word must appear, in any case, in the group's name, the owner's
 * name or an address the owner signs in with.
 */
function searchWhere(sql: postgres.Sql, query: string) {
  const words = query.split(/\s+/).filter(Boolean)
  if (isUuid(query)) return sql`g.id = ${query}`
  if (/^(sub|cus)_[A-Za-z0-9]+$/.test(query)) {
    return sql`(s.provider_subscription_id = ${query} OR s.provider_customer_id = ${query})`
  }
  let where = sql`TRUE`
  for (const word of words) {
    const pattern = likeContains(word)
    where = sql`${where} AND (
      g.name ILIKE ${pattern} OR o.first_name ILIKE ${pattern} OR o.last_name ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM auth_keys k
        WHERE k.user_id = o.id
          AND (
            k.email ILIKE ${pattern}
            OR (k.method = ${PASSWORD_METHOD} AND k.subject ILIKE ${pattern})
          )
      )
    )`
  }
  return where
}

interface CustomerRowRaw {
  groupId: string
  groupName: string
  groupDeletedAt: Date | null
  ownerId: number
  ownerName: string
  ownerEmail: string | null
  planId: string | null
  status: BillingStatus
  quantity: number | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  trialEnd: Date | null
  pastDueSince: Date | null
  everActive: boolean
  updatedAt: Date
  providerSubscriptionId: string
  providerCustomerId: string | null
  customerSince: Date | null
}

/** The columns of {@link CustomerRowRaw} over `subscriptions s`, `groups g` and the owner `o`. */
function customerColumns(sql: postgres.Sql) {
  return sql`
    s.group_id, g.name AS group_name, g.deleted_at AS group_deleted_at,
    o.id AS owner_id, btrim(concat_ws(' ', o.first_name, o.last_name)) AS owner_name,
    (
      SELECT COALESCE(k.email, CASE WHEN k.method = ${PASSWORD_METHOD} THEN k.subject END)
      FROM auth_keys k
      WHERE k.user_id = o.id
      ORDER BY (k.method = ${PASSWORD_METHOD}) DESC, k.email IS NULL, k.id
      LIMIT 1
    ) AS owner_email,
    s.plan_id, s.status, s.quantity, s.current_period_end, s.cancel_at_period_end, s.trial_end,
    s.past_due_since, s.ever_active, s.updated_at, s.provider_subscription_id,
    COALESCE(s.provider_customer_id, c.provider_customer_id) AS provider_customer_id,
    c.created_at AS customer_since
  `
}

const FROM_CUSTOMERS = (sql: postgres.Sql) =>
  sql`
  subscriptions s
  JOIN groups g ON g.id = s.group_id
  JOIN users o ON o.id = g.owner_user_id
  LEFT JOIN billing_customers c ON c.group_id = s.group_id
`

function toCustomer(row: CustomerRowRaw): AdminBillingCustomer {
  return {
    groupId: row.groupId,
    groupName: row.groupName,
    groupDeletedAt: row.groupDeletedAt?.toISOString() ?? null,
    owner: { id: row.ownerId, name: row.ownerName ?? ``, email: row.ownerEmail },
    planId: row.planId,
    status: row.status,
    quantity: row.quantity,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    trialEnd: row.trialEnd?.toISOString() ?? null,
    pastDueSince: row.pastDueSince?.toISOString() ?? null,
    everActive: row.everActive,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * One page of customers in order of urgency: past due first, then trials by their end, soonest
 * first, then by group name. With how many match in all, and how many each status chip holds under
 * the same search.
 */
export async function listAdminBillingCustomers(
  sql: postgres.Sql,
  filter: AdminBillingFilter,
  pageSize: number,
): Promise<{ customers: AdminBillingCustomer[]; total: number; counts: AdminBillingCounts }> {
  const search = searchWhere(sql, filter.query)
  const [counts] = await sql<AdminBillingCounts[]>`
    SELECT
      COUNT(*) FILTER (WHERE ${statusWhere(sql, `paying`)})::int AS paying,
      COUNT(*) FILTER (WHERE ${statusWhere(sql, `trial`)})::int AS trial,
      COUNT(*) FILTER (WHERE ${statusWhere(sql, `past_due`)})::int AS past_due,
      COUNT(*) FILTER (WHERE ${statusWhere(sql, `ending`)})::int AS ending,
      COUNT(*) FILTER (WHERE ${statusWhere(sql, `cancelled`)})::int AS cancelled,
      COUNT(*)::int AS "all"
    FROM ${FROM_CUSTOMERS(sql)}
    WHERE ${search}
  `
  // `postgres.camel` turns `past_due` into `pastDue`; the chips are keyed by the filter's own name.
  const raw = counts as unknown as Record<string, number>
  const chipCounts: AdminBillingCounts = {
    paying: raw.paying,
    trial: raw.trial,
    past_due: raw.pastDue,
    ending: raw.ending,
    cancelled: raw.cancelled,
    all: raw.all,
  }
  const rows = await sql<CustomerRowRaw[]>`
    SELECT ${customerColumns(sql)}
    FROM ${FROM_CUSTOMERS(sql)}
    WHERE ${search} AND ${statusWhere(sql, filter.status)}
    ORDER BY
      (s.status = ${BillingStatus.PastDue}) DESC,
      CASE WHEN s.status = ${BillingStatus.Trialing} THEN s.trial_end END ASC NULLS LAST,
      lower(g.name) ASC,
      s.group_id ASC
    LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
  `
  return {
    customers: rows.map(toCustomer),
    total: chipCounts[filter.status],
    counts: chipCounts,
  }
}

/** One customer as the server keeps it: the page's facts and the provider's ids the actions use. */
export interface AdminBillingRecord {
  customer: AdminBillingCustomer
  providerSubscriptionId: string
  providerCustomerId: string | null
  customerSince: string | null
  history: AdminBillingHistoryEntry[]
}

/** How many operator actions a customer's page lists, newest first. */
const HISTORY_LIMIT = 50

/** One group's subscription with its operator history, or `null` when it has none stored. */
export async function readAdminBillingRecord(
  sql: postgres.Sql,
  groupId: string,
): Promise<AdminBillingRecord | null> {
  if (!isUuid(groupId)) return null
  const [row] = await sql<CustomerRowRaw[]>`
    SELECT ${customerColumns(sql)}
    FROM ${FROM_CUSTOMERS(sql)}
    WHERE s.group_id = ${groupId}
  `
  if (!row) return null
  const history = await sql<
    {
      id: number
      eventType: BillingAuditEvent
      identifier: string
      createdAt: Date
      operatorName: string | null
    }[]
  >`
    SELECT a.id, a.event_type, a.identifier, a.created_at,
      NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS operator_name
    FROM auth_audits a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.event_type IN ${sql(BILLING_AUDIT_EVENT_TYPES)}
      AND a.identifier LIKE ${`${billingAuditPrefix(groupId)}%`}
    ORDER BY a.id DESC
    LIMIT ${HISTORY_LIMIT}
  `
  return {
    customer: toCustomer(row),
    providerSubscriptionId: row.providerSubscriptionId,
    providerCustomerId: row.providerCustomerId,
    customerSince: row.customerSince?.toISOString() ?? null,
    history: history.map((entry) => {
      const facts = readBillingAuditIdentifier(entry.identifier)
      return {
        id: entry.id,
        event: entry.eventType,
        at: entry.createdAt.toISOString(),
        operator: entry.operatorName,
        amount: facts?.amount ?? null,
        until: facts?.until ?? null,
        note: facts?.note ?? ``,
      }
    }),
  }
}

/** Whether `userId` owns `groupId` or belongs to it, so an operator may not act on it. */
export async function isOwnerOrMember(
  sql: postgres.Sql,
  groupId: string,
  userId: number,
): Promise<boolean> {
  const [row] = await sql<{ member: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM groups WHERE id = ${groupId} AND owner_user_id = ${userId}
    ) OR EXISTS (
      SELECT 1 FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
    ) AS member
  `
  return row?.member ?? false
}

/** What one action asks for, by the idempotency key the page made when its dialog opened. */
export interface AdminBillingClaim {
  idempotencyKey: string
  /** The action's name: `refund`, `time`, `cancel_period_end`, `cancel_now` or `undo`. */
  action: string
  groupId: string
  operatorId: number
  /** For time at no charge: the new trial end this try computed. */
  until?: Date
}

/** What claiming a key found. */
export enum AdminBillingClaimOutcome {
  /** The key is new; it now belongs to this request. */
  Claimed = 1,
  /** The same operator sent the same action for the same group before: a retry. */
  Retry = 2,
  /** The key was used for another group, action or operator. Nothing may act on it. */
  Conflict = 3,
}

/**
 * Claims the key for this action before the provider is called. A retry of the same request finds
 * its own claim and goes on with the trial end the first try stored, so the provider gets the same
 * request and acts once for the key. A key reused for anything else is refused, so it never acts
 * without an audit row.
 */
export async function claimAdminBillingAction(
  sql: postgres.Sql,
  claim: AdminBillingClaim,
): Promise<{ outcome: AdminBillingClaimOutcome; until: Date | null }> {
  const until = claim.until ?? null
  const inserted = await sql`
    INSERT INTO admin_billing_actions (idempotency_key, action, group_id, operator_id, until)
    VALUES (
      ${claim.idempotencyKey}, ${claim.action}, ${claim.groupId}, ${claim.operatorId}, ${until}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING idempotency_key
  `
  if (inserted.length > 0) return { outcome: AdminBillingClaimOutcome.Claimed, until }
  const [existing] = await sql<
    { action: string; groupId: string; operatorId: number; until: Date | null }[]
  >`
    SELECT action, group_id, operator_id, until FROM admin_billing_actions
    WHERE idempotency_key = ${claim.idempotencyKey}
  `
  const same = existing !== undefined && existing.action === claim.action &&
    existing.groupId === claim.groupId && existing.operatorId === claim.operatorId
  return same
    ? { outcome: AdminBillingClaimOutcome.Retry, until: existing.until }
    : { outcome: AdminBillingClaimOutcome.Conflict, until: null }
}

/**
 * Gives a claimed key back when the action was refused before the provider was called, so nothing
 * of it stays. A key whose action was audited is kept.
 */
export async function releaseAdminBillingAction(
  sql: postgres.Sql,
  idempotencyKey: string,
): Promise<void> {
  await sql`
    DELETE FROM admin_billing_actions
    WHERE idempotency_key = ${idempotencyKey} AND audited_at IS NULL
  `
}

/** The audit row of an action, as `auth_audits` stores it on the operator's own trail. */
export interface AdminBillingAuditRow {
  operatorId: number
  eventType: BillingAuditEvent
  identifier: string
  ip: string | null
  userAgent: string | null
}

/**
 * Writes the action's audit row unless an earlier try with the same key already did, in one
 * transaction with the mark, so two retries racing write one row. Returns whether it wrote it.
 */
export function auditAdminBillingAction(
  sql: postgres.Sql,
  idempotencyKey: string,
  row: AdminBillingAuditRow,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const marked = await tx`
      UPDATE admin_billing_actions SET audited_at = CURRENT_TIMESTAMP
      WHERE idempotency_key = ${idempotencyKey} AND audited_at IS NULL
      RETURNING idempotency_key
    `
    if (marked.length === 0) return false
    await tx`
      INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent)
      VALUES (${row.operatorId}, ${row.eventType}, ${row.identifier}, ${row.ip}, ${row.userAgent})
    `
    return true
  })
}
