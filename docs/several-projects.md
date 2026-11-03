# Run several projects on one server

> Also on the website: [seedsaas.com/docs/several-projects](https://seedsaas.com/docs/several-projects).

How products made from Seed share one server and one Traefik, and what they share.

**You need** one project deployed on the server as [Deploy to a server](deploy.md) says.

## Several projects on one server

Each project lives in its own directory, so each has its own data under `.volumes/`.

1. In the env file of every project after the first, change the values below.
2. Deploy it as usual. Do not start the proxy again: one runs per server.

| Variable            | Why it must differ                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PROJECT`           | Names the containers, the network, the base image and the Traefik routes. Lowercase letters, digits and dashes. |
| `DOMAIN`            | Each project has its own host.                                                                                  |
| `MPA_DOMAIN`        | With the `mpa` profile, the same.                                                                               |
| `DB_HOST_PORT`      | Postgres's port on `127.0.0.1`.                                                                                 |
| `KV_HOST_PORT`      | Valkey's port on `127.0.0.1`.                                                                                   |
| `GRAFANA_HOST_PORT` | Grafana's port on `127.0.0.1`.                                                                                  |

A port another project holds stops `deno task compose up -d` before it changes anything, and names
the port and its variable.

Turn on the `host-monitoring` profile in one project only: its containers watch the whole host.

## What the projects share

Each project gets its own network with a free subnet. Its database, Valkey and monitoring are on
that network only.

Two things are shared:

- **The proxy.** Start it once per server, not per project. Traefik must keep the container name
  `traefik`.
- **The `proxy` network.** The API, the SPA and the website of every project join it, so Traefik
  can reach them.

A container on the `proxy` network can call any project's API directly, past the proxy. The API
refuses such a request when it names a client address (`X-Real-IP` and the like). Only Traefik and
the project's own website may name one. So a neighbour cannot pose as many visitors to dodge the
sign-in limits, but it can still call the API as one.

Share a server only between projects you trust alike.

On that network, address your own services by container name (`<PROJECT>-api`, `<PROJECT>-db`).
A plain service name such as `api` is answered by any project.

## A Traefik you already run

Seed usually deploys behind a Traefik that several projects share. When you run one already, do
not start `infra/compose/compose.proxy.yml`:

- **It defines a certificate resolver:** set `TRAEFIK_CERT_RESOLVER` to that resolver's name.
- **It defines none:** copy the three `--certificatesresolvers.*` flags from `compose.proxy.yml`
  into its command.

Every route, service and middleware name carries `PROJECT`, so projects with different names never
collide in one Traefik.

## Next

- [HTTPS certificates](certificates.md)
- [Settings](settings.md)
