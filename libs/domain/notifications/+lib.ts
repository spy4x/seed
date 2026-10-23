import type { Command, Query } from "@spy4x/platform/cqrs"
import { parseBoundedInteger } from "@spy4x/platform/universal/bounded-integer"
import type { Actor } from "@domain/identity"

/** The most notifications one page holds, and the default. */
export const NOTIFICATION_PAGE_MAX = 50
export const NOTIFICATION_PAGE_DEFAULT = 20

/** A read notification is deleted by the worker's nightly cleanup this many days after it was read. */
export const NOTIFICATION_RETENTION_DAYS = 90

/**
 * An unread notification is deleted by the same cleanup this many days after it was created, so an
 * inbox nobody opens does not grow for ever.
 */
export const NOTIFICATION_UNREAD_RETENTION_DAYS = 365

/**
 * The kinds of notification the app writes, as they are stored in `notifications.kind`. Each has a
 * sentence in {@link describeNotification}; the writers live next to the change that causes them.
 */
export const NotificationKind = {
  /** An invitation was sent to an address the person has proven. */
  InvitationReceived: "invitation.received",
  /** The person's role in a group changed. */
  RoleChanged: "group.role_changed",
  /** The person was removed from a group. */
  RemovedFromGroup: "group.removed",
  /** The group's owner handed the group to the person. */
  OwnershipReceived: "group.ownership_received",
  /**
   * A guest account's reminder to add a sign-in method (#224). Its payload carries the reminder's
   * `title` and `text`, both fixed sentences of the app, never anything the person wrote.
   */
  GuestReminder: "guest.reminder",
  /** The person's data export is ready (#229). Its payload carries `expiresAt`, an ISO date. */
  DataExportReady: "account.data_export_ready",
} as const

/**
 * Short facts a notification's sentence needs: a group's name, a role word. Never a note body or an
 * address, so what a person reads in the inbox is what they could already read in the app.
 */
export type NotificationPayload = Record<string, string | number>

/** One row of a person's inbox. */
export interface Notification {
  /** A positive integer in decimal, as the database hands it out. */
  id: string
  kind: string
  payload: NotificationPayload
  /** The page the notification is about: an in-app path that begins with a single `/`. */
  link: string
  /** `null` while unread. */
  readAt: Date | null
  createdAt: Date
}

/** Where the next page starts: after this notification id, going back in time. */
export interface NotificationPageKey {
  id: string
}

export interface NotificationPage {
  limit: number
  after?: NotificationPageKey
}

export interface NotificationListResult {
  notifications: Notification[]
  nextPageKey: NotificationPageKey | null
  /** How many the person has not read, in all pages: the number the bell shows. */
  unreadCount: number
}

export type NotificationErrorCode =
  | "INVALID_CURSOR"
  | "INVALID_REQUEST"
  | "NOTIFICATION_NOT_FOUND"

export class NotificationError extends Error {
  constructor(
    public readonly code: NotificationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "NotificationError"
  }
}

/** A page of the actor's own notifications, newest first. */
export class NotificationListQuery implements
  Query<
    { actor: Actor; page: NotificationPage },
    NotificationListResult
  > {
  __resultType?: NotificationListResult
  constructor(public data: { actor: Actor; page: NotificationPage }) {}
}

/** How many notifications the actor has not read. */
export class NotificationUnreadCountQuery
  implements Query<{ actor: Actor }, { unreadCount: number }> {
  __resultType?: { unreadCount: number }
  constructor(public data: { actor: Actor }) {}
}

/**
 * Marks one of the actor's own notifications read. A notification that is not the actor's answers
 * `NOTIFICATION_NOT_FOUND`, exactly like one that does not exist, so nobody learns which ids are
 * taken. Marking a read one again changes nothing.
 */
export class NotificationMarkReadCommand
  implements Command<{ actor: Actor; id: string }, { unreadCount: number }> {
  __resultType?: { unreadCount: number }
  constructor(public data: { actor: Actor; id: string }) {}
}

