---
slug: makerkit-alternatives
language: en
title: "Makerkit alternatives: free SaaS starters, and when to pay"
seoTitle: "Makerkit alternatives: free and open-source SaaS starters"
description: "Makerkit costs $299 or more; its free Lite kit has no billing or teams. Free alternatives that have both, each fact sourced, and when Makerkit is worth it."
tldr:
  - Makerkit's paid kits cost $299 or $599 once; its free Lite kit has no billing, teams or admin.
  - A paid Makerkit project may not be open-sourced, and a freelancer needs a licence per client.
  - Seed is free and MIT, with teams, per-member Stripe billing and an admin app, on your own server.
  - Pick Makerkit if you want Supabase, Next.js or React Router, and its tooling for coding agents.
topic: Questions
intro: "Makerkit is a polished paid kit with a free Lite edition, and the gap between the two is exactly the part a team product needs. Here are the free alternatives that fill it, with a source for every fact, and the cases where paying Makerkit is the right call."
relatedFeature: deploy
cover: covers/makerkit-alternatives.webp
coverAlt: "A large violet toolbox standing open with trays full of tools, beside a small closed grey toolbox with a padlock."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-05T09:00:00Z
newsletter: false
---

The free Makerkit alternative that keeps what its paid kits add, teams, billing and an admin
panel, is Seed: a free, MIT-licensed starter with groups and roles, per-member Stripe billing and
an admin app on its own host. Makerkit's own free kit, Lite, leaves those three out. For a smaller
free base there is the Next.js SaaS Starter, and among paid kits Supastarter. Makerkit's paid kits
cost $299 or $599, paid once.

