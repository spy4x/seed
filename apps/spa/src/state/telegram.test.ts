import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import type { TelegramLinkCodeResponse, TelegramStatusResponse } from "@domain/identity"
import { TELEGRAM_FAILURES } from "@ui/profile-telegram.tsx"
import { createTelegramStore, type TelegramHttp } from "./telegram.ts"

const NOW = Date.parse(`2026-12-04T10:00:00.000Z`)
const CODE: TelegramLinkCodeResponse = {
  code: `7_${`c`.repeat(32)}`,
  expiresAt: `2026-12-04T10:10:00.000Z`,
  url: `https://t.me/seed_bot?start=7_${`c`.repeat(32)}`,
}
const OFF: TelegramStatusResponse = { enabled: true, botUsername: `seed_bot`, linkedAt: null }
const LINKED: TelegramStatusResponse = { ...OFF, linkedAt: `2026-12-04T10:00:30.000Z` }

/** Answers the status reads in order, then repeats the last one. */
function http(statuses: TelegramStatusResponse[], overrides: Partial<TelegramHttp> = {}) {
  let reads = 0
  const fake: TelegramHttp = {
    status: () => {
      const data = statuses[Math.min(reads++, statuses.length - 1)]
      return Promise.resolve({ ok: true, data })
    },
    code: () => Promise.resolve({ ok: true, data: CODE }),
    unlink: () => Promise.resolve({ ok: true, data: { unlinked: true } }),
    ...overrides,
  }
  return { fake, reads: () => reads }
}

/** Lets the store's wait loop run until it has nothing left to do. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe(`the profile's Telegram store`, () => {
  it(`closes the code dialog and says so once the bot has linked the account`, async () => {
    const { fake } = http([OFF, OFF, LINKED])
    let linked = 0
    const store = createTelegramStore(fake, {
      sleep: () => Promise.resolve(),
      now: () => NOW,
      onLinked: () => linked++,
    })
    await store.load()

    await store.link()
    expect(store.code.value).toEqual(CODE)
    await settle()

    expect(store.code.value).toBeNull()
    expect(store.status.value).toEqual(LINKED)
    expect(linked).toBe(1)
  })

  it(`stops asking once the dialog is closed, and never reports a link`, async () => {
    const { fake, reads } = http([OFF])
    let linked = 0
    let release = () => {}
    const store = createTelegramStore(fake, {
      sleep: () => new Promise((resolve) => (release = () => resolve())),
      now: () => NOW,
      onLinked: () => linked++,
    })
    await store.link()

    store.closeCode()
    release()
    await settle()

    expect(reads()).toBe(0)
    expect(store.code.value).toBeNull()
    expect(linked).toBe(0)
  })

  it(`stops asking once the code has expired`, async () => {
    const { fake, reads } = http([OFF])
    let clock = NOW
    const store = createTelegramStore(fake, {
      sleep: () => ((clock += 6 * 60_000), Promise.resolve()),
      now: () => clock,
    })

    await store.link()
    await settle()

    expect(reads()).toBe(2)
  })

  it(`shows why a code could not be made, and opens no dialog`, async () => {
    const { fake } = http([OFF], { code: () => Promise.resolve({ ok: false, error: `` }) })
    const store = createTelegramStore(fake, { sleep: () => Promise.resolve(), now: () => NOW })

    await store.link()

    expect(store.code.value).toBeNull()
    expect(store.error.value).toEqual({ key: TELEGRAM_FAILURES.code })
    expect(store.pending.value).toBe(false)
  })

  it(`shows the row as not linked after an unlink`, async () => {
    const { fake } = http([LINKED])
    const store = createTelegramStore(fake)
    await store.load()

    await store.unlink()

    expect(store.status.value?.linkedAt).toBeNull()
  })
})
