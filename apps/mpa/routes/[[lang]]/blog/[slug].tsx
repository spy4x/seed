import type { JSX } from "preact"
import type { FreshContext } from "fresh"
import { Head } from "fresh/runtime"
import type { PublicBlogPost, PublicBlogPostSummary } from "@domain/blog"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { Button } from "@spy4x/preact-ui/button"
import { useFormat } from "@spy4x/preact-ui/format"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { PostList } from "@spy4x/preact-ui/post-list"
import { TldrBox } from "@spy4x/preact-ui/tldr-box"
import { blogPostingJsonLd, breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import {
  BLOG_PATH,
  blogId,
  postAddress,
  postPath,
  readPost,
  TOC_MIN_MINUTES,
} from "../../../blog.ts"
import { Band } from "../../../components/band.tsx"
import { CtaBand } from "../../../components/cta-band.tsx"
import { SectionIntro } from "../../../components/section-intro.tsx"
import {
  NewsletterForm,
  OG_IMAGE_SIZE,
  PERSON_JSON_LD,
  sectionLinks,
  SITE_NAME,
  SiteFrame,
  spaLinks,
} from "../../../site.tsx"
import { define, type State } from "../../../utils.ts"
import { figureCatalog, localePath, siteTranslator } from "../../../languages.ts"
import {
  postFigures,
  resolveBody,
  type ResolvedBody,
  warnHiddenFigures,
} from "../../../post-figures.tsx"
import { PostSegments } from "../../../components/post-segments.tsx"
import { useSite } from "../../../use-site.tsx"
import { siteEnglishText } from "@ui/site-text.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"

/** What the page says for a post that is not live, or an address that never was one. */
export function postNotFound(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`Blog.notFoundTitle`), description: t.t(`Blog.notFoundLead`) }
}

/** {@link postNotFound} in English. */
export const POST_NOT_FOUND = postNotFound(siteEnglishText())

/**
 * One live post: its trail, title, dates and reading time, cover, key points and body, then one
 * call to action (the newsletter while it is on, else the demo) and up to three posts to read next.
 * A draft, a scheduled post and an unknown address answer 404 with {@link POST_NOT_FOUND}.
 *
 * A post is written in one language and lives at that language's address (`/de/blog/<slug>` for
 * German); another language's address redirects there for good, so a link from before posts had a
 * language still works. Its page names its live translations as language versions (`hreflang`),
 * and nothing when it has none.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const found = await readPost(ctx.state.api, ctx.params.slug ?? ``)
    if (!found) return renderNotFound(ctx)
    const { post, readNext } = found
    if (post.language !== ctx.state.language) return ctx.redirect(postAddress(post), 301)
    const origin = ctx.state.webAppOrigin
    const cover = post.coverUrl === null ? null : { url: post.coverUrl, alt: post.coverAlt ?? `` }
    const t = siteTranslator(ctx.state.language)
    const body = resolveBody(post.segments, post.headings, await postFigures())
    warnHiddenFigures(post.slug, body.problems)
    return ctx.render(
      <SiteFrame
        state={ctx.state}
        path={postPath(post.slug)}
        head={{
          title: post.seoTitle ?? post.title,
          description: post.description,
          ogType: `article`,
          image: cover ?? undefined,
          jsonLd: postJsonLd(t, origin, post),
          alternates: [post, ...post.translations].map((version) => ({
            language: version.language,
            path: postPath(version.slug),
          })),
          elsewhere: BLOG_PATH,
        }}
        footerNewsletter={!ctx.state.newsletter}
      >
        <Head>
          <meta property="article:published_time" content={post.publishedAt} />
          {post.updatedAt && <meta property="article:modified_time" content={post.updatedAt} />}
          {post.topic && <meta property="article:section" content={post.topic} />}
        </Head>
        <PostBody post={post} parts={body.parts} />
        {ctx.state.newsletter ? <NewsletterBand /> : (
          <CtaBand
            title={t.t(`Blog.ctaTitle`, { site: SITE_NAME })}
            demoHref={spaLinks(ctx.state.spaOrigin).try}
          />
        )}
        <ReadNext posts={readNext} />
      </SiteFrame>,
    )
  },
})

/** The post's structured data: the `BlogPosting` and its trail, Home › Blog › the post. */
function postJsonLd(t: Translator<string>, origin: string, post: PublicBlogPost): unknown[] {
  const url = `${origin}${postAddress(post)}`
  const blog = `${origin}${localePath(post.language, BLOG_PATH)}`
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
      inLanguage: post.language,
      readingMinutes: post.readingMinutes,
      blog: {
        id: blogId(origin, post.language),
        name: t.t(`Blog.name`, { site: SITE_NAME }),
        url: blog,
      },
    }),
    breadcrumbListJsonLd(url, [
      { name: SITE_NAME, href: `${origin}${localePath(post.language, `/`)}` },
      { name: t.t(`Blog.title`), href: blog },
      { name: post.title },
    ]),
  ]
}

