/**
 * Seed's Telegram bot (#269, docs/telegram.md): linking and unlinking a Telegram account, `/help`,
 * and the product's commands from `commands.ts`, each run as the linked person. Built on the
 * router of `@spy4x/integrations/telegram`; this file holds only what is Seed's.
 *
 * Everything that acts as a person answers in a private chat only: in a group, the answer would
 * show the person's data to everyone in it.
 *
 * @module
 */

import {
  TelegramBot,
  type TelegramBotCommand,
  type TelegramClient,
  type TelegramContext,
  type TelegramConversationStore,
  type TelegramStepHandler,
} from "@spy4x/integrations/telegram"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { TELEGRAM_LINK_MINUTES, type UserMFAStatus } from "@domain/identity"
import type { TelegramAccount, TelegramAccountHandler, TelegramProduct } from "./extension.ts"

/** How a link code sent to the bot ended. */
export type TelegramLinkResult = `linked` | `already` | `taken` | `invalid`

/** What the bot reads and changes about links. */
export interface TelegramLinkService {
  /** The live, unblocked account Telegram user `telegramUserId` is linked to, or `null`. */
  account(
    telegramUserId: number,
  ): Promise<{ userId: number; firstName: string; mfa: UserMFAStatus } | null>
  /** Spends `code` and links Telegram user `telegramUserId` to the account it names. */
  link(code: string, telegramUserId: number): Promise<TelegramLinkResult>
  /** Unlinks Telegram user `telegramUserId` from their account; `false` when none was linked. */
  unlink(telegramUserId: number): Promise<boolean>
}

/** What {@link createSeedBot} takes. */
export interface SeedBotDeps {
  client: TelegramClient
  /** The bot's username without `@`. */
  username: string
  /** Where conversations are kept (Valkey). Without it, a product's conversations are left out. */
  store?: TelegramConversationStore
  /** The app's address, which the messages point to. */
  webAppUrl: string
  links: TelegramLinkService
  product: TelegramProduct
}

/** Where the person makes a link code in the app. */
export const TELEGRAM_SETTINGS_PATH = `/profile/notifications`

/** The bot's own words, so a test can name them. */
export const BOT_TEXT = {
  linked:
    `Done: this chat is linked to your account. Your notifications come here now. Send /help to see what I can do.`,
  already: `This Telegram account is already linked to your account.`,
  taken:
    `This Telegram account is linked to another account. Send /unlink first, then the code again.`,
  invalid:
    `That code does not work. It may be mistyped, used already or older than ${TELEGRAM_LINK_MINUTES} minutes. Make a new one in the app.`,
  privateOnly: `Send me that in a private chat.`,
  unlinked: `Unlinked. This chat gets no more notifications from your account.`,
  notLinked: `This Telegram account is not linked to an account.`,
  howToLink: (settingsUrl: string) =>
    `To link your account, open ${settingsUrl}, choose "Link Telegram" and send me the code it shows.`,
  hello: (name: string) =>
    `Hi${name ? ` ${name}` : ``}! Your account is linked. Send /help to see what I can do.`,
} as const

/** Seed's commands, listed after the product's in the command menu and `/help`. */
const SEED_COMMANDS: readonly TelegramBotCommand[] = [
  { command: `link`, description: `Link your account with a code from the app` },
  { command: `unlink`, description: `Stop this chat acting for your account` },
  { command: `help`, description: `What I can do` },
]

const SEED_NAMES = new Set([`start`, ...SEED_COMMANDS.map(({ command }) => command)])

/** The command menu: the product's commands, then Seed's, which a product cannot take over. */
export function menuCommands(product: TelegramProduct): TelegramBotCommand[] {
  return [
    ...product.commands.filter(({ name }) => !SEED_NAMES.has(name))
      .map(({ name, description }) => ({ command: name, description })),
    ...SEED_COMMANDS,
  ]
}

/** Whether the update came from a private chat with the bot. */
function isPrivate(ctx: TelegramContext): boolean {
  const message = ctx.update.message ?? ctx.update.callback_query?.message
  return message?.chat.type === `private`
}

/**
 * The bot with Seed's commands and the product's. Seed's commands win over a product command of
 * the same name.
 *
 * @throws {Error} When the product registers conversations and no store is given.
 */
export function createSeedBot(deps: SeedBotDeps): TelegramBot {
  const { client, links, product } = deps
  const settingsUrl = new URL(TELEGRAM_SETTINGS_PATH, deps.webAppUrl).href
  const conversations = product.conversations ?? {}
  const bot = new TelegramBot({
    client,
    username: deps.username,
    conversations: deps.store ? { store: deps.store } : undefined,
  })

  /** The linked person behind `ctx`, or `null` after telling them why not. */
  async function accountOf(ctx: TelegramContext): Promise<TelegramAccount | null> {
    if (!ctx.from) return null
    if (!isPrivate(ctx)) {
      await ctx.reply(BOT_TEXT.privateOnly)
      return null
    }
    const found = await links.account(ctx.from.id)
    if (!found) {
      await ctx.reply(`${BOT_TEXT.notLinked} ${BOT_TEXT.howToLink(settingsUrl)}`)
      return null
    }
    return {
      userId: found.userId,
      firstName: found.firstName,
      actor: {
        userId: found.userId,
        userMfa: found.mfa,
        sessionSecondFactor: SecondFactorStatus.Completed,
      },
    }
  }

  const asAccount = (handler: TelegramAccountHandler) => async (ctx: TelegramContext) => {
    const account = await accountOf(ctx)
    if (account) await handler(ctx, account)
  }

  async function link(ctx: TelegramContext, code: string): Promise<void> {
    if (!ctx.from) return
    if (!isPrivate(ctx)) return void await ctx.reply(BOT_TEXT.privateOnly)
    const result = await links.link(code, ctx.from.id)
    await ctx.reply(BOT_TEXT[result])
  }

  for (const command of product.commands) bot.command(command.name, asAccount(command.handler))
  for (const [prefix, handler] of Object.entries(product.callbacks ?? {})) {
    bot.callback(prefix, asAccount(handler))
  }
  for (const [name, steps] of Object.entries(conversations)) {
    const wrapped: Record<string, TelegramStepHandler> = {}
    for (const [step, handler] of Object.entries(steps)) {
      wrapped[step] = async (ctx, data) => {
        const account = await accountOf(ctx)
        if (!account) return { done: true }
        return await handler(ctx, data, account)
      }
    }
    bot.conversation(name, wrapped)
  }

  return bot
    .command(`start`, async (ctx) => {
      // `t.me/<bot>?start=<code>` sends the code this way.
      if (ctx.args) return await link(ctx, ctx.args)
      if (!ctx.from || !isPrivate(ctx)) return
      const account = await links.account(ctx.from.id)
      await ctx.reply(account ? BOT_TEXT.hello(account.firstName) : BOT_TEXT.howToLink(settingsUrl))
    })
    .command(`link`, async (ctx) => {
      if (ctx.args) return await link(ctx, ctx.args)
      await ctx.reply(BOT_TEXT.howToLink(settingsUrl))
    })
    .command(`unlink`, async (ctx) => {
      if (!ctx.from) return
      if (!isPrivate(ctx)) return void await ctx.reply(BOT_TEXT.privateOnly)
      await ctx.conversation.end()
      await ctx.reply((await links.unlink(ctx.from.id)) ? BOT_TEXT.unlinked : BOT_TEXT.notLinked)
    })
    .command(`help`, async (ctx) => {
      await ctx.reply(
        menuCommands(product).map(({ command, description }) => `/${command} - ${description}`)
          .join(`\n`),
      )
    })
}
