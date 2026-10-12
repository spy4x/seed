<div align="center">

# template

**A SaaS starting point on web standards: sign-up with a second factor, groups, billing, an API, a
web app, a worker and Postgres. Work in progress: parts of the worker are not built yet.**

[![CI](https://ci.antonshubin.com/api/badges/11/status.svg)](https://ci.antonshubin.com/repos/11)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

```sh
gh repo create my-product --template spy4x/template --private --clone
```

<img src="docs/screenshots/sign-up-flow.gif" alt="A new user signs up with a username and password, lands on the profile page with the realtime connection open, types the first name Alex and the last name Rivera, and saves; a green toast confirms the profile was updated." width="800">

[Architecture](docs/architecture.md) · [ADR 001](docs/decisions/001-deno-platform-template.md) ·
[ADR 002](docs/decisions/002-realtime-transport-and-sync.md) ·
[ADR 003](docs/decisions/003-swappable-transport-and-local-data.md) · [Stack](docs/stack.md) ·
[Deno policy](docs/deno-policy.md) · [Adding an aggregate](docs/aggregates.md) · [Billing](docs/billing.md) ·
[Handoff](docs/handoff.md)

</div>

Create your repository from it, fill in the env file, and you start with a product that already
has accounts, a second factor, tenancy and a place for background work. A new user signs up and
gets an account, a session and a first group in one database transaction. Groups are the only
tenancy boundary, so the same membership checks and roles cover a person's own data and
shared workspaces.

It exists because every SaaS MVP needs the same groundwork before its first feature. The reusable
parts live here and in the published [`@spy4x/*`](https://jsr.io/@spy4x) packages; product rules
stay out.

**Status:** work in progress, moving to the target architecture in
[ADR 001](docs/decisions/001-deno-platform-template.md). Sign-up, sign-in with TOTP, groups with
members, roles, invitations and ownership transfer, billing per member, notes (the reference
aggregate), the outbox worker and the public website work today, and the SPA works offline
([docs/offline.md](docs/offline.md)). Parts of the worker are not built yet. Details in
[docs/architecture.md](docs/architecture.md#migration-status). The live demo runs at
https://template.antonshubin.com, its website at https://template-mpa.antonshubin.com.

## Quick start

```sh
cp infra/envs/.env.example infra/envs/.env
```

Before going on, fill in the secrets in `infra/envs/.env` (`KV_PASSWORD` is the Valkey password;
Valkey and the API both refuse to start without it, `openssl rand -hex 24` makes one). It runs on
Docker; to use Podman, set `CONTAINER_PROVIDER=podman` (`proxy:start` and `proxy:stop` still call
Docker).

```sh
deno task vapid-key:create   # web push keys → infra/configs/vapid.json
deno task proxy:start        # Traefik
deno task dev                # Postgres, Valkey, MinIO, API, worker, SPA, Loki, Prometheus, Grafana
```

Compose joins every service that Traefik routes to a Docker network named `proxy`. `proxy:start` and
`dev` create it when it is missing (`deno task proxy:network` does only that) and leave an existing one
alone, so a fresh machine needs no extra command.

Then open `http://<DOMAIN>` from the env file: http://app.localhost with the values in
`infra/envs/.env.example`.

Promtail, node-exporter and cAdvisor watch the whole host, so they are off by default. Set
`COMPOSE_PROFILES=host-monitoring` in the env file to start them too.

To try the MPA in Compose, see "The SPA and the MPA" below. Stop the proxy with
`deno task proxy:stop`. Compose applies pending migrations on every start, in the one-shot
`migrate` service that the API and the worker wait for; a failed migration stops the start. To apply
them from the host instead, for an API run outside Compose, use the values from your `.env` and the
port Compose publishes:

```sh
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> deno task db:migrate
```

To start again from an empty development database, run `ENV=dev deno task db:reset` with the same
values (plus the seed's `AUTH_PEPPER` and `SEED_PASSWORD`). It drops the database, migrates it and
seeds it, after you confirm; `--yes` skips the question. It refuses unless `ENV=dev`, `DB_HOST` is
`localhost`, `127.0.0.1` or `db`, and `DB_NAME` differs from the one in `infra/envs/.env.prod`. A
missing or unreadable `.env.prod` also refuses; on a machine without one, add `--no-prod-check`.
A missing `DB_PORT`, `DB_USER` or `DB_PASS`, or a missing or invalid `AUTH_PEPPER` or
`SEED_PASSWORD`, refuses too, before anything is dropped.

To add a demo user who signs in as `demo@example.com` and owns the group `Demo team`, run
`ENV=dev deno task db:seed` with the same values plus `AUTH_PEPPER` (the API's) and `SEED_PASSWORD`
(the demo user's password, 8 to 50 characters). It runs only with `ENV=dev`. Run again, it finds
the user and changes nothing; when it cannot create the user, it says so and exits with 1.

## What a fresh project looks like

| Light                                                                                                                                                                                                 | Dark                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <img src="docs/screenshots/sign-in-light.png" alt="The sign-in page in the light theme: a card titled Welcome back with username and password fields, a Sign in button and a link to sign up.">       | <img src="docs/screenshots/sign-in-dark.png" alt="The sign-in page in the dark theme: a card titled Welcome back with username and password fields, a Sign in button and a link to sign up.">       |
| <img src="docs/screenshots/profile-light.png" alt="The profile page in the light theme for the demo user Alex Rivera: name fields with a Save button, a change-password card and a two-factor card."> | <img src="docs/screenshots/profile-dark.png" alt="The profile page in the dark theme for the demo user Alex Rivera: name fields with a Save button, a change-password card and a two-factor card."> |

The screenshots and the GIF use a throw-away database and a made-up user;
[`docs/screenshots/record.ts`](docs/screenshots/record.ts) records them again from a running app.

<details>
<summary>How the parts fit together</summary>

<img src="docs/architecture.svg" alt="Architecture diagram. Clients: apps/spa, a Preact and Vite PWA with sign-up, sign-in, TOTP and profile, talks to apps/api over REST and WebSocket; an IndexedDB offline store keeps the last notes and groups and queues writes made offline. apps/mpa is the public website on Fresh, server-rendered, calling the API only for the newsletter. Servers: apps/api on Hono (auth, groups, CQRS dispatch, web push) and apps/worker, which drains outbox_events. Data: Postgres is authoritative and Valkey is the API cache; Docker Compose also runs Traefik, MinIO, Loki, Prometheus and Grafana. Shared code: libs/domain, libs/server, libs/ui and the @spy4x packages on JSR." width="860">

</details>

## Why template

- **Tenancy from day one.** Every user gets a group at sign-up; every group uses the same IDs,
  membership checks and roles, from viewer to owner. A group can be renamed, deleted and, for 30
  days, restored, and a person always keeps at least one.
- **Auth that is done.** Sign-up, sign-in, sessions and an authenticator-app second factor, with
  PBKDF2-SHA-256 password hashes. Web push subscriptions are built in too.
- **Offline-first SPA.** The SPA keeps the last notes and groups in IndexedDB (the shared data cache), opens with no
  network, and queues note writes with their idempotency keys. It sends them on reconnect and
  shows a stale write as a conflict to settle, never as a silent overwrite. The layer sits in one
  folder, so a product that does not want it deletes the folder and keeps an online SPA:
  [docs/offline.md](docs/offline.md).
- **Mailing lists.** Visitors subscribe at `/subscribe` with double opt-in, and every list mail
  carries a one-click unsubscribe. The worker signs the links with `SUBSCRIBERS_SECRET` and sends
  the confirm, welcome and issue mail: [docs/architecture.md](docs/architecture.md#mail-subscriptions).
- **CQRS with an outbox.** Commands, queries and events go through one bus. Creating a shared
  group writes its event to `outbox_events`, and the worker drains that table.
- **Safe API defaults.** Every mutation must come from the web app's own origin, and group lists
  page with HMAC-signed cursors.
- **Built on web standards.** Hono handlers take a Fetch `Request` and return a `Response`;
  password hashes and cursor signatures use Web Crypto; live updates travel over a standard
  WebSocket; everything is an ES module. The servers run on Deno 2 in Docker on any Linux host you
  control, and the clients run in any modern browser.
- **Operations included.** Docker Compose for development and single-node production: Traefik,
  Postgres, Valkey, MinIO, Loki, Prometheus and Grafana.

**Use it if** you are starting a multi-user web product and want auth, tenancy and operations
settled before the first feature. **Skip it if** you deploy to serverless functions rather than a server
you run.

## The SPA and the MPA

The template ships two web apps over the same API, with different jobs.

- **The SPA** (`apps/spa`, Preact and Vite) is the product. Everything a signed-in person does
  happens there: sign-up and sign-in, notes, groups, billing, the profile. People see each other's
  changes live over a WebSocket ([ADR 002](docs/decisions/002-realtime-transport-and-sync.md)), and
  it works offline ([docs/offline.md](docs/offline.md)). Compose serves it at `DOMAIN`.
- **The MPA** (`apps/mpa`, Fresh) is the product's public website: the home page, pricing read
  from the `PLANS` catalog, privacy and terms pages to adapt, `robots.txt`, `sitemap.xml` and the
  newsletter. Every page is rendered on the server and works with JavaScript turned off. It has
  no session; its sign-in and sign-up links open the SPA at `DOMAIN`.

The MPA calls the API over HTTP from the server, only for the newsletter, and never touches the
database itself. It needs `ENV` and `DOMAIN` (the same values as the API), its own host
`MPA_DOMAIN`, and `API_URL`, the address the MPA's server reaches the API at, such as
`http://<PROJECT>-api:8000` (Compose sets it); it refuses to start without any of them. To deploy it, set
`COMPOSE_PROFILES=mpa` in the env file (join it with other profiles by commas) and `MPA_DOMAIN` to
the website's own host, then run `deno task deploy` as usual: Compose builds the `mpa` service from
`apps/mpa/dockerfile.prod` and serves it at `MPA_DOMAIN`, next to the SPA at `DOMAIN`. The API
accepts a form only from `http(s)://DOMAIN`, so the MPA, after refusing any post that does not come
from its own pages, presents its posts to the API with `DOMAIN`'s origin. `MPA_DOMAIN` needs a DNS
record pointing at the server; Traefik gets its certificate as for `DOMAIN`. The API and the worker
read `MPA_DOMAIN` too: when it is set, the newsletter's mailed confirm and unsubscribe links open
the website's pages, which work without JavaScript, so set it only together with the profile.
Without it the links open the SPA. Without the profile nothing about the deploy changes. The MPA's
end-to-end test runs in CI on every pull
request, and locally with `e2e/mpa/run.sh` against a running Postgres and Valkey (see the header
of that script).

## Production certificates

The production routers ask Traefik for certificates from the resolver named by
`TRAEFIK_CERT_RESOLVER` (default `myresolver`). `infra/compose/compose.proxy.yml` defines that
resolver: Let's Encrypt, HTTP challenge on port 80, certificates stored in
`.volumes/traefik/letsencrypt/acme.json`, expiry notices to `TRAEFIK_ACME_EMAIL`. Point `DOMAIN` at
the server and run `deno task proxy:start` there.

Plain `http://<DOMAIN>` (and `http://<MPA_DOMAIN>` with the `mpa` profile) answers a permanent
redirect to HTTPS. The proxy serves nothing of its own but `/ping`: Traefik's dashboard and API are
off, because they list every router and backend address of every project behind the proxy.

**A server deployed before these changes needs three things once**, and its next deploy does
more than usual:

1. A server that runs Podman needs `CONTAINER_PROVIDER=podman` in its env file. Without that line
   the deploy used to run Podman and now runs Docker: it fails at "Starting the app" and the old
   containers stay up. Any other value than `docker` or `podman` is refused.
2. Run `deno task proxy:start` on it: `deno task deploy` restarts the app's containers but never
   the proxy, so the proxy that is already running keeps serving its dashboard at
   `proxy.<DOMAIN>` until then.
3. The next deploy publishes Grafana on `127.0.0.1:3000` and the MinIO console on
   `127.0.0.1:9001`; when something on the server already uses one of them, the deploy fails with
   "port is already allocated". Set `GRAFANA_HOST_PORT` or `MINIO_CONSOLE_HOST_PORT` in the env
   file to a free `127.0.0.1:<port>` first ([Admin consoles](#admin-consoles)).

That deploy also recreates the project's network, which no longer has a fixed subnet, so every
container restarts once, the database included: expect a short outage, not the usual restart of
the app alone. The base image is now named `<PROJECT>/deno-base`; the old `app/deno-base` image
stays on the server until you remove it (`docker image rm app/deno-base:<version>`).

`deno task deploy [env file]` reads the server from the env file (`infra/envs/.env.prod` unless you
name another): `SSH_TO_SERVER`, `PATH_ON_SERVER` and, when Deno is not on the server's `PATH`,
`DENO_ON_SERVER`. `infra/envs/.env.example` lists them with every other name. The copy replaces
every server file that differs from your checkout, one edited on the server or newer there too, and
deletes the ones your checkout no longer has; env files and the web push keys are never touched. So
deploying an older commit is a full rollback of the code. It does not roll back the database.

**A server that ran Postgres 16 moves its data once.** The Compose file runs Postgres 18, which
keeps its data in a directory of its own, so the first deploy of this version stops at "Starting
the app" with a message that says why, and the old containers keep serving. Run
`deno task db:upgrade-18` on the server to move the data and finish the deploy:
[docs/postgres-18-upgrade.md](docs/postgres-18-upgrade.md) has the steps, the outage to expect and
the way back.

`deno task deploy` needs no manual step on a new server: it creates `infra/configs/vapid.json`
(the web push keys) there when the file is missing, readable by its owner only. It never sends the
key from your machine and never replaces one that exists. It stops before sending anything when a
password or secret in the env file equals one that `infra/envs/.env.example` prints (those values
are public), or when one that the example file sets is empty or missing, and names each such
variable. It reads the example file for that, so keep the file. Router, service and middleware names
carry `${PROJECT}`, so projects with different `PROJECT` values can share one Traefik. Postgres and
Valkey stay on `127.0.0.1`. Every image has a pinned version.

The template usually deploys behind a Traefik that several projects share. If that Traefik already
defines a resolver, do not start the proxy compose file: set `TRAEFIK_CERT_RESOLVER` to the name it
defines. If that Traefik defines none, copy the three `--certificatesresolvers.*` flags from
`compose.proxy.yml` into its command.

## Sign in with Google and GitHub

Both are off until you set their credentials: the sign-in and sign-up pages then show a "Continue
with …" link for each provider that is on, and the profile gets a "Sign-in methods" card. A
provider is on only when both of its variables are set in the env file.

| Provider | Where to register                                                         | Variables                                  | Callback URL to register                    |
| -------- | ------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Google   | Google Cloud console, "APIs & Services", "Credentials", "OAuth client ID" | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `https://<DOMAIN>/api/auth/google/callback` |
| GitHub   | GitHub, "Settings", "Developer settings", "OAuth Apps", "New OAuth App"   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | `https://<DOMAIN>/api/auth/github/callback` |

For Google choose the application type "Web application"; the scopes asked for are `openid` and
`email`. GitHub is asked for `read:user` and `user:email`. On your own machine the callback is
`http://app.localhost/api/auth/<provider>/callback`; register it as a second callback URL (Google)
or in a second OAuth App (GitHub allows one callback per app).

What a person gets:

- Someone the provider already signs in here is signed in. An account with an authenticator app is
  still asked for its code.
- Someone new is asked "Create a new account?" first, and nothing is created until they answer.
  The question waits 10 minutes; "I already have an account" creates nothing.
- When an account here already uses that address with a password but never confirmed it, the
  question says so first: creating the new account locks the old one (its password stops working),
  because the provider has proven who owns the address. The old account gets an audit row.
- A provider account joins an existing account by its e-mail address only when both sides have
  verified that address. An address the provider has not verified never links: that person is
  asked whether to create a new account, like anyone unknown.
- On the profile, a person links and unlinks providers. A provider account links whatever its
  e-mail address, and linking never changes another person's confirmed account; one that already
  signs in to another account here is refused, and the page says so. The last way into an account
  cannot be unlinked, and unlinking a method signs out the devices that signed in with it.
- Linking differs from signing up in one case. When the provider has verified an address that
  another account here uses with a password but never confirmed, the link locks that account, as
  creating a new account would, and it gets the same audit row. The person linking is not warned
  first: a link has no question page.
- The sign-in page says how the person last signed in on this browser, with most of the address
  hidden ("Last time you signed in with Google (a\*\*\*@example.com)"), and "Not you? Forget"
  removes it. Only the method's name and the masked address are kept, in the browser's storage,
  and only after a finished sign-in.
- An account made with a provider has no password. It cannot change its address, set a password
  or delete itself yet, because each asks for the password; its profile shows the provider's
  address, offers none of the three and says why.

## Admin consoles

The MinIO console and Grafana have no public address. Each is published on the machine's own
address only: the MinIO console on `127.0.0.1:9001` (sign in with `MINIO_USER` and `MINIO_PASS`),
Grafana on `127.0.0.1:3000` (`admin` and `GRAFANA_PASS`). On your own machine open
`http://localhost:9001` or `http://localhost:3000`. On a server, open a tunnel first:

```sh
ssh -L 9001:127.0.0.1:9001 -L 3000:127.0.0.1:3000 <SSH_TO_SERVER>
```

When a port is taken, set `MINIO_CONSOLE_HOST_PORT` or `GRAFANA_HOST_PORT` in the env file to
another `127.0.0.1:<port>`. Never publish either on `0.0.0.0`.

## Several projects on one server

Products made from this template can share a server and its Traefik. Each lives in its own
directory, so each has its own data under `.volumes/`. In the env file of every project after the
first, change:

- `PROJECT`: containers, the project's network, its base image and its Traefik routers are named
  after it. Lowercase letters, digits and dashes.
- `DOMAIN`, and `MPA_DOMAIN` with the `mpa` profile.
- the four ports published on `127.0.0.1`: `DB_HOST_PORT`, `KV_HOST_PORT`,
  `MINIO_CONSOLE_HOST_PORT` and `GRAFANA_HOST_PORT`. A port another project holds stops
  `compose up` with "port is already allocated".

The engine gives every project's network a free subnet, and each project's database, Valkey,
MinIO and monitoring are on that network only. Two things are shared. The proxy: start it once per
server, not per project. And the `proxy` network, which the API, the SPA and the website of every
project join so that Traefik can reach them: a container on it can open any project's API
directly, without passing the proxy. So share a server only between projects you trust alike. On
that network a project addresses its own services by container name (`<PROJECT>-api`,
`<PROJECT>-db`), never by a plain service name such as `api`, which any project would answer.

With the `host-monitoring` profile, turn it on in one project only: its containers watch the whole
host.

## Tasks

Current tasks come from [`deno.jsonc`](deno.jsonc).

| Task                         | What it does                                           |
| ---------------------------- | ------------------------------------------------------ |
| `deno task check`            | Lint, format check, type check and unit tests          |
| `deno task test:integration` | Integration tests against your Postgres and Valkey     |
| `deno task e2e`              | Playwright end-to-end tests                            |
| `deno task e2e:local`        | The same tests against a stack of its own              |
| `deno task db:migrate`       | Apply the SQL migrations in `libs/server/db`           |
| `deno task db:reset`         | Drop, migrate and seed a dev database (`ENV=dev` only) |
| `deno task spa:build`        | Build the SPA                                          |
| `deno task subscribers:send` | Queue an issue for a mailing list (worker container)   |
| `deno task deploy`           | Copy the production files to the server and start them |
| `deno task db:upgrade-18`    | Once per server: move the data from Postgres 16 to 18  |

Run individual app tasks with `api:*`, `spa:*`, or `mpa:*`. Deno workspace members inherit shared
imports and tooling settings from root `deno.jsonc`.

## Development

```sh
deno task check
deno task hooks:install   # runs the checks before every commit
```

### Browser tests

`deno task e2e` runs the Playwright specs in `e2e/` against the stack `deno task dev` started, at
`http://app.localhost`. `deno task e2e:local` runs the same specs without that stack: it starts
its own Postgres and Valkey containers, the API, the worker, the SPA and a proxy on spare ports,
and removes all of them when it ends or is stopped.

```sh
deno task e2e:local                        # every spec
deno task e2e:local e2e/sessions.e2e.ts    # one spec; add :42 for the test at that line
deno task e2e:local -g "signing another"   # any other argument goes to Playwright as it is
deno task e2e:report                       # open the report of the last run
```

The two specs that start the app with no network, `e2e/offline.e2e.ts` and
`e2e/local-data.e2e.ts`, run against the built SPA, the image a deploy serves, and every other spec
against the dev server ([docs/offline.md](docs/offline.md), "The app shell", says why). A run that
needs both makes two Playwright passes, the dev server first and then the built SPA in its place,
so `deno task e2e:local` alone still runs every spec. It fails when either pass fails, and its last
lines give the counts of each pass. The report of the second pass is in `e2e/report/offline`, which
`deno task e2e:report` does not open. An argument that is not a spec path goes to both passes.
`E2E_SPA=dev` or `E2E_SPA=built` puts every spec asked for on that one server.

It needs a container tool (`CONTAINER_PROVIDER`, `podman` by default) and the Chromium of the
pinned Playwright. The header of [`infra/scripts/e2e-local.sh`](infra/scripts/e2e-local.sh) lists
the rest: the environment variables it reads, and the process cap to allow when you run it under
one.

#### Which browser tests CI runs

A merge needs the pull-request check, so that check runs a smoke set; the whole suite runs after
the merge.

| When                    | Step        | Specs                                                      |
| ----------------------- | ----------- | ---------------------------------------------------------- |
| Pull request, and a tag | `e2e-smoke` | The smoke set below (`deno task e2e:local --smoke`)        |
| Push to `main`          | `e2e-full`  | Every `e2e/*.e2e.ts` (`deno task e2e:local`)               |
| All three               | `e2e-mpa`   | The website's `e2e/mpa/*.mpa.ts`                           |
| All three               | `e2e-spa`   | `e2e/spa/security-headers.spa.ts`, on the SPA behind nginx |

The smoke set is `SMOKE_SPECS` in
[`infra/scripts/e2e-local-plan.ts`](infra/scripts/e2e-local-plan.ts), one line per spec:

- `e2e/auth-profile-ws-push.e2e.ts`: a person signs in through the form, edits the profile and
  signs out;
- `e2e/sign-in-next.e2e.ts`: sign-in from a link to a page, with and without a one-time code;
- `e2e/notes.e2e.ts`: a note is created, edited and deleted, and what a viewer may do;
- `e2e/profile-two-tabs.e2e.ts`: a name saved in one tab shows in another;
- `e2e/groups-pages.e2e.ts`: a group is created, renamed, deleted and restored;
- `e2e/url-filters.e2e.ts`: the filters in the address follow the browser's back and forward.

A screen outside the set (members, invitations, tags, offline, sessions, billing, password reset,
account deletion) is tested only on `main`: a red `e2e-full` there, and a red badge at the top of
this page, means the last merge broke one. It blocks no pull request. Both steps stop early, the
smoke set after three failed tests and the whole suite after ten in a pass, so the list of failures
in a red step may be incomplete: run the specs here for the rest. Before you add a spec to the
set, run it ten times in a row (`deno task e2e:local e2e/<spec> --repeat-each=10`): one that fails
once on a healthy branch blocks every pull request.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules, and [docs/handoff.md](docs/handoff.md) for
the state of the migration and the traps in this codebase. To add a product feature, follow
[docs/aggregates.md](docs/aggregates.md): it walks through every file of the notes aggregate, in
order.

## Releases

A version tag on `main` publishes the images to Docker Hub as `<IMAGE_PREFIX>-api`, `-spa` and
`-mpa` (the worker runs the API image); `IMAGE_PREFIX` is set in
[`.woodpecker/release.yml`](.woodpecker/release.yml). To cut a release:

```sh
git switch main && git pull --ff-only   # the tag must point at a commit on main
git tag v1.2.3                          # v1.2.3-rc.1 publishes that tag only, never `latest`
git push origin v1.2.3
```

The pipeline refuses a tag whose commit is not on `main`. Setup and the steps:
[docs/woodpecker-ci-setup.md](docs/woodpecker-ci-setup.md#releases).

## Built by

I'm [Anton Shubin](https://antonshubin.com), a senior full-stack engineer and tech lead. This
template is the foundation I build client SaaS MVPs on. Need an MVP built for your product?
[That's my day job →](https://antonshubin.com/catalog/zero-to-production-saas-mvp)

Licensed under [MIT](LICENSE). Copyright (c) 2026 Anton Shubin.

---

Made by Anton Shubin · [antonshubin.com/tools/template](https://antonshubin.com/tools/template)
