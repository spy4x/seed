/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import {
  BillingEventType,
  type BillingProvider,
  type Subscription,
  SubscriptionStatus,
} from "@spy4x/billing"
import { PRO_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { queueSeatDrift, queueSeatSync, SEAT_SYNC_JOB } from "@server/billing/seat-sync.ts"
import {
  invitationLookup,
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { insertUser, team, withSchema } from "./group-team.ts"
import { expectVersion7Ids } from "./ids.ts"

/**
 * Per-member billing (#205) against a real Postgres built from schema.sql, with the worker's outbox
 * processor and a fake provider that can be down. Needs "DB_HOST", "DB_USER", "DB_PASS" and
 * "DB_NAME" (recipe in docs/handoff.md); it fails when they are missing.
 */

type QuantityRequest = Parameters<BillingProvider["updateQuantity"]>[0]

/** A provider that records each seat change and answers it, or fails while it is down. */
function fakeProvider() {
  const calls: QuantityRequest[] = []
  const state = { down: false }
  const provider = {
    updateQuantity(request: QuantityRequest) {
      calls.push(request)
      if (state.down) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "network_error" as const, message: "down", status: null },
        })
      }
      const subscription: Subscription = {
        id: request.subscriptionId,
        customerId: "cus_1",
        status: SubscriptionStatus.Active,
        planId: PRO_PLAN_ID,
        priceId: "price_pro",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEnd: null,
        quantity: request.quantity,
        reference: null,
      }
      return Promise.resolve({ ok: true as const, value: subscription })
    },
  } as unknown as BillingProvider
  return { provider, calls, state }
}

const NO_LIMITS = { maxMembers: null, memberRoles: true }

let eventCount = 0

/** Puts the group on Pro the way a webhook does, billing `quantity` seats. */
async function subscribe(
  sql: postgres.Sql,
  groupId: string,
  quantity: number,
  status = SubscriptionStatus.Active,
): Promise<void> {
  eventCount++
  await new PostgresBillingRepository(sql).applyEvent({
    id: `evt_seat_${eventCount}`,
    type: BillingEventType.SubscriptionUpdated,
    occurredAt: new Date(Date.now() + eventCount),
    subscription: {
      id: `sub_${groupId}`,
      customerId: `cus_${groupId}`,
      status,
      planId: PRO_PLAN_ID,
      priceId: "price_pro",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      quantity,
      reference: groupId,
    },
  })
}

/** Lets a person join through a new invitation the owner made, as the API does. */
async function join(sql: postgres.Sql, groupId: string, owner: number): Promise<number> {
  const invitations = new PostgresInvitationRepository(sql)
  const token = newInvitationToken()
  await invitations.create(
    {
      groupId,
      role: GroupRole.EDITOR,
      expiresInDays: 7,
      maxUses: 1,
      email: null,
      tokenHash: await sha256Hex(token),
    },
    owner,
    NO_LIMITS,
  )
  const person = await insertUser(sql)
  await invitations.accept(await invitationLookup({ token }), person, NO_LIMITS)
  return person
}

async function storedQuantity(sql: postgres.Sql, groupId: string): Promise<number | null> {
  return (await sql<{ quantity: number | null }[]>`
    SELECT quantity FROM subscriptions WHERE group_id = ${groupId}
  `)[0].quantity
}

