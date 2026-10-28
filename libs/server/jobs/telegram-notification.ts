import type postgres from "postgres"
import type { TelegramClient } from "@spy4x/integrations/telegram"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { type Catalog, createTranslator, type Translator } from "@spy4x/platform/universal/i18n"
import { createFormatters } from "@spy4x/time/format"
import { isLanguage, type Language, TELEGRAM_METHOD } from "@domain/identity"
import { notificationMessage, type NotificationPayload } from "@domain/notifications"
import en from "@i18n/app/en.json" with { type: "json" }
import ru from "@i18n/app/ru.json" with { type: "json" }
import es from "@i18n/app/es.json" with { type: "json" }
import de from "@i18n/app/de.json" with { type: "json" }
import ptBR from "@i18n/app/pt-BR.json" with { type: "json" }
import ar from "@i18n/app/ar.json" with { type: "json" }
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
  /** The person's saved interface language, `null` when it follows each device. */
  language: string | null
  /** The person's saved region format, `null` when it follows each device. */
  locale: string | null
}

/** The inbox's words, the `app` catalog, in every language: the chat says what the inbox says. */
const CATALOGS: Record<Language, Catalog> = { en, ru, es, de, "pt-BR": ptBR, ar }
const translators = new Map<Language, Translator<string>>()

/** The `app` catalog in `language`, made on first use. */
function translatorFor(language: Language): Translator<string> {
  let translator = translators.get(language)
  if (!translator) {
    translator = createTranslator({
      language,
      catalogs: [{ source: en, translation: language === `en` ? undefined : CATALOGS[language] }],
    })
    translators.set(language, translator)
  }
  return translator
}

/**
 * The message and its button in the person's saved language, the one the inbox shows on a device
 * that follows it; English when they saved none, since the server knows no device. A date is in
 * their saved region format, else the language's own.
 */
export function telegramText(
  row: Pick<MessageRow, `kind` | `payload` | `language` | `locale`>,
): { text: string; open: string } {
  const language = isLanguage(row.language) ? row.language : `en`
  const t = translatorFor(language)
  const message = notificationMessage(row)
  const values: Record<string, string> = {}
  if (message.group !== undefined) {
    values.group = message.group ?? t.t(`NotificationsScreen.someGroup`)
  }
  if (message.until) {
    const locale = row.locale ?? language
    values.date = createFormatters({ locale, timeZone: `UTC` }, {
      device: { locale, timeZone: `UTC` },
    }).date(message.until)
  }
  return { text: t.t(message.key, values), open: t.t(`TelegramNotification.open`) }
}

/**
 * Sends the notification the row names to the chat of the person's linked Telegram account, as
 * the inbox writes it and in their saved language, with a button that opens its page. Unlinked, deleted or blocked by then,
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
      ) AS "chatId", p.value->>'language' AS language, p.value->>'locale' AS locale
      FROM telegram_messages m
      JOIN notifications n ON n.id = m.notification_id
      LEFT JOIN user_preferences p ON p.user_id = m.user_id
      WHERE m.id = ${event.aggregateId}
    `
    if (!row || row.chatId === null) return void await done()
    const page = new URL(row.link, deps.webAppUrl)
    const { text, open } = telegramText(row)
    const result = await deps.client.sendMessage({
      // A private chat with the bot has the person's own Telegram id.
      chat_id: row.chatId,
      text,
      // Telegram refuses a button to a plain-HTTP development host such as localhost.
      ...(page.protocol === `https:`
        ? { reply_markup: { inline_keyboard: [[{ text: open, url: page.href }]] } }
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
