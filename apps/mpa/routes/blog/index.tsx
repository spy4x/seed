import type { JSX } from "preact"
import type { PublicBlogPostSummary } from "@domain/blog"
import { IconCheck } from "@spy4x/preact-icons"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { PostList } from "@spy4x/preact-ui/post-list"
import { breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import {
  BLOG_INTRO,
  BLOG_NAME,
  BLOG_PATH,
  blogId,
  listPosts,
  postPath,
  RSS_PATH,
} from "../../blog.ts"
import { NewsletterForm, PERSON_JSON_LD, SITE_NAME, SiteFrame } from "../../site.tsx"
import { define } from "../../utils.ts"

/** The blog index's title and description, for its `<head>`. */
export const BLOG_HEAD = { title: `Blog`, description: BLOG_INTRO } as const

/** The topics of `posts`, each once, A to Z as the API sorts them. */
export function topicsOf(posts: readonly PublicBlogPostSummary[]): string[] {
  const topics = new Set(posts.flatMap(({ topic }) => topic === null ? [] : [topic]))
  return [...topics].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b)
  )
}

/** A topic's view of the index. The canonical address stays `/blog` for every topic. */
function topicHref(topic: string | null): string {
  return topic === null ? BLOG_PATH : `${BLOG_PATH}?${new URLSearchParams({ topic })}`
}

/**
 * The blog's index: every live post, newest first, with the topics as plain links (`?topic=`), so
 * it works without JavaScript. With no live post it says so, keeps out of search results and offers
 * the newsletter; a topic without posts links back to all posts.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const all = await listPosts(ctx.state.api)
    const topic = ctx.url.searchParams.get(`topic`)?.trim() || null
    const posts = topic === null ? all : all.filter((post) => post.topic === topic)
    const origin = ctx.state.webAppOrigin
    const empty = all.length === 0
    const offerNewsletter = empty && ctx.state.newsletter
    return ctx.render(
      <SiteFrame
        state={ctx.state}
        path={BLOG_PATH}
        head={{
          ...BLOG_HEAD,
          // Nothing to list yet, or a topic with nothing on it: no page worth a search result.
          noindex: posts.length === 0,
          jsonLd: [
            {
              "@type": `Blog`,
              "@id": blogId(origin),
              name: BLOG_NAME,
              url: `${origin}${BLOG_PATH}`,
              description: BLOG_INTRO,
              publisher: { "@id": PERSON_JSON_LD["@id"] },
            },
            breadcrumbListJsonLd(`${origin}${BLOG_PATH}`, [
              { name: SITE_NAME, href: `${origin}/` },
              { name: `Blog` },
            ]),
          ],
        }}
        footerNewsletter={!offerNewsletter}
      >
        <div
          class="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 lg:py-16"
          data-e2e="blog-index"
        >
          <header class="flex flex-col gap-4">
            <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h1 class="text-3xl font-semibold tracking-tight text-balance lg:text-5xl">Blog</h1>
              {!empty && (
                <a
                  href={RSS_PATH}
                  aria-label="Subscribe to the blog's RSS feed"
                  class="inline-flex min-h-11 items-center rounded-control font-medium text-primary hover:underline"
                  data-e2e="blog-rss"
                >
                  RSS feed
                </a>
              )}
            </div>
            <p class="text-lg text-muted text-pretty lg:text-xl">{BLOG_INTRO}</p>
          </header>
          {empty ? <NoPosts newsletter={offerNewsletter} /> : (
            <>
              <TopicLinks topics={topicsOf(all)} current={topic} />
              {posts.length === 0
                ? (
                  <div class="flex flex-col items-start gap-2" data-e2e="blog-topic-empty">
                    <h2 class="text-xl font-semibold">No posts on this topic yet</h2>
                    <a href={BLOG_PATH} class="font-medium text-primary underline">All posts</a>
                  </div>
                )
                : (
                  <PostList
                    posts={posts.map((post) => ({
                      href: postPath(post.slug),
                      title: post.title,
                      description: post.description,
                      publishedAt: post.publishedAt,
                      readMinutes: post.readingMinutes,
                    }))}
                  />
                )}
            </>
          )}
        </div>
      </SiteFrame>,
    )
  },
})

/** The topics as links, the current one marked: "All topics" first. Nothing without topics. */
function TopicLinks(
  { topics, current }: { topics: readonly string[]; current: string | null },
): JSX.Element | null {
  if (topics.length === 0) return null
  const options = [
    { label: `All topics`, topic: null },
    ...topics.map((t) => ({ label: t, topic: t })),
  ]
  return (
    <nav aria-label="Topics" data-e2e="blog-topics">
      <ul class="flex flex-wrap gap-2">
        {options.map(({ label, topic }) => {
          const here = topic === current
          return (
            <li key={label}>
              <a
                href={topicHref(topic)}
                // Fresh marks every link to the current path as the page; only the chosen topic is.
                aria-current={here ? "page" : "false"}
                class={badgeClasses(
                  here ? "purple" : "gray",
                  here ? "filled" : "outline",
                  `normal-case gap-1 min-h-11 sm:min-h-8 px-3 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus focus-visible:outline-hidden ${
                    here ? "" : "bg-surface text-foreground border-subtle hover:bg-hover"
                  }`,
                )}
              >
                {here && <IconCheck class="size-3.5" aria-hidden="true" />}
                {label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** The blog before its first post: what is coming, and the newsletter while it is on. */
function NoPosts({ newsletter }: { newsletter: boolean }): JSX.Element {
  return (
    <section
      aria-labelledby="blog-empty"
      class="flex flex-col gap-4 rounded-card border border-subtle bg-surface p-6"
      data-e2e="blog-empty"
    >
      <h2 id="blog-empty" class="text-xl font-semibold">No posts yet</h2>
      {newsletter
        ? (
          <>
            <p class="text-muted text-pretty">The first one is on its way. Get it by email:</p>
            <NewsletterForm id="blog" />
          </>
        )
        : <p class="text-muted text-pretty">The first one is on its way.</p>}
    </section>
  )
}
