import { signal } from "@preact/signals"
import { RealtimeRequestError } from "@spy4x/realtime"
import type { GroupColor, GroupDetails, GroupMoveAllResult, GroupRole } from "@domain/groups"
import { type PlanRefusal, readPlanRefusal } from "@domain/billing"
import { apiRead } from "./realtime-call.ts"
import {
  advanceGroupCursor,
  callCommand,
  callQuery,
  currentLayer,
  offlineGroups,
} from "../modules.ts"

/** A group as the API sends it: dates are ISO strings, the sequence a decimal string. */
export interface GroupItem {
  id: string
  name: string
  /** Absent in a list stored on the device before groups had details; read as empty. */
  description?: string
  color?: GroupColor | null
  emoji?: string | null
  role: GroupRole
  authorizationRevision: string
  changeSequence: string
  updatedAt: string
  /** How many members the group has; only the list sends it. */
  memberCount?: number
  /** The first few members, for the card's avatar stack; only the list sends them. */
  members?: { name: string }[]
}

/** A deleted group its owner can still restore; `deletedAt` is an ISO string. */
export interface DeletedGroupItem extends GroupItem {
  deletedAt: string
}

/** One page of the API's group list. */
export interface GroupPage {
  groups: GroupItem[]
  nextCursor: string | null
}

/** What the groups store needs from the outside. Injected so tests need no network. */
export interface GroupsDependencies {
  /** Reads one page of the person's groups, over REST or as the socket's `group.list` query. */
  fetchPage(cursor: string | null, via: ReadChannel): Promise<GroupPage>
  /** Reads the groups the person deleted and can still restore. */
  fetchDeleted(via: ReadChannel): Promise<{ groups: DeletedGroupItem[] }>
  /** Creates a group and returns it. */
  create(input: { id: string; name: string }): Promise<{ group: GroupItem }>
  rename(input: { groupId: string; name: string }): Promise<{ group: GroupItem }>
  /** Sets a group's description, colour and emoji. */
  updateDetails(input: GroupDetails & { groupId: string }): Promise<{ group: GroupItem }>
  /** Deletes a group, softly: its owner can restore it for 30 days. */
  remove(input: { groupId: string }): Promise<{ group: DeletedGroupItem }>
  restore(input: { groupId: string }): Promise<{ group: GroupItem }>
  /** Moves every live note of a group to another group, all or nothing. */
  moveAll(input: { groupId: string; toGroupId: string }): Promise<GroupMoveAllResult>
  /** Records that this page holds a group up to a sequence. */
  advance(groupId: string, sequence: number): void
  newId(): string
  /** What the device already holds of the list, shown before the read answers. */
  readLocal?(): Promise<readonly GroupItem[]>
}

/** The changes to an existing group the store can make. */
export type GroupAction = "rename" | "details" | "delete" | "restore" | "moveAll"

/** How a read reaches the API. */
export type ReadChannel = "rest" | "socket"

const PAGE_LIMIT = 100
/** More pages than any account has groups: a stop for a cursor loop, not a limit people meet. */
const MAX_PAGES = 100

function describe(error: unknown, fallback: string): string {
  return error instanceof RealtimeRequestError ? error.message : fallback
}

/**
 * The groups screen's state: the list, the create form and what is in flight.
 *
 * The list is always a full read of the server's answer, so a read after a missed push and a read
 * at start-up are the same code, and the list cannot drift from the server.
 */
