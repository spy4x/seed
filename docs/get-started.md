# Get started

> Also on the website: [seedsaas.com/docs/get-started](https://seedsaas.com/docs/get-started).

Run your own copy of Seed on your machine in four commands, and open the product at
http://app.localhost.

## You need

- [Deno](https://deno.com) 2, [Node](https://nodejs.org) or [Bun](https://bun.sh). Seed's tasks run
  on Deno: on Node, `npm install -g deno` installs it, and on Bun, `bun add -g deno`. The tasks the
  root `package.json` lists, such as `init` and `dev`, also run as `npm run` or `bun run`, as the
  [README's quick start](https://github.com/spy4x/seed#quick-start) shows; the
  others stay `deno task`.
- [Docker](https://docs.docker.com/get-started/get-docker/), installed and running. Podman works
  too: see [When a step fails](#when-a-step-fails).
- The [GitHub CLI](https://cli.github.com), optional. Without it, press "Use this template" on
  [Seed's GitHub page](https://github.com/spy4x/seed) and clone your new repository instead of
  step 1.

## Run it

1. Create your product's repository from the template, and clone it:

   ```sh
   gh repo create my-product --template spy4x/seed --private --clone
   ```

2. Open its folder:

   ```sh
   cd my-product
   ```

3. Prepare it:

   ```sh
   deno task init
   ```

   It checks that Docker runs and asks for the project name. It writes `infra/envs/.env` with
   fresh secrets, the web push keys, and the Seed commit your copy came from. Running it again
   changes nothing it already set.

4. Start everything:

   ```sh
   deno task dev
   ```

   The first start builds the images and takes a few minutes. Later starts take seconds.

## What opens where

| Address                 | What                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| http://app.localhost    | The product. Sign up with any address.                                |
| http://localhost:3000   | Grafana, the metrics and logs. User `admin`, password `GRAFANA_PASS`. |
| http://admin.localhost  | The admin app, once you turn it on (below).                           |
| The website's own host  | The public website, once you turn it on (below).                      |

In development no mail leaves your machine. The worker prints each mail, with its sign-up code, in
its log:

```sh
deno task compose logs worker
```

To open the admin app, add `admin` to `COMPOSE_PROFILES` in `infra/envs/.env` and run
`deno task dev` again. Then make yourself its administrator, with a password you type:

```sh
deno task compose exec worker deno task operator:create you@example.com
```

To run the public website, add `mpa` to `COMPOSE_PROFILES`, set `MPA_DOMAIN=site.localhost`, run
`deno task dev` again, and open http://site.localhost.

## When a step fails

- **Docker is not running.** `deno task init` stops and says what to install or start. Start
  Docker Desktop, or on Linux run `sudo systemctl start docker`, then run the step again.
- **A port is taken.** `deno task dev` refuses to start and names the port and the setting that
  moves it, such as `DB_HOST_PORT`. Change that setting in `infra/envs/.env`, or stop what uses
  the port.
- **Traefik does not start.** Traefik answers on port 80 for every `*.localhost` address. When
  another program holds port 80, stop it. When another project already runs a container named
  `traefik`, Seed uses that one.
- **You use Podman.** When Docker is not running and Podman is, `deno task init` picks Podman and
  writes `CONTAINER_PROVIDER=podman` to `infra/envs/.env`. Start Traefik once with
  `deno task proxy:start`, which calls Docker.

[Development](development.md) has the rest of the local stack: every task, the tests and the
database.

## Next

- [Add a feature](aggregates.md): copy the notes feature, file by file.
- [Deploy to a server](deploy.md).
- [Take Seed's updates](products.md#take-seeds-changes) in your product.
