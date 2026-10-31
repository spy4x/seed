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
   OPERATION_COMMANDS_PER_MINUTE=1000000
   OPERATION_QUERIES_PER_MINUTE=1000000
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

## One large group

How one group behaves as it grows from a thousand notes to a million: the first full read of a
person who joins it, a page of the list, a search, a write, the pull after one change, and many
people reading it at once. It answers "how big can one group get before it hurts" for
[#440](https://github.com/spy4x/seed/issues/440).

### The tiers

`deno task load:group <tier>` (`tests/load/group.ts`) writes one group straight into Postgres, with
rows shaped as the app writes them: version 7 ids, change sequences in the order of each note's
last change, tombstones for deleted notes, tags on notes, members with every role, an activity log
and notifications.

| Tier | Notes     | Tags | Members | Activity rows | Notifications | Spread over | Build time |
| ---- | --------- | ---- | ------- | ------------- | ------------- | ----------- | ---------- |
| S    | 1,000     | 20   | 10      | 1,000         | 1,000         | 1 year      | under 1 s  |
| M    | 10,000    | 50   | 100     | 10,000        | 10,000        | 1 year      | 3 s        |
| L    | 100,000   | 100  | 1,000   | 100,000       | 100,000       | 2 years     | 19 s       |
| XL   | 1,000,000 | 100  | 1,000   | 100,000       | 100,000       | 4 years     | about 2 min |

A note has 10 to 99 words and 0 to 3 tags; one in five was edited, one in fifty of last month's
notes is deleted, and one in a thousand has the rare word `zeppelin` in its title. Tags stop at 100, the cap every group has. The
members are generated people without a sign-in key, so nobody can sign in as one.

The task is safe to run twice. Each tier has a fixed group id: a finished group is left as it is,
and a group a stopped run left half built is removed and built again. It prints the group's id and
name. It changes nothing but its own rows:

- `--member <email>` adds an existing account to the group as an editor, with the tier's
  notifications in its inbox, so you can open the group in the SPA. Repeat it for more people.
- `--remove [tier]...` deletes the named tiers, or all four: the group with everything in it, the
  generated people (only those without a sign-in key, so a real member stays), the notifications
  it wrote and the group's activity rows. It then vacuums the tables, because a million deleted rows
  left in the indexes slow every search until autovacuum reaches them.
- `--explain <tier>` prints the plans of the queries below with `EXPLAIN (ANALYZE, BUFFERS)`, and
  the table and index sizes. The write's plan runs in a transaction that is rolled back.

It refuses an env file whose `ENV` is not `dev` and whose `DEMO_MODE` is not `true`, so it never
writes into a production database. It connects to `127.0.0.1` only (the task's network grant
allows no other host), on the stack's published port or the one `--port` names.

### Running it

Locally, with the rate limits lifted as in "Running it" above:

```sh
deno task compose up -d kv api worker
deno task load:group L --member you@example.com
deno task load group L        # one reader: full read, page, searches, write, pull, members
deno task load group-reads L  # 1, 2, 4, 8, 16 and 32 readers at once, 30 s each
deno task load:group --explain L
deno task load:group --remove
```

On the public demo, through an SSH tunnel to the database port the server publishes on its own
loopback (`DB_HOST_PORT` in `infra/envs/.env.prod`; `<SSH_TO_SERVER>` as in
[deploy.md](deploy.md)):

```sh
ssh -N -L 15432:127.0.0.1:<DB_HOST_PORT's port> <SSH_TO_SERVER>
deno task load:group M --env-file infra/envs/.env.prod --port 15432 --member you@example.com
deno task load:group --remove --env-file infra/envs/.env.prod --port 15432
```

The demo's nightly wipe removes the group too. Build M at most there: the server is shared with
other projects, and an L or XL group costs it minutes of database CPU on every full read. The k6
scenarios run against the local stack only.

### Results, 2026-10-31, a developer laptop

The same machine and stack as above: Postgres 18.6 held to 2 CPUs and 2 GB (`shared_buffers`
512 MB, `work_mem` 16 MB), the API to 1 CPU and 512 MB, PgBouncer between them, k6 2.3.0 in its
container. Each tier was built alone, in a database holding no other load group. Other work ran on
the machine at the same time.

**One reader** (`deno task load group <tier>`): five iterations, one at XL. The full read is its
median, with its pages of 500 changes and its size; every other column is the p95.

| Tier | Full read                        | Page of 100 | Search: common / pair / rare | Write   | Pull after the write | Members | API memory (max) |
| ---- | -------------------------------- | ----------- | ---------------------------- | ------- | -------------------- | ------- | ---------------- |
| S    | 98 ms, 3 pages, 0.78 MB          | 72.8 ms     | 39.5 / 28.1 / 27.8 ms        | 36.6 ms | 28.5 ms              | 18.5 ms | 176 MiB          |
| M    | 436 ms, 21 pages, 7.8 MB         | 12.4 ms     | 41.8 / 25.8 / 21.4 ms        | 19.7 ms | 10.8 ms              | 13.6 ms | 179 MiB          |
| L    | 9.65 s, 201 pages, 78 MB         | 15.4 ms     | 163.9 / 94.5 / 17.6 ms       | 21.0 ms | 30.9 ms              | 15.0 ms | 186 MiB          |
| XL   | 854 s (14 min), 2,001 pages, 780 MB | 13.5 ms  | 2,446 / 1,518 / 52.8 ms      | 88.6 ms | 11.9 ms              | 22.4 ms | 198 MiB          |

S's page p95 is one slow sample of five; its median is 19.8 ms. L's slowest full read took
10.07 s.

**Parallel full reads** (`deno task load group-reads <tier>`): each reader reads the whole group
again as soon as its last read ends. The first number is the p95 of the requests, the second the
p95 of a whole full read ("none" when no read finished within the 30-second step). CPU is the mean
in percent of one core; Postgres has 2 cores, the API 1.

| Readers | S                | M                | L                  | XL               |
| ------- | ---------------- | ---------------- | ------------------ | ---------------- |
| 1       | 36.9 ms / 117 ms | 26.6 ms / 485 ms | 83.4 ms / 10.7 s   | 792 ms / none    |
| 2       | 51.6 ms / 137 ms | 35.0 ms / 562 ms | 170 ms / 16.3 s    | 1,864 ms / none  |
| 4       | 92.7 ms / 217 ms | 60.7 ms / 795 ms | 410 ms / none      | 3,707 ms / none  |
| 8       | 140 ms / 320 ms  | 94.9 ms / 1.3 s  | 972 ms / none      | 5,526 ms / none  |
| 16      | 218 ms / 532 ms  | 158 ms / 2.4 s   | 1,690 ms / none    | 12,710 ms / none |
| 32      | 391 ms / 1.0 s   | 287 ms / 4.9 s   | 3,006 ms / none    | 21,236 ms / none |
| Postgres CPU | 23–49 %     | 33–93 %          | 171–199 %          | 197–200 %        |
| API CPU | 45–97 %          | 44–98 %          | 18–21 %            | 4–8 %            |

Only L's step of 32 readers had errors (0.23 %).

**Postgres's own time** (`--explain`), in milliseconds:

| Query                                     | S    | M    | L     | XL    |
| ----------------------------------------- | ---- | ---- | ----- | ----- |
| Changes pull: page boundary, first page   | 1.7  | 6.4  | 143   | 741   |
| Changes pull: page boundary, middle page  | 0.9  | 2.1  | 20    | 778   |
| Changes pull: the notes of one page       | 2.4  | 1.4  | 1.2   | 2.8   |
| Notes list, first page of 100             | 1.5  | 0.3  | 0.3   | 0.4   |
| Search "budget" (31 % of notes match)     | 2.3  | 7.6  | 100   | 2,186 |
| Search "budget invoice"                   | 2.0  | 6.2  | 40    | 1,443 |
| Search "zeppelin" (0.1 % match)           | 1.1  | 4.5  | 1.6   | 1,469 |
| Write: next change sequence, insert       | 1.0  | 0.7  | 0.7   | 5.3   |
| Activity, first page of 100               | 1.0  | 6.4  | 67    | 0.8   |
| Notifications, first page and unread count | 0.4 | 2.6  | 7.9   | 31    |

At XL the `notes` table holds 1.23 GB of rows and 361 MB of indexes; the largest are the search
index (135 MB), the list's `(group_id, updated_at, id)` index (111 MB), the primary key (57 MB)
and `(group_id, change_sequence)` (43 MB). `note_tags` adds 86 MB and 115 MB. Removing the group
and vacuuming frees that space for new rows but does not give it back to the disk; only
`VACUUM FULL` does.

### Where the budgets break

| Measure                    | Budget   | First tier over it                                                    |
| -------------------------- | -------- | --------------------------------------------------------------------- |
| Full read, one reader      | 10 s     | L: median 9.65 s, the slowest 10.07 s. XL takes 14 minutes.           |
| Page of the list           | 200 ms   | None: 13.5 ms at XL.                                                  |
| Search                     | 100 ms   | L: 164 ms for a common word. XL: 1.5 to 2.4 s for any word.           |
| Write                      | 200 ms   | None: 88.6 ms at XL.                                                  |
| Requests' p95, parallel full reads | 1 s | L at 16 readers; XL at 2. S and M stay under it at 32.        |

A whole full read passes 1 s sooner: at M with 8 readers, and at S with 32.

### What breaks first, and what to do

1. **The changes pull reads every change after the cursor, for every page.** To find where a page
   of 500 ends, `libs/server/groups/group-changes.ts` sorts the union of all changes after the
   cursor and skips 500 (`ORDER BY changes.sequence OFFSET 500 LIMIT 1`). Postgres reads them all
   first: 100,000 live notes per page at L's first page, 500,000 at XL's middle one. A full read
   therefore costs the square of the group's size: 201 pages in 9.6 s at L, 2,001 pages in
   14 minutes at XL. Postgres's two cores are full from one reader at L, and the API waits. The
   fix is to let each part of the union stop at 501 rows (`ORDER BY change_sequence LIMIT 501`
   inside each branch, which the `(group_id, change_sequence)` indexes serve in order), so a page
   costs the same at any size. This was not tried here; it is the next change to measure.
2. **Search ranks every match.** At L "budget" matches 31,000 notes, and ranking all of them takes
   100 ms. At XL the planner gives the search index up and walks all million notes of the group,
   so even the rare word takes 1.5 s. The search index (`idx_notes_search_vector_active`) also
   holds every group's notes, so its cost grows with the whole database, not with the group. A
   search index that starts with the group (`btree_gin`'s `(group_id, search_vector)`), and
   ranking only the newest few thousand matches of a common word, would keep it within budget.
3. **A million-note first read is 780 MB.** Even with item 1 fixed, a phone joining an XL group
   downloads every note body. A group past L needs its first read to bring the recent notes
   first and the rest later, which is a product decision as much as a query.
4. **Deleting a large group slows search for everyone until autovacuum runs.** After an XL group
   was removed, searching for a common word in a 1,000-note group took 1.4 to 3.3 s until the
   tables were vacuumed.
   The generator vacuums after `--remove`; the app's own group deletion does not.
5. **More CPU is not the answer yet.** At S and M the API's one core fills first (from 8 readers)
   while Postgres idles; from L on, Postgres's two cores fill with one or two readers. Item 1 moves
   L and XL back to the S and M pattern; only then does adding cores buy capacity.

<details>
<summary>The changes pull's page boundary at XL, middle page (778 ms)</summary>

```
Limit  (actual time=745.981..777.224 rows=1.00 loops=1)
  ->  Gather Merge
        Workers Launched: 2
        ->  Sort  (actual time=727.230..727.246 rows=501.00 loops=3)
              Sort Key: tags.change_sequence
              Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Append
                    ->  Index Only Scan using idx_tags_group_change_sequence on tags  (rows=0.00)
                    ->  Index Only Scan using idx_group_change_tombstones_group_sequence on group_change_tombstones  (rows=411.00)
                    ->  Parallel Index Scan using idx_notes_group_change_sequence on notes  (actual time=1.419..711.098 rows=166546.33 loops=3)
Execution Time: 777.841 ms
```

Three workers read 500,000 notes to find the 501st.

</details>

<details>
<summary>The changes pull's page boundary at L, first page (143 ms)</summary>

```
Limit  (actual time=132.073..142.582 rows=1.00 loops=1)
  ->  Gather Merge  (actual time=132.025..142.569 rows=501.00 loops=1)
        ->  Sort  (actual time=125.975..125.991 rows=396.67 loops=3)
              Sort Key: tags.change_sequence
              ->  Parallel Append  (actual time=68.702..124.982 rows=33339.33 loops=3)
                    ->  Seq Scan on tags  (rows=100.00 loops=1)
                    ->  Parallel Bitmap Heap Scan on notes  (actual time=102.320..123.509 rows=33306.00 loops=3)
                          Recheck Cond: (deleted_at IS NULL)
                          Filter: ((change_sequence > '0'::bigint) AND (group_id = '019a3a40-…-000000000003'::uuid))
                          ->  Bitmap Index Scan on idx_notes_search_vector_active  (rows=111009.00)
Execution Time: 142.756 ms
```

The planner uses the search index only because it covers exactly the live notes, and reads all
100,000 of them.

</details>

<details>
<summary>Search "budget" at XL (2,186 ms)</summary>

```
Limit  (actual time=2183.807..2183.813 rows=20.00 loops=1)
  ->  Sort  (actual time=2183.806..2183.809 rows=20.00 loops=1)
        Sort Key: (ts_rank(notes_1.search_vector, '''budget'':*'::tsquery)) DESC, notes_1.updated_at DESC, notes_1.id
        ->  Merge Join  (actual time=0.332..2138.491 rows=309182.00 loops=1)
              ->  Materialize  (actual time=0.034..2051.082 rows=309182.00 loops=1)
                    Storage: Disk  Maximum Storage: 405936kB
                    ->  Index Scan using idx_notes_group_change_sequence on notes notes_1  (actual time=0.016..1602.882 rows=309182.00 loops=1)
                          Filter: ((deleted_at IS NULL) AND (search_vector @@ '''budget'':*'::tsquery))
                          Rows Removed by Filter: 690818
Execution Time: 2185.575 ms
```

"zeppelin" takes the same path: 999,000 rows removed by the filter to find 1,000, in 1,469 ms.

</details>

<details>
<summary>Search "budget" at L (100 ms)</summary>

```
->  Bitmap Heap Scan on notes notes_1  (actual time=8.723..24.872 rows=30938.00 loops=1)
      ->  Bitmap Index Scan on idx_notes_search_vector_active  (actual time=7.396..7.397 rows=34231.00 loops=1)
Execution Time: 100.341 ms
```

Finding the matches takes 25 ms; ranking the 30,938 of them takes the rest.

</details>
