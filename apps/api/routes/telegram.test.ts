import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono, type MiddlewareHandler } from "hono"
import type { TelegramLinkCodeResponse } from "@domain/identity"
import { TelegramReceive } from "@server/telegram/setup.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginHeaders,
  testMutationGuards,
  testSessionGuards,
} from "../_testing/mutation-requests.ts"
import type { AppDbBase } from "../services/db-base.ts"
import { createTelegramRuntime } from "../services/telegram.ts"
import { fakeTelegramOptions, textUpdate } from "../telegram/fake-telegram.ts"
import { createTelegramRoute, createTelegramWebhookRoute, TELEGRAM_OFF } from "./telegram.ts"

const SECRET = `w`.repeat(40)
const passThrough: MiddlewareHandler<APIContext> = async (_c, next) => await next()

/** The webhook over a real runtime and a fake Telegram; `/help` needs no database. */
function webhook(receive = TelegramReceive.Webhook) {
  const telegram = fakeTelegramOptions()
  const runtime = createTelegramRuntime({
    setup: {
      token: `123:fake`,
      username: `seed_bot`,
      receive,
      webhookSecret: receive === TelegramReceive.Webhook ? SECRET : null,
      apiBaseUrl: undefined,
    },
    db: {} as AppDbBase,
    store: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      del: () => Promise.resolve(),
    },
    webAppUrl: `https://app.example.com`,
    product: { commands: [] },
    log: () => {},
    clientOptions: telegram.options,
  })
  const app = new Hono<APIContext>().route(
    `/webhooks/telegram`,
    createTelegramWebhookRoute(runtime.webhook),
  )
  const post = (secret: string | null) =>
    app.request(`http://local/webhooks/telegram`, {
      method: `POST`,
      headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(textUpdate(`/help`)),
    })
  return { post, sent: telegram.sent }
}

describe(`the Telegram webhook`, () => {
  it(`handles an update that carries the secret, and the bot answers in the chat`, async () => {
    const { post, sent } = webhook()

    const response = await post(SECRET)

    expect(response.status).toBe(200)
    expect(sent()).toHaveLength(1)
  })

  it(`refuses an update without the secret or with a wrong one, and handles neither`, async () => {
    const { post, sent } = webhook()

    expect((await post(null)).status).toBe(401)
    expect((await post(`${SECRET.slice(1)}x`)).status).toBe(401)
    expect(sent()).toEqual([])
  })

  it(`is not found while the bot is off or polls`, async () => {
    const off = new Hono<APIContext>().route(`/w`, createTelegramWebhookRoute(null))
    const response = await off.request(`http://local/w`, { method: `POST`, body: `{}` })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: TELEGRAM_OFF })

    const { post, sent } = webhook(TelegramReceive.Polling)
    expect((await post(SECRET)).status).toBe(404)
    expect(sent()).toEqual([])
  })
})

const CODE: TelegramLinkCodeResponse = {
  code: `7_${`c`.repeat(32)}`,
  expiresAt: `2026-12-04T10:10:00.000Z`,
  url: `https://t.me/seed_bot?start=7_${`c`.repeat(32)}`,
}

function settings(enabled: boolean) {
  const calls: unknown[][] = []
  const route = createTelegramRoute({
    auth: testSessionGuards(),
    mutationGuards: testMutationGuards,
    limit: passThrough,
    codeLimit: async (_c, next) => (calls.push([`codeLimit`]), await next()),
    telegram: {
      status: () =>
        Promise.resolve({ enabled, botUsername: enabled ? `seed_bot` : null, linkedAt: null }),
      issueCode: (
        userId,
      ) => (calls.push([`issueCode`, userId]), Promise.resolve(enabled ? CODE : null)),
      unlink: (_c, userId) => (calls.push([`unlink`, userId]), Promise.resolve(true)),
    },
  })
  return { app: mountRoute(`/telegram`, route, buildAuthData({ user: { id: 7 } })), calls }
}

describe(`the person's Telegram routes`, () => {
  it(`hand out a link code that is never cached, after the stricter budget`, async () => {
    const { app, calls } = settings(true)

    const response = await app.request(`${API_URL}/telegram/code`, {
      method: `POST`,
      headers: sameOriginHeaders,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(await response.json()).toEqual(CODE)
    expect(calls).toEqual([[`codeLimit`], [`issueCode`, 7]])
  })

  it(`answer that the bot is off instead of a code while its token is unset`, async () => {
    const { app } = settings(false)

    const response = await app.request(`${API_URL}/telegram/code`, {
      method: `POST`,
      headers: sameOriginHeaders,
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: TELEGRAM_OFF })
  })

  it(`refuse a code or an unlink a cross-site page asks for`, async () => {
    const { app, calls } = settings(true)

    for (const method of [`POST`, `DELETE`]) {
      const path = method === `POST` ? `/telegram/code` : `/telegram`
      const response = await app.request(`${API_URL}${path}`, { method, headers: crossSiteHeaders })
      expect(response.status).toBe(403)
    }
    expect(calls.filter(([name]) => name !== `codeLimit`)).toEqual([])
  })
})
