/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import {
  type BillingEvent,
  BillingEventType,
  type SubscriptionEvent,
  SubscriptionStatus,
} from "@spy4x/billing"
import {
  BILLING_EVENTS,
  BillingNoticeKind,
  effectivePlanId,
  FREE_PLAN_ID,
  PRO_PLAN_ID,
} from "@domain/billing"
import { GroupError, GroupRole } from "@domain/groups"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { BILLING_NOTICE_JOBS } from "@server/billing/billing-notices.ts"
import { JOB_AGGREGATE } from "@server/jobs/jobs.ts"
import { createOutboxProcessor } from "@server/jobs/wiring.ts"
import type { EmailMessage } from "@spy4x/email/message"
import type { EmailSender } from "@spy4x/email/sender"
import { createPostgresAuthStore } from "@spy4x/server/auth/postgres"
import { PostgresGroupRepository } from "@server/groups/postgres-group-repository.ts"
import { buildPostgresOptions } from "@spy4x/server/db/postgres"
import { requireDbConnection } from "@spy4x/server/db/testing"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Webhook events applied to a real Postgres built from the migrations. Needs `DB_HOST`, `DB_USER`,
 * `DB_PASS` and `DB_NAME` (recipe in docs/handoff.md); it fails when they are missing rather than
 * skipping.
 */

const MIGRATIONS_DIR = "libs/server/db/migrations"

async function withSchema(body: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const settings = buildPostgresOptions(requireDbConnection())
  const admin = postgres({ ...settings, max: 1, onnotice: () => {} })
  const schema = `billing_test_${uuidV7().replaceAll("-", "")}`
  const sql = postgres({
    ...settings,
    max: 10,
    transform: postgres.camel,
    connection: { options: `-c search_path=${schema}` },
    onnotice: () => {},
  })
  try {
    await admin`CREATE SCHEMA ${admin(schema)}`
    const names = [...Deno.readDirSync(MIGRATIONS_DIR)].map((entry) => entry.name).sort()
    for (const name of names) {
      await sql.unsafe(await Deno.readTextFile(`${MIGRATIONS_DIR}/${name}`))
    }
    await body(sql)
  } finally {
    await sql.end({ timeout: 5 })
    await admin`DROP SCHEMA IF EXISTS ${admin(schema)} CASCADE`
    await admin.end({ timeout: 5 })
  }
}

/** A new user and the group they own. */
async function seedGroup(sql: postgres.Sql): Promise<{ groupId: string; owner: number }> {
  const owner = (await sql<{ id: number }[]>`
    WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
    INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
  `)[0].id
  const groupId = uuidV7()
  await new PostgresGroupRepository(sql).create({ id: groupId, name: "Team" }, owner)
  return { groupId, owner }
}

const T0 = new Date("2026-10-01T10:00:00Z")

function event(
  input: {
    id: string
    type?: SubscriptionEvent["type"]
    at?: Date
    reference?: string | null
    subscriptionId?: string
    customerId?: string
    status?: SubscriptionStatus
    currentPeriodEnd?: Date
    cancelAtPeriodEnd?: boolean
    trialEnd?: Date | null
    quantity?: number | null
  },
): SubscriptionEvent {
  return {
    id: input.id,
    type: input.type ?? BillingEventType.SubscriptionCreated,
    occurredAt: input.at ?? T0,
    subscription: {
      id: input.subscriptionId ?? "sub_1",
      customerId: input.customerId ?? "cus_1",
      status: input.status ?? SubscriptionStatus.Active,
      planId: PRO_PLAN_ID,
      priceId: "price_pro",
      currentPeriodEnd: input.currentPeriodEnd ?? new Date("2026-11-01T10:00:00Z"),
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      trialEnd: input.trialEnd ?? null,
      quantity: input.quantity === undefined ? 1 : input.quantity,
      reference: input.reference === undefined ? null : input.reference,
    },
  }
}

interface ChangeRow extends postgres.Row {
  eventKind: string
  actorUserId: number
}

async function planChanges(sql: postgres.Sql, groupId: string): Promise<ChangeRow[]> {
  return await sql<ChangeRow[]>`
    SELECT event_kind, actor_user_id FROM outbox_events
    WHERE group_id = ${groupId} AND event_kind LIKE 'group.plan.%'
    ORDER BY id
  `
}

async function nextSequence(sql: postgres.Sql, groupId: string): Promise<string> {
  return (await sql<{ next: string }[]>`
    SELECT next_change_sequence::text AS next FROM groups WHERE id = ${groupId}
  `)[0].next
}

