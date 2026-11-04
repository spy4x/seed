# Run the local stack

> Also on the website: [seedsaas.com/docs/local-stack](https://seedsaas.com/docs/local-stack).

This page gets Seed running on your machine, with demo data, and shows how to reset it.

You need:

- [Deno](https://deno.com) 2.
- Docker, or Podman (see [Use Podman](#use-podman)).
- A clone of your product's repository.

## Start the stack

1. Prepare the clone. It asks for the project's name:

   ```sh
   deno task init
   ```

2. Start the stack:

   ```sh
   deno task dev
   ```

3. Open http://app.localhost and sign up.

`init` first checks that Docker, or Podman, is installed and running, and stops with what to
install or start when neither is. On a fresh clone it takes Podman when Docker does not answer and
Podman does. Then it copies `infra/envs/.env.example` to `infra/envs/.env` and replaces every
placeholder secret with a random one. It also creates the web push keys in
`infra/configs/vapid.json`, and records the Seed commit in `.seed/commit`
([Start a product](products.md#start-a-product)). It is safe to run again: a value you changed and
a file that exists stay as they are.

| Flag            | What it does                                     |
| --------------- | ------------------------------------------------ |
| `--name <name>` | Sets `PROJECT` without asking                    |
| `--yes`         | Takes the folder's name as `PROJECT`, no question |

Both flags apply only when `init` creates the env file.

`dev` starts Traefik, unless a container named `traefik` already runs. Then it starts Postgres,
Valkey, the API, the worker, the SPA and the services in `COMPOSE_PROFILES`. Every routed service
joins a Docker network named `proxy`, which `dev` creates when it is missing.

## Use Podman

1. In `infra/envs/.env`, set `CONTAINER_PROVIDER=podman`.
2. Start Traefik yourself. This task calls Docker:

   ```sh
   deno task proxy:start
   ```

3. Start the stack with `deno task dev`. Under Podman it skips Traefik and prints the hint above.

## Choose what runs

`COMPOSE_PROFILES` in `infra/envs/.env` lists the optional services, separated by commas. The
example file starts `monitoring,files`.

| Profile           | What it adds                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `monitoring`      | VictoriaMetrics, VictoriaLogs and Grafana, at http://localhost:3000              |
| `files`           | Garage, the file store ([files](files.md))                                       |
| `host-monitoring` | node-exporter and cAdvisor. They watch the whole machine, so they are off        |
| `admin`, `mpa`    | The admin app and the public website ([the three apps](apps.md))                 |

Without `monitoring`, set `VM_REMOTE_WRITE_URL` and `VLOGS_URL` to send metrics and logs to a
monitoring server you already have. [The stack guide](stack.md#monitoring) describes both modes.
Grafana's sign-in is in [Admin consoles](operator-access.md#admin-consoles).

## Migrations

Compose applies pending migrations on every start, in the one-shot `migrate` service. The API and
the worker wait for it, and a failed migration stops the start.

To apply them from your machine instead, for an API you run outside Compose, use the values from
`infra/envs/.env`:

```sh
DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> \
  deno task db:migrate
```

## Demo data

`db:seed` fills a database with fake people, groups, tags, notes, invitations and newsletter
subscribers. It also adds `admin@example.com`, an administrator who signs in to the
[admin app](apps.md#the-admin-app) with no second factor.

```sh
ENV=dev DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> \
  AUTH_PEPPER=<the API's pepper> SEED_PASSWORD=<8 to 50 characters> \
  deno task db:seed
```

`SEED_PASSWORD` is the administrator's password. For the product itself, sign up with your own
address. Run again, the seed only puts the administrator's role and proven address right. When it
cannot create an account, it says so and exits with 1.

The public demo runs the same seed every night, without the administrator ([demo](demo.md)).

## Reset the database

`db:reset` drops a development database, migrates it and seeds it. It takes the same values as
`db:seed` and asks before it drops anything:

```sh
ENV=dev DB_HOST=127.0.0.1 DB_PORT=5432 DB_USER=<user> DB_PASS=<password> DB_NAME=<name> \
  AUTH_PEPPER=<the API's pepper> SEED_PASSWORD=<8 to 50 characters> \
  deno task db:reset
```

| Flag              | What it does                                                    |
| ----------------- | --------------------------------------------------------------- |
| `--yes`           | Skips the question                                              |
| `--no-prod-check` | Skips the production-name check, on a machine without `.env.prod` |

It refuses, before it drops anything, unless all of these hold:

- `ENV` is `dev`.
- `DB_HOST` is `localhost`, `127.0.0.1` or `db`.
- `DB_NAME` differs from the one in `infra/envs/.env.prod`. A missing `.env.prod` refuses too.
- `DB_PORT`, `DB_USER` and `DB_PASS` are set, and the seed accepts `AUTH_PEPPER` and
  `SEED_PASSWORD`.

Run it from your machine, not inside the API container. There `DB_HOST` is
`<PROJECT>-pgbouncer`, because the API reaches Postgres through PgBouncer, and the reset refuses
that host.

## Stop

```sh
deno task compose down
deno task proxy:stop
```

## Next

- [Every task](development.md)
- [Run the browser tests](browser-tests.md)
- [Add your first feature](first-feature.md)
