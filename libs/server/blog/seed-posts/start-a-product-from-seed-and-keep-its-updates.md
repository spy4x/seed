---
slug: start-a-product-from-seed-and-keep-its-updates
language: en
title: Start a product from Seed and keep getting its updates
description: A GitHub template copy shares no history with Seed. Here is how a product records where it came from and takes Seed's later fixes and features as one reviewed patch.
tldr:
  - Record the Seed commit you started from in .seed/commit, and the files you own in .seed/skip.
  - A sync is a git diff from that commit to Seed's main, applied with git apply --3way.
  - I rehearsed it from a 24 October copy to 3 November's main; 945 files applied with no conflict.
  - Code every product needs goes to Seed first, then comes back with a sync.
topic: Guides
intro: "A product copied from Seed can keep taking Seed's fixes and features. I rehearsed the sync on a real copy, and this is the recipe, from recording where you started to applying one reviewed patch."
cover: covers/start-a-product-from-seed-and-keep-its-updates.webp
coverAlt: "A large violet plant and a young cutting of it in a separate pot, joined by a thin line carrying drops from one to the other."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T15:00:00Z
newsletter: false
---

To start a product from Seed and keep getting its updates, create your repository from the
template, save the Seed commit you started from in `.seed/commit`, and list the files that are
entirely yours in `.seed/skip`. Later, one command takes the difference between that commit and
Seed's current `main` and applies it to your product as a patch, in a pull request you review like
any other.

The problem it solves: "Use this template" gives you a copy with a fresh history. Git does not know
your product and Seed are related, so `git merge` from Seed is no help. Without a plan, every
security fix in Seed becomes a manual port, and after a year nobody does it. I am rebuilding my
own finance tracker, [Financy](https://github.com/spy4x/financy), on Seed this way, so I need this
to work too.

## Step 1: record where you started

Right after you create the repository, in its first pull request:

```sh
mkdir -p .seed && git ls-remote https://github.com/spy4x/seed refs/heads/main | cut -f1 > .seed/commit
touch .seed/skip
```

`.seed/commit` holds one commit id: the Seed version your copy matches. `.seed/skip` starts empty
and lists Seed's paths, one per line, that your product never takes changes for.

In the same pull request, replace `AGENTS.md` with your own (a sync never touches it), and go
through [what belongs to Seed's own website](/docs/start-a-product): Seed's repository is also
seedsaas.com, so it carries my prices, my blog posts and a comparison page your product should
not go live with.

## Step 2: take Seed's changes

Each sync is one branch and one pull request in your product:

```sh
git fetch https://github.com/spy4x/seed main
git diff --binary "$(cat .seed/commit)" FETCH_HEAD -- . ':!AGENTS.md' $(sed '/^$/d; s/^/:!/' .seed/skip) \
  | git apply --3way && git rev-parse FETCH_HEAD > .seed/commit
```

Read it right to left: fetch Seed's `main`, make a diff from your recorded commit to it, leave out
`AGENTS.md` and every path in `.seed/skip`, and apply the result with a three-way merge, so a file
you changed gets conflict markers instead of a refusal. When it applies, the new Seed commit is
written to `.seed/commit`, and the next sync starts from there.

Run `deno task check` before you open the pull request, and read the diff: it is Seed's changes
landing in your code, and you are the one shipping them.

## Does it actually apply?

I tried it before writing this. I made a product from Seed as it was on 24 October 2026
(`4815564`), recorded that commit, and ran the sync against Seed's `main` of 3 November
(`e913e6b`). That is 87 Seed commits and 945 changed files, and they applied with no conflict.

That is the easy case, because my rehearsal product had changed nothing. A real product will have
changed its screens and its copy, and that is where the next section comes in.

## What do you do with a conflict?

- **A file you changed on purpose** (your own aggregates, screens, brand, website copy): keep your
  version.
- **Anything else**: take Seed's version.
- Then record the synced commit yourself, since the `&&` in the command skipped it:
  `git rev-parse FETCH_HEAD > .seed/commit`.

A patch refused with "does not exist in index" means it touches a file you deleted without saying
so. Add that path to `.seed/skip` and run the sync again. The same goes for a file you take over
completely: once it is in `.seed/skip`, later syncs leave it alone.

## What should go back to Seed?

If your product needs something every product would need (a sign-in method, a fix in the billing
flow, a new kind of notification), build it in Seed first, then take it with a sync. If any project
could use it (a date helper, a component), it goes to the shared `@spy4x/*` libraries. The rule
that keeps this cheap: never ship a local copy "to move later". Later is how forks drift.

## Start yours

Create the repository, write the two `.seed` files in its first pull request, and put a monthly
sync in your calendar; Seed's monthly "What's new" post on this blog says what each one will bring.
The full recipe is [Building a product on Seed](/docs/products). If a sync goes wrong in a way this
post does not cover, [tell me in an issue](https://github.com/spy4x/seed/issues): it means the
recipe needs a line.
