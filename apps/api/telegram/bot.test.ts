import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { GroupSelectedQuery } from "@domain/groups"
import { type Actor, UserMFAStatus } from "@domain/identity"
import { NoteListQuery } from "@domain/notes"
import type { TelegramAccountLabel } from "@server/auth/telegram.ts"
import { botText, createSeedBot, menuCommands, type TelegramLinkService } from "./bot.ts"
import { createTelegramProduct } from "./commands.ts"
import type { TelegramProduct } from "./extension.ts"
import { callbackUpdate, fakeTelegram, TELEGRAM_USER_ID, textUpdate } from "./fake-telegram.ts"

const USER_ID = 42
const CODE = `42_${`a`.repeat(32)}`
const groupId = `7b6d8d6c-1af5-7f04-8ae4-b1ee5d111002`
const ADA: TelegramAccountLabel = { firstName: `Ada`, maskedAddress: `a•••@example.com` }
const ASK =
  `Press "Link" only if it's your own account. If you didn't ask for this, ignore this message.`
const BOT_TEXT = botText(`en`)
/** A value as the bot isolates it inside a message: between FSI and PDI. */
const iso = (value: string) => `\u2068${value}\u2069`

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
      if (tokens.get(token) !== telegramUserId) return Promise.resolve(`stale`)
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
    handle: (text: string, chat?: string, language?: string) =>
      seed.handleUpdate(textUpdate(text, { chat, language })),
    press: (data: string, from?: number, language?: string) =>
      seed.handleUpdate(callbackUpdate(data, { from, language })),
  }
}

describe(`Seed's Telegram bot`, () => {
  it(`names the account a /start code links to by first name and masked address, and links only after the Link press`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent } = bot({ links })

    await handle(`/start ${CODE}`)
    expect(links.linked()).toBe(false)
    expect(sent()).toEqual([
      `Link this Telegram to ${iso(`Ada`)}'s account on ${iso(`app.example.com`)} (${
        iso(`a•••@example.com`)
      })? ${ASK}`,
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
      `Link this Telegram to an account on ${iso(`app.example.com`)} with no name or email? ${ASK}`,
    ])
  })

  it(`names an account with an address and no first name by the masked address alone`, async () => {
    const { handle, sent } = bot({
      links: memoryLinks(false, { firstName: ``, maskedAddress: `a•••@example.com` }),
    })

    await handle(`/start ${CODE}`)
    expect(sent()).toEqual([
      `Link this Telegram to an account on ${iso(`app.example.com`)} (${
        iso(`a•••@example.com`)
      })? ${ASK}`,
    ])
  })

  it(`names an account with a first name and no address by the name alone`, async () => {
    const { handle, sent } = bot({
      links: memoryLinks(false, { firstName: `Ada`, maskedAddress: null }),
    })

    await handle(`/start ${CODE}`)
    expect(sent()).toEqual([
      `Link this Telegram to ${iso(`Ada`)}'s account on ${iso(`app.example.com`)}? ${ASK}`,
    ])
  })

  it(`asks and labels the Link button in the Telegram user's language`, async () => {
    const { handle, sent, calls } = bot()

    await handle(`/start ${CODE}`, undefined, `ru`)

    expect(sent()).toEqual([botText(`ru`).confirm(ADA, `app.example.com`)])
    expect(sent()[0]).toContain(`«Привязать»`)
    const markup = calls.at(-1)?.params.reply_markup as { inline_keyboard: { text: string }[][] }
    expect(markup.inline_keyboard[0][0].text).toBe(`Привязать`)
  })

  it(`answers in English when Telegram reports a language the app does not offer`, async () => {
    const { handle, sent } = bot()

    await handle(`/link`, undefined, `it`)

    expect(sent()).toEqual([BOT_TEXT.howToLink(`https://app.example.com/profile/notifications`)])
  })

  it(`answers a used Link button as a stale button, not as a mistyped code, and links nothing more`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent } = bot({ links })
    await handle(`/link ${CODE}`)
    const used = button()
    await press(used)
    await links.unlink(TELEGRAM_USER_ID)

    await press(used)

    expect(links.linked()).toBe(false)
    expect(sent().at(-1)).toBe(BOT_TEXT.stale)
    expect(BOT_TEXT.stale).not.toBe(BOT_TEXT.invalid)
  })

  it(`takes the Link button off its message once it is pressed, whatever the press ends in`, async () => {
    const links = memoryLinks()
    const { handle, press, button, calls } = bot({ links })
    await handle(`/link ${CODE}`)
    const data = button()

    await press(data)
    await press(data)

    const removals = calls.filter((call) => call.method === `editMessageReplyMarkup`)
    expect(removals).toHaveLength(2)
    for (const removal of removals) {
      expect(removal.params.chat_id).toBe(TELEGRAM_USER_ID)
      expect(typeof removal.params.message_id).toBe(`number`)
      expect(removal.params.reply_markup).toBeUndefined()
    }
  })

  it(`links nothing when another Telegram user presses the Link button`, async () => {
    const links = memoryLinks()
    const { handle, press, button, sent } = bot({ links })
    await handle(`/link ${CODE}`)

    await press(button(), TELEGRAM_USER_ID + 1)

    expect(links.linked()).toBe(false)
    expect(sent().at(-1)).toBe(BOT_TEXT.stale)
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
