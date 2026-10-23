import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { encodeBase64Url } from "@std/encoding"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import type { SubscriberStore } from "@spy4x/server/subscribers"
import { createMemorySubscriberStore } from "@spy4x/server/subscribers/memory"
import type { SubscriberList } from "@domain/subscribers"
import {
  createListCrypto,
  createRecipientLimitKey,
  type SubscribersSetup,
} from "@server/subscribers/subscribers.ts"
import {
  API_URL,
  crossSiteHeaders,
  mountRoute,
  sameOriginWithoutCookieHeaders,
  WEB_APP_URL,
} from "../_testing/mutation-requests.ts"
import {
  createSubscriberRateLimits,
  SUBSCRIBE_MAILS_PER_RECIPIENT,
} from "../middlewares/subscriber-rate-limits.ts"
import {
  createSubscribersRoute,
  SUBSCRIBE_INVALID_ADDRESS,
  SUBSCRIBE_MAX_BYTES,
  SUBSCRIBE_UNKNOWN_LIST,
} from "./subscribers.ts"
import { apiError } from "../_testing/api-error.ts"

/** A throwaway secret for these tests only. */
const SETUP: SubscribersSetup = {
  secret: `route-test-subscribers-secret-0123456789abcdef`,
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

interface Built {
  app: ReturnType<typeof mountRoute>
  store: SubscriberStore
  confirmMails: [SubscriberList, string][]
  welcomeMails: [SubscriberList, string][]
  logged: string[]
}

function buildApp(
  { setup = SETUP, strictLimit = 1_000, store = createMemorySubscriberStore() }: {
    setup?: SubscribersSetup | null
    strictLimit?: number
    store?: SubscriberStore
  } = {},
): Built {
  const confirmMails: [SubscriberList, string][] = []
  const welcomeMails: [SubscriberList, string][] = []
  const logged: string[] = []
  const line = (...args: unknown[]) => void logged.push(args.map(String).join(` `))
  const route = createSubscribersRoute({
    setup,
    store: () => store,
    webAppUrl: WEB_APP_URL,
    rateLimits: createSubscriberRateLimits({
      windowMs: 60_000,
      strictLimit,
      store: memoryStore,
      recipientKey: async (email) => await (await createRecipientLimitKey(SETUP))(email),
    }),
    requestConfirmMail: (list, email) => Promise.resolve(void confirmMails.push([list, email])),
    requestWelcomeMail: (list, email) => Promise.resolve(void welcomeMails.push([list, email])),
    log: { error: line, warn: line },
  })
  return { app: mountRoute(`/subscribers`, route, null), store, confirmMails, welcomeMails, logged }
}

function subscribe(app: Built["app"], body: unknown, headers = sameOriginWithoutCookieHeaders) {
  return app.request(`${API_URL}/subscribers`, {
    method: `POST`,
    headers: { ...headers },
    body: typeof body === `string` ? body : JSON.stringify(body),
  })
}

/** Lists `email` on `news` the way a confirm does, and returns its unsubscribe token. */
async function listed(store: SubscriberStore, email: string): Promise<string> {
  const crypto = await createListCrypto(SETUP, `news`)
  const key = await crypto.subscriberKey(email)
  await store.add({
    email,
    key,
    mark: await crypto.unsubscribeMark(email),
    issuedAt: Date.now(),
    at: new Date(),
  })
  return await crypto.unsubscribeToken(email, key)
}

const linkQuery = (token: string) => `list=news&token=${encodeURIComponent(token)}`

describe(`POST /api/subscribers`, () => {
  it(`answers a listed and a new address alike and queues the same confirm mail for each`, async () => {
    const { app, store, confirmMails } = buildApp()
    await listed(store, `known@example.com`)

    const known = await subscribe(app, { email: `known@example.com`, list: `news` })
    const fresh = await subscribe(app, { email: `New@Example.com`, list: `news` })

    expect([known.status, fresh.status]).toEqual([202, 202])
    expect(await known.text()).toBe(await fresh.text())
    expect(confirmMails).toEqual([[`news`, `known@example.com`], [`news`, `new@example.com`]])
  })

  it(`refuses an address with a display name and a list it does not have, queueing nothing`, async () => {
    const { app, confirmMails } = buildApp()

    const named = await subscribe(app, { email: `"Ada" <ada@example.com>`, list: `news` })
    const unknown = await subscribe(app, { email: `ada@example.com`, list: `admin` })

    expect(named.status).toBe(400)
    expect((await apiError(named)).message).toBe(SUBSCRIBE_INVALID_ADDRESS)
    expect(unknown.status).toBe(400)
    expect((await apiError(unknown)).message).toBe(SUBSCRIBE_UNKNOWN_LIST)
    expect(confirmMails).toEqual([])
  })

  it(`answers 429 once one IP has spent its budget`, async () => {
    const { app } = buildApp({ strictLimit: 2 })
    const headers = { ...sameOriginWithoutCookieHeaders, "x-real-ip": `192.0.2.1` }
    const statuses = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const body = { email: `person${attempt}@example.com`, list: `news` }
      statuses.push((await subscribe(app, body, headers)).status)
    }
    expect(statuses).toEqual([202, 202, 429])
  })

  it(`stops mailing one address after its hourly budget but answers the same 202, headers and body`, async () => {
    const { app, confirmMails } = buildApp()
    const answers = []
    for (let attempt = 0; attempt <= SUBSCRIBE_MAILS_PER_RECIPIENT; attempt++) {
      // A fresh IP each time, so only the address's budget can run out.
      const headers = { ...sameOriginWithoutCookieHeaders, "x-real-ip": `192.0.2.${attempt + 1}` }
      const response = await subscribe(app, { email: `ada@example.com`, list: `news` }, headers)
      answers.push({
        status: response.status,
        headers: [...response.headers],
        body: await response.text(),
      })
    }
    // The answer over the budget is the normal 202, byte for byte, headers included.
    for (const answer of answers) expect(answer).toEqual(answers[0])
    expect(answers[0].status).toBe(202)
    expect(confirmMails.length).toBe(SUBSCRIBE_MAILS_PER_RECIPIENT)
  })

  it(`refuses a body over 4 KiB and a cross-site post`, async () => {
    const { app, confirmMails } = buildApp()
    const big = JSON.stringify({ email: `ada@example.com`, list: `news` }) +
      ` `.repeat(SUBSCRIBE_MAX_BYTES)

    expect((await subscribe(app, big)).status).toBe(413)
    const crossSite = await subscribe(app, { email: `ada@example.com`, list: `news` }, {
      ...crossSiteHeaders,
    })
    expect(crossSite.status).toBe(403)
    expect(confirmMails).toEqual([])
  })

  it(`refuses a post without Origin and Sec-Fetch-Site, which only one-click may send`, async () => {
    const { app, confirmMails } = buildApp()

    const response = await subscribe(app, { email: `ada@example.com`, list: `news` }, {
      "content-type": `application/json`,
    })

    expect(response.status).toBe(403)
    expect(confirmMails).toEqual([])
  })

  it(`answers 503 on every subscribe, confirm and unsubscribe route when subscriptions are off`, async () => {
    const { app, confirmMails } = buildApp({ setup: null })
    expect((await subscribe(app, { email: `ada@example.com`, list: `news` })).status).toBe(503)
    expect((await app.request(`${API_URL}/subscribers/confirm?list=news&token=t`)).status).toBe(503)
    expect((await app.request(`${API_URL}/subscribers/unsubscribe?list=news`)).status).toBe(503)
    expect(confirmMails).toEqual([])
  })

  it(`tells the website whether subscriptions are on, however often it asks`, async () => {
    const { app } = buildApp({ strictLimit: 1 })
    for (let asked = 0; asked < 3; asked++) {
      const on = await app.request(`${API_URL}/subscribers`)
      expect(on.status).toBe(200)
      expect(await on.json()).toEqual({ enabled: true })
    }

    const off = await buildApp({ setup: null }).app.request(`${API_URL}/subscribers`)
    expect(off.status).toBe(200)
    expect(await off.json()).toEqual({ enabled: false })
  })
})

