import type { ComponentChildren, JSX } from "preact"
import { useEffect, useRef } from "preact/hooks"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { Stack } from "@spy4x/preact-ui/layout"
import { followLinkClick } from "@spy4x/preact-ui/link"
import { type Notification, NotificationKind } from "@domain/notifications"
import { PageHeader } from "@spy4x/preact-ui/page-header"
import type { Navigate } from "./progressive.tsx"
import type { Formatters } from "@spy4x/time/format"
import { useFormat, When } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { useAppText } from "./i18n.ts"

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
  /**
   * The error of the last read or write, such as an offline server: one of
   * {@link NOTIFICATION_MESSAGES}, or the API's own message.
   */
  error: string | null
  navigate?: Navigate
}

/** The messages the notifications store sets when a call failed without one, by their key. */
export const NOTIFICATION_MESSAGES = {
  load: `NotificationsScreen.loadFailed`,
  loadMore: `NotificationsScreen.loadMoreFailed`,
  read: `NotificationsScreen.readFailed`,
  readAll: `NotificationsScreen.readAllFailed`,
} as const

const MESSAGE_KEYS: readonly string[] = Object.values(NOTIFICATION_MESSAGES)

/** The sentence of an invitation and of a role change, by the role word the payload names. */
const ROLE_SENTENCES: Record<string, { invited: string; role: string }> = {
  viewer: { invited: `NotificationsScreen.invitedViewer`, role: `NotificationsScreen.roleViewer` },
  editor: { invited: `NotificationsScreen.invitedEditor`, role: `NotificationsScreen.roleEditor` },
  admin: { invited: `NotificationsScreen.invitedAdmin`, role: `NotificationsScreen.roleAdmin` },
  owner: { invited: `NotificationsScreen.invitedOwner`, role: `NotificationsScreen.roleOwner` },
  member: { invited: `NotificationsScreen.invitedMember`, role: `NotificationsScreen.roleMember` },
}

/**
 * A guest reminder's sentence, by the English title the server stored in its payload (#224): the
 * payload names no reminder kind, so its fixed title picks the translation.
 */
const GUEST_REMINDER_KEYS: Record<string, string> = {
  "Keep the note you just wrote": `NotificationsScreen.reminderFirstNote`,
  "Open this account on your other devices": `NotificationsScreen.reminderThirdVisit`,
  "Add a sign-in method to invite people": `NotificationsScreen.reminderInvite`,
}

/** A payload field as text, or `fallback` when it is missing or blank. */
function field(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback
}

/**
 * One notification in the person's language: `You were invited to join «Family» as an editor.` The
 * group's name is the person's data, isolated and never translated. A kind this code does not know
 * (a row written by a newer version) reads as a neutral line.
 */
export function notificationSentence(
  t: Translator<string>,
  format: Formatters,
  { kind, payload }: Pick<Notification, "kind" | "payload">,
): ComponentChildren {
  const withGroup = (key: string) => (
    <Rich
      parts={t.parts(key, {
        group: field(payload.groupName, t.t(`NotificationsScreen.someGroup`)),
      })}
      tags={{ group: (text) => <bdi translate={false}>{text}</bdi> }}
    />
  )
  const role = (word: unknown) => ROLE_SENTENCES[field(word, `member`)]
  switch (kind) {
    case NotificationKind.InvitationReceived:
      return withGroup(role(payload.role)?.invited ?? `NotificationsScreen.invited`)
    case NotificationKind.RoleChanged:
      return withGroup(role(payload.to)?.role ?? `NotificationsScreen.roleChanged`)
    case NotificationKind.RemovedFromGroup:
      return withGroup(`NotificationsScreen.removed`)
    case NotificationKind.OwnershipReceived:
      return withGroup(`NotificationsScreen.owned`)
    case NotificationKind.GuestReminder:
      return t.t(
        GUEST_REMINDER_KEYS[field(payload.title, ``)] ?? `NotificationsScreen.reminderKeep`,
      )
    case NotificationKind.DataExportReady: {
      const until = new Date(field(payload.expiresAt, ``))
      return Number.isNaN(until.getTime())
        ? t.t(`NotificationsScreen.exportReady`)
        : t.t(`NotificationsScreen.exportReadyUntil`, { date: format.utc().date(until) })
    }
    default:
      return t.t(`NotificationsScreen.unknown`)
  }
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
  const t = useAppText()
  const error = props.error !== null && MESSAGE_KEYS.includes(props.error)
    ? t.t(props.error)
    : props.error
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
        title={t.t(`NotificationsScreen.title`)}
        subtitle={props.unreadCount > 0
          ? t.t(`NotificationsScreen.unread`, { count: props.unreadCount })
          : undefined}
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
            {t.t(`NotificationsScreen.readAll`)}
          </Button>
        )}
      />
      <ErrorState message={error} />
      {notifications.length === 0
        ? (
          !props.error && (
            <Card>
              <EmptyState
                class="border-0 py-8"
                headingLevel={2}
                title={t.t(
                  props.loading ? `NotificationsScreen.loading` : `NotificationsScreen.empty`,
                )}
                description={props.loading ? undefined : t.t(`NotificationsScreen.emptyText`)}
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
            {t.t(
              props.loadingMore ? `NotificationsScreen.loading` : `NotificationsScreen.loadMore`,
            )}
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
  const t = useAppText()
  const sentence = notificationSentence(t, useFormat(), notification)
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
                <span class="sr-only">{t.t(`NotificationsScreen.unreadMark`)}</span>
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
