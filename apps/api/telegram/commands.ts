/**
 * The product's own Telegram commands (#269, docs/telegram.md): the one file a product edits to
 * extend the bot. Each handler runs as the linked person, with their `actor` on every message it
 * dispatches, so the buses check what it may read and do as they do for the app.
 *
 * `/notes` is the example: the five newest notes of the person's selected group. A product
 * replaces it with its own, such as Financy's "add a transaction".
 *
 * @module
 */

import type { QueryBus } from "@spy4x/platform/cqrs"
import { GroupSelectedQuery } from "@domain/groups"
import { NoteListQuery } from "@domain/notes"
import type { TelegramProduct } from "./extension.ts"

/** What the product's commands dispatch through. */
export interface TelegramProductDeps {
  queryBus: Pick<QueryBus, `execute`>
}

/** How many notes `/notes` lists. */
export const NOTES_COMMAND_LIMIT = 5

/** The product's commands, button presses and conversations. */
export function createTelegramProduct({ queryBus }: TelegramProductDeps): TelegramProduct {
  return {
    commands: [
      {
        name: `notes`,
        description: `Your newest notes`,
        handler: async (ctx, { actor }) => {
          const { groupId } = await queryBus.execute(new GroupSelectedQuery({ actor }))
          if (!groupId) return await ctx.reply(`You have no group yet.`)
          const { notes } = await queryBus.execute(
            new NoteListQuery({ actor, groupId, page: { limit: NOTES_COMMAND_LIMIT } }),
          )
          if (notes.length === 0) return await ctx.reply(`No notes in this group yet.`)
          await ctx.reply(notes.map((note) => `• ${note.title || `Untitled`}`).join(`\n`))
        },
      },
    ],
  }
}