describe(`confirming a subscription`, () => {
  const confirm = (app: Built["app"], body: unknown) =>
    app.request(`${API_URL}/subscribers/confirm`, {
      method: `POST`,
      headers: { ...sameOriginWithoutCookieHeaders },
      body: JSON.stringify(body),
    })

  it(`previews the link without storing anything, and never lets it be cached`, async () => {
    const { app, store } = buildApp()
    const token = await (await createListCrypto(SETUP, `news`)).confirmToken(`ada@example.com`)

    const response = await app.request(`${API_URL}/subscribers/confirm?${linkQuery(token)}`)

    expect(response.status).toBe(200)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(await response.json()).toEqual({ state: `confirm`, email: `ada@example.com` })
    expect(await store.count()).toBe(0)
  })

  it(`adds the address and queues one welcome mail, however often the link is used`, async () => {
    const { app, store, welcomeMails } = buildApp()
    const token = await (await createListCrypto(SETUP, `news`)).confirmToken(`ada@example.com`)

    const first = await confirm(app, { list: `news`, token })
    const again = await confirm(app, { list: `news`, token })

    expect(first.headers.get(`cache-control`)).toBe(`no-store`)
    expect(await first.json()).toEqual({ state: `done` })
    expect(await again.json()).toEqual({ state: `done` })
    expect((await store.list()).map((row) => row.email)).toEqual([`ada@example.com`])
    expect(welcomeMails).toEqual([[`news`, `ada@example.com`]])
  })

  it(`refuses a cross-site post and one without browser headers, storing nothing`, async () => {
    const { app, store } = buildApp()
    const token = await (await createListCrypto(SETUP, `news`)).confirmToken(`ada@example.com`)
    const post = (headers: Record<string, string>) =>
      app.request(`${API_URL}/subscribers/confirm`, {
        method: `POST`,
        headers,
        body: JSON.stringify({ list: `news`, token }),
      })

    const crossSite = await post({ ...crossSiteHeaders })
    const headerless = await post({ "content-type": `application/json` })

    expect([crossSite.status, headerless.status]).toEqual([403, 403])
    expect(await store.count()).toBe(0)
  })

  it(`refuses a forged token and stores nothing`, async () => {
    const { app, store } = buildApp()
    const other = { secret: `another-subscribers-secret-0123456789abcdef`, previousSecrets: [] }
    const forged = await (await createListCrypto(other, `news`)).confirmToken(`ada@example.com`)

    const response = await confirm(app, { list: `news`, token: forged })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({ code: `bad_request`, reason: `invalid` })
    expect(await store.count()).toBe(0)
  })

  // The library redacts the address before it logs; the last line only guards that it still does.
  it(`passes a store failure to the app's log`, async () => {
    const broken = createMemorySubscriberStore()
    broken.add = () => Promise.reject(new Error(`cannot write ada@example.com`))
    const { app, logged } = buildApp({ store: broken })
    const token = await (await createListCrypto(SETUP, `news`)).confirmToken(`ada@example.com`)

    const response = await confirm(app, { list: `news`, token })

    expect(response.status).toBe(500)
    expect(logged.length).toBeGreaterThan(0)
    expect(logged.join(`\n`)).not.toContain(`ada@example.com`)
  })
})

