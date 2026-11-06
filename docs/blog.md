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
| `libs/server/blog/blog-crosspost-job.ts`   | The `blog.crosspost` job, which copies a live post to Dev.to once ([below](#the-devto-cross-post)). |
| `libs/domain/blog/sharing.ts`, `libs/server/blog/postgres-sharing-repository.ts` | Sharing channels, each post's checklist and its results ([below](#sharing-channels)). |
| `libs/server/blog/social-texts.ts`         | The LinkedIn, Telegram and X texts of a post, printed by `deno task blog:social` ([below](#channel-texts)). |
| `apps/mpa/blog-covers.ts`, `apps/mpa/screenshots/blog-og.ts` | Covers as the pages draw them, and the link-preview cards of Seed's own posts ([below](#covers-and-link-previews)). |
| `libs/server/blog/blog-indexnow-job.ts`    | The `blog.indexnow` job, which tells search engines about a post ([below](#indexnow)). |
| `libs/server/blog/render.ts`               | Markdown to safe HTML and the reading time. The only place a body is rendered.        |
| `libs/domain/blog/figures.ts`              | The check of a figure tag against the figures that exist, and the figures' ids.       |
| `apps/mpa/islands/post/`                   | The interactive figures a post can hold, one file per tag ([below](#interactive-figures)). |
| `apps/mpa/post-figures.tsx`                | The folder's registry, and a body's figures resolved for the page, the feed and the admin. |
| `libs/server/blog/seed-posts.ts`, `seed-posts/` | Seed's own posts as Markdown files, loaded only in demo mode and by `deno task db:seed` ([demo.md](demo.md#seeds-own-blog-posts)). |
| `apps/api/routes/admin/blog.ts`            | `/api/admin/blog/*`, behind the operator gate.                                        |
| `apps/admin/src/modules/blog/`             | The admin pages: the list (`/blog`), the editor (`/blog/new`, `/blog/:id`), the channels (`/blog/channels`) and a post's sharing page (`/blog/:id/sharing`). |
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
  changes it, and the old address redirects to the new one ([below](#old-addresses)).
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
`TRANSLATION_INVALID`. A save that leaves out `language` or `translationOf` keeps the post's own
(#530). The check reads the original under a share lock, so two saves at once cannot build a chain
of translations. Deleting the original keeps its translations linked: the one in the main
language, else the oldest, becomes the original, and the others translate it (#530). Changing a
published post's language moves its address; the editor says where, and the old address
redirects there.

A post lives at its own language's address: `/blog/<slug>` in the main language, `/<language>/blog/<slug>`
in any other (`blogPostPath`). Its address in another language answers 301 to that one. Slugs are
unique across languages.

## Old addresses

A post that has been live keeps every slug it had before **Change URL** (#418), so links already
shared, indexed or mailed in a newsletter keep working. `/blog/<old>` and `/<language>/blog/<old>`
answer 301 to the post's current address, in its own language.

- `blog_slug_redirects` holds one row per old slug, naming the post, not the next slug: a chain of
  changes (a → b → c) sends `a` straight to `c`, and no chain can loop. Slugs are unique across
  languages, so the slug alone names the address in every language.
- Triggers on `blog_posts` write the rows in the transaction of the slug change, so every writer
  (the admin, Seed's own post files, a later one) keeps them. A draft's or a scheduled post's slug
  changes freely and leaves no row: nobody saw that address.
- A slug a post takes is that post's: its row is deleted in the same write. A new post that takes
  an old address owns it from then on, also as a draft, and the old row never comes back, so a link
  to the new post never lands on the old one. A post moved back to an old slug has no row either.
- Only a live post redirects. An old address of a draft, a scheduled or an unpublished post
  answers 404, as the post's own address does, so a redirect never shows that the post exists.
  Deleting a post deletes its rows.
- The website asks for a moved post only when no live post has the slug (`GET /api/blog/posts/:slug`
  answers `{ moved: { language, slug } }`), so a post's own address costs no extra read. The
  sitemap, the RSS feed and `llms.txt` list current addresses only.

## IndexNow

With `INDEXNOW_KEY` set (8 to 128 letters, digits and dashes) and `MPA_DOMAIN` set, Seed tells
[IndexNow](https://www.indexnow.org/) about a post whenever it goes live, changes while live, moves
with **Change URL** or is unpublished. Bing, Yandex and the other engines that share IndexNow, and
the AI answer engines that read Bing's index, then hear of the change at once instead of at their
next crawl. Without the key nothing is sent.

- **Its own job.** Each of those writes queues a `blog.indexnow` job in its own transaction: the
  admin's Publish now, a save, Change URL and Unpublish, the `blog.publish` job when it publishes a
  scheduled post, and Seed's own post files when one that is live is written. The worker sends the
  ping, so no request to IndexNow ever holds a post's lock or slows an operator's save. One job
  waits per post at a time: saves made before it runs share it, and it reads the post when it runs.
- **Every address.** The job sends the post's address in its language (`blogPostPath`) and every
  old address a Change URL left (`blog_slug_redirects`), at most `INDEXNOW_MAX_URLS` in one call. An
  unpublished post's addresses are sent too: the engines find them gone. A post that was never live
  sends nothing.
- **Fail-open.** A refused or failed ping is logged once, without the key, and the job still
  succeeds: it is not retried and never touches the post.
- **The key file.** IndexNow checks a ping against `/<key>.txt` on the website, so the website
  serves the key there as plain text, and only while `INDEXNOW_KEY` is set. The key is public by
  IndexNow's design; a malformed one stops the website and the worker at start.
- **The demo.** The public demo has no sample posts: its blog is Seed's own posts
  ([demo.md](demo.md#seeds-own-blog-posts)), which are real, so demo mode pings like any server.

## The newsletter send

Publishing with a list ("Also email this post") stores `newsletter_list`. When the post is live,
the `blog.publish` job queues a newsletter issue: the title, the intro (or, without one, the
description), the key points and a "Read the post" button to the post's own address on
`MPA_DOMAIN`. The issue id is the post's id.

**Nothing goes out before the website shows the post** (#733). Before it queues the issue or the
Dev.to cross-post, the job asks the website for the post's address: it must answer 200, without a
redirect, with the post's title on the page. Otherwise the job fails with `BlogPostNotLiveError`
and the job system tries again later ([jobs.md](jobs.md)), so no reader follows a link to a page
that is not there yet. The question is asked only while an email or a cross-post waits.

**An issue goes only to the subscribers of the post's language** (#527). A subscriber's language is
the one of the page they signed up on (`subscribers.language`); one with none, such as an address
from before languages existed, counts as the main language's. The issue stores its language
(`subscriber_issue_content.language`), the send job mails only those subscribers, and the button
label and the footer come from the mail catalog in that language, so nobody gets a post in a
language they did not sign up in. The publish dialog counts only those subscribers and names the
language; with none, it offers no email (#530). An issue
queued with `deno task subscribers:send` has no language and goes to the whole list.

A post is emailed **once ever**. The job sets `newsletter_sent_at` and `newsletter_recipients` (the
confirmed subscribers of its language at that moment) in the same transaction that queues the issue, and never
queues one for a post where it is set: not on a retried job, not after unpublishing and publishing
again, not when two runs race (the post is locked). The send itself is the newsletter's
`subscribers.send-issue` job, whose send log mails each address at most once.

Emailing needs mail subscriptions on and `MPA_DOMAIN` set; otherwise the admin API refuses a list
with `NEWSLETTER_OFF`, and `GET /api/admin/blog/newsletter` says `enabled: false`.

**A post that goes live while the newsletter is off is never emailed** (#414). That happens to a
post scheduled with a list before the newsletter was turned off, or to a list the app no longer
has. The job publishes it and settles it as never emailed: it clears `newsletter_list` and sets
`newsletter_sent_at`, as for a post file that does not ask for the newsletter. Turning the
newsletter on later emails only the posts that go live after that, never one that went live while
it was off. The editor shows no "Emailed" line for such a post.

The publish call's `newsletterList` names the list to email, or `null` for none. Left out, the post
keeps the list it has, so an API client that publishes a scheduled post now without naming the
list still sends its email. While the newsletter is off, the publish dialog sends `null` for a
scheduled post's list and says that the post will not be emailed.

## The Dev.to cross-post

With `DEVTO_API_KEY` set (a Dev.to API key, from Settings → Extensions on Dev.to) and `MPA_DOMAIN`
set, a post that goes live is copied to Dev.to once, as the `blog.crosspost` job. The copy names
the post's own address as its `canonical_url`, so search engines credit the website and not
Dev.to. It carries the intro, the body (an interactive figure becomes a link to the original), the
topic as its tag, the cover, and an "Originally published at" line.

- **Once ever.** The job records `crossposted_at` (and `devto_url`, the article's address) and never
  posts a post where it is set: not on a retry, not after unpublishing and publishing again. Two
  runs at once are kept apart by a lock on the post. Before it posts, a run asks Dev.to for an
  article with the post's canonical address, so a run that posted and then died finds the article
  and records it instead of posting again.
- **A failure is retried.** A Dev.to error fails the run, records nothing, and the job system tries
  again later. The key never appears in a log line, an error or a response.
- **Off without the key.** Each post that goes live is settled as never cross-posted, with one log
  line, so setting the key later copies only the posts that go live after that. The same holds for
  a translation, which is never cross-posted: Dev.to gets the original once.
- **It fills the checklist.** A copy that lands, or an article found, also marks the post posted
  on the active Dev.to channel with the article's address, and a missing key or a refusal is kept
  on that row, so the sharing page says why nothing was posted.
- **Seed's own posts** are cross-posted only when their file says `devto: true`. Posts that were
  live before the cross-post existed are settled by its migration and never copied.

## Sharing channels

The channels page (`/blog/channels`) lists the places posts go: Dev.to, Telegram, Mastodon,
Bluesky, Hashnode, LinkedIn, X, Reddit, Hacker News, a newsletter or anything else. Each channel
takes one or more languages and either every live post or only those from the day it was added.
A channel with shares is archived, never deleted; one without can be deleted after a confirmation.

Each live post has a checklist (`/blog/:id/sharing`), reached from the blog list's Sharing column,
its "Needs sharing" chip (`?sharing=todo`) and the editor's summary. A channel is **to do** for a
post when the post is live, the channel is active and takes the post's language, the post went
live on or after the channel's start, and the channel has no row for it or its row is to do. A
row can also be suggested, posted (with its link) or skipped (with an optional reason); every
change takes effect at once and offers Undo. A translation shows a channel the original was
already shared on as covered. Keys `j` and `k` move between rows, `t` copies its text, `o` opens
the channel's own page, `p` moves to the link field (Enter there marks the row posted), `s` skips it
and `e` enters its numbers.

- **`utm_source` on links.** Every link the page hands out (the copied text, the submit form, the
  shown address) carries the channel's source tag unless its "Add utm_source to links" is off.
  The post's canonical address and the Dev.to `canonical_url` stay clean.
- **Results are counts only:** views, reactions, comments and score, typed in by hand for now.
  Each reading is a new row and the latest one shows; an unknown number shows as "–".
- **Visits** come from Umami, by the link's `utm_source`, through Stats' five-minute copy, so they
  show only when `UMAMI_API_URL`, `UMAMI_API_TOKEN` and `UMAMI_WEBSITE_ID` are set. The token
  stays on the server.

## Channel texts

`deno task blog:social <slug>` prints the texts the owner pastes into LinkedIn, Telegram and X
for one of Seed's own posts once it is live: the title, the intro, the key points and the address,
in the post's language, with a clean address; the sharing page's copies of the same texts carry
each channel's `utm_source`. The X text keeps to 280 characters: it drops the intro first, then cuts
the title. Nothing is posted for you.

## Covers and link previews

A post's cover shows at the top of the post, at its real size, and beside it in the blog's list
and in "Read next": the first row of `/blog` loads at once, the others lazily.

- **Seed's own posts** keep their covers as WebP files in `libs/server/blog/seed-posts/covers/`
  (`<slug>.webp` at 1600 px and `<slug>-640.webp`), served at `/blog/covers/<file>`; a translation
  shares its original's. How to make one: that folder's `README.md`.
- **A post written in the admin** names an `https://` picture as its cover.
- **The link preview.** Each of Seed's own posts has a card, 1200×630: "Seed blog", the title and
  the reading time on the left, the cover on the right, one per language. `deno task og:blog` in
  `apps/mpa` draws them into `libs/server/blog/seed-posts/og/`, and the website serves them at
  `/blog/og/<slug>.jpg` as the post's `og:image`. They are files made beforehand, so no address of
  the website draws text it was sent. Run it again after a post's title, cover or length changes;
  `apps/mpa/og-cards.test.ts` fails while a post has no card. A post written in the admin shares its
  cover, or the site's own image without one.

Both kinds of file are cached for a month and then checked against their ETag.

## On the public website

The website (`apps/mpa`) renders every blog page on its server, with no JavaScript needed:

| Address        | What                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `/blog`        | Every live post in the page's language, newest first; topics as `?topic=` links, whose canonical address stays `/blog`. `/<language>/blog` is the same for that language. |
| `/blog/<slug>` | One post: trail, dates, reading time, the related feature's link, cover, "In short", the body, one call to action and "Read next". |
| `/rss.xml`     | RSS 2.0 of the newest posts with their full HTML.                                                      |

`apps/mpa/blog.ts` reads the public API and checks each answer's shape. A post that is not live
answers 404 "This post is not here". With no live post, `/blog` says so and keeps out of search
results, and the Blog link, the RSS link, the sitemap entries and the `llms.txt` section stay
hidden; the website asks the API at most once a minute whether a post is live
(`blogLinkMiddleware`). Each post page carries `BlogPosting` and `BreadcrumbList` JSON-LD and
`og:type` `article`. A post with an author link (`author_url`, the editor's "Author link") shows
the author's name as a link to it with `rel="author"`, and its `BlogPosting` author carries the
link as `url`; a link on the site author's own domain (`AUTHOR_URL`) adds the `@id` of
`PERSON_JSON_LD`, so the post and the author's own site name one person. Its `inLanguage` is the
post's language, and the page names its live translations as `hreflang` alternates and links them
by name under the byline ("Also in"); a post with none names neither. The blog index of a language
names the indexes of the other languages that have a live post, and the language links send a
language without one to its home page, never to its empty blog (#530). A post in a language the
apps no longer ship is left out of every public read, so dropping a language from `LANGUAGES` hides
its posts instead of failing the blog. The Blog link shows on a language's pages only while that
language has one, and the sitemap lists each language's index and each post once, at its own
address.

The Lighthouse run (`deno task lighthouse`) measures `/blog` and a post page with a fixture post of
its own, `apps/mpa/lighthouse/posts/`, as long as a typical post and in the same format. It needs no
database: `apps/mpa/lighthouse/blog-api.ts` answers the public routes with that folder's posts only,
so deleting Seed's posts changes nothing there. The fixture never appears on the website.

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
published now or moved to another time, unless the operator unticks it or the newsletter is off.

Beside the description and the "In short" points, a post has an **Intro**, two or three sentences
that open its newsletter issue and its Dev.to copy but do not show on its page, and a **Related
feature**, the slug of one of the website's feature pages (`realtime` for `/features/realtime`),
which the post links under its byline. The website shows no link for a slug it has no page for.
Both are kept in the post's earlier versions.

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
  server compiles it, and a tag's props reach the island only after it accepted them. The
  browser loads an island's whole file, every export, so importing arktype there would add about
  190 KB and break the website's Content Security Policy.
- `fallback` (optional): `(props, t) => string`, the sentence the RSS feed shows instead.

Its words go in `i18n/site/` under `PostFigure.<Tag>.*`, in every language. `CostCalculator.tsx`
is the example to copy, and `apps/mpa/post-figures.test.tsx` checks every file in the folder.

## Demo and development

The public demo's nightly wipe keeps `blog_posts`, `blog_slug_redirects` and the sharing tables
([demo.md](demo.md)); the demo seeds no posts and no channels.
In development, `deno task db:seed` adds a published, a scheduled and a draft post by
`admin@example.com`, and four sample channels (`libs/server/blog/sample-sharing.ts`).
