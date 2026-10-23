# Development

The local stack beyond the README's quick start, every task, and the browser tests.

## The local stack

Compose joins every service that Traefik routes to a Docker network named `proxy`. `proxy:start` and
`dev` create it when it is missing (`deno task proxy:network` does only that) and leave an existing
one alone, so a fresh machine needs no extra command.

`deno task init` prepares a fresh clone and is safe to run again: it creates `infra/envs/.env`
from the example, replaces each placeholder secret (`KV_PASSWORD`, `GRAFANA_PASS`,
`AUTH_COOKIE_SECRET`, `AUTH_PEPPER`, `SEED_PASSWORD`) with a random one while it still holds the
placeholder, and creates `infra/configs/vapid.json` when it is missing. `--name <name>` sets
`PROJECT` and `--yes` takes the folder's name; both apply only when the env file is created.
`deno task dev` then starts Traefik unless a container named `traefik` already runs, which is left
alone; under Podman it prints the `proxy:start` hint instead.

Metrics and logs go to VictoriaMetrics and VictoriaLogs, with Grafana on top at
`http://localhost:3000` ([Admin consoles](deploy.md#admin-consoles)). `COMPOSE_PROFILES=monitoring`
in the env file runs those three in this project; without it, `VM_REMOTE_WRITE_URL` and `VLOGS_URL`
send the same metrics and logs to a monitoring server you already have.
[The stack guide](stack.md#monitoring) describes both modes. node-exporter and cAdvisor watch the
whole host, so they are off by default: add `host-monitoring` to `COMPOSE_PROFILES` to start them
too.

To try the MPA in Compose, see [The SPA and the MPA](apps.md#the-spa-and-the-mpa). Stop the proxy
with `deno task proxy:stop`. Compose applies pending migrations on every start, in the one-shot
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

To fill a database with the demo data, run `ENV=dev deno task db:seed` with the same values plus
`AUTH_PEPPER` (the API's) and `SEED_PASSWORD` (8 to 50 characters). It adds `admin@example.com`,
an administrator who signs in to the [admin app](apps.md#the-admin-app) with that password and no
second factor, and fake people, groups, tags, notes, invitations and newsletter subscribers. For
the product itself, sign up with an address of your own. Run again, it puts the administrator's
role and proven address right and changes nothing else; when it cannot create an account, it says
so and exits with 1. The public demo runs the same seed every night, without the administrator
([demo.md](demo.md)).

## Tasks

Current tasks come from [`deno.jsonc`](../deno.jsonc).

| Task                         | What it does                                           |
| ---------------------------- | ------------------------------------------------------ |
| `deno task check`            | Lint, format check, type check and unit tests          |
| `deno task test:integration` | Integration tests against your Postgres and Valkey     |
| `deno task e2e`              | Playwright end-to-end tests                            |
| `deno task e2e:local`        | The same tests against a stack of its own              |
| `deno task test:backup`      | Back up and restore a database in its own containers   |
| `deno task test:files`       | The file store against a Garage container of its own   |
| `deno task db:migrate`       | Apply the SQL migrations in `libs/server/db`           |
| `deno task db:reset`         | Drop, migrate and seed a dev database (`ENV=dev` only) |
| `deno task spa:build`        | Build the SPA                                          |
| `deno task admin:build`      | Build the admin app                                    |
| `deno task user:role`        | Give a person a role by their address                  |
| `deno task video:admin`      | Record the website's admin panel video                 |
| `deno task subscribers:send` | Queue an issue for a mailing list (worker container)   |
| `deno task deploy`           | Copy the production files to the server and start them |
| `deno task db:upgrade-18`    | Once per server: move the data from Postgres 16 to 18  |

Run individual app tasks with `api:*`, `spa:*`, `admin:*`, or `mpa:*`. Deno workspace members
inherit shared imports and tooling settings from root `deno.jsonc`.

## Checks

```sh
deno task check
deno task hooks:install   # runs the checks before every commit
```

## Browser tests

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

The specs that start the app with no network, `e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts` and
`e2e/search-offline.e2e.ts`, run against the built SPA, the image a deploy serves, and every other
spec against the dev server ([the offline guide](offline.md), "The app shell", says why). A run that
needs both makes two Playwright passes, the dev server first and then the built SPA in its place, so
`deno task e2e:local` alone still runs every spec. It fails when either pass fails, and its last
lines give the counts of each pass. The report of the second pass is in `e2e/report/offline`, which
`deno task e2e:report` does not open. An argument that is not a spec path goes to both passes.
`E2E_SPA=dev` or `E2E_SPA=built` puts every spec asked for on that one server.

It needs a container tool (`CONTAINER_PROVIDER`, `podman` by default) and the Chromium of the
pinned Playwright. The header of [`infra/scripts/e2e-local.sh`](../infra/scripts/e2e-local.sh) lists
the rest: the environment variables it reads, and the process cap to allow when you run it under
one.

### Which browser tests CI runs

A merge needs the pull-request check, so that check runs a smoke set; the whole suite runs after
the merge. Every step of the pipeline, browser tests or not, is listed in
[the CI guide](woodpecker-ci-setup.md).

| When                    | Step         | Specs                                                    |
| ----------------------- | ------------ | -------------------------------------------------------- |
| Pull request, and a tag | `e2e-smoke`  | The smoke set below (`deno task e2e:local --smoke`)      |
| Push to `main`          | `e2e-full`   | Every `e2e/*.e2e.ts` (`deno task e2e:local`)             |
| All three               | `e2e-mpa`    | The website's `e2e/mpa/*.mpa.ts`                         |
| All three               | `e2e-spa`    | `e2e/spa/*.spa.ts`, on the SPA behind nginx              |
| All three               | `lighthouse` | The website's Lighthouse budget (`deno task lighthouse`) |

The smoke set is `SMOKE_SPECS` in
[`infra/scripts/e2e-local-plan.ts`](../infra/scripts/e2e-local-plan.ts), one line per spec:

- `e2e/auth-profile-ws-push.e2e.ts`: a person signs in through the form, edits the profile and
  signs out;
- `e2e/sign-in-next.e2e.ts`: sign-in from a link to a page, with and without a one-time code;
- `e2e/notes.e2e.ts`: a note is created, edited and deleted, and what a viewer may do;
- `e2e/profile-two-tabs.e2e.ts`: a name saved in one tab shows in another;
- `e2e/groups-pages.e2e.ts`: a group is created, renamed, deleted and restored;
- `e2e/url-filters.e2e.ts`: the filters in the address follow the browser's back and forward.

A screen outside the set (members, invitations, tags, offline, sessions, billing, password reset,
account deletion) is tested only on `main`: a red `e2e-full` there, and a red badge at the top of
the README, means the last merge broke one. It blocks no pull request. Both steps stop early, the
smoke set after three failed tests and the whole suite after ten in a pass, so the list of failures
in a red step may be incomplete: run the specs here for the rest. Before you add a spec to the
set, run it ten times in a row (`deno task e2e:local e2e/<spec> --repeat-each=10`): one that fails
once on a healthy branch blocks every pull request.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rules, and [the handoff](handoff.md) for
the state of the migration and the traps in this codebase. To add a product feature, follow
[the aggregate guide](aggregates.md): it walks through every file of the notes aggregate, in
order.
