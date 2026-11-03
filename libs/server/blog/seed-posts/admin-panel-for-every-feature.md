---
slug: admin-panel-for-every-feature
language: en
title: "Every feature gets an admin screen: how Seed's admin panel stays in sync"
seoTitle: "SaaS admin panel: an admin screen for every feature"
description: "Seed's admin panel lives on its own host and has a module for every feature of the product. Here is how a module is built, who may open it, and the rule that keeps the two in step."
tldr:
  - Seed's admin panel is a separate app on its own host, with 13 modules, from users and billing to jobs and the audit log.
  - A feature and its admin counterpart ship in the same change. That rule sits in the repo's agent instructions, and two tests keep the panel's two halves listing the same modules.
  - Only a signed-in operator gets in, with their second factor when they have one. A signed-in person below operator gets a plain 404, and every operator action is audited.
  - Operators see account facts and counts, not people's notes.
topic: Deep dive
author: Anton Shubin
publishAt: 2026-11-02T18:00:00Z
newsletter: false
---

Does a SaaS need an admin panel from day one? In my experience, yes: the first support email
arrives before the first invoice. Seed ships one as its own app, on its own host, with a screen for
every feature the product has, and a rule that a feature and its admin screen ship together.

This post is for founders and developers who have ever fixed a customer's account with a raw SQL
query at midnight. I'll show what the panel covers, how one module is put together, and how it
avoids drifting behind the product.

## Why an admin screen for every feature?

Because the alternative is the database console. A person cannot sign in, a payment looks wrong, a
nightly job failed: each of those is a question an operator must answer in a minute, without
writing SQL against production. Every feature that can go wrong for a person needs a place where
someone can see it and act on it.

The panel that grows "later" never catches up. So in Seed it is not a later thing.

## What is in the panel?

Thirteen modules, each one entry in the icon rail:

| Module        | What an operator does there                                          |
| ------------- | -------------------------------------------------------------------- |
| Dashboard     | Sees the main counts and their 30-day trends                         |
| Stats         | Reads the public website's visits                                    |
| Users         | Finds a person; blocks, unblocks, ends sessions, sends a reset email |
| Groups        | Sees a group, its members and its plan                               |
| Billing       | Follows a group's subscription and payments                          |
| Newsletter    | Sees subscribers and the issues sent                                 |
| Blog          | Writes and schedules posts like this one                             |
| Contact links | Edits the contact channels the website lists                         |
| Catalog       | Edits the product catalog, only when the product turns it on         |
| Audit log     | Reads who did what, and when                                         |
| Jobs          | Sees background jobs, their failures, and retries them               |
| System        | Checks the queue, the backups and the running version                |
| API tokens    | Sees a person's tokens, devices and notification subscriptions       |

A person's page has five tabs of its own: overview, sign-in methods, sessions, groups and
activity. Other modules can add tabs there, as the API tokens module does.

## How is one module built?

A module is a handful of files with fixed homes:

1. `apps/admin/src/modules/<id>/module.tsx`: its rail entry, its pages and any tabs it adds to a
   person's page.
2. `libs/ui/admin-<id>-screen.tsx`: the screens, which take data in and hand clicks back, and
   know nothing about the network.
3. `apps/api/routes/admin/<id>.ts`: the API routes under `/api/admin`.
4. `libs/server/<area>/admin-<id>.ts`: the SQL, when the module reads anything.

The app and the API each keep a registry of modules, and a test on each side checks that both list
the same ids in the same order. Forget one half and the check fails before anyone sees a rail
entry that leads nowhere. The steps for adding a module are in
[the admin modules docs](/docs/admin-modules).

## How does it stay in sync with the product?

Here is the honest part: no machine can check that a new feature has an admin screen. "Is this a
feature?" is a judgement. So the rule lives where every contributor, human or agent, reads it:
Seed's `AGENTS.md` says that a change adding or modifying a feature in one of the product's apps
adds or modifies its admin counterpart in the same pull request. Review holds it there.

An example of what that looks like: when the app got a way to link a Telegram account, the same
change gave operators a way to unlink one from a person's page. A person locked out of Telegram
can write to support and get unstuck the same day.

It works because it is small each time. A new feature means one more tab or one more button, not a
quarter-long "admin panel project" that nobody wants to start.

## Who can get in?

1. **Its own host.** The panel is served on `ADMIN_DOMAIN`, separate from the product's address.
2. **A complete sign-in.** The session must be signed in and, if the operator has a second
   factor, must have passed it. Otherwise the API answers 401, as every signed-in route does.
3. **The operator role.** A signed-in person without it gets a 404 from every admin route, so
   the panel does not even admit it exists.
4. **Every action is audited.** Blocking a person, ending their sessions, changing a role: each
   one is written to the audit log with who did it.

Blocking a person or ending their sessions also closes their open WebSocket connections, so the
change bites at once and not at their next page load.

## What can an operator not see?

People's content. The panel shows account facts and counts: when someone signed up, how they sign
in, how many notes a group holds. It does not show the text of those notes. The one exception is
a group's Files tab, which lists its attachments, and opening or downloading one there is written
to the audit log with the operator's name. Support should be able to help you without reading your
diary.

## See it

The [admin panel page](/admin) has a short video of the panel in use, and the
[code](https://github.com/spy4x/seed) holds every module, MIT-licensed. If you are building a SaaS
on Seed, add your feature, then add its tab. Your future self, answering that midnight email, will
thank you.
