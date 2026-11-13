import { expect } from "@std/expect"
import { afterEach, describe, it } from "@std/testing/bdd"
import type { AutoPostContext } from "./auto-post.ts"
import { mastodonServer, readMastodonPoster } from "./blog-post-mastodon-job.ts"

const TOKEN = `secret-masto-token-0123456789`
const ENV: Record<string, string> = {
  MASTODON_ACCESS_TOKEN: TOKEN,
  MASTODON_INSTANCE_URL: `https://mastodon.social/`,
}
const env = { get: (name: string) => ENV[name] }

function contextOn(address: string): AutoPostContext {
  return {
    shareId: `0190d4a0-0000-7000-8000-000000000001`,
    post: {
      title: `A post`,
      slug: `a-post`,
      language: `en`,
      description: `About it.`,
      intro: null,
      tldr: [],
    } as never,
    channel: {
      id: `0190d4a0-0000-7000-8000-000000000002`,
      kind: `mastodon`,
      address,
      utmSource: `mastodon`,
      addUtm: false,
      languages: [`en`],
      startsAt: null,
      archivedAt: null,
      autoPost: true,
    } as never,
    siteUrl: `https://www.example.com`,
    canonical: `https://www.example.com/blog/a-post`,
    link: `https://www.example.com/blog/a-post`,
    cover: null,
  }
}

const realFetch = globalThis.fetch

/** Replaces `fetch` with one that answers a status and records each request's address. */
function recordRequests(): string[] {
  const seen: string[] = []
  globalThis.fetch = (input: RequestInfo | URL) => {
    seen.push(input instanceof Request ? input.url : String(input))
    return Promise.resolve(Response.json({ id: `1`, url: `https://mastodon.social/@seed/1` }))
  }
  return seen
}

describe(`the Mastodon poster`, () => {
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it(`sends no request, so not the token, for a channel on another server than MASTODON_INSTANCE_URL`, async () => {
    const seen = recordRequests()
    const poster = readMastodonPoster(env)!

    const outcome = await poster.post(contextOn(`@x@attacker.example`))

    expect(seen).toEqual([])
    expect(outcome).toMatchObject({ uncertain: false })
    expect(JSON.stringify(outcome)).toContain(`attacker.example`)
  })

  it(`posts to MASTODON_INSTANCE_URL for a channel on that server`, async () => {
    const seen = recordRequests()

    await readMastodonPoster(env)!.post(contextOn(`@seed@Mastodon.Social`))

    expect(seen).toHaveLength(1)
    expect(new URL(seen[0]).origin).toBe(`https://mastodon.social`)
  })

  it(`is off without MASTODON_INSTANCE_URL, or with one that is not https`, () => {
    expect(
      readMastodonPoster({ get: (name) => name === `MASTODON_ACCESS_TOKEN` ? TOKEN : undefined }),
    )
      .toBeNull()
    expect(mastodonServer(`http://mastodon.social`)).toBeNull()
    expect(mastodonServer(`not a url`)).toBeNull()
  })
})
