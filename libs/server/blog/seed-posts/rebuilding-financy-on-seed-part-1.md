---
slug: rebuilding-financy-on-seed-part-1
language: en
title: "Rebuilding Financy on Seed, part 1: a real product on a SaaS starter"
seoTitle: "Rebuilding Financy on Seed: a real product on a SaaS starter"
description: "I am rebuilding Financy, my open-source finance tracker, on Seed. Part 1: why I started over, how the copy began, and how the first sync of Seed's changes went."
tldr:
  - "Financy, my open-source finance tracker, starts over as a copy of Seed. The old version is frozen on a branch, as a reference for what it did."
  - "Its first commit is Seed's files plus 19 of Financy's own: licence, README, agent rules, product docs and the two .seed files."
  - "The first sync took 19 Seed commits and 616 changed files, one day after the copy and after a rebrand, with no conflict."
  - "No finance feature is built yet. What Financy needs that any product would need goes to Seed first, and Financy takes it with a sync."
topic: Building in public
intro: "I am rebuilding Financy, my open-source finance tracker for a person or a family, on Seed, and writing it up as it happens. Part 1: why I threw the old code away, how a product starts from Seed, and what the first sync of Seed's changes looked like."
cover: covers/rebuilding-financy-on-seed-part-1.webp
coverAlt: "A young violet plant moved from a cracked grey pot into a new violet pot, watered by a big violet plant."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-09T09:00:00Z
newsletter: true
devto: false
---

Can you build a real product on a SaaS starter and keep taking the starter's updates? That is what
I am doing right now with [Financy](https://github.com/spy4x/financy), my free, open-source
(AGPL-3.0) finance tracker for a person or a family. Financy started over as a copy of Seed on 3
November 2026, and on 4 November it took its first batch of Seed's changes: 19 commits, 616 files,
no conflict. This series follows the rebuild as it happens.

It is for developers weighing a SaaS starter who want to see one used for something other than a
demo, and for anyone curious about Financy. Everything here is public: every number below comes
from the two repositories on GitHub, and you can count each one yourself with git.

## Why rebuild Financy instead of fixing it?

The first Financy began in April 2025 and grew to 157 commits. It tracked accounts in several
currencies, converted between them and had end-to-end tests. It also had code I no longer trust: a
lot of it was written quickly with the AI models of the day, and its structure, state handling and
sync would all have to change to become the product I want.

The other half of the answer is what Financy was missing. A finance tracker for a household needs
sign-in with two-factor authentication, groups with roles, live updates on every device, an app that
works offline, an admin panel and a public website. That is a SaaS's plumbing, not finance, and I
had just spent October building most of it into Seed ([what landed in October](/blog/whats-new-in-seed-october-2026)).
Writing it a second time inside Financy would be the exact mistake Seed exists to prevent.

So the old Financy is frozen on its [`legacy`](https://github.com/spy4x/financy/tree/legacy) branch.
It is a reference for **what** Financy does (its features, its money rules, its edge cases) and
never for **how**: not a helper is ported. A money rule taken from it is a hypothesis; it becomes a
test first, then new code.

## How did Financy start from Seed?

With one pull request, [financy#83](https://github.com/spy4x/financy/pull/83): Seed's files, plus
the 19 files that make the copy Financy's. I counted them by comparing Financy's first commit with
the Seed commit it records:

```sh
git fetch https://github.com/spy4x/seed main
git diff --stat "$(git show 3d267c6f:.seed/commit)" 3d267c6f
```

Those 19 files are the AGPL-3.0 licence, with Seed's MIT notice kept in a file of its own; a README
that says plainly the app is not ready; Financy's `AGENTS.md`, the rules every agent and person
working on it follows; the product docs; the release pipeline's image name, so a Financy tag can
never overwrite Seed's images; Seed's four encrypted server settings removed; and the two files
that make syncing possible.

Those two are the whole trick. `.seed/commit` holds the Seed commit the copy matches, and
`.seed/skip` lists Seed's paths that Financy never takes changes for, such as its README. A sync is
then a `git diff` from that commit to Seed's current `main`, applied with a three-way merge. The
full recipe is in [Start a product from Seed and keep getting its updates](/blog/start-a-product-from-seed-and-keep-its-updates);
this post is what happened when I followed it for real.

## Did the first sync actually work?

Yes, and with a small trap laid for it on purpose. Before the sync, Financy had already changed
Seed's files: [financy#123](https://github.com/spy4x/financy/pull/123) gave it its name, a wallet
icon and its own blue instead of Seed's violet, across 32 files. A sync that only works on an
untouched copy would be no proof.

Then [financy#127](https://github.com/spy4x/financy/pull/127) took Seed from `ec61062b` to
`d9641f03`. That is 19 Seed pull requests and 616 changed files, and `git apply --3way` applied them
with no conflict. Among what arrived:

- signing in with a code sent by email;
- a yearly price next to the monthly one;
- a time zone for the whole group;
- the API and the worker running on Node and Bun as well as Deno;
- a setting for where a product's changelog starts.

The sync also showed one step a product has to do by hand. Seed had just added `AGENTS.seed.md`,
the rules of Seed's own repository, and Financy deleted it and listed it in `.seed/skip`, so no
later sync brings it back. After the sync, Financy differs from Seed in 59 files, and every one of
them is a file Financy changed on purpose.

## What goes to Seed instead of Financy?

Anything every SaaS would need. Financy's `AGENTS.md` sets the order: code any project could use
goes to the shared `@spy4x/*` libraries, code any product built on Seed would need goes to Seed,
and only what a finance product needs (accounts, transactions, budgets, rates) stays in Financy.
There are no local stand-ins "to move later", because later is how a fork drifts away.

Three items in the list above are exactly that. Financy needs yearly billing, a household's
month needs one time zone for every member, and its changelog must not start with years of the old
app's commits. None of these is about money, so each was built in Seed and reached Financy through
the sync. On 3 and 4 November, 31 new Seed issues named Financy, and by 5 November 8 of them
were closed.

The rebuild also found holes in my own recipe. Seed's checklist of what a product removes from
Seed's website missed several files, and step 1 recorded Seed's newest commit, which can be newer
than the copy, so the first sync would silently skip the commits in between. Both are fixed in Seed
([seed#811](https://github.com/spy4x/seed/pull/811)), and the [guide](/docs/products) now says how
to find the commit whose files match yours. That fix is worth more to you than to me: the next
product built on Seed will not hit it.

## What is not done yet?

Most of it. As I write this, Financy is Seed with Financy's name, licence and colour. No account,
transaction or budget screen exists yet, so do not try to use it. Even the name is not settled:
[financy#126](https://github.com/spy4x/financy/issues/126) asks whether to keep it before launch.

The plan is public: [Financy's issues](https://github.com/spy4x/financy/issues), grouped into seven
milestones, from foundations to launch and after it. Every gap they hit in Seed gets fixed in Seed, so this series
will keep showing both sides: what Financy needed and what Seed learned from it.

## Follow along

[Watch the Financy repository](https://github.com/spy4x/financy) to see each pull request land, and
subscribe to this blog to get part 2 by email. If you are about to start a product of your own,
[the guide](/docs/products) is the same one Financy follows, and if a step in it fails for you,
[open an issue](https://github.com/spy4x/seed/issues): it means the recipe needs a line.
