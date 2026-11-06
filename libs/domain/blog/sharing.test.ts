import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import {
  blogChannelHref,
  blogShareState,
  blogSharingCounts,
  BlogSharingError,
  blogSharingToDo,
  blogSubmitUrl,
  channelPostCount,
  parseBlogChannelFields,
  parseBlogShareFields,
  type SharingChannel,
  type SharingPost,
  withUtmSource,
} from "./sharing.ts"

const CHANNEL: SharingChannel = {
  id: `channel-1`,
  languages: [`en`, `ru`],
  startsAt: null,
  archivedAt: null,
}
const POST: SharingPost = {
  id: `post-1`,
  language: `en`,
  translationOf: null,
  status: `published`,
  publishedAt: `2026-11-01T10:00:00.000Z`,
}
const TRANSLATION: SharingPost = { ...POST, id: `post-2`, language: `ru`, translationOf: `post-1` }

describe(`the gap rule`, () => {
  it(`lists a live post with no row as to do, old posts included when the channel has no start`, () => {
    const old = { ...POST, publishedAt: `2020-01-01T00:00:00.000Z` }
    expect(blogShareState(CHANNEL, old, null, null)).toBe(`todo`)
  })

  it(`counts a todo row as to do, and suggested, posted and skipped rows as handled`, () => {
    const toDo = (status: `todo` | `suggested` | `posted` | `skipped`) =>
      blogSharingToDo(POST, [CHANNEL], () => ({ status }))
    expect([toDo(`todo`), toDo(`suggested`), toDo(`posted`), toDo(`skipped`)]).toEqual([1, 0, 0, 0])
  })

  it(`never lists a post on an archived channel`, () => {
    const archived = { ...CHANNEL, archivedAt: `2026-11-02T00:00:00.000Z` }
    expect(blogShareState(archived, POST, null, null)).toBe(null)
    expect(blogSharingToDo(POST, [archived], () => undefined)).toBe(0)
  })

  it(`leaves out posts that went live before the channel's start, and keeps the one at its start`, () => {
    const from = { ...CHANNEL, startsAt: `2026-11-01T10:00:00.000Z` }
    expect(blogShareState(from, POST, null, null)).toBe(`todo`)
    const before = { ...POST, publishedAt: `2026-11-01T09:59:59.999Z` }
    expect(blogShareState(from, before, null, null)).toBe(null)
  })

  it(`leaves out drafts, scheduled posts and languages the channel does not take`, () => {
    expect(blogShareState(CHANNEL, { ...POST, status: `draft`, publishedAt: null }, null, null))
      .toBe(null)
    expect(blogShareState(CHANNEL, { ...POST, status: `scheduled` }, null, null)).toBe(null)
    expect(blogShareState(CHANNEL, { ...POST, language: `de` }, null, null)).toBe(null)
  })

  it(`covers a translation with no row of its own when the original was posted or suggested`, () => {
    expect(blogShareState(CHANNEL, TRANSLATION, null, { status: `posted` })).toBe(`covered`)
    expect(blogShareState(CHANNEL, TRANSLATION, null, { status: `suggested` })).toBe(`covered`)
    expect(
      blogSharingToDo(
        TRANSLATION,
        [CHANNEL],
        (post) => post === `post-1` ? { status: `posted` } : undefined,
      ),
    ).toBe(0)
  })

  it(`keeps a translation to do when the original was skipped, or when it has a todo row of its own`, () => {
    expect(blogShareState(CHANNEL, TRANSLATION, null, { status: `skipped` })).toBe(`todo`)
    expect(blogShareState(CHANNEL, TRANSLATION, { status: `todo` }, { status: `posted` }))
      .toBe(`todo`)
  })
})

describe(`channelPostCount`, () => {
  it(`counts the live posts a channel's languages and start would list`, () => {
    const posts = [
      { language: `en` as const, publishedAt: `2026-10-01T00:00:00.000Z` },
      { language: `en` as const, publishedAt: `2026-11-05T00:00:00.000Z` },
      { language: `de` as const, publishedAt: `2026-11-05T00:00:00.000Z` },
    ]
    expect(channelPostCount(posts, [`en`], null)).toBe(2)
    expect(channelPostCount(posts, [`en`, `de`], `2026-11-01T00:00:00.000Z`)).toBe(2)
  })
})

