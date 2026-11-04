# Seed's own blog posts

<!-- Seed's own site: see docs/start-a-product.md -->

The posts of seedsaas.com's blog. The worker loads them into the blog's database only when
`DEMO_MODE=true`, at every start (`libs/server/blog/seed-posts.ts`), and `deno task db:seed` loads
them in development. A product built on Seed deletes the posts here, but keeps this file
([docs/start-a-product.md](../../../../docs/start-a-product.md)), and writes its posts in the
admin app. The Lighthouse run reads none of them: it measures a fixture post in the same format
(`apps/mpa/lighthouse/posts/`).

One Markdown file per post and language, named `<slug>.md`. The file is the source: a load
updates the post to match its file, and an edit made in the admin app to one of these posts is
overwritten at the next start. A post whose file is deleted stays in the database.

```markdown
---
slug: welcome-to-the-seed-blog # the address, /blog/<slug>; the file is named <slug>.md
language: en # en, ru, es, de, pt-BR, ar, fr, ja or zh-CN
translationOf: null # optional: the slug of the post this one translates, in another language
title: Welcome to the Seed blog # up to 200 characters
seoTitle: null # optional: the title search results show, up to 70 characters
description: What this blog is for. # up to 300 characters; search results show about 155
tldr: # the "In short" points: 2 to 4, of up to 200 characters each
  - Seed is a free, MIT-licensed starter for a SaaS.
  - Subscribe to get each new post by email.
topic: Seed # optional, up to 50 characters
intro: "I'm starting a blog for Seed." # 2 or 3 sentences that open the email and the Dev.to copy
relatedFeature: null # optional: a feature page's slug, such as realtime for /features/realtime
cover: covers/welcome-to-the-seed-blog.webp # the original's cover; a translation leaves it out
coverAlt: "A violet seedling in a pot." # what the cover shows, in the post's own language
author: Anton Shubin # the name shown on the post
authorUrl: https://antonshubin.com/about # optional: the https:// page the author's name links to
publishAt: 2026-11-01T09:00:00Z # in the past: published with this date; in the future: scheduled
newsletter: false # optional, default false: true emails the post to subscribers, once
devto: false # optional, default false: true copies an original to Dev.to, once
---

The body, in Markdown.
```

`newsletter: true` emails the post when it goes live, once ever, through the `blog.publish` job. A
post with `newsletter: false` is marked as already mailed, so turning it on later sends nothing.

`devto: true` copies the post to Dev.to once it is live, when the server has `DEVTO_API_KEY`
([docs/blog.md](../../../../docs/blog.md#the-devto-cross-post)); a translation is never copied.

Every original has a cover in `covers/` (how to make one: [covers/README.md](covers/README.md)),
and every post a link-preview card in `og/`, drawn by `deno task og:blog` in `apps/mpa`. Run it
again after a title, a cover or the length of a post changes. Once a post is live,
`deno task blog:social <slug>` prints its LinkedIn, Telegram and X texts.

A body can hold an interactive figure, a tag such as `<CostCalculator members={4} />` on a line
of its own ([docs/blog.md](../../../../docs/blog.md#interactive-figures)).

`deno task test` checks every file here (`seed-posts.test.ts`): a broken file fails the check.
