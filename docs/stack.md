# Stack, infrastructure and deployment

Replaces the former `3.architecture`, `4.tech-stack`, `5.deployment`,
`6.infrastructure` and `7.recommendations-expanded` files, which were thin
fragments of a numbered series that no longer exists and had drifted from what
the repository actually contains.

Boundaries and transport rules are decided in
[ADR 001](decisions/001-deno-platform-template.md) and
[ADR 002](decisions/002-realtime-transport-and-sync.md). This file only records
what is running and how it is deployed.

## Apps

| App | Stack | Transport |
| --- | ----- | --------- |
| `apps/api` | Deno, Hono | REST plus the `/api/ws` socket for group calls (ADR 002) |
| `apps/spa` | Preact, Vite, PWA | Group, note, profile and push calls over the socket; REST for auth, bootstrap and the pull |
| `apps/mpa` | Fresh | The public website; REST to the API for the newsletter only |
| `apps/worker` | Deno | No inbound transport; drains `outbox_events` |

## Services in compose

Defined in `infra/compose/`:

- **Postgres** - authoritative store.
- **PgBouncer** - pools the API's and the worker's connections to Postgres in transaction mode;
  see "Database connections" below. No published port, on the project's own network only.
- **Valkey** - cache for display data (sessions and every authentication decision come from
  Postgres). The host needs `sysctl vm.overcommit_memory=1`. Postgres and Valkey are published on
  `127.0.0.1` only, through `DB_HOST_PORT` and `KV_HOST_PORT`, and Valkey requires `KV_PASSWORD`
  (`--requirepass`; the API sends it with `AUTH` on every connect and reconnect, and neither the API
  nor Valkey starts without it). The password reaches the container through its environment, so it
  is not in the command line; the healthcheck reads it from `REDISCLI_AUTH`.
- **Garage** - the file store, an S3 server, with the `files` profile: [files.md](files.md).
  Browsers reach its bucket at `https://<DOMAIN>/<bucket>/` with signed URLs; no port is published.
- **Migrate** - one-shot: runs `deno task db:migrate` in the API's image on every `compose up`,
  then exits. The API and the worker wait for it to exit with 0 (`service_completed_successfully`),
  so a deploy never serves traffic on the old schema, and a failed migration fails the deploy. With
  nothing pending it changes nothing; the runner in `@spy4x/server/db` locks and checksums.
  `tests/compose-migrate.test.ts` holds that order.
- **Worker** - `apps/worker` in the API's image (same Dockerfile and build context) with its own
  command. It drains `outbox_events`, announces committed group changes with `pg_notify` (the API
  turns each into a live hint for other tabs) and sweeps expired idempotency keys hourly. No
  published port. It queries through PgBouncer ("Database connections" below). `WORKER_CPU_LIMIT`
  and `WORKER_MEM_LIMIT` default to 0.5 CPU and 256M.
