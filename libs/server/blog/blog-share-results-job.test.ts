import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { readShareResultsSetup, shareReadDue, shareTarget } from "./blog-share-results-job.ts"

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = new Date(`2026-11-06T10:17:00.000Z`)
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe(`shareReadDue`, () => {
  it(`reads a copy the job never read, however young`, () => {
    expect(shareReadDue(ago(60_000), null, NOW)).toBe(true)
  })

  it(`reads a copy under 14 days old once a day`, () => {
    expect(shareReadDue(ago(3 * DAY), ago(DAY), NOW)).toBe(true)
    expect(shareReadDue(ago(3 * DAY), ago(12 * HOUR), NOW)).toBe(false)
  })

  it(`reads a copy 14 days old or older once a week`, () => {
    expect(shareReadDue(ago(14 * DAY), ago(2 * DAY), NOW)).toBe(false)
    expect(shareReadDue(ago(30 * DAY), ago(6 * DAY), NOW)).toBe(false)
    expect(shareReadDue(ago(30 * DAY), ago(7 * DAY), NOW)).toBe(true)
  })

  it(`counts a copy due up to an hour early, so an hourly run does not drift a day later`, () => {
    expect(shareReadDue(ago(3 * DAY), ago(DAY - HOUR), NOW)).toBe(true)
    expect(shareReadDue(ago(3 * DAY), ago(DAY - HOUR - 60_000), NOW)).toBe(false)
    expect(shareReadDue(ago(30 * DAY), ago(7 * DAY - HOUR), NOW)).toBe(true)
  })

  it(`never reads a copy 90 days old or older again, even one never read`, () => {
    expect(shareReadDue(ago(90 * DAY - 60_000), ago(8 * DAY), NOW)).toBe(true)
    expect(shareReadDue(ago(90 * DAY), ago(8 * DAY), NOW)).toBe(false)
    expect(shareReadDue(ago(90 * DAY), null, NOW)).toBe(false)
  })
})

describe(`shareTarget`, () => {
  const MASTODON = `@seed@mastodon.social`

  it(`takes a Dev.to article address`, () => {
    expect(shareTarget(`devto`, `https://dev.to/seed/backups-1a2b`, ``)).toEqual({ kind: `devto` })
    expect(shareTarget(`devto`, `https://dev.to/seed`, ``)).toHaveProperty(`error`)
    expect(shareTarget(`devto`, `https://evil.example/seed/post`, ``)).toHaveProperty(`error`)
  })

  it(`takes the post id from each Reddit address form`, () => {
    expect(shareTarget(`reddit`, `https://www.reddit.com/r/selfhosted/comments/1ABC2d/x/`, ``))
      .toEqual({ kind: `reddit`, id: `1abc2d` })
    expect(shareTarget(`reddit`, `https://old.reddit.com/comments/1abc2d`, ``))
      .toEqual({ kind: `reddit`, id: `1abc2d` })
    expect(shareTarget(`reddit`, `https://redd.it/1abc2d`, ``)).toEqual({
      kind: `reddit`,
      id: `1abc2d`,
    })
    expect(shareTarget(`reddit`, `https://www.reddit.com/r/selfhosted/`, ``)).toHaveProperty(
      `error`,
    )
    expect(shareTarget(`reddit`, `https://reddit.example/r/x/comments/1abc2d`, ``))
      .toHaveProperty(`error`)
  })

  it(`takes the item id from a Hacker News address`, () => {
    expect(shareTarget(`hackernews`, `https://news.ycombinator.com/item?id=42`, ``))
      .toEqual({ kind: `hackernews`, id: 42 })
    expect(shareTarget(`hackernews`, `https://news.ycombinator.com/item?id=0`, ``))
      .toHaveProperty(`error`)
    expect(shareTarget(`hackernews`, `https://news.ycombinator.com/user?id=42`, ``))
      .toHaveProperty(`error`)
  })

  it(`reads a Mastodon status only on the channel's own instance`, () => {
    expect(shareTarget(`mastodon`, `https://mastodon.social/@seed/1134`, MASTODON)).toEqual({
      kind: `mastodon`,
      instanceUrl: `https://mastodon.social`,
      statusId: `1134`,
    })
    expect(shareTarget(`mastodon`, `https://internal.example/@seed/1134`, MASTODON))
      .toHaveProperty(`error`)
    expect(shareTarget(`mastodon`, `https://10.0.0.1/@seed/1134`, `@seed@10.0.0.1`))
      .toHaveProperty(`error`)
    expect(shareTarget(`mastodon`, `https://mastodon.social/@seed`, MASTODON)).toHaveProperty(
      `error`,
    )
  })

  it(`turns a Bluesky post page into its at:// address, and refuses one naming a handle`, () => {
    expect(shareTarget(`bluesky`, `https://bsky.app/profile/did:plc:abc123/post/3kxyz`, ``))
      .toEqual({ kind: `bluesky`, uri: `at://did:plc:abc123/app.bsky.feed.post/3kxyz` })
    expect(shareTarget(`bluesky`, `https://bsky.app/profile/seed.bsky.social/post/3kxyz`, ``))
      .toHaveProperty(`error`)
  })

  it(`takes a Hashnode post's host and slug`, () => {
    expect(shareTarget(`hashnode`, `https://blog.example.com/backups`, ``))
      .toEqual({ kind: `hashnode`, host: `blog.example.com`, slug: `backups` })
    expect(shareTarget(`hashnode`, `https://blog.example.com/a/b`, ``)).toHaveProperty(`error`)
  })

  it(`refuses a link that is not plain https on the default port, and kinds it cannot read`, () => {
    expect(shareTarget(`hackernews`, `http://news.ycombinator.com/item?id=42`, ``))
      .toHaveProperty(`error`)
    expect(shareTarget(`hackernews`, `https://news.ycombinator.com:8443/item?id=42`, ``))
      .toHaveProperty(`error`)
    expect(shareTarget(`reddit`, `https://user:pw@redd.it/1abc2d`, ``)).toHaveProperty(`error`)
    expect(shareTarget(`reddit`, `not a link`, ``)).toHaveProperty(`error`)
    expect(shareTarget(`linkedin`, `https://www.linkedin.com/posts/x`, ``)).toHaveProperty(`error`)
  })
})

