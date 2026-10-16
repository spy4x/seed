/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import {
  ADMIN_BILLING_NO_FILTER,
  BILLING_AUDIT_EVENTS,
  billingAuditIdentifier,
  BillingStatus,
  PRO_PLAN_ID,
} from "@domain/billing"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import {
  AdminBillingClaimOutcome,
  auditAdminBillingAction,
  claimAdminBillingAction,
  isOwnerOrMember,
  listAdminBillingCustomers,
  readAdminBillingFigures,
  readAdminBillingRecord,
  releaseAdminBillingAction,
} from "@server/billing/admin-billing.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * The operator area's billing module (#196) against a real Postgres built from schema.sql: the
 * revenue figures against a hand count, the customer list's chips, order and search, a customer's
 * operator history, and the claim that audits each idempotency key once.
 *
 * Needs `DB_HOST`, `DB_USER`, `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md). It fails when
 * they are missing rather than skipping.
 */

const NOW = new Date(`2026-10-17T12:00:00.000Z`)
const DAY = 24 * 60 * 60 * 1000

interface Seed {
  name: string
  status: BillingStatus
  planId?: string | null
  quantity?: number | null
  cancelAtPeriodEnd?: boolean
  trialEndInDays?: number
}

async function subscribe(
  sql: postgres.Sql,
  repository: PostgresGroupRepository,
  owner: number,
  seed: Seed,
): Promise<string> {
  const created = await repository.create({ id: uuidV7(), name: seed.name }, owner)
  const groupId = created.group.id
  const trialEnd = seed.trialEndInDays === undefined
    ? null
    : new Date(NOW.getTime() + seed.trialEndInDays * DAY)
  await sql`
    INSERT INTO subscriptions (
      group_id, provider_subscription_id, plan_id, status, current_period_end, cancel_at_period_end,
      provider_event_at, provider_event_rank, past_due_since, trial_end, quantity
    ) VALUES (
      ${groupId}, ${`sub_${groupId.replaceAll(`-`, ``)}`},
      ${seed.planId === undefined ? PRO_PLAN_ID : seed.planId}, ${seed.status},
      ${new Date(NOW.getTime() + 20 * DAY)}, ${seed.cancelAtPeriodEnd ?? false}, ${NOW}, 2,
      ${seed.status === BillingStatus.PastDue ? NOW : null}, ${trialEnd},
      ${seed.quantity === undefined ? 1 : seed.quantity}
    )
  `
  return groupId
}

Deno.test(`admin billing: monthly revenue and counts match a hand count of the seeded subscriptions`, async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    // Hand count, Pro at 900 cents per seat a month:
    //   Active ×3 seats, twice     5400  paying (two groups, same price and seats)
    //   Past due, no quantity       900  paying, past due (one seat)
    //   Trial ×5, ends in 3 days      0  trial ending soon
    //   Trial, ends in 20 days        0  trial
    //   Cancelled ×2, cancel pending  0  not ending: already over
    //   Active on an unknown price    –  paying, no revenue counted
    //   Active ×2, ending           1800  paying, ending
    // Total 8100 EUR cents; 5 paying, 1 past due, 2 trials, 1 ending soon, 1 ending.
    for (
      const seed of [
        { name: `A`, status: BillingStatus.Active, quantity: 3 },
        { name: `A2`, status: BillingStatus.Active, quantity: 3 },
        { name: `B`, status: BillingStatus.PastDue, quantity: null },
        { name: `C`, status: BillingStatus.Trialing, quantity: 5, trialEndInDays: 3 },
        { name: `D`, status: BillingStatus.Trialing, trialEndInDays: 20 },
        { name: `E`, status: BillingStatus.Canceled, quantity: 2, cancelAtPeriodEnd: true },
        { name: `F`, status: BillingStatus.Active, planId: null, quantity: 9 },
        { name: `G`, status: BillingStatus.Active, quantity: 2, cancelAtPeriodEnd: true },
      ] satisfies Seed[]
    ) {
      await subscribe(sql, repository, owner, seed)
    }
    await sql`INSERT INTO billing_events (id, event_type, received_at) VALUES ('evt_1', 1, ${NOW})`

    const figures = await readAdminBillingFigures(sql, NOW)

    expect(figures).toEqual({
      monthlyRevenue: [{ amount: 8100, currency: `EUR` }],
      paying: 5,
      pastDue: 1,
      trials: 2,
      trialsEndingSoon: 1,
      ending: 1,
      lastEventAt: NOW.toISOString(),
    })
  })
})

Deno.test(`admin billing: the list shows paying customers past due first, and counts every chip`, async () => {
  await withSchema(async (sql) => {
    const repository = new PostgresGroupRepository(sql)
    const owner = await insertUser(sql)
    await sql`UPDATE users SET first_name = 'Ada' WHERE id = ${owner}`
    await sql`
      INSERT INTO auth_keys (user_id, method, subject, email)
      VALUES (${owner}, 'email', 'ada@example.com', 'ada@example.com')
    `
    await subscribe(sql, repository, owner, { name: `Alpha`, status: BillingStatus.Active })
    const late = await subscribe(sql, repository, owner, {
      name: `Zulu`,
      status: BillingStatus.PastDue,
    })
    await subscribe(sql, repository, owner, {
      name: `Trial`,
      status: BillingStatus.Trialing,
      trialEndInDays: 2,
    })

    const page = await listAdminBillingCustomers(sql, ADMIN_BILLING_NO_FILTER, 25)

    expect(page.customers.map((customer) => customer.groupName)).toEqual([`Zulu`, `Alpha`])
    expect(page.customers[0].groupId).toBe(late)
    expect(page.customers[0].owner).toEqual({ id: owner, name: `Ada`, email: `ada@example.com` })
    expect(page.total).toBe(2)
    expect(page.counts).toEqual({
      paying: 2,
      trial: 1,
      past_due: 1,
      ending: 0,
      cancelled: 0,
      all: 3,
    })

    const searched = await listAdminBillingCustomers(
      sql,
      { query: `ada@EXAMPLE`, status: `all`, page: 1 },
      25,
    )
    expect(searched.total).toBe(3)
    const none = await listAdminBillingCustomers(
      sql,
      { query: `100%`, status: `all`, page: 1 },
      25,
    )
    expect(none.total).toBe(0)
  })
})

Deno.test(`admin billing: a retry keeps the trial end the first try computed`, async () => {
  await withSchema(async (sql) => {
    const { groupId } = await team(sql)
    const operator = await insertUser(sql)
    const claim = { idempotencyKey: uuidV7(), action: `time`, groupId, operatorId: operator }
    const first = new Date(`2026-11-30T00:00:00.000Z`)

    await claimAdminBillingAction(sql, { ...claim, until: first })
    const retry = await claimAdminBillingAction(sql, {
      ...claim,
      until: new Date(`2027-01-30T00:00:00.000Z`),
    })

    expect(retry).toEqual({ outcome: AdminBillingClaimOutcome.Retry, until: first })
  })
})

Deno.test(`admin billing: a key acts and audits once, and is refused for another group`, async () => {
  await withSchema(async (sql) => {
    const { groupId, owner, stranger, viewer } = await team(sql)
    const operator = await insertUser(sql)
    await sql`
      INSERT INTO subscriptions (
        group_id, provider_subscription_id, plan_id, status, provider_event_at, provider_event_rank
      ) VALUES (${groupId}, 'sub_team', ${PRO_PLAN_ID}, ${BillingStatus.Active}, ${NOW}, 2)
    `
    const key = uuidV7()
    const claim = { idempotencyKey: key, action: `refund`, groupId, operatorId: operator }
    const row = {
      operatorId: operator,
      eventType: BILLING_AUDIT_EVENTS.paymentRefunded,
      identifier: billingAuditIdentifier({
        groupId,
        objectId: `pi_1`,
        amount: { amount: 900, currency: `EUR`, decimals: 2 },
        note: `asked by mail`,
      }),
      ip: null,
      userAgent: null,
    }

    expect((await claimAdminBillingAction(sql, claim)).outcome).toBe(
      AdminBillingClaimOutcome.Claimed,
    )
    expect((await claimAdminBillingAction(sql, claim)).outcome).toBe(
      AdminBillingClaimOutcome.Retry,
    )
    expect((await claimAdminBillingAction(sql, { ...claim, groupId: uuidV7() })).outcome).toBe(
      AdminBillingClaimOutcome.Conflict,
    )
    expect((await claimAdminBillingAction(sql, { ...claim, operatorId: stranger })).outcome)
      .toBe(AdminBillingClaimOutcome.Conflict)
    expect(await auditAdminBillingAction(sql, key, row)).toBe(true)
    expect(await auditAdminBillingAction(sql, key, row)).toBe(false)

    const record = await readAdminBillingRecord(sql, groupId)
    expect(record?.providerSubscriptionId).toBe(`sub_team`)
    expect(record?.history).toHaveLength(1)
    expect(record?.history[0]).toMatchObject({
      event: BILLING_AUDIT_EVENTS.paymentRefunded,
      amount: { amount: 900, currency: `EUR`, decimals: 2 },
      note: `asked by mail`,
    })

    // A key refused before the provider was called is given back; an audited one is kept.
    await releaseAdminBillingAction(sql, key)
    expect((await claimAdminBillingAction(sql, claim)).outcome).toBe(
      AdminBillingClaimOutcome.Retry,
    )
    const refused = { ...claim, idempotencyKey: uuidV7() }
    await claimAdminBillingAction(sql, refused)
    await releaseAdminBillingAction(sql, refused.idempotencyKey)
    expect((await claimAdminBillingAction(sql, refused)).outcome).toBe(
      AdminBillingClaimOutcome.Claimed,
    )

    expect(await isOwnerOrMember(sql, groupId, owner)).toBe(true)
    expect(await isOwnerOrMember(sql, groupId, viewer)).toBe(true)
    expect(await isOwnerOrMember(sql, groupId, operator)).toBe(false)
  })
})