- **Traefik** - reverse proxy, in `infra/compose/compose.proxy.yml`, started by
  `deno task proxy:start` in production and by `deno task dev` locally, unless a container named
  `traefik` already runs (another project's, or a shared one).
- **vmagent, Vector, postgres-exporter** - collect this project's metrics and logs and send them
  on; see "Monitoring" below. They always run, and so does **socket-proxy**, through which Vector
  reads the Docker API ("The Docker socket" below).
- **VictoriaMetrics, VictoriaLogs, Grafana, vmalert, Alertmanager** - store, show and alert on
  them. Behind the `monitoring` compose profile.
- **node-exporter, cAdvisor** - watch the whole host (CPU, disk, network, every container's
  resources). Behind the `host-monitoring` compose profile, off by default so a shared server
  does not get a second copy of its own monitoring. vmagent keeps their scrape jobs and shows
  them as down while they are off.
- Images are pinned to a version tag, and PgBouncer's to a digest too, since every query passes
  through it; change a pin on purpose, not by a moving `latest`. The one moving tag is the nginx
  base of the SPA and admin images (`nginx-unprivileged:stable-alpine`).
- Traefik router, service and middleware names all end in `-${PROJECT}`.

## Database connections

Postgres allows 30 connections (`max_connections=30` in `compose.shared.yml`). Each API process and
the worker keep a pool of up to 10 connections, so a second API replica or a second worker would
use them up. PgBouncer stands between: the apps connect to it, and it shares a fixed number of
connections to Postgres among them, lending one for each transaction.

| Client                           | Connects to | Pool                                      | Why                                                            |
| -------------------------------- | ----------- | ----------------------------------------- | -------------------------------------------------------------- |
| API queries (`sql`)              | PgBouncer   | 10 per API process                        | Ordinary queries and transactions                              |
| Worker                           | PgBouncer   | 10                                        | Ordinary queries; its `pg_notify` runs inside a transaction    |
| API `LISTEN` (`listenSql`)       | Postgres    | 1 per API process                         | A listener needs one session for as long as it runs            |
| `migrate`                        | Postgres    | 1, while it runs                          | The runner's advisory lock belongs to one session              |
| postgres-exporter, backup        | Postgres    | 1 each                                    | Monitoring and `pg_dump`, outside the apps                     |
| PgBouncer to Postgres            | Postgres    | `PGBOUNCER_POOL_SIZE` (20)                | Shared by every API process and worker                         |

PgBouncer accepts up to `PGBOUNCER_MAX_CLIENT_CONN` (200) connections from the apps. 20 to
PgBouncer plus the direct ones leave a few of Postgres' 30 free for a `psql` session; raise
`max_connections` before raising `PGBOUNCER_POOL_SIZE`. The API reads PgBouncer's address from
`DB_HOST` and Postgres' from `DB_DIRECT_HOST` and `DB_DIRECT_PORT`; with those unset, as in the
local browser run and CI, which have no PgBouncer, the listener uses `DB_HOST`.

Transaction mode means a session setting lasts one transaction only: use `SET LOCAL` inside
`sql.begin`, never `SET`, a session advisory lock or `LISTEN` on `sql`. postgres.js prepares every
query by name; PgBouncer tracks those names (`max_prepared_statements=200`, PgBouncer 1.21 and
later) and prepares a statement again on whichever server connection a transaction lands on.
Without it, queries fail with `prepared statement "…" does not exist`. The other way, `prepare:
false` on the client, is not an option `@spy4x/server/db` passes on, and it would plan every query
again on every call.

## Monitoring

The stack is VictoriaMetrics for metrics and VictoriaLogs for logs, the same as the owner's
servers run, with Grafana on top. The API and the worker know nothing about it: they write
their log to standard output, and everything else happens around them.

Two parts always run, in every mode:

- **vmagent** scrapes the targets in `infra/configs/vmagent.yml` (itself, Vector, the Postgres
  exporter, and the bundled VictoriaMetrics, node-exporter and cAdvisor when they run) and pushes
  every sample on, with a `project` label.
- **Vector** reads the log of every container of this Compose project, and of no other container
  on the host, and sends each line on with `project`, `container_name` and `stream`
  (`infra/configs/vector.yml`). It picks them by the label Compose sets
  (`com.docker.compose.project`), which is exact: a project named `app` does not get the logs of
  a project named `app-staging`. It also counts the API's answers from its request log as
  `api_requests_total`, one series per status class (`status="2xx"` to `"5xx"`), because the API
  has no metrics endpoint yet. `tests/monitoring-alerts.test.ts` holds the pattern to the lines
  the API's logger writes.

Where they send is the only difference between the two modes, and the env file alone decides it.

**Bundled** (the default of `infra/envs/.env.example`): `COMPOSE_PROFILES` contains `monitoring`,
and `VM_REMOTE_WRITE_URL` and `VLOGS_URL` are empty. Compose then also runs VictoriaMetrics,
VictoriaLogs, Grafana, vmalert and Alertmanager, and vmagent and Vector send to them. Grafana is on
`127.0.0.1:3000` of the machine, with no public address (docs/deploy.md, "Admin consoles"; user
`admin`, password `GRAFANA_PASS`), with both data sources already there
(`infra/configs/grafana-datasources.yml`); it downloads the VictoriaLogs data source plugin, at the
version pinned in the Compose file, at its first start. Both databases keep 14 days, under
`.volumes/victoriametrics` and `.volumes/victorialogs`.

**External**: take `monitoring` out of `COMPOSE_PROFILES` and name the other server:

```sh
VM_REMOTE_WRITE_URL=https://metrics.example.com/api/v1/write
VM_REMOTE_WRITE_USERNAME=...
VM_REMOTE_WRITE_PASSWORD=...
VLOGS_URL=https://logs.example.com
VLOGS_USERNAME=...
VLOGS_PASSWORD=...
```

The user names and passwords are HTTP basic auth; leave them empty for a server that asks for
none. A password may hold any character. None of the five bundled containers starts; but Compose
does not stop one that is already running when its profile is turned off, so a project that ran
the bundled mode before removes them once, by name:

```sh
deno task compose rm --stop --force victoriametrics victorialogs vmalert alertmanager grafana
```

Their data stays in `.volumes/victoriametrics`, `.volumes/victorialogs` and `.volumes/grafana`. What
vmagent cannot send waits on disk (`.volumes/vmagent`, up to 1 GiB) and is sent when the server is
back; Vector retries too, with a small queue in memory. Grafana, the alert rules and the retention
are then the other server's.

A project started with neither the profile nor the two addresses still runs: vmagent and Vector
keep trying an address that does not exist, and nothing is stored.

### Alerts

Bundled mode only. vmalert evaluates `infra/configs/alerts.yml` every minute:

- **ApiErrors** - the API answered 5 or more requests with a 5xx status within 5 minutes.
- **DataDiskSpaceLow** - the disk holding `.volumes` (Postgres' data too) has under 2 GiB free
  for 10 minutes. VictoriaMetrics reports this about its own storage and vmagent scrapes it, so no
  host exporter is needed.
- **HostDiskSpaceLow** - any disk of the host has under 10% free for 10 minutes. It has data only
  with the `host-monitoring` profile.
- **BackupMissing** - no backup has completed for two days. Vector reads the backup service's
  "Backup done." line; a project without the `backup` profile has no such line and no alert. The
  rule reads the last 14 days, the bundled VictoriaMetrics' retention: 14 days after the last
  complete backup the alert resolves although backups are still stopped, and so does it for a
  project that switches the profile off. `infra/configs/alerts.test.yml` tests
  the rule (CI step `alert-rules`).

Alertmanager sends what fires, and what resolves, to ntfy: `ALERT_NTFY_URL` (the ntfy server),
`ALERT_NTFY_TOPIC` (default `alerts`) and `ALERT_NTFY_TOKEN` (an access token, empty for an open
topic). ntfy formats the message itself (`?template=alertmanager`, ntfy 2.14 or later), and each
message starts with the project's name, so several projects can share a topic. With
`ALERT_NTFY_URL` empty the alerts show in vmalert and Alertmanager and are sent nowhere. In the
external mode, give the same rules file to the other server's vmalert: every series carries the
`project` label.

There is no alert for failing event listeners yet: the API counts them
(`event_listener_failures_total`) but exposes no endpoint to scrape.

### The Docker socket

The Docker socket (`/var/run/docker.sock`) is the whole Docker API. A `:ro` on its mount does not
limit anything: a read-only mount still accepts every call, such as starting a container that
mounts the host's disk. Whoever can call it freely controls the host.

Vector needs the API to find this project's containers and read their logs, in every deployment.
It does not mount the socket. A small proxy, `socket-proxy`
([wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy), one static binary), mounts
it instead and passes on only what Vector's `docker_logs` source calls. Vector reaches the proxy
at `tcp://socket-proxy:2375` (`docker_host` in `infra/configs/vector.yml`).

**What the proxy allows.** `GET`, on exactly these paths, with or without a version prefix such
as `/v1.44`:

| Path                                                 | What it gives                                    |
| ---------------------------------------------------- | ------------------------------------------------ |
| `/_ping`, `/version`                                 | Whether Docker answers, and its version          |
| `/containers/json`                                   | The list of containers                           |
| `/containers/<id>/json`                              | One container's `docker inspect` output          |
| `/containers/<id>/logs`                              | One container's log                              |
| `/events`                                            | Containers starting and stopping, as they happen |

**What it refuses.** Everything else. Every other method (`POST`, `PUT`, `DELETE`, `HEAD`) gets
`405`: no container can be created, started, stopped, killed or removed, no command run in one
(`exec`), no image pulled. Every other `GET` gets `403`: among them `/containers/<id>/archive`
and `/containers/<id>/export`, which read files out of a container, and `/images`, `/volumes`,
`/networks`, `/info` and `/exec`. The whole path must match, so a doubled slash or a `..` after
an allowed path does not get around the list. One `..` does pass the pattern, in the place of an
id (`/containers/../json`); Docker answers it with a redirect to `/json`, which the list refuses.

**What someone who takes over Vector can still do.** Read the log of every container on the host,
not only this project's, and every container's `inspect` output, which includes its environment:
the passwords and keys of this project, and of any other project on the same server. That is
reading, and it is serious; it is no longer control of the host. Vector's own filter
(`include_labels`) is no barrier here, because it runs in the container that was taken over.

The proxy itself holds the whole socket, so it is given as little as possible to be taken over
through. It listens on a network of its own (`docker-socket`, `internal: true`) that only Vector
joins: it is not on the project's network or on `proxy`, has no Traefik label and publishes no
port. That network keeps other containers out, but not the server itself: the host, and so any
process on it, including one of a user outside the `docker` group and a container with host
networking, can connect to an address on a Docker network. So the proxy also checks who is
calling (`-allowfrom=vector`): on each call it looks up the name `vector` and answers that
address only; everyone else gets `403`. What is left is someone who can take Vector's address on
that network, which needs control of Docker or of the host's network already.

It has no Linux capability and cannot gain one (`cap_drop: [ALL]`, `no-new-privileges`), and
its file system is read-only. It runs as root, because the socket belongs to root and the number
of its group differs from host to host; without capabilities, root opens the socket as its owner
and can do little else. SELinux labelling is off for it (`label=disable`), as the socket has no
label a container may use. Vector keeps the same limits, and still runs as root.

Not behind the proxy: Traefik (`infra/compose/compose.proxy.yml`) mounts the socket itself to
read the containers' labels, and with the `host-monitoring` profile the two host exporters mount
the host's file system, where the socket is. `tests/compose-monitoring.test.ts` names these three
and goes red when any other service mounts the socket.

To repeat the refusal check, start the project, then call the proxy from the Vector container,
the only caller it answers (`app` is `PROJECT`):

```sh
call() { docker exec app-vector wget -q -O /dev/null "$@" 2>&1 || true; }
docker exec app-vector wget -qO- http://socket-proxy:2375/containers/json | head -c 80  # a list
call --post-data '{}' http://socket-proxy:2375/containers/create                # 405
call --post-data '' http://socket-proxy:2375/containers/app-vector/start        # 405
call --post-data '' http://socket-proxy:2375/containers/app-vector/stop         # 405
call --post-data '{}' http://socket-proxy:2375/containers/app-vector/exec       # 405
call 'http://socket-proxy:2375/containers/app-vector/archive?path=/etc'         # 403
```

And from the server itself, as a user outside the `docker` group, which must get `403`:

```sh
ip=$(docker inspect app-socket-proxy \
  --format '{{(index .NetworkSettings.Networks "app_docker-socket").IPAddress}}')
sudo -u nobody curl -s -o /dev/null -w '%{http_code}\n' "http://$ip:2375/containers/json"
```

The proxy writes each refused call to its log (`docker logs app-socket-proxy`), with the method
and the path. An empty log there means Vector asks for nothing outside the list.

### Trying the external mode

A second VictoriaMetrics and VictoriaLogs, each asking for a password, stand in for the other
server on the project's own network (`app` is `PROJECT`):

```sh
docker run -d --name other-vm --network app_default victoriametrics/victoria-metrics:v1.146.0 \
  -httpAuth.username=shipper -httpAuth.password=<password>
docker run -d --name other-vl --network app_default victoriametrics/victoria-logs:v1.51.0 \
  -httpAuth.username=shipper -httpAuth.password=<password>
```

Set `COMPOSE_PROFILES=` (without `monitoring`),
`VM_REMOTE_WRITE_URL=http://other-vm:8428/api/v1/write`, `VLOGS_URL=http://other-vl:9428` and the
user name and password in `infra/envs/.env`, run `deno task dev`, open any API address, and after a
minute ask the other server:

```sh
docker exec app-vmagent wget -qO- \
  'http://shipper:<password>@other-vm:8428/api/v1/query?query=api_requests_total'
docker exec app-vmagent wget -qO- \
  'http://shipper:<password>@other-vl:9428/select/logsql/query?query=container_name:app-api&limit=1'
```

Each prints a line of JSON: the counter with `"project":"app"`, and one line of the API's log.
`docker rm -f other-vm other-vl` removes the stand-ins.

## Error tracking

Unhandled errors in the browser and in the API reach an error tracker that groups them, shows the
stack trace and alerts. The tracker is [GlitchTip](https://glitchtip.com) (MIT licence, speaks
Sentry's protocol, runs on Postgres and Valkey). Any Sentry-compatible tracker works, because the
app only needs a DSN.

**In the app.** `createErrorReporter` from `@spy4x/platform` is a small reporter that posts Sentry's
envelope format, about 270 lines and no dependency, instead of the 30 KB `@sentry/browser`.

- The SPA reports `error` and `unhandledrejection` events and the errors its `ErrorBoundary`
  catches (`apps/spa/src/error-reporting.ts`). The MPA has no client script, so it reports nothing.
- The API's base middleware (`applyBaseMiddleware` from `@spy4x/server/request-log/base-middleware`)
  logs and reports every error answered with status 500 or more, with the request id, the method and
  the path. That includes an error a route's own `onError` answered; the answer is unchanged. It
  never sends a query string, a header or a body. An `HTTPException` below 500 is an answer, not a
  failure, and is not reported.
- A report never carries cookies, headers, form values, query strings or fragments. Free text (the
  message, the stack) has URLs cut to their path and values named like `password`, `token`,
  `cookie`, `api_key` or `Bearer …` masked; the rest of an `Authorization`, `Cookie` or
  `Set-Cookie` line, a relative path's query and a bare JWT are masked too. The SPA also masks
  `/invite/<token>`.
- Reporting is capped (20 reports per page load, 100 per hour in the API process) and fails open: a
  tracker that is down never changes what a person sees.
- **No DSN, no reporting:** with `ERROR_REPORT_DSN` (API) and `SPA_ERROR_REPORT_DSN` (browser,
  read at container start) empty, nothing is sent and no request is made. A browser DSN is
  public by design; give the SPA its own GlitchTip project so a leaked key can only add noise.

**Where GlitchTip runs.** Both layouts need only the two DSN variables.

| Layout | Use when | Cost |
| ------ | -------- | ---- |
| External, one instance shared by several projects | You run more than one project on a host. The default. | One more thing to keep up, shared by all |
| Bundled, an optional Compose profile of this project | One project runs alone on its host | Its own web and worker containers, and a database and cache of its own |

The bundled profile is not in `infra/compose` yet: this template does not deploy GlitchTip. To
bring one up, use GlitchTip's own Compose file, point its database at this project's Postgres (a
separate database and user) and its cache at Valkey, and put it behind Traefik with the same router
pattern as Grafana. Create two projects (API, SPA) and put their DSNs in the env file.

**Source maps.** The SPA build does not produce source maps, so a browser stack trace shows the
minified bundle. To get readable traces: set `build.sourcemap: "hidden"` in
`apps/spa/vite.config.ts`, upload `apps/spa/dist/**/*.map` for the release with `sentry-cli
sourcemaps upload` (GlitchTip accepts it) in the deploy step, and delete the `.map` files before
the image is built, so they are never served. The release name must match the `release` option of
the reporter, which the SPA does not set yet. This is not wired in: it needs a running GlitchTip to
verify.

## Runtime configuration

One built SPA image serves every environment. Settings that differ between environments are not
baked into the build; the container writes them to `/config.json` when it starts.

- **The allow list:** `apps/spa/public-env.allow` names the only container variables that reach the
  file (`SPA_ENV` as `env`, `SPA_ERROR_REPORT_DSN` as `errorReportDsn`, and the module switches
  `SPA_REALTIME` as `realtime` and `SPA_OFFLINE` as `offline`; `docs/offline.md`, "Switching a
  module off"; and `SPA_DEMO` as `demo`, set from `DEMO_MODE`; `docs/demo.md`). Anything else in the
  container's environment is ignored. The file goes to every visitor's browser, so list a public
  value only; `tests/spa-runtime-config.test.ts` fails if a name looks like a secret.
- **Start-up:** nginx's entrypoint runs `apps/spa/runtime-config.sh`, which writes
  `/tmp/config.json` (`/config.json` is a link to it, so the container can run as any user). A
  variable that is unset or empty is left out.
- **In the app:** `apps/spa/src/runtime-config.ts` fetches the file before the first render and
  checks it with an arktype schema. A missing or invalid file gives the defaults (no error tracker)
  and a console warning, never a blank page.
- **Offline:** the service worker stores `/config.json` with the app shell and answers from that
  copy when the network fails (`docs/offline.md`, "The app shell").
- **The content security policy:** the same start-up runs `apps/spa/csp-connect.sh`, which lets the
  page post to the origin of `SPA_ERROR_REPORT_DSN` and to no other site
  ([security-headers.md](security-headers.md)).
- **Adding a setting:** add a line to the allow list, a key to the schema, and pass the variable to
  the `spa` service in `infra/compose/compose.shared.yml`. Changing a value needs a container
  restart, not a rebuild.
- **Development:** the Vite dev server serves the committed `apps/spa/public/config.json`; edit it
  locally (do not commit a DSN) to try a setting.

## Deployment

Docker Compose for both local development and single-node production. Scaling is
vertical, through per-service resource limits.

CI is Woodpecker: `.woodpecker/ci.yml` on every pull request, push to `main` and version tag. Its
steps are listed once, in [woodpecker-ci-setup.md](woodpecker-ci-setup.md). A `v*` tag also
publishes the images (`.woodpecker/release.yml`). Deploys are not wired up
(`.woodpecker/deploy.yml.example`).

## Conventions worth keeping

- Authentication at the transport, session strength and cross-cutting checks in
  the CQRS dispatch pipeline, group membership and role in the repository. See
  ADR 002.
- Validate every input server-side; the client is untrusted.
- HTTPS everywhere.
- Standard log fields: `request_id`, `user_id`, `group_id`, route, duration.
- Per-feature security checklist: authentication, authorization, input
  validation, rate limiting.
