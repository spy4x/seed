import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { sha256Hex } from "@spy4x/platform/tokens"
import type { EmailSender } from "@spy4x/email/sender"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { ENGLISH_READER } from "@server/mail/mail.ts"
import { type Actor, UserMFAStatus } from "@domain/identity"
import {
  type GroupInvitation,
  GroupInvitationAcceptCommand,
  GroupInvitationCreateCommand,
  GroupRole,
  InvitationError,
} from "@domain/groups"
import type {
  InvitationCreateRecord,
  InvitationLookup,
  InvitationPlan,
} from "@server/groups/postgres-invitation-repository.ts"
import type { GroupSelectedEvent } from "../../cqrs/events.ts"
import {
  createInvitationAcceptHandler,
  createInvitationCreateHandler,
  type InvitationHandlerDependencies,
  type InvitationStore,
  INVITE_NEEDS_PROVEN_EMAIL,
} from "./invitations.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
type EmailMessage = Parameters<EmailSender["send"]>[0]

const invitationId = "9c1e4f5a-2b3c-4d5e-8f90-a1b2c3d4e5f6"

const invitation: GroupInvitation = {
  id: invitationId,
  groupId,
  role: GroupRole.EDITOR,
  email: "friend@example.com",
  maxUses: 1,
  uses: 0,
  expiresAt: new Date("2026-10-09T10:00:00.000Z"),
  createdAt: new Date("2026-10-02T10:00:00.000Z"),
  createdBy: { userId: 7, name: "Ann" },
}

function actor(userId: number): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionSecondFactor: SecondFactorStatus.NotRequired,
  }
}

/** A store that records what it was asked and answers one invitation tied to an address. */
function fakeStore(target: { email: string | null } = { email: null }) {
  const calls = {
    created: [] as InvitationCreateRecord[],
    createdPlans: [] as InvitationPlan[],
    accepted: [] as { lookup: InvitationLookup; userId: number; plan: InvitationPlan }[],
  }
  const store: InvitationStore = {
    create: (record, _actorId, plan) => {
      calls.created.push(record)
      calls.createdPlans.push(plan)
      return Promise.resolve({ invitation, groupName: "Team" })
    },
    listPending: () => Promise.resolve([]),
    revoke: () => Promise.resolve(true),
    preview: () => Promise.reject(new Error("unused")),
    listForUser: () => Promise.resolve([]),
    find: () => Promise.resolve({ id: invitationId, groupId, email: target.email }),
    accept: (lookup, userId, plan) => {
      calls.accepted.push({ lookup, userId, plan })
      return Promise.resolve({
        groupId,
        role: GroupRole.EDITOR,
        selected: { groupId } as never,
      })
    },
    decline: () => Promise.resolve(),
  }
  return { store, calls }
}

function dependencies(
  store: InvitationStore,
  overrides: Partial<InvitationHandlerDependencies> = {},
) {
  const sent: EmailMessage[] = []
  const events: GroupSelectedEvent[] = []
  const sender: EmailSender = {
    send: (message) => {
      sent.push(message)
      return Promise.resolve({ ok: true, accepted: [String(message.to)], duplicates: [] })
    },
  }
  const deps: InvitationHandlerDependencies = {
    invitations: store,
    ownerOf: () => Promise.resolve(null),
    addressProven: () => Promise.resolve(true),
    planOf: () => Promise.resolve({ maxMembers: null, memberRoles: true }),
    seatPriced: () => Promise.resolve(false),
    mail: {
      sender,
      brand: { webAppUrl: "https://app.example.com" },
      byAddress: () => Promise.resolve({ allowed: true } as never),
      readerOf: () => Promise.resolve(ENGLISH_READER),
      log: () => {},
    },
    emit: (event) => events.push(event),
    ...overrides,
  }
  return { deps, sent, events }
}

function createCommand(
  overrides: { email?: string | null; sendEmail?: boolean; acceptSeatPrice?: boolean } = {},
) {
  const command = new GroupInvitationCreateCommand({
    actor: actor(7),
    groupId,
    role: GroupRole.EDITOR,
    expiresInDays: 7,
    maxUses: 1,
    email: null,
    sendEmail: false,
    acceptSeatPrice: false,
    ...overrides,
  })
  command.allowance = null
  return command
}