Deno.test("billing events against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const billing = new PostgresBillingRepository(sql)

    await t.step(
      "a checkout's subscription puts the group on its plan and writes one plan-changed event",
      async () => {
        const { groupId, owner } = await seedGroup(sql)

        const outcome = await billing.applyEvent(event({ id: "evt_a1", reference: groupId }))

        expect(outcome).toBe("applied")
        expect(await billing.get(groupId)).toMatchObject({
          planId: PRO_PLAN_ID,
          status: SubscriptionStatus.Active,
          providerSubscriptionId: "sub_1",
        })
        expect(await billing.customerOf(groupId)).toBe("cus_1")
        expect(await planChanges(sql, groupId)).toEqual([
          { eventKind: BILLING_EVENTS.planChanged, actorUserId: owner },
        ])
      },
    )

    await t.step("a second delivery of the same event changes nothing", async () => {
      const { groupId } = await seedGroup(sql)
      await billing.applyEvent(event({ id: "evt_b1", reference: groupId, customerId: "cus_b" }))
      const sequence = await nextSequence(sql, groupId)

      const again = await billing.applyEvent(
        event({
          id: "evt_b1",
          reference: groupId,
          customerId: "cus_b",
          type: BillingEventType.SubscriptionCanceled,
          status: SubscriptionStatus.Canceled,
          at: new Date(T0.getTime() + 60_000),
        }),
      )

      expect(again).toBe("duplicate")
      expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Active)
      expect(await nextSequence(sql, groupId)).toBe(sequence)
      expect(await planChanges(sql, groupId)).toHaveLength(1)
    })

    await t.step("an event older than the stored one never rolls the plan back", async () => {
      const { groupId } = await seedGroup(sql)
      await billing.applyEvent(
        event({
          id: "evt_c2",
          reference: groupId,
          customerId: "cus_c",
          type: BillingEventType.SubscriptionUpdated,
          status: SubscriptionStatus.PastDue,
          at: new Date(T0.getTime() + 60_000),
        }),
      )

      const late = await billing.applyEvent(
        event({ id: "evt_c1", reference: groupId, customerId: "cus_c", at: T0 }),
      )

      expect(late).toBe("stale")
      expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.PastDue)
      expect(await planChanges(sql, groupId)).toHaveLength(1)
    })

    await t.step(
      "within one second, a creation arriving after the cancellation does not revive it",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(
          event({
            id: "evt_d2",
            reference: groupId,
            customerId: "cus_d",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
          }),
        )

        const late = await billing.applyEvent(
          event({ id: "evt_d1", reference: groupId, customerId: "cus_d" }),
        )

        expect(late).toBe("stale")
        expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Canceled)
      },
    )

    await t.step(
      "a later event without the checkout's reference finds the group by its customer",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(event({ id: "evt_e1", reference: groupId, customerId: "cus_e" }))

        const outcome = await billing.applyEvent(
          event({
            id: "evt_e2",
            reference: null,
            customerId: "cus_e",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 60_000),
          }),
        )

        expect(outcome).toBe("applied")
        expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.Canceled)
      },
    )

    await t.step(
      "the end of a group's old subscription does not end the new one that replaced it",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(
          event({
            id: "evt_f1",
            reference: groupId,
            customerId: "cus_f",
            subscriptionId: "sub_new",
          }),
        )

        const outcome = await billing.applyEvent(
          event({
            id: "evt_f2",
            reference: groupId,
            customerId: "cus_f",
            subscriptionId: "sub_old",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 60_000),
          }),
        )

        expect(outcome).toBe("stale")
        expect(await billing.get(groupId)).toMatchObject({
          providerSubscriptionId: "sub_new",
          status: SubscriptionStatus.Active,
        })
      },
    )

    await t.step("an event that names no group of this app is kept and ignored", async () => {
      const outcome = await billing.applyEvent(
        event({ id: "evt_g1", reference: uuidV7(), customerId: "cus_unknown" }),
      )
      const payment: BillingEvent = {
        id: "evt_g2",
        type: BillingEventType.PaymentSucceeded,
        occurredAt: T0,
        payment: {
          invoiceId: "in_1",
          customerId: "cus_unknown",
          subscriptionId: null,
          amount: 900,
          currency: "EUR",
          decimals: 2,
        },
      }

      expect(outcome).toBe("ignored")
      expect(await billing.applyEvent(payment)).toBe("ignored")
      expect(await billing.applyEvent(payment)).toBe("duplicate")
    })

    await t.step(
      "a failure while applying rolls back the stored event id, so the retry applies in full",
      async () => {
        const { groupId } = await seedGroup(sql)
        await sql`
          ALTER TABLE billing_customers
          ADD CONSTRAINT test_refuse_customer CHECK (provider_customer_id <> 'cus_refused')
        `
        try {
          await expect(
            billing.applyEvent(
              event({ id: "evt_h1", reference: groupId, customerId: "cus_refused" }),
            ),
          ).rejects.toThrow()
        } finally {
          await sql`ALTER TABLE billing_customers DROP CONSTRAINT test_refuse_customer`
        }

        expect(await billing.get(groupId)).toBeNull()
        expect(
          await billing.applyEvent(
            event({ id: "evt_h1", reference: groupId, customerId: "cus_refused" }),
          ),
        ).toBe("applied")
      },
    )

    await t.step(
      "the owner check reads the role as group writes do: a removed member and a deleted group get none",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const editor = (await sql<{ id: number }[]>`
          WITH auth_user AS (INSERT INTO auth_users DEFAULT VALUES RETURNING id)
          INSERT INTO users (id) SELECT id FROM auth_user RETURNING id
        `)[0].id
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${groupId}, ${editor}, ${GroupRole.EDITOR}, ${owner})
        `

        const before = [
          await billing.lockedRoleOf(groupId, owner),
          await billing.lockedRoleOf(groupId, editor),
        ]
        await sql`DELETE FROM group_members WHERE group_id = ${groupId} AND user_id = ${editor}`
        const removed = await billing.lockedRoleOf(groupId, editor)
        await sql`UPDATE groups SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${groupId}`
        const deleted = await billing.lockedRoleOf(groupId, owner)

        expect(before).toEqual([GroupRole.OWNER, GroupRole.EDITOR])
        expect([removed, deleted]).toEqual([null, null])
      },
    )

    await t.step(
      "within one second, two updates of the same kind: the one that arrives last wins",
      async () => {
        const { groupId } = await seedGroup(sql)
        const update = (id: string, status: SubscriptionStatus) =>
          event({
            id,
            reference: groupId,
            customerId: "cus_i",
            type: BillingEventType.SubscriptionUpdated,
            status,
          })
        await billing.applyEvent(update("evt_i1", SubscriptionStatus.Active))

        const last = await billing.applyEvent(update("evt_i2", SubscriptionStatus.PastDue))

        expect(last).toBe("applied")
        expect((await billing.get(groupId))?.status).toBe(SubscriptionStatus.PastDue)
      },
    )

    await t.step(
      "a renewal that changes neither plan nor status writes no plan-changed event",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(event({ id: "evt_j1", reference: groupId, customerId: "cus_j" }))
        const sequence = await nextSequence(sql, groupId)

        const renewed = await billing.applyEvent(
          event({
            id: "evt_j2",
            reference: groupId,
            customerId: "cus_j",
            type: BillingEventType.SubscriptionUpdated,
            at: new Date(T0.getTime() + 60_000),
            currentPeriodEnd: new Date("2026-12-01T10:00:00Z"),
          }),
        )
        const afterRenewal = [await planChanges(sql, groupId), await nextSequence(sql, groupId)]
        await billing.applyEvent(
          event({
            id: "evt_j3",
            reference: groupId,
            customerId: "cus_j",
            type: BillingEventType.SubscriptionUpdated,
            at: new Date(T0.getTime() + 120_000),
            status: SubscriptionStatus.PastDue,
          }),
        )

        expect(renewed).toBe("applied")
        expect(afterRenewal).toEqual([[expect.anything()], sequence])
        expect(await planChanges(sql, groupId)).toHaveLength(2)
      },
    )

    await t.step(
      "a customer another group holds stays with it, and the event still applies",
      async () => {
        const first = await seedGroup(sql)
        const second = await seedGroup(sql)
        await billing.applyEvent(
          event({ id: "evt_k1", reference: first.groupId, customerId: "cus_k" }),
        )

        const outcome = await billing.applyEvent(
          event({
            id: "evt_k2",
            reference: second.groupId,
            customerId: "cus_k",
            subscriptionId: "sub_k2",
          }),
        )

        expect(outcome).toBe("applied")
        expect(await billing.customerOf(first.groupId)).toBe("cus_k")
        expect(await billing.customerOf(second.groupId)).toBeNull()
        await expect(
          sql`
            INSERT INTO billing_customers (group_id, provider_customer_id)
            VALUES (${second.groupId}, 'cus_k')
          `,
        ).rejects.toThrow("idx_billing_customers_provider_customer_id")
      },
    )

    await t.step(
      "a group with a live subscription cannot be deleted until the subscription is cancelled",
      async () => {
        const { groupId, owner } = await seedGroup(sql)
        const groups = new PostgresGroupRepository(sql)
        await groups.create({ id: uuidV7(), name: "Other" }, owner)
        await billing.applyEvent(event({ id: "evt_l1", reference: groupId, customerId: "cus_l" }))

        const refused = await groups.softDelete(groupId, owner).catch((error) => error)
        await billing.applyEvent(
          event({
            id: "evt_l2",
            reference: groupId,
            customerId: "cus_l",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 60_000),
          }),
        )
        const deleted = await groups.softDelete(groupId, owner)

        expect(refused).toBeInstanceOf(GroupError)
        expect(refused.code).toBe("GROUP_SUBSCRIBED")
        expect(deleted?.id).toBe(groupId)
      },
    )

    await t.step(
      "the first past-due event starts the grace period, a later one keeps it, a payment clears it",
      async () => {
        const { groupId } = await seedGroup(sql)
        const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)
        const days = (n: number) => minutes(n * 24 * 60)
        const update = (id: string, status: SubscriptionStatus, at: Date) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_m",
              type: BillingEventType.SubscriptionUpdated,
              status,
              at,
            }),
          )
        const planAt = async (now: Date) => effectivePlanId(await billing.get(groupId), now, 7)
        await billing.applyEvent(event({ id: "evt_m1", reference: groupId, customerId: "cus_m" }))

        await update("evt_m2", SubscriptionStatus.PastDue, minutes(1))
        // Stripe's `unpaid`, two days later, arrives as past due too.
        await update("evt_m3", SubscriptionStatus.PastDue, days(2))
        const marked = await billing.get(groupId)
        const plans = [
          await planAt(new Date(minutes(1).getTime() + 7 * 24 * 60 * 60_000 - 1)),
          await planAt(new Date(minutes(1).getTime() + 7 * 24 * 60 * 60_000)),
        ]
        await update("evt_m4", SubscriptionStatus.Active, days(9))
        const paid = await billing.get(groupId)
        const planAfterPayment = await planAt(days(9))
        await update("evt_m5", SubscriptionStatus.PastDue, days(40))

        expect(marked).toMatchObject({
          status: SubscriptionStatus.PastDue,
          pastDueSince: minutes(1),
        })
        expect(plans).toEqual([PRO_PLAN_ID, FREE_PLAN_ID])
        expect(paid).toMatchObject({ status: SubscriptionStatus.Active, pastDueSince: null })
        expect(planAfterPayment).toBe(PRO_PLAN_ID)
        expect((await billing.get(groupId))?.pastDueSince).toEqual(days(40))
      },
    )

    await t.step(
      "a trial whose first charge fails is on the free plan from the trial's end, with no grace",
      async () => {
        const { groupId } = await seedGroup(sql)
        const trialEnd = new Date(T0.getTime() + 14 * 24 * 60 * 60_000)
        const trial = (
          id: string,
          type: SubscriptionEvent["type"],
          status: SubscriptionStatus,
          at: Date,
        ) =>
          billing.applyEvent(
            event({ id, reference: groupId, customerId: "cus_tf", type, status, at, trialEnd }),
          )
        await trial(
          "evt_tf1",
          BillingEventType.SubscriptionCreated,
          SubscriptionStatus.Trialing,
          T0,
        )
        const planAt = async (now: Date) => effectivePlanId(await billing.get(groupId), now, 7)
        const duringTrial = await planAt(new Date(trialEnd.getTime() - 1))

        // Stripe charges at the trial's end; the charge fails and the subscription goes past due.
        await trial(
          "evt_tf2",
          BillingEventType.SubscriptionUpdated,
          SubscriptionStatus.PastDue,
          trialEnd,
        )

        expect(duringTrial).toBe(PRO_PLAN_ID)
        expect(await billing.get(groupId)).toMatchObject({
          status: SubscriptionStatus.PastDue,
          pastDueSince: trialEnd,
          everActive: false,
        })
        expect(await planAt(trialEnd)).toBe(FREE_PLAN_ID)
        expect(await planAt(new Date(trialEnd.getTime() + 24 * 60 * 60_000))).toBe(FREE_PLAN_ID)
      },
    )

    await t.step(
      "a subscription that was active and then goes past due keeps the grace period",
      async () => {
        const { groupId } = await seedGroup(sql)
        const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60_000)
        const trialEnd = day(14)
        const update = (id: string, status: SubscriptionStatus, at: Date) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_ta",
              type: BillingEventType.SubscriptionUpdated,
              status,
              at,
              trialEnd,
            }),
          )
        await billing.applyEvent(
          event({
            id: "evt_ta1",
            reference: groupId,
            customerId: "cus_ta",
            status: SubscriptionStatus.Trialing,
            trialEnd,
          }),
        )
        // The trial converts: the first charge goes through. The next month's renewal fails.
        await update("evt_ta2", SubscriptionStatus.Active, trialEnd)
        await update("evt_ta3", SubscriptionStatus.PastDue, day(44))
        const planAt = async (now: Date) => effectivePlanId(await billing.get(groupId), now, 7)

        expect(await billing.get(groupId)).toMatchObject({
          status: SubscriptionStatus.PastDue,
          everActive: true,
        })
        expect(await planAt(new Date(day(51).getTime() - 1))).toBe(PRO_PLAN_ID)
        expect(await planAt(day(51))).toBe(FREE_PLAN_ID)
      },
    )

    await t.step(
      "an active event delivered after a newer past-due one still earns the grace period",
      async () => {
        const { groupId } = await seedGroup(sql)
        const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60_000)
        const update = (id: string, status: SubscriptionStatus, at: Date) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_tl",
              type: BillingEventType.SubscriptionUpdated,
              status,
              at,
            }),
          )
        await billing.applyEvent(
          event({
            id: "evt_tl1",
            reference: groupId,
            customerId: "cus_tl",
            status: SubscriptionStatus.Trialing,
          }),
        )
        await update("evt_tl3", SubscriptionStatus.PastDue, day(44))

        const late = await update("evt_tl2", SubscriptionStatus.Active, day(14))

        expect(late).toBe("stale")
        expect(await billing.get(groupId)).toMatchObject({
          status: SubscriptionStatus.PastDue,
          pastDueSince: day(44),
          everActive: true,
        })
        expect(effectivePlanId(await billing.get(groupId), day(50), 7)).toBe(PRO_PLAN_ID)
      },
    )

    await t.step(
      "a new subscription does not inherit the old one's payment: its failed trial gets no grace",
      async () => {
        const { groupId } = await seedGroup(sql)
        const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60_000)
        const apply = (
          id: string,
          subscriptionId: string,
          type: SubscriptionEvent["type"],
          status: SubscriptionStatus,
          at: Date,
        ) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_ti",
              subscriptionId,
              type,
              status,
              at,
            }),
          )
        await apply(
          "evt_ti1",
          "sub_ti_a",
          BillingEventType.SubscriptionCreated,
          SubscriptionStatus.Active,
          T0,
        )
        await apply(
          "evt_ti2",
          "sub_ti_a",
          BillingEventType.SubscriptionCanceled,
          SubscriptionStatus.Canceled,
          day(30),
        )
        await apply(
          "evt_ti3",
          "sub_ti_b",
          BillingEventType.SubscriptionCreated,
          SubscriptionStatus.Trialing,
          day(40),
        )

        await apply(
          "evt_ti4",
          "sub_ti_b",
          BillingEventType.SubscriptionUpdated,
          SubscriptionStatus.PastDue,
          day(54),
        )

        expect(await billing.get(groupId)).toMatchObject({
          providerSubscriptionId: "sub_ti_b",
          status: SubscriptionStatus.PastDue,
          everActive: false,
        })
        expect(effectivePlanId(await billing.get(groupId), day(54), 7)).toBe(FREE_PLAN_ID)
      },
    )

    await t.step(
      "a late active event of an old subscription does not earn grace for the new one's failed trial",
      async () => {
        const { groupId } = await seedGroup(sql)
        const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60_000)
        const apply = (
          id: string,
          subscriptionId: string,
          type: SubscriptionEvent["type"],
          status: SubscriptionStatus,
          at: Date,
        ) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_tx",
              subscriptionId,
              type,
              status,
              at,
            }),
          )
        const { SubscriptionCreated: created, SubscriptionUpdated: updated } = BillingEventType
        await apply("evt_tx1", "sub_tx_a", created, SubscriptionStatus.Trialing, T0)
        await apply(
          "evt_tx2",
          "sub_tx_a",
          BillingEventType.SubscriptionCanceled,
          SubscriptionStatus.Canceled,
          day(30),
        )
        await apply("evt_tx3", "sub_tx_b", created, SubscriptionStatus.Trialing, day(40))
        await apply("evt_tx4", "sub_tx_b", updated, SubscriptionStatus.PastDue, day(54))

        // Subscription A's payment, from before its cancellation, is delivered only now.
        const late = await apply("evt_tx5", "sub_tx_a", updated, SubscriptionStatus.Active, day(14))

        expect(late).toBe("stale")
        expect(await billing.get(groupId)).toMatchObject({
          providerSubscriptionId: "sub_tx_b",
          status: SubscriptionStatus.PastDue,
          everActive: false,
        })
        expect(effectivePlanId(await billing.get(groupId), day(54), 7)).toBe(FREE_PLAN_ID)
      },
    )

    await t.step(
      "a new subscription that follows a past-due one does not inherit its grace start",
      async () => {
        const { groupId } = await seedGroup(sql)
        await billing.applyEvent(
          event({
            id: "evt_n1",
            reference: groupId,
            customerId: "cus_n",
            status: SubscriptionStatus.PastDue,
          }),
        )
        await billing.applyEvent(
          event({
            id: "evt_n1b",
            reference: groupId,
            customerId: "cus_n",
            type: BillingEventType.SubscriptionCanceled,
            status: SubscriptionStatus.Canceled,
            at: new Date(T0.getTime() + 24 * 60 * 60_000),
          }),
        )
        const later = new Date(T0.getTime() + 5 * 24 * 60 * 60_000)

        await billing.applyEvent(
          event({
            id: "evt_n2",
            reference: groupId,
            customerId: "cus_n",
            subscriptionId: "sub_n2",
            status: SubscriptionStatus.PastDue,
            at: later,
          }),
        )

        expect(await billing.get(groupId)).toMatchObject({
          providerSubscriptionId: "sub_n2",
          pastDueSince: later,
        })
      },
    )

    await t.step(
      "a late failed payment of an old subscription never replaces the newer one that pays",
      async () => {
        const { groupId } = await seedGroup(sql)
        const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
        const apply = (
          id: string,
          subscriptionId: string,
          status: SubscriptionStatus,
          when: Date,
        ) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_p",
              subscriptionId,
              type: BillingEventType.SubscriptionUpdated,
              status,
              at: when,
            }),
          )

        await apply("evt_p1", "sub_a", SubscriptionStatus.PastDue, at(1))
        const paid = await apply("evt_p2", "sub_b", SubscriptionStatus.Active, at(2))
        const late = await apply("evt_p3", "sub_a", SubscriptionStatus.PastDue, at(3))

        expect([paid, late]).toEqual(["applied", "stale"])
        const held = await billing.get(groupId)
        expect(held).toMatchObject({
          providerSubscriptionId: "sub_b",
          status: SubscriptionStatus.Active,
          pastDueSince: null,
        })
        expect(effectivePlanId(held, at(60 * 24 * 30), 7)).toBe(PRO_PLAN_ID)
      },
    )

    await t.step(
      "a new subscription that pays replaces an active one, and the old one's end changes nothing",
      async () => {
        const { groupId } = await seedGroup(sql)
        const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)
        const apply = (
          id: string,
          subscriptionId: string,
          type: SubscriptionEvent["type"],
          status: SubscriptionStatus,
          when: Date,
        ) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_x",
              subscriptionId,
              type,
              status,
              at: when,
            }),
          )

        await apply(
          "evt_x1",
          "sub_a",
          BillingEventType.SubscriptionCreated,
          SubscriptionStatus.Active,
          at(1),
        )
        const replaced = await apply(
          "evt_x2",
          "sub_b",
          BillingEventType.SubscriptionCreated,
          SubscriptionStatus.Active,
          at(2),
        )
        const oldEnd = await apply(
          "evt_x3",
          "sub_a",
          BillingEventType.SubscriptionCanceled,
          SubscriptionStatus.Canceled,
          at(3),
        )

        expect([replaced, oldEnd]).toEqual(["applied", "stale"])
        const held = await billing.get(groupId)
        expect(held).toMatchObject({
          providerSubscriptionId: "sub_b",
          status: SubscriptionStatus.Active,
        })
        expect(effectivePlanId(held, at(60), 7)).toBe(PRO_PLAN_ID)
      },
    )

    await t.step(
      "a trial keeps its plan until the end it was stored with, then gives the free plan",
      async () => {
        const { groupId } = await seedGroup(sql)
        const trialEnd = new Date("2026-10-15T10:00:00Z")
        await billing.applyEvent(
          event({
            id: "evt_q1",
            reference: groupId,
            customerId: "cus_q",
            status: SubscriptionStatus.Trialing,
            trialEnd,
          }),
        )
        const held = await billing.get(groupId)

        expect(held?.trialEnd).toEqual(trialEnd)
        expect(effectivePlanId(held, new Date(trialEnd.getTime() - 1), 7)).toBe(PRO_PLAN_ID)
        expect(effectivePlanId(held, trialEnd, 7)).toBe(FREE_PLAN_ID)
      },
    )

    await t.step(
      "a cancellation keeps the plan until the period ends, and undoing it keeps the plan after",
      async () => {
        const { groupId } = await seedGroup(sql)
        const periodEnd = new Date("2026-11-01T10:00:00Z")
        const update = (id: string, cancelAtPeriodEnd: boolean, minutes: number) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_r",
              type: BillingEventType.SubscriptionUpdated,
              cancelAtPeriodEnd,
              currentPeriodEnd: periodEnd,
              at: new Date(T0.getTime() + minutes * 60_000),
            }),
          )
        await update("evt_r1", false, 0)

        await update("evt_r2", true, 1)
        const cancelled = await billing.get(groupId)
        await update("evt_r3", false, 2)
        const renewed = await billing.get(groupId)

        expect(effectivePlanId(cancelled, new Date(periodEnd.getTime() - 1), 7)).toBe(PRO_PLAN_ID)
        expect(effectivePlanId(cancelled, periodEnd, 7)).toBe(FREE_PLAN_ID)
        expect(effectivePlanId(renewed, periodEnd, 7)).toBe(PRO_PLAN_ID)
      },
    )

    await t.step(
      "queues each owner's mail once: a failed payment, a cancellation, and each end of a trial",
      async () => {
        const { groupId } = await seedGroup(sql)
        const trialEnd = new Date("2026-10-15T10:00:00Z")
        const extendedEnd = new Date("2026-10-16T10:00:00Z")
        const apply = (
          id: string,
          minutes: number,
          changes: { status?: SubscriptionStatus; cancelAtPeriodEnd?: boolean; trialEnd?: Date },
        ) =>
          billing.applyEvent(
            event({
              id,
              reference: groupId,
              customerId: "cus_s",
              type: BillingEventType.SubscriptionUpdated,
              at: new Date(T0.getTime() + minutes * 60_000),
              ...changes,
            }),
          )

        await apply("evt_s1", 0, { status: SubscriptionStatus.Trialing, trialEnd })
        await apply("evt_s2", 1, { status: SubscriptionStatus.Trialing, trialEnd })
        // The trial is extended by a day, then set back: its first end is queued once.
        await apply("evt_s3", 2, { status: SubscriptionStatus.Trialing, trialEnd: extendedEnd })
        await apply("evt_s4", 3, { status: SubscriptionStatus.Trialing, trialEnd })
        await apply("evt_s5", 4, { status: SubscriptionStatus.PastDue })
        await apply("evt_s6", 5, { status: SubscriptionStatus.PastDue })
        await apply("evt_s7", 6, { cancelAtPeriodEnd: true })
        await apply("evt_s8", 7, { cancelAtPeriodEnd: true })

        const jobs = await sql<{ eventKind: string; availableAt: Date }[]>`
          SELECT event_kind, available_at FROM outbox_events
          WHERE aggregate_id = ${groupId} AND aggregate_type = ${JOB_AGGREGATE}
          ORDER BY available_at
        `
        expectVersion7Ids(
          await sql<{ id: string }[]>`
            SELECT id FROM outbox_events
            WHERE aggregate_id = ${groupId} AND aggregate_type = ${JOB_AGGREGATE}
          `,
        )
        expect(jobs).toEqual([
          {
            eventKind: BILLING_NOTICE_JOBS[BillingNoticeKind.PaymentFailed],
            availableAt: new Date(T0.getTime() + 4 * 60_000),
          },
          {
            eventKind: BILLING_NOTICE_JOBS[BillingNoticeKind.PlanEnding],
            availableAt: new Date(T0.getTime() + 6 * 60_000),
          },
          {
            eventKind: BILLING_NOTICE_JOBS[BillingNoticeKind.TrialEnding],
            availableAt: new Date("2026-10-12T10:00:00Z"),
          },
          {
            eventKind: BILLING_NOTICE_JOBS[BillingNoticeKind.TrialEnding],
            availableAt: new Date("2026-10-13T10:00:00Z"),
          },
        ])
      },
    )

    await t.step(
      "the database refuses a past-due subscription without a grace start, and a start on any other",
      async () => {
        const { groupId } = await seedGroup(sql)
        const insert = (status: SubscriptionStatus, since: Date | null) =>
          sql`
            INSERT INTO subscriptions (group_id, provider_subscription_id, plan_id, status,
              provider_event_at, provider_event_rank, past_due_since)
            VALUES (${groupId}, 'sub_o', 'pro', ${status}, ${T0}, 1, ${since})
          `

        await expect(insert(SubscriptionStatus.PastDue, null))
          .rejects.toThrow("subscriptions_past_due_since_check")
        await expect(insert(SubscriptionStatus.Active, T0))
          .rejects.toThrow("subscriptions_past_due_since_check")
      },
    )
  })
})

/** A new user who signs in with `email`, proven unless `proven` is false, and the group they own. */
async function seedOwnerWithAddress(
  sql: postgres.Sql,
  email: string,
  proven = true,
): Promise<{ groupId: string; owner: number }> {
  const seeded = await seedGroup(sql)
  if (proven) {
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES (${email}, ${seeded.owner})`
  }
  await sql`
    INSERT INTO auth_keys (user_id, method, subject, email, secret, proven_at)
    VALUES (${seeded.owner}, 'password', ${email}, ${email}, 'hash', ${proven ? new Date() : null})
  `
  return seeded
}

