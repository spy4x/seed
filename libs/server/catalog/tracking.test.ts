import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  createUmamiLinks,
  DEFAULT_ITEM_PATH,
  readTrackingSetup,
  trackingLocation,
  type TrackingSetup,
  umamiLinkName,
  type UmamiLinks,
  umamiTargetUrl,
} from "./tracking.ts"
import type { TrackingTarget } from "./public-catalog.ts"

const SITE = `https://shop.example`
const TOKEN = `umami-secret-token-0123456789`
const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

describe(`tracking links: setup`, () => {
  it(`is off without the website's address, whatever else is set`, () => {
    expect(
      readTrackingSetup(
        env({ UMAMI_API_URL: `https://stats.example`, UMAMI_API_TOKEN: TOKEN }),
        null,
      ),
    )
      .toBeNull()
  })

  it(`sends links straight to /<category>/<item> when nothing else is set`, () => {
    expect(readTrackingSetup(env({}), SITE)).toEqual({
      siteUrl: SITE,
      itemPath: DEFAULT_ITEM_PATH,
      umami: null,
    })
  })

  it(`reads the item path and the Umami pair`, () => {
    expect(
      readTrackingSetup(
        env({
          CATALOG_ITEM_PATH: `/items/{slug}`,
          UMAMI_API_URL: `https://stats.example`,
          UMAMI_API_TOKEN: TOKEN,
        }),
        SITE,
      ),
    ).toEqual({
      siteUrl: SITE,
      itemPath: `/items/{slug}`,
      umami: { url: `https://stats.example`, token: TOKEN },
    })
  })

  it(`stops on a bad setting, naming it and never the token`, () => {
    const fails = (values: Record<string, string>) => {
      try {
        readTrackingSetup(env(values), SITE)
      } catch (error) {
        return (error as Error).message
      }
      return `no error`
    }
    expect(fails({ CATALOG_ITEM_PATH: `items/{slug}` })).toContain(`CATALOG_ITEM_PATH`)
    expect(fails({ CATALOG_ITEM_PATH: `//evil.example/{slug}` })).toContain(`CATALOG_ITEM_PATH`)
    expect(fails({ CATALOG_ITEM_PATH: `/{category}` })).toContain(`CATALOG_ITEM_PATH`)
    expect(fails({ UMAMI_API_TOKEN: TOKEN })).toContain(`UMAMI_API_URL`)
    expect(fails({ UMAMI_API_URL: `https://stats.example` })).toContain(`UMAMI_API_TOKEN`)
    const badUrl = fails({ UMAMI_API_URL: `stats.example`, UMAMI_API_TOKEN: TOKEN })
    expect(badUrl).toContain(`UMAMI_API_URL`)
    expect(badUrl).not.toContain(TOKEN)
  })
})

describe(`tracking links: where /s/<code> leads`, () => {
  const setup: TrackingSetup = { siteUrl: SITE, itemPath: DEFAULT_ITEM_PATH, umami: null }
  const target: TrackingTarget = {
    code: `AbCdEfGh_-1`,
    umamiLinkId: `019a2f6c-0c00-7000-8000-00000000c009`,
    itemSlug: `linen`,
    categorySlug: `shirts`,
    sourceSlug: `zalo-a`,
  }
  const direct = `${SITE}/shirts/linen?utm_source=zalo-a&utm_medium=share&utm_campaign=linen`
  const umami = (up: boolean): UmamiLinks & { asked: number } => {
    const port = {
      asked: 0,
      create: () => Promise.resolve(true),
      address: (slug: string) => `https://stats.example/q/${slug}`,
      isUp: () => (port.asked++, Promise.resolve(up)),
    }
    return port
  }

  it(`goes through Umami while it holds the link and answers`, async () => {
    expect(await trackingLocation(target, setup, umami(true), false))
      .toBe(`https://stats.example/q/AbCdEfGh_-1`)
  })

  it(`goes straight to the tagged item once Umami counted the visit`, async () => {
    const port = umami(true)
    expect(await trackingLocation(target, setup, port, true)).toBe(direct)
    expect(port.asked).toBe(0)
  })

  it(`goes straight to the tagged item while Umami is down, unset or lacks the link`, async () => {
    expect(await trackingLocation(target, setup, umami(false), false)).toBe(direct)
    expect(await trackingLocation(target, setup, null, false)).toBe(direct)
    expect(await trackingLocation({ ...target, umamiLinkId: null }, setup, umami(true), false))
      .toBe(direct)
  })

  it(`sends Umami's count back to the short address, marked counted`, () => {
    expect(umamiTargetUrl(SITE, `AbCdEfGh_-1`)).toBe(`${SITE}/s/AbCdEfGh_-1?counted=1`)
  })

  it(`names the link in Umami by the item and the source, within 100 characters`, () => {
    expect(umamiLinkName(`Linen shirt`, `Zalo group A`)).toBe(`Linen shirt · Zalo group A`)
    expect(umamiLinkName(`👕`.repeat(60), `Zalo`).length).toBeLessThanOrEqual(100)
  })
})

describe(`tracking links: Umami`, () => {
  it(`asks the heartbeat at most once a minute, the redirects in between share its answer`, async () => {
    let clock = 0
    let beats = 0
    const fetch = ((input: string | URL | Request) => {
      if (String(input).endsWith(`/api/heartbeat`)) beats++
      return Promise.resolve(Response.json({ ok: true }))
    }) as typeof globalThis.fetch
    const links = createUmamiLinks({ url: `https://stats.example`, token: TOKEN }, {
      fetch,
      now: () => clock,
    })
    expect(await Promise.all([links.isUp(), links.isUp()])).toEqual([true, true])
    clock = 59_999
    await links.isUp()
    expect(beats).toBe(1)
    clock = 60_000
    await links.isUp()
    expect(beats).toBe(2)
  })

  it(`logs a refused create without the token`, async () => {
    const lines: string[] = []
    const fetch = (() =>
      Promise.resolve(
        Response.json({ error: { message: `bad ${TOKEN}` } }, { status: 401 }),
      )) as typeof globalThis.fetch
    const links = createUmamiLinks({ url: `https://stats.example`, token: TOKEN }, {
      fetch,
      log: (line) => lines.push(line),
    })
    const made = await links.create({
      id: `019a2f6c-0c00-7000-8000-00000000c009`,
      name: `Linen · Zalo`,
      url: `${SITE}/s/AbCdEfGh_-1?counted=1`,
      slug: `AbCdEfGh_-1`,
    })
    expect(made).toBe(false)
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(TOKEN)
  })
})
