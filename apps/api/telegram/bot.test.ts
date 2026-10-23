import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupSelectedQuery } from "@domain/groups"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { NoteListQuery } from "@domain/notes"
import type { TelegramAccountLabel } from "@server/auth/telegram.ts"
import { BOT_TEXT, createSeedBot, menuCommands, type TelegramLinkService } from "./bot.ts"
import { createTelegramProduct } from "./commands.ts"
import type { TelegramProduct } from "./extension.ts"
import { callbackUpdate, fakeTelegram, TELEGRAM_USER_ID, textUpdate } from "./fake-telegram.ts"

const USER_ID = 42
const CODE = `42_${`a`.repeat(32)}`
const groupId = `7b6d8d6c-1af5-7f04-8ae4-b1ee5d111002`
const ADA: TelegramAccountLabel = { firstName: `Ada`, maskedAddress: `a•••@example.com` }
const ASK =
  `Press "Link" only if it is your own account. If you did not ask for this, ignore this message.`

/**
 * Links kept in memory: a code works once and only from its Telegram user's "Link" press, as the
 * database's do.
 */
function memoryLinks(linked = false, label = ADA) {
  const codes = new Set([CODE])
  const tokens = new Map<string, number>()
  let owner: number | null = linked ? TELEGRAM_USER_ID : null
  const links: TelegramLinkService & { linked: () => boolean } = {
    linked: () => owner !== null,
    account: (telegramUserId) =>
      Promise.resolve(
        telegramUserId === owner
          ? { userId: USER_ID, firstName: `Ada`, mfa: UserMFAStatus.NOT_CONFIGURED }
          : null,
      ),
    prepare: (code, telegramUserId) => {
      if (!codes.delete(code)) return Promise.resolve(null)
      const token = `${USER_ID}_${tokens.size}`
      tokens.set(token, telegramUserId)
      return Promise.resolve({ ...label, token })
    },
    spend: (code) => (codes.delete(code), Promise.resolve()),
    link: (token, telegramUserId) => {
      if (tokens.get(token) !== telegramUserId) return Promise.resolve(`invalid`)
      tokens.delete(token)
      owner = telegramUserId
      return Promise.resolve(`linked`)
    },
    unlink: (telegramUserId) => {
      const was = owner === telegramUserId
      if (was) owner = null
      return Promise.resolve(was)
    },
  }
  return links
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
  /** The data of the "Link" button in the last message that had one. */
  const button = () => {
    const withButton = telegram.calls.filter((call) => call.params.reply_markup).at(-1)
    const markup = withButton?.params.reply_markup as
      | { inline_keyboard: { callback_data: string }[][] }
      | undefined
    return markup?.inline_keyboard[0][0].callback_data ?? ``
  }
  return {
    ...telegram,
    button,
    handle: (text: string, chat?: string) => seed.handleUpdate(textUpdate(text, { chat })),
    press: (data: string, from?: number) => seed.handleUpdate(callbackUpdate(data, { from })),
  }
}

describe(`Seed's Telegram bot`, () => {
  it(`names the account a /start code links to by first name and masked address, and links only after the Link press`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent } = bot({ links })

    await handle(`/start ${CODE}`)
    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([
      `Link this Telegram to Ada's account on app.example.com (a•••@example.com)? ${ASK}`,
    ])

    await press(button())
    expect(links.linked()).toBe(true)
    expect(sent().at(-1)).toBe(BOT_TEXT.linked)
  })

  it(`says so when the account a code links to has neither a first name nor an address`, async () => {
    const { handle, sent } = bot({
      links: memoryLinks(false, { firstName: ``, maskedAddress: null }),
    })

    await handle(`/start ${CODE}`)
    expect(sent()).toEqual([
      `Link this Telegram to an account on app.example.com with no name or address? ${ASK}`,
    ])
  })

  it(`links nothing when another Telegram user presses the Link button`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent } = bot({ links })
    await handle(`/link ${CODE}`)

    await press(button(), TELEGRAM_USER_ID + 1)

    expect(links.linked()).toBe(false)
    expect(sent().at(-1)).toBe(BOT_TEXT.invalid)
  })

  it(`refuses a code used once already, and offers no Link button for it`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent, calls } = bot({ links })
    await handle(`/link ${CODE}`)
    await press(button())
    await links.unlink(TELEGRAM_USER_ID)
    const buttons = calls.filter((call) => call.params.reply_markup).length

    await handle(`/link ${CODE}`)

    expect(links.linked()).toBe(false)
    expect(sent().at(-1)).toBe(BOT_TEXT.invalid)
    expect(calls.filter((call) => call.params.reply_markup)).toHaveLength(buttons)
  })

  it(`spends a code sent in a group, where others could read it, and links nothing`, async () => {
    const links = memoryLinks()
    const { handle, sent } = bot({ links })

    await handle(`/link ${CODE}`, `group`)
    await handle(`/link ${CODE}`)

    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([BOT_TEXT.codeSpent, BOT_TEXT.invalid])
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
