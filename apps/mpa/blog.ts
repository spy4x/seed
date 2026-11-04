import { type } from "arktype"
import { HttpError } from "fresh"
import {
  blogSlugProblem,
  type BlogTranslation,
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
  coverUrl: `string | null`,
  coverFile: `string | null`,
})

const postsAnswer = type({ posts: summary.array() })

const headings = type({ id: `string`, text: `string`, depth: `number` }).array()

/** A body segment: a chunk of the API's safe HTML, or a component tag, unchecked (#620). */
const segments = type({ kind: `'html'`, html: `string` }).or({
  kind: `'component'`,
  tag: `string`,
  props: `Record<string, unknown>`,
  line: `number`,
}).array()

const postAnswer = type({
  post: summary.and({
    seoTitle: `string | null`,
    tldr: `string[]`,
    coverAlt: `string | null`,
    relatedFeature: `string | null`,
    segments,
    headings,
    authorName: `string | null`,
    authorUrl: `string | null`,
    translations: type({ language, slug: `string` }).array(),
  }),
  readNext: summary.array(),
})

/** The answer for a slug the post moved away from: where it lives now (#418). */
const movedAnswer = type({ moved: { language, slug: `string` } })

const feedAnswer = type({
  posts: summary.and({
    segments,
    headings,
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
  throw apiFailure(answer.status, path)
}

/**
 * The error a page throws when the blog API did not answer what it needed: 429 when the API's
 * public read limit refused the visitor (#416), so the error page says so without logging a fault,
 * else 502, which the error page logs.
 */
function apiFailure(status: number, path: string): HttpError {
  return new HttpError(status === 429 ? 429 : 502, `The blog API answered ${status} for ${path}`)
}

/** Every live post in every language, newest first. */
export async function listPosts(api: Api): Promise<PublicBlogPostSummary[]> {
  return (await read(api, `/api/blog/posts`, postsAnswer)).posts
}

/**
 * The live post at `slug` with up to three to read next; `{ moved }`, the post's current language
 * and slug, when a live post moved away from `slug` with "Change URL" (#418); or `null` when there
 * is neither.
 */
export async function readPost(
  api: Api,
  slug: string,
): Promise<
  { post: PublicBlogPost; readNext: PublicBlogPostSummary[] } | { moved: BlogTranslation } | null
> {
  if (blogSlugProblem(slug) !== null) return null
  const path = `/api/blog/posts/${encodeURIComponent(slug)}` as const
  const answer = await api.call(`GET`, path)
  if (answer.status === 404) return null
  if (answer.status === 200) {
    const body = postAnswer.or(movedAnswer)(answer.body)
    if (!(body instanceof type.errors)) return body
  }
  throw apiFailure(answer.status, path)
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
    // The latest change among the language's posts: ISO dates sort as text, so the last is it.
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
 * Tells every page whether the blog has a live post in the page's language (`State.blog`), and in
 * which languages it has one (`State.blogLanguages`), so the header, the footer, the RSS link and
 * the language links name the blog only where there is something to read. The
 * API is asked once before the first page, then at most once a minute in the background
 * (`createApiValue`). Until it has answered, and while it cannot be reached before its first
 * answer, the blog counts as empty, and the API is asked again every few seconds, so a website
 * that started before the API shows the Blog link soon after the API is up.
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
    ctx.state.blogLanguages = languages.current()
    ctx.state.blog = ctx.state.blogLanguages.has(pathLanguage(ctx.url.pathname).language)
    return ctx.next()
  })
}
