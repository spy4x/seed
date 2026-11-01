// deno-lint-ignore-file ui-text/no-literal
// The changelog is English at every language's address, like the docs: its entries are commit
// subjects, which are written in English only. The frame around it is translated.
import type { JSX } from "preact"
import { Head } from "fresh/runtime"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import { CHANGE_LIST_LABELS, ChangeList } from "@spy4x/preact-ui/change-list"
import { OnThisPage } from "@spy4x/preact-ui/on-this-page"
import type { Api } from "../../api.ts"
import { listPosts, postPath } from "../../blog.ts"
import {
  CHANGELOG,
  CHANGELOG_FEED_PATH,
  CHANGELOG_FORMAT,
  CHANGELOG_HISTORY_URL,
  CHANGELOG_MONTHS,
  CHANGELOG_PATH,
  type ChangelogEntry,
  changelogPulse,
  changeMonth,
  groupByMonth,
} from "../../changelog.ts"
import { DEFAULT_LANGUAGE, localePath } from "../../languages.ts"
import { SITE_NAME, siteBreadcrumbsJsonLd, SiteFrame } from "../../site.tsx"
import { SiteLanguage, useSite } from "../../use-site.tsx"
import { define } from "../../utils.ts"

/** The changelog's title and description, for its head, the sitemap and `llms.txt`. */
export const CHANGELOG_HEAD = {
  title: `Seed changelog: what changed, month by month`,
  description:
    `Every feature and fix merged into Seed, newest first, each linked to its pull request. Seed is built in public and changes most weeks.`,
}

/** The title of the monthly post a month links to once it is live. */
export function monthPostTitle(month: string): string {
  return `What's new in ${SITE_NAME}, ${month}`
}

/**
 * The live English posts named like a month's "What's new" post, by title, so a month links to
 * its post only once it exists. Empty while the blog has no live post or the API cannot answer:
 * the changelog never waits on the blog.
 */
async function monthPosts(api: Api, blog: boolean): Promise<Map<string, string>> {
  if (!blog) return new Map()
  try {
    const posts = await listPosts(api)
    return new Map(
      posts.filter((post) => post.language === DEFAULT_LANGUAGE)
        .map((post) => [post.title, postPath(post.slug)]),
    )
  } catch {
    return new Map()
  }
}

