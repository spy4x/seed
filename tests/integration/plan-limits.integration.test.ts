/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { CommandBus } from "@spy4x/platform/cqrs"
import { BillingEventType, type SubscriptionEvent, SubscriptionStatus } from "@spy4x/billing"
import { DEFAULT_GRACE_DAYS, effectivePlanId, PlanError, PRO_PLAN_ID } from "@domain/billing"
import { UserMFAStatus } from "@domain/identity"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteRestoreCommand,
  NoteUpdateCommand,
} from "@domain/notes"
import { PostgresBillingRepository } from "@server/billing/postgres-billing-repository.ts"
import { PostgresNoteRepository } from "@server/notes/postgres-note-repository.ts"
import {
  createEntitlementGate,
  type EntitlementGateDependencies,
} from "../../apps/api/cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../apps/api/cqrs/entitlement-needs.ts"
import {
  createNoteCreateHandler,
  createNoteDeleteHandler,
  createNoteRestoreHandler,
  createNoteUpdateHandler,
} from "../../apps/api/features/notes/handlers.ts"
import { team, withSchema } from "./group-team.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/**
 * The free plan's cap on notes, enforced by the command bus's entitlement gate and the note
 * handlers on a real Postgres. Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in
 * docs/handoff.md); it fails when they are missing.
 */

const FREE_NOTES = 10