describe("invitation handlers", () => {
  it("hands the store only the token's hash and the creator the token", async () => {
    const { store, calls } = fakeStore()
    const create = createInvitationCreateHandler(dependencies(store).deps)

    const result = await create(createCommand())

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(calls.created[0].tokenHash).toBe(await sha256Hex(result.token))
    expect(JSON.stringify(calls.created)).not.toContain(result.token)
    expect(result.mailSent).toBe(false)
  })

  it("mails the same link the creator sees, to the normalised address, only when asked", async () => {
    const { store, calls } = fakeStore()
    const { deps, sent } = dependencies(store)
    const create = createInvitationCreateHandler(deps)

    await create(createCommand({ email: "Friend@Example.com " }))
    expect(sent).toEqual([])
    const result = await create(createCommand({ email: "Friend@Example.com", sendEmail: true }))

    expect(result.mailSent).toBe(true)
    expect(calls.created.map((record) => record.email)).toEqual([
      "friend@example.com",
      "friend@example.com",
    ])
    expect(sent.map((message) => message.to)).toEqual(["friend@example.com"])
    expect(sent[0].text).toContain(`https://app.example.com/invite/${result.token}`)
  })

  it("keeps the invitation and answers mailSent false when the address's mail budget is spent", async () => {
    const { store, calls } = fakeStore()
    const { deps, sent } = dependencies(store)
    deps.mail.byAddress = () => Promise.resolve({ allowed: false } as never)
    const create = createInvitationCreateHandler(deps)

    const result = await create(createCommand({ email: "friend@example.com", sendEmail: true }))

    expect(result.mailSent).toBe(false)
    expect(sent).toEqual([])
    expect(calls.created).toHaveLength(1)
  })

  it("refuses a create that skipped the entitlement gate", async () => {
    const { store, calls } = fakeStore()
    const create = createInvitationCreateHandler(dependencies(store).deps)
    const command = createCommand()
    command.allowance = undefined

    await expect(create(command)).rejects.toThrow("without the entitlement gate")
    expect(calls.created).toEqual([])
  })

  it("refuses an invitation by link and by address until the creator's own address is proven", async () => {
    const { store, calls } = fakeStore()
    let proven = false
    const asked: number[] = []
    const { deps, sent } = dependencies(store, {
      addressProven: (userId) => {
        asked.push(userId)
        return Promise.resolve(proven)
      },
    })
    const create = createInvitationCreateHandler(deps)

    for (
      const command of [
        createCommand(),
        createCommand({ email: "friend@example.com", sendEmail: true }),
      ]
    ) {
      const refused = await create(command).catch((error) => error)
      expect(refused).toBeInstanceOf(InvitationError)
      expect(refused.code).toBe("ADDRESS_NOT_PROVEN")
      expect(refused.message).toBe(INVITE_NEEDS_PROVEN_EMAIL)
    }
    expect(asked).toEqual([7, 7])
    expect(calls.created).toEqual([])
    expect(sent).toEqual([])

    proven = true
    await create(createCommand())
    await create(createCommand({ email: "friend@example.com", sendEmail: true }))

    expect(calls.created.map((record) => record.email)).toEqual([null, "friend@example.com"])
    expect(sent).toHaveLength(1)
  })

  it("refuses an address-bound accept from an account that did not prove the address", async () => {
    const { store, calls } = fakeStore({ email: "friend@example.com" })
    const { deps, events } = dependencies(store, { ownerOf: () => Promise.resolve(99) })
    const accept = createInvitationAcceptHandler(deps)

    const error = await accept(
      new GroupInvitationAcceptCommand({ actor: actor(42), invitation: { invitationId } }),
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(InvitationError)
    expect(error.code).toBe("INVITATION_WRONG_ACCOUNT")
    expect(calls.accepted).toEqual([])
    expect(events).toEqual([])
  })

  it("refuses a new invitation to a group billed per member until the creator confirms the price", async () => {
    const { store, calls } = fakeStore()
    const asked: [string, number][] = []
    const create = createInvitationCreateHandler(
      dependencies(store, {
        seatPriced: (id, actorId) => {
          asked.push([id, actorId])
          return Promise.resolve(true)
        },
      }).deps,
    )

    const refused = await create(createCommand()).catch((error) => error)

    expect(refused).toBeInstanceOf(InvitationError)
    expect(refused.code).toBe("SEAT_PRICE_NOT_ACCEPTED")
    expect(asked).toEqual([[groupId, 7]])
    expect(calls.created).toHaveLength(0)

    await create(createCommand({ acceptSeatPrice: true }))

    expect(calls.created).toHaveLength(1)
  })

  it("creates without a price confirmation in a group not billed per member", async () => {
    const { store, calls } = fakeStore()
    const create = createInvitationCreateHandler(dependencies(store).deps)

    await create(createCommand())

    expect(calls.created).toHaveLength(1)
  })

  it("creates with the gate's member cap and the plan's word on roles", async () => {
    const { store, calls } = fakeStore()
    const asked: string[] = []
    const create = createInvitationCreateHandler(
      dependencies(store, {
        planOf: (id) => {
          asked.push(id)
          return Promise.resolve({ maxMembers: 50, memberRoles: false })
        },
      }).deps,
    )
    const command = createCommand()
    command.allowance = 3

    await create(command)

    expect(asked).toEqual([groupId])
    expect(calls.createdPlans).toEqual([{ maxMembers: 3, memberRoles: false }])
  })

  it("accepts with the plan of the invitation's group and tells the person's tabs", async () => {
    const { store, calls } = fakeStore()
    const asked: string[] = []
    const { deps, events } = dependencies(store, {
      planOf: (id) => {
        asked.push(id)
        return Promise.resolve({ maxMembers: 3, memberRoles: false })
      },
    })
    const accept = createInvitationAcceptHandler(deps)
    const token = "a".repeat(43)

    await accept(new GroupInvitationAcceptCommand({ actor: actor(42), invitation: { token } }))

    expect(asked).toEqual([groupId])
    expect(calls.accepted).toEqual([
      {
        lookup: { tokenHash: await sha256Hex(token) },
        userId: 42,
        plan: { maxMembers: 3, memberRoles: false },
      },
    ])
    expect(events.map((event) => event.data)).toEqual([{ userId: 42, groupId }])
  })
})
