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
| `libs/server/blog/sample-posts.ts`         | Sample posts for `deno task db:seed` in development: three in English, and the published one translated into every other language. |
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

The Lighthouse run (`deno task lighthouse`) measures `/blog` and the sample post `hello-world`.
It needs no database: `apps/mpa/lighthouse/blog-api.ts` answers the public routes with the dev
seed's published post.

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

## Markdown

Bodies are rendered on the server by `renderBlogBody` (`libs/server/blog/render.ts`), which calls
`renderMarkdown` from `@spy4x/platform/universal/markdown`: GitHub-flavoured Markdown with raw
HTML escaped, links limited to `https:`, `http:`, `mailto:` and relative paths, and ids on
headings. The reading time is `readingMinutes` from `@spy4x/platform/universal/text`.

## Demo and development

The public demo's nightly wipe keeps `blog_posts` ([demo.md](demo.md)); the demo seeds no posts.
In development, `deno task db:seed` adds a published, a scheduled and a draft post by
`admin@example.com`.
