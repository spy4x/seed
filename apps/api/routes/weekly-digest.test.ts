import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { createRecipientLimitKey, type SubscribersSetup } from "@server/subscribers/subscribers.ts"
import {
  createWeeklyDigestTokens,
  type WeeklyDigestTokens,
} from "@server/notifications/weekly-digest.ts"
import { API_URL, mountRoute, WEB_APP_URL } from "../_testing/mutation-requests.ts"
import { apiError } from "../_testing/api-error.ts"
import { createSubscriberRateLimits } from "../middlewares/subscriber-rate-limits.ts"
import { createWeeklyDigestRoute, WEEKLY_DIGEST_LINKS_OFF } from "./weekly-digest.ts"

/** A throwaway secret for these tests only. */
const SETUP: SubscribersSetup = {
  secret: `digest-route-test-secret-0123456789abcdef`,
  previousSecrets: [],
}

/** A new in-process store each call, standing in for one limiter's share of Valkey. */
function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

/** The route over an in-memory set of user ids whose digest is on. */
async function build(
  { on = [7], strictLimit = 1_000, tokens }: {
    on?: number[]
    strictLimit?: number
    tokens?: WeeklyDigestTokens | null
  } = {},
) {
  const digests = new Set(on)
  const route = createWeeklyDigestRoute({
    tokens: tokens === undefined ? createWeeklyDigestTokens(SETUP) : tokens,
    webAppUrl: WEB_APP_URL,
    tokenByIp: createSubscriberRateLimits({
      windowMs: 60_000,
      strictLimit,
      store: memoryStore,
      recipientKey: async (email) => await (await createRecipientLimitKey(SETUP))(email),
    }).tokenByIp,
    turnOff: (userId) => Promise.resolve(void digests.delete(userId)),
  })
  return { app: mountRoute(`/weekly-digest`, route, null), digests }
}

const sign = (userId: number) => createWeeklyDigestTokens(SETUP).sign(userId)
const url = (token: string) =>
  `${API_URL}/weekly-digest/unsubscribe?${new URLSearchParams({ token })}`
/** A mail client's one-click POST (RFC 8058): no session, no browser header. */
const oneClick = {
  method: `POST`,
  body: `List-Unsubscribe=One-Click`,
  headers: {
    "content-type": `application/x-www-form-urlencoded`,
  },
}

describe(`weekly digest unsubscribe route`, () => {
  it(`turns the digest off on a signed-out one-click POST, and answers a second POST the same`, async () => {
    const { app, digests } = await build()
    const token = await sign(7)

    const first = await app.request(url(token), oneClick)
    const second = await app.request(url(token), oneClick)

    expect([first.status, second.status]).toEqual([200, 200])
    expect(await first.json()).toEqual({ state: `done` })
    expect(await second.json()).toEqual({ state: `done` })
    expect(first.headers.get(`cache-control`)).toBe(`no-store`)
    expect(digests.has(7)).toBe(false)
  })

  it(`answers a valid token of a person with no digest the same as one with a digest`, async () => {
    const { app } = await build({ on: [] })
    const response = await app.request(url(await sign(8)), oneClick)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: `done` })
  })

  it(`takes the app page's form post, whose token is in the body`, async () => {
    const { app, digests } = await build()
    const response = await app.request(`${API_URL}/weekly-digest/unsubscribe`, {
      method: `POST`,
      headers: {
        "content-type": `application/x-www-form-urlencoded`,
        origin: WEB_APP_URL,
        "sec-fetch-site": `same-origin`,
      },
      body: new URLSearchParams({ token: await sign(7) }).toString(),
    })
    expect(await response.json()).toEqual({ state: `done` })
    expect(digests.has(7)).toBe(false)
  })

  it(`refuses a forged, truncated or oversize token and changes nothing`, async () => {
    const { app, digests } = await build()
    const token = await sign(7)
    const forged = `${(await sign(8)).split(`.`)[0]}.${token.split(`.`)[1]}`
    for (const bad of [forged, token.slice(0, -1), `${token}${`A`.repeat(500)}`]) {
      const response = await app.request(url(bad), oneClick)
      expect(response.status).toBe(404)
      expect(await apiError(response)).toMatchObject({
        code: `not_found`,
        reason: `not-recognised`,
      })
    }
    const missing = await app.request(`${API_URL}/weekly-digest/unsubscribe`, oneClick)
    expect(missing.status).toBe(404)
    expect(digests.has(7)).toBe(true)
  })

  it(`refuses a cross-site browser POST and keeps the digest`, async () => {
    const { app, digests } = await build()
    const response = await app.request(url(await sign(7)), {
      ...oneClick,
      headers: {
        ...oneClick.headers,
        origin: `https://attacker.example`,
        "sec-fetch-site": `cross-site`,
      },
    })
    expect(response.status).toBe(403)
    expect(digests.has(7)).toBe(true)
  })

  it(`limits how many token posts one address makes`, async () => {
    const { app } = await build({ strictLimit: 2 })
    const token = await sign(7)
    const statuses = []
    for (let i = 0; i < 3; i++) statuses.push((await app.request(url(token), oneClick)).status)
    expect(statuses).toEqual([200, 200, 429])
  })

  it(`sends a person who opens the link to the app's confirm page, uncached`, async () => {
    const { app, digests } = await build()
    const token = await sign(7)
    const response = await app.request(url(token))
    expect(response.status).toBe(303)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(response.headers.get(`location`)).toBe(
      `${WEB_APP_URL}/digest/unsubscribe?${new URLSearchParams({ token })}`,
    )
    expect(digests.has(7)).toBe(true)
  })

  it(`drops an oversize token from the redirect`, async () => {
    const { app } = await build()
    const response = await app.request(url(`7.${`A`.repeat(500)}`))
    expect(response.headers.get(`location`)).toBe(`${WEB_APP_URL}/digest/unsubscribe`)
  })

  it(`answers 503 on both routes when no secret signs the links`, async () => {
    const { app, digests } = await build({ tokens: null })
    const get = await app.request(url(`7.x`))
    const post = await app.request(url(`7.x`), oneClick)
    expect([get.status, post.status]).toEqual([503, 503])
    expect(await apiError(post)).toMatchObject({ message: WEEKLY_DIGEST_LINKS_OFF })
    expect(digests.has(7)).toBe(true)
  })
})
