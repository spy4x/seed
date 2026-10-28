import { signal } from "@preact/signals"
import { NOTIFICATION_MESSAGES, type NotificationRow } from "@ui/notifications-screen.tsx"
import { apiFetch } from "./api.ts"
import { type LocalReads, localReads, noLocalReads } from "../modules.ts"
import { READ_KEYS } from "./read-keys.ts"
import { ReadRefused } from "@spy4x/realtime/read-cache"

/** One page of the inbox as the API answers: `nextCursor` is `null` on the last page. */
export interface NotificationPageResult {
  notifications: NotificationRow[]
  nextCursor: string | null
  unreadCount: number
}

/** What the notifications store needs from the outside. Injected so tests need no network. */
export interface NotificationDependencies {
  /** Reads a page; throws an `Error` with the API's message when refused. */
  list(input: { cursor: string | null }): Promise<NotificationPageResult>
  /** Reads only the unread count, the bell's number. */
  unreadCount(): Promise<number>
  /** Marks one read and answers the new unread count. */
  markRead(id: string): Promise<number>
  /** Marks all read and answers the new unread count. */
  markAllRead(): Promise<number>
}

/**
 * The person's inbox, and the number on the bell. The count is always kept: a push hint (and the
 * start-up and every reconnect) calls {@link refresh}, which reads the count. While the page is
 * open ({@link open}), it reads the first page instead, whose answer carries the count too, so the
 * list and the badge never disagree. A read answered after a newer one began is dropped.
 */