/** A bus wired as the API wires it: the gate on Postgres, then the real note handlers. */
function noteBus(sql: postgres.Sql, usage?: EntitlementGateDependencies["usage"]) {
  const notes = new PostgresNoteRepository(sql)
  const billing = new PostgresBillingRepository(sql)
  const groups = {
    roleOf: async (groupId: string, userId: number) =>
      (await sql<{ role: number }[]>`
        SELECT role FROM group_members WHERE group_id = ${groupId} AND user_id = ${userId}
      `)[0]?.role ?? null,
  }
  const bus = new CommandBus()
  bus.use(createEntitlementGate({
    billingEnabled: true,
    planOf: async (groupId) =>
      effectivePlanId(await billing.get(groupId), new Date(), DEFAULT_GRACE_DAYS),
    roleOf: groups.roleOf,
    usage: usage ?? {
      maxNotes: (groupId) => notes.count(groupId),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  bus.register(NoteCreateCommand, createNoteCreateHandler({ notes, groups }))
  bus.register(NoteUpdateCommand, createNoteUpdateHandler({ notes, groups }))
  bus.register(NoteDeleteCommand, createNoteDeleteHandler({ notes, groups }))
  bus.register(NoteRestoreCommand, createNoteRestoreHandler({ notes, groups }))
  return { bus, notes, billing }
}

const actor = (userId: number) => ({
  userId,
  userMfa: UserMFAStatus.NOT_CONFIGURED,
  sessionSecondFactor: SecondFactorStatus.NotRequired,
})

const createNote = (groupId: string, userId: number, title: string) =>
  new NoteCreateCommand({ actor: actor(userId), groupId, id: uuidV7(), title, body: "" })

function subscription(
  groupId: string,
  id: string,
  type: SubscriptionEvent["type"],
  status: SubscriptionStatus,
  at: Date,
): SubscriptionEvent {
  return {
    id,
    type,
    occurredAt: at,
    subscription: {
      id: `sub_${groupId}`,
      customerId: `cus_${groupId}`,
      status,
      planId: PRO_PLAN_ID,
      priceId: "price_pro",
      currentPeriodEnd: new Date("2026-11-01T10:00:00Z"),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      quantity: 1,
      reference: groupId,
    },
  }
}

Deno.test("the free plan's note cap on Postgres", async (t) => {
  await withSchema(async (sql) => {
    await t.step(
      "two creates racing for the last free slot: one lands and the other is refused",
      async () => {
        const { groupId, owner, editor } = await team(sql)
        const seed = noteBus(sql)
        for (let index = 0; index < FREE_NOTES - 1; index++) {
          await seed.bus.execute(createNote(groupId, owner, `Seed ${index}`))
        }

        // Both requests count 9 at the gate before either writes, so only the write's own count
        // can refuse the second one.
        let arrived = 0
        let bothCounted!: () => void
        const counted = new Promise<void>((resolve) => bothCounted = resolve)
        const { bus, notes } = noteBus(sql, {
          maxNotes: async (id) => {
            const used = await seed.notes.count(id)
            if (++arrived === 2) bothCounted()
            await counted
            return used
          },
          maxMembers: () => Promise.reject(new Error("not part of this test")),
        })

        const outcomes = await Promise.allSettled([
          bus.execute(createNote(groupId, owner, "Owner's")),
          bus.execute(createNote(groupId, editor, "Editor's")),
        ])

        expect(arrived).toBe(2)
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1)
        const refused = outcomes.find((outcome) => outcome.status === "rejected")
        expect((refused as PromiseRejectedResult | undefined)?.reason).toBeInstanceOf(PlanError)
        expect((refused as PromiseRejectedResult).reason).toMatchObject({
          code: "PLAN_LIMIT_REACHED",
          entitlement: "maxNotes",
          limit: FREE_NOTES,
        })
        expect(await notes.count(groupId)).toBe(FREE_NOTES)
      },
    )

    await t.step(
      "a downgrade keeps every note readable and editable, refuses a new one and deletes nothing",
      async () => {
        const { groupId, owner } = await team(sql)
        const { bus, notes, billing } = noteBus(sql)
        const T0 = new Date("2026-10-01T10:00:00Z")
        await billing.applyEvent(
          subscription(
            groupId,
            `evt_up_${groupId}`,
            BillingEventType.SubscriptionCreated,
            SubscriptionStatus.Active,
            T0,
          ),
        )
        const created = []
        for (let index = 0; index < FREE_NOTES + 2; index++) {
          created.push((await bus.execute(createNote(groupId, owner, `Pro ${index}`))).note)
        }

        await billing.applyEvent(
          subscription(
            groupId,
            `evt_down_${groupId}`,
            BillingEventType.SubscriptionCanceled,
            SubscriptionStatus.Canceled,
            new Date(T0.getTime() + 60_000),
          ),
        )

        const listed = await notes.list(groupId, { limit: 100 })
        expect(listed.notes).toHaveLength(FREE_NOTES + 2)
        await expect(bus.execute(createNote(groupId, owner, "One more"))).rejects.toThrow(
          PlanError,
        )
        const [first, second] = created
        const edited = await bus.execute(
          new NoteUpdateCommand({
            actor: actor(owner),
            groupId,
            id: first.id,
            title: "Edited after the downgrade",
            body: "",
            version: first.version,
          }),
        )
        expect(edited.note.title).toBe("Edited after the downgrade")
        await bus.execute(
          new NoteDeleteCommand({
            actor: actor(owner),
            groupId,
            id: second.id,
            version: second.version,
          }),
        )
        expect(await notes.count(groupId)).toBe(FREE_NOTES + 1)
        // Still over the cap after the owner's own delete: a create stays refused.
        await expect(bus.execute(createNote(groupId, owner, "Still over"))).rejects.toThrow(
          PlanError,
        )
      },
    )

    await t.step(
      "restoring a deleted note into a full free group is refused, and works once there is room",
      async () => {
        const { groupId, owner } = await team(sql)
        const { bus, notes } = noteBus(sql)
        const first = (await bus.execute(createNote(groupId, owner, "Deleted"))).note
        await bus.execute(
          new NoteDeleteCommand({
            actor: actor(owner),
            groupId,
            id: first.id,
            version: first.version,
          }),
        )
        const others = []
        for (let index = 0; index < FREE_NOTES; index++) {
          others.push((await bus.execute(createNote(groupId, owner, `Live ${index}`))).note)
        }
        const restore = () => new NoteRestoreCommand({ actor: actor(owner), groupId, id: first.id })

        await expect(bus.execute(restore())).rejects.toMatchObject({
          code: "PLAN_LIMIT_REACHED",
          entitlement: "maxNotes",
          limit: FREE_NOTES,
        })
        expect(await notes.count(groupId)).toBe(FREE_NOTES)

        await bus.execute(
          new NoteDeleteCommand({
            actor: actor(owner),
            groupId,
            id: others[0].id,
            version: others[0].version,
          }),
        )
        const restored = await bus.execute(restore())

        expect(restored.note.id).toBe(first.id)
        expect(await notes.count(groupId)).toBe(FREE_NOTES)
      },
    )

    await t.step(
      "a restore that passed the gate on a stale count is refused by the write's own count",
      async () => {
        const { groupId, owner } = await team(sql)
        const { bus, notes } = noteBus(sql)
        const gone = (await bus.execute(createNote(groupId, owner, "Gone"))).note
        await bus.execute(
          new NoteDeleteCommand({
            actor: actor(owner),
            groupId,
            id: gone.id,
            version: gone.version,
          }),
        )
        for (let index = 0; index < FREE_NOTES; index++) {
          await bus.execute(createNote(groupId, owner, `Live ${index}`))
        }

        // The gate counted 9 before another member's create took the last slot; the repository
        // is handed the cap the gate let the restore through with, and counts for itself.
        await expect(notes.restore({ groupId, id: gone.id }, owner, FREE_NOTES)).rejects
          .toMatchObject({
            code: "PLAN_LIMIT_REACHED",
            entitlement: "maxNotes",
          })

        expect(await notes.count(groupId)).toBe(FREE_NOTES)
        const deleted = await notes.list(groupId, { limit: 10 }, true)
        expect(deleted.notes.map((note) => note.id)).toEqual([gone.id])
      },
    )
  })
})
