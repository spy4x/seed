---
slug: over-engineering-a-saas-boilerplate
language: en
title: "What I got wrong in Seed v1: over-engineering a SaaS boilerplate"
seoTitle: "Over-engineering a SaaS boilerplate: what I got wrong"
description: "Seed v1 ticked half its roadmap and almost none of the parts a person uses. What over-engineering a SaaS boilerplate looked like in its code, and what Seed does now."
tldr:
  - "Seed v1 (2019 to 2022) ticked 33 of its 66 roadmap items, and none of the 17 under the web client, the admin panel, the PWA and file uploads."
  - "It had 31 Nx projects, 23 CQRS message classes and nine cloud services around three database tables."
  - "Over-engineering means building a feature in a more complicated way than it needs. It does not mean building too many features."
  - "Seed today builds each feature end to end in one copied shape, on one server, and has every product feature v1 only planned."
topic: Scars
intro: "Seed had a first version, from 2019 to 2022, and I over-engineered it. This is what that looked like in its roadmap, its commits and its folders, and what Seed does differently now."
relatedFeature: deploy
cover: covers/over-engineering-a-saas-boilerplate.webp
coverAlt: "A tall violet scaffolding tower built around a tiny seedling in a pot, next to a plain pot where a full plant grows on its own."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-07T09:00:00Z
newsletter: true
devto: false
---

What did I get wrong in Seed v1? I over-engineered it: I built the scaffolding of a big product
before the product. Its own roadmap shows it. Of 66 items, 33 were ticked, and the ticked half was
mostly tooling and backend plumbing: a monorepo, strict lint rules, a pre-commit hook, CQRS base
classes, deploys to Google Cloud. The other half held almost everything a person would use: groups,
payments, realtime updates, offline work, file uploads and the admin panel.