describe(`readShareResultsSetup`, () => {
  const env = (values: Record<string, string>) => ({ get: (name: string) => values[name] })

  it(`reads Hacker News, Mastodon, Bluesky and Hashnode with no key`, () => {
    const setup = readShareResultsSetup(env({}), `prod`)
    expect(Object.keys(setup.readers).sort()).toEqual([
      `bluesky`,
      `hackernews`,
      `hashnode`,
      `mastodon`,
    ])
    expect(setup.missing).toEqual({
      devto: `DEVTO_API_KEY is unset`,
      reddit: `MPA_DOMAIN is unset`,
    })
  })

  it(`adds Reddit with the website's domain, and Dev.to with its key as well`, () => {
    const site = readShareResultsSetup(env({ MPA_DOMAIN: `www.example.com` }), `prod`)
    expect(site.readers.reddit).toBeDefined()
    expect(site.missing).toEqual({ devto: `DEVTO_API_KEY is unset` })
    const keyOnly = readShareResultsSetup(env({ DEVTO_API_KEY: `<REDACTED:API_KEY>` }), `prod`)
    expect(keyOnly.readers.devto).toBeUndefined()
    expect(keyOnly.missing.devto).toBe(`MPA_DOMAIN is unset`)
    const both = readShareResultsSetup(
      env({ MPA_DOMAIN: `www.example.com`, DEVTO_API_KEY: `<REDACTED:API_KEY>` }),
      `prod`,
    )
    expect(both.readers.devto).toBeDefined()
    expect(both.missing).toEqual({})
    expect(both.siteUrl).toBe(`https://www.example.com`)
  })

  it(`never lets the Mastodon reader reach a private address`, async () => {
    const { readers } = readShareResultsSetup(env({}), `prod`)
    const read = await readers.mastodon!({
      kind: `mastodon`,
      instanceUrl: `https://127.0.0.1`,
      statusId: `1`,
    })
    expect(read.success).toBe(false)
    expect(read.error).toContain(`UrlValidationError`)
  })
})