/** A sender that keeps what it is given. */
function recordingSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    send(message: EmailMessage) {
      sent.push(message)
      return Promise.resolve({ ok: true as const, id: String(sent.length) })
    },
  } as unknown as EmailSender & { sent: EmailMessage[] }
}

Deno.test("billing notices reach the owner through the worker's queue", async (t) => {
  await withSchema(async (sql) => {
    const billing = new PostgresBillingRepository(sql)
    const DAY = 24 * 60 * 60_000
    const start = new Date()
    let tick = 0
    /** One webhook event for the group, a millisecond after the one before. */
    const apply = (
      groupId: string,
      changes: {
        status?: SubscriptionStatus
        cancelAtPeriodEnd?: boolean
        trialEnd?: Date
        currentPeriodEnd?: Date
      },
    ) =>
      billing.applyEvent(
        event({
          id: `evt_mail_${++tick}`,
          reference: groupId,
          customerId: `cus_${groupId}`,
          type: BillingEventType.SubscriptionUpdated,
          at: new Date(start.getTime() + tick),
          currentPeriodEnd: new Date(start.getTime() + 20 * DAY),
          ...changes,
        }),
      )

    await t.step(
      "sends each notice still in force when its job runs, and nothing for one that no longer is or for a deleted group",
      async () => {
        const trial = await seedOwnerWithAddress(sql, "trial@example.com")
        const ending = await seedOwnerWithAddress(sql, "ending@example.com")
        const failed = await seedOwnerWithAddress(sql, "failed@example.com")
        const renewal = await seedOwnerWithAddress(sql, "renewal@example.com")
        const undone = await seedOwnerWithAddress(sql, "undone@example.com")
        const moved = await seedOwnerWithAddress(sql, "moved@example.com")
        const silent = await seedOwnerWithAddress(sql, "silent@example.com", false)
        const gone = await seedOwnerWithAddress(sql, "gone@example.com")
        const trialEnd = new Date(start.getTime() + 10 * DAY)
        await apply(trial.groupId, { status: SubscriptionStatus.Trialing, trialEnd })
        await apply(ending.groupId, { cancelAtPeriodEnd: true })
        // A trial whose first charge fails never was active; a renewal that fails was.
        await apply(failed.groupId, { status: SubscriptionStatus.Trialing, trialEnd })
        await apply(failed.groupId, { status: SubscriptionStatus.PastDue, trialEnd })
        await apply(renewal.groupId, { status: SubscriptionStatus.Active })
        await apply(renewal.groupId, { status: SubscriptionStatus.PastDue })
        await apply(undone.groupId, { cancelAtPeriodEnd: true })
        await apply(undone.groupId, { cancelAtPeriodEnd: false })
        // The trial is cut short by a day: both jobs are due, and only the one for the new end mails.
        const movedEnd = new Date(start.getTime() + 9 * DAY)
        await apply(moved.groupId, { status: SubscriptionStatus.Trialing, trialEnd })
        await apply(moved.groupId, { status: SubscriptionStatus.Trialing, trialEnd: movedEnd })
        await apply(silent.groupId, { status: SubscriptionStatus.PastDue })
        await apply(gone.groupId, { status: SubscriptionStatus.PastDue })
        // The group is deleted after its payment failed: its owner is told nothing.
        await sql`UPDATE groups SET deleted_at = now() WHERE id = ${gone.groupId}`
        // Eight days pass: the trial's notice, due three days before its end, is now claimable.
        await sql`
          UPDATE outbox_events SET available_at = available_at - make_interval(days => 8)
          WHERE aggregate_type = ${JOB_AGGREGATE}
        `
        const sender = recordingSender()
        const logged: string[] = []
        const processor = createOutboxProcessor(
          sql,
          {
            store: createPostgresAuthStore(sql),
            sender,
            brand: { webAppUrl: "http://app.localhost" },
            log: (line) => logged.push(line),
          },
          null,
          null,
          7,
        )

        const result = await processor.drainOnce()

        expect(result.failed).toBe(0)
        expect(sender.sent.map((mail) => [mail.to, mail.subject]).sort()).toEqual([
          ["ending@example.com", "Your Pro plan ends on " + longDate(start.getTime() + 20 * DAY)],
          ["failed@example.com", "A payment for Pro failed"],
          ["moved@example.com", "Your Pro trial ends on " + longDate(movedEnd.getTime())],
          ["renewal@example.com", "A payment for Pro failed"],
          ["trial@example.com", "Your Pro trial ends on " + longDate(trialEnd.getTime())],
        ])
        const textTo = (to: string) => sender.sent.find((mail) => mail.to === to)?.text
        expect(textTo("failed@example.com")).toContain("The group is now on the free plan.")
        const [{ pastDueSince }] = await sql<{ pastDueSince: Date }[]>`
          SELECT past_due_since FROM subscriptions WHERE group_id = ${renewal.groupId}
        `
        expect(textTo("renewal@example.com")).toContain(
          `The plan is kept until ${longDate(pastDueSince.getTime() + 7 * DAY)} while`,
        )
        expect(textTo("trial@example.com")).toContain(
          "The subscription then starts and is charged.",
        )
        expect(sender.sent.find((mail) => mail.to === "trial@example.com")?.text)
          .toContain(`http://app.localhost/groups/${trial.groupId}`)
        expect(logged).toEqual([
          "warn: a billing notice was not sent: the group's owner has no proven address",
        ])
      },
    )

    await t.step(
      "with no grace days and trials without a card, the mails promise neither a grace nor a charge",
      async () => {
        await sql`DELETE FROM outbox_events WHERE aggregate_type = ${JOB_AGGREGATE}`
        const cardless = await seedOwnerWithAddress(sql, "cardless@example.com")
        const lapsed = await seedOwnerWithAddress(sql, "lapsed@example.com")
        const trialEnd = new Date(start.getTime() + 10 * DAY)
        await apply(cardless.groupId, { status: SubscriptionStatus.Trialing, trialEnd })
        // A renewal that fails after the plan was paid for: with a grace it would keep the plan.
        await apply(lapsed.groupId, { status: SubscriptionStatus.Active })
        await apply(lapsed.groupId, { status: SubscriptionStatus.PastDue })
        await sql`
          UPDATE outbox_events SET available_at = available_at - make_interval(days => 8)
          WHERE aggregate_type = ${JOB_AGGREGATE}
        `
        const sender = recordingSender()
        const processor = createOutboxProcessor(
          sql,
          {
            store: createPostgresAuthStore(sql),
            sender,
            brand: { webAppUrl: "http://app.localhost" },
            log: () => {},
          },
          null,
          null,
          0,
          false,
        )

        expect((await processor.drainOnce()).failed).toBe(0)

        const textTo = (to: string) => sender.sent.find((mail) => mail.to === to)?.text
        expect(textTo("lapsed@example.com")).toContain("The group is now on the free plan.")
        expect(textTo("lapsed@example.com")).not.toContain("is kept")
        expect(textTo("cardless@example.com")).toContain(
          "Without a card, the group moves to the free plan.",
        )
        expect(textTo("cardless@example.com")).not.toContain("To stop it, cancel it")
      },
    )

    await t.step(
      "a failed payment on a cancelled plan names the end of the paid period when it comes before the grace ends",
      async () => {
        await sql`DELETE FROM outbox_events WHERE aggregate_type = ${JOB_AGGREGATE}`
        const leaving = await seedOwnerWithAddress(sql, "leaving@example.com")
        const periodEnd = new Date(start.getTime() + 3 * DAY)
        await apply(leaving.groupId, { status: SubscriptionStatus.Active })
        await apply(leaving.groupId, {
          status: SubscriptionStatus.PastDue,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: periodEnd,
        })
        await sql`
          UPDATE outbox_events SET available_at = now() WHERE aggregate_type = ${JOB_AGGREGATE}
        `
        const sender = recordingSender()
        const processor = createOutboxProcessor(
          sql,
          {
            store: createPostgresAuthStore(sql),
            sender,
            brand: { webAppUrl: "http://app.localhost" },
            log: () => {},
          },
          null,
          null,
          7,
        )

        expect((await processor.drainOnce()).failed).toBe(0)

        const failed = sender.sent.find((mail) => mail.subject === "A payment for Pro failed")
        expect(failed?.to).toBe("leaving@example.com")
        expect(failed?.text).toContain(
          `The plan is kept until ${longDate(periodEnd.getTime())} while`,
        )
      },
    )
  })
})

