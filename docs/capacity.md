# Capacity

How much load one Seed server carries, measured with the k6 scenarios in `tests/load/`. The
numbers below come from a developer machine, not from the production server: a run on a Hetzner
box of production size is still to do, and its numbers will replace these as the ones to plan
with.

## The scenarios

| Scenario  | What it does                                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browse`  | 100 signed-in people at once. Each lists the 8 notes of its group, opens one, and reads for 1 to 3 seconds.                                            |
| `write`   | 50 signed-in people at once. Each creates a note, edits it and deletes it, with 0.5 to 1.5 seconds between steps.                                      |
| `sockets` | 1,000 open WebSockets: 50 people with 20 tabs each, idle for about two minutes. Once a second one of them creates and deletes a note, which their 20 sockets hear about. |

Each scenario ramps up for 30 seconds, holds for 2 minutes and ramps down for 10 seconds (the
socket one opens its sockets over 30 seconds and holds them until 150 seconds have passed). Before
it starts, it signs its people up the way a person does: the address and a password, then the code
the development worker mails, read from the development-only mail route. At the end it deletes them
through the development-only cleanup route. Neither part is in the numbers.

The requests go to the API's REST routes (`/api/groups/:groupId/notes`) and its socket
(`/api/ws`). The SPA makes the same reads and writes over the socket's calls, which run the same
handlers.

## Running it

Load runs against a local development stack only. k6 runs in its official container, pinned by
version and digest in `tests/load/run.ts`, on the stack's own Compose network, and talks to the API
container directly. It takes no address, so it cannot reach the live demo or any other host.

1. In `infra/envs/.env`, keep `ENV=dev` and lift the rate limits for the run. Every load user comes
   from one address, so the limits of `.env.example` stop a run in its first seconds:

   ```sh
   RATE_LIMITER_STRICT_LIMIT=1000000
   RATE_LIMITER_LIMIT=1000000
   DENO_LOG=info # debug logs every request, which costs the API more than the load does
   ```

2. Start the stack: `deno task dev`, or only what the load needs,
   `deno task compose up -d kv api worker`.
3. Run `deno task load` for all three scenarios, or name some: `deno task load browse sockets`.
   Each takes about four minutes. The k6 container is held to 500 processes and 8 GB.

The task prints one line per scenario with k6's numbers and a table row with Postgres's. It samples
the database and API containers every two seconds while the scenario itself runs, not during the
sign-ups or the cleanup. A scenario fails when its p95 passes one second, more than 1 % of its
requests fail, or (sockets) more than 1 % of its sockets do not open or the server closes one.

## Results

### 2026-10-21, a developer laptop

**These are local numbers, not the production server's.** They show that the scenarios run and
roughly where the limits are not; a run on a Hetzner box of production size is still to do.

- Machine: AMD Ryzen 9 8945HS (8 cores, 16 threads), 91 GB RAM, Fedora 44, Docker. Other work ran
  on the same machine at the same time.
- Stack: `deno task compose up -d kv api worker` with the limits of `.env.example`: Postgres 18.6
  held to 2 CPUs and 2 GB with `max_connections=30`, the API to 1 CPU and 512 MB with a pool of 10
  connections, the worker to half a CPU. The API ran as in development (`deno serve --watch`),
  without Traefik in front.
- k6 2.3.0 in its container, on the same machine.

| Scenario  | Requests | p95 latency | Error rate | Postgres CPU (mean / max) | API CPU (mean / max) | Postgres connections (max) |
| --------- | -------- | ----------- | ---------- | ------------------------- | -------------------- | -------------------------- |
| `browse`  | 13,804   | 29.8 ms     | 0.00 %     | 11.0 % / 18.0 %           | 17.6 % / 35.3 %      | 14                         |
| `write`   | 6,828    | 57.5 ms     | 0.00 %     | 14.3 % / 24.7 %           | 15.8 % / 29.9 %      | 14                         |
| `sockets` | 220      | 26.4 ms     | 0.00 %     | 4.2 % / 12.7 %            | 5.1 % / 17.4 %       | 14                         |

CPU is in percent of one core, as `docker stats` gives it, from 38 to 40 samples two seconds apart.
The connections are every client connection to Postgres: 11 from the API (its pool of 10 and the
connection that listens for group changes), 2 from the worker and 1 from the sampling `psql`
itself. The same 14 are open when the stack is idle.

For `sockets`, the requests are the pushes' writes. All 1,000 sockets opened (p95 16.3 ms to open),
none was closed by the server, and they received 4,393 push frames of the 4,400 the 220 writes
should cause (each write reaches its person's 20 sockets).

What this run says, with the caveat above:

- None of the three loads came near a limit. The API never passed 36 % of its one CPU and Postgres
  never passed 25 % of one core, so 100 readers, 50 writers or 1,000 idle sockets fit with room to
  spare. A run with more people is what finds the limit.
- Connections stayed at 14 of 30 in every scenario: the API's pool capped them. This run predates
  PgBouncer ([#226](https://github.com/spy4x/seed/issues/226)), which now sits between the API, the
  worker and Postgres and holds their server connections at 20 however many processes run. The
  connection counts above describe the direct layout of that time.
- A socket client must answer the server's pings. The first socket run did not, and the server
  closed 997 of 1,000 sockets after 90 silent seconds, as `@spy4x/realtime` does on purpose. The
  app's client answers them; the scenario now does too.
- One person may hold at most 20 sockets (`@spy4x/realtime`'s default), which is why the scenario
  spreads its 1,000 over 50 people.
