/**
 * Telegram (#269): a person links their Telegram account to their account here, gets their
 * notifications in the chat with the product's bot, and uses the bot's commands as themselves.
 * The rules every app shares live here; the bot runs in the API (docs/telegram.md).
 *
 * @module
 */

/**
 * The `auth_keys.method` of a linked Telegram account; its `subject` is the Telegram user id. It is
 * no sign-in method: nobody signs in with it, and the sign-in methods card does not list it.
 */
export const TELEGRAM_METHOD = `telegram`

/** How long a link code works, in minutes. Each code works once. */
export const TELEGRAM_LINK_MINUTES = 10

/** Whether the bot is on, and the person's link: the answer of `GET /api/telegram`. */
export interface TelegramStatusResponse {
  /** The bot runs here: a person can link. Off while `TELEGRAM_BOT_TOKEN` is unset. */
  enabled: boolean
  /** The bot's username without `@`, such as `seed_bot`, or `null` while the bot is off. */
  botUsername: string | null
  /** When the person linked their Telegram account, ISO 8601, or `null` while none is linked. */
  linkedAt: string | null
}

/** A new link code: the answer of `POST /api/telegram/code`. */
export interface TelegramLinkCodeResponse {
  /** What the person sends the bot as `/link <code>`. Shown once, kept nowhere but as a hash. */
  code: string
  /** ISO 8601. */
  expiresAt: string
  /** `https://t.me/<bot>?start=<code>`: opens the chat and sends the code in one tap. */
  url: string
}

/** The address that opens a chat with `botUsername` and sends `/start <code>` in it. */
export function telegramStartUrl(botUsername: string, code: string): string {
  return `https://t.me/${encodeURIComponent(botUsername)}?start=${encodeURIComponent(code)}`
}
