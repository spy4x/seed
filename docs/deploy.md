# Deploy and operate

Certificates, the deploy itself, the consoles, several projects on one server, and releases.

## Production certificates

The production routers ask Traefik for certificates from the resolver named by
`TRAEFIK_CERT_RESOLVER` (default `myresolver`). `infra/compose/compose.proxy.yml` defines that
resolver: Let's Encrypt, HTTP challenge on port 80, certificates stored in
`.volumes/traefik/letsencrypt/acme.json`, expiry notices to `TRAEFIK_ACME_EMAIL`. Point `DOMAIN` at
the server and run `deno task proxy:start` there.

Plain `http://<DOMAIN>` (and `http://<MPA_DOMAIN>` with the `mpa` profile) answers a permanent
redirect to HTTPS. Other hosts can answer a permanent redirect to the same path on `MPA_DOMAIN`:
set `MPA_REDIRECT_RULE` to a Traefik rule, such as ``MPA_REDIRECT_RULE=Host(`www.example.com`)``.

The proxy serves nothing of its own but `/ping`: Traefik's dashboard and API are
off, because they list every router and backend address of every project behind the proxy.

**A server deployed before these changes needs three things once**, and its next deploy does
more than usual:

1. A server that runs Podman needs `CONTAINER_PROVIDER=podman` in its env file. Without that line
   the deploy used to run Podman and now runs Docker: it fails at "Starting the app" and the old
   containers stay up. Any other value than `docker` or `podman` is refused.
2. Run `deno task proxy:start` on it: `deno task deploy` restarts the app's containers but never
   the proxy, so the proxy that is already running keeps serving its dashboard at
   `proxy.<DOMAIN>` until then.
