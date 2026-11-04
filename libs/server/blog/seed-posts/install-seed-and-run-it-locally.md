---
slug: install-seed-and-run-it-locally
language: en
title: How to install Seed and run it locally
description: Install Seed, the free SaaS starter, and run it on your machine with Deno and Docker in four commands. What each step does, what you should see, and how to fix the usual snags.
tldr:
  - You need Deno 2 and Docker. The GitHub CLI is optional.
  - "Four commands: create the repository, cd into it, deno task init, deno task dev."
  - Then open http://app.localhost and sign up. In development the e-mail code lands in the worker's log.
  - On my laptop the stack came up in 36 seconds and used 1.6 GB of memory at rest.
topic: Guides
intro: "You can have Seed running on your laptop in four commands and well under a minute. I walk through each one, what you should see, and the snags I hit so you don't have to."
cover: covers/install-seed-and-run-it-locally.webp
coverAlt: "Four stepping stones leading to a small computer with a potted seedling on top, the last stone glowing."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T09:00:00Z
newsletter: false
---

To install Seed and run it locally, you need Deno 2 and Docker. Create your repository from the
template, run `deno task init` to write the env file with fresh secrets, run `deno task dev` to
start the stack, and open http://app.localhost. That is the whole install; the rest of this post
says what each step does and what to do when one of them complains.

I ran every command below on 3 November 2026 in an empty folder, on Seed's `main` of that day,
so the output you see here is real, not remembered.

## What do you need first?

- [Deno](https://deno.com) 2. The tasks that set up the stack run on it.
- Docker with Compose. Every service runs in a container. Podman works too, with one extra line
  (below).
- Optionally the [GitHub CLI](https://cli.github.com). Without it, GitHub's "Use this template"
  button and a `git clone` do the same as step 1.

Free ports matter too: the stack publishes Postgres on `127.0.0.1:5432`, Valkey on `6380`,
Grafana on `3000`, and the proxy on `80` and `443`, all on your machine's loopback only.

## Step 1: create your repository

```sh
gh repo create my-product --template spy4x/seed --private --clone
cd my-product
```

This makes `my-product` a private repository of yours with Seed's files and a clean history. It
is your code from here on: rename things, delete what you do not need.

## Step 2: `deno task init`

```sh
deno task init
```

It asks for the project's name, then copies `infra/envs/.env.example` to `infra/envs/.env` and
replaces every placeholder secret with a random one, and writes the web push keys to
`infra/configs/vapid.json`. Here is what it printed for me (I passed `--yes`, which takes the
folder's name instead of asking):

```text
Created infra/envs/.env
Set PROJECT, KV_PASSWORD, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, GARAGE_RPC_SECRET, GRAFANA_PASS, AUTH_COOKIE_SECRET, AUTH_PEPPER, SEED_PASSWORD in infra/envs/.env
Created the web push keys in infra/configs/vapid.json

Ready. Run: deno task dev
Then open http://app.localhost
```

Running it again is safe: it only replaces a secret that still holds the placeholder, so it never
rotates a key you are already using.

## Step 3: `deno task dev`

```sh
deno task dev
```

It starts Traefik (the proxy that answers `app.localhost`) unless one is already running, then
Postgres, PgBouncer, Valkey, the API, the worker, the SPA, the bundled file store and the
monitoring. A one-shot `migrate` container applies the database migrations before the API and the
worker start, so there is nothing to run by hand.

On my laptop, with Docker's base images already downloaded, it finished in 36 seconds and left 16
containers running. Your first run downloads and builds the images, so make a coffee.

## Step 4: open the app

Open **http://app.localhost** and sign up with any address. In development no mail leaves your
machine: the worker writes each e-mail to its log instead, so the confirmation code is there:

```sh
deno task compose logs -f worker
```

Don't feel like typing an address? "Try it without an account" opens a guest account in one
click, and you can add a sign-in method to it later without losing anything.

To check the backend on its own:

```sh
curl -s http://app.localhost/api/health
```

Mine answered `{"status":"ok","checks":{"database":true,"cache":true,"files":true}, …}`.
Grafana, with the stack's metrics and logs, is at http://localhost:3000.

## How heavy is it?

Right after the start, idle and with an empty database, the 16 containers used 1.6 GB of
memory in total. Of that, 700 MB was the SPA's Vite dev server, which production replaces with
static files, and 320 MB was Grafana. The database used 106 MB, the API and the worker about 160 MB
each. A laptop with 8 GB is fine.

## What if something goes wrong?

- **A port is taken.** Before it starts anything, the start binds every port the project
  publishes for a moment, and stops when one is busy. Change that port in `infra/envs/.env`
  (`DB_HOST_PORT`, `KV_HOST_PORT`, `GRAFANA_HOST_PORT`) and run `deno task dev` again.
- **You use Podman.** Set `CONTAINER_PROVIDER=podman` in the env file and start the proxy with
  `deno task proxy:start`.
- **You want the admin panel or the website too.** Add `admin` or `mpa` to `COMPOSE_PROFILES` in
  the env file. The admin panel then answers at http://admin.localhost ([the three apps](/docs/apps)).
- **You want sample data.** `deno task db:seed` fills the database with made-up people, groups and
  notes, plus an administrator; [the development guide](/docs/development) lists the values it
  needs.

To stop everything, `deno task compose down`. Your data stays in `.volumes/` for next time.

## What next?

Change something small and watch the page update, then build your own feature: Seed's notes are
the worked example, file by file, in
[Your first feature: copy the notes aggregate](/blog/your-first-feature-copy-the-notes-aggregate).
When it is ready for real people,
[From git clone to production on one Hetzner server](/blog/deploy-saas-to-one-hetzner-server) is
the deploy. Stuck on a step of this one? Open an issue at
[github.com/spy4x/seed](https://github.com/spy4x/seed/issues) and tell me where.
