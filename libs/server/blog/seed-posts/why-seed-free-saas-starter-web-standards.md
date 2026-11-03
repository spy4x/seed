---
slug: why-seed-free-saas-starter-web-standards
language: en
title: "Why Seed: a free SaaS starter built on web standards"
description: Seed is a free, MIT-licensed SaaS starter built on web standards. What you get on day one, who it is for, when to skip it, and what "web standards" means in its code.
tldr:
  - Seed is a free, MIT-licensed SaaS starter. You copy it and own every line.
  - Sign-in, groups with roles, Stripe billing, realtime, offline and an admin panel are built.
  - Its servers speak Fetch, Web Crypto and WebSocket, so the code is not tied to one runtime.
  - Skip it if you want serverless functions or a hosted backend.
topic: Seed
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T06:00:00Z
newsletter: false
---

Seed is a free SaaS starter built on web standards: you copy one repository and start with
sign-in, groups with roles, per-member Stripe billing, realtime updates, an offline app, an admin
panel and a public website already working. It is MIT-licensed, it runs on one server you control,
and its servers are written against the Fetch `Request` and `Response`, Web Crypto and WebSocket
instead of one runtime's private API.

I'm Anton, and I build client SaaS MVPs for a living. Seed is the starting point I build them on.
The long story (80-odd projects, one failed first version and the 52 commits I spent on setup
before any feature) is on my own blog:
[Seed: the SaaS starter I distilled from 80+ projects](https://antonshubin.com/blog/seed-saas-starter).
This post is the short version for a developer deciding whether to try it.

## What do you get on day one?

The groundwork every multi-user product needs before its first real feature:

- **Sign-in that is finished.** E-mail and password with a confirmation code, passkeys, Google and
  GitHub, sign-in links by e-mail, and a guest account a visitor opens with one click and keeps
  later. A second factor with an authenticator app, a list of sessions to sign out of, and personal
  API tokens stored only as hashes.
- **Groups as the tenancy boundary.** Sign-up creates an account, a session and a first group in one
  database transaction. A personal space and a team are the same thing, with the same four roles
  from viewer to owner.
- **Billing per member, through Stripe.** A free plan with limits, a 14-day trial, a quantity that
  follows the member count, and a grace period after a failed payment ([billing](/docs/billing)).
- **Realtime and offline.** Pages follow each other's changes over a WebSocket. The app opens with
  no network, reads from IndexedDB and queues note writes until it is back
  ([offline](/docs/offline)).
- **An admin panel on its own host**, where an operator finds a person, sees their sessions and
  groups, refunds a payment, writes the blog and reruns a failed job, all into an audit log.
- **A public website** rendered on the server, with pricing, legal pages, a blog with RSS and a
  newsletter with double opt-in.
- **Nine languages**, Arabic right to left included, in the app, the admin panel, the website and
  the e-mails.

It is all real code you can open, and most of it runs in the [live demo](https://app.seedsaas.com)
with made-up people. The full list is on [the features page](/features).

## What does "built on web standards" mean in practice?

It means the parts that would be hardest to move are written against standards every modern
runtime and browser implements:

- The API is Hono, whose handlers take a Fetch `Request` and return a `Response`.
- Password hashes and the signatures of paging cursors use Web Crypto.
- Live updates travel over a standard WebSocket.
- Everything is an ES module.

Today the servers run on Deno 2 in Docker. On 9 October 2026 the Deno team
[announced](https://deno.com/blog/cloudflare) one more year of monthly bug-fix and security
releases before it ends its own development. Because most of Seed already speaks the standards,
moving it to run unchanged on Deno, Node and Bun is work on the edges, not a rewrite. It is
[issue #623](https://github.com/spy4x/seed/issues/623), with no date yet. Seed never used Deno
Deploy, so that service closing changes nothing for a Seed product.

## Is it a framework?

No, and that is on purpose. Seed is a template: you create your repository from it and change
anything. There is no plugin API to learn and no upgrade that breaks your code behind your back.
The parts any project could reuse ship as small [`@spy4x/*` packages on JSR](https://jsr.io/@spy4x),
and Seed's own later fixes reach your product as a patch you review
([how that works](/docs/products)).

## Who is Seed for?

**Use it if** you are starting a multi-user web product (a team tool, a client portal, a small
B2B app) and want sign-in, tenancy, billing and operations settled before you write the feature
that makes it yours. It suits a solo developer or a small team who would rather own a server
than a stack of monthly subscriptions.

**Skip it if** you deploy to serverless functions, want a hosted backend to do the operations
for you, or are building a single-user script. Seed runs Postgres, Valkey and its own workers on a
server you look after. That is the trade: more control and a flat bill, and the updates are yours
to install.

If you are weighing it against other starters, [the comparison page](/compare) lists two of them
with their prices and the day I checked them.

## What does it cost?

Nothing. Seed is MIT-licensed, with no paid edition and no licence key. Your bill is the server it
runs on, which I priced out to the cent in
[From git clone to production on one Hetzner server](/blog/deploy-saas-to-one-hetzner-server).

## Try it

The fastest look is the [live demo](https://app.seedsaas.com): press "Try it without an account" and
click around a team's notes. When you want it on your own machine, it is two commands after the
clone, and [How to install Seed and run it locally](/blog/install-seed-and-run-it-locally) walks
through them. The code is at
[github.com/spy4x/seed](https://github.com/spy4x/seed); a star there tells me to keep going.