/**
 * The article itself. A post of {@link TOC_MIN_MINUTES} minutes or more with sections gets "On this
 * page" beside it from 1280 px, in the right margin; on a narrower screen the body reads alone.
 */
function PostBody(
  { post, parts }: { post: PublicBlogPost; parts: ResolvedBody[`parts`] },
): JSX.Element {
  const { t, rich, href } = useSite()
  const format = useFormat().utc()
  const blog = href(BLOG_PATH)
  const time = (iso: string) => (text: string) => <time dateTime={iso}>{text}</time>
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
          <Breadcrumbs
            label={t.t(`Blog.breadcrumb`)}
            items={[
              { label: t.t(`Blog.title`), href: blog },
              ...(post.topic
                ? [{
                  label: post.topic,
                  href: `${blog}?${new URLSearchParams({ topic: post.topic })}`,
                }]
                : []),
            ]}
          />
          {post.topic && <p class="font-mono text-sm font-medium text-primary">{post.topic}</p>}
          <h1 class="text-3xl font-semibold tracking-tight text-balance lg:text-4xl">
            {post.title}
          </h1>
          <p class="flex flex-wrap gap-x-1 gap-y-1 text-sm text-muted" data-e2e="blog-post-meta">
            <span>
              {rich(`Blog.published`, { time: time(post.publishedAt) }, {
                date: format.date(post.publishedAt),
              })}
            </span>
            {post.updatedAt && (
              <span>
                {rich(`Blog.updated`, { time: time(post.updatedAt) }, {
                  date: format.date(post.updatedAt),
                })}
              </span>
            )}
            <span>{t.t(`Blog.minutes`, { count: post.readingMinutes })}</span>
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
        <PostSegments
          parts={parts}
          language={post.language}
          messages={figureCatalog(post.language)}
        />
      </article>
      {toc && (
        <aside class="hidden xl:col-start-3 xl:block" data-e2e="blog-post-toc">
          <OnThisPage
            links={sectionLinks(sections.map(({ id, text }) => ({ label: text, href: `#${id}` })))}
            openFrom="xl"
          />
        </aside>
      )}
    </div>
  )
}

/** The newsletter as the post's one call to action. */
function NewsletterBand(): JSX.Element {
  const { t } = useSite()
  return (
    <Band tone="glow" labelledBy="post-news" width="md" class="border-t border-subtle">
      <div class="flex flex-col gap-4" data-e2e="blog-post-newsletter">
        <SectionIntro
          id="post-news"
          title={t.t(`Blog.newsTitle`)}
          lead={t.t(`Blog.newsLead`)}
        />
        <NewsletterForm id="post" />
      </div>
    </Band>
  )
}

/** Up to three posts to read next, then the way back to all of them. */
function ReadNext({ posts }: { posts: readonly PublicBlogPostSummary[] }): JSX.Element {
  const { t, href } = useSite()
  return (
    <section
      aria-labelledby={posts.length > 0 ? "read-next" : undefined}
      aria-label={posts.length > 0 ? undefined : t.t(`Blog.morePosts`)}
      class="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-12 sm:px-6 lg:py-16"
      data-e2e="blog-read-next"
    >
      {posts.length > 0 && (
        <>
          <h2 id="read-next" class="text-2xl font-semibold tracking-tight">
            {t.t(`Blog.readNext`)}
          </h2>
          <PostList
            headingLevel={3}
            posts={posts.map((post) => ({
              href: href(postPath(post.slug)),
              title: post.title,
              description: post.description,
              publishedAt: post.publishedAt,
              readMinutes: post.readingMinutes,
              lang: post.language,
            }))}
          />
        </>
      )}
      <a href={href(BLOG_PATH)} class="self-start font-medium text-primary underline">
        {t.t(`Blog.allPosts`)}
      </a>
    </section>
  )
}

/** The 404 of a post that is not live: why, and the way to the posts that are. */
function renderNotFound(ctx: FreshContext<State>): Response | Promise<Response> {
  const t = siteTranslator(ctx.state.language)
  const notFound = postNotFound(t)
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={ctx.url.pathname}
      head={{ ...notFound, noindex: true }}
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
            {notFound.title}
          </h1>
          <p class="text-muted text-pretty">{notFound.description}</p>
          <Button href={localePath(ctx.state.language, BLOG_PATH)}>{t.t(`Blog.allPosts`)}</Button>
        </div>
      </section>
    </SiteFrame>,
    { status: 404 },
  )
}
