import type { JSX } from "preact"
import type { FreshContext } from "fresh"
import { Head } from "fresh/runtime"
import type { PublicBlogPost, PublicBlogPostSummary } from "@domain/blog"
import { Button } from "@spy4x/preact-ui/button"
import { useFormat } from "@spy4x/preact-ui/format"
import { PostList } from "@spy4x/preact-ui/post-list"
import { Prose } from "@spy4x/preact-ui/prose"
import { TldrBox } from "@spy4x/preact-ui/tldr-box"
import { blogPostingJsonLd, breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import { BLOG_NAME, BLOG_PATH, blogId, postPath, readPost, TOC_MIN_MINUTES } from "../../blog.ts"
import { Band } from "../../components/band.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import { OnThisPage } from "../../components/on-this-page.tsx"
import { SectionIntro } from "../../components/section-intro.tsx"
import {
  NewsletterForm,
  OG_IMAGE_SIZE,
  PERSON_JSON_LD,
  SITE_NAME,
  SiteFrame,
  spaLinks,
} from "../../site.tsx"
import { define, type State } from "../../utils.ts"

/** What the page says for a post that is not live, or an address that never was one. */
export const POST_NOT_FOUND = {
  title: `This post is not here`,
  description: `It may have moved or been unpublished.`,
} as const

/**
 * One live post: its trail, title, dates and reading time, cover, key points and body, then one
 * call to action (the newsletter while it is on, else the demo) and up to three posts to read next.
 * A draft, a scheduled post and an unknown address answer 404 with {@link POST_NOT_FOUND}.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const found = await readPost(ctx.state.api, ctx.params.slug ?? ``)
    if (!found) return renderNotFound(ctx)
    const { post, readNext } = found
    const origin = ctx.state.webAppOrigin
    const cover = post.coverUrl === null ? null : { url: post.coverUrl, alt: post.coverAlt ?? `` }
    return ctx.render(
      <SiteFrame
        state={ctx.state}
        path={postPath(post.slug)}
        head={{
          title: post.seoTitle ?? post.title,
          description: post.description,
          ogType: `article`,
          image: cover ?? undefined,
          jsonLd: postJsonLd(origin, post),
        }}
        footerNewsletter={!ctx.state.newsletter}
      >
        <Head>
          <meta property="article:published_time" content={post.publishedAt} />
          {post.updatedAt && <meta property="article:modified_time" content={post.updatedAt} />}
          {post.topic && <meta property="article:section" content={post.topic} />}
        </Head>
        <PostBody post={post} />
        {ctx.state.newsletter ? <NewsletterBand /> : (
          <CtaBand
            title={`See ${SITE_NAME} working in a minute`}
            demoHref={spaLinks(ctx.state.spaOrigin).try}
          />
        )}
        <ReadNext posts={readNext} />
      </SiteFrame>,
    )
  },
})

/** The post's structured data: the `BlogPosting` and its trail, Home › Blog › the post. */
function postJsonLd(origin: string, post: PublicBlogPost): unknown[] {
  const url = `${origin}${postPath(post.slug)}`
  return [
    blogPostingJsonLd({
      url,
      headline: post.title,
      description: post.description,
      image: post.coverUrl ?? { url: `${origin}/og/home.png`, ...OG_IMAGE_SIZE },
      datePublished: new Date(post.publishedAt),
      dateModified: post.updatedAt === null ? undefined : new Date(post.updatedAt),
      author: { name: post.authorName ?? SITE_NAME },
      publisher: { id: PERSON_JSON_LD["@id"] },
      section: post.topic ?? undefined,
      inLanguage: `en`,
      readingMinutes: post.readingMinutes,
      blog: { id: blogId(origin), name: BLOG_NAME, url: `${origin}${BLOG_PATH}` },
    }),
    breadcrumbListJsonLd(url, [
      { name: SITE_NAME, href: `${origin}/` },
      { name: `Blog`, href: `${origin}${BLOG_PATH}` },
      { name: post.title },
    ]),
  ]
}

/**
 * The article itself. A post of {@link TOC_MIN_MINUTES} minutes or more with sections gets "On this
 * page" beside it from 1280 px, in the right margin; on a narrower screen the body reads alone.
 */
function PostBody({ post }: { post: PublicBlogPost }): JSX.Element {
  const format = useFormat().utc()
  const sections = post.readingMinutes >= TOC_MIN_MINUTES
    ? post.headings.filter(({ depth }) => depth === 2)
    : []
  const toc = sections.length > 0
  return (
    <div
      class={`mx-auto w-full px-4 py-12 sm:px-6 lg:px-8 lg:py-16 ${
        // The reading column stays centred, in line with the bands below; the list sits beside it.
        toc
          ? "max-w-2xl xl:grid xl:max-w-7xl xl:grid-cols-[minmax(0,1fr)_42rem_minmax(0,1fr)] xl:gap-12"
          : "max-w-2xl"}`}
    >
      <article class="flex min-w-0 flex-col gap-6 xl:col-start-2" data-e2e="blog-post">
        <header class="flex flex-col gap-4">
          <nav aria-label="Breadcrumb" class="text-sm">
            <ol class="flex flex-wrap items-center gap-2 text-muted">
              <li>
                <a href={BLOG_PATH} class="font-medium text-primary hover:underline">Blog</a>
              </li>
              {post.topic && (
                <>
                  <li aria-hidden="true">›</li>
                  <li>
                    <a
                      href={`${BLOG_PATH}?${new URLSearchParams({ topic: post.topic })}`}
                      class="font-medium text-primary hover:underline"
                    >
                      {post.topic}
                    </a>
                  </li>
                </>
              )}
            </ol>
          </nav>
          {post.topic && <p class="font-mono text-sm font-medium text-primary">{post.topic}</p>}
          <h1 class="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
            {post.title}
          </h1>
          <p class="flex flex-wrap gap-x-1 gap-y-1 text-sm text-muted" data-e2e="blog-post-meta">
            <span>
              Published <time dateTime={post.publishedAt}>{format.date(post.publishedAt)}</time>
            </span>
            {post.updatedAt && (
              <span>
                · Updated <time dateTime={post.updatedAt}>{format.date(post.updatedAt)}</time>
              </span>
            )}
            <span>· {post.readingMinutes} min read</span>
            {post.authorName && <span>· {post.authorName}</span>}
          </p>
        </header>
        {post.coverUrl && (
          <img
            src={post.coverUrl}
            alt={post.coverAlt ?? ``}
            width={1200}
            height={630}
            loading="eager"
            fetchpriority="high"
            decoding="async"
            class="aspect-video w-full rounded-card border border-subtle bg-surface object-cover"
            data-e2e="blog-post-cover"
          />
        )}
        <TldrBox items={post.tldr} />
        {/* The API's HTML, rendered by the safe Markdown renderer on the server (docs/blog.md). */}
        <Prose html={post.html} />
      </article>
      {toc && (
        <aside class="hidden xl:col-start-3 xl:block" data-e2e="blog-post-toc">
          <OnThisPage links={sections.map(({ id, text }) => ({ label: text, href: `#${id}` }))} />
        </aside>
      )}
    </div>
  )
}

/** The newsletter as the post's one call to action. */
function NewsletterBand(): JSX.Element {
  return (
    <Band tone="glow" labelledBy="post-news" width="md" class="border-t border-subtle">
      <div class="flex flex-col gap-4" data-e2e="blog-post-newsletter">
        <SectionIntro
          id="post-news"
          title="Get the next post by email"
          lead="A short email when a post is out or something ships. You confirm by email first; one click unsubscribes."
        />
        <NewsletterForm id="post" />
      </div>
    </Band>
  )
}

/** Up to three posts to read next, then the way back to all of them. */
function ReadNext({ posts }: { posts: readonly PublicBlogPostSummary[] }): JSX.Element {
  return (
    <section
      aria-labelledby={posts.length > 0 ? "read-next" : undefined}
      aria-label={posts.length > 0 ? undefined : "More posts"}
      class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12 sm:px-6 lg:py-16"
      data-e2e="blog-read-next"
    >
      {posts.length > 0 && (
        <>
          <h2 id="read-next" class="text-2xl font-semibold tracking-tight">Read next</h2>
          <PostList
            headingLevel={3}
            posts={posts.map((post) => ({
              href: postPath(post.slug),
              title: post.title,
              description: post.description,
              publishedAt: post.publishedAt,
              readMinutes: post.readingMinutes,
            }))}
          />
        </>
      )}
      <a href={BLOG_PATH} class="self-start font-medium text-primary underline">All posts</a>
    </section>
  )
}

/** The 404 of a post that is not live: why, and the way to the posts that are. */
function renderNotFound(ctx: FreshContext<State>): Response | Promise<Response> {
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={ctx.url.pathname}
      head={{ ...POST_NOT_FOUND, noindex: true }}
    >
      <section
        aria-labelledby="post-missing"
        class="site-glow flex min-h-[60vh] items-center"
        data-e2e="blog-post-missing"
        data-analytics-view="not-found"
      >
        <div class="mx-auto flex w-full max-w-md flex-col items-start gap-6 px-4 py-16">
          <p class="font-mono text-6xl font-semibold text-muted" aria-hidden="true">404</p>
          <h1 id="post-missing" class="text-3xl font-semibold tracking-tight">
            {POST_NOT_FOUND.title}
          </h1>
          <p class="text-muted text-pretty">{POST_NOT_FOUND.description}</p>
          <Button href={BLOG_PATH}>All posts</Button>
        </div>
      </section>
    </SiteFrame>,
    { status: 404 },
  )
}
