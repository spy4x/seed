import { rssXml } from "@spy4x/platform/universal/seo"
import { BLOG_INTRO, BLOG_NAME, BLOG_PATH, postPath, readFeed, RSS_PATH } from "../blog.ts"
import { define } from "../utils.ts"

/**
 * The blog's RSS 2.0 feed: its newest live posts, each with its full HTML. A blog with no live
 * post answers a valid feed with no items. When the API cannot answer, the error page answers 502,
 * so a reader keeps the items it has instead of reading an empty feed.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const posts = await readFeed(ctx.state.api)
    const body = rssXml(
      {
        title: BLOG_NAME,
        link: `${origin}${BLOG_PATH}`,
        description: BLOG_INTRO,
        feedUrl: `${origin}${RSS_PATH}`,
        language: `en`,
      },
      posts.map((post) => ({
        title: post.title,
        link: `${origin}${postPath(post.slug)}`,
        description: post.description,
        pubDate: new Date(post.publishedAt),
        contentHtml: post.html,
      })),
    )
    return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8" } })
  },
})
