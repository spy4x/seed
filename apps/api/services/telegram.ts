/**
 * The Telegram bot in the API (#269, docs/telegram.md): the link codes the app hands out, the
 * links the bot makes and ends, each with its audit row, and the bot's start-up (the webhook or
 * polling, and the command menu). Off without `TELEGRAM_BOT_TOKEN`: `createTelegramRuntime` is
 * never called, and the routes answer that the bot is off.
 *
 * @module
 */

import type { Context } from "hono"
import {
  createTelegramWebhookHandler,
  pollTelegramUpdates,
  TelegramClient,
  type TelegramClientOptions,
  type TelegramConversationStore,
} from "@spy4x/integrations/telegram"
import {
  AuthAuditEventType,
  type TelegramLinkCodeResponse,
  telegramStartUrl,
  type TelegramStatusResponse,
} from "@domain/identity"
import {
  consumeTelegramConfirmToken,
  consumeTelegramLinkCode,
  issueTelegramConfirmToken,
  issueTelegramLinkCode,
  TelegramLinkOutcome,
} from "@server/auth/telegram.ts"
import { TelegramReceive, type TelegramSetup } from "@server/telegram/setup.ts"
import type { AppDbBase } from "./db-base.ts"
import { auditRow } from "./sign-in.ts"
import { createSeedBot, menuCommands, type TelegramLinkService } from "../telegram/bot.ts"
import type { TelegramProduct } from "../telegram/extension.ts"

/** The `identifier` of a link's audit row: the Telegram account, never a name or a chat. */
export function telegramIdentifier(telegramUserId: number | string): string {
  return `telegram:${telegramUserId}`
}

/** The links the bot makes and ends, each with its audit row in the same transaction. */
export function createTelegramLinkService(
  { db, now = () => new Date() }: { db: AppDbBase; now?: () => Date },
): TelegramLinkService {
  return {
    account: (telegramUserId) => db.telegram.account(telegramUserId),

    prepare: (code, telegramUserId) =>
      db.begin(async (tx) => {
        const userId = await consumeTelegramLinkCode(tx.authStore, code, now())
        if (userId === null) return null
        const label = await tx.telegram.describe(userId)
        if (label === null) return null
        const token = await issueTelegramConfirmToken(tx.authStore, userId, telegramUserId, now())
        return { ...label, token }
      }),

    spend: async (code) => {
      await consumeTelegramLinkCode(db.authStore, code, now())
    },

    link: (token, telegramUserId) =>
      db.begin(async (tx) => {
        const userId = await consumeTelegramConfirmToken(
          tx.authStore,
          token,
          telegramUserId,
          now(),
        )
        if (userId === null) return `invalid`
        const { outcome, released } = await tx.telegram.link(userId, telegramUserId)
        // The Telegram account this one replaces, or one an account awaiting deletion let go.
        for (const gone of released) {
          await tx.authAudit.insert({
            userId: gone.userId,
            eventType: AuthAuditEventType.TELEGRAM_UNLINKED,
            identifier: telegramIdentifier(gone.telegramUserId),
            ip: null,
            userAgent: null,
          })
        }
        if (outcome === TelegramLinkOutcome.Linked) {
          await tx.authAudit.insert({
            userId,
            eventType: AuthAuditEventType.TELEGRAM_LINKED,
            identifier: telegramIdentifier(telegramUserId),
            ip: null,
            userAgent: null,
          })
        }
        if (outcome === TelegramLinkOutcome.Linked) return `linked`
        if (outcome === TelegramLinkOutcome.AlreadyLinked) return `already`
        if (outcome === TelegramLinkOutcome.Taken) return `taken`
        return `invalid`
      }),

    unlink: (telegramUserId) =>
      db.begin(async (tx) => {
        const userId = await tx.telegram.unlinkTelegramUser(telegramUserId)
        if (userId === null) return false
        await tx.authAudit.insert({
          userId,
          eventType: AuthAuditEventType.TELEGRAM_UNLINKED,
          identifier: telegramIdentifier(telegramUserId),
          ip: null,
          userAgent: null,
        })
        return true
      }),
  }
}

