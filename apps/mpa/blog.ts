import { type } from "arktype"
import { HttpError } from "fresh"
import {
  blogSlugProblem,
  type PublicBlogFeedItem,
  type PublicBlogPost,
  type PublicBlogPostSummary,
} from "@domain/blog"
import { type Language, LANGUAGES } from "@domain/identity"
import type { Api } from "./api.ts"
import { createApiValue } from "./api-flag.ts"
import type { MpaConfig } from "./config.ts"
import { SITE_NAME } from "./brand.ts"
import { define } from "./utils.ts"
import { localePath, pathLanguage } from "./languages.ts"
import { siteEnglishText } from "@ui/site-text.ts"

/** The blog's index page. */
export const BLOG_PATH = `/blog`

/** The RSS feed of the blog's newest posts. */
export const RSS_PATH = `/rss.xml`

// Seed's own site: see docs/start-a-product.md
/** The blog's name in English, as the feed and the sitemap call it. */
export const BLOG_NAME = siteEnglishText().t(`Blog.name`, { site: SITE_NAME })

/** The one line under the blog's heading in English, for the feed and the sitemap. */
export const BLOG_INTRO = siteEnglishText().t(`Blog.intro`)

/** A post's address on this website in the default language; {@link postAddress} adds its own. */
export function postPath(slug: string): string {
  return `${BLOG_PATH}/${slug}`
}

/** A post's own address: in the language it is written in, `/de/blog/<slug>` for German. */
export function postAddress(post: { language: Language; slug: string }): string {
  return localePath(post.language, postPath(post.slug))
}

/**
 * The `@id` in JSON-LD of the blog in `language`, the same on its index and in the `isPartOf` of
 * every post in that language.
 */
export function blogId(origin: string, language: Language): string {
  return `${origin}${localePath(language, BLOG_PATH)}#blog`
}

/** A post is long enough for "On this page" from this many minutes of reading. */
export const TOC_MIN_MINUTES = 8

const language = type.enumerated(...LANGUAGES)

const summary = type({
  slug: `string`,
  language,
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
    translations: type({ language, slug: `string` }).array(),
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

/** Every live post in every language, newest first. */
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
 * The blog's index of each language with a live post, then every live post at its own address,
 * newest first. Empty when no post is live, and when the API cannot answer: the sitemap and
 * `llms.txt` still list the other pages then.
 */
export async function blogPages(api: Api): Promise<BlogPage[]> {
  let posts: PublicBlogPostSummary[]
  try {
    posts = await listPosts(api)
  } catch {
    return []
  }
  const pages = posts.map((post) => ({
    path: postAddress(post),
    title: post.title,
    description: post.description,
    lastmod: post.updatedAt ?? post.publishedAt,
    language: post.language,
  }))
  const indexes = [...new Set(pages.map((page) => page.language))].map((language) => ({
    path: localePath(language, BLOG_PATH),
    title: BLOG_NAME,
    description: BLOG_INTRO,
    // Newest first, so the first of the language is its newest.
    lastmod: pages.filter((page) => page.language === language)
      .map(({ lastmod }) => lastmod).sort().at(-1)!,
  }))
  return [...indexes, ...pages.map(({ language: _, ...page }) => page)]
}

/** The newest live posts with their full HTML, for the RSS feed. */
export async function readFeed(api: Api): Promise<PublicBlogFeedItem[]> {
  return (await read(api, `/api/blog/feed`, feedAnswer)).posts
}

/**
 * Tells every page whether the blog has a live post in the page's language (`State.blog`), so the
 * header, the footer and the RSS link name the blog only where there is something to read. The
 * API is asked once before the first page, then at most once a minute in the background
 * (`createApiValue`). Until it has answered, and while it cannot be reached before its first
 * answer, the blog counts as empty.
 */
export async function blogLinkMiddleware(
  config: Pick<MpaConfig, "apiUrl">,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const languages = createApiValue<ReadonlySet<Language>>({
    apiUrl: config.apiUrl,
    path: `/api/blog/posts`,
    initial: new Set(),
    read: (body) => {
      const answer = postsAnswer(body)
      return answer instanceof type.errors
        ? undefined
        : new Set(answer.posts.map((post) => post.language))
    },
    fetch,
  })
  await languages.refresh()
  return define.middleware((ctx) => {
    ctx.state.blog = languages.current().has(pathLanguage(ctx.url.pathname).language)
    return ctx.next()
  })
}
