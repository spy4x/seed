---
slug: nextjs-saas-starter-alternatives
language: en
title: "Next.js SaaS Starter alternatives: what to use when you outgrow it"
seoTitle: "Next.js SaaS Starter alternatives, free and paid, compared"
description: "The Next.js SaaS Starter is free and deliberately small: no password reset, no invitation e-mails. Alternatives with more built in, free and paid, each fact sourced."
tldr:
  - The Next.js SaaS Starter is free and MIT, with teams of owners and members and Stripe Checkout.
  - It sends no e-mail at all, so invitations, password resets and verification are yours to build.
  - Free with all of that done is Seed; staying on Next.js with more built in is Makerkit or Supastarter.
  - Keep the starter if you want a small codebase to learn from, or to build auth your own way.
topic: Questions
intro: "The Next.js SaaS Starter is a clean, small base, and its own README says it is meant for learning. Here is what it leaves out, and which starter to take when you need those parts built."
relatedFeature: sign-in
cover: covers/nextjs-saas-starter-alternatives.webp
coverAlt: "A small wooden frame around a single seedling, in front of a finished glass greenhouse full of violet plants."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-06T09:00:00Z
newsletter: false
---

The Next.js SaaS Starter is a free, MIT-licensed base with e-mail sign-in, Stripe Checkout and
teams with owner and member roles, and its README calls it intentionally minimal, a learning
resource. The alternatives are for when you want more already built: Seed is free and MIT with
invitations, password resets, passkeys and per-member billing done, and Makerkit and Supastarter
are paid kits that keep you on Next.js.

I build Seed, so read this with that in mind. Every fact about another product links to its
source, and I checked each one on 4 November 2026. A fact is out of date?
[Open an issue](https://github.com/spy4x/seed/issues) and I will fix it.

## What is in the Next.js SaaS Starter?

The [Next.js SaaS Starter](https://github.com/nextjs/saas-starter) lives in the Next.js
organization on GitHub, and most of its commits are by Lee Robinson. It has about 16,250 stars.
Its README lists:

- a landing page, and a pricing page that opens Stripe Checkout;
- e-mail and password sign-in, with JWTs in cookies;
- a dashboard with teams, and owner and member roles;
- subscription management in Stripe's Customer Portal;
- an activity log of user events.

The stack is Next.js, Postgres with Drizzle, and shadcn/ui. You can read the whole thing in an
afternoon, and that is the point.

## What does it leave out?

It sends no e-mail. Its `package.json` has no mail library, and inviting a member stores the
invitation but sends nothing: the code says
[`TODO: Send invitation email`](https://github.com/nextjs/saas-starter/blob/main/app/(login)/actions.ts#L454).
The same goes for a password reset or a verified e-mail address, which the code does not have.

Sign-in is e-mail and password only: no Google or GitHub, no passkeys, no second factor.

Billing is one subscription per team. Checkout starts at a quantity of one with a 14-day trial,
and the quantity changes only when someone edits it in the Customer Portal
([stripe.ts](https://github.com/nextjs/saas-starter/blob/main/lib/payments/stripe.ts)). Adding a
member does not change the bill.

And it moves slowly. Its last two commits, on 8 and 11 December 2025, were both Next.js security
updates; the second moved it to Next.js `15.6.0-canary.59` for the CVE-2025-55182 fix. The one
before them was in June 2025.

None of this is a flaw for what the starter says it is. It just means the parts a paying team
needs first are still yours to write.

## The alternatives side by side

| Feature         | Next.js SaaS Starter | Seed                          | Open SaaS                    | Makerkit                               | Supastarter                          |
| --------------- | -------------------- | ----------------------------- | ---------------------------- | -------------------------------------- | ------------------------------------ |
| Price           | Free                 | Free                          | Free                         | $299 or $599 once                      | $349 to $1,499 once                  |
| Licence         | MIT                  | MIT                           | MIT                          | Paid; the Lite kit is MIT              | Paid                                 |
| Stack           | Next.js, Drizzle     | Hono, Preact; Postgres        | Wasp (React, Node.js)        | Next.js 16 or TanStack Start, and more | Next.js, Nuxt or TanStack Start      |
| Teams and roles | Owner and member     | Viewer to owner               | No                           | Yes, with invitations                  | Yes, with invitations                |
| Invitation mail | Not sent             | Yes                           | No teams                     | Not checked                            | Not checked                          |
| Billing         | Stripe, one per team | Stripe, per member            | Stripe, Polar, Lemon Squeezy | Not checked                            | Stripe, Lemon Squeezy and three more |
| Hosting         | Vercel               | Docker Compose on your server | Fly.io or Railway            | Not checked                            | Vercel, serverless or Docker         |

Sources: [Next.js SaaS Starter](https://github.com/nextjs/saas-starter),
[Open SaaS](https://github.com/wasp-lang/open-saas), [Makerkit pricing](https://makerkit.dev/pricing),
[Supastarter](https://supastarter.dev/) and Seed's own [README](https://github.com/spy4x/seed).
Makerkit's prices are its discounted ones; the list prices are $349 and $649. "Not checked" means I
did not find it on the pages I read, not that the product lacks it.

## Which alternative should I pick?

**You want to stay on Next.js and get more built in.** Pay for Makerkit or Supastarter. Both have
organizations with invitations and roles; Supastarter bills by seat and offers five payment
providers. Makerkit Lite is free and MIT, but has no teams or billing.

**You want it free, with the team parts done.** That is Seed. Groups come with every account and
have roles from viewer to owner; invitations go out by e-mail; Stripe bills per member, and the
quantity follows the member count, with a free plan, a 14-day trial and a grace period after a
failed payment. Sign-in is done too: password with a confirmation code, passkeys, Google, GitHub,
e-mail sign-in codes, guest accounts and an authenticator app as a second factor
([sign-in features](/features/sign-in)). Add an admin app with an audit log, realtime updates, an
offline app and nine languages. The price: it is not Next.js, but Hono and Preact.

**You sell to single people and like a framework doing the wiring.** Look at Open SaaS; I wrote up
[its alternatives](/blog/open-saas-alternatives) too.

## What does hosting cost: Vercel or one server?

The starter's README deploys to Vercel and takes any Postgres URL. Seed runs on one server you
rent. Here are both, with Vercel Pro and Supabase Pro as one common managed pair; pick a server and
move the slider for your team:

<HostingCost server="cx23" developers={1} />

With one developer, Seed on a Hetzner CX23 costs €12.48 a month and the managed pair $45, about
€40.12 at the ECB's rate of 2 November 2026. It is not like for like: the managed pair means no
server to patch and a database someone else backs up. The full working, with every price and its
source, is in [deploying a SaaS to one Hetzner server](/blog/deploy-saas-to-one-hetzner-server).

## When is the Next.js SaaS Starter still the better pick?

- You want to learn the App Router and Server Actions on a codebase small enough to read whole.
- You will build sign-in and billing your own way, and want as little as possible to delete first.
- Your team knows Next.js and React, and you deploy to Vercel.

Seed's risks, so you can weigh them: it is young, with one maintainer. Its API and worker also run
on Node or Bun with one line in the env file
([runtime docs](https://github.com/spy4x/seed/blob/main/docs/apps.md#runtime)), but its website
and tooling still need Deno.

## How do I try Seed before I decide?

Open the [live demo](https://app.seedsaas.com): one click signs you into a guest account with
sample data. Invite a colleague, then open billing, the two things the Next.js starter leaves to
you. If it fits, clone [the repository](https://github.com/spy4x/seed). For a wider view,
[ShipFast alternatives](/blog/shipfast-alternatives) compares seven boilerplates in one table.
