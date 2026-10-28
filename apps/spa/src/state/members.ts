import { signal } from "@preact/signals"
import { describeError, RealtimeRequestError } from "@spy4x/realtime"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import type { GroupRole } from "@domain/groups"
import {
  EMPTY_TRANSFER_DRAFT,
  type TransferDraft,
  type TransferError,
  transferErrorField,
} from "@ui/group-transfer.tsx"
import { apiAsUser, fetchAsUser } from "./realtime-call.ts"
import { readApiError } from "@domain/errors"
import { callCommand, type LocalReads, localReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"
import { appText } from "./app-text.ts"

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

/**
 * The members of the group whose settings are open, and the changes to them in flight.
 *
 * It holds one group at a time. A read answered after the page moved to another group, or after
 * a newer read started, is dropped, so the list always belongs to the group shown.
 */
export function createMembersStore(
  dependencies: MembersDependencies,
  device: LocalReads = noLocalReads,
) {
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
      type Answer = Awaited<ReturnType<MembersDependencies["list"]>>
      const show = (result: Answer) => {
        members.value = result.members
        memberCount.value = result.memberCount
      }
      // The device's copy answers when the server is unreachable, and shows while it is asked.
      const { value } = await device.through(
        READ_KEYS.members(id),
        () => dependencies.list({ groupId: id }),
        (copy) => {
          if (read !== reads || groupId.value !== id) return false
          if (copy && members.value !== null) return false
          if (copy) return show(copy.value)
          members.value = null
          memberCount.value = null
        },
      )
      if (read !== reads || groupId.value !== id) return
      show(value)
      loadError.value = null
    } catch (cause) {
      if (read !== reads || groupId.value !== id) return
      loadError.value = describeError(cause, appText(`GroupMembers.loadFailed`))
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
      memberError.value = { userId, message: describeError(cause, fallback), plan }
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
    }, appText(`GroupMembers.roleFailed`))
  }

  /** Removes a member from the group. Resolves to whether it worked. */
  function remove(userId: number): Promise<boolean> {
    return change(userId, async (id) => {
      await dependencies.removeMember({ groupId: id, userId })
      members.value = members.value?.filter((m) => m.userId !== userId) ?? null
      if (memberCount.value !== null) memberCount.value--
    }, appText(`GroupMembers.removeFailed`))
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
      leaveError.value = describeError(cause, appText(`GroupMembers.leaveFailed`))
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
        : { field: null, message: appText(`GroupTransfer.failed`) }
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
export const membersHttp: MembersDependencies = {
  async list({ groupId }) {
    const result = await apiAsUser<{ members: MemberItem[]; memberCount: number }>(
      `/api/groups/${encodeURIComponent(groupId)}/members`,
    )
    if (!result.ok) throw new ReadRefused(result.error.message, result.status, result.error.reason)
    return result.data
  },
  setRole: (input) => callCommand("group.setRole", input),
  removeMember: (input) => callCommand("group.removeMember", input),
  leave: (input) => callCommand("group.leave", input),
  // Over REST, not the socket: the password goes in this one request.
  transfer: async ({ groupId, ...body }) => {
    let response: Response
    try {
      response = await fetchAsUser(`/api/groups/${encodeURIComponent(groupId)}/transfer`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    } catch (_unreachable) {
      throw new TransferRefused(appText(`GroupTransfer.unreachable`), undefined)
    }
    if (response.ok) return
    const error = readApiError(await response.json().catch(() => null))
    // A refusal without a reason comes from the shared guards or the catch-all, whose sentence
    // was not written for this dialog.
    throw new TransferRefused(
      error?.reason !== undefined
        ? error.message
        : response.status === 429
        ? appText(`GroupTransfer.tooManyAttempts`)
        : appText(`GroupTransfer.somethingWrong`),
      error?.reason,
    )
  },
}

/** The members of the open group, over {@link membersHttp} and the device. */
export const membersStore = createMembersStore(membersHttp, localReads)
