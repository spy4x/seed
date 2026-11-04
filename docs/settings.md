# Settings

> Also on the website: [seedsaas.com/docs/settings](https://seedsaas.com/docs/settings).

Every variable of the env file, `infra/envs/.env.example`, in the file's own groups.

`deno task init` copies the example to `infra/envs/.env` for development and generates its secrets.
A server reads `infra/envs/.env.prod`, which the deploy copies there
([Deploy to a server](deploy.md#the-env-file)).
"Empty" means the line is there with no value. A value in the example column is a placeholder or a
default, never a value to keep for a secret.

## Project and hosts

| Variable               | What it does                                                                                                 | Example            | Guide                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------- |
| `PROJECT`              | Names the containers, the network, the base image and the Traefik routes. Lowercase letters, digits, dashes. | `app`              | [Several projects](several-projects.md)        |
| `ENV`                  | `dev` or `prod`. A deploy refuses anything but `prod`.                                                       | `dev`              | [Deploy](deploy.md)                            |
| `CONTAINER_PROVIDER`   | The container engine: `docker` or `podman`. Empty means Docker; anything else is refused.                    | `docker`           | [Deploy an update](deploy-updates.md)          |
| `DOMAIN`               | The product's host: the SPA, the API and the bundled file store.                                             | `app.localhost`    | [Deploy](deploy.md#dns)                        |
| `DEV_EMAIL`            | The contact address sent with web push messages. The API refuses to start without it.                        | `dev@example.com`  |                                                |
| `DENO_LOG`             | How much the API and the worker log: `info`, or `debug`, which logs every request.                           | `info`             | [Load tests](load-tests.md)                    |
| `COMPOSE_BAKE`         | Docker Compose's own setting: build the images with Bake.                                                    | `true`             |                                                |
| `COMPOSE_PROFILES`     | The optional parts Compose starts, comma-separated. The profiles are below.                                  | `monitoring,files` |                                                |
| `MPA_DOMAIN`           | The website's host, with the `mpa` profile. The API and the worker link to it; empty without the website.    | empty              | [The three apps](apps.md#deploy-the-website)   |
| `MPA_REDIRECT_RULE`    | Production only: a Traefik rule for hosts redirected to `MPA_DOMAIN`. Empty matches nothing.                 | empty              | [Certificates](certificates.md)                |
| `MPA_UMAMI_ORIGIN`     | The website's self-hosted Umami. Set both Umami values or neither.                                           | empty              | [Analytics](analytics.md)                      |
| `MPA_UMAMI_WEBSITE_ID` | The website's id in that Umami. It is public.                                                                | empty              | [Analytics](analytics.md)                      |
| `INDEXNOW_KEY`         | The website's IndexNow key, 8 to 128 letters, digits and dashes. Public. Empty turns IndexNow off.           | empty              | [Blog](blog.md#indexnow)                       |
| `DEVTO_API_KEY`        | A Dev.to API key, read by the worker. Secret. Set, it copies each live post to Dev.to once. Empty turns it off. | empty              | [Blog](blog.md#the-devto-cross-post)           |
| `ADMIN_DOMAIN`         | The admin app's host, with the `admin` profile. Empty turns the operator area off.                           | `admin.localhost`  | [The three apps](apps.md#deploy-the-admin-app) |

| Profile           | What it starts                                                                   | Guide                                   |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| `monitoring`      | This project's VictoriaMetrics, VictoriaLogs, Grafana, vmalert and Alertmanager. | [The stack](stack.md#monitoring)        |
| `host-monitoring` | node-exporter and cAdvisor, which watch the whole host. One project per server.  | [Several projects](several-projects.md) |
| `mpa`             | The public website at `MPA_DOMAIN`.                                              | [The three apps](apps.md)               |
| `admin`           | The admin app at `ADMIN_DOMAIN`.                                                 | [The three apps](apps.md)               |
| `backup`          | The daily backup. Needs the backup variables.                                    | [Backups](backups.md)                   |
| `files`           | The bundled file store, Garage. Leave it out to use another S3 store.            | [Files](files.md)                       |

## Database

| Variable                                     | What it does                                                                              | Example      | Guide                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------ | ------------------------------------------ |
| `DB_CPU_LIMIT`, `DB_MEM_LIMIT`               | Postgres's CPU and memory limit.                                                          | `2`, `2048m` | [Capacity](capacity.md)                    |
| `DB_SHARED_BUFFERS`                          | Postgres's shared buffers. About a quarter of `DB_MEM_LIMIT`.                             | `512MB`      |                                            |
| `DB_WORK_MEM`                                | Memory per sort or hash, per connection.                                                  | `16MB`       |                                            |
| `DB_MAINTENANCE_WORK_MEM`                    | Memory for vacuum and index builds.                                                       | `128MB`      |                                            |
| `DB_EFFECTIVE_CACHE_SIZE`                    | What the planner assumes the cache holds. About three quarters of the limit.              | `1536MB`     |                                            |
| `DB_AUTOVACUUM_WORK_MEM`                     | Memory per autovacuum worker.                                                             | `128MB`      |                                            |
| `DB_HOST`, `DB_PORT`                         | Where tasks you run outside Compose reach Postgres. Compose sets its own inside.          | `db`, `5432` | [Development](development.md)              |
| `DB_NAME`                                    | The database's name.                                                                      | `app`        | [Restore](restore.md)                      |
| `DB_USER`                                    | The database user. PgBouncer logs in with it too.                                         | `app`        |                                            |
| `DB_PASS`                                    | The database password. PgBouncer logs in with it too.                                     | secret       | [Deploy](deploy.md#the-env-file)           |
| `PGBOUNCER_POOL_SIZE`                        | How many connections PgBouncer keeps to Postgres. Keep it under 30 minus the direct ones. | `20`         | [The stack](stack.md#database-connections) |
| `PGBOUNCER_MAX_CLIENT_CONN`                  | How many connections PgBouncer accepts from the apps.                                     | `200`        | [The stack](stack.md#database-connections) |
| `PGBOUNCER_CPU_LIMIT`, `PGBOUNCER_MEM_LIMIT` | PgBouncer's CPU and memory limit.                                                         | `0.5`, `64M` |                                            |

The five memory settings are commented out in the example; the values shown are their defaults,
sized for `DB_MEM_LIMIT=2048m`. Raise them together with the limit.

## Proxy and certificates

| Variable                             | What it does                                                                           | Example         | Guide                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `PROXY_CPU_LIMIT`, `PROXY_MEM_LIMIT` | Traefik's CPU and memory limit.                                                        | `1`, `512m`     |                                                                   |
| `PROXY_LOG_LEVEL`                    | Traefik's log level. `debug` logs every request: use it on your own machine only.      | `info`          |                                                                   |
| `PROXY_HTTPS_HOST_PORT`              | Where the proxy listens for HTTPS. A server sets `443`.                                | `127.0.0.1:443` | [Deploy](deploy.md#the-env-file)                                  |
| `PROXY_HTTP_HOST_PORT`               | Where the proxy listens for HTTP. A server sets `80`.                                  | `127.0.0.1:80`  | [Deploy](deploy.md#the-env-file)                                  |
| `TRAEFIK_ACME_EMAIL`                 | Where Let's Encrypt sends expiry notices. It refuses `example.com`; empty sends none.  | empty           | [Certificates](certificates.md)                                   |
| `TRAEFIK_CERT_RESOLVER`              | The resolver the production routes use. Set your shared Traefik's name, if it has one. | `myresolver`    | [Several projects](several-projects.md#a-traefik-you-already-run) |

Keep the two proxy ports on `127.0.0.1` on your own machine: in development the proxy serves routes
that let anyone become an administrator.

## Valkey

| Variable                       | What it does                                                                   | Example          | Guide                                   |
| ------------------------------ | ------------------------------------------------------------------------------ | ---------------- | --------------------------------------- |
| `KV_CPU_LIMIT`, `KV_MEM_LIMIT` | Valkey's container CPU and memory limit.                                       | `1`, `512m`      |                                         |
| `KV_MEM_INNER_LIMIT`           | Valkey's own memory cap, under the container's.                                | `400mb`          |                                         |
| `KV_HOSTNAME`, `KV_PORT`       | Where tasks you run outside Compose reach Valkey. Compose sets its own inside. | `kv`, `6379`     |                                         |
| `KV_PASSWORD`                  | Valkey's password. Valkey and the API refuse to start without it.              | secret           | [Deploy](deploy.md#the-env-file)        |
| `KV_HOST_PORT`                 | Where Valkey is published on this machine. Keep `127.0.0.1`.                   | `127.0.0.1:6380` | [Several projects](several-projects.md) |

## File store

| Variable                               | What it does                                                                              | Example       | Guide             |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- | ----------------- |
| `S3_ENDPOINT`                          | Where the API reaches the store. Empty: this project's Garage.                            | empty         | [Files](files.md) |
| `S3_PUBLIC_ENDPOINT`                   | Where browsers reach it, in the links the API signs. Empty: `https://<DOMAIN>`.           | empty         | [Files](files.md) |
| `S3_REGION`                            | The store's region.                                                                       | `garage`      | [Files](files.md) |
| `S3_BUCKET`                            | The bucket. Empty: `<PROJECT>-files`.                                                     | empty         | [Files](files.md) |
| `S3_ACCESS_KEY_ID`                     | The store's key id. Garage wants `GK` and 24 hex characters.                              | placeholder   | [Files](files.md) |
| `S3_SECRET_ACCESS_KEY`                 | The key's secret, 64 hex characters for Garage. The API refuses to start without the key. | secret        | [Files](files.md) |
| `GARAGE_RPC_SECRET`                    | Garage's internal secret, 64 hex characters.                                              | secret        | [Files](files.md) |
| `GARAGE_CPU_LIMIT`, `GARAGE_MEM_LIMIT` | Garage's CPU and memory limit.                                                            | `0.5`, `256M` |                   |

For another store, such as Hetzner Object Storage, take `files` out of `COMPOSE_PROFILES`, set the
endpoints, region, bucket and key, and allow `PUT` and `GET` from `https://<DOMAIN>` in its CORS
rules.

## Monitoring

| Variable                   | What it does                                                                             | Example  | Guide                            |
| -------------------------- | ---------------------------------------------------------------------------------------- | -------- | -------------------------------- |
| `VM_REMOTE_WRITE_URL`      | Where metrics go, as a full remote-write address. Empty: this project's VictoriaMetrics. | empty    | [The stack](stack.md#monitoring) |
| `VM_REMOTE_WRITE_USERNAME` | HTTP basic auth user for it. Empty when the server asks for none.                        | empty    | [The stack](stack.md#monitoring) |
| `VM_REMOTE_WRITE_PASSWORD` | Its password.                                                                            | empty    | [The stack](stack.md#monitoring) |
| `VLOGS_URL`                | Where logs go, as a VictoriaLogs base address. Empty: this project's VictoriaLogs.       | empty    | [The stack](stack.md#monitoring) |
| `VLOGS_USERNAME`           | HTTP basic auth user for it.                                                             | empty    | [The stack](stack.md#monitoring) |
| `VLOGS_PASSWORD`           | Its password.                                                                            | empty    | [The stack](stack.md#monitoring) |
| `ALERT_NTFY_URL`           | With `monitoring`: the ntfy server alerts go to. Empty sends alerts nowhere.             | empty    | [The stack](stack.md#alerts)     |
| `ALERT_NTFY_TOPIC`         | The ntfy topic.                                                                          | `alerts` | [The stack](stack.md#alerts)     |
| `ALERT_NTFY_TOKEN`         | An ntfy access token. Empty for a topic anyone may post to.                              | empty    | [The stack](stack.md#alerts)     |

To send to another server, take `monitoring` out of `COMPOSE_PROFILES` and set the two addresses.

The first six pairs below are optional: the values shown are Compose's defaults. The last four have
no default, so keep them in the env file.

| Containers (CPU, memory limit)                               | Value         |
| ------------------------------------------------------------ | ------------- |
| `VMAGENT_CPU_LIMIT`, `VMAGENT_MEM_LIMIT`                     | `0.2`, `128M` |
| `VECTOR_CPU_LIMIT`, `VECTOR_MEM_LIMIT`                       | `0.2`, `128M` |
| `VICTORIAMETRICS_CPU_LIMIT`, `VICTORIAMETRICS_MEM_LIMIT`     | `0.5`, `256M` |
| `VICTORIALOGS_CPU_LIMIT`, `VICTORIALOGS_MEM_LIMIT`           | `0.5`, `256M` |
| `VMALERT_CPU_LIMIT`, `VMALERT_MEM_LIMIT`                     | `0.2`, `128M` |
| `ALERTMANAGER_CPU_LIMIT`, `ALERTMANAGER_MEM_LIMIT`           | `0.1`, `64M`  |
| `POSTGRES_EXPORTER_CPU_LIMIT`, `POSTGRES_EXPORTER_MEM_LIMIT` | `1`, `512m`   |
| `GRAFANA_CPU_LIMIT`, `GRAFANA_MEM_LIMIT`                     | `1`, `512m`   |
| `NODEEXPORTER_CPU_LIMIT`, `NODEEXPORTER_MEM_LIMIT`           | `1`, `512m`   |
| `CADVISOR_CPU_LIMIT`, `CADVISOR_MEM_LIMIT`                   | `1`, `512m`   |

`GRAFANA_PASS` is Grafana's `admin` password, read on its first start only
([Admin consoles](operator-access.md#admin-consoles)).

## The app

| Variable                                 | What it does                                                                                      | Example          | Guide                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------- |
| `DENO_VERSION`                           | The Deno version every image is built on.                                                         | `2.9.7`          |                                           |
| `APP_RUNTIME`                            | The runtime of the API, the worker, the migration and the website: `node`, `bun`, or empty for Deno. | empty            | [The three apps](apps.md#runtime)         |
| `API_CPU_LIMIT`, `API_MEM_LIMIT`         | The API's CPU and memory limit.                                                                   | `1`, `512M`      | [Capacity](capacity.md)                   |
| `API_PORT`                               | The port the API listens on inside its container.                                                 | `8000`           |                                           |
| `WORKER_CPU_LIMIT`, `WORKER_MEM_LIMIT`   | The worker's CPU and memory limit.                                                                | `0.5`, `256M`    |                                           |
| `MIGRATE_CPU_LIMIT`, `MIGRATE_MEM_LIMIT` | The one-shot migration's CPU and memory limit.                                                    | `0.5`, `256M`    |                                           |
| `AUTH_COOKIE_SECRET`                     | Signs the session cookie. At least 32 characters, or the API refuses to start.                    | secret           | [Deploy](deploy.md#the-env-file)          |
| `AUTH_PEPPER`                            | Mixed into every password hash. At least 32 characters.                                           | secret           | [Deploy](deploy.md#the-env-file)          |
| `SEED_PASSWORD`                          | The development administrator's password for `db:seed` and `db:reset`, 8 to 50 characters.        | secret           | [Development](development.md)             |
| `DEMO_MODE`                              | `true` runs the public demo: a nightly wipe and sample data. Never with real users.               | empty            | [The public demo](demo.md)                |
| `DEMO_ADMIN_PASSWORD`                    | With `DEMO_MODE=true`, the password of `admin@example.com` after every reset. Unset: no operator. | empty            | [The public demo](demo.md)                |
| `GUEST_MODE`                             | "Try it now" without signing up. On unless `false`.                                               | empty            | [Guests](guests.md)                       |
| `SPA`                                    | The signed-in app. On unless `false`, which also closes sign-up.                                  | empty            | [The three apps](apps.md#without-the-spa) |
| `ATTACHMENT_UPLOAD_FILES_PER_HOUR`       | Files one person may upload per hour. Empty: 50.                                                  | empty            | [Files](files.md)                         |
| `ATTACHMENT_UPLOAD_BYTES_PER_HOUR`       | Bytes one person may upload per hour. Empty: 52428800 (50 MiB).                                   | empty            | [Files](files.md)                         |
| `OPERATION_COMMANDS_PER_MINUTE`          | Writes one signed-in person may make per minute. Empty: 120.                                      | empty            | [Architecture](architecture.md)           |
| `OPERATION_QUERIES_PER_MINUTE`           | Reads one signed-in person may make per minute. Empty: 600.                                       | empty            | [Architecture](architecture.md)           |
| `GUEST_OPERATION_COMMANDS_PER_MINUTE`    | Writes all guests on one client address may make per minute. Empty: 60.                           | empty            | [Guests](guests.md)                       |
| `GUEST_OPERATION_QUERIES_PER_MINUTE`     | Reads all guests on one client address may make per minute. Empty: 300.                           | empty            | [Guests](guests.md)                       |
| `TIMEZONE`                               | An IANA time zone name. The API refuses to start without it.                                      | `Asia/Singapore` |                                           |
| `RATE_LIMITER_WINDOW_MS`                 | The rate limits' window, in milliseconds.                                                         | `60000`          | [Load tests](load-tests.md)               |
| `RATE_LIMITER_STRICT_LIMIT`              | Requests per window to the strict account routes, such as sign-in, per person or client address.  | `30`             | [Load tests](load-tests.md)               |
| `RATE_LIMITER_LIMIT`                     | Requests per window to the other account routes, per person or client address.                    | `100`            | [Load tests](load-tests.md)               |
| `RATE_LIMITER_OTP_WINDOW_MS`             | The one-time-code window, in milliseconds.                                                        | `900000`         |                                           |
| `RATE_LIMITER_OTP_LIMIT`                 | One-time-code checks per user per window.                                                         | `5`              |                                           |

Operations are `/api/call/<name>`, the socket's calls and signed-in REST writes together.

## Mail

With `ENV=dev`, mail goes to the worker's log and the `dev_mail` table, and these are ignored. In
production all five must be set, or nothing is sent. The API and the worker still start, and log
one warning naming the missing ones.

| Variable    | What it does             | Example                  |
| ----------- | ------------------------ | ------------------------ |
| `SMTP_HOST` | The mail server.         | empty                    |
| `SMTP_PORT` | Its port.                | `587`                    |
| `SMTP_USER` | The user to sign in as.  | empty                    |
| `SMTP_PASS` | Its password.            | empty                    |
| `SMTP_FROM` | The sender, with a name. | `"App <hi@example.com>"` |

The worker sends the mail, such as sign-in and password reset codes.

## Billing

| Variable                      | What it does                                                                                                   | Example | Guide                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | ------- | --------------------- |
| `BILLING_PROVIDER`            | `stripe`, or empty: off in production, the development provider with `ENV=dev`.                                | empty   | [Billing](billing.md) |
| `STRIPE_SECRET_KEY`           | Stripe's secret key. With `stripe`, the API refuses to start without all three Stripe values.                  | empty   | [Billing](billing.md) |
| `STRIPE_WEBHOOK_SECRET`       | The webhook's signing secret.                                                                                  | empty   | [Billing](billing.md) |
| `STRIPE_PRICE_PRO`            | The Pro plan's price id.                                                                                       | empty   | [Billing](billing.md) |
| `STRIPE_PRICE_PRO_YEARLY`     | The Pro plan's yearly price id. Required when Pro has a yearly price, refused when it has none.               | empty   | [Billing](billing.md) |
| `BILLING_GRACE_DAYS`          | Days a group whose payment failed keeps its plan, 0 to 90. Empty: 7.                                           | empty   | [Billing](billing.md) |
| `BILLING_TRIAL_REQUIRES_CARD` | Whether a trial asks for a card. Empty: `true`. With `false`, a trial that ends without one goes back to Free. | empty   | [Billing](billing.md) |

Use Stripe's test-mode keys outside production.

## Catalog and statistics

| Variable            | What it does                                                                                                | Example | Guide                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------- | ------------------------- |
| `CATALOG`           | `true` turns the catalog on.                                                                                | empty   | [Catalog](catalog.md)     |
| `CATALOG_CURRENCY`  | The ISO 4217 code of every price. Empty: `USD`.                                                             | empty   | [Catalog](catalog.md)     |
| `CATALOG_LANGUAGES` | The languages of its texts, comma-separated, the default first. Empty: `en`.                                | empty   | [Catalog](catalog.md)     |
| `CATALOG_ITEM_PATH` | The website's item address for tracking links, with `{category}` and `{slug}`. Empty: `/{category}/{slug}`. | empty   | [Catalog](catalog.md)     |
| `UMAMI_API_URL`     | Your self-hosted Umami's address, for click counts and the admin app's Stats page.                          | empty   | [Analytics](analytics.md) |
| `UMAMI_API_TOKEN`   | A token from that Umami's `POST /api/auth/login`. Set both or neither. Never logged.                        | empty   | [Analytics](analytics.md) |

Tracking links are on with the catalog once `MPA_DOMAIN` is set. Without the Umami values they go
straight to the item, still tagged with `utm_source`.

## Mail subscriptions

| Variable                       | What it does                                                                                                                  | Example | Guide                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------- |
| `SUBSCRIBERS_SECRET`           | Signs every confirm and unsubscribe link. At least 32 printable characters, not the cookie secret: `openssl rand -base64 48`. | empty   | [Architecture](architecture.md) |
| `SUBSCRIBERS_PREVIOUS_SECRETS` | After a rotation, the earlier secrets, comma-separated. They only check old links.                                            | empty   | [Architecture](architecture.md) |

Unset in production, the secret turns subscriptions off. With `ENV=dev`, unset signs with a public
development value.

## Sign-in providers

A provider is on only when both of its values are set. Otherwise its button is hidden and its
routes answer 404. Register `https://<DOMAIN>/api/auth/google/callback`, or `/github/callback`.

| Variable               | What it does            | Guide                                     |
| ---------------------- | ----------------------- | ----------------------------------------- |
| `GOOGLE_CLIENT_ID`     | Google's client id.     | [Sign-in providers](sign-in-providers.md) |
| `GOOGLE_CLIENT_SECRET` | Google's client secret. | [Sign-in providers](sign-in-providers.md) |
| `GITHUB_CLIENT_ID`     | GitHub's client id.     | [Sign-in providers](sign-in-providers.md) |
| `GITHUB_CLIENT_SECRET` | GitHub's client secret. | [Sign-in providers](sign-in-providers.md) |

## Telegram

| Variable                  | What it does                                                                                               | Guide                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------- |
| `TELEGRAM_BOT_TOKEN`      | The bot's token from @BotFather. Empty turns the bot off.                                                  | [Telegram](telegram.md) |
| `TELEGRAM_BOT_USERNAME`   | The bot's username, without `@`.                                                                           | [Telegram](telegram.md) |
| `TELEGRAM_WEBHOOK_SECRET` | Production: the secret Telegram sends to `https://<DOMAIN>/api/webhooks/telegram`. `openssl rand -hex 32`. | [Telegram](telegram.md) |
| `TELEGRAM_POLLING`        | `true` or `false` overrides the default: polling with `ENV=dev`, the webhook in production.                | [Telegram](telegram.md) |
| `TELEGRAM_API_URL`        | A local Bot API server. Empty: `https://api.telegram.org`.                                                 | [Telegram](telegram.md) |

## Error tracking and the SPA's modules

| Variable                         | What it does                                                                                        | Guide                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `ERROR_REPORT_DSN`               | A GlitchTip or Sentry DSN for the API's unhandled errors. Empty: no reporting.                      | [The stack](stack.md#error-tracking) |
| `SPA_ERROR_REPORT_DSN`           | The same for the browser. Public; the SPA container reads it on start, so a restart applies it.     | [The stack](stack.md#error-tracking) |
| `SPA_REALTIME`                   | `false` or `0` turns the WebSocket off: the page uses HTTP and checks for changes every 30 seconds. | [Offline](offline.md)                |
| `SPA_OFFLINE`                    | `false` or `0` turns the offline layer off: no device copy and no queue of writes.                  | [Offline](offline.md)                |
| `SPA_CPU_LIMIT`, `SPA_MEM_LIMIT` | The SPA container's limits. Example: `4`, `4G`, which the development Vite server needs.            |                                      |

## Backups

| Variable                              | What it does                                                                         | Guide                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ | --------------------- |
| `BACKUP_RESTIC_REPOSITORY`            | The restic repository, such as `s3:https://s3.example.com/app-backups`. Not `sftp:`. | [Backups](backups.md) |
| `BACKUP_RESTIC_PASSWORD`              | Encrypts the repository. Keep a copy away from the server.                           | [Backups](backups.md) |
| `S3_BUCKET_BACKUPS_ACCESS_KEY_ID`     | The backup bucket's key id.                                                          | [Backups](backups.md) |
| `S3_BUCKET_BACKUPS_SECRET_ACCESS_KEY` | The backup bucket's key secret.                                                      | [Backups](backups.md) |

## Published ports

Each is `127.0.0.1:<port>` on this machine; never `0.0.0.0`. Two projects on one machine need
different ports ([Several projects](several-projects.md)).

| Variable            | What it publishes | Example          |
| ------------------- | ----------------- | ---------------- |
| `DB_HOST_PORT`      | Postgres.         | `127.0.0.1:5432` |
| `GRAFANA_HOST_PORT` | Grafana.          | `127.0.0.1:3000` |

`KV_HOST_PORT`, under Valkey, publishes Valkey the same way.

## Deploy

Read by `deno task deploy` only. It stops when one of the first two is empty.

| Variable         | What it does                                                                    | Example | Guide                                 |
| ---------------- | ------------------------------------------------------------------------------- | ------- | ------------------------------------- |
| `SSH_TO_SERVER`  | The SSH destination: `user@host`, or a `Host` alias from `~/.ssh/config`.       | empty   | [Deploy an update](deploy-updates.md) |
| `PATH_ON_SERVER` | The app's directory on the server, absolute or relative to the SSH user's home. | empty   | [Deploy an update](deploy-updates.md) |
| `DENO_ON_SERVER` | The command that runs Deno there. `~/.deno/bin` is searched first.              | `deno`  | [Deploy an update](deploy-updates.md) |

## Next

- [Deploy to a server](deploy.md)
- [The three apps](apps.md)
