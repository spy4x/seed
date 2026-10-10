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

- **Postgres** - authoritative store. No PgBouncer; connection pooling is
  handled by the driver.
- **Valkey** - cache for display data (sessions and every authentication decision come from
  Postgres). The host needs `sysctl vm.overcommit_memory=1`. Postgres and Valkey are published on
  `127.0.0.1` only, through `DB_HOST_PORT` and `KV_HOST_PORT`, and Valkey requires `KV_PASSWORD`
  (`--requirepass`; the API sends it with `AUTH` on every connect and reconnect, and neither the API
  nor Valkey starts without it). The password reaches the container through its environment, so it
  is not in the command line; the healthcheck reads it from `REDISCLI_AUTH`.
- **Migrate** - one-shot: runs `deno task db:migrate` in the API's image on every `compose up`,
  then exits. The API and the worker wait for it to exit with 0 (`service_completed_successfully`),
  so a deploy never serves traffic on the old schema, and a failed migration fails the deploy. With
  nothing pending it changes nothing; the runner in `@spy4x/server/db` locks and checksums.
  `tests/compose-migrate.test.ts` holds that order.
- **Worker** - `apps/worker` in the API's image (same Dockerfile and build context) with its own
  command. It drains `outbox_events`, announces committed group changes with `pg_notify` (the API
  turns each into a live hint for other tabs) and sweeps expired idempotency keys hourly. No
  published port. Its pool (at most 10 connections) plus the API's (at most 10, plus one `LISTEN`
  connection) and postgres-exporter stay under Postgres' `max_connections=30`; raise that before
  raising either pool. `WORKER_CPU_LIMIT` and `WORKER_MEM_LIMIT` default to 0.5 CPU and 256M.
- **MinIO** - object storage, with a one-shot configure container.
- **Traefik** - reverse proxy, production compose only.
- **Loki, Prometheus, Grafana, postgres-exporter** - this project's logs and metrics. Loki stores
  what is pushed to it; nothing pushes until Promtail runs.
- **Promtail, node-exporter, cAdvisor** - watch the whole host (all containers' logs, host CPU,
  disk, network). Behind the `host-monitoring` compose profile, off by default so a shared server
  does not get a second copy of its own monitoring. Turn on with
  `COMPOSE_PROFILES=host-monitoring` in the env file; Prometheus keeps their scrape jobs and shows
  them as down while they are off.
- Images are pinned to a version (postgres-exporter to a digest, because upstream never tagged the
  build in use); change a pin on purpose, not by a moving `latest`.
- Traefik router, service and middleware names all end in `-${PROJECT}`.

## Error tracking

Unhandled errors in the browser and in the API reach an error tracker that groups them, shows the
stack trace and alerts. The tracker is [GlitchTip](https://glitchtip.com) (MIT licence, speaks
Sentry's protocol, runs on Postgres and Valkey). Any Sentry-compatible tracker works, because the
app only needs a DSN.

**In the app.** `createErrorReporter` from `@spy4x/platform` is a small reporter that posts Sentry's envelope
format, about 270 lines and no dependency, instead of the 30 KB `@sentry/browser`.

- The SPA reports `error` and `unhandledrejection` events and the errors its `ErrorBoundary`
  catches (`apps/spa/src/error-reporting.ts`). The MPA has no client script, so it reports nothing.
- The API's base middleware (`applyBaseMiddleware` from `@spy4x/server/request-log/base-middleware`) logs and reports every error answered
  with status 500 or more, with the request id, the method and the path. That includes an error a
  route's own `onError` answered; the answer is unchanged. It never sends a query string, a header
  or a body. An `HTTPException` below 500 is an answer, not a failure, and is not reported.
- A report never carries cookies, headers, form values, query strings or fragments. Free text (the
  message, the stack) has URLs cut to their path and values named like `password`, `token`,
  `cookie`, `api_key` or `Bearer …` masked; the rest of an `Authorization`, `Cookie` or
  `Set-Cookie` line, a relative path's query and a bare JWT are masked too. The SPA also masks `/invite/<token>`.
- Reporting is capped (20 reports per page load, 100 per hour in the API process) and fails open: a tracker
  that is down never changes what a person sees.
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
  module off"). Anything else in the
  container's environment is ignored. The file goes to every visitor's browser, so list a public
  value only; `tests/spa-runtime-config.test.ts` fails if a name looks like a secret.
- **Start-up:** nginx's entrypoint runs `apps/spa/runtime-config.sh`, which writes `/tmp/config.json`
  (`/config.json` is a link to it, so the container can run as any user). A variable that is unset
  or empty is left out.
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

CI is Woodpecker. `.woodpecker/ci.yml` runs `deno task check`, the SPA build, the integration
tests against a Postgres service and the `url-filters` browser test on every pull request and every
push to `main`; see [woodpecker-ci-setup.md](woodpecker-ci-setup.md). A `v*` tag publishes the
images (`.woodpecker/release.yml`). Deploys are not wired up (`.woodpecker/deploy.yml.example`).

## Conventions worth keeping

- Authentication at the transport, session strength and cross-cutting checks in
  the CQRS dispatch pipeline, group membership and role in the repository. See
  ADR 002.
- Validate every input server-side; the client is untrusted.
- HTTPS everywhere.
- Standard log fields: `request_id`, `user_id`, `group_id`, route, duration.
- Per-feature security checklist: authentication, authorization, input
  validation, rate limiting.