/**
 * `/changelog`: every `feat` and `fix` merged into Seed, month by month, newest first, from the
 * history `deno task changelog` read before the build. The last {@link CHANGELOG_MONTHS} months
 * are listed in full and older ones are left to GitHub. With no history, it says so and links to
 * the commits.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const posts = await monthPosts(ctx.state.api, ctx.state.blog === true)
    const origin = ctx.state.webAppOrigin
    const url = `${origin}${CHANGELOG_PATH}`
    return ctx.render(
      <SiteLanguage language={ctx.state.language}>
        <SiteFrame
          state={ctx.state}
          path={CHANGELOG_PATH}
          head={{
            ...CHANGELOG_HEAD,
            oneLanguage: true,
            jsonLd: [
              {
                "@type": `WebPage`,
                "@id": `${url}#webpage`,
                url,
                name: CHANGELOG_HEAD.title,
                description: CHANGELOG_HEAD.description,
                inLanguage: DEFAULT_LANGUAGE,
                isPartOf: { "@id": `${origin}/#website` },
              },
              siteBreadcrumbsJsonLd(origin, CHANGELOG_PATH, `Changelog`),
            ],
          }}
        >
          <Head>
            <link
              rel="alternate"
              type="application/rss+xml"
              title={`${SITE_NAME} changelog`}
              href={`${origin}${CHANGELOG_FEED_PATH}`}
            />
          </Head>
          <Changelog
            entries={CHANGELOG.entries}
            posts={posts}
            newsletter={ctx.state.newsletter === true}
            now={new Date()}
          />
        </SiteFrame>
      </SiteLanguage>,
    )
  },
})

const LINK = `font-medium text-primary underline`

/** The page's content, apart from its frame. */
export function Changelog(
  { entries, posts, newsletter, now }: {
    entries: readonly ChangelogEntry[]
    /** The live month posts' addresses, by title. */
    posts: ReadonlyMap<string, string>
    newsletter: boolean
    now: Date
  },
): JSX.Element {
  const { t, language, href } = useSite()
  const all = groupByMonth(entries)
  const months = all.slice(0, CHANGELOG_MONTHS)
  const pulse = changelogPulse(entries, now)
  const sections = [
    ...months.map((month) => ({ label: month.title, href: `#${month.id}` })),
    ...(months.length > 0
      ? [{ label: `Earlier changes on GitHub`, href: CHANGELOG_HISTORY_URL }]
      : []),
  ]
  return (
    <div class="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16 xl:grid xl:max-w-7xl xl:grid-cols-[minmax(0,1fr)_42rem_minmax(0,1fr)] xl:gap-x-12">
      {language !== DEFAULT_LANGUAGE && (
        <p class="mb-6 text-sm text-muted xl:col-start-2" data-e2e="english-only">
          {t.t(`LegalPage.englishOnly`)}
        </p>
      )}
      <div lang={DEFAULT_LANGUAGE} dir="ltr" class="contents">
        <header class="flex flex-col gap-4 xl:col-start-2" data-e2e="changelog-header">
          <Breadcrumbs
            label="Breadcrumb"
            items={[{ label: SITE_NAME, href: href(`/`) }, { label: `Changelog` }]}
          />
          <h1 class="text-3xl font-semibold tracking-tight text-balance break-words hyphens-auto lg:text-4xl">
            What changed in {SITE_NAME}
          </h1>
          <p class="text-lg text-muted text-pretty">
            Every feature and fix merged into{" "}
            {SITE_NAME}, newest first, each linked to its pull request. {SITE_NAME}{" "}
            has no version numbers: what is on <code dir="ltr">main</code> is the current{" "}
            {SITE_NAME}.
          </p>
          {pulse && (
            <p class="text-sm text-muted" data-e2e="changelog-pulse">
              Last change <time dateTime={pulse.last}>{CHANGELOG_FORMAT.date(pulse.last)}</time> ·
              {" "}
              {pulse.recent === 0
                ? `no changes in the last 30 days`
                : `${pulse.recent} ${
                  pulse.recent === 1 ? `change` : `changes`
                } in the last 30 days`}
            </p>
          )}
          <p class="text-sm text-muted text-pretty">
            {SITE_NAME}{" "}
            is built by one developer, Anton Shubin, who uses it for his own products and client
            work. It is MIT-licensed: your copy is yours, and a product takes later changes as a
            patch (<a href={href(`/docs/products`)} class={LINK}>Building a product on Seed</a>).
          </p>
          <p class="text-sm">
            Subscribe:{" "}
            <a href={CHANGELOG_FEED_PATH} class={LINK} data-e2e="changelog-feed">RSS feed</a>
            {newsletter && (
              <>
                {" · "}
                <a href={localePath(language, `/subscribe`)} class={LINK}>Newsletter</a>
              </>
            )}
          </p>
        </header>
        {months.length === 0 ? <EmptyChangelog /> : (
          <>
            <aside class="mt-8 xl:col-start-3 xl:row-span-3 xl:row-start-1 xl:mt-0">
              <OnThisPage links={sections} label="On this page" openFrom="xl" />
            </aside>
            <div class="mt-12 flex min-w-0 flex-col gap-12 xl:col-start-2" data-e2e="changelog">
              <ChangeList
                labels={{
                  ...CHANGE_LIST_LABELS,
                  pullRequest: (n) => `Pull request ${n} on GitHub`,
                }}
                months={months.map((month) => {
                  const post = posts.get(monthPostTitle(month.title))
                  return {
                    ...changeMonth(month),
                    note: post && (
                      <a href={post} class={LINK}>Read "{monthPostTitle(month.title)}"</a>
                    ),
                  }
                })}
              />
              <a
                href={CHANGELOG_HISTORY_URL}
                rel="noopener noreferrer"
                class={`self-start ${LINK}`}
                data-e2e="changelog-history"
              >
                Earlier changes on GitHub<span aria-hidden="true">{` ↗`}</span>
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** What the page shows with no history: why, and the way to the commits. */
function EmptyChangelog(): JSX.Element {
  return (
    <section
      aria-labelledby="changelog-empty"
      class="mt-12 flex flex-col items-start gap-3 rounded-card border border-subtle bg-surface p-6 xl:col-start-2"
      data-e2e="changelog-empty"
    >
      <h2 id="changelog-empty" class="text-xl font-semibold tracking-tight">
        No changes listed yet
      </h2>
      <p class="text-muted text-pretty">
        This page lists every change once it is merged. Until then, the commits on GitHub show what
        changed.
      </p>
      <a href={CHANGELOG_HISTORY_URL} rel="noopener noreferrer" class={LINK}>
        See the commits on GitHub<span aria-hidden="true">{` ↗`}</span>
      </a>
    </section>
  )
}
