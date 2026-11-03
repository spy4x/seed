---
slug: deploy-saas-to-one-hetzner-server
language: en
title: From git clone to production on one Hetzner server
seoTitle: Deploy a SaaS to one Hetzner server, and what it costs
description: How to deploy a Seed SaaS to one Hetzner server, step by step, and what it costs a month against Vercel Pro and Supabase Pro, with prices checked on 3 November 2026.
tldr:
  - One Ubuntu server, Docker, DNS records and one env file, then deno task deploy.
  - Migrations, certificates and the proxy start on their own; backups take one more step.
  - On 3 November 2026 the cheapest x86 Hetzner server plus backup storage cost €12.48 a month.
  - Vercel Pro and Supabase Pro start at $45 a month for one developer, before usage.
topic: Guides
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-02T12:00:00Z
newsletter: false
---

To deploy a SaaS built on Seed to one Hetzner server, you create an Ubuntu server, install Docker
and Deno on it, point your domains at it, fill one production env file on your own machine and run
`deno task deploy`. The deploy copies the code, builds the images on the server and starts them;
migrations run and certificates arrive on their own. On 3 November 2026 that server, with backup
storage, cost **€12.48 a month** before VAT.

This post is the route from a working local copy
([How to install Seed and run it locally](/blog/install-seed-and-run-it-locally)) to real people
using it, and the bill at the end. The full checklist, with every command and every check, is the
[deploy guide](/docs/deploy); here I keep what matters and why.

## What does it cost to run a SaaS on one Hetzner server?

Here are the list prices I read on 3 November 2026, before tax:

| What                                                       | Price a month | Source                                                                   |
| ---------------------------------------------------------- | ------------- | ------------------------------------------------------------------------ |
| Hetzner CX23: 2 vCPU, 4 GB, 40 GB disk, 20 TB traffic      | €5.49         | [Hetzner Cloud API](https://docs.hetzner.cloud/), `GET /v1/server_types` |
| Hetzner CPX32: 4 vCPU, 8 GB, 160 GB disk                   | €35.49        | the same                                                                 |
| Hetzner CPX42: 8 vCPU, 16 GB, 320 GB disk                  | €69.49        | the same                                                                 |
| A primary IPv4 address                                     | €0.50         | the same, `GET /v1/pricing`                                              |
| Hetzner Object Storage, for the backups (1 TB included)    | €6.49         | [hetzner.com](https://www.hetzner.com/storage/object-storage/)           |
| Vercel Pro, per developer seat ($20 usage credit included) | $20           | [vercel.com/pricing](https://vercel.com/pricing)                         |
| Supabase Pro ($10 compute credit, 100,000 monthly users)   | from $25      | [supabase.com/pricing](https://supabase.com/pricing)                     |

The cheaper CX33 (4 vCPU, 8 GB) is still in Hetzner's list at €8.49, but that day it could not be
ordered in any location, and the CX23 only in Nuremberg and Helsinki. Prices change, so check
again before you budget.

Pick a server and a team size:

<HostingCost server="cx23" developers={1} />

With one developer, Seed on the CX23 costs €12.48 a month and the managed pair $45, about €40.12
at the ECB's rate of 2 November 2026 ($1.1216 to the euro), so about €332 a year apart. With three
developers on the 8 GB CPX32 it is €42.48 against $85 (about €75.78), about €400 a year.

The comparison is not like for like, and I would rather say so than let you find out. Seed on its
own server also gives you background jobs, a file store, monitoring and an admin panel inside that
price, and its traffic is flat up to 20 TB. The managed pair gives you things Seed does not: no
server to patch, scaling without a resize, and a database someone else runs and backs up. Both
sides still need an SMTP service for e-mail, so I left it out of both.

## Which server size do you need?

Start small. On my laptop the whole development stack, idle and empty, used 1.6 GB of memory, and
700 MB of that was the Vite dev server that production does not run. That is why I start on the 4 GB
CX23. It rests on that development figure, not on a production measurement: I have not measured
Seed's memory on a production server, nor the peak while the deploy builds the images on the server,
which it does on every deploy. After your first deploy, check the server's memory with `free -h`.
Hetzner can resize the server later; resize only CPU and memory, not the disk, if you want to be
able to go back down.

How many users one server carries is a question with a measured answer, not a guess: the
[capacity guide](/docs/capacity) has the load tests and their numbers, from a laptop so far.

## The steps, in order

1. **Create the server** with your SSH key, on Ubuntu. Make a `deploy` user with uid 1000 (the
   containers run as that uid) and turn off password and root logins. The guide's block does this
   and is safe to paste twice.
2. **Install Docker, Compose, rsync and Deno** on it, and add the `deploy` user to the `docker`
   group.
3. **Close the firewall** to everything but SSH, 80 and 443. Postgres, Valkey and Grafana listen on
   `127.0.0.1` only, so they are never on the internet. A Hetzner Cloud Firewall in front of the
   server is the safer place for this rule, since Docker cannot open it.
4. **Point DNS** at the server: an `A` (and `AAAA`) record for the app's host, and for the website
   and admin hosts if you run them. Let's Encrypt checks each host over port 80, so do this before
   the proxy starts.
5. **Write the production env file on your machine**: `cp infra/envs/.env.example
   infra/envs/.env.prod`, then set `ENV=prod`, your domains, `SSH_TO_SERVER`, `PATH_ON_SERVER` (the
   app's folder on the server), `TRAEFIK_ACME_EMAIL` (where Let's Encrypt writes about expiring
   certificates) and a fresh secret for each secret. Set `PROXY_HTTPS_HOST_PORT=443` and
   `PROXY_HTTP_HOST_PORT=80`: the example keeps the proxy on `127.0.0.1`, and with those defaults
   nobody outside reaches the site and Let's Encrypt fails. Add `admin` to `COMPOSE_PROFILES` for
   the admin panel and `mpa` for the website, if you run them. The deploy refuses a file that keeps
   an example secret or leaves one empty, and names each. The file never lives on the server: every
   deploy copies it there.
6. **Deploy**, then start the shared proxy once:

   ```sh
   ssh deploy@192.0.2.10 mkdir -p <PATH_ON_SERVER>
   deno task deploy
   ssh deploy@192.0.2.10
   cd <PATH_ON_SERVER> && deno task proxy:start
   ```

   Traefik asks Let's Encrypt for every host's certificate as soon as it starts.
7. **Create the first operator** for the admin panel:
   `deno task compose exec worker deno task operator:create <address>`.
8. **Check health** from your machine: `curl -sS https://app.example.com/api/health` must say
   `"status":"ok"` with a 200, without `-k`, which also proves the certificate.
9. **Turn on backups** to an S3 bucket off the server (Hetzner Object Storage works), then rehearse
   a restore once into a spare database. A backup you have never restored is a hope, not a backup
   ([backups](/docs/backups)).

From then on, shipping a change is `deno task deploy` again. It refuses to run with uncommitted
changes, and a failed step leaves the running version up.

## Several products on one server

One proxy serves every project on the server, so a second Seed product on the same machine is a
second folder and a second env file, with its own database and its own ports. The deploy notices
when another project already uses a port and stops before it touches a container. This is how I
run more than one thing on one bill.

## Your turn

Pick the server in the calculator that matches your plan, then follow the [deploy guide](/docs/deploy) with a coffee. If a step in it is unclear, [open an issue](https://github.com/spy4x/seed/issues) and I will fix the guide.