function longDate(ms: number): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(new Date(ms))
}

Deno.test("one billing trial per person against Postgres", async (t) => {
  await withSchema(async (sql) => {
    const billing = new PostgresBillingRepository(sql)

    await t.step(
      "two checkouts of two groups at once give the person's trial to one of them only",
      async () => {
        const { groupId: first, owner } = await seedGroup(sql)
        const second = uuidV7()
        await new PostgresGroupRepository(sql).create({ id: second, name: "Second" }, owner)

        const claims = await Promise.all([
          billing.claimTrial(owner, first),
          billing.claimTrial(owner, second),
        ])

        expect(claims.filter(Boolean)).toHaveLength(1)
        const winner = claims[0] ? first : second
        expect(await billing.claimTrial(owner, winner)).toBe(true)
        expect(await billing.claimTrial(owner, winner === first ? second : first)).toBe(false)
        expect(await billing.trialGroupOf(owner)).toBe(winner)
      },
    )

    await t.step(
      "a person invited into a group whose trial is used still has their own",
      async () => {
        const { groupId: shared, owner } = await seedGroup(sql)
        const { groupId: own, owner: invited } = await seedGroup(sql)
        await sql`
          INSERT INTO group_members (group_id, user_id, role, added_by_user_id)
          VALUES (${shared}, ${invited}, ${GroupRole.ADMIN}, ${owner})
        `
        expect(await billing.claimTrial(owner, shared)).toBe(true)

        expect(await billing.trialGroupOf(invited)).toBeNull()
        expect(await billing.claimTrial(invited, own)).toBe(true)
      },
    )
  })
})