/** What the app's Telegram settings call. */
export interface TelegramAccounts {
  status(userId: number): Promise<TelegramStatusResponse>
  /** A new link code, or `null` while the bot is off. */
  issueCode(userId: number): Promise<TelegramLinkCodeResponse | null>
  /** Unlinks the person's Telegram account, with its audit row; `false` when none was linked. */
  unlink(c: Context, userId: number): Promise<boolean>
}

/** The app's side of linking: the bot's username is `null` while the bot is off. */
export function createTelegramAccounts(
  { db, botUsername, now = () => new Date() }: {
    db: AppDbBase
    botUsername: string | null
    now?: () => Date
  },
): TelegramAccounts {
  return {
    async status(userId) {
      const link = await db.telegram.find(userId)
      return {
        enabled: botUsername !== null,
        botUsername,
        linkedAt: link?.linkedAt.toISOString() ?? null,
      }
    },

    async issueCode(userId) {
      if (botUsername === null) return null
      const { code, expiresAt } = await db.begin(async (tx) => {
        await tx.telegram.dropCodes(userId)
        return await issueTelegramLinkCode(tx.authStore, userId, now())
      })
      return { code, expiresAt: expiresAt.toISOString(), url: telegramStartUrl(botUsername, code) }
    },

    unlink: (c, userId) =>
      db.begin(async (tx) => {
        const telegramUserId = await tx.telegram.unlink(userId)
        if (telegramUserId === null) return false
        await tx.authAudit.insert(
          auditRow(
            c,
            userId,
            AuthAuditEventType.TELEGRAM_UNLINKED,
            telegramIdentifier(telegramUserId),
          ),
        )
        return true
      }),
  }
}

/** What {@link createTelegramRuntime} takes. */
export interface TelegramRuntimeDeps {
  setup: TelegramSetup
  db: AppDbBase
  /** Valkey, where conversations live. */
  store: TelegramConversationStore
  webAppUrl: string
  product: TelegramProduct
  log: (message: string, detail?: unknown) => void
  /** Tests pass a fake Telegram here. */
  clientOptions?: TelegramClientOptions
}

/** The running bot: the webhook's handler, and the start-up the API runs once. */
export interface TelegramRuntime {
  client: TelegramClient
  /** `null` while the bot polls instead. */
  webhook: ((request: Request) => Promise<Response>) | null
  /**
   * Sets the command menu, then registers the webhook at `<webAppUrl>/api/webhooks/telegram` or,
   * when polling, removes any webhook and polls until `signal` aborts. A failed call is logged and
   * never stops the API: the bot is not worth an outage.
   */
  start(signal: AbortSignal): Promise<void>
}

/** The bot over the app's database and Valkey. */
export function createTelegramRuntime(deps: TelegramRuntimeDeps): TelegramRuntime {
  const { setup, log } = deps
  const client = new TelegramClient(
    { token: setup.token, apiBaseUrl: setup.apiBaseUrl },
    deps.clientOptions,
  )
  const bot = createSeedBot({
    client,
    username: setup.username,
    store: deps.store,
    webAppUrl: deps.webAppUrl,
    links: createTelegramLinkService({ db: deps.db }),
    product: deps.product,
  })
  const onUpdate = (update: Parameters<typeof bot.handleUpdate>[0]) => bot.handleUpdate(update)
  const onError = (error: unknown) => log(`error: a Telegram update failed`, error)
  const webhook = setup.receive === TelegramReceive.Webhook && setup.webhookSecret
    ? createTelegramWebhookHandler({ secretToken: setup.webhookSecret, onUpdate, onError })
    : null

  return {
    client,
    webhook,
    async start(signal) {
      const commands = await client.setMyCommands({ commands: menuCommands(deps.product) })
      if (!commands.ok) log(`warn: the Telegram command menu was not set: ${commands.message}`)
      if (webhook) {
        const set = await client.setWebhook({
          url: new URL(`/api/webhooks/telegram`, deps.webAppUrl).href,
          secret_token: setup.webhookSecret!,
          allowed_updates: [`message`, `callback_query`],
        })
        if (!set.ok) log(`error: the Telegram webhook was not set: ${set.message}`)
        return
      }
      const removed = await client.deleteWebhook()
      if (!removed.ok) log(`warn: the Telegram webhook was not removed: ${removed.message}`)
      await pollTelegramUpdates({
        client,
        onUpdate,
        onError,
        signal,
        allowedUpdates: [`message`, `callback_query`],
      })
    },
  }
}
