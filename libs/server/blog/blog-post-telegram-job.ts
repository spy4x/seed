import type { TelegramMessage, TelegramResult } from "@spy4x/integrations/telegram"
import { channelUtmSource } from "@domain/blog"
import { socialTexts } from "./social-texts.ts"
import type { AutoPoster } from "./auto-post.ts"

/**
 * The `blog.post-telegram` job's poster: the post's Telegram text, with its cover photo when it
 * has one, sent by the bot (`TELEGRAM_BOT_TOKEN`) to the channel at `https://t.me/<name>`. The
 * bot must be an administrator of that channel. Telegram has no lookup and no idempotency key, so
 * a run that may have posted is never repeated by itself ({@link AutoPoster} `once`).
 *
 * @module
 */

/** The one Bot API call the poster makes, without retries; the bot holds its token. */
export interface TelegramPostClient {
  call<T>(method: string, params: object, options: { retry: false }): Promise<TelegramResult<T>>
}

/** Telegram allows a photo's caption this many characters. */
export const TELEGRAM_CAPTION_MAX = 1024

/** A public channel's address. */
const CHANNEL = /^https:\/\/t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})\/?$/

/** The chat id of the channel `address` names (`@name` from `https://t.me/name`), or `null`. */
export function telegramChatId(address: string): string | null {
  const name = CHANNEL.exec(address.trim())?.[1]
  return name === undefined ? null : `@${name}`
}

const escapeHtml = (text: string) =>
  text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`)

/**
 * The Telegram text as HTML: escaped, with the bold title the pasted text marks `**title**`. Also
 * answers its length as Telegram counts a caption, without the tags.
 */
export function telegramHtml(text: string): { html: string; length: number } {
  const match = /^\*\*(.*?)\*\*/s.exec(text)
  const title = match?.[1] ?? null
  const rest = match ? text.slice(match[0].length) : text
  const html = title === null ? escapeHtml(rest) : `<b>${escapeHtml(title)}</b>${escapeHtml(rest)}`
  const length = Array.from(title === null ? rest : `${title}${rest}`).length
  return { html, length }
}

/**
 * Whether a failed call may still have sent the message: no answer, a broken one, or a server
 * error. A refusal Telegram explained (`4xx`) or a redirect sent nothing.
 */
export function telegramMayHaveSent(failure: { code: string; status?: number }): boolean {
  if (failure.code === `http_error`) return (failure.status ?? 500) >= 500
  return failure.code !== `redirected`
}

/** The poster, with `client` sending as the bot; `token` is only kept out of stored errors. */
export function telegramPoster(client: TelegramPostClient, token: string): AutoPoster {
  return {
    kind: `telegram`,
    mode: `once`,
    secrets: [token],
    async post({ post, channel, link, cover, siteUrl }) {
      const chatId = telegramChatId(channel.address)
      if (chatId === null) {
        return {
          problem: `the channel's address is not a public Telegram channel (https://t.me/name)`,
          uncertain: false,
        }
      }
      const utm = channelUtmSource(channel)
      const { html, length } = telegramHtml(socialTexts(post, siteUrl, utm).telegram)
      const sent = cover !== null && length <= TELEGRAM_CAPTION_MAX
        ? await client.call<TelegramMessage>(
          `sendPhoto`,
          { chat_id: chatId, photo: cover, caption: html, parse_mode: `HTML` },
          { retry: false },
        )
        : await client.call<TelegramMessage>(
          `sendMessage`,
          {
            chat_id: chatId,
            text: html,
            parse_mode: `HTML`,
            // Too long for a caption: the post's own preview, with its cover, shows above.
            link_preview_options: { url: link, prefer_large_media: true, show_above_text: true },
          },
          { retry: false },
        )
      if (sent.ok) return { url: `https://t.me/${chatId.slice(1)}/${sent.result.message_id}` }
      return { problem: sent.message, uncertain: telegramMayHaveSent(sent) }
    },
  }
}
