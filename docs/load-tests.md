# Run the load tests

> Also on the website: [seedsaas.com/docs/load-tests](https://seedsaas.com/docs/load-tests).

How to run the k6 load scenarios, build a large test group, and measure that group on a device.

**You need** the local development stack ([Development](development.md)) and Docker or Podman.

## Running it

The scenarios run against a local development stack only. k6 runs in its official container on the
stack's Compose network and talks to the API container directly. It takes no address, so it cannot
reach the live demo or any other host. The k6 container is held to 500 processes and 8 GB.

1. In `infra/envs/.env`, keep `ENV=dev` and lift the rate limits. Every load user comes from one
   address, so the example's limits stop a run in its first seconds:

   ```sh
   RATE_LIMITER_STRICT_LIMIT=1000000
   RATE_LIMITER_LIMIT=1000000
   OPERATION_COMMANDS_PER_MINUTE=1000000
   OPERATION_QUERIES_PER_MINUTE=1000000
   DENO_LOG=info
   ```

2. Start what the load needs:

   ```sh
   deno task compose up -d kv api worker
   ```

3. Run all three scenarios, or name some. Each takes about four minutes:

   ```sh
   deno task load
   deno task load browse sockets
   ```

Keep `DENO_LOG=info`: `debug` logs every request, which costs the API more than the load does.

The task prints one line per scenario with k6's numbers, and a table row with Postgres's. It samples
the database and API containers every two seconds while the scenario runs. A scenario fails when
its p95 passes one second or more than 1 % of its requests fail. The socket scenario also fails
when more than 1 % of its sockets do not open, or the server closes one.

[Capacity](capacity.md) describes the scenarios and holds the numbers.

## One large group

`deno task load:group <tier>` writes one group straight into Postgres, with rows shaped as the app
writes them. The tiers run from 1,000 to 1,000,000 notes; [One large group](large-group.md#the-tiers) lists them.

Locally, with the rate limits lifted as above:

```sh
deno task compose up -d kv api worker
deno task load:group L --member you@example.com
deno task load group L
deno task load group-reads L
deno task load:group --explain L
deno task load:group --remove
```

`load group` runs one reader: a full read, a page, searches, a write, the pull after it and the
member list. `load group-reads` runs 1, 2, 4, 8, 16 and 32 readers at once, 30 seconds each.

| Option               | What it does                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `--member <email>`   | Adds an existing account to the group as an editor, with the tier's notifications. Repeat it for more. |
| `--remove [tier]...` | Deletes the named tiers, or all four, then vacuums the tables. Real members stay.                      |
| `--explain <tier>`   | Prints the query plans with `EXPLAIN (ANALYZE, BUFFERS)`, and the table and index sizes.               |
| `--env-file <path>`  | Reads another env file than `infra/envs/.env`.                                                         |
| `--port <port>`      | Connects to this port on `127.0.0.1`, such as an SSH tunnel.                                           |

The task is safe to run twice. A finished group is left as it is, and a half-built one is removed
and built again. It refuses an env file unless `ENV` is `dev` or `DEMO_MODE` is `true`, so it never
writes into a production database. It connects to `127.0.0.1` only.

### On the public demo

1. Open a tunnel to the database port the server publishes on its loopback (`DB_HOST_PORT` in
   `infra/envs/.env.prod`):

   ```sh
   ssh -N -L 15432:127.0.0.1:<DB_HOST_PORT's port> <SSH_TO_SERVER>
   ```

2. In another terminal, build the group:

   ```sh
   deno task load:group M --env-file infra/envs/.env.prod --port 15432 --member you@example.com
   ```

3. Remove it when you are done. The nightly wipe removes it too:

   ```sh
   deno task load:group --remove --env-file infra/envs/.env.prod --port 15432
   ```

Build M at most on the demo. The server is shared with other projects, and an L or XL group costs
it minutes of database CPU on every full read. The k6 scenarios run against the local stack only.

## On devices

The benchmark page, `/benchmark` in the SPA, measures a group on the device it runs on. It exists
in development builds and on the demo.

1. Make your account a member of a tier, as above (on the demo, with the tunnel).
2. Sign in, and open `/benchmark`.
3. Press Run benchmark, and keep the tab in front.
4. Press Copy results, and add the line of JSON as a row to
   [One large group](large-group.md#on-devices).

Measure a production build: the demo, or `E2E_SPA=built`. The Vite dev server's hot-reload hook
makes a long list far slower than it is.

## Next

- [Capacity](capacity.md)
- [One large group](large-group.md)
