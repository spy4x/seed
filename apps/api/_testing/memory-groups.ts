import {
  type CreatedGroup,
  type DeletedGroupSummary,
  type GroupAccess,
  type GroupColor,
  type GroupDetails,
  GroupError,
  type GroupListPage,
  type GroupListResult,
  type GroupMembersResult,
  type GroupMemberSummary,
  type GroupRepository,
  GroupRole,
  type GroupSummary,
  type SelectedGroup,
} from "@domain/groups"

const AT = new Date("2026-10-02T10:00:00.000Z")

/**
 * One group in memory with a role for each member, for the tests of the group handlers and
 * transports. It holds the rules the handlers decide with (who is a member, which group is deleted
 * and so restorable) and none of the database's: it does not enforce the last-group rule or give
 * stranded members a group, which the integration tests prove against Postgres; `lastGroup` makes
 * a delete or a leave fail as the database does for a person's only group. `writes` counts
 * every rename, delete, restore and member change that reached it, so a refused request is shown
 * to change nothing.
 */
export class MemoryGroupRepository implements GroupRepository {
  writes = 0
  /** The request id each write received, in order, so a test sees it reach the audit trail. */
  requestIds: (string | undefined)[] = []
  name: string
  description = ""
  color: GroupColor | null = null
  emoji: string | null = null
  timeZone = "UTC"
  deleted = false
  lastGroup = false
  /** The group has a live subscription: a delete fails as the database refuses it. */
  subscribed = false

  constructor(
    readonly groupId: string,
    private readonly roles: Record<number, GroupRole>,
    name = "Team",
  ) {
    this.name = name
  }

  #access(userId: number, deleted: boolean): GroupAccess | null {
    const role = this.roles[userId]
    if (role === undefined || this.deleted !== deleted) return null
    return {
      group: {
        id: this.groupId,
        name: this.name,
        description: this.description,
        color: this.color,
        emoji: this.emoji,
        timeZone: this.timeZone,
        ownerUserId: 1,
        createdByUserId: 1,
        authorizationRevision: "1",
        nextChangeSequence: "2",
        createdAt: AT,
        updatedAt: AT,
        deletedAt: deleted ? AT : null,
      },
      role,
    }
  }

  #summary(role: GroupRole): GroupSummary {
    return {
      id: this.groupId,
      name: this.name,
      description: this.description,
      color: this.color,
      emoji: this.emoji,
      timeZone: this.timeZone,
      role,
      authorizationRevision: "1",
      changeSequence: "2",
      updatedAt: AT,
    }
  }

  getForMember(_groupId: string, userId: number) {
    return Promise.resolve(this.#access(userId, false))
  }

  getRestorableForMember(_groupId: string, userId: number) {
    return Promise.resolve(this.#access(userId, true))
  }

  rename(
    _groupId: string,
    name: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    const access = this.#access(actorId, false)
    if (!access) return Promise.resolve(null)
    this.name = name
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(this.#summary(access.role))
  }

  updateDetails(
    _groupId: string,
    details: GroupDetails,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    const access = this.#access(actorId, false)
    if (!access) return Promise.resolve(null)
    this.description = details.description
    this.color = details.color
    this.emoji = details.emoji
    this.timeZone = details.timeZone ?? this.timeZone
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(this.#summary(access.role))
  }

  softDelete(
    _groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<DeletedGroupSummary | null> {
    const access = this.#access(actorId, false)
    if (!access) return Promise.resolve(null)
    if (this.lastGroup) {
      return Promise.reject(new GroupError("LAST_GROUP", "A person must keep at least one group"))
    }
    if (this.subscribed) {
      return Promise.reject(
        new GroupError(
          "GROUP_SUBSCRIBED",
          "Cancel the group's subscription in the billing portal before deleting it",
        ),
      )
    }
    this.deleted = true
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve({ ...this.#summary(access.role), deletedAt: AT })
  }

  restore(
    _groupId: string,
    actorId: number,
    requestId?: string,
  ): Promise<GroupSummary | null> {
    const access = this.#access(actorId, true)
    if (!access) return Promise.resolve(null)
    this.deleted = false
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(this.#summary(access.role))
  }

  listRestorable(userId: number): Promise<DeletedGroupSummary[]> {
    const access = this.#access(userId, true)
    return Promise.resolve(
      access && access.role === GroupRole.OWNER
        ? [{ ...this.#summary(access.role), deletedAt: AT }]
        : [],
    )
  }

  #member(userId: number, actorId: number): GroupMemberSummary {
    return {
      userId,
      name: `Member ${userId}`,
      email: null,
      role: this.roles[userId],
      joinedAt: AT,
      isYou: userId === actorId,
    }
  }

  listMembers(_groupId: string, actorId: number): Promise<GroupMembersResult | null> {
    if (!this.#access(actorId, false)) return Promise.resolve(null)
    const members = Object.keys(this.roles).map((userId) => this.#member(Number(userId), actorId))
    return Promise.resolve({ members, memberCount: members.length })
  }

  changeMemberRole(
    _groupId: string,
    userId: number,
    role: GroupRole,
    actorId: number,
    requestId?: string,
  ): Promise<GroupMemberSummary | null> {
    if (!this.#access(actorId, false)) return Promise.resolve(null)
    this.roles[userId] = role
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(this.#member(userId, actorId))
  }

  removeMember(
    _groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean> {
    if (!this.#access(actorId, false)) return Promise.resolve(false)
    delete this.roles[userId]
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(true)
  }

  transferOwnership(
    _groupId: string,
    userId: number,
    actorId: number,
    requestId?: string,
  ): Promise<boolean> {
    if (!this.#access(actorId, false)) return Promise.resolve(false)
    this.roles[actorId] = GroupRole.ADMIN
    this.roles[userId] = GroupRole.OWNER
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(true)
  }

  leave(_groupId: string, actorId: number, requestId?: string): Promise<boolean> {
    if (!this.#access(actorId, false)) return Promise.resolve(false)
    if (this.lastGroup) {
      return Promise.reject(
        new GroupError("LAST_GROUP", "You cannot leave your only group. Create another first."),
      )
    }
    delete this.roles[actorId]
    this.writes++
    this.requestIds.push(requestId)
    return Promise.resolve(true)
  }

  getSelected(): Promise<SelectedGroup> {
    throw new Error("Not used")
  }
  select(): Promise<SelectedGroup | null> {
    throw new Error("Not used")
  }
  listForUser(_userId: number, _page: GroupListPage): Promise<GroupListResult> {
    throw new Error("Not used")
  }
  getSummaryForMember(): Promise<GroupSummary | null> {
    throw new Error("Not used")
  }
  listMemberUserIds(): Promise<number[]> {
    throw new Error("Not used")
  }
  create(): Promise<CreatedGroup> {
    throw new GroupError("INVALID_REQUEST", "Not used")
  }
  createFirst(): Promise<void> {
    throw new Error("Not used")
  }
  ensureFirst(): Promise<void> {
    throw new Error("Not used")
  }
}
