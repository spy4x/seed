---
slug: welcome-to-the-seed-blog
language: en
title: "Seed is out: a tour of the free SaaS starter, screen by screen"
seoTitle: "Seed is out: a screen-by-screen tour of the free SaaS starter"
description: Seed, a free MIT-licensed SaaS starter, is usable today. A screen-by-screen tour of what works on day one, what is not built yet, and how to try it.
tldr:
  - Seed is a free, MIT-licensed SaaS starter, usable today. You copy one repository and own every line.
  - "Built already: passkeys and 2FA, groups with roles, per-member Stripe billing, realtime, offline, an admin panel and nine languages."
  - "Not built yet: the Android and desktop apps."
  - Try the live demo with one click, or run it locally in four commands.
topic: Seed
intro: "Seed, the free SaaS starter I build in public, is usable today. Here is a tour of what you get on day one, screen by screen, what is still missing, and how to try it in a minute."
cover: covers/welcome-to-the-seed-blog.webp
coverAlt: "A violet seedling in a pot beside an open envelope from which leaves drift out like letters."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-01T09:00:00Z
newsletter: false
---

Seed is out. It is a free, MIT-licensed SaaS starter that you can use today: you copy one
repository and start with sign-in, groups with roles, per-member Stripe billing, realtime updates,
an offline app, an admin panel and nine languages already working. It runs on Postgres and Docker
Compose on one server you control, and you can click through the app in the
[live demo](https://app.seedsaas.com) before you install anything.

I'm Anton. I build SaaS MVPs for clients, and every one of them used to start with the same month
of plumbing: sign-in, teams, billing, an admin page I swore I would make nicer later. Seed is that
month, done once and kept up to date. This post is the tour. The reasons behind the choices are in
[Why Seed](/blog/why-seed-free-saas-starter-web-standards).

## How do people sign in?

Every way people expect: e-mail and password with a confirmation code, passkeys, Google and GitHub,
and sign-in codes by e-mail. A second factor with an authenticator app is one switch on the
security page, and the same page lists every signed-in device, so a person can end a session they
do not recognise. A visitor can also start as a guest with one click and add a sign-in method
later, keeping everything.

![The security page of a profile: the password, an Add a passkey button, two-factor sign-in turned on, and the top of the list of signed-in devices.](/shots/profile-security-dark-800.webp)

Nobody ever signed up for a product because its password reset worked. Plenty have left because
it didn't. How it is built, without paying an auth service:
[Passkeys, 2FA and sessions without an auth SaaS](/blog/passkeys-2fa-sessions-without-auth-saas).

## How do teams work?

Through groups. Sign-up creates an account, a session and a first group in one database
transaction, so a personal space and a team are the same thing with the same rules. People are
invited by e-mail and get one of four roles: viewer, editor, admin or owner. The owner can hand
the group over, and a deleted group can be restored for 30 days.

![The members of a group, each with their role, a button to invite people, and one member's menu open: Make Viewer, Make Admin, Remove from group.](/shots/group-members-dark-800.webp)

## What does billing look like?

Stripe subscriptions per group, billed per member. The demo's catalog has a free plan (up to 3
members and 10 notes) and a Pro plan at €9 a member a month, the owner included, with a 14-day
trial. The quantity follows the member count, the owner confirms the new price before each
invite, and a failed card gets a grace period instead of an instant lock-out. The prices are
examples: your plans are a list in one file ([billing plans](/docs/billing-plans)).

![A sample group's plan in the demo app, at the demo's example prices: Pro plan with its renewal date, €36.00 a month, for 4 members at €9.00 each, the owner included.](/shots/billing-plan-dark-780.webp)

A team of four pays €36 a month on Pro. Move the slider to see what your team would pay.

<CostCalculator members={4} />

## What happens when two people edit at once, or the Wi-Fi drops?

Changes reach every open tab over a WebSocket, and calls fall back to plain HTTP when the socket is
down. The app installs, opens with no network, reads the last notes and groups from IndexedDB and
queues note writes until it is back online. If someone changed the same note in the meantime, you
see a conflict to settle, never a silent overwrite of a colleague's work.

![The Notes page of a team called Acme Studio: six notes with their authors, coloured tags and update times, a search field, filters by tag and author, and a New note button.](/shots/notes-dark-800.webp)

Notes is the reference feature: your first feature copies it file by file
([your first feature](/blog/your-first-feature-copy-the-notes-aggregate)). The two deep dives:
[realtime over WebSocket with an HTTP fallback](/blog/realtime-websocket-with-http-fallback) and
[how the local database syncs](/blog/offline-first-preact-signals-local-database-sync).

## What does the operator see?

An admin panel on its own host. An operator finds a person, sees their sign-in methods, sessions
and groups, refunds a payment, writes this blog, looks after the newsletter's subscribers and
reruns a failed job. Risky actions ask first, and every action lands in an audit log.

![The admin panel's Users page: a search by name or address, filters by status, account and role, and a table of made-up people with their role, status and when they were last seen.](/video/admin-panel-poster-1280.webp)

Every feature of the app gets its admin screen in the same change, so the two never drift apart:
[how the admin panel stays in sync](/blog/admin-panel-for-every-feature).

## Which languages does it speak?

Nine: English, German, Spanish, French, Brazilian Portuguese, Russian, Japanese, Simplified Chinese
and Arabic, which reads right to left. The app, the admin panel, this website and the e-mails all
switch, so you can test your layout in Arabic before your first Arabic customer finds the bug for
you ([nine languages and right to left](/blog/nine-languages-and-right-to-left-from-day-one)).

## What is not built yet?

The Android app ([#202](https://github.com/spy4x/seed/issues/202)) and the desktop app
([#203](https://github.com/spy4x/seed/issues/203)). The rest of the plan is in the
[open issues](https://github.com/spy4x/seed/issues). Google and GitHub sign-in and Stripe billing
need your own keys, so they are off in the demo, which shows made-up payments instead. The admin
panel is not part of the demo either: [a video shows it](/admin).

Seed is also not for every project. If you deploy to serverless functions or want a hosted
backend, pick something else: Seed expects a server you run.

## How do you try it?

Two ways, a minute each:

- **The live demo.** "Try it without an account" opens a guest account full of sample data: a
  group you own and two teams of made-up people. It is wiped every night, so break anything.
- **On your machine.** Deno 2 and Docker, then four commands. The
  [Get started guide](/docs/get-started) walks through them, and
  [the install post](/blog/install-seed-and-run-it-locally) shows the real output and the usual
  snags.

Start with the demo: [open it now](https://app.seedsaas.com), press "Try it without an account",
and poke around a team that is not yours.
