# Capacity

> Also on the website: [seedsaas.com/docs/capacity](https://seedsaas.com/docs/capacity).

How much load one Seed server carries, measured with the k6 scenarios in `tests/load/`.

**These are numbers from a developer laptop, not from a production server.** A run on a Hetzner
server of production size is still to do; its numbers will replace these as the ones to plan with.

## The scenarios

| Scenario  | What it does                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browse`  | 100 signed-in people at once. Each lists the 8 notes of its group, opens one, and reads for 1 to 3 seconds.                                                              |
| `write`   | 50 signed-in people at once. Each creates a note, edits it and deletes it, with 0.5 to 1.5 seconds between steps.                                                        |
| `sockets` | 1,000 open WebSockets: 50 people with 20 tabs each, idle for about two minutes. Once a second one of them creates and deletes a note, which their 20 sockets hear about. |

Each scenario ramps up for 30 seconds, holds for 2 minutes and ramps down for 10 seconds. The socket
scenario opens its sockets over 30 seconds and holds them until 150 seconds have passed.

Before a scenario starts, it signs its people up the way a person does, with a mailed code. At the
end it deletes them. Neither part is in the numbers.

The requests go to the API's REST routes (`/api/groups/:groupId/notes`) and its socket (`/api/ws`).
The SPA makes the same reads and writes over the socket, which runs the same handlers.
[Run the load tests](load-tests.md) says how to run them.

## Results

### 2026-10-21, a developer laptop

| Part     | What ran                                                                                    |
| -------- | ------------------------------------------------------------------------------------------- |
| Machine  | AMD Ryzen 9 8945HS (8 cores, 16 threads), 91 GB RAM, Fedora 44, Docker. Other work ran too. |
| Postgres | 18.6, held to 2 CPUs and 2 GB, `max_connections=30`.                                        |
| API      | Held to 1 CPU and 512 MB, a pool of 10 connections, in development mode, without Traefik.   |
| Worker   | Held to half a CPU.                                                                         |
| k6       | 2.3.0 in its container, on the same machine.                                                |

| Scenario  | Requests | p95 latency | Error rate | Postgres CPU (mean / max) | API CPU (mean / max) | Postgres connections (max) |
| --------- | -------- | ----------- | ---------- | ------------------------- | -------------------- | -------------------------- |
| `browse`  | 13,804   | 29.8 ms     | 0.00 %     | 11.0 % / 18.0 %           | 17.6 % / 35.3 %      | 14                         |
| `write`   | 6,828    | 57.5 ms     | 0.00 %     | 14.3 % / 24.7 %           | 15.8 % / 29.9 %      | 14                         |
| `sockets` | 220      | 26.4 ms     | 0.00 %     | 4.2 % / 12.7 %            | 5.1 % / 17.4 %       | 14                         |

CPU is in percent of one core, as `docker stats` gives it, from 38 to 40 samples two seconds apart.
The 14 connections are every client of Postgres: 11 from the API (its pool of 10 and the listener
for group changes), 2 from the worker and 1 from the sampling `psql`. The same 14 are open when the
stack is idle.

For `sockets`, the requests are the pushes' writes. All 1,000 sockets opened (p95 16.3 ms), none
was closed by the server, and they received 4,393 of the 4,400 push frames the 220 writes should
cause.

## What the numbers say

- **No load came near a limit.** The API never passed 36 % of its one CPU, and Postgres never
  passed 25 % of one core. 100 readers, 50 writers or 1,000 idle sockets fit with room to spare. A
  run with more people is what finds the limit.
- **The API's pool capped the connections** at 14 of 30. This run predates PgBouncer
  ([#226](https://github.com/spy4x/seed/issues/226)), which now holds the server connections at 20
  however many processes run.
- **A socket client must answer the server's pings.** The server closes a socket after 90 silent
  seconds, as `@spy4x/realtime` does on purpose. The app's client answers them, and so does the
  scenario.
- **One person may hold at most 20 sockets**, `@spy4x/realtime`'s default. That is why the scenario
  spreads its 1,000 over 50 people.

## One large group

A single group stays within budget up to 10,000 notes (tier M). At 100,000 notes (L), a person
joining it waits about 10 seconds for the first full read, and a search for a common word passes
100 ms. On a device, drawing a 10,000-note list breaks first, long before the server does.
[One large group](large-group.md) holds the measurements and what to fix.

## Next

- [Run the load tests](load-tests.md)
- [One large group](large-group.md)
