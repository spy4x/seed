import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { encodeBase64Url } from "@std/encoding"
import { sha256Hex } from "@spy4x/platform/tokens"
import {
  createListCrypto,
  createRecipientLimitKey,
  DEV_SUBSCRIBERS_SECRET,
  isCurrentSubscriberToken,
  readSubscribersSetup,
  subscriberConfirmLink,
  subscriberPagesUrl,
  subscriberUnsubscribeLink,
} from "./subscribers.ts"

const SECRET = `test-subscribers-secret-${`x`.repeat(32)}`
const OLD_SECRET = `old-subscribers-secret-${`y`.repeat(32)}`

function env(values: Record<string, string>) {
  return { get: (name: string) => values[name] }
}

describe("subscriber setup", () => {
  it("reads the secret and the previous secrets", () => {
    const setup = readSubscribersSetup(
      env({ SUBSCRIBERS_SECRET: SECRET, SUBSCRIBERS_PREVIOUS_SECRETS: ` ${OLD_SECRET} , ` }),
      `prod`,
    )
    expect(setup).toEqual({ secret: SECRET, previousSecrets: [OLD_SECRET] })
  })

  it("sends the mailed links to the website when it is deployed, over https outside development", () => {
    const prod = readSubscribersSetup(
      env({ SUBSCRIBERS_SECRET: SECRET, MPA_DOMAIN: `www.example.com` }),
      `prod`,
    )
    expect(prod?.siteUrl).toBe(`https://www.example.com`)
    expect(subscriberPagesUrl(prod!, `https://app.example.com`)).toBe(`https://www.example.com`)

    const dev = readSubscribersSetup(env({ MPA_DOMAIN: `www.localhost:8001` }), `dev`)
    expect(dev?.siteUrl).toBe(`http://www.localhost:8001`)
  })

  it("refuses an MPA_DOMAIN that carries a scheme instead of mailing links to the host `https`", () => {
    expect(() =>
      readSubscribersSetup(
        env({ SUBSCRIBERS_SECRET: SECRET, MPA_DOMAIN: `https://www.example.com` }),
        `prod`,
      )
    ).toThrow(`MPA_DOMAIN must be a host`)
  })

  it("keeps the mailed links on the app when the website is not deployed", () => {
    for (const MPA_DOMAIN of [undefined, ``, ` `]) {
      const values: Record<string, string> = { SUBSCRIBERS_SECRET: SECRET }
      if (MPA_DOMAIN !== undefined) values.MPA_DOMAIN = MPA_DOMAIN
      const setup = readSubscribersSetup(env(values), `prod`)
      expect(setup).toEqual({ secret: SECRET, previousSecrets: [] })
      expect(subscriberPagesUrl(setup!, `https://app.example.com`)).toBe(`https://app.example.com`)
    }
  })

  it("turns subscriptions off in production without a secret", () => {
    expect(readSubscribersSetup(env({}), `prod`)).toBeNull()
  })

  it("signs with the public development secret only in development", () => {
    expect(readSubscribersSetup(env({}), `dev`)).toEqual({
      secret: DEV_SUBSCRIBERS_SECRET,
      previousSecrets: [],
    })
  })

  it("refuses a short secret without naming its value", () => {
    const cases: Record<string, string>[] = [
      { SUBSCRIBERS_SECRET: `short-secret` },
      { SUBSCRIBERS_SECRET: SECRET, SUBSCRIBERS_PREVIOUS_SECRETS: `short-secret` },
    ]
    for (const values of cases) {
      let message = ``
      try {
        readSubscribersSetup(env(values), `prod`)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toMatch(/at least 32 printable characters/)
      expect(message).not.toContain(`short-secret`)
    }
  })

  it("refuses the cookie secret as the subscribers secret or a previous one", () => {
    expect(() =>
      readSubscribersSetup(env({ SUBSCRIBERS_SECRET: SECRET, AUTH_COOKIE_SECRET: SECRET }), `prod`)
    ).toThrow(`must differ from AUTH_COOKIE_SECRET`)
    expect(() =>
      readSubscribersSetup(
        env({
          SUBSCRIBERS_SECRET: SECRET,
          SUBSCRIBERS_PREVIOUS_SECRETS: OLD_SECRET,
          AUTH_COOKIE_SECRET: OLD_SECRET,
        }),
        `prod`,
      )
    ).toThrow(`must differ from AUTH_COOKIE_SECRET`)
  })

  it("refuses the public development secret outside development", () => {
    const values: Record<string, string>[] = [
      { SUBSCRIBERS_SECRET: DEV_SUBSCRIBERS_SECRET },
      { SUBSCRIBERS_SECRET: SECRET, SUBSCRIBERS_PREVIOUS_SECRETS: DEV_SUBSCRIBERS_SECRET },
    ]
    for (const value of values) {
      expect(() => readSubscribersSetup(env(value), `prod`)).toThrow(`development secret`)
      expect(readSubscribersSetup(env(value), `dev`)).not.toBeNull()
    }
  })

  it("an unsubscribe token signed before a rotation still verifies after it, for its list only", async () => {
    const before = await createListCrypto({ secret: OLD_SECRET, previousSecrets: [] }, `news`)
    const after = await createListCrypto({ secret: SECRET, previousSecrets: [OLD_SECRET] }, `news`)
    const key = await before.subscriberKey(`ada@example.com`)
    const token = await before.unsubscribeToken(`ada@example.com`, key)
    const subscriber = { email: `ada@example.com`, key, subscribedAt: new Date(0) }
    const findByKey = (wanted: string) => Promise.resolve(wanted === key ? subscriber : undefined)

    expect(
      await after.verifyUnsubscribeToken(token, { findByKey, list: () => Promise.resolve([]) }),
    )
      .toEqual(subscriber)
    // Previous secrets are derived per list too: an old token for another list stays refused.
    const otherBefore = await createListCrypto(
      { secret: OLD_SECRET, previousSecrets: [] },
      `other` as `news`,
    )
    const otherToken = await otherBefore.unsubscribeToken(`ada@example.com`, key)
    expect(
      await after.verifyUnsubscribeToken(otherToken, {
        findByKey,
        list: () => Promise.resolve([]),
      }),
    ).toBeUndefined()
    // A confirm link is short-lived and is checked with the current secret only.
    const confirm = await before.confirmToken(`ada@example.com`)
    expect(await after.verifyConfirmToken(confirm)).toEqual({ ok: false, reason: `invalid` })
  })

  it("a confirm token for one list does not verify for another", async () => {
    const setup = { secret: SECRET, previousSecrets: [] }
    const news = await createListCrypto(setup, `news`)
    // A second list, as an app that adds one would have it.
    const other = await createListCrypto(setup, `other` as `news`)
    const token = await news.confirmToken(`ada@example.com`)
    expect((await news.verifyConfirmToken(token)).ok).toBe(true)
    expect(await other.verifyConfirmToken(token)).toEqual({ ok: false, reason: `invalid` })
  })

  it("knows the token format it signs and refuses a legacy or broken one", async () => {
    const crypto = await createListCrypto({ secret: SECRET, previousSecrets: [] }, `news`)
    const key = await crypto.subscriberKey(`ada@example.com`)
    const legacy = `${encodeBase64Url(JSON.stringify({ version: 1, payload: {} }))}.AAAA`

    expect(isCurrentSubscriberToken(await crypto.unsubscribeToken(`ada@example.com`, key)))
      .toBe(true)
    expect(isCurrentSubscriberToken(await crypto.confirmToken(`ada@example.com`))).toBe(true)
    for (const token of [legacy, `not-a-token`, `!!!.x`, ``]) {
      expect(isCurrentSubscriberToken(token)).toBe(false)
    }
  })

  it("keys the per-address budget with a keyed hash, never the address's plain hash", async () => {
    const key = await createRecipientLimitKey({ secret: SECRET, previousSecrets: [] })
    const other = await createRecipientLimitKey({ secret: OLD_SECRET, previousSecrets: [] })

    expect(await key(`Ada@Example.com`)).toBe(await key(`ada@example.com`))
    expect(await key(`ada@example.com`)).not.toBe(await sha256Hex(`ada@example.com`))
    expect(await key(`ada@example.com`)).not.toBe(await other(`ada@example.com`))
  })

  it("links carry the list and the token in the query", () => {
    const confirm = new URL(subscriberConfirmLink(`https://app.example.com`, `news`, `a+b/c=`))
    expect(confirm.pathname).toBe(`/subscribe/confirm`)
    expect(confirm.searchParams.get(`list`)).toBe(`news`)
    expect(confirm.searchParams.get(`token`)).toBe(`a+b/c=`)
    const unsubscribe = new URL(subscriberUnsubscribeLink(`https://app.example.com`, `news`, `t`))
    expect(unsubscribe.pathname).toBe(`/api/subscribers/unsubscribe`)
    expect(unsubscribe.searchParams.get(`token`)).toBe(`t`)
  })
})
