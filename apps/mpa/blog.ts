import { type } from "arktype"
import { HttpError } from "fresh"
import {
  blogSlugProblem,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import type { Api } from "./api.ts"
import { createApiFlag } from "./api-flag.ts"
import type { MpaConfig } from "./config.ts"
import { SITE_NAME } from "./brand.ts"
import { define } from "./utils.ts"

/** The blog's index page. */
export const BLOG_PATH = `/blog`

/** The RSS feed of the blog's newest posts. */
export const RSS_PATH = `/rss.xml`

// Seed's own site: see docs/start-a-product.md
/** The blog's name, as the feed, the JSON-LD and the RSS link's title call it. */
export const BLOG_NAME = `${SITE_NAME} blog`

/** The one line under the blog's heading, and its meta description. */
export const BLOG_INTRO = `What we are building, and what we learn on the way.`

/** A post's address on this website. */
export function postPath(slug: string): string {
  return `${BLOG_PATH}/${slug}`
}

/** The blog's `@id` in JSON-LD, the same on its index and in every post's `isPartOf`. */
export function blogId(origin: string): string {
  return `${origin}${BLOG_PATH}#blog`
}

/** A post is long enough for "On this page" from this many minutes of reading. */
export const TOC_MIN_MINUTES = 8

const summary = type({
  slug: `string`,
  title: `string`,
  description: `string`,
  topic: `string | null`,
  publishedAt: `string`,
  updatedAt: `string | null`,
  readingMinutes: `number`,
})

const postsAnswer = type({ posts: summary.array() })

const postAnswer = type({
  post: summary.and({
    seoTitle: `string | null`,
    tldr: `string[]`,
    coverUrl: `string | null`,
    coverAlt: `string | null`,
    html: `string`,
    headings: type({ id: `string`, text: `string`, depth: `number` }).array(),
    authorName: `string | null`,
  }),
  readNext: summary.array(),
})

const feedAnswer = type({
  posts: summary.and({
    html: `string`,
    coverUrl: `string | null`,
    authorName: `string | null`,
  }).array(),
})

/** The API's answer when it is a 200 whose body has the expected shape; anything else throws. */
async function read<T>(
  api: Api,
  path: `/api/${string}`,
  schema: (body: unknown) => T | InstanceType<typeof type.errors>,
): Promise<T> {
  const answer = await api.call(`GET`, path)
  if (answer.status === 200) {
    const body = schema(answer.body)
    if (!(body instanceof type.errors)) return body
  }
  // The error page logs it; a 502 says the page could not get what it needed.
  throw new HttpError(502, `The blog API answered ${answer.status} for ${path}`)
}

/** Every live post, newest first. */
export async function listPosts(api: Api): Promise<PublicBlogPostSummary[]> {
  return (await read(api, `/api/blog/posts`, postsAnswer)).posts
}

/** The live post at `slug` with up to three to read next, or `null` when there is none. */
export async function readPost(
  api: Api,
  slug: string,
): Promise<{ post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | null> {
  if (blogSlugProblem(slug) !== null) return null
  const path = `/api/blog/posts/${encodeURIComponent(slug)}` as const
  const answer = await api.call(`GET`, path)
  if (answer.status === 404) return null
  if (answer.status === 200) {
    const body = postAnswer(answer.body)
    if (!(body instanceof type.errors)) return body
  }
  throw new HttpError(502, `The blog API answered ${answer.status} for ${path}`)
}

/** The blog's index or one post, as `sitemap.xml` and `llms.txt` list it. */
export interface BlogPage {
  path: string
  title: string
  description: string
  /** The last significant change: the newest post's for the index, else the post's own. */
  lastmod: string
}

/**
 * The blog's index, then every live post, newest first. Empty when no post is live, and when the
 * API cannot answer: the sitemap and `llms.txt` still list the other pages then.
 */
export async function blogPages(api: Api): Promise<BlogPage[]> {
  let posts: PublicBlogPostSummary[]
  try {
    posts = await listPosts(api)
  } catch {
    return []
  }
  const pages = posts.map((post) => ({
    path: postPath(post.slug),
    title: post.title,
    description: post.description,
    lastmod: post.updatedAt ?? post.publishedAt,
  }))
  if (pages.length === 0) return []
  const newest = pages.map(({ lastmod }) => lastmod).sort().at(-1)!
  return [{ path: BLOG_PATH, title: BLOG_NAME, description: BLOG_INTRO, lastmod: newest }, ...pages]
}

/** The newest live posts with their full HTML, for the RSS feed. */
export async function readFeed(api: Api): Promise<PublicBlogFeedItem[]> {
  return (await read(api, `/api/blog/feed`, feedAnswer)).posts
}

/**
 * Tells every page whether the blog has a live post (`State.blog`), so the header, the footer and
 * the RSS link name the blog only once there is something to read. The API is asked once before
 * the first page, then at most once a minute in the background (`createApiFlag`). Until it has
 * answered, and while it cannot be reached before its first answer, the blog counts as empty.
 */
export async function blogLinkMiddleware(
  config: Pick<MpaConfig, "apiUrl">,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const flag = createApiFlag({
    apiUrl: config.apiUrl,
    path: `/api/blog/posts`,
    initial: false,
    read: (body) => {
      const answer = postsAnswer(body)
      return answer instanceof type.errors ? undefined : answer.posts.length > 0
    },
    fetch,
  })
  await flag.refresh()
  return define.middleware((ctx) => {
    ctx.state.blog = flag.isOn()
    return ctx.next()
  })
}
