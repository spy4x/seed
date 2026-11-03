import type { JSX } from "preact"
import type { FreshContext } from "fresh"
import { Head } from "fresh/runtime"
import type { BlogTranslation, PublicBlogPost, PublicBlogPostSummary } from "@domain/blog"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { Button } from "@spy4x/preact-ui/button"
import { languageName } from "@spy4x/preact-ui/language-picker"
import { useFormat } from "@spy4x/preact-ui/format"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import { PostList } from "@spy4x/preact-ui/post-list"
import { TldrBox } from "@spy4x/preact-ui/tldr-box"
import {
  blogPostingJsonLd,
  breadcrumbListJsonLd,
  type JsonLdPerson,
} from "@spy4x/platform/universal/seo"
import {
  BLOG_PATH,
  blogId,
  postAddress,
  postPath,
  readPost,
  TOC_MIN_MINUTES,
} from "../../../blog.ts"
import { CtaBand } from "../../../components/cta-band.tsx"
import {
  AUTHOR_URL,
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
 * language still works. Its page names its live translations as language versions (`hreflang`)
 * and links them by name under the byline, and names nothing when it has none.
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
      author: postAuthor(post),
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
 * The post's author for its structured data: the name and the page it links to. A link on the
 * site author's own domain ({@link AUTHOR_URL}) is that person, so the author also carries their
 * `@id`, the one {@link PERSON_JSON_LD} and the site author's own site give them.
 */
export function postAuthor(
  post: Pick<PublicBlogPost, `authorName` | `authorUrl`>,
): JsonLdPerson {
  const name = post.authorName ?? SITE_NAME
  if (post.authorUrl === null) return { name }
  const own = new URL(post.authorUrl).origin === new URL(AUTHOR_URL).origin
  return own
    ? { id: PERSON_JSON_LD[`@id`], name, url: post.authorUrl }
    : { name, url: post.authorUrl }
}

/**
 * The page's side gutter, around a post's column. The article, the newsletter and "Read next" all
 * sit in one centred column of 42 rem inside it, so the three start at one left edge (#416).
 */
const GUTTER = `px-4 sm:px-6 lg:px-8`

/** The post's reading column, inside {@link GUTTER}. */
const COLUMN = `mx-auto w-full max-w-2xl`

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
    <div class={`${GUTTER} py-12 lg:py-16`}>
      <div
        class={`${COLUMN} ${
          // The reading column stays centred, in line with the blocks below; the list sits beside it.
          toc
            ? "xl:grid xl:max-w-7xl xl:grid-cols-[minmax(0,1fr)_42rem_minmax(0,1fr)] xl:gap-12"
            : ""}`}
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
              {post.authorName && (
                <span>
                  ·{` `}
                  {post.authorUrl
                    ? (
                      <a
                        href={post.authorUrl}
                        rel="author"
                        class="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        data-e2e="blog-post-author"
                      >
                        {post.authorName}
                      </a>
                    )
                    : post.authorName}
                </span>
              )}
            </p>
            {post.translations.length > 0 && (
              <p class="text-sm text-muted" data-e2e="blog-post-translations">
                {rich(`Blog.alsoIn`, {
                  links: () => <TranslationLinks translations={post.translations} />,
                })}
              </p>
            )}
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
              links={sectionLinks(
                sections.map(({ id, text }) => ({ label: text, href: `#${id}` })),
              )}
              openFrom="xl"
            />
          </aside>
        )}
      </div>
    </div>
  )
}

/**
 * The post's live translations, each named in its own language and linked at its own address, as
 * a list in the page's language: "Deutsch, Español and Français" (#530).
 */
function TranslationLinks(
  { translations }: { translations: readonly BlogTranslation[] },
): JSX.Element {
  const { language } = useSite()
  const parts = new Intl.ListFormat(language, { type: `conjunction` })
    .formatToParts(translations.map(({ language }) => languageName(language)))
  let next = 0
  return (
    <>
      {parts.map((part) => {
        if (part.type === `literal`) return part.value
        const version = translations[next++]
        return (
          <a
            key={version.language}
            href={postAddress(version)}
            hreflang={version.language}
            lang={version.language}
            class="font-medium text-primary underline"
          >
            {part.value}
          </a>
        )
      })}
    </>
  )
}

/**
 * The newsletter as the post's one call to action: in the post's column, under a heading the size
 * of "Read next", so it reads as part of the post and not as a second title (#416).
 */
function NewsletterBand(): JSX.Element {
  const { t } = useSite()
  return (
    <section
      aria-labelledby="post-news"
      class={`site-glow border-t border-subtle ${GUTTER} py-12 lg:py-16`}
    >
      <div class={`${COLUMN} flex flex-col gap-4`} data-e2e="blog-post-newsletter">
        <h2 id="post-news" class="text-2xl font-semibold tracking-tight text-balance">
          {t.t(`Blog.newsTitle`)}
        </h2>
        <p class="text-muted text-pretty">{t.t(`Blog.newsLead`)}</p>
        <div class="max-w-md">
          <NewsletterForm id="post" />
        </div>
      </div>
    </section>
  )
}

/** Up to three posts to read next, then the way back to all of them. */
function ReadNext({ posts }: { posts: readonly PublicBlogPostSummary[] }): JSX.Element {
  const { t, href } = useSite()
  return (
    <section
      aria-labelledby={posts.length > 0 ? "read-next" : undefined}
      aria-label={posts.length > 0 ? undefined : t.t(`Blog.morePosts`)}
      class={`${GUTTER} py-12 lg:py-16`}
      data-e2e="blog-read-next"
    >
      <div class={`${COLUMN} flex flex-col gap-4`}>
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
      </div>
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
