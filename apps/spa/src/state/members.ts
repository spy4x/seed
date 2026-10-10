import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  EMPTY_TRANSFER_DRAFT,
  type TransferDraft,
  type TransferError,
  transferErrorField,
} from "@ui/group-transfer.tsx"
import { apiRead } from "./realtime-call.ts"
import { callCommand } from "../modules.ts"

/** A member as the API sends them: `joinedAt` is an ISO string. */
export interface MemberItem {
  userId: number
  name: string
  /** Sent only to the owner and admins. */
  email?: string | null
  /** Sent only to the owner and admins. */
  lastSeenAt?: string | null
  role: GroupRole
  joinedAt: string
  isYou: boolean
}

/** What the members store needs from the outside. Injected so tests need no network. */
export interface MembersDependencies {
  list(input: { groupId: string }): Promise<{ members: MemberItem[]; memberCount: number }>
  setRole(input: { groupId: string; userId: number; role: GroupRole }): Promise<{
    member: MemberItem
  }>
  removeMember(input: { groupId: string; userId: number }): Promise<{ removed: true }>
  leave(input: { groupId: string }): Promise<{ left: true }>
  /** Hands the group to `userId`; throws a {@link TransferRefused} with the API's answer. */
  transfer(
    input: { groupId: string; userId: number; name: string; password: string },
  ): Promise<void>
}

/** A refused transfer: the API's message and error code. */
export class TransferRefused extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message)
    this.name = "TransferRefused"
  }
}

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/**
 * The members of the group whose settings are open, and the changes to them in flight.
 *
 * It holds one group at a time. A read answered after the page moved to another group, or after
 * a newer read started, is dropped, so the list always belongs to the group shown.
 */