async function queuedSyncs(sql: postgres.Sql, groupId: string): Promise<number> {
  return (await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM outbox_events
    WHERE event_kind = ${SEAT_SYNC_JOB} AND aggregate_id = ${groupId} AND processed_at IS NULL
  `)[0].count
}

/** Runs the worker until nothing more is due: a group change queues its seat sync on the way. */
async function drain(processor: ReturnType<typeof createOutboxProcessor>) {
  let failed = 0
  for (let round = 0; round < 3; round++) failed += (await processor.drainOnce()).failed
  return failed
}

const NO_MAIL = {
  store: {} as never,
  sender: { send: () => Promise.reject(new Error("no mail in these tests")) },
  brand: { webAppUrl: "http://app.localhost" },
  log: () => {},
}

Deno.test("seats of a group billed per member follow its members", async (t) => {
  await withSchema(async (sql) => {
    const { provider, calls, state } = fakeProvider()
    const processor = createOutboxProcessor(sql, NO_MAIL, provider)
    // Owner, admin, editor, viewer and "onlyHere": five members.
    const { repository, groupId, owner, editor, viewer } = await team(sql)

    await t.step("a webhook that reports the member count queues no seat change", async () => {
      await subscribe(sql, groupId, 5)

      expect(await queuedSyncs(sql, groupId)).toBe(0)
      expect(await drain(processor)).toBe(0)
      expect(calls).toEqual([])
    })

    await t.step("a seat change for a group already in step calls no provider", async () => {
      await queueSeatSync(sql, groupId)
      expectVersion7Ids(
        await sql<{ id: string }[]>`
          SELECT id FROM outbox_events
          WHERE event_kind = ${SEAT_SYNC_JOB} AND aggregate_id = ${groupId}
        `,
      )

      expect(await drain(processor)).toBe(0)
      expect(calls).toEqual([])
      expect(await queuedSyncs(sql, groupId)).toBe(0)
    })

    await t.step(
      "a member who joins raises the subscription's quantity by one at the provider",
      async () => {
        await join(sql, groupId, owner)

        expect(await drain(processor)).toBe(0)
        expect(calls.map((call) => [call.subscriptionId, call.quantity])).toEqual([
          [`sub_${groupId}`, 6],
        ])
        expect(calls[0].idempotencyKey).toMatch(/^seats:[0-9a-f-]{36}:6$/)
        expect(await storedQuantity(sql, groupId)).toBe(6)
      },
    )

    await t.step("a removed member and one who leaves each lower it by one", async () => {
      calls.length = 0
      await repository.removeMember(groupId, editor, owner)
      await drain(processor)
      expect(await storedQuantity(sql, groupId)).toBe(5)

      await repository.leave(groupId, viewer)
      await drain(processor)

      expect(calls.map((call) => call.quantity)).toEqual([5, 4])
      expect(await storedQuantity(sql, groupId)).toBe(4)
    })

    await t.step(
      "with the provider down the member still joins, and the quantity catches up when it is back",
      async () => {
        calls.length = 0
        state.down = true

        const person = await join(sql, groupId, owner)
        const failed = await drain(processor)

        expect(failed).toBeGreaterThan(0)
        expect(
          (await sql`
            SELECT 1 FROM group_members WHERE group_id = ${groupId} AND user_id = ${person}
          `).length,
        ).toBe(1)
        expect(await storedQuantity(sql, groupId)).toBe(4)

        state.down = false
        // The outbox's backoff passes.
        await sql`
          UPDATE outbox_events SET available_at = now() - interval '1 second'
          WHERE event_kind = ${SEAT_SYNC_JOB} AND processed_at IS NULL
        `
        expect(await drain(processor)).toBe(0)

        expect(calls.map((call) => call.quantity)).toEqual([5, 5])
        expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(1)
        expect(await storedQuantity(sql, groupId)).toBe(5)
      },
    )

    await t.step("a webhook that reports another quantity queues a seat change", async () => {
      calls.length = 0

      await subscribe(sql, groupId, 2)

      expect(await queuedSyncs(sql, groupId)).toBe(1)
      await drain(processor)
      expect(calls.map((call) => call.quantity)).toEqual([5])
      expect(await storedQuantity(sql, groupId)).toBe(5)
    })

    await t.step(
      "two seat changes that ask for the same count each reach the provider under their own key",
      async () => {
        calls.length = 0
        const person = await join(sql, groupId, owner)
        await drain(processor)
        await repository.removeMember(groupId, person, owner)
        await drain(processor)
        await join(sql, groupId, owner)
        await drain(processor)

        expect(calls.map((call) => call.quantity)).toEqual([6, 5, 6])
        expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(3)
        expect(await storedQuantity(sql, groupId)).toBe(6)
      },
    )

    await t.step("the nightly job queues a seat change for each drifted group", async () => {
      calls.length = 0
      const other = await team(sql)
      await subscribe(sql, other.groupId, 5)
      // A member's account is deleted: the count moves without a group change.
      await sql`UPDATE users SET deleted_at = now() WHERE id = ${other.editor}`

      // The nightly job, due now.
      // Started two days ago: its first 03:00 UTC run is due, and the next one it writes differs.
      await startRepeatingJobs(sql, new Date(Date.now() - 2 * 86_400_000))
      await sql`
        UPDATE outbox_events SET available_at = now() - interval '1 second'
        WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
      `
      await drain(processor)

      expect(calls.map((call) => [call.subscriptionId, call.quantity])).toEqual([
        [`sub_${other.groupId}`, 4],
      ])
      expect(await queueSeatDrift(sql)).toBe(0)
    })

    await t.step("a group whose subscription is canceled is not billed per member", async () => {
      calls.length = 0
      const other = await team(sql)
      // A webhook for a canceled subscription that bills another count queues no seat change.
      await subscribe(sql, other.groupId, 2, SubscriptionStatus.Canceled)
      expect(await queuedSyncs(sql, other.groupId)).toBe(0)

      await join(sql, other.groupId, other.owner)
      await drain(processor)

      expect(calls).toEqual([])
      expect(await queueSeatDrift(sql)).toBe(0)
    })
  })
})
