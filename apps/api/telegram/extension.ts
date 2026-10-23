/**
 * What a product adds to the Telegram bot (#269, docs/telegram.md): its commands, button presses
 * and conversations, each run as the person whose Telegram account is linked. Seed's bot owns
 * `/start`, `/link`, `/unlink` and `/help`; a product lists the rest in `commands.ts`.
 *
 * @module
 */

import type {
  TelegramContext,
  TelegramConversationData,
  TelegramStepResult,
} from "@spy4x/integrations/telegram"
import type { Actor } from "@domain/identity"

/** The person a message comes from, resolved from their linked Telegram account. */
export interface TelegramAccount {
  userId: number
  /** Their first name in the app; empty when they gave none. */
  firstName: string
  /**
   * Put this on every command and query the handler dispatches: the buses check it as for any
   * other transport. It stands in for the second factor, as the session that linked the Telegram
   * account had passed it.
   */
  actor: Actor
}

/** Handles one update from a linked person, in a private chat with the bot. */
export type TelegramAccountHandler = (
  ctx: TelegramContext,
  account: TelegramAccount,
) => unknown | Promise<unknown>

/** One step of a product's conversation; like the library's, with the person it talks to. */
export type TelegramAccountStep = (
  ctx: TelegramContext,
  data: TelegramConversationData,
  account: TelegramAccount,
) => TelegramStepResult | Promise<TelegramStepResult>

/** A product command: `/<name>`, listed in the chat's command menu with its description. */
export interface TelegramProductCommand {
  /** 1-32 lower-case letters, digits and underscores, without the slash. */
  name: string
  /** What the command menu and `/help` say it does. */
  description: string
  handler: TelegramAccountHandler
}

/** Everything a product adds to the bot. */
export interface TelegramProduct {
  commands: readonly TelegramProductCommand[]
  /** Button presses by `callback_data` prefix, as `TelegramBot.callback` routes them. */
  callbacks?: Readonly<Record<string, TelegramAccountHandler>>
  /**
   * Conversations by name, each its steps in order (the first key is the first step). A command
   * starts one with `ctx.conversation.start(name)`; state lives in Valkey for 15 minutes.
   */
  conversations?: Readonly<Record<string, Readonly<Record<string, TelegramAccountStep>>>>
}
