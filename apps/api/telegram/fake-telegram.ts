/**
 * A fake Telegram Bot API for tests: a `TelegramClient` whose calls never leave the process. Every
 * call is recorded with its method and parameters, and answered `{ ok: true }` unless `answer`
 * says otherwise.
 *
 * @module
 */

import {
  TelegramClient,
  type TelegramClientOptions,
  type TelegramUpdate,
} from "@spy4x/integrations/telegram"

/** One call the bot made. */
export interface FakeTelegramCall {
  method: string
  params: Record<string, unknown>
}

/** A Telegram user id the tests talk as. */
export const TELEGRAM_USER_ID = 7_001

/** How the fake answers a call. */
export type FakeTelegramAnswer = (call: FakeTelegramCall) => { status: number; body: unknown }

const OK: FakeTelegramAnswer = () => ({ status: 200, body: { ok: true, result: true } })

/** Client options over the fake, for code that makes its own client, and the calls it made. */
export function fakeTelegramOptions(answer: FakeTelegramAnswer = OK) {
  const calls: FakeTelegramCall[] = []
  const options: TelegramClientOptions = {
    fetcher: async (input, init) => {
      const method = String(input).split(`/`).pop()!
      const params = JSON.parse(String(init?.body ?? `{}`)) as Record<string, unknown>
      const call = { method, params }
      calls.push(call)
      const { status, body } = answer(call)
      return await Promise.resolve(Response.json(body, { status }))
    },
    retry: { maxAttempts: 1 },
  }
  /** The texts the bot sent, in order. */
  const sent = () =>
    calls.filter((call) => call.method === `sendMessage`).map((call) => call.params.text)
  return { options, calls, sent }
}

/** A client over the fake, and the calls it made. */
export function fakeTelegram(answer: FakeTelegramAnswer = OK) {
  const { options, calls, sent } = fakeTelegramOptions(answer)
  return { client: new TelegramClient({ token: `123:fake` }, options), calls, sent }
}

let nextUpdate = 1

/** A text message from {@link TELEGRAM_USER_ID}, in a private chat unless `chat` says otherwise. */
export function textUpdate(
  text: string,
  { from = TELEGRAM_USER_ID, chat = `private` }: { from?: number; chat?: string } = {},
): TelegramUpdate {
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextUpdate,
      date: 1_790_000_000,
      chat: { id: chat === `private` ? from : -100_200, type: chat },
      from: { id: from, is_bot: false, first_name: `Ada` },
      text,
    },
  } as TelegramUpdate
}

/** A press of the button carrying `data`, by {@link TELEGRAM_USER_ID} unless `from` says. */
export function callbackUpdate(
  data: string,
  { from = TELEGRAM_USER_ID, chat = `private` }: { from?: number; chat?: string } = {},
): TelegramUpdate {
  return {
    update_id: nextUpdate++,
    callback_query: {
      id: String(nextUpdate),
      from: { id: from, is_bot: false, first_name: `Ada` },
      data,
      message: {
        message_id: nextUpdate,
        date: 1_790_000_000,
        chat: { id: chat === `private` ? from : -100_200, type: chat },
        text: ``,
      },
    },
  } as TelegramUpdate
}