export function createGroupsStore(dependencies: GroupsDependencies) {
  const groups = signal<readonly GroupItem[]>([])
  const deleted = signal<readonly DeletedGroupItem[]>([])
  const name = signal("")
  /** What the person typed as a group's new name, with the group it is for. */
  const renameDraft = signal<{ groupId: string; name: string } | null>(null)
  /** The group a rename, delete or restore is in flight for, and which of the three. */
  const working = signal<{ groupId: string; action: GroupAction } | null>(null)
  /** Why the last rename, delete or restore was refused. */
  const actionError = signal<
    { groupId: string; action: GroupAction; message: string; plan?: PlanRefusal } | null
  >(null)
  /** The last move of a group's data that worked, until the person closes its dialog. */
  const moved = signal<{ groupId: string; toGroupId: string; count: number } | null>(null)
  const loading = signal(false)
  const creating = signal(false)
  const error = signal<string | null>(null)
  /** The last list read failed; cleared by the next read that succeeds. */
  const loadError = signal<string | null>(null)
  let inFlight: Promise<void> | null = null
  let queued: Promise<void> | null = null

  async function readAll(via: ReadChannel): Promise<void> {
    const all: GroupItem[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await dependencies.fetchPage(cursor, via)
      all.push(...result.groups)
      cursor = result.nextCursor
      if (cursor === null) break
    }
    groups.value = all
    for (const group of all) dependencies.advance(group.id, Number(group.changeSequence))
    // The restore list is a second read of the same moment. Without a network it keeps what it
    // had: the groups above are what the page cannot do without.
    deleted.value = await dependencies.fetchDeleted(via).then(
      (result) => result.groups,
      () => deleted.value,
    )
  }

  /** Shows what the device holds while the first read runs, unless the read answered first. */
  async function showLocal(): Promise<void> {
    const local = await dependencies.readLocal?.().catch(() => undefined)
    if (local && inFlight && groups.value.length === 0) groups.value = local
  }

  function start(via: ReadChannel): Promise<void> {
    loading.value = true
    if (groups.value.length === 0) void showLocal()
    inFlight = readAll(via).then(
      () => {
        loadError.value = null
      },
      (cause) => {
        loadError.value = describe(cause, "Could not load the groups")
        throw cause
      },
    ).finally(() => {
      inFlight = null
      loading.value = false
    })
    return inFlight
  }

  /**
   * Reads every group, over REST unless told otherwise. A read that is already running may have
   * started before the change that asked for this one, so it is not joined: exactly one more read
   * is queued behind it, and every call made meanwhile shares that one.
   */
  function refresh(via: ReadChannel = "rest"): Promise<void> {
    if (!inFlight) return start(via)
    queued ??= inFlight.catch(() => {}).then(() => {
      queued = null
      return start(via)
    })
    return queued
  }

  /** The refresh button: reads over the socket, and shows a failure instead of rejecting. */
  async function refreshFromUser(): Promise<void> {
    error.value = null
    try {
      await refresh("socket")
    } catch (cause) {
      error.value = describe(cause, "Could not load the groups")
    }
  }

  async function create(): Promise<void> {
    const trimmed = name.value.trim()
    if (creating.value || trimmed.length === 0) return
    creating.value = true
    error.value = null
    try {
      const { group } = await dependencies.create({
        id: dependencies.newId(),
        name: trimmed,
      })
      groups.value = [group, ...groups.value.filter((existing) => existing.id !== group.id)]
      dependencies.advance(group.id, Number(group.changeSequence))
      name.value = ""
    } catch (cause) {
      error.value = describe(cause, "Could not create the group")
    } finally {
      creating.value = false
    }
  }

  /**
   * Runs one change of an existing group, showing it as in flight and its refusal as an error.
   * Resolves to whether it succeeded. A second change while one runs is refused.
   */
  async function change(
    groupId: string,
    action: GroupAction,
    run: () => Promise<void>,
    fallback: string,
  ): Promise<boolean> {
    if (working.value) return false
    working.value = { groupId, action }
    actionError.value = null
    try {
      await run()
      return true
    } catch (cause) {
      const plan = cause instanceof RealtimeRequestError ? readPlanRefusal(cause.details) : null
      actionError.value = {
        groupId,
        action,
        message: describe(cause, fallback),
        ...(plan && { plan }),
      }
      return false
    } finally {
      working.value = null
    }
  }

  /** Renames a group to what the person typed. Resolves to whether it worked. */
  async function rename(groupId: string): Promise<boolean> {
    const draft = renameDraft.value
    const trimmed = (draft?.groupId === groupId ? draft.name : "").trim()
    if (trimmed.length === 0) return false
    return await change(groupId, "rename", async () => {
      const { group } = await dependencies.rename({ groupId, name: trimmed })
      // A rename answers without the members, so the card keeps the ones the list sent.
      groups.value = groups.value.map((existing) =>
        existing.id === group.id ? { ...existing, ...group } : existing
      )
      renameDraft.value = null
    }, "Could not rename the group")
  }

  /** Sets a group's description, colour and emoji. Resolves to whether it worked. */
  async function updateDetails(groupId: string, details: GroupDetails): Promise<boolean> {
    return await change(groupId, "details", async () => {
      const { group } = await dependencies.updateDetails({ groupId, ...details })
      groups.value = groups.value.map((existing) =>
        existing.id === group.id ? { ...existing, ...group } : existing
      )
    }, "Could not save the details")
  }

  /** Deletes a group. Resolves to whether it worked, so the page can leave the group's settings. */
  async function remove(groupId: string): Promise<boolean> {
    return await change(groupId, "delete", async () => {
      const { group } = await dependencies.remove({ groupId })
      groups.value = groups.value.filter((existing) => existing.id !== groupId)
      deleted.value = [group, ...deleted.value.filter((existing) => existing.id !== groupId)]
    }, "Could not delete the group")
  }

  async function restore(groupId: string): Promise<boolean> {
    return await change(groupId, "restore", async () => {
      const { group } = await dependencies.restore({ groupId })
      deleted.value = deleted.value.filter((existing) => existing.id !== groupId)
      groups.value = [group, ...groups.value.filter((existing) => existing.id !== groupId)]
    }, "Could not restore the group")
  }

  /**
   * Moves everything in a group to another group. Resolves to whether it worked; `moved` then holds
   * how many items went, and the notes of both groups follow through their own change events.
   */
  async function moveAll(groupId: string, toGroupId: string): Promise<boolean> {
    return await change(groupId, "moveAll", async () => {
      moved.value = null
      const result = await dependencies.moveAll({ groupId, toGroupId })
      moved.value = { groupId, toGroupId, count: result.moved }
    }, "Could not move the data")
  }

  /** Forgets a finished move and a refused one, when their dialog closes. */
  function forgetMoveAll(): void {
    moved.value = null
    if (actionError.value?.action === "moveAll") actionError.value = null
  }

  function reset(): void {
    moved.value = null
    groups.value = []
    deleted.value = []
    renameDraft.value = null
    working.value = null
    actionError.value = null
    name.value = ""
    error.value = null
    loadError.value = null
    loading.value = false
    creating.value = false
    inFlight = null
    queued = null
  }

  return {
    groups,
    deleted,
    renameDraft,
    working,
    actionError,
    rename,
    updateDetails,
    remove,
    restore,
    moveAll,
    moved,
    forgetMoveAll,
    name,
    loading,
    creating,
    error,
    loadError,
    refresh,
    refreshFromUser,
    create,
    reset,
  }
}

