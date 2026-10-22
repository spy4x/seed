import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { type Actor, UserMFAStatus } from "@domain/identity"
import {
  CreateGroupInput,
  FirstGroupInput,
  GroupAccess,
  GroupCreateCommand,
  GroupError,
  GroupGetQuery,
  GroupListQuery,
  GroupRepository,
  GroupRole,
  GroupSelectCommand,
  GroupSelectedQuery,
  GroupSummary,
  SelectedGroup,
} from "@domain/groups"
import type { GroupSelectedEvent } from "../../cqrs/events.ts"
import {
  createGroupCreateHandler,
  createGroupGetHandler,
  createGroupListHandler,
  createGroupSelectedHandler,
  createGroupSelectHandler,
} from "./handlers.ts"

const now = new Date("2026-08-18T10:00:00.000Z")
const summary: GroupSummary = {
  id: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  name: "Team",
  description: "",
  color: null,
  emoji: null,
  role: GroupRole.OWNER,
  authorizationRevision: "1",
  changeSequence: "1",
  updatedAt: now,
}

class FakeGroupRepository implements GroupRepository {
  createActorId: number | null = null
  createRequestId: string | undefined
  createInput: CreateGroupInput | null = null
  listUserId: number | null = null

  listForUser(userId: number) {
    this.listUserId = userId
    return Promise.resolve({ groups: [summary], nextPageKey: null })
  }

  getSummaryForMember(groupId: string, userId: number) {
    return Promise.resolve(groupId === summary.id && userId === 84 ? summary : null)
  }

  listMemberUserIds(_groupId: string): Promise<number[]> {
    throw new Error("Not used")
  }

  getForMember(_groupId: string, _userId: number): Promise<GroupAccess | null> {
    return Promise.resolve(null)
  }

  create(input: CreateGroupInput, actorId: number) {
    this.createActorId = actorId
    this.createRequestId = input.requestId
    this.createInput = input
    return Promise.resolve({ group: { ...summary, id: input.id, name: input.name }, created: true })
  }

  createFirst(_input: FirstGroupInput, _userId: number): Promise<void> {
    throw new Error("Not used")
  }

  listMembers(): Promise<null> {
    throw new Error("Not used")
  }

  changeMemberRole(): Promise<null> {
    throw new Error("Not used")
  }

  removeMember(): Promise<boolean> {
    throw new Error("Not used")
  }

  leave(): Promise<boolean> {
    throw new Error("Not used")
  }

  transferOwnership(): Promise<boolean> {
    throw new Error("Not used")
  }

  ensureFirst(_input: FirstGroupInput, _userId: number): Promise<void> {
    throw new Error("Not used")
  }

  getRestorableForMember(): Promise<GroupAccess | null> {
    throw new Error("Not used")
  }

  rename(): Promise<GroupSummary | null> {
    throw new Error("Not used")
  }

  updateDetails(): Promise<GroupSummary | null> {
    throw new Error("Not used")
  }

  softDelete(): Promise<never> {
    throw new Error("Not used")
  }

  restore(): Promise<GroupSummary | null> {
    throw new Error("Not used")
  }

  listRestorable(): Promise<never[]> {
    throw new Error("Not used")
  }

  selectedUserId: number | null = null

  getSelected(userId: number): Promise<SelectedGroup> {
    this.selectedUserId = userId
    return Promise.resolve({ groupId: summary.id, version: 3 })
  }

  /** Only user 84 belongs to the group. */
  select(userId: number, groupId: string): Promise<SelectedGroup | null> {
    return Promise.resolve(
      groupId === summary.id && userId === 84 ? { groupId, version: 4 } : null,
    )
  }
}

function actor(userId: number, overrides: Partial<Actor> = {}): Actor {
  return {
    userId,
    userMfa: UserMFAStatus.NOT_CONFIGURED,
    sessionSecondFactor: SecondFactorStatus.NotRequired,
    ...overrides,
  }
}