3. The next deploy publishes Grafana (with the `monitoring` profile) on `127.0.0.1:3000`. When
   something on the server that is not this project
   already listens on a port the project publishes, the deploy stops at "Starting the app" before
   any container is created, stopped or started: it names the port and the variable to change
   (`GRAFANA_HOST_PORT`), and what ran before still runs. Set that
   variable in the env file to a free `127.0.0.1:<port>` and deploy again
   ([Admin consoles](#admin-consoles)).

That deploy also recreates the project's network, which no longer has a fixed subnet. Compose
would start the containers it does not recreate on the new network without their service names
(`db`, `kv`), so the deploy sees the change coming (a dry run names the network), builds the
images, removes every container of the project and that network, and creates them all again:
expect a short outage of everything, the database included, not the usual restart of the app
alone. Data is not touched: it lives in `.volumes`. The base image is now named
`<PROJECT>/deno-base`; the old `app/deno-base` image stays on the server until you remove it
(`docker image rm app/deno-base:<version>`).

Every deploy starts the product first (the database, Valkey, the migration, the API, the worker,
the SPA unless `SPA=false`, and the website with the `mpa` profile), then everything else. When a
monitoring container cannot start, the product already runs on the new version; the deploy still
fails, and its last lines name the services that are not up. A check that cannot be made (Compose
answers in a form the script does not read, as `podman-compose` may) is skipped, and the deploy
runs as one `compose up`, as it did before.

`deno task deploy [env file]` reads the server from the env file (`infra/envs/.env.prod` unless you
name another): `SSH_TO_SERVER`, `PATH_ON_SERVER` and, when Deno is not on the server's `PATH`,
`DENO_ON_SERVER`. `infra/envs/.env.example` lists them with every other name. The copy replaces
every server file that differs from your checkout, one edited on the server or newer there too, and
deletes the ones your checkout no longer has; env files and the web push keys are never touched. So
deploying an older commit is a full rollback of the code. It does not roll back the database or
Valkey: before rolling back, read traps 10 and 11 in [the handoff](handoff.md).

The deploy stops when your working tree has uncommitted changes, untracked files included, and
lists them: the copy sends files as they are on disk, so the server would run code that matches no
commit. Commit or stash them first, or run `deno task deploy --allow-dirty [env file]` to send
them anyway.

**A server that ran Postgres 16 moves its data once.** The Compose file runs Postgres 18, which
keeps its data in a directory of its own, so the first deploy of this version stops at "Starting
the app" with a message that says why, and the old containers keep serving. Run
`deno task db:upgrade-18` on the server to move the data and finish the deploy:
[The Postgres 18 upgrade guide](postgres-18-upgrade.md) has the steps, the outage to expect and
the way back.

`deno task deploy` needs no manual step on a new server: it creates `infra/configs/vapid.json`
(the web push keys) there when the file is missing, readable by its owner only. It never sends the
key from your machine and never replaces one that exists. It stops before sending anything when a
password or secret in the env file equals one that `infra/envs/.env.example` prints (those values
are public), or when one that the example file sets is empty or missing, and names each such
variable. It reads the example file for that, so keep the file. Router, service and middleware names
carry `${PROJECT}`, so projects with different `PROJECT` values can share one Traefik. Postgres and
Valkey stay on `127.0.0.1`. Every image has a pinned version, except the nginx base of the SPA and
admin images (`nginx-unprivileged:stable-alpine`).

The template usually deploys behind a Traefik that several projects share. If that Traefik already
defines a resolver, do not start the proxy compose file: set `TRAEFIK_CERT_RESOLVER` to the name it
defines. If that Traefik defines none, copy the three `--certificatesresolvers.*` flags from
`compose.proxy.yml` into its command.

## The first operator

`deno task operator:create <address>` makes a person an administrator of the admin app. When
nobody signs in with the address, it creates the account, its address proven, with a password it
asks for. It needs no mail, so it is how a product without mail or without sign-up gets its first
operator. Run it on the server, in `PATH_ON_SERVER`, in the worker container, which has the
database and `AUTH_PEPPER`:

```sh
deno task compose exec worker deno task operator:create seller@example.com
```

It asks for the password twice and shows nothing typed. From a script, send the password as the
first line of standard input and add `-T`, so Compose gives the command no terminal. Keep the
password out of the command line, where the shell history and the process list would keep it:

```sh
ssh <SSH_TO_SERVER> 'cd <PATH_ON_SERVER> && deno task compose exec -T worker deno task operator:create seller@example.com' < password.txt
```

The password is 8 to 50 characters, as at sign-up. The person signs in to the admin app at
`ADMIN_DOMAIN` with the address and that password. When somebody signs in with the address
already, the command makes them an administrator and asks for nothing: their password stays as it
is. Running it again changes nothing. Every role change writes an audit row on the person naming
`cli:operator-create`. To give a lower role, use `deno task user:role` ([apps.md](apps.md)).

## Without the SPA

A product that is a website and its admin panel only, with no signed-in customers, sets
`SPA=false` in the env file:

- Compose runs no SPA container: every `deno task compose up`, and so every deploy, scales it to
  none, and stops and removes one that runs. Traefik then has no router for the SPA. The API keeps
  its router on `DOMAIN`, for the webhooks and the file store's links. The SPA's image is still
  built on a deploy.
- The API answers 404 to sign-up and every other route under `/api/auth` on every host but
  `ADMIN_DOMAIN`: the password sign-up, sign-in links, Google and GitHub, guests and passkeys.
  Nobody can make an account or sign in there.
- The admin app's sign-in on `ADMIN_DOMAIN` works as before. Its first operator comes from
  [`deno task operator:create`](#the-first-operator).

Any other value, or none, runs the SPA. The website's links to sign-in and sign-up lead to the SPA,
so a product without it removes them from its pages.

## Admin consoles

Grafana has no public address. It is published on the machine's own address only, on
`127.0.0.1:3000` (sign in with `admin` and `GRAFANA_PASS`). On your own machine open
`http://localhost:3000`. On a server, open a tunnel first:

```sh
ssh -L 3000:127.0.0.1:3000 <SSH_TO_SERVER>
```

When the port is taken, set `GRAFANA_HOST_PORT` in the env file to another `127.0.0.1:<port>`.
Never publish it on `0.0.0.0`.

## Several projects on one server

Products made from this template can share a server and its Traefik. Each lives in its own
directory, so each has its own data under `.volumes/`. In the env file of every project after the
first, change:

- `PROJECT`: containers, the project's network, its base image and its Traefik routers are named
  after it. Lowercase letters, digits and dashes.
- `DOMAIN`, and `MPA_DOMAIN` with the `mpa` profile.
- the three ports published on `127.0.0.1`: `DB_HOST_PORT`, `KV_HOST_PORT` and
  `GRAFANA_HOST_PORT`. A port another project holds stops
  `deno task compose up -d` before it changes anything, naming the port and its variable.

The engine gives every project's network a free subnet, and each project's database, Valkey
and monitoring are on that network only. Two things are shared. The proxy: start it once per
server, not per project. And the `proxy` network, which the API, the SPA and the website of every
project join so that Traefik can reach them: a container on it can open any project's API
directly, without passing the proxy. The API refuses such a request when it names a client address
(`X-Real-IP` and the like): only Traefik, which must keep the container name `traefik`, and the
project's own website may, as `PROXY_HOSTS` in the API's environment lists them. So a neighbour
cannot pose as many visitors to dodge the sign-in limits, though it can still call the API as one.
Share a server only between projects you trust alike. On that network a project addresses its own
services by container name (`<PROJECT>-api`, `<PROJECT>-db`), never by a plain service name such as
`api`, which any project would answer.

With the `host-monitoring` profile, turn it on in one project only: its containers watch the whole
host.

## Releases

A version tag on `main` publishes the images to Docker Hub as `<IMAGE_PREFIX>-api`, `-spa` and
`-mpa` (the worker runs the API image); `IMAGE_PREFIX` is set in
[`.woodpecker/release.yml`](../.woodpecker/release.yml). To cut a release:

```sh
git switch main && git pull --ff-only   # the tag must point at a commit on main
git tag v1.2.3                          # v1.2.3-rc.1 publishes that tag only, never `latest`
git push origin v1.2.3
```

The pipeline refuses a tag whose commit is not on `main`. Setup and the steps:
[the CI guide](woodpecker-ci-setup.md#releases).

**Release images are public.** A new Docker Hub repository is public unless the account says
otherwise, and the API image holds the whole source tree, not only the build output. A private
product makes its repositories private on Docker Hub (`-base`, `-api`, `-spa` and `-mpa`), or sets
the account's default visibility to private, before its first release tag.
