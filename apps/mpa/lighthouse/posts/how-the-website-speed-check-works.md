---
slug: how-the-website-speed-check-works
language: en
title: How the website's speed check works
description: What the Lighthouse check measures on every pull request, the scores a page must reach, how it runs without a database, and what to do when a page falls below the budget.
tldr:
  - Every pull request measures the public website in Lighthouse mobile, three runs per page.
  - A page needs 95 for performance and 100 for accessibility, best practices and SEO.
  - The blog is measured with this post, served by a small stand-in API, so no database is needed.
topic: Guides
intro: "Every pull request measures the public website on a slow phone. Here is what the check scores, how it runs without a database, and what to do when a page falls short."
cover: covers/admin-panel-for-every-feature.webp
coverAlt: "A row of potted violet plants on a shelf, each with its own round gauge on the control desk in front of it."
author: Seed
publishAt: 2026-01-01T09:00:00Z
newsletter: false
---

This post is the page the Lighthouse check measures for a blog post. It lives next to the check,
in `apps/mpa/lighthouse/posts/`, and never appears on the website: only the check's stand-in API
serves it. It is as long as a typical post and uses what posts use, so the page measured is a real
one. What it says is true of the check itself.

## What is measured

The check opens every address in `lighthouserc.json` in Lighthouse's mobile mode: a slow phone on
a throttled network. Each page runs three times and the median counts, so one slow run on a busy
machine does not fail a pull request.

| Category       | Minimum score | What it looks at                                      |
| -------------- | ------------- | ----------------------------------------------------- |
| Performance    | 95            | How soon the page paints, settles and answers a tap   |
| Accessibility  | 100           | Names, contrast, headings, landmarks and focus order  |
| Best practices | 100           | HTTPS, console errors, image sizes and safe libraries |
| SEO            | 100           | Title, description, a valid `lang`, crawlable links   |

A page below any of these fails the check, and the pull request waits until it is fixed. The
budget is strict on purpose: a public page is what a visitor judges the product by, and what a
search engine ranks.

## How it runs

The check starts three servers on the machine and points Lighthouse at the last one:

1. the blog's stand-in API, which answers the public blog routes from post files like this one;
2. the built website, in production mode, with example hosts;
3. nginx with gzip in front of the website, as a CDN serves it.

Every other API address answers 404, which the website reads as "no answer", so pages that would
show live data render their empty state instead. No database, no worker and no sign-in are
involved, which keeps the run the same on a laptop and in CI.

To run it yourself, build the website first, from the repository root:

```sh
deno task mpa:build
deno task lighthouse
```

You need nginx and a Chromium. The script takes `CHROME_PATH`, or the newest Chromium that
Playwright installed. The reports land in `.lighthouseci/`, one HTML file per run, and each one
names the audits that cost points.

## Why the blog has a post of its own here

A product built on Seed writes its posts in the admin app, so its repository holds none. If the
check measured one of Seed's own posts, a product that deleted them would find the check broken,
or would have to edit the runner and keep that edit through every update from Seed. With a post
of its own, the check measures the same kind of page in every product, and deleting Seed's posts
changes nothing here.

The post page is also the heaviest page on the website: a long body, headings with anchors, a
table that scrolls on a narrow screen, code that must not overflow, and the "read next" list.
Measuring it with real-looking content catches what a short placeholder would hide, such as a wide
table that pushes the layout sideways or a code block that shifts while its font loads.

## When a page falls below the budget

Open the report of the failing page and read the audits under the category that dropped. The usual
causes are few:

- **Performance.** A large image without `width` and `height`, a font loaded without
  `font-display`, or a script the page does not need on first paint. Most pages of the website
  ship no JavaScript at all; keep it that way.
- **Accessibility.** A button or link without a name, text that does not contrast enough with its
  background, or a heading level skipped.
- **Best practices.** An error in the console, often a failed request the page makes on its own.
- **SEO.** A missing description, a link without text, or a page left out of the sitemap.

Fix the cause, not the score: a page that passes because an audit was switched off still fails
the visitor. If a page truly cannot reach the budget, say why in the pull request and ask before
changing it.

## Read more

Google's [Lighthouse overview](https://developer.chrome.com/docs/lighthouse/overview) explains
every audit and how scores are weighted. The [documentation](/docs) of this website covers how its
pages are built, and why each one works without JavaScript.