I build Seed, so read this with that in mind. Every fact about another product links to its
source, and I read each page on 4 November 2026. Something has changed since?
[Open an issue](https://github.com/spy4x/seed/issues) and I will fix it.

## What does Makerkit give you, and what does Lite leave out?

[Makerkit](https://makerkit.dev/) ships kits on three data layers (Supabase; Drizzle with Better
Auth; Prisma with Better Auth) for Next.js 16, TanStack Start and, with Supabase, React Router 8.
Its home page lists sign-in with password, magic links, opt-in passkeys, OAuth and an
authenticator app; team accounts with roles and invitations; Stripe subscriptions, flat, per seat
or metered; a super admin who can impersonate or ban users; translations; a blog and docs; and
realtime notifications on the Supabase kits. For coding agents it ships rules, skills and an MCP
server.

The [pricing page](https://makerkit.dev/pricing) shows two one-time licences, with lifetime
updates:

- **Pro**, $349, with $299 on the kit cards: one developer, unlimited projects.
- **Teams**, $649, with $599 on the kit cards: up to five people on the repository.

Read the licence terms before you buy, because two of them surprise people. A freelancer needs a
separate licence for each client. And a project built on a paid kit may not be published as open
source: the page sends you to Lite for that. Refunds are generally not offered once you have
access, so the page suggests trying Lite first.

[Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) is free and MIT, about
470 GitHub stars: Next.js, Supabase sign-in, profile pages, i18n and marketing pages. Its README
lists what it leaves out, and that list is the heart of a team product: billing, team accounts,
mailers, the super admin panel, the blog and docs.

## Makerkit and its alternatives side by side

| Starter                                                                   | Price                               | Licence                          | Stack                                   | Teams and billing                 | Hosting                                     |
| ------------------------------------------------------------------------- | ----------------------------------- | -------------------------------- | --------------------------------------- | --------------------------------- | ------------------------------------------- |
| [Makerkit](https://makerkit.dev/pricing)                                  | $299 or $599 once (list $349, $649) | Paid, no open source, per client | Next.js, React Router or TanStack Start | Yes, per seat                     | Vercel recommended; Cloudflare, Docker, VPS |
| [Makerkit Lite](https://github.com/makerkit/nextjs-saas-starter-kit-lite) | Free                                | MIT                              | Next.js, Supabase                       | No                                | Not stated                                  |
| [Seed](https://github.com/spy4x/seed)                                     | Free                                | MIT                              | Hono, Preact; Postgres                  | Yes, per member                   | Your own server, Docker Compose             |
| [Supastarter](https://supastarter.dev/)                                   | $349, $799 or $1,499 once           | Paid, no redistribution          | Next.js, Nuxt or TanStack Start         | Yes, seat-based                   | Vercel, Docker, Coolify and others          |
| [Next.js SaaS Starter](https://github.com/nextjs/saas-starter)            | Free                                | MIT                              | Next.js, Drizzle; Postgres              | Owner and Member; Stripe Checkout | Vercel                                      |

Makerkit's hosting row comes from its
[production checklist](https://makerkit.dev/docs/next-supabase-turbo/going-to-production/checklist),
which marks Vercel as recommended and Docker or a VPS as "more setup required". The
[comparison page](/compare) lines up 19 capabilities of six starters.

## Which free alternative has what Makerkit Lite leaves out?

**Seed** has all three of Lite's missing pieces. Every person gets a group at sign-up, with roles
from viewer through editor and admin to owner. Stripe bills per member, with a free plan, a 14-day
trial and a grace period after a failed payment. An admin app on its own host finds a person,
refunds a payment and writes every action to an audit log. Sign-in has password, passkeys, email
sign-in codes, Google and GitHub, and an authenticator app as a second factor. It also has things no
Makerkit page lists: an app that opens and queues writes offline, and server monitoring
(VictoriaMetrics, Grafana) and backups in the Compose file.

Because Seed is MIT, the two licence surprises above do not exist: open-source your product, or
build ten client projects on it, and nobody needs a second licence. I build my own clients' MVPs
on Seed, so this one is not theory.

**The Next.js SaaS Starter**, about 16,300 GitHub stars, sits between Lite and the paid kits:
teams with Owner and Member, Stripe Checkout and the Customer Portal, on Next.js, Drizzle and
Postgres, no admin panel.

## What does the hosting cost on top?

Makerkit's checklist recommends Vercel, and its main kit runs on Supabase. That pair is billed
every month, per developer seat and per database. Seed runs on one server you rent. Pick a server
and a team size:

<HostingCost server="cx23" developers={1} />

With one developer, Seed on the CX23 costs €12.48 a month against $45 for Vercel Pro and Supabase
Pro. It is not like for like: the managed pair patches, scales and backs up for you. The numbers
and the trade-offs are in
[how I deploy Seed to one Hetzner server](/blog/deploy-saas-to-one-hetzner-server), and Makerkit's
Docker and VPS guides put it on a server of your own too.

## When is Makerkit worth paying for?

- **You want Supabase.** Makerkit's main kit is built around its auth, storage and row-level
  security. Seed runs its own Postgres and its own sign-in.
- **You want Next.js or React Router.** Seed is Preact throughout, the public website included.
- **You want impersonation, metered billing or a second payment provider.** Makerkit lists
  impersonation and metered subscriptions, and its home page names Polar beside Stripe. Seed has
  none of the three; Stripe is its only provider.
- **You work with coding agents.** Makerkit ships an MCP server and agent skills. Seed ships
  [instructions for agents](/docs/ai-agents) but no MCP server ([#211](https://github.com/spy4x/seed/issues/211)).
- **You want a maintainer with a track record.** Makerkit says it has been maintained full-time
  since 2022. Seed is young and has one maintainer, me.

## How do I try Seed before I decide?

Open the [live demo](https://app.seedsaas.com): one click opens a guest account with sample data,
so you can create a team, invite someone and open billing in two minutes. Then clone
[the repository](https://github.com/spy4x/seed). And if Makerkit fits better, try its Lite kit
first, as its own pricing page suggests. For more options, see
[Supastarter alternatives](/blog/supastarter-alternatives).