This post is for developers building a SaaS boilerplate, or their own first SaaS, who suspect they
are polishing the workshop instead of building the furniture. Every number below comes from the
code: v1 is still in the repository as the tag
[`v1-final`](https://github.com/spy4x/seed/tree/v1-final), and the commands are in the
[pull request](https://github.com/spy4x/seed/pull/823) that
added this post. No memories were harmed in the making of these numbers; I counted.

## What was Seed v1?

A "full-stack startup monorepo template", in its README's words, promising best practices from
day 1. It was Angular on the front, Nest.js and Prisma on PostgreSQL at the back, Firebase for
sign-in, Google Cloud to run it, Nx to hold it together and Yarn to install it. The first commit is
from 16 June 2019, the last from 23 December 2022: 134 commits in three and a half years.

It didn't fade out. It stopped: 55 of those commits came in its last two months, and then nothing,
until Seed started over as a new history on 26 January 2026.

## What did the roadmap promise, and what got built?

The README's roadmap marked each item done or planned. Its last update was on 25 November 2022:

| Roadmap section                        |   Done | Planned |
| -------------------------------------- | -----: | ------: |
| Environment and code organisation      |      8 |       7 |
| Backend                                |     14 |       5 |
| Database                               |      3 |       1 |
| Frontend, shared (auth, state, tests)  |      6 |       3 |
| Styles                                 |      2 |       0 |
| PWA (offline, push, install)           |      0 |       4 |
| File uploads                           |      0 |       4 |
| Admin panel                            |      0 |       3 |
| Web client (groups, realtime, account) |      0 |       6 |
| **Total**                              | **33** |  **33** |

Stripe subscriptions sat under Backend, planned. A users table for the admin panel did land in
December 2022, after the last roadmap update, so give v1 that one.

Three of the 33 ticks were automatic backups, restoring a backup and read replicas. Each linked to
Google Cloud SQL's documentation, and the infrastructure doc said replication was "not yet used". I
was ticking Google's homework.

## Where did the work go instead?

Into the workshop. Commit messages carry their type, and they tell the story better than I can:

- **52 of the 134 commits are typed `env` or `environment`**: config, tooling, CI, upgrades and
  renames. 31 are `feat`.
- **The first commit that lets a person do anything** (a basic user API: sign up, get me, update
  me) is number 38, from 31 May 2021, almost two years after the first. The first 37 include 28
  `environment` commits.
- **CI was set up three times**: GitLab CI in July 2019, GitHub Actions in March 2021, Google Cloud
  Build in June 2021. The last roadmap still listed CI/CD as planned.
- **Four renames of apps and folders in two days** in February 2021, and a commit called
  "massive refactoring" a year later.

## How much structure for how little data?

v1's database schema has three models: `User`, `UserDevice` and `Notification`. Around them:

- **31 Nx projects**: three apps, two end-to-end test apps and 26 libraries. Shared sign-in on the
  front end alone was four libraries: container, guards, state and UI.
- **65 `index.ts` files**, and 63 of them only re-export other files.
- **A CQRS layer with its own base classes** over the command, query and event buses, carrying 11
  commands, 5 queries and 7 events, with 19 handlers.
- **Nine cloud services** in the infrastructure doc (Cloud Run, Cloud SQL, Cloud Tasks, Cloud
  Logging, Cloud IAM, Firebase Authentication, Hosting and Storage, and Sentry), and a setup guide
  marked "WIP" that started with manual steps.
- **104 npm packages** in the root `package.json`, 50 of them runtime dependencies.

For comparison, Seed today has 34 workspace packages around 73 database tables. The structure now
grows with the data instead of waiting for it.

## Was the problem too many features?

No, and this is the part I want to get right. Over-engineering is building a feature in a more
complicated way than it needs: extra layers, guards for rare timing, automation nobody runs. It is
not "this feature is unnecessary". v1's wish list was fine. Seed today has every product feature v1 only
planned, and more: passkeys and a second factor, groups with roles and invitations, Stripe billing
per member, realtime updates, an offline app, a file store, an admin panel on its own host and nine
languages ([README](https://github.com/spy4x/seed#readme)).

It even still uses CQRS: commands, queries and events go through their own buses, and every group
change writes its event to an outbox that a worker drains. The pattern was never the crime. Building
four sign-in libraries before a single group existed was.

## What does Seed do differently now?

- **One shape for every feature.** A new feature copies the notes feature file by file, in a fixed
  order: [every file of the notes aggregate](/docs/aggregates). The guide says it plainly: "Do not
  invent a second shape."
- **One server instead of nine services.** Docker Compose runs the app, Postgres, the proxy and the
  monitoring on a server you control:
  [from git clone to production on one Hetzner server](/blog/deploy-saas-to-one-hetzner-server).
- **Principles that say no.** Seed's [principles](https://github.com/spy4x/seed/blob/main/docs/principles.md)
  include "Ship small, safe slices", "Avoid speculative complexity" and "Add deps only with clear
  ROI".
- **Web standards over frameworks.** The servers speak Fetch, Web Crypto and WebSocket rather than
  one platform's private API: [why Seed is built on web standards](/blog/why-seed-free-saas-starter-web-standards).

The commit types moved too. Of Seed's 531 commits since the restart, 194 are `feat` and 46 are
`chore`, `ci` or `build`. Most of them are squash-merged pull requests, so they are not the same
size as v1's commits, but the direction is clear.

## Is your boilerplate doing the same?

Three quick checks, taken from v1's numbers above:

1. Count your folders and your tables. More libraries than tables is a smell.
2. Read your roadmap's planned half. If it holds everything a user would touch, you're building
   the workshop.
3. Find the commit where a person could first do something. If it's number 38, hello, it's me.

Or skip the scaffolding: [Seed](https://github.com/spy4x/seed) is free and MIT-licensed, and its
groundwork is already built. Clone it and
[ship your first feature](/blog/your-first-feature-copy-the-notes-aggregate) this week.
