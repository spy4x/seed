import { signal } from "@preact/signals"
import type { SelectedGroup } from "@domain/groups"
import { apiRead } from "./realtime-call.ts"
import { callCommand } from "../modules.ts"
import { isRetryable } from "@spy4x/realtime/calls"

/** What this device keeps of the selection, so the app opens on the right group with no network. */
export interface SelectionCache {
  groupId: string
  /** The person chose this group while the server could not be reached; it is not stored yet. */
  pending: boolean
}

/** What the selection store needs from the outside. Injected so tests need no network. */
export interface SelectionDependencies {
  /** The server's selected group: the same read at start-up, after a reconnect and after a hint. */
  fetch(): Promise<SelectedGroup>
  /** Stores a choice on the server, which announces it to the person's other devices. */
  send(groupId: string): Promise<SelectedGroup>
  readCache(userId: number): SelectionCache | null
  writeCache(userId: number, cache: SelectionCache | null): void
}

/**
 * Whether the outcome of a call is unknown, because the network or the socket is down or the answer
 * was late: the choice is then kept on this device and sent when the server is reachable again. An
 * answer from the server, such as "that group is gone", is final and is not kept. `fetch` rejects
 * with a `TypeError` when the network is down; an answer with an error status never does.
 */
export function isUnknownOutcome(error: unknown): boolean {
  return error instanceof TypeError || isRetryable(error)
}

/**
 * The group the person works in now. The server holds the one copy; this store shows it and caches
 * it on the device (per person) for a start with no network.
 *
 * A choice shows at once. When the server cannot be reached it stays on the device as pending, and
 * the next read sends it first, so a switch made offline is not undone by the read that follows.
 * When the server refuses (the group is gone, or the person left it), the read that follows shows
 * the group the server picked instead.
 */
export function createSelectionStore(dependencies: SelectionDependencies) {
  const groupId = signal<string | null>(null)
  const pending = signal(false)
  let userId: number | null = null
  /**
   * Moves when a choice starts and again when it ends, so a read can tell that one began or
   * finished while it was out, and that its answer may predate the choice.
   */
  let choices = 0

  function show(next: string | null, isPending: boolean): void {
    groupId.value = next
    pending.value = isPending
    if (userId !== null) {
      dependencies.writeCache(userId, next === null ? null : { groupId: next, pending: isPending })
    }
  }

  /**
   * Starts for one person: shows what this device kept, until the server answers. A choice made
   * before this ran (a page that selects as it opens, whose effect runs before the app's) is the
   * newer one, so it stays and is cached instead.
   */
  function start(forUser: number): void {
    userId = forUser
    if (groupId.value !== null) {
      dependencies.writeCache(forUser, { groupId: groupId.value, pending: pending.value })
      return
    }
    const cached = dependencies.readCache(forUser)
    groupId.value = cached?.groupId ?? null
    pending.value = cached?.pending ?? false
  }

  /** Sends a choice made while the server was out of reach. The server's refusal drops it. */
  async function flushPending(): Promise<void> {
    const wanted = groupId.value
    if (!pending.value || wanted === null) return
    try {
      const sent = await dependencies.send(wanted)
      show(sent.groupId, false)
    } catch (error) {
      if (isUnknownOutcome(error)) throw error
      pending.value = false
    }
  }

  /**
   * Shows the server's selection. When the server cannot be reached, what the device shows stays
   * and this resolves: a read with no network is not a failure. Any other failure rejects.
   */
  async function refresh(): Promise<void> {
    const seen = choices
    try {
      await flushPending()
      const server = await dependencies.fetch()
      // A choice made while this read was out is newer than the answer, which may predate it: the
      // choice stays.
      if (choices !== seen || pending.value) return
      show(server.groupId, false)
    } catch (error) {
      if (!isUnknownOutcome(error)) throw error
    }
  }

  /**
   * Switches to `next`. Shown at once; stored on the server when it can be reached, and kept as
   * pending when it cannot. Never rejects.
   */
  async function select(next: string): Promise<void> {
    if (groupId.value === next && !pending.value) return
    choices++
    show(next, true)
    try {
      const sent = await dependencies.send(next)
      choices++
      // The person may have switched again while this went out: the later choice stays.
      if (groupId.value === next) show(sent.groupId, false)
    } catch (error) {
      choices++
      if (isUnknownOutcome(error)) return
      // Refused: the choice is not on its way any more, so the server's answer may replace it.
      if (groupId.value === next) pending.value = false
      await refresh().catch(() => {})
    }
  }

  /** Signing out: nothing of the person stays on screen or on the device. */
  function reset(): void {
    if (userId !== null) dependencies.writeCache(userId, null)
    userId = null
    groupId.value = null
    pending.value = false
  }

  return { groupId, pending, start, refresh, select, reset }
}

const cacheKey = (userId: number) => `selected-group:${userId}`

/** The device cache: `localStorage`, or nothing when the browser blocks it. */
function readBrowserCache(userId: number): SelectionCache | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(cacheKey(userId)) ?? "null")
    if (typeof parsed !== "object" || parsed === null) return null
    const { groupId, pending } = parsed as Partial<SelectionCache>
    return typeof groupId === "string" ? { groupId, pending: pending === true } : null
  } catch (_error) {
    return null
  }
}

function writeBrowserCache(userId: number, cache: SelectionCache | null): void {
  try {
    if (cache) localStorage.setItem(cacheKey(userId), JSON.stringify(cache))
    else localStorage.removeItem(cacheKey(userId))
  } catch (_error) {
    // Blocked storage: the next offline start waits for the server's answer.
  }
}

const onlineSelection: SelectionDependencies = {
  async fetch() {
    const result = await apiRead<SelectedGroup>("/api/groups/selected")
    if (!result.ok) throw new Error(result.error.message)
    return result.data
  },
  send: (groupId) => callCommand("group.select", { groupId }, { attempts: 1 }),
  readCache: readBrowserCache,
  writeCache: writeBrowserCache,
}

/** The page's own store. */
export const selectionStore = createSelectionStore(onlineSelection)
