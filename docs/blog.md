# The blog

Operators write posts in the admin app; the public website shows the published ones. A post is a
**draft**, **scheduled** for a time, or **published**. Posts live in Postgres (`blog_posts`).

## Where it lives

| Where                                      | What                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `libs/domain/blog/+lib.ts`                 | Shapes, limits, request schemas, field checks, errors, audit kinds.                   |
| `libs/server/blog/postgres-blog-repository.ts` | The admin's reads and writes, each write with its audit row in one transaction.   |
| `libs/server/blog/public-blog.ts`          | The website's reads: live posts only.                                                 |
| `libs/server/blog/blog-publish-job.ts`     | The `blog.publish` job, and `queueDueBlogJobs`, which gives lost jobs back.           |
| `libs/server/blog/render.ts`               | Markdown to safe HTML and the reading time. The only place a body is rendered.        |
| `libs/server/blog/sample-posts.ts`         | Three sample posts for `deno task db:seed` in development.                             |
| `apps/api/routes/admin/blog.ts`            | `/api/admin/blog/*`, behind the operator gate.                                        |
| `apps/api/routes/blog.ts`                  | `/api/blog/*`, public: `posts?topic=`, `posts/:slug`, `topics`, `feed`.               |

## The life of a post

- **Publish now** makes the post live at once. **Schedule** sets `publish_at` and queues a
  `blog.publish` job for that time; the job publishes it. Moving the time or unscheduling leaves
  the old job in place: when it runs it finds the post not due, or a draft, and does nothing.
- `published_at` is set the first time a post goes live and never moves, so unpublishing and
  publishing again keeps the date readers saw. From then on the slug is locked; **Change URL**
  changes it, and old links stop working (there are no redirects).
- Saving a published post with **Significant update** sets `content_updated_at`, shown as
  "Updated" and used by the sitemap and the feed.
- Every write names the version the operator saw. A stale one gets 409 with the current version.
  Each write locks the post, so two operators acting at once are served one after the other.
- Every operator action writes one `audit_events` row (`blog.post_*`) on the operator, shown in
  the audit log.

## The newsletter send

Publishing with a list ("Also email this post") stores `newsletter_list`. When the post is live,
the `blog.publish` job queues a newsletter issue: the title, the description, the key points and a
"Read the post" button to `MPA_DOMAIN/blog/<slug>`. The issue id is the post's id.

A post is emailed **once ever**. The job sets `newsletter_sent_at` and `newsletter_recipients` (the
confirmed subscribers at that moment) in the same transaction that queues the issue, and never
queues one for a post where it is set: not on a retried job, not after unpublishing and publishing
again, not when two runs race (the post is locked). The send itself is the newsletter's
`subscribers.send-issue` job, whose send log mails each address at most once.

Emailing needs mail subscriptions on and `MPA_DOMAIN` set; otherwise the admin API refuses a list
with `NEWSLETTER_OFF`, and `GET /api/admin/blog/newsletter` says `enabled: false`.

## What the website never sees

The public routes answer only posts that are published and due. A draft, a scheduled post or an
unpublished one is a 404, like an address that never existed. No public answer carries a post's
id, its author's account id or address, or its newsletter.

## Markdown

Bodies are rendered on the server by `renderBlogBody` (`libs/server/blog/render.ts`). Until the
safe Markdown renderer of spy4x/ts-libs#743 is released, it escapes the text and keeps paragraphs,
so nothing is interpreted. With the release, the same function renders Markdown with raw HTML
escaped, links limited to `https:`, `http:`, `mailto:` and relative paths, and ids on headings.

## Demo and development

The public demo's nightly wipe keeps `blog_posts` ([demo.md](demo.md)); the demo seeds no posts.
In development, `deno task db:seed` adds a published, a scheduled and a draft post by
`admin@example.com`.
