import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createEnvReader } from "@spy4x/server/config"
import { readTelegramSetup, telegramOffNote, TelegramReceive } from "./setup.ts"

const SECRET = `s`.repeat(32)
const BOT = { TELEGRAM_BOT_TOKEN: `123:fake`, TELEGRAM_BOT_USERNAME: `seed_bot` }

describe(`readTelegramSetup`, () => {
  it(`turns the bot off when the token is unset or blank, whatever else is set`, () => {
    expect(readTelegramSetup(createEnvReader({}), `prod`)).toBeNull()
    expect(
      readTelegramSetup(
        createEnvReader({ TELEGRAM_BOT_TOKEN: `  `, TELEGRAM_POLLING: `x` }),
        `prod`,
      ),
    ).toBeNull()
    expect(telegramOffNote(null)).toContain(`TELEGRAM_BOT_TOKEN`)
  })

  it(`polls in development and takes the webhook elsewhere, unless TELEGRAM_POLLING says`, () => {
    expect(readTelegramSetup(createEnvReader(BOT), `dev`)?.receive).toBe(TelegramReceive.Polling)
    const prod = readTelegramSetup(
      createEnvReader({ ...BOT, TELEGRAM_WEBHOOK_SECRET: SECRET }),
      `prod`,
    )
    expect(prod).toMatchObject({ receive: TelegramReceive.Webhook, webhookSecret: SECRET })
    expect(readTelegramSetup(createEnvReader({ ...BOT, TELEGRAM_POLLING: `true` }), `prod`))
      .toMatchObject({ receive: TelegramReceive.Polling, webhookSecret: null })
  })

  it(`stops the start when the webhook's secret is missing or too short to resist guessing`, () => {
    expect(() => readTelegramSetup(createEnvReader(BOT), `prod`)).toThrow(`TELEGRAM_WEBHOOK_SECRET`)
    expect(() =>
      readTelegramSetup(
        createEnvReader({ ...BOT, TELEGRAM_WEBHOOK_SECRET: `s`.repeat(31) }),
        `prod`,
      )
    ).toThrow(`TELEGRAM_WEBHOOK_SECRET`)
  })

  it(`lets the worker, which only sends, start without the webhook's secret`, () => {
    expect(readTelegramSetup(createEnvReader(BOT), `prod`, { webhook: false }))
      .toMatchObject({ receive: TelegramReceive.Webhook, webhookSecret: null })
  })

  it(`stops the start when the bot's username is not a username`, () => {
    expect(() => readTelegramSetup(createEnvReader({ TELEGRAM_BOT_TOKEN: `123:fake` }), `dev`))
      .toThrow(`TELEGRAM_BOT_USERNAME`)
    expect(
      readTelegramSetup(createEnvReader({ ...BOT, TELEGRAM_BOT_USERNAME: `@seed_bot` }), `dev`)
        ?.username,
    ).toBe(`seed_bot`)
  })
})
