import type postgres from "postgres"
import {
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_UNREAD_RETENTION_DAYS,
} from "@domain/notifications"

/**
 * Deletes the notifications past their retention and returns how many. It runs in the worker's
 * nightly cleanup. A read notification goes `readDays` after it was read (90 by default,
 * {@link NOTIFICATION_RETENTION_DAYS}); an unread one goes `unreadDays` after it was created (a
 * year by default, {@link NOTIFICATION_UNREAD_RETENTION_DAYS}), so a person who never opens the
 * inbox does not grow the table without end. Ages are measured by the database's clock, as the
 * other purges are.
 */
export async function purgeNotifications(
  sql: postgres.Sql,
  readDays: number = NOTIFICATION_RETENTION_DAYS,
  unreadDays: number = NOTIFICATION_UNREAD_RETENTION_DAYS,
): Promise<number> {
  const removed = await sql`
    DELETE FROM notifications
    WHERE (read_at IS NOT NULL AND read_at < now() - make_interval(days => ${readDays}))
      OR (read_at IS NULL AND created_at < now() - make_interval(days => ${unreadDays}))
  `
  return removed.count
}