describe(`links`, () => {
  it(`tags a link with utm_source, and leaves it clean without one`, () => {
    const url = `https://seedsaas.com/blog/hello`
    expect(withUtmSource(url, `r-selfhosted`)).toBe(`${url}?utm_source=r-selfhosted`)
    expect(withUtmSource(url, null)).toBe(url)
  })

  it(`fills Reddit's and Hacker News' submit forms with the title and the link`, () => {
    const link = `https://seedsaas.com/blog/hello?utm_source=hn`
    expect(blogSubmitUrl({ kind: `hackernews`, address: `news.ycombinator.com` }, `Hi & bye`, link))
      .toBe(
        `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(link)}&t=Hi+%26+bye`,
      )
    expect(blogSubmitUrl({ kind: `reddit`, address: `r/selfhosted` }, `Hi`, link)).toBe(
      `https://www.reddit.com/r/selfhosted/submit?url=${encodeURIComponent(link)}&title=Hi`,
    )
    expect(blogSubmitUrl({ kind: `telegram`, address: `https://t.me/x` }, `Hi`, link)).toBe(null)
  })

  it(`opens a channel's own page from its address`, () => {
    expect(blogChannelHref({ kind: `reddit`, address: `r/selfhosted` }))
      .toBe(`https://www.reddit.com/r/selfhosted/`)
    expect(blogChannelHref({ kind: `mastodon`, address: `@you@mastodon.social` }))
      .toBe(`https://mastodon.social/@you`)
    expect(blogChannelHref({ kind: `bluesky`, address: `you.bsky.social` }))
      .toBe(`https://bsky.app/profile/you.bsky.social`)
    expect(blogChannelHref({ kind: `other`, address: `javascript:alert(1)` })).toBe(null)
  })
})

describe(`parseBlogChannelFields`, () => {
  const FIELDS = {
    name: ` r/selfhosted `,
    kind: `reddit`,
    address: `r/selfhosted`,
    utmSource: `r-selfhosted`,
    addUtm: true,
    languages: [`en` as const],
    startsAt: null,
  }

  const failure = (input: Partial<typeof FIELDS>) => {
    try {
      parseBlogChannelFields({ ...FIELDS, ...input })
    } catch (error) {
      if (error instanceof BlogSharingError) {
        return [error.field, error.fields?.[error.field!]?.code]
      }
    }
    return null
  }

  it(`trims the fields and fills Hacker News' address in`, () => {
    expect(parseBlogChannelFields(FIELDS).name).toBe(`r/selfhosted`)
    expect(parseBlogChannelFields({ ...FIELDS, kind: `hackernews`, address: `` }).address)
      .toBe(`news.ycombinator.com`)
  })

  it(`names the field and the reason of each refusal`, () => {
    expect(failure({ name: ` ` })).toEqual([`name`, `channelName`])
    expect(failure({ address: `` })).toEqual([`address`, `channelAddress`])
    expect(failure({ kind: `telegram`, address: `http://t.me/x` })).toEqual([
      `address`,
      `channelHttps`,
    ])
    expect(failure({ utmSource: `` })).toEqual([`utmSource`, `channelSource`])
    expect(failure({ utmSource: `R_Self` })).toEqual([`utmSource`, `slug`])
    expect(failure({ languages: [] })).toEqual([`languages`, `channelLanguages`])
  })
})

describe(`parseBlogShareFields`, () => {
  it(`refuses a link that is not https and keeps a reason only on a skip`, () => {
    expect(() => parseBlogShareFields({ status: `posted`, url: `http://x.com/1` }))
      .toThrow(BlogSharingError)
    expect(parseBlogShareFields({ status: `posted`, url: ` https://x.com/1 `, skipReason: `x` }))
      .toEqual({ url: `https://x.com/1`, skipReason: null })
    expect(parseBlogShareFields({ status: `skipped`, skipReason: ` Not a fit ` }))
      .toEqual({ url: null, skipReason: `Not a fit` })
  })
})

describe(`blogSharingCounts`, () => {
  it(`counts every row shown, an archived channel's posted row among the done`, () => {
    const row = (
      state: `todo` | `suggested` | `posted` | `skipped` | `covered`,
      archived = false,
    ) => ({
      channel: { archivedAt: archived ? `2026-11-02T00:00:00.000Z` : null },
      state,
    })
    const rows = [
      row(`posted`),
      row(`covered`),
      row(`todo`),
      row(`todo`),
      row(`suggested`),
      row(`skipped`),
      row(`posted`, true),
    ]
    expect(blogSharingCounts(rows)).toEqual({ total: 7, done: 3, toDo: 2, suggested: 1 })
  })
})