export function createNotificationsStore(
  dependencies: NotificationDependencies,
  device: LocalReads = noLocalReads,
) {
  const notifications = signal<readonly NotificationRow[]>([])
  const nextCursor = signal<string | null>(null)
  const unreadCount = signal(0)
  const loading = signal(false)
  const loadingMore = signal(false)
  const error = signal<string | null>(null)
  let watching = false
  let reads = 0

  async function readFirstPage(): Promise<void> {
    const read = ++reads
    loading.value = true
    loadingMore.value = false
    try {
      const show = (page: NotificationPageResult) => {
        notifications.value = page.notifications
        nextCursor.value = page.nextCursor
        unreadCount.value = page.unreadCount
      }
      // The device keeps each page the person opened; the first one shows while the server is asked.
      const { value: page } = await device.through(
        READ_KEYS.notifications(null),
        () => dependencies.list({ cursor: null }),
        (copy) => {
          if (read !== reads) return false
          if (copy && notifications.value.length > 0) return false
          if (copy) return show(copy.value)
          notifications.value = []
        },
      )
      if (read !== reads) return
      show(page)
      error.value = null
    } catch (cause) {
      if (read !== reads) return
      error.value = cause instanceof Error ? cause.message : NOTIFICATION_MESSAGES.load
    } finally {
      if (read === reads) loading.value = false
    }
  }

  /** The inbox page opened: reads the first page, and keeps it fresh until {@link close}. */
  async function open(): Promise<void> {
    watching = true
    await readFirstPage()
  }

  /** The inbox page closed: later hints read only the count. */
  function close(): void {
    watching = false
  }

  /** Brings what is shown up to date: the first page while the page is open, else the count. */
  async function refresh(): Promise<void> {
    if (watching) return await readFirstPage()
    const read = ++reads
    try {
      const { value: count } = await device.through(
        READ_KEYS.unreadCount,
        () => dependencies.unreadCount(),
      )
      if (read === reads) unreadCount.value = count
    } catch (_offline) {
      // The bell keeps its last number; the next hint or reconnect reads it again.
    }
  }

  /** Reads the page after the last one shown and adds it at the end. */
  async function loadMore(): Promise<void> {
    const cursor = nextCursor.value
    if (cursor === null || loading.value || loadingMore.value) return
    const read = ++reads
    loadingMore.value = true
    error.value = null
    try {
      const { value: page } = await device.through(
        READ_KEYS.notifications(cursor),
        () => dependencies.list({ cursor }),
      )
      if (read !== reads) return
      const known = new Set(notifications.value.map((n) => n.id))
      notifications.value = [
        ...notifications.value,
        ...page.notifications.filter((n) => !known.has(n.id)),
      ]
      nextCursor.value = page.nextCursor
      unreadCount.value = page.unreadCount
    } catch (cause) {
      if (read !== reads) return
      error.value = cause instanceof Error ? cause.message : NOTIFICATION_MESSAGES.loadMore
    } finally {
      if (read === reads) loadingMore.value = false
    }
  }

  /**
   * Drops every read still on its way: its answer was asked for before this write and could undo
   * what the write shows. The spinners go with it, as a dropped read never clears them itself.
   * Answers whether the first page was still loading with nothing shown yet: the caller reads it
   * again after the write, or the page would stay empty until the next hint.
   */
  function supersedeReads(): boolean {
    const firstPagePending = loading.value && notifications.value.length === 0
    reads++
    loading.value = false
    loadingMore.value = false
    return firstPagePending
  }

  /** Marks one read: it shows as read at once, and the server's count replaces the bell's. */
  async function markRead(id: string): Promise<void> {
    const reread = supersedeReads()
    const readAt = new Date().toISOString()
    const before = notifications.value
    notifications.value = before.map((n) => n.id === id && n.readAt === null ? { ...n, readAt } : n)
    try {
      unreadCount.value = await dependencies.markRead(id)
    } catch (cause) {
      notifications.value = before
      error.value = cause instanceof Error ? cause.message : NOTIFICATION_MESSAGES.read
    }
    if (reread && watching) await readFirstPage()
  }

  /** Marks every notification read. */
  async function markAllRead(): Promise<void> {
    const reread = supersedeReads()
    const readAt = new Date().toISOString()
    const before = notifications.value
    notifications.value = before.map((n) => n.readAt === null ? { ...n, readAt } : n)
    try {
      unreadCount.value = await dependencies.markAllRead()
    } catch (cause) {
      notifications.value = before
      error.value = cause instanceof Error ? cause.message : NOTIFICATION_MESSAGES.readAll
    }
    if (reread && watching) await readFirstPage()
  }

  /** Signed out: drops everything. */
  function reset(): void {
    reads++
    watching = false
    notifications.value = []
    nextCursor.value = null
    unreadCount.value = 0
    loading.value = false
    loadingMore.value = false
    error.value = null
  }

  return {
    notifications,
    nextCursor,
    unreadCount,
    loading,
    loadingMore,
    error,
    open,
    close,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    reset,
  }
}

async function unwrap<T>(result: Awaited<ReturnType<typeof apiFetch<T>>>): Promise<T> {
  if (!result.ok) throw new ReadRefused(result.error.message, result.status, result.error.reason)
  return result.data
}

/** The inbox, read and written over REST: `/api/notifications`. */
export const notificationsHttp: NotificationDependencies = {
  async list({ cursor }) {
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : ""
    return await unwrap(await apiFetch<NotificationPageResult>(`/api/notifications${query}`))
  },
  async unreadCount() {
    const data = await unwrap(
      await apiFetch<{ unreadCount: number }>(`/api/notifications/unread-count`),
    )
    return data.unreadCount
  },
  async markRead(id) {
    const data = await unwrap(
      await apiFetch<{ unreadCount: number }>(
        `/api/notifications/${encodeURIComponent(id)}/read`,
        { method: "POST" },
      ),
    )
    return data.unreadCount
  },
  async markAllRead() {
    const data = await unwrap(
      await apiFetch<{ unreadCount: number }>(`/api/notifications/read-all`, { method: "POST" }),
    )
    return data.unreadCount
  },
}

/** The inbox, over {@link notificationsHttp} and the device. */
export const notificationsStore = createNotificationsStore(notificationsHttp, localReads)
