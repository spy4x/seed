import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupSelectedQuery } from "@domain/groups"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { NoteListQuery } from "@domain/notes"
import { BOT_TEXT, createSeedBot, menuCommands, type TelegramLinkService } from "./bot.ts"
import { createTelegramProduct } from "./commands.ts"
import type { TelegramProduct } from "./extension.ts"
import { fakeTelegram, TELEGRAM_USER_ID, textUpdate } from "./fake-telegram.ts"

const USER_ID = 42
const CODE = `42_${`a`.repeat(32)}`
const groupId = `7b6d8d6c-1af5-7f04-8ae4-b1ee5d111002`

/** Links kept in memory: a code links once, as the database's do. */
function memoryLinks(linked = false): TelegramLinkService & { linked: () => boolean } {
  const codes = new Set([CODE])
  let owner: number | null = linked ? TELEGRAM_USER_ID : null
  return {
    linked: () => owner !== null,
    account: (telegramUserId) =>
      Promise.resolve(
        telegramUserId === owner
          ? { userId: USER_ID, firstName: `Ada`, mfa: UserMFAStatus.NOT_CONFIGURED }
          : null,
      ),
    link: (code, telegramUserId) => {
      if (!codes.delete(code)) return Promise.resolve(`invalid`)
      owner = telegramUserId
      return Promise.resolve(`linked`)
    },
    unlink: (telegramUserId) => {
      const was = owner === telegramUserId
      if (was) owner = null
      return Promise.resolve(was)
    },
  }
}

function bot(
  { links = memoryLinks(), product = { commands: [] } }: {
    links?: TelegramLinkService
    product?: TelegramProduct
  } = {},
) {
  const telegram = fakeTelegram()
  const seed = createSeedBot({
    client: telegram.client,
    username: `seed_bot`,
    webAppUrl: `https://app.example.com`,
    links,
    product,
  })
  return {
    ...telegram,
    handle: (text: string, chat?: string) => seed.handleUpdate(textUpdate(text, { chat })),
  }
}

describe(`Seed's Telegram bot`, () => {
  it(`links the account with the code a t.me link sends as /start, and says so`, async () => {
    const links = memoryLinks()
    const { handle, sent } = bot({ links })

    await handle(`/start ${CODE}`)

    expect(links.linked()).toBe(true)
    expect(sent()).toEqual([BOT_TEXT.linked])
  })

  it(`refuses a code used once already, and links nothing with it`, async () => {
    const links = memoryLinks()
    const { handle, sent } = bot({ links })
    await handle(`/link ${CODE}`)
    await links.unlink(TELEGRAM_USER_ID)

    await handle(`/link ${CODE}`)

    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([BOT_TEXT.linked, BOT_TEXT.invalid])
  })

  it(`refuses to link in a group chat, where the code would be seen by others`, async () => {
    const links = memoryLinks()
    const { handle, sent } = bot({ links })

    await handle(`/link ${CODE}`, `group`)

    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([BOT_TEXT.privateOnly])
  })

  it(`unlinks with /unlink, after which a product command no longer acts`, async () => {
    const acted: Actor[] = []
    const { handle, sent } = bot({
      links: memoryLinks(true),
      product: {
        commands: [{
          name: `ping`,
          description: `Ping`,
          handler: (_ctx, a) => acted.push(a.actor),
        }],
      },
    })

    await handle(`/unlink`)
    await handle(`/ping`)

    expect(acted).toEqual([])
    expect(sent()[0]).toBe(BOT_TEXT.unlinked)
    expect(sent()[1]).toContain(BOT_TEXT.notLinked)
    expect(sent()[1]).toContain(`https://app.example.com/profile/notifications`)
  })

  it(`answers a product command in a group with the private-chat note, and runs nothing`, async () => {
    const acted: number[] = []
    const { handle, sent } = bot({
      links: memoryLinks(true),
      product: {
        commands: [{
          name: `ping`,
          description: `Ping`,
          handler: (_ctx, a) => acted.push(a.userId),
        }],
      },
    })

    await handle(`/ping`, `group`)

    expect(acted).toEqual([])
    expect(sent()).toEqual([BOT_TEXT.privateOnly])
  })

  it(`keeps Seed's /unlink, once in the menu, when a product registers a command of that name`, async () => {
    const acted: number[] = []
    const links = memoryLinks(true)
    const { handle, sent } = bot({
      links,
      product: {
        commands: [{
          name: `unlink`,
          description: `Mine`,
          handler: (_ctx, a) => acted.push(a.userId),
        }],
      },
    })

    await handle(`/unlink`)

    expect(acted).toEqual([])
    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([BOT_TEXT.unlinked])
    expect(
      menuCommands({ commands: [{ name: `unlink`, description: `Mine`, handler: () => {} }] })
        .filter(({ command }) => command === `unlink`),
    ).toHaveLength(1)
  })

  it(`lists the product's commands before Seed's in /help and in the command menu`, async () => {
    const product = {
      commands: [{ name: `add`, description: `Add a transaction`, handler: () => {} }],
    }
    const { handle, sent } = bot({ product })

    await handle(`/help`)

    expect(menuCommands(product).map((command) => command.command)).toEqual([
      `add`,
      `link`,
      `unlink`,
      `help`,
    ])
    expect(sent()[0]).toBe(
      `/add - Add a transaction\n/link - Link your account with a code from the app\n` +
        `/unlink - Stop this chat acting for your account\n/help - What I can do`,
    )
  })
})

describe(`the example product command /notes`, () => {
  it(`answers with the newest notes of the linked person's selected group, read as them`, async () => {
    const queries: unknown[] = []
    const queryBus = {
      execute: (query: unknown) => {
        queries.push(query)
        if (query instanceof GroupSelectedQuery) return Promise.resolve({ groupId, version: 1 })
        return Promise.resolve({
          notes: [{ title: `Groceries` }, { title: `` }],
          nextPageKey: null,
        })
      },
    } as unknown as Parameters<typeof createTelegramProduct>[0]["queryBus"]
    const { handle, sent } = bot({
      links: memoryLinks(true),
      product: createTelegramProduct({ queryBus }),
    })

    await handle(`/notes`)

    expect(sent()).toEqual([`• Groceries\n• Untitled`])
    const list = queries[1] as NoteListQuery
    expect(list).toBeInstanceOf(NoteListQuery)
    expect(list.data.groupId).toBe(groupId)
    expect(list.data.actor.userId).toBe(USER_ID)
  })
})
