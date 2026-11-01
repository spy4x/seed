# Seed's own blog posts

<!-- Seed's own site: see docs/start-a-product.md -->

The posts of seedsaas.com's blog. The worker loads them into the blog's database only when
`DEMO_MODE=true`, at every start (`libs/server/blog/seed-posts.ts`), and `deno task db:seed` loads
them in development. A product built on Seed deletes the posts here, but keeps this file
([docs/start-a-product.md](../../../../docs/start-a-product.md)), and writes its posts in the
admin app.

One Markdown file per post and language, named `<slug>.md`. The file is the source: a load
updates the post to match its file, and an edit made in the admin app to one of these posts is
overwritten at the next start. A post whose file is deleted stays in the database.

```markdown
---
slug: welcome-to-the-seed-blog # the address, /blog/<slug>; the file is named <slug>.md
language: en # en, ru, es, de, pt-BR or ar
translationOf: null # optional: the slug of the post this one translates, in another language
title: Welcome to the Seed blog # up to 200 characters
seoTitle: null # optional: the title search results show, up to 70 characters
description: What this blog is for. # up to 300 characters; search results show about 155
tldr: # optional: the "In short" points, up to 5 of up to 200 characters each
  - Seed is a free, MIT-licensed starter for a SaaS.
topic: Seed # optional, up to 50 characters
coverUrl: null # optional: an https:// image address
coverAlt: null # what the cover shows; required with coverUrl
author: Anton Shubin # the name shown on the post
publishAt: 2026-11-01T09:00:00Z # in the past: published with this date; in the future: scheduled
newsletter: false # optional, default false: true emails the post to subscribers, once
---

The body, in Markdown.
```

`newsletter: true` emails the post when it goes live, once ever, through the `blog.publish` job. A
post with `newsletter: false` is marked as already mailed, so turning it on later sends nothing.

A body can hold an interactive figure, a tag such as `<CostCalculator members={4} />` on a line
of its own ([docs/blog.md](../../../../docs/blog.md#interactive-figures)).

`deno task test` checks every file here (`seed-posts.test.ts`): a broken file fails the check.
