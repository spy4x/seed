// deno-lint-ignore-file ui-text/no-literal
import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { followLinkClick } from "@spy4x/preact-ui/link"
import { describeNotification, type Notification } from "@domain/notifications"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import type { Navigate } from "./progressive.tsx"
import { When } from "@spy4x/preact-ui/format"

/** One notification as the API sends it: the times are ISO timestamps, `readAt` is `null` unread. */
export type NotificationRow =
  & Omit<Notification, "readAt" | "createdAt">
  & { readAt: string | null; createdAt: string }

export interface NotificationsScreenProps {
  /** The newest first; a later page is added at the end. */
  notifications: readonly NotificationRow[]
  /** How many are unread in all pages, not only the ones shown. */
  unreadCount: number
  loading: boolean
  /** A page after the first is on its way. */
  loadingMore?: boolean
  hasMore?: boolean
  /** Reads the next page. Left out, the list offers no "Load more". */
  onLoadMore?: () => void
  /** Marks one read, as the person follows its link. */
  onRead: (id: string) => void
  /** Marks every notification read. */
  onReadAll: () => void
  /** The error of the last read or write, such as an offline server. */
  error: string | null
  navigate?: Navigate
}

/**
 * The person's inbox: one sentence per notification, when it came, and a link to what it is about.
 * The rows sit in one card, each a link; unread ones carry a dot, a heavier sentence and the word
 * "Unread" for a screen reader, never colour alone. "Mark all as read" is a
 * button in the page header, shown only while something is unread; following a link marks that
 * notification read. The button leaves once its press went through, so focus moves on to the first
 * notification's link.
 */
export function NotificationsScreen(props: NotificationsScreenProps): JSX.Element {
  const { notifications, navigate } = props
  const list = useRef<HTMLUListElement>(null)
  // Only a press of "Mark all as read" moves focus: a count that reaches zero another way (the last
  // link followed, another tab) must not take focus from where the person is.
  const readAllPressed = useRef(false)
  const anyUnread = props.unreadCount > 0
  useEffect(() => {
    if (anyUnread || !readAllPressed.current) return
    readAllPressed.current = false
    list.current?.querySelector<HTMLElement>("[data-e2e=notification-link]")?.focus()
  }, [anyUnread])
  // A refused press keeps the button, and with it the focus.
  useEffect(() => {
    if (props.error) readAllPressed.current = false
  }, [props.error])
  return (
    <Stack gap="xl">
      <PageHeader
        title="Notifications"
        subtitle={props.unreadCount > 0 ? `${props.unreadCount} unread` : undefined}
        subtitleDataE2E="notifications-unread"
        action={anyUnread && (
          <Button
            variant="outline"
            class="min-h-11 sm:min-h-9"
            onClick={() => {
              readAllPressed.current = true
              props.onReadAll()
            }}
            data-e2e="notifications-read-all"
          >
            Mark all as read
          </Button>
        )}
      />
      <ErrorState message={props.error} />
      {notifications.length === 0
        ? (
          !props.error && (
            <Card>
              <EmptyState
                class="border-0 py-8"
                headingLevel={2}
                title={props.loading ? "Loading…" : "You are all caught up."}
                description={props.loading
                  ? undefined
                  : "Invitations and changes to your groups show up here."}
              />
            </Card>
          )
        )
        : (
          <Card class="overflow-hidden">
            <ul ref={list} class="divide-y divide-subtle" data-e2e="notifications-list">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={props.onRead}
                  navigate={navigate}
                />
              ))}
            </ul>
          </Card>
        )}
      {props.hasMore && props.onLoadMore && (
        <div class="flex justify-center">
          <Button
            variant="outline"
            class="min-h-11 sm:min-h-9"
            disabled={props.loadingMore}
            onClick={props.onLoadMore}
            data-e2e="notifications-more"
          >
            {props.loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </Stack>
  )
}

/**
 * One row of the inbox, the whole row a link to what the notification is about. An unread row has
 * a dot, a heavier sentence and the word "Unread" for a screen reader, so neither colour nor weight
 * carries the meaning alone.
 */
function NotificationItem(
  { notification, onRead, navigate }: {
    notification: NotificationRow
    onRead: (id: string) => void
    navigate?: Navigate
  },
): JSX.Element {
  const unread = notification.readAt === null
  const sentence = describeNotification(notification)
  return (
    <li data-e2e={`notification-${notification.id}`} data-unread={unread ? "true" : "false"}>
      <a
        href={notification.link}
        class="flex min-h-14 items-start gap-3 px-4 py-3 hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset sm:px-6"
        data-e2e="notification-link"
        onClick={(event) => {
          // The page is opened by the browser or the router; the read is told either way.
          if (unread) onRead(notification.id)
          followLinkClick(event, { href: notification.link, navigate })
        }}
      >
        {/* A box one line of text tall centres the dot on the sentence's first line. */}
        <span aria-hidden="true" class="flex h-5 shrink-0 items-center">
          <span
            class={`size-2 rounded-full ${unread ? "bg-selected" : ""}`}
            data-e2e="notification-dot"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
          <span
            class={`line-clamp-2 min-w-0 flex-1 text-sm ${unread ? "font-medium" : "text-muted"}`}
            data-e2e="notification-text"
          >
            {unread && (
              <>
                <span class="sr-only">Unread:</span>
                {" "}
              </>
            )}
            {sentence}
          </span>
          {/* The space keeps the time a word of its own in the link's accessible name. */}{" "}
          <When class="shrink-0 text-xs text-muted" at={notification.createdAt} />
        </span>
      </a>
    </li>
  )
}