export function createMembersStore(dependencies: MembersDependencies) {
  const groupId = signal<string | null>(null)
  /** The members, or `null` until the first read of this group answers. */
  const members = signal<readonly MemberItem[] | null>(null)
  /** How many members the group has; the list stops at the API's limit, this does not. */
  const memberCount = signal<number | null>(null)
  const loadError = signal<string | null>(null)
  /** The member whose role change or removal is in flight. */
  const pendingUserId = signal<number | null>(null)
  /** Why the last role change or removal was refused, and for which member. */
  const memberError = signal<
    { userId: number; message: string; plan: PlanRefusal | null } | null
  >(null)
  const leaving = signal(false)
  const leaveError = signal<string | null>(null)
  const transferDraft = signal<TransferDraft>(EMPTY_TRANSFER_DRAFT)
  const transferring = signal(false)
  const transferError = signal<TransferError | null>(null)
  let reads = 0

  /** Reads the members of the open group again. Does nothing while no group is open. */
  async function refresh(): Promise<void> {
    const id = groupId.value
    if (id === null) return
    const read = ++reads
    try {
      const result = await dependencies.list({ groupId: id })
      if (read !== reads || groupId.value !== id) return
      members.value = result.members
      memberCount.value = result.memberCount
      loadError.value = null
    } catch (cause) {
      if (read !== reads || groupId.value !== id) return
      loadError.value = describe(cause, "Could not load the members")
    }
  }

  /** Shows the members of `id`, read from the server. Opening the same group again reads again. */
  function open(id: string): Promise<void> {
    if (groupId.value !== id) {
      groupId.value = id
      members.value = null
      memberCount.value = null
      loadError.value = null
      memberError.value = null
      leaveError.value = null
      transferDraft.value = EMPTY_TRANSFER_DRAFT
      transferError.value = null
    }
    return refresh()
  }

  /** Runs one change of a member; a second change while one runs is refused. */
  async function change(
    userId: number,
    run: (groupId: string) => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    const id = groupId.value
    if (id === null || pendingUserId.value !== null) return false
    pendingUserId.value = userId
    memberError.value = null
    try {
      await run(id)
      return true
    } catch (cause) {
      const plan = cause instanceof RealtimeRequestError ? readPlanRefusal(cause.details) : null
      memberError.value = { userId, message: describe(cause, fallback), plan }
      return false
    } finally {
      pendingUserId.value = null
    }
  }

  /** Gives a member a new role. Resolves to whether it worked. */
  function changeRole(userId: number, role: GroupRole): Promise<boolean> {
    return change(userId, async (id) => {
      const { member } = await dependencies.setRole({ groupId: id, userId, role })
      members.value = members.value?.map((m) => m.userId === userId ? member : m) ?? null
    }, "Could not change the role")
  }

  /** Removes a member from the group. Resolves to whether it worked. */
  function remove(userId: number): Promise<boolean> {
    return change(userId, async (id) => {
      await dependencies.removeMember({ groupId: id, userId })
      members.value = members.value?.filter((m) => m.userId !== userId) ?? null
      if (memberCount.value !== null) memberCount.value--
    }, "Could not remove the member")
  }

  /** Leaves the open group. Resolves to whether it worked, so the page can move on. */
  async function leave(): Promise<boolean> {
    const id = groupId.value
    if (id === null || leaving.value) return false
    leaving.value = true
    leaveError.value = null
    try {
      await dependencies.leave({ groupId: id })
      return true
    } catch (cause) {
      leaveError.value = describe(cause, "Could not leave the group")
      return false
    } finally {
      leaving.value = false
    }
  }

  /**
   * Hands the open group to the member in the draft. The password leaves the draft either way, so
   * it is held no longer than the request. Resolves to whether it worked; on success the members
   * are read again, since two roles changed.
   */
  async function transfer(): Promise<boolean> {
    const id = groupId.value
    const { userId, name, password } = transferDraft.value
    if (id === null || userId === null || transferring.value) return false
    transferring.value = true
    transferError.value = null
    transferDraft.value = { ...transferDraft.value, password: "" }
    try {
      await dependencies.transfer({ groupId: id, userId, name, password })
      transferDraft.value = EMPTY_TRANSFER_DRAFT
      await refresh()
      return true
    } catch (cause) {
      transferError.value = cause instanceof TransferRefused
        ? { field: transferErrorField(cause.code), message: cause.message }
        : { field: null, message: "Could not transfer the group" }
      return false
    } finally {
      transferring.value = false
    }
  }

  function reset(): void {
    reads++
    groupId.value = null
    members.value = null
    memberCount.value = null
    loadError.value = null
    pendingUserId.value = null
    memberError.value = null
    leaving.value = false
    leaveError.value = null
    transferDraft.value = EMPTY_TRANSFER_DRAFT
    transferring.value = false
    transferError.value = null
  }

  return {
    groupId,
    members,
    memberCount,
    loadError,
    pendingUserId,
    memberError,
    leaving,
    leaveError,
    transferDraft,
    transferring,
    transferError,
    open,
    refresh,
    changeRole,
    remove,
    leave,
    transfer,
    reset,
  }
}

/**
 * Reads over REST, like every pull, so the list loads before the socket opens; changes go over the
 * socket as commands with a retry key.
 */
export const membersStore = createMembersStore({
  async list({ groupId }) {
    const result = await apiRead<{ members: MemberItem[]; memberCount: number }>(
      `/api/groups/${encodeURIComponent(groupId)}/members`,
    )
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  setRole: (input) => callCommand("group.setRole", input),
  removeMember: (input) => callCommand("group.removeMember", input),
  leave: (input) => callCommand("group.leave", input),
  // Over REST, not the socket: the password goes in this one request.
  transfer: async ({ groupId, ...body }) => {
    let response: Response
    try {
      response = await fetch(`/api/groups/${encodeURIComponent(groupId)}/transfer`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    } catch (_unreachable) {
      throw new TransferRefused("The server is out of reach. Try again.", undefined)
    }
    if (response.ok) return
    const error = (await response.json().catch(() => null) as { error?: unknown } | null)?.error
    const { code, message } = typeof error === "object" && error !== null
      ? error as { code?: unknown; message?: unknown }
      : {}
    throw new TransferRefused(
      typeof message === "string"
        ? message
        : response.status === 429
        ? "Too many attempts. Wait a few minutes, then try again."
        : "Something went wrong. Try again.",
      typeof code === "string" ? code : undefined,
    )
  },
})
