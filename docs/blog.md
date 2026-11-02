# The blog

Operators write posts in the admin app; the public website shows the published ones. A post is a
**draft**, **scheduled** for a time, or **published**. Posts live in Postgres (`blog_posts`).

## Where it lives

| Where                                      | What                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `libs/domain/blog/+lib.ts`                 | Shapes, limits, request schemas, field checks, errors, audit kinds.                   |
| `libs/server/blog/postgres-blog-repository.ts` | The admin's reads and writes, each write with its audit row in one transaction.   |
| `libs/server/blog/public-blog.ts`          | The website's reads: live posts only.                                                 |
| `libs/server/blog/blog-publish-job.ts`     | The `blog.publish` job (registered in `JOBS`), and `queueDueBlogJobs` for lost jobs. |
| `libs/server/blog/render.ts`               | Markdown to safe HTML and the reading time. The only place a body is rendered.        |
| `libs/domain/blog/figures.ts`              | The check of a figure tag against the figures that exist, and the figures' ids.       |
| `apps/mpa/islands/post/`                   | The interactive figures a post can hold, one file per tag ([below](#interactive-figures)). |
| `apps/mpa/post-figures.tsx`                | The folder's registry, and a body's figures resolved for the page, the feed and the admin. |
| `libs/server/blog/seed-posts.ts`, `seed-posts/` | Seed's own posts as Markdown files, loaded only in demo mode and by `deno task db:seed` ([demo.md](demo.md#seeds-own-blog-posts)). |
| `apps/api/routes/admin/blog.ts`            | `/api/admin/blog/*`, behind the operator gate.                                        |
| `apps/admin/src/modules/blog/`             | The admin pages: the list (`/blog`) and the editor (`/blog/new`, `/blog/:id`).        |
| `libs/ui/admin-blog-*.tsx`                 | Their screens: the list, the editor and its dialogs.                                  |
| `apps/api/routes/blog.ts`                  | `/api/blog/*`, public: `posts?topic=`, `posts/:slug`, `topics`, `feed`.               |
| `apps/mpa/routes/[[lang]]/blog/`, `apps/mpa/blog.ts` | The public pages, below.                                                             |

## The life of a post

- **Publish now** makes the post live at once. **Schedule** sets `publish_at` and queues a
  `blog.publish` job for that time; the job publishes it. Moving the time or unscheduling leaves
  the old job in place: when it runs it finds the post not due, or a draft, and does nothing.
- In the admin's Jobs module, **Run now** on a scheduled post's job publishes nothing early: the
  run finds the post not due and queues the job for the post's time again, unless another run
  waits. **Cancel** is refused for `blog.publish`; Unschedule on the Blog page stops a post.
- `published_at` is set the first time a post goes live and never moves, so unpublishing and
  publishing again keeps the date readers saw. From then on the slug is locked; **Change URL**
  changes it, and old links stop working (there are no redirects).
- Saving a published post with **Significant update** sets `content_updated_at`, shown as
  "Updated" and used by the sitemap and the feed.
- Every write names the version the operator saw. A stale one gets 409 with the current version.
  Each write locks the post, so two operators acting at once are served one after the other.
- Every operator action writes one `audit_events` row (`blog.post_*`) on the operator, shown in
  the audit log.

## Languages and translations

Every post has a `language`, one of the languages the apps ship (`LANGUAGES`), and may name the
post it translates in `translation_of` (#527). A translation names the original, never another
translation, and in another language; a post has at most one translation per language. The
editor's Language and "Translation of" fields set both; anything else is refused with
`TRANSLATION_INVALID`. Deleting the original keeps its translations as posts of their own.

A post lives at its own language's address: `/blog/<slug>` in the main language, `/<language>/blog/<slug>`
in any other (`blogPostPath`). Its address in another language answers 301 to that one. Slugs are
unique across languages.

## The newsletter send

Publishing with a list ("Also email this post") stores `newsletter_list`. When the post is live,
the `blog.publish` job queues a newsletter issue: the title, the description, the key points and a
"Read the post" button to the post's own address on `MPA_DOMAIN`. The issue id is the post's id.

**An issue goes only to the subscribers of the post's language** (#527). A subscriber's language is
the one of the page they signed up on (`subscribers.language`); one with none, such as an address
from before languages existed, counts as the main language's. The issue stores its language
(`subscriber_issue_content.language`), the send job mails only those subscribers, and the button
label and the footer come from the mail catalog in that language, so nobody gets a post in a
language they did not sign up in. The publish dialog counts only those subscribers. An issue
queued with `deno task subscribers:send` has no language and goes to the whole list.

A post is emailed **once ever**. The job sets `newsletter_sent_at` and `newsletter_recipients` (the
confirmed subscribers of its language at that moment) in the same transaction that queues the issue, and never
queues one for a post where it is set: not on a retried job, not after unpublishing and publishing
again, not when two runs race (the post is locked). The send itself is the newsletter's
`subscribers.send-issue` job, whose send log mails each address at most once.

Emailing needs mail subscriptions on and `MPA_DOMAIN` set; otherwise the admin API refuses a list
with `NEWSLETTER_OFF`, and `GET /api/admin/blog/newsletter` says `enabled: false`.

## On the public website

The website (`apps/mpa`) renders every blog page on its server, with no JavaScript needed:

| Address        | What                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `/blog`        | Every live post in the page's language, newest first; topics as `?topic=` links, whose canonical address stays `/blog`. `/<language>/blog` is the same for that language. |
| `/blog/<slug>` | One post: trail, dates, reading time, cover, "In short", the body, one call to action and "Read next". |
| `/rss.xml`     | RSS 2.0 of the newest posts with their full HTML.                                                      |

`apps/mpa/blog.ts` reads the public API and checks each answer's shape. A post that is not live
answers 404 "This post is not here". With no live post, `/blog` says so and keeps out of search
results, and the Blog link, the RSS link, the sitemap entries and the `llms.txt` section stay
hidden; the website asks the API at most once a minute whether a post is live
(`blogLinkMiddleware`). Each post page carries `BlogPosting` and `BreadcrumbList` JSON-LD and
`og:type` `article`. Its `inLanguage` is the post's language, and the page names its live
translations as `hreflang` alternates; a post with none names no alternate. The blog index of a
language names the indexes of the other languages that have a live post. The Blog link shows on a
language's pages only while that language has one, and the sitemap lists each language's index
and each post once, at its own address.

The Lighthouse run (`deno task lighthouse`) measures `/blog` and Seed's post
`welcome-to-the-seed-blog`. It needs no database: `apps/mpa/lighthouse/blog-api.ts` answers the
public routes with the published posts of `libs/server/blog/seed-posts/`.

## What the website never sees

The public routes answer only posts that are published and due. A draft, a scheduled post or an
unpublished one is a 404, like an address that never existed. No public answer carries a post's
id, its author's account id or address, or its newsletter.

## The editor

The list filters by status (the address keeps it, `?status=`) and searches by title or slug; `c`
opens a new post. The editor saves with Ctrl S (Command S on a Mac). The slug follows the title
until it is typed by hand or the post is first published. The Preview tab asks the API to render
the body (`POST /api/admin/blog/preview`), so it shows exactly what the website will; the admin
app never renders Markdown itself. A scheduled post keeps its newsletter list when it is
published now or moved to another time: the editor names the list in every publish call, since
the API reads a missing list as "no email".

A tag that will not show is listed in a Problems panel under the Write and Preview tabs, rechecked
about a second after typing stops. Each row's "Line N" button selects that line in the body, and
F8 and Shift+F8 in the body jump to the next and the previous problem. The Preview tab draws each
figure live, from the website's own islands, and a warning where a tag will not show. Publishing
and scheduling warn about the problems and offer "Go to problems", but never refuse: a broken tag
hides one figure and leaves the rest of the post as written.

## Markdown

Bodies are rendered on the server by `renderBlogBody` (`libs/server/blog/render.ts`), which calls
`renderMarkdown` from `@spy4x/platform/universal/markdown`: GitHub-flavoured Markdown with raw
HTML escaped, links limited to `https:`, `http:`, `mailto:` and relative paths, and ids on
headings. The reading time is `readingMinutes` from `@spy4x/platform/universal/text`.

## Interactive figures

A post can hold an interactive figure: a tag on a line of its own, outside any list or quote.

```md
What does a team pay? Move the slider.

<CostCalculator members={4} />
```

The parser (`renderMarkdownSegments`) splits the body around each tag, and the API returns the
pieces as `segments`. The website looks each tag up in `apps/mpa/islands/post/` by its exact
name, checks its props against the file's schema and draws it inside `Explorable`, as
`figure[data-live]` with an id from its name (`cost-calculator`, `cost-calculator-2` on repeat).
With JavaScript off the figure shows its starting numbers and a note. A tag that fails (an unknown
name, refused props, a tag inside a list) shows nothing, and the server logs one warning per
render naming the post, the line and the tag. The RSS feed, where no script runs, shows the
figure's `fallback` text, or a link to it on the post's page.

### Adding a figure

Add one file to `apps/mpa/islands/post/`, named after its tag: `MyChart.tsx` is `<MyChart />`.
Nothing else lists the figures. The file exports:

- `default`: the island. It takes its props and `figure` (`FigureFrame`), and draws `PostFigure`
  (`apps/mpa/components/post-figure.tsx`) around its content, so its root is `figure[data-live]`.
- `props`: the arktype definition of its props, with `"+": "reject"`: a plain object such as
  `{ "members?": "1 <= number.integer <= 50", "+": "reject" }`, never a `type()` call. The
  server compiles it, and a tag's props reach the island only after it accepted them. Fresh
  ships every export of an island to the browser, so importing arktype there would add about
  190 KB and break the website's Content Security Policy.
- `fallback` (optional): `(props, t) => string`, the sentence the RSS feed shows instead.

Its words go in `i18n/site/` under `PostFigure.<Tag>.*`, in every language. `CostCalculator.tsx`
is the example to copy, and `apps/mpa/post-figures.test.tsx` checks every file in the folder.

## Demo and development

The public demo's nightly wipe keeps `blog_posts` ([demo.md](demo.md)); the demo seeds no posts.
In development, `deno task db:seed` adds a published, a scheduled and a draft post by
`admin@example.com`.