/** Marks every notification of the actor read. */
export class NotificationMarkAllReadCommand
  implements Command<{ actor: Actor }, { unreadCount: number }> {
  __resultType?: { unreadCount: number }
  constructor(public data: { actor: Actor }) {}
}

/** What the handlers need from storage. Every call is scoped to `userId`: nobody reads another's. */
export interface NotificationRepository {
  list(userId: number, page: NotificationPage): Promise<NotificationListResult>
  unreadCount(userId: number): Promise<number>
  /** `false` when the user has no such notification; marking a read one again is `true`. */
  markRead(userId: number, id: string): Promise<boolean>
  markAllRead(userId: number): Promise<void>
}

/** The largest id Postgres `bigint` holds; a larger one would fail its cast. */
const MAX_BIGINT = 9223372036854775807n
const NOTIFICATION_ID = /^[1-9][0-9]{0,18}$/

/** Reads a notification id of a URL or a payload; anything else is `INVALID_REQUEST`. */
export function parseNotificationId(value: unknown): string {
  if (
    typeof value !== "string" || !NOTIFICATION_ID.test(value) || BigInt(value) > MAX_BIGINT
  ) {
    throw new NotificationError("INVALID_REQUEST", "Notification id is invalid")
  }
  return value
}

/** The `limit` of a request's query string, or the default; anything else is `INVALID_REQUEST`. */
export function parseNotificationLimit(value: string | undefined): number {
  const limit = parseBoundedInteger(value, {
    fallback: NOTIFICATION_PAGE_DEFAULT,
    max: NOTIFICATION_PAGE_MAX,
  })
  if (limit === null) {
    throw new NotificationError("INVALID_REQUEST", "Notification limit is invalid")
  }
  return limit
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback
}

/** A day as a notification sentence writes it: `30 Oct 2026`. */
const EXPORT_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a"
}

/**
 * One notification in plain language: `You were invited to join “Family” as an editor.` A kind this
 * code does not know (a row written by a newer version) reads as a neutral line instead of failing.
 */
export function describeNotification(
  notification: Pick<Notification, "kind" | "payload">,
): string {
  const { kind, payload } = notification
  const group = `“${text(payload.groupName, "a group")}”`
  switch (kind) {
    case NotificationKind.InvitationReceived: {
      const role = text(payload.role, "member")
      return `You were invited to join ${group} as ${article(role)} ${role}.`
    }
    case NotificationKind.RoleChanged: {
      const role = text(payload.to, "member")
      return `Your role in ${group} is now ${article(role)} ${role}.`
    }
    case NotificationKind.RemovedFromGroup:
      return `You were removed from ${group}.`
    case NotificationKind.OwnershipReceived:
      return `You now own ${group}.`
    case NotificationKind.GuestReminder:
      return `${text(payload.title, "Keep your account")}. ${
        text(payload.text, "Add a sign-in method to keep it.")
      }`
    case NotificationKind.DataExportReady: {
      const until = new Date(text(payload.expiresAt, ""))
      return Number.isNaN(until.getTime())
        ? "Your data is ready. Download it from your profile."
        : `Your data is ready. Download it from your profile until ${EXPORT_DAY.format(until)}.`
    }
    default:
      return "You have a new notification."
  }
}

/** The most notifications the operator area shows of one person, newest first (#427). */
export const ADMIN_NOTIFICATIONS_LIMIT = 50

/**
 * One notification as the operator sees it: its kind and whether it was read. Never its payload,
 * which names the person's groups: the operator area reads facts, not what the person was told.
 */
export interface AdminNotification {
  /** The row's id, as a string. */
  id: string
  kind: string
  /** ISO 8601. */
  createdAt: string
  /** ISO 8601, or `null` while unread. */
  readAt: string | null
}

/** The answer of `GET /api/admin/users/:id/notifications`. */
export interface AdminNotificationsResponse {
  /** The newest {@link ADMIN_NOTIFICATIONS_LIMIT}, newest first. */
  notifications: AdminNotification[]
  /** Every notification the person holds, and how many of them are unread. */
  total: number
  unread: number
}