describe(`unsubscribing`, () => {
  const unsubscribeUrl = (token: string) => `${API_URL}/subscribers/unsubscribe?${linkQuery(token)}`

  it(`sends a person who opens the mail's link to the unsubscribe page, uncached`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(unsubscribeUrl(token))

    expect(response.status).toBe(303)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    const location = new URL(response.headers.get(`location`)!)
    expect(`${location.origin}${location.pathname}`).toBe(`${WEB_APP_URL}/unsubscribe`)
    expect(location.searchParams.get(`token`)).toBe(token)
    expect(await store.count()).toBe(1)
  })

  it(`sends that person to the website's unsubscribe page when the website is deployed`, async () => {
    const { app, store } = buildApp({ setup: { ...SETUP, siteUrl: `https://www.example.com` } })
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(unsubscribeUrl(token))

    expect(response.status).toBe(303)
    const location = new URL(response.headers.get(`location`)!)
    expect(`${location.origin}${location.pathname}`).toBe(`https://www.example.com/unsubscribe`)
    expect(location.searchParams.get(`list`)).toBe(`news`)
    expect(location.searchParams.get(`token`)).toBe(token)
  })

  it(`previews whom the link names for the page`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(
      `${API_URL}/subscribers/unsubscribe/preview?${linkQuery(token)}`,
    )

    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(await response.json()).toEqual({ state: `confirm`, email: `ada@example.com` })
  })

  it(`takes a mail client's one-click POST, which carries no browser header`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(unsubscribeUrl(token), {
      method: `POST`,
      headers: { "content-type": `application/x-www-form-urlencoded` },
      body: `List-Unsubscribe=One-Click`,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get(`cache-control`)).toBe(`no-store`)
    expect(await response.json()).toEqual({ state: `done` })
    expect(await store.count()).toBe(0)
  })

  it(`refuses a cross-site browser POST and keeps the subscriber`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(unsubscribeUrl(token), {
      method: `POST`,
      headers: {
        "content-type": `application/x-www-form-urlencoded`,
        origin: `https://attacker.example`,
        "sec-fetch-site": `cross-site`,
      },
      body: `List-Unsubscribe=One-Click`,
    })

    expect(response.status).toBe(403)
    expect(await store.count()).toBe(1)
  })

  it(`takes the page's form post, whose token is in the body`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)

    const response = await app.request(`${API_URL}/subscribers/unsubscribe?list=news`, {
      method: `POST`,
      headers: {
        ...sameOriginWithoutCookieHeaders,
        "content-type": `application/x-www-form-urlencoded`,
      },
      body: new URLSearchParams({ token }).toString(),
    })

    expect(await response.json()).toEqual({ state: `done` })
    expect(await store.count()).toBe(0)
  })

  it(`refuses a legacy unsigned token on the preview and the POST without reading the list`, async () => {
    const store = createMemorySubscriberStore()
    await listed(store, `ada@example.com`)
    let listReads = 0
    const list = store.list.bind(store)
    store.list = () => (listReads++, list())
    const { app } = buildApp({ store })
    const legacy = `${encodeBase64Url(JSON.stringify({ version: 1, payload: {} }))}.AAAA`

    const preview = await app.request(
      `${API_URL}/subscribers/unsubscribe/preview?${linkQuery(legacy)}`,
    )
    const post = await app.request(unsubscribeUrl(legacy), {
      method: `POST`,
      headers: { "content-type": `application/x-www-form-urlencoded` },
      body: `List-Unsubscribe=One-Click`,
    })

    expect([preview.status, post.status]).toEqual([404, 404])
    expect(await apiError(preview)).toMatchObject({ code: `not_found`, reason: `not-recognised` })
    expect(await apiError(post)).toMatchObject({ code: `not_found`, reason: `not-recognised` })
    expect(listReads).toBe(0)
    expect(await store.count()).toBe(1)
  })

  it(`answers a link whose address is gone the same as a forged one`, async () => {
    const { app, store } = buildApp()
    const token = await listed(store, `ada@example.com`)
    const post = () =>
      app.request(unsubscribeUrl(token), {
        method: `POST`,
        headers: { "content-type": `application/x-www-form-urlencoded` },
        body: `List-Unsubscribe=One-Click`,
      })
    await post()

    const gone = await post()
    const forged = await app.request(unsubscribeUrl(`${token}x`), { method: `POST` })

    expect([gone.status, forged.status]).toEqual([404, 404])
    expect(await gone.json()).toEqual(await forged.json())
  })
})