/** The groups as the server serves them: reads over REST, writes over the socket. */
const onlineGroups: GroupsDependencies = {
  async fetchPage(cursor, via) {
    if (via === "socket") {
      return await callQuery<GroupPage>("group.list", {
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      })
    }
    const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
    if (cursor) query.set("cursor", cursor)
    const result = await apiRead<GroupPage>(`/api/groups?${query}`)
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  async fetchDeleted(via) {
    if (via === "socket") {
      return await callQuery<{ groups: DeletedGroupItem[] }>("group.deleted")
    }
    const result = await apiRead<{ groups: DeletedGroupItem[] }>("/api/groups/deleted")
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  create: (input) => callCommand("group.create", input),
  rename: (input) => callCommand("group.rename", input),
  updateDetails: (input) => callCommand("group.updateDetails", input),
  remove: (input) => callCommand("group.delete", input),
  restore: (input) => callCommand("group.restore", input),
  moveAll: (input) => callCommand("group.moveAll", input),
  advance: advanceGroupCursor,
  newId: () => crypto.randomUUID(),
}

/**
 * The page's own store: reads over REST (start-up and after a missed push), writes over the
 * socket, and with the offline layer running, served from the device when the network is down.
 */
export const groupsStore = createGroupsStore(offlineGroups(onlineGroups, currentLayer))
