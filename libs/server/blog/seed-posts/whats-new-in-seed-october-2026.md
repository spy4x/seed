---
slug: whats-new-in-seed-october-2026
language: en
title: "What's new in Seed: October 2026"
description: "What changed in Seed, the free SaaS starter, in October 2026: passkeys and guest accounts, Stripe billing per member, offline sync, nine languages, the admin panel and the public website."
tldr:
  - October was Seed's biggest month so far, with 356 commits on main, 146 of them features.
  - Sign-in gained passkeys, Google and GitHub, e-mail links and one-click guest accounts.
  - Groups got invitations, roles, billing per member through Stripe, and export and import.
  - Nine languages, an offline app, an admin panel on its own host and a public website arrived.
topic: Changelog
intro: "October was Seed's biggest month yet, with 356 commits on main. Here is what changed, from passkeys and per-member billing to offline sync and nine languages."
cover: covers/whats-new-in-seed-october-2026.webp
coverAlt: "A tree whose new branches end in buds shaped like a key, a coin, a globe, a house and a gear, with leaves falling around it."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T21:00:00Z
newsletter: false
---

What's new in Seed in October 2026: sign-in with passkeys, Google, GitHub, e-mail links and guest
accounts; groups with invitations, roles and billing per member through Stripe; an offline app that
syncs only what changed; nine languages, Arabic right to left included; an admin panel on its own
host; and a public website with a blog. In numbers, 356 commits landed on `main` in October, 146 of
them new features and 103 fixes, against 101 commits in all the months before.

This is the first monthly "What's new in Seed". From now on, one comes out at the start of every
month, grouped by what you do with Seed rather than by where the code lives. The commit-by-commit
list is on [the changelog page](/changelog).

## Signing in

- **Passkeys**, and **sign-in with Google and GitHub** ([providers](/docs/sign-in-providers)).
- **Sign-in links by e-mail**, for people who would rather not have a password.
- **Guest accounts**: "Try it without an account" opens a real account in one click, and the visitor
  can add a sign-in method later and keep everything ([guests](/docs/guests)).
- **The address is proven before sign-up creates anything**, so a typo or someone else's address
  leaves no account behind.
- **Sessions you can see and end**, and a mail when a sign-in method changes.

## Groups and teams

- **Invitations, members and roles** from viewer to owner, and **ownership transfer**, which hands
  the billing over too.
- **Rename, delete and restore** a group, with a description, a colour and an emoji, and a person
  always keeps at least one.
- **An activity log** per group.
- **Export and import a group**, and **move all of a group's data** to another one.

## Billing

- **Stripe subscriptions per group, billed per member**: the quantity follows the member count.
- **Plan limits and feature gates**, a **trial** (one per person, not per group), cancelling, and a
  **grace period** after a failed payment before the plan ends ([billing](/docs/billing)).

## Notes, the reference feature

Notes are the example every new feature copies, so they gained what a real feature needs:

- **Tags** in any colour, with note counts.
- **Attachments** with quotas: images and PDFs in the bundled file store ([files](/docs/files)).
- **Search** across notes and groups with Ctrl+K.
- **Delete with undo**, restore, sort, and **move** notes between groups.

If you are building your first feature, [the notes walkthrough](/blog/your-first-feature-copy-the-notes-aggregate)
shows how to copy them.

## Offline and realtime

- **An offline-first app.** The SPA keeps the last notes and groups in IndexedDB, opens with no
  network and queues note writes until it is back, showing a stale write as a conflict to settle
  ([offline](/docs/offline)).
- **Sync pulls only what changed** since the device's last read, not the whole list.
- **The transport and the local database are swappable modules**: a product that needs neither
  leaves them out.
- Pages **recover when the app comes back** and react at once when someone's role changes.

## Your account

- **A profile picture**, **preferences synced across devices**, and **personal API tokens**.
- **Download my data** as a ZIP ([data export](/docs/data-export)), and **delete my account**.
- **Notifications** in the app, by web push, and in Telegram once a person links the bot
  ([Telegram](/docs/telegram)).
- **Keyboard shortcuts**; press `?` to list them.

## Nine languages

The SPA, the admin panel, the website and the e-mails now speak English, German, Spanish, French,
Brazilian Portuguese, Russian, Japanese, Simplified Chinese and Arabic, with **right-to-left
layouts** for Arabic. E-mails go out in the recipient's language, time zone and date format.

## The admin panel

The operator area moved to **a host of its own** and became a dashboard of modules: people with
their roles, sessions and a CSV export; groups; billing with refunds; the newsletter; the blog with
its editor; background jobs you can rerun; files; a product catalog; contact links; stats; and an
**audit log** of every operator action ([admin modules](/docs/admin-modules)).

## The public website

Seed got [its own site](/): the home page, [features](/features), [pricing](/pricing),
[a comparison](/compare), the admin panel's page with a video, this blog with an RSS feed, a
newsletter with double opt-in, and an `llms.txt` for AI assistants. It is rendered on the server
and works with JavaScript off.

## Running it

- **`deno task init`** writes the env file with fresh secrets, and **`deno task dev`** starts the
  proxy for you ([install guide](/blog/install-seed-and-run-it-locally)).
- **PgBouncer** pools the database connections.
- **A bundled S3 file store** (Garage), which turns uploaded photos into small AVIF and WebP copies
  with their metadata removed.
- **Scheduled backups with a tested restore** ([backups](/docs/backups)), **security headers** on
  every app, and error reports from the browser and the API.
- **A public demo** with made-up people, sample data for every new account and a nightly wipe:
  [app.seedsaas.com](https://app.seedsaas.com).
- A product without sign-up can turn the SPA off and create its operators from the command line.

## What's next

November's work is on [the open issues](https://github.com/spy4x/seed/issues), with the Android
and desktop apps and running unchanged on Node and Bun among them. If you already started a product
from Seed, [take these changes with a sync](/blog/start-a-product-from-seed-and-keep-its-updates).
If you haven't, [the live demo](https://app.seedsaas.com) is the fastest way to see all of the
above.
