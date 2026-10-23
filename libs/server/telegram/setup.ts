/**
 * The Telegram bot's settings (#269, docs/telegram.md), read from the environment once at start.
 * The API runs the bot; the worker only sends notifications through it. Without
 * `TELEGRAM_BOT_TOKEN` the bot is off: no route answers for it, no job sends, nothing calls
 * Telegram.
 *
 * Reads only the reader it is given: the API and the worker both use it.
 *
 * @module
 */

import type { EnvReader } from "@spy4x/server/config"

/** How the API receives the bot's updates. */
export enum TelegramReceive {
  /** Telegram calls `/api/webhooks/telegram`, with the secret in a header. Production. */
  Webhook = 1,
  /** The API asks Telegram for updates in a loop: development, where Telegram cannot reach it. */
  Polling = 2,
}

/** What the bot runs with. */
export interface TelegramSetup {
  /** The bot's token from @BotFather. A secret: it is never logged. */
  token: string
  /** The bot's username without `@`, for `t.me` links and commands addressed to it in a group. */
  username: string
  receive: TelegramReceive
  /** The webhook's secret: set with {@link TelegramReceive.Webhook}, `null` with polling. */
  webhookSecret: string | null
  /** A local Bot API server instead of `https://api.telegram.org`, or `undefined`. */
  apiBaseUrl: string | undefined
}

/** Who reads the setup: the worker sends messages only, so it needs no webhook secret. */
export interface TelegramSetupOptions {
  webhook: boolean
}

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/
const SECRET = /^[A-Za-z0-9_-]{32,256}$/

/**
 * The setup, or `null` when `TELEGRAM_BOT_TOKEN` is unset or blank. With `ENV=dev` the API polls
 * unless `TELEGRAM_POLLING=false`; elsewhere it takes the webhook unless `TELEGRAM_POLLING=true`.
 *
 * @throws Error naming the variable when the token is set but `TELEGRAM_BOT_USERNAME` is not a
 *   username, or when the webhook is in use and `TELEGRAM_WEBHOOK_SECRET` is not 32 to 256 of
 *   `A-Z a-z 0-9 _ -`: a bot that cannot run must stop the process at start, not fail later.
 */
export function readTelegramSetup(
  env: EnvReader,
  appEnv: `dev` | `prod`,
  options: TelegramSetupOptions = { webhook: true },
): TelegramSetup | null {
  const token = env.get(`TELEGRAM_BOT_TOKEN`)?.trim() ?? ``
  if (token === ``) return null
  const username = (env.get(`TELEGRAM_BOT_USERNAME`)?.trim() ?? ``).replace(/^@/, ``)
  if (!USERNAME.test(username)) {
    throw new Error(`TELEGRAM_BOT_USERNAME must be the bot's username, such as seed_bot`)
  }
  const polling = env.get(`TELEGRAM_POLLING`)?.trim()
  const receive = (polling === undefined || polling === `` ? appEnv === `dev` : polling === `true`)
    ? TelegramReceive.Polling
    : TelegramReceive.Webhook
  let webhookSecret: string | null = null
  if (receive === TelegramReceive.Webhook && options.webhook) {
    webhookSecret = env.get(`TELEGRAM_WEBHOOK_SECRET`)?.trim() ?? ``
    if (!SECRET.test(webhookSecret)) {
      throw new Error(
        `TELEGRAM_WEBHOOK_SECRET must be 32 to 256 of A-Z a-z 0-9 _ - (openssl rand -hex 32)`,
      )
    }
  }
  const apiBaseUrl = env.get(`TELEGRAM_API_URL`)?.trim() || undefined
  return { token, username, receive, webhookSecret, apiBaseUrl }
}

/** The line the API logs at start when the bot is off; `null` when it is on. */
export function telegramOffNote(setup: TelegramSetup | null): string | null {
  return setup ? null : `Telegram bot is off: TELEGRAM_BOT_TOKEN is not set (docs/telegram.md)`
}
