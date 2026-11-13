---
slug: seed-runs-on-deno-node-and-bun
language: en
title: "Seed now runs on Deno, Node and Bun"
seoTitle: "A SaaS starter that runs on Node, Bun and Deno: Seed"
description: "Seed, the free SaaS starter, now runs unchanged on Deno, Node and Bun: how to start on your runtime, switch an existing product, and what still needs Deno."
tldr:
  - Seed's API, worker, migration and website now start unchanged on Deno, Node and Bun, and CI starts them on all three for every pull request.
  - One line in the env file, APP_RUNTIME=node or bun, moves a product's servers. No line keeps Deno, so a product that does nothing keeps working.
  - The public website left Fresh for a small layer with the same routes, pages and islands. Every page ships less JavaScript.
  - Deno stays the toolchain for tasks and tests; npm or Bun installs it for you.
topic: Changelog
intro: "Seed no longer depends on one runtime. Its servers start unchanged on Deno, Node and Bun, and one line in the env file picks which. Here is what that means for a new product, and what to do in one you already run."
cover: covers/seed-runs-on-deno-node-and-bun.webp
coverAlt: "A violet seedling in a pot on top of a hill, with three paths leading up to it: stepping stones, wooden planks and gravel."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-14T09:00:00Z
newsletter: true
---

Seed, the free SaaS starter, now runs on Deno, Node and Bun. The API, the worker, the database
migration and the public website start unchanged on each, and CI starts the API, the worker and
the website on all three for every pull request. One line in the env file picks the runtime of a
product's servers, and a product that sets nothing stays on Deno.

This post is for two people: someone choosing a starter who does not want to bet the product on one
runtime, and someone with a product built on Seed who is about to take this change in a sync. Each
section answers one thing you might do. The story of how the move went, mistakes included, is
[on my own blog](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

## How do I start a new product on my runtime?

The quick start in the README now has a section for each runtime:
[Node](https://github.com/spy4x/seed#node), [Bun](https://github.com/spy4x/seed#bun) and
[Deno](https://github.com/spy4x/seed#deno). You need Docker and one of the three. On Node it is:

```sh
npm install -g deno
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
npm run init
npm run dev
```

Yes, the first line installs Deno. Leaving Deno by installing Deno is funnier than I would like, but
Seed's own tasks still run on it (more on that below), and the `deno` package on npm means a machine
with only Node needs nothing else. On Bun the first line is
`bun add -g deno`, and the last two are `bun run init` and `bun run dev`. The `gh` line is optional:
GitHub's "Use this template" button and a clone do the same.

That gives you the whole stack in Docker on Deno. To run the product's own servers on Node or Bun
as well, set one line in `infra/envs/.env` before `dev`:

```sh
APP_RUNTIME=node   # or bun; deno, empty or no line keeps Deno
```

## What runs on Node or Bun, and what changes there?

With `APP_RUNTIME=node` or `bun`, the API, the worker, the migration and the website run on Node 26
or Bun 1.4, built from their own Docker images. Ports, environment variables and the order of the
services stay the same. The SPA and the admin app are static files, so they do not care. The full
list is in [the docs' runtime section](/docs/apps#runtime).

Three things behave differently from Deno, and you should know them before you switch:

- **No watch mode.** The bundles are built into the image, so on Node or Bun a code change shows
  only after a rebuild, in development too. Development with hot reload stays on Deno.
- **No runtime permissions for the worker.** On Deno the worker may read and write only its image
  folder and run only `vips`. Node and Bun have no such limits, so there the worker is confined only
  by its container and its non-root user.
- **Your choice, not a default.** No line, an empty line or `deno` keeps everything on Deno.

## I already run a product on Seed. What do I do?

Take the change the usual way, as [the products guide](/docs/products) says. Fetch Seed, apply the
patch and record the commit:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Then run `deno task check` before you open the pull request. I ran this sync on a copy of Seed from
just before the runtime work, and the patch applied without a conflict. Your product will differ
where you changed Seed's files on purpose: keep your version of those, as the guide says.

The sync adds the Node and Bun Docker images, the Compose files that switch to them and a
`package.json` at the root. It changes nothing about which runtime you run. When you want to move,
set `APP_RUNTIME=node` (or `bun`) in `infra/envs/.env` and rebuild the images:

```sh
deno task compose up -d --build
```

For the server, put the same line in the server's env file and deploy as usual
([updates](/docs/deploy-updates)): every deploy builds the images that line names.

## What changed on the public website?

The website no longer runs on Fresh. It runs on
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server), a small open-source layer that copies
Fresh 2's routes, pages and islands, so the website's code barely changed. I compared every route on
both builds: 419 of 423 responses were identical. The four that differ are one video's modification
date and ETag, and a malformed address that used to get a bare error and now gets the site's 404
page.

The pages also got lighter. Gzipped JavaScript per page, measured with Lighthouse on mobile:

| Page                    | New layer | Fresh   |
| ----------------------- | --------- | ------- |
| Home                    | 24.0 KB   | 32.1 KB |
| A blog post with island | 29.9 KB   | 38.0 KB |
| Docs                    | 8.6 KB    | 19.4 KB |

On the blog post with an interactive slider, the page blocks input for 5 ms, against 48 ms on Fresh.
My first version of the layer was slower than Fresh there, and CI did not notice; how I found it is
in [the full story](https://antonshubin.com/blog/migrate-from-deno-to-node-and-bun).

If your product changed its website, the sync may leave a file of yours that still imports Fresh.
Find them from the repository root:

```sh
grep -rlE 'from "fresh' apps/mpa
```

Point each import at `@spy4x/preact-server` instead (`fresh/runtime` too), and rename
`FreshContext` to `Context`. The build folder is `dist` now, not `_fresh`, and pages have no
inline script any more, so the security headers need no per-request nonce. The layer is a first
version: what it offers and what it leaves out are in
[its doc](https://github.com/spy4x/seed/blob/main/docs/website-server.md).

## What still needs Deno?

The toolchain: formatting, linting, type checks, tests and the scripts behind `deno task`. The
`package.json` at the root hands the common tasks to Deno, so `npm run test` and `bun run dev` work
too. Tests stay on Deno's test runner. A review due on 10 January 2027 decides whether that changes
([the runtime policy](https://github.com/spy4x/seed/blob/main/docs/runtime-policy.md)). None of it
ties the runtime your users hit to Deno.

## Why did Seed stop depending on Deno?

On 9 October 2026 the Deno team [announced](https://deno.com/blog/cloudflare) one more year of
bug-fix and security releases, after which it ends its own development. Deno stays open source, and
I still like it. But a starter you build a business on should not bet your product on one runtime's
roadmap, mine included. Seed was already built on web standards (Fetch, Web Crypto, WebSocket, ES
modules), so the hard parts were serving files, Deno's types in public signatures and the website
layer, not a rewrite.

Try the [quick start](https://github.com/spy4x/seed#quick-start) on the runtime you already use. If a
step fails, [open an issue](https://github.com/spy4x/seed/issues) with what you ran, and I will
fix it.
