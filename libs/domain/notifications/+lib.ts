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
 * sentence in {@link notificationMessage}; the writers live next to the change that causes them.
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

/** A payload field as text, or `null` when it is missing or blank. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

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

/**
 * One notification's sentence: its key in the `app` catalog, and the facts the sentence fills in.
 * The inbox and the Telegram message both say it, each in the person's language.
 */
export interface NotificationMessage {
  key: string
  /**
   * The group's name, which the sentence names as `{group}`: set for the kinds about a group, and
   * `null` when the payload lost it (the sentence then says `NotificationsScreen.someGroup`).
   */
  group?: string | null
  /** The last day the data export can be downloaded, which the sentence names as `{date}`. */
  until?: Date
}

/**
 * What to say for one notification: `You were invited to join “Family” as an editor.` A kind this
 * code does not know (a row written by a newer version) reads as a neutral line instead of failing.
 */
export function notificationMessage(
  { kind, payload }: Pick<Notification, "kind" | "payload">,
): NotificationMessage {
  const group = text(payload.groupName)
  const role = (word: unknown) => ROLE_SENTENCES[text(word) ?? `member`]
  switch (kind) {
    case NotificationKind.InvitationReceived:
      return { key: role(payload.role)?.invited ?? `NotificationsScreen.invited`, group }
    case NotificationKind.RoleChanged:
      return { key: role(payload.to)?.role ?? `NotificationsScreen.roleChanged`, group }
    case NotificationKind.RemovedFromGroup:
      return { key: `NotificationsScreen.removed`, group }
    case NotificationKind.OwnershipReceived:
      return { key: `NotificationsScreen.owned`, group }
    case NotificationKind.GuestReminder:
      return {
        key: GUEST_REMINDER_KEYS[text(payload.title) ?? ``] ?? `NotificationsScreen.reminderKeep`,
      }
    case NotificationKind.DataExportReady: {
      const until = new Date(text(payload.expiresAt) ?? ``)
      return Number.isNaN(until.getTime())
        ? { key: `NotificationsScreen.exportReady` }
        : { key: `NotificationsScreen.exportReadyUntil`, until }
    }
    default:
      return { key: `NotificationsScreen.unknown` }
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
