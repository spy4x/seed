# Deploy an update

> Also on the website: [seedsaas.com/docs/deploy-updates](https://seedsaas.com/docs/deploy-updates).

How every deploy after the first works, how to roll back, and the one-time steps for a server
deployed with an older Seed.

**You need** a server deployed once as [Deploy to a server](deploy.md) says.

To deploy every push to `main` from CI instead of by hand, see
[Deploy on every push to main](woodpecker-ci-setup.md#deploy-on-every-push-to-main).

## Deploy

1. Commit or stash your changes. The deploy stops when the working tree has uncommitted changes,
   untracked files included, and lists them.
2. Deploy from your machine:

   ```sh
   deno task deploy
   ```

To deploy another env file than `infra/envs/.env.prod`, name it; it must live under `infra/`:

```sh
deno task deploy infra/envs/.env.staging
```

To send uncommitted changes anyway, add `--allow-dirty`. The server then runs code that matches no
commit:

```sh
deno task deploy --allow-dirty
```

| Variable         | What it does                                                          | Default |
| ---------------- | --------------------------------------------------------------------- | ------- |
| `SSH_TO_SERVER`  | The SSH destination: `user@host`, or a `Host` alias from your config. | none    |
| `PATH_ON_SERVER` | The app's directory, absolute or relative to the SSH user's home.     | none    |
| `DENO_ON_SERVER` | The command that runs Deno on the server, after `~/.deno/bin`.        | `deno`  |

The deploy stops when one of the first two is empty.

## What a deploy does

- It refuses an env file that does not set `ENV=prod`. It also refuses one where a secret is empty
  or equals the public value of `infra/envs/.env.example`, and names each. Keep the example file:
  the check reads it.
- It copies your checkout to the server. Every server file that differs is replaced, one edited on
  the server included, and files your checkout no longer has are deleted. Env files and the web
  push keys are never touched.
- It copies the env file to `infra/envs/.env` on the server, readable by the deploy user only.
- It creates the web push keys (`infra/configs/vapid.json`) on the server when they are missing. It
  never sends yours and never replaces existing ones.
- It starts the product first: the database, Valkey, the migrations, the API, the worker and the
  SPA (unless `SPA=false`), and the website and admin app when their profiles are on. Everything else, such as
  monitoring, starts after. A failed migration fails the deploy.

When a monitoring container cannot start, the product already runs the new version. The deploy
still fails, and its last lines name the services that are not up.

A deploy never restarts the proxy. Restart it on the server with
`deno task proxy:stop && deno task proxy:start`.

## Roll back

Deploy an older commit: the copy replaces every file, so this rolls the code back fully.

```sh
git switch --detach <commit>
deno task deploy
```

A rollback does not undo the database or Valkey. Before you roll back past a migration, read traps
10 and 11 in [the handoff](handoff.md#traps-in-this-codebase).

## A server deployed with an older Seed

Do these once, before or right after its next deploy.

1. A server that runs Podman: set `CONTAINER_PROVIDER=podman` in its env file. Without it the
   deploy runs Docker, fails at "Starting the app", and the old containers stay up.
2. Restart the proxy on the server, so the old one stops serving its dashboard at
   `proxy.<DOMAIN>`:

   ```sh
   deno task proxy:stop && deno task proxy:start
   ```

3. When the deploy stops at "Starting the app" naming a port, something else on the server holds
   it. Set the variable it names, such as `GRAFANA_HOST_PORT`, to a free `127.0.0.1:<port>` and
   deploy again. Nothing was changed before the stop.
4. A server that ran Postgres 16 stops at "Starting the app" too, and keeps serving. Move the data
   with `deno task db:upgrade-18` on the server, as
   [the Postgres 18 upgrade guide](postgres-18-upgrade.md) says.

That first deploy also recreates the project's network, so it removes and recreates every container
of the project, the database included. Expect a short outage of everything, not the usual restart
of the app. Data is kept: it lives in `.volumes`.

The base image is now named `<PROJECT>/deno-base`. Remove the old one when you like:

```sh
docker image rm app/deno-base:<version>
```

## Next

- [HTTPS certificates](certificates.md)
- [Publish a release](releases.md)
- [Backups](backups.md)
