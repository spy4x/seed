import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { CommandBus } from "@spy4x/platform/cqrs"
import { FREE_PLAN_ID, PlanError, PRO_PLAN_ID } from "@domain/billing"
import {
  GroupInvitationCreateCommand,
  GroupMemberRoleCommand,
  GroupRenameCommand,
  GroupRole,
} from "@domain/groups"
import { NoteCreateCommand } from "@domain/notes"
import { UserMFAStatus } from "@domain/identity"
import { createEntitlementGate, type EntitlementGateDependencies } from "./entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "./entitlement-needs.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const actor = (userId: number) => ({ userId, userMfa: UserMFAStatus.NOT_CONFIGURED })

const ROLES: Record<number, GroupRole> = {
  1: GroupRole.OWNER,
  2: GroupRole.ADMIN,
  3: GroupRole.EDITOR,
  4: GroupRole.VIEWER,
}

/** A bus with the gate and handlers that only record that they ran, and the allowance they got. */
function bus(overrides: Partial<EntitlementGateDependencies> = {}, notes = 0, members = 1) {
  const ran: { command: string; allowance?: number | null }[] = []
  const commands = new CommandBus()
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: () => Promise.resolve(FREE_PLAN_ID),
    roleOf: (_group, userId) => Promise.resolve(ROLES[userId] ?? null),
    usage: { maxNotes: () => Promise.resolve(notes), maxMembers: () => Promise.resolve(members) },
    ...overrides,
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, (command) => {
    ran.push({ command: "note.create", allowance: command.allowance })
    return Promise.resolve({ note: {} as never, created: true })
  })
  commands.register(GroupMemberRoleCommand, () => {
    ran.push({ command: "group.setRole" })
    return Promise.resolve({ member: {} as never })
  })
  commands.register(GroupInvitationCreateCommand, (command) => {
    ran.push({ command: "group.invite", allowance: command.allowance })
    return Promise.resolve({ invitation: {} as never, token: "", mailSent: false })
  })
  commands.register(GroupRenameCommand, () => {
    ran.push({ command: "group.rename" })
    return Promise.resolve({ group: {} as never })
  })
  return { commands, ran }
}

const createNote = (userId: number) =>
  new NoteCreateCommand({
    actor: actor(userId) as never,
    groupId,
    id: uuidV7(),
    title: "A",
    body: "",
  })
const setRole = (userId: number) =>
  new GroupMemberRoleCommand({
    actor: actor(userId) as never,
    groupId,
    userId: 4,
    role: GroupRole.EDITOR,
  })

const invite = (userId: number, role = GroupRole.EDITOR) =>
  new GroupInvitationCreateCommand({
    actor: actor(userId) as never,
    groupId,
    role,
    expiresInDays: 7,
    maxUses: 1,
    email: null,
    sendEmail: false,
    acceptSeatPrice: false,
  })

describe("the entitlement gate", () => {
  it("refuses a feature the plan lacks before the handler runs", async () => {
    const { commands, ran } = bus()

    await expect(commands.execute(setRole(1))).rejects.toThrow(PlanError)
    expect(ran).toEqual([])
  })

  it("lets the same command through on a plan that includes the feature", async () => {
    const { commands, ran } = bus({ planOf: () => Promise.resolve(PRO_PLAN_ID) })

    await commands.execute(setRole(1))

    expect(ran).toEqual([{ command: "group.setRole" }])
  })

  it("refuses a capped command at the cap before the handler runs, and lets one under it through", async () => {
    const full = bus({}, 10)
    await expect(full.commands.execute(createNote(3))).rejects.toThrow(PlanError)
    expect(full.ran).toEqual([])

    const room = bus({}, 9)
    await room.commands.execute(createNote(3))
    expect(room.ran).toEqual([{ command: "note.create", allowance: 10 }])
  })

  it("hands the handler no cap on a plan without one", async () => {
    const { commands, ran } = bus({ planOf: () => Promise.resolve(PRO_PLAN_ID) }, 500)

    await commands.execute(createNote(3))

    expect(ran).toEqual([{ command: "note.create", allowance: null }])
  })

  it("passes a stranger and a role the command does not allow on to the handler", async () => {
    const { commands, ran } = bus({}, 10)

    await commands.execute(createNote(9))
    await commands.execute(createNote(4))
    await commands.execute(setRole(3))

    expect(ran.map((entry) => entry.command)).toEqual([
      "note.create",
      "note.create",
      "group.setRole",
    ])
    // The handler still writes under the cap, so a viewer who slipped past cannot exceed it.
    expect(ran[0].allowance).toBe(10)
  })

  it("lets everything through with no cap while billing is off", async () => {
    const { commands, ran } = bus({ billingEnabled: false }, 10)

    await commands.execute(setRole(1))
    await commands.execute(createNote(1))

    expect(ran).toEqual([
      { command: "group.setRole" },
      { command: "note.create", allowance: null },
    ])
  })

  it("never looks at a command it does not list", async () => {
    const fail = () => Promise.reject(new Error("read"))
    const { commands, ran } = bus({ planOf: fail, roleOf: fail })

    await commands.execute(new GroupRenameCommand({ actor: actor(1) as never, groupId, name: "B" }))

    expect(ran).toEqual([{ command: "group.rename" }])
  })

  it("refuses to start when a listed cap has no usage count", () => {
    expect(() =>
      createEntitlementGate({
        billingEnabled: true,
        planOf: () => Promise.resolve(FREE_PLAN_ID),
        roleOf: () => Promise.resolve(null),
        usage: {},
      }, ENTITLEMENT_NEEDS)
    ).toThrow(`no usage count for "maxNotes"`)
  })

  it("refuses an invitation once the members fill the plan, and passes the cap on under it", async () => {
    const full = bus({}, 0, 3)
    const room = bus({}, 0, 2)

    await expect(full.commands.execute(invite(2))).rejects.toThrow(PlanError)
    await room.commands.execute(invite(2))

    expect(full.ran).toEqual([])
    expect(room.ran).toEqual([{ command: "group.invite", allowance: 3 }])
  })

  it("leaves an invitation the actor may not give to the handler, even on a full plan", async () => {
    const full = bus({}, 0, 3)

    await full.commands.execute(invite(2, GroupRole.ADMIN))

    // Not refused for the plan: the handler refuses the role itself, the same on every plan.
    expect(full.ran).toEqual([{ command: "group.invite", allowance: 3 }])
  })
})