describe("group CQRS handlers", () => {
  it("hands the request id of create to the repository for its audit row", async () => {
    const repository = new FakeGroupRepository()
    await createGroupCreateHandler(repository)(
      new GroupCreateCommand({
        actor: actor(42),
        id: summary.id,
        name: "Team",
        requestId: "req-9",
      }),
    )

    expect(repository.createRequestId).toBe("req-9")
  })

  it("hands the description, colour and emoji of create to the repository", async () => {
    const repository = new FakeGroupRepository()
    await createGroupCreateHandler(repository)(
      new GroupCreateCommand({
        actor: actor(42),
        id: summary.id,
        name: "Trips",
        description: "Our trips",
        color: "#7e22ce",
        emoji: "🏕️",
      }),
    )

    expect(repository.createInput).toMatchObject({
      description: "Our trips",
      color: "#7e22ce",
      emoji: "🏕️",
    })
  })

  it("scopes create to command user", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupCreateHandler(repository)
    const result = await handler(
      new GroupCreateCommand({
        actor: actor(42),
        id: summary.id,
        name: "Team",
      }),
    )

    expect(repository.createActorId).toBe(42)
    expect(result.group.role).toBe(GroupRole.OWNER)
  })

  it("scopes list to query user", async () => {
    const repository = new FakeGroupRepository()
    const handler = createGroupListHandler(repository)
    const result = await handler(new GroupListQuery({ actor: actor(84), page: { limit: 50 } }))

    expect(repository.listUserId).toBe(84)
    expect(result.groups).toEqual([summary])
  })

  it("reads one group of a member", async () => {
    const handler = createGroupGetHandler(new FakeGroupRepository())
    const result = await handler(new GroupGetQuery({ actor: actor(84), groupId: summary.id }))

    expect(result).toEqual({ group: summary })
  })

  it("answers a non-member exactly as a missing group", async () => {
    const handler = createGroupGetHandler(new FakeGroupRepository())
    const missing = await handler(
      new GroupGetQuery({ actor: actor(84), groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d119999" }),
    ).catch((error) => error)
    const stranger = await handler(new GroupGetQuery({ actor: actor(85), groupId: summary.id }))
      .catch((error) => error)

    expect(stranger).toBeInstanceOf(GroupError)
    expect(stranger.code).toBe("GROUP_NOT_FOUND")
    expect([stranger.code, stranger.message]).toEqual([missing.code, missing.message])
  })

  it("selects a group for a member and returns the new version", async () => {
    const emitted: GroupSelectedEvent[] = []
    const handler = createGroupSelectHandler(new FakeGroupRepository(), {
      emit: (event) => emitted.push(event),
    })
    const result = await handler(new GroupSelectCommand({ actor: actor(84), groupId: summary.id }))

    expect(result).toEqual({ groupId: summary.id, version: 4 })
    // The person's other tabs are told, with the user and the group chosen.
    expect(emitted.map((event) => event.data)).toEqual([{ userId: 84, groupId: summary.id }])
  })

  it("refuses to select a group of which the person is not a member, as a missing group", async () => {
    const emitted: GroupSelectedEvent[] = []
    const handler = createGroupSelectHandler(new FakeGroupRepository(), {
      emit: (event) => emitted.push(event),
    })
    const stranger = await handler(
      new GroupSelectCommand({ actor: actor(85), groupId: summary.id }),
    ).catch((error) => error)
    const missing = await handler(
      new GroupSelectCommand({ actor: actor(84), groupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d119999" }),
    ).catch((error) => error)

    expect(stranger).toBeInstanceOf(GroupError)
    expect(stranger.code).toBe("GROUP_NOT_FOUND")
    expect([stranger.code, stranger.message]).toEqual([missing.code, missing.message])
    expect(emitted).toEqual([])
  })

  it("reads the selected group of the query's user", async () => {
    const repository = new FakeGroupRepository()
    const result = await createGroupSelectedHandler(repository)(
      new GroupSelectedQuery({ actor: actor(84) }),
    )

    expect(repository.selectedUserId).toBe(84)
    expect(result).toEqual({ groupId: summary.id, version: 3 })
  })
})
