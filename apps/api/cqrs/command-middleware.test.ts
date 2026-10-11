import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CommandBus } from "@spy4x/platform/cqrs"
import { createIdempotencyMiddleware, MemoryIdempotencyStore } from "@spy4x/server/idempotency"
import { FREE_PLAN_ID, PlanError } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import { UserMFAStatus } from "@domain/identity"
import { NoteCreateCommand } from "@domain/notes"
import { useCommandMiddleware } from "./command-middleware.ts"
import { createEntitlementGate } from "./entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "./entitlement-needs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const FREE_NOTES = 10

/** The API's command middleware on a free group that counts its notes in memory. */
function bus(notes: number) {
  const group = { notes, writes: 0 }
  const commands = new CommandBus()
  useCommandMiddleware(commands, {
    idempotency: createIdempotencyMiddleware({ store: new MemoryIdempotencyStore({}) }),
    entitlements: createEntitlementGate({
      billingEnabled: true,
      planOf: () => Promise.resolve(FREE_PLAN_ID),
      roleOf: () => Promise.resolve(GroupRole.OWNER),
      usage: {
        maxNotes: () => Promise.resolve(group.notes),
        maxMembers: () => Promise.reject(new Error("not part of this test")),
      },
    }, ENTITLEMENT_NEEDS),
  })
  commands.register(NoteCreateCommand, (command) => {
    group.notes++
    group.writes++
    return Promise.resolve({ note: { id: command.data.id } as never, created: true })
  })
  return { commands, group }
}

const create = (id: string, idempotencyKey: string) =>
  new NoteCreateCommand({
    actor: { userId: 1, userMfa: UserMFAStatus.NOT_CONFIGURED } as never,
    groupId,
    id,
    title: "A",
    body: "",
    idempotencyKey,
  })

describe("the command bus's middleware", () => {
  it("answers a group at its cap that retries a create which already landed with the first result", async () => {
    const { commands, group } = bus(FREE_NOTES - 1)
    const id = uuidV7()

    const first = await commands.execute(create(id, "create-last"))
    expect(group.notes).toBe(FREE_NOTES)
    const retried = await commands.execute(create(id, "create-last"))

    expect(retried).toEqual(first)
    expect(group.writes).toBe(1)
    // A new create at the cap is still refused: the gate is on this bus.
    await expect(commands.execute(create(uuidV7(), "create-next")))
      .rejects.toThrow(PlanError)
  })
})
