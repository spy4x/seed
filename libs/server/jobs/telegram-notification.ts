import type postgres from "postgres"
import type { TelegramClient } from "@spy4x/integrations/telegram"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { TELEGRAM_METHOD } from "@domain/identity"
import { describeNotification, type NotificationPayload } from "@domain/notifications"
import { enqueueJob, type JobHandler, OUTBOX_RETENTION_DAYS } from "./jobs.ts"

/**
 * The job that sends one notification to the person's linked Telegram chat (#269). Its aggregate
 * id is a row of `telegram_messages`.
 */
export const TELEGRAM_NOTIFICATION_JOB = `telegram.notification`

/**
 * Queues notification `notificationId` for the Telegram chat of `userId`, in the caller's
 * transaction, the notification's own: only when the person has a Telegram account linked, so
 * an account without one gets no row and no job.
 */
export async function enqueueTelegramNotification(
  tx: postgres.Sql,
  userId: number,
  notificationId: string,
): Promise<void> {
  const id = uuidV7()
  const queued = await tx`
    INSERT INTO telegram_messages (id, user_id, notification_id)
    SELECT ${id}, ${userId}, ${notificationId}
    WHERE EXISTS (
      SELECT 1 FROM auth_keys WHERE user_id = ${userId} AND method = ${TELEGRAM_METHOD}
    )
    RETURNING id
  `
  if (queued.length > 0) await enqueueJob(tx, TELEGRAM_NOTIFICATION_JOB, id, { inMs: 0 })
}

/** What the Telegram notification job needs. */
export interface TelegramNotificationDeps {
  sql: postgres.Sql
  /** `null` while the bot is off: nothing is sent and the rows go. */
  client: Pick<TelegramClient, `sendMessage`> | null
  /** The app's address, which the message's button opens the notification's page on. */
  webAppUrl: string
  /** Told when a message cannot be sent; gets no chat id and no text. */
  log: (line: string) => void
}

interface MessageRow extends postgres.Row {
  kind: string
  payload: NotificationPayload
  link: string
  chatId: string | null
}

/**
 * Sends the notification the row names to the chat of the person's linked Telegram account, as
 * the inbox writes it, with a button that opens its page. Unlinked, deleted or blocked by then,
 * or a notification gone: nothing is sent. The row goes once the job is done. Telegram refusing
 * the chat (the person blocked the bot, 403, or the chat is gone, 400) drops the message, since a
 * retry would be refused the same way; any other failure throws, so the job is retried.
 */
export function telegramNotificationJob(deps: TelegramNotificationDeps): JobHandler {
  const { sql } = deps
  return async (event) => {
    const done = () => sql`DELETE FROM telegram_messages WHERE id = ${event.aggregateId}`
    if (!deps.client) return void await done()
    const [row] = await sql<MessageRow[]>`
      SELECT n.kind, n.payload, n.link, (
        SELECT k.subject FROM auth_keys k
        JOIN users u ON u.id = k.user_id AND u.deleted_at IS NULL AND u.blocked_at IS NULL
        WHERE k.user_id = m.user_id AND k.method = ${TELEGRAM_METHOD}
      ) AS "chatId"
      FROM telegram_messages m
      JOIN notifications n ON n.id = m.notification_id
      WHERE m.id = ${event.aggregateId}
    `
    if (!row || row.chatId === null) return void await done()
    const page = new URL(row.link, deps.webAppUrl)
    const result = await deps.client.sendMessage({
      // A private chat with the bot has the person's own Telegram id.
      chat_id: row.chatId,
      text: describeNotification(row),
      // Telegram refuses a button to a plain-HTTP development host such as localhost.
      ...(page.protocol === `https:`
        ? { reply_markup: { inline_keyboard: [[{ text: `Open`, url: page.href }]] } }
        : {}),
    })
    if (!result.ok) {
      if (result.status === 400 || result.status === 403) {
        deps.log(`warn: a Telegram notification was refused by Telegram (${result.status})`)
        return void await done()
      }
      deps.log(`error: a Telegram notification was not sent and will be retried`)
      throw new Error(`Telegram notification not sent: ${result.code}`)
    }
    await done()
  }
}

/**
 * Removes the rows of messages whose job was given up or cancelled, {@link OUTBOX_RETENTION_DAYS}
 * days on; a sent message's row is gone already. Answers how many went.
 */
export async function removeStaleTelegramMessages(sql: postgres.Sql): Promise<number> {
  const removed = await sql`
    DELETE FROM telegram_messages
    WHERE created_at < now() - make_interval(days => ${OUTBOX_RETENTION_DAYS})
  `
  return removed.count
}
