---
slug: free-saas-boilerplate
language: en
title: Is there a free, open-source SaaS boilerplate? Seven, compared honestly
seoTitle: "Free SaaS boilerplate: 7 open-source starters compared"
description: Yes. Seed, Open SaaS, Vercel's Next.js SaaS Starter, ixartz, Apptension, BoxyHQ and Makerkit Lite are free and open source. What each includes, and when each is the better pick.
tldr:
  - Yes, there are several. Seed, Open SaaS, the Next.js SaaS Starter, ixartz SaaS Boilerplate, Apptension SaaS Boilerplate, BoxyHQ and Makerkit Lite all cost nothing.
  - They differ in what "free" leaves out. Some free tiers skip billing or teams, which the paid version sells.
  - Pick by your stack and by who pays you, a single user or a team.
  - Seed combines teams, per-member Stripe billing, an admin panel and nine languages, on a server you run.
topic: Questions
author: Anton Shubin
publishAt: 2026-11-03T09:00:00Z
newsletter: false
---

Yes: there are several free, open-source SaaS boilerplates, and the good ones cover sign-in,
payments and a dashboard. As of 3 November 2026, Seed, Open SaaS, Vercel's Next.js SaaS Starter,
ixartz SaaS Boilerplate, Apptension SaaS Boilerplate, BoxyHQ SaaS Starter Kit and Makerkit Lite are
all under MIT or Apache-2.0. The catch is what each free edition leaves out.

I build Seed, so I am biased, and you should read the table with that in mind. Every line about
another project links to the page I read it on, on 3 November 2026. Where another starter suits you
better, I say so.

## Which free SaaS boilerplates are there?

| Starter                            | Licence    | Stack                        | Teams and roles                      | Payments                       | Where it runs                                 |
| ---------------------------------- | ---------- | ---------------------------- | ------------------------------------ | ------------------------------ | --------------------------------------------- |
| [Seed][seed]                       | MIT        | Deno, Hono, Preact, Postgres | Groups: viewer, editor, admin, owner | Stripe, billed per member      | Docker Compose on any Linux server you run    |
| [Open SaaS][opensaas]              | MIT        | Wasp: React, Node.js, Prisma | Not listed                           | Stripe, Polar or Lemon Squeezy | Fly.io or Railway in one command, or any host |
| [Next.js SaaS Starter][next]       | MIT        | Next.js, Postgres, Drizzle   | Owner and Member                     | Stripe                         | Vercel, in its guide                          |
| [ixartz SaaS Boilerplate][ix]      | MIT        | Next.js, Drizzle, Clerk      | Organisations with roles, via Clerk  | Not in the free edition        | Not stated                                    |
| [Apptension SaaS Boilerplate][app] | MIT        | React, Django, Postgres      | Tenants: Owner, Admin, Member        | Stripe                         | AWS, set up with AWS CDK                      |
| [BoxyHQ SaaS Starter Kit][boxy]    | Apache-2.0 | Next.js, Prisma, Postgres    | Teams with roles                     | Stripe subscriptions per team  | Vercel, Heroku or DigitalOcean buttons        |
| [Makerkit Lite][mk]                | MIT        | Next.js, Supabase            | Not in Lite                          | Not in Lite                    | Any host that runs Next.js                    |

"Not listed" means the project's own page does not mention it. That is not proof it is missing,
only that you will not find it advertised.

## What does "free" leave out?

The word hides three different deals.

- **Free, all of it.** Seed, Open SaaS, the Next.js SaaS Starter, Apptension and BoxyHQ put their
  whole kit under an open licence. Nothing waits behind a paywall.
- **Free edition of a paid kit.** ixartz's free edition has teams, roles and translations but no
  Stripe; billing comes in its paid Plus, Pro and Max editions. Makerkit Lite has sign-in, a profile
  and translations, and its README lists teams, billing and the admin panel as what the paid kit
  adds. Lite also says plainly that no support is given.
- **Free code, paid services.** ixartz signs people in through Clerk, a hosted service, so your
  users' accounts live with a third party. Apptension's infrastructure is written for AWS, and it
  wires in Contentful and Sentry.

None of this is a trick. It is the business model, and a free edition is a fair way to try a paid
kit. Just know which deal you are taking before you build a month on it.

## When is another starter the better pick?

- **Open SaaS**, when you sell to single users and want a choice of payment providers. It is the
  only free kit here with Polar and Lemon Squeezy besides Stripe, and it deploys to Fly.io or
  Railway in one command. You also adopt the Wasp framework, so like it first.
- **Next.js SaaS Starter**, when you want something small enough to read in an afternoon. It is
  Next.js, Postgres, Stripe and two roles, and the rest is yours to build.
- **ixartz**, when you are happy with Clerk and want teams and translations for free, and plan to
  add billing yourself or buy the paid edition.
- **Apptension**, when your team writes Python. It is the strongest free kit here for Django: two
  factor sign-in, passkeys, single sign-on, tenants with three roles, Stripe, and an admin.
- **BoxyHQ**, when you sell to companies that ask for SAML single sign-on and directory sync
  (SCIM) on day one. It also has webhooks, audit logs and Stripe subscriptions per team. Its
  README still lists billing as "coming soon", but its code has checkout, a customer portal and a
  billing page.
- **None of them**, when your sign-in, tenancy or billing model is unusual enough that you would
  fight any starter. Building it yourself is fine; it just costs weeks.

## Where does Seed fit?

Seed is for a product that teams pay for, hosted on a server you control. On `main` today:
sign-in by password, passkeys, Google, GitHub and e-mail links, with an authenticator-app second
factor; groups with four roles and invitations; Stripe billing per member with a free plan and a
14-day trial; an admin panel on its own host; a file store; notifications in the app, by web push
and in Telegram; an offline-first app; and every screen in nine languages, Arabic right to left.
The [live demo](https://app.seedsaas.com) runs it with made-up people.

What it does not do, honestly:

- **Stripe only.** No Paddle, Lemon Squeezy or Polar yet.
- **Deno, not Node.** The servers run on Deno 2. Running on Node and Bun too is
  [planned](https://github.com/spy4x/seed/issues/623), with no date.
- **A server, not serverless.** If you want Vercel and functions, pick a Next.js kit above.
- **One maintainer, built in public.** That's me. Smaller community than a 16,000-star repo.

The [comparison page](/compare) puts Seed next to paid kits like ShipFast and Supastarter too,
feature by feature.

## So, which one?

Write down who pays you (one person or a team) and which stack you already know. That alone picks
from the table above in a minute. If the answer is "teams, and my own server", try the
[demo](https://app.seedsaas.com), then start from the [repository][seed]: one `deno task init`, one
`deno task dev`, and the groundwork is running.

[seed]: https://github.com/spy4x/seed
[opensaas]: https://github.com/wasp-lang/open-saas
[next]: https://github.com/nextjs/saas-starter
[ix]: https://github.com/ixartz/SaaS-Boilerplate
[app]: https://github.com/apptension/saas-boilerplate
[boxy]: https://github.com/boxyhq/saas-starter-kit
[mk]: https://github.com/makerkit/nextjs-saas-starter-kit-lite
