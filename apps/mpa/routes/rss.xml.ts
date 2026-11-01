import { rssXml } from "@spy4x/platform/universal/seo"
import { BLOG_INTRO, BLOG_NAME, BLOG_PATH, postAddress, readFeed, RSS_PATH } from "../blog.ts"
import { define } from "../utils.ts"
import { siteTranslator } from "../languages.ts"
import { feedHtml, postFigures, resolveBody } from "../post-figures.tsx"

/**
 * The blog's RSS 2.0 feed: its newest live posts in every language, each with its full HTML and a
 * link to its own language's address. A figure becomes its text fallback or a link to it (#620). A blog with no live post answers a valid feed with no
 * items. When the API cannot answer, the error page answers 502, so a reader keeps the items it
 * has instead of reading an empty feed.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const origin = ctx.state.webAppOrigin
    const posts = await readFeed(ctx.state.api)
    const figures = await postFigures()
    const body = rssXml(
      {
        title: BLOG_NAME,
        link: `${origin}${BLOG_PATH}`,
        description: BLOG_INTRO,
        feedUrl: `${origin}${RSS_PATH}`,
        language: `en`,
      },
      posts.map((post) => {
        const link = `${origin}${postAddress(post)}`
        const { parts } = resolveBody(post.segments, post.headings, figures)
        return {
          title: post.title,
          link,
          description: post.description,
          pubDate: new Date(post.publishedAt),
          contentHtml: feedHtml(parts, link, siteTranslator(post.language)),
        }
      }),
    )
    return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8" } })
  },
})
