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
import { negotiateLanguage } from "@spy4x/platform/universal/i18n"
import {
  type Language,
  LANGUAGES,
  TELEGRAM_LINK_MINUTES,
  type UserMFAStatus,
} from "@domain/identity"
import type { TelegramAccountLabel } from "@server/auth/telegram.ts"
import { isolate } from "@server/mail/mail.ts"
import { translatorFor } from "@server/telegram/words.ts"
import type { TelegramAccount, TelegramAccountHandler, TelegramProduct } from "./extension.ts"

/**
 * How a "Link" press ended. `stale`: the button no longer works, because it was used, a newer one
 * replaced it, it expired, someone else pressed it, or the account is gone.
 */
export type TelegramLinkResult = `linked` | `already` | `taken` | `stale`

/** A code the bot checked: whose account it links, and the token of its "Link" button. */
export interface TelegramPreparedLink extends TelegramAccountLabel {
  token: string
}

/** What the bot reads and changes about links. */
export interface TelegramLinkService {
  /** The live, unblocked account Telegram user `telegramUserId` is linked to, or `null`. */
  account(
    telegramUserId: number,
  ): Promise<{ userId: number; firstName: string; mfa: UserMFAStatus } | null>
  /**
   * Spends `code` and, when it was live, issues a "Link" button for Telegram user
   * `telegramUserId` that names the account. `null` for a code that does not work.
   */
  prepare(code: string, telegramUserId: number): Promise<TelegramPreparedLink | null>
  /** Spends `code` without linking: it was sent where others can read it. */
  spend(code: string): Promise<void>
  /** Spends a "Link" button's token pressed by `telegramUserId`, and links the account. */
  link(token: string, telegramUserId: number): Promise<TelegramLinkResult>
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

/** The `callback_data` prefix of the "Link" button. */
export const LINK_CALLBACK = `tglink`

/** Where the person makes a link code in the app. */
export const TELEGRAM_SETTINGS_PATH = `/profile/notifications`

/**
 * The bot's own words in `language`, from the `app` catalog, so a test can name them. A name or an
 * address inside a message is isolated, so it reads in its own direction inside Arabic.
 */
export function botText(language: Language) {
  const t = translatorFor(language)
  const minutes = { count: TELEGRAM_LINK_MINUTES }
  const button = t.t(`TelegramBot.linkButton`)
  return {
    /** The label of the "Link" button, which the confirm message names. */
    linkButton: button,
    linked: t.t(`TelegramBot.linked`),
    already: t.t(`TelegramBot.already`),
    taken: t.t(`TelegramBot.taken`),
    /** A link code that does not work. */
    invalid: t.t(`TelegramBot.invalid`, minutes),
    /** A "Link" button that no longer works. */
    stale: t.t(`TelegramBot.stale`, minutes),
    privateOnly: t.t(`TelegramBot.privateOnly`),
    codeSpent: t.t(`TelegramBot.codeSpent`),
    /** `app` is the app's host name, as the mails name the product. */
    confirm: ({ firstName, maskedAddress }: TelegramAccountLabel, app: string) => {
      const values = {
        app: isolate(app),
        button,
        ...(firstName ? { name: isolate(firstName) } : {}),
        ...(maskedAddress ? { address: isolate(maskedAddress) } : {}),
      }
      if (firstName && maskedAddress) return t.t(`TelegramBot.confirmNameAddress`, values)
      if (firstName) return t.t(`TelegramBot.confirmName`, values)
      if (maskedAddress) return t.t(`TelegramBot.confirmAddress`, values)
      return t.t(`TelegramBot.confirmAnonymous`, values)
    },
    unlinked: t.t(`TelegramBot.unlinked`),
    notLinked: t.t(`TelegramBot.notLinked`),
    howToLink: (settingsUrl: string) =>
      t.t(`TelegramBot.howToLink`, { url: settingsUrl, action: t.t(`ProfileTelegram.link`) }),
    hello: (name: string) =>
      name ? t.t(`TelegramBot.helloName`, { name: isolate(name) }) : t.t(`TelegramBot.hello`),
  }
}

/** The bot's words in the language of the Telegram user behind `ctx`, else English. */
function textOf(ctx: TelegramContext): ReturnType<typeof botText> {
  return botText(negotiateLanguage(ctx.from?.language_code, LANGUAGES, `en`))
}

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
  const app = new URL(deps.webAppUrl).host
  const conversations = product.conversations ?? {}
  const bot = new TelegramBot({
    client,
    username: deps.username,
    conversations: deps.store ? { store: deps.store } : undefined,
  })

  /** The linked person behind `ctx`, or `null` after telling them why not. */
  async function accountOf(ctx: TelegramContext): Promise<TelegramAccount | null> {
    if (!ctx.from) return null
    const text = textOf(ctx)
    if (!isPrivate(ctx)) {
      await ctx.reply(text.privateOnly)
      return null
    }
    const found = await links.account(ctx.from.id)
    if (!found) {
      await ctx.reply(`${text.notLinked} ${text.howToLink(settingsUrl)}`)
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

  /** Checks a code and asks for a "Link" press that names the account; never links at once. */
  async function prepare(ctx: TelegramContext, code: string): Promise<void> {
    if (!ctx.from) return
    const text = textOf(ctx)
    if (!isPrivate(ctx)) {
      await links.spend(code)
      return void await ctx.reply(text.codeSpent)
    }
    const prepared = await links.prepare(code, ctx.from.id)
    if (!prepared) return void await ctx.reply(text.invalid)
    await ctx.reply(text.confirm(prepared, app), {
      reply_markup: {
        inline_keyboard: [[{
          text: text.linkButton,
          callback_data: `${LINK_CALLBACK}:${prepared.token}`,
        }]],
      },
    })
  }

  /**
   * Takes the "Link" button off the message it was pressed on, so a used or stale button is not
   * pressed again. Telegram refusing it (the button is gone already) changes nothing, so the
   * answer is not checked.
   */
  async function removeButton(ctx: TelegramContext): Promise<void> {
    const message = ctx.update.callback_query?.message
    if (!message) return
    await client.call(`editMessageReplyMarkup`, {
      chat_id: message.chat.id,
      message_id: message.message_id,
    })
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
    .callback(LINK_CALLBACK, async (ctx) => {
      if (!ctx.from || !isPrivate(ctx)) return
      const result = await links.link(ctx.args, ctx.from.id)
      await removeButton(ctx)
      await ctx.reply(textOf(ctx)[result])
    })
    .command(`start`, async (ctx) => {
      // `t.me/<bot>?start=<code>` sends the code this way.
      if (ctx.args) return await prepare(ctx, ctx.args)
      if (!ctx.from || !isPrivate(ctx)) return
      const account = await links.account(ctx.from.id)
      const text = textOf(ctx)
      await ctx.reply(account ? text.hello(account.firstName) : text.howToLink(settingsUrl))
    })
    .command(`link`, async (ctx) => {
      if (ctx.args) return await prepare(ctx, ctx.args)
      await ctx.reply(textOf(ctx).howToLink(settingsUrl))
    })
    .command(`unlink`, async (ctx) => {
      if (!ctx.from) return
      const text = textOf(ctx)
      if (!isPrivate(ctx)) return void await ctx.reply(text.privateOnly)
      await ctx.conversation.end()
      await ctx.reply((await links.unlink(ctx.from.id)) ? text.unlinked : text.notLinked)
    })
    .command(`help`, async (ctx) => {
      await ctx.reply(
        menuCommands(product).map(({ command, description }) => `/${command} - ${description}`)
          .join(`\n`),
      )
    })
}
