import type { JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { followLinkClick } from "@spy4x/preact-ui/link"
import { timeAgo } from "@spy4x/platform/universal/time"
import { describeNotification, type Notification } from "@domain/notifications"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import type { Navigate } from "./progressive.tsx"

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
 * Unread ones are marked in text and in weight, never by colour alone. "Mark all as read" is a
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
    <div class="mx-auto w-full max-w-3xl">
      <Stack gap="lg">
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
              <EmptyState
                headingLevel={2}
                title={props.loading ? "Loading..." : "You are all caught up."}
                description={props.loading
                  ? undefined
                  : "Invitations and changes to your groups show up here."}
              />
            )
          )
          : (
            <ul
              ref={list}
              class="divide-y divide-subtle overflow-hidden rounded-lg border border-subtle bg-surface"
              data-e2e="notifications-list"
            >
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={props.onRead}
                  navigate={navigate}
                />
              ))}
            </ul>
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
              {props.loadingMore ? "Loading..." : "Load more"}
            </Button>
          </div>
        )}
      </Stack>
    </div>
  )
}

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
    <li
      class="flex min-h-11 items-baseline gap-3 px-4 py-3"
      data-e2e={`notification-${notification.id}`}
      data-unread={unread ? "true" : "false"}
    >
      <p
        class={`min-w-0 flex-1 text-sm ${unread ? "font-semibold" : ""}`}
        data-e2e="notification-text"
      >
        {unread && (
          <>
            <span class="sr-only">Unread:</span>
            {" "}
          </>
        )}
        {sentence}{" "}
        <a
          href={notification.link}
          class="underline"
          data-e2e="notification-link"
          // A list of links reads each by its notification, not "Open, Open, Open".
          aria-label={`Open: ${sentence}`}
          onClick={(event) => {
            // The page is opened by the browser or the router; the read is told either way.
            if (unread) onRead(notification.id)
            followLinkClick(event, { href: notification.link, navigate })
          }}
        >
          Open
        </a>
      </p>
      <time class="shrink-0 text-xs text-muted" dateTime={notification.createdAt}>
        {timeAgo(notification.createdAt)}
      </time>
    </li>
  )
}
