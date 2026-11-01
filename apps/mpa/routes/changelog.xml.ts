import { rssXml } from "@spy4x/platform/universal/seo"
import { REPOSITORY_URL } from "../brand.ts"
import { CHANGELOG, CHANGELOG_FEED_PATH, CHANGELOG_PATH } from "../changelog.ts"
import { define } from "../utils.ts"
import { CHANGELOG_HEAD } from "./[[lang]]/changelog.tsx"

/** How many of the newest changes the feed carries. */
export const FEED_ITEMS = 50

/**
 * The changelog's RSS 2.0 feed: its newest {@link FEED_ITEMS} changes, each linked to its pull
 * request on GitHub, or to its month on the changelog when it has none. With no history it is a
 * valid feed with no items.
 */
export const handler = define.handlers({
  GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const page = `${origin}${CHANGELOG_PATH}`
    const body = rssXml(
      {
        title: `Seed changelog`,
        link: page,
        description: CHANGELOG_HEAD.description,
        feedUrl: `${origin}${CHANGELOG_FEED_PATH}`,
        language: `en`,
      },
      CHANGELOG.entries.slice(0, FEED_ITEMS).map((entry) => ({
        title: `${entry.kind === `new` ? `New` : `Fixed`}: ${entry.text}`,
        link: entry.number === undefined
          ? `${page}#${entry.date.slice(0, 7)}`
          : `${REPOSITORY_URL}/pull/${entry.number}`,
        description: entry.text,
        pubDate: new Date(entry.date),
      })),
    )
    return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8" } })
  },
})
