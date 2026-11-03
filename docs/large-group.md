# One large group

> Also on the website: [seedsaas.com/docs/large-group](https://seedsaas.com/docs/large-group).

How one group behaves as it grows from a thousand notes to a million, and what breaks first. It
answers "how big can one group get before it hurts" for
[#440](https://github.com/spy4x/seed/issues/440).

**These are numbers from a developer laptop**, the machine of [Capacity](capacity.md#results).
[Run the load tests](load-tests.md#one-large-group) says how to reproduce them.

## The tiers

| Tier | Notes     | Tags | Members | Activity rows | Notifications | Spread over | Build time  |
| ---- | --------- | ---- | ------- | ------------- | ------------- | ----------- | ----------- |
| S    | 1,000     | 20   | 10      | 1,000         | 1,000         | 1 year      | under 1 s   |
| M    | 10,000    | 50   | 100     | 10,000        | 10,000        | 1 year      | 3 s         |
| L    | 100,000   | 100  | 1,000   | 100,000       | 100,000       | 2 years     | 19 s        |
| XL   | 1,000,000 | 100  | 1,000   | 100,000       | 100,000       | 4 years     | about 2 min |

A note has 10 to 99 words and 0 to 3 tags. One in five was edited, one in fifty of last month's
notes is deleted, and one in a thousand has the rare word `zeppelin` in its title. Tags stop at 100,
the cap every group has. The members are generated people without a sign-in key, so nobody can sign
in as one.

To build or remove a tier, see [Run the load tests](load-tests.md#one-large-group).

## Where the budgets break

| Measure                            | Budget | First tier over it                                                                                                                                     |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full read, one reader              | 10 s   | L: median 9.65 s, the slowest 10.07 s. XL takes 14 minutes.                                                                                            |
| Page of the list                   | 200 ms | None: 13.5 ms at XL.                                                                                                                                   |
| Search                             | 100 ms | L: 164 ms for a common word. XL: 0.6 s for a common word, 0.8 s for a pair; the rare word stays under it (18 ms in Postgres, 52.8 ms through the API). |
| Write                              | 200 ms | None: 88.6 ms at XL.                                                                                                                                   |
| Requests' p95, parallel full reads | 1 s    | L at 16 readers; XL at 2. S and M stay under it at 32.                                                                                                 |

A whole full read passes 1 s sooner: at M with 8 readers, and at S with 32.

## What breaks first, and what to do

1. **The changes pull reads every change after the cursor, for every page.** To find where a page
   of 500 ends, `libs/server/groups/group-changes.ts` sorts all changes after the cursor and skips
   500. A full read therefore costs the square of the group's size: 9.6 s at L, 14 minutes at XL.
   The fix, and the next change to measure, is a `LIMIT 501` inside each branch of the union, so a
   page costs the same at any size.
2. **Search ranks every match.** At XL "budget" matches 309,000 notes, and ranking them takes
   580 ms; at L, finding its 31,000 matches takes 25 ms and ranking them the rest of 100 ms. A rare
   word stays fast at every tier, and the index's cost grows with the whole database, since it
   holds every group's notes. An index that starts with the group (`btree_gin`'s
   `(group_id, search_vector)`), and ranking only the newest few thousand matches, would keep it
   within budget.
3. **A million-note first read is 780 MB.** Even with item 1 fixed, a phone joining an XL group
   downloads every note body. A group past L needs its first read to bring the recent notes first,
   which is a product decision as much as a query.
4. **Deleting a large group slows search for everyone until autovacuum runs.** After an XL group
   was removed, a common-word search in a 1,000-note group took 1.4 to 3.3 s until the tables were
   vacuumed. The generator vacuums after `--remove`; the app's own group deletion does not.
5. **More CPU is not the answer yet.** At S and M the API's one core fills first, from 8 readers.
   From L on, Postgres's two cores fill with one or two readers. Item 1 moves L and XL back to the
   S and M pattern; only then does adding cores buy capacity.

## Results, 2026-10-31

Postgres 18.6 was held to 2 CPUs and 2 GB (`shared_buffers` 512 MB, `work_mem` 16 MB), the API to
1 CPU and 512 MB, with PgBouncer between them. Each tier was built alone, in a database holding no
other load group.

**One reader** (`deno task load group <tier>`): five iterations, one at XL. The full read is its
median, with its pages of 500 changes and its size. Every other column is the p95.

| Tier | Full read                           | Page of 100 | Search: common / pair / rare | Write   | Pull after the write | Members | API memory (max) |
| ---- | ----------------------------------- | ----------- | ---------------------------- | ------- | -------------------- | ------- | ---------------- |
| S    | 98 ms, 3 pages, 0.78 MB             | 72.8 ms     | 39.5 / 28.1 / 27.8 ms        | 36.6 ms | 28.5 ms              | 18.5 ms | 176 MiB          |
| M    | 436 ms, 21 pages, 7.8 MB            | 12.4 ms     | 41.8 / 25.8 / 21.4 ms        | 19.7 ms | 10.8 ms              | 13.6 ms | 179 MiB          |
| L    | 9.65 s, 201 pages, 78 MB            | 15.4 ms     | 163.9 / 94.5 / 17.6 ms       | 21.0 ms | 30.9 ms              | 15.0 ms | 186 MiB          |
| XL   | 854 s (14 min), 2,001 pages, 780 MB | 13.5 ms     | 2,446 / 1,518 / 52.8 ms      | 88.6 ms | 11.9 ms              | 22.4 ms | 198 MiB          |

S's page p95 is one slow sample of five; its median is 19.8 ms. L's slowest full read took 10.07 s.
XL's API searches come from an earlier run, on a database where earlier tiers had been built and
removed. On a fresh database Postgres needs 0.6 and 0.8 s for the common word and the pair (below).

**Parallel full reads** (`deno task load group-reads <tier>`): each reader reads the whole group
again as soon as its last read ends. The first number is the p95 of the requests, the second the
p95 of a whole full read ("none" when none finished within the 30-second step). CPU is the mean in
percent of one core. Only L's step of 32 readers had errors (0.23 %).

| Readers      | S                | M                | L                | XL               |
| ------------ | ---------------- | ---------------- | ---------------- | ---------------- |
| 1            | 36.9 ms / 117 ms | 26.6 ms / 485 ms | 83.4 ms / 10.7 s | 792 ms / none    |
| 2            | 51.6 ms / 137 ms | 35.0 ms / 562 ms | 170 ms / 16.3 s  | 1,864 ms / none  |
| 4            | 92.7 ms / 217 ms | 60.7 ms / 795 ms | 410 ms / none    | 3,707 ms / none  |
| 8            | 140 ms / 320 ms  | 94.9 ms / 1.3 s  | 972 ms / none    | 5,526 ms / none  |
| 16           | 218 ms / 532 ms  | 158 ms / 2.4 s   | 1,690 ms / none  | 12,710 ms / none |
| 32           | 391 ms / 1.0 s   | 287 ms / 4.9 s   | 3,006 ms / none  | 21,236 ms / none |
| Postgres CPU | 23–49 %          | 33–93 %          | 171–199 %        | 197–200 %        |
| API CPU      | 45–97 %          | 44–98 %          | 18–21 %          | 4–8 %            |

**Postgres's own time** (`--explain`), in milliseconds. XL's column is one run on a fresh database:
the times move with the cache, the plans do not.

| Query                                      | S   | M   | L   | XL    |
| ------------------------------------------ | --- | --- | --- | ----- |
| Changes pull: page boundary, first page    | 1.7 | 6.4 | 143 | 656   |
| Changes pull: page boundary, middle page   | 0.9 | 2.1 | 20  | 1,048 |
| Changes pull: the notes of one page        | 2.4 | 1.4 | 1.2 | 1.9   |
| Notes list, first page of 100              | 1.5 | 0.3 | 0.3 | 0.5   |
| Search "budget" (31 % of notes match)      | 2.3 | 7.6 | 100 | 580   |
| Search "budget invoice"                    | 2.0 | 6.2 | 40  | 814   |
| Search "zeppelin" (0.1 % match)            | 1.1 | 4.5 | 1.6 | 18    |
| Write: next change sequence, insert        | 1.0 | 0.7 | 0.7 | 1.9   |
| Activity, first page of 100                | 1.0 | 6.4 | 67  | 0.4   |
| Notifications, first page and unread count | 0.4 | 2.6 | 7.9 | 14    |

At XL the `notes` table holds 1.23 GB of rows and 361 MB of indexes. Removing the group and
vacuuming frees that space for new rows, but only `VACUUM FULL` gives it back to the disk.

<details>
<summary>The changes pull's page boundary at XL, middle page (1,048 ms)</summary>

```text
Limit  (actual time=1021.577..1047.815 rows=1.00 loops=1)
  ->  Gather Merge  (actual time=1018.371..1044.653 rows=501.00 loops=1)
        Workers Launched: 2
        ->  Sort  (actual time=1003.946..1003.960 rows=501.00 loops=3)
              Sort Key: group_change_tombstones.change_sequence
              Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Append  (actual time=3.279..998.000 rows=166683.33 loops=3)
                    ->  Index Only Scan using idx_group_change_tombstones_group_sequence on group_change_tombstones  (rows=411.00)
                    ->  Index Only Scan using idx_tags_group_change_sequence on tags  (rows=0.00)
                    ->  Parallel Index Scan using idx_notes_group_change_sequence on notes  (actual time=1.749..987.642 rows=166546.33 loops=3)
Execution Time: 1048.199 ms
```

Three workers read 500,000 notes to find the 501st.

</details>

<details>
<summary>The changes pull's page boundary at L, first page (143 ms)</summary>

```text
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
<summary>Search "budget" at L (100 ms)</summary>

```text
->  Bitmap Heap Scan on notes notes_1  (actual time=8.723..24.872 rows=30938.00 loops=1)
      ->  Bitmap Index Scan on idx_notes_search_vector_active  (actual time=7.396..7.397 rows=34231.00 loops=1)
Execution Time: 100.341 ms
```

Finding the matches takes 25 ms; ranking the 30,938 of them takes the rest.

</details>

<details>
<summary>Search "budget" at XL (580 ms)</summary>

```text
Limit  (actual time=562.389..578.572 rows=20.00 loops=1)
  ->  Gather Merge  (actual time=557.008..573.190 rows=20.00 loops=1)
        Workers Launched: 2
        ->  Sort  (actual time=544.361..544.365 rows=16.67 loops=3)
              Sort Key: (ts_rank(notes_1.search_vector, '''budget'':*'::tsquery)) DESC, notes_1.updated_at DESC, notes_1.id
              Sort Method: top-N heapsort  Memory: 94kB
              ->  Hash Join  (actual time=4.810..501.478 rows=103060.67 loops=3)
                    ->  Parallel Seq Scan on notes notes_1  (actual time=4.680..466.544 rows=103060.67 loops=3)
                          Filter: ((deleted_at IS NULL) AND (search_vector @@ '''budget'':*'::tsquery))
                          Rows Removed by Filter: 230273
Execution Time: 580.164 ms
```

"budget invoice" uses the search index (109,117 entries), then sorts its 109,000 matches on disk
(`external merge  Disk: 61960kB`), in 814 ms. "zeppelin" uses the index too and finds its 1,000
notes in 18 ms.

</details>

## On devices

Tier M (9,984 notes), 2026-10-31, production build. The PC is a 16-core developer machine in
headless Chromium 143. The low-end phone is the same Chromium at 390 × 844 with touch and the CPU
slowed 6 times.

| Measure (budget)              | PC         | Emulated low-end phone |
| ----------------------------- | ---------- | ---------------------- |
| Download (10 s on 4G)         | 0.64 s     | 1.48 s                 |
| Save to this device           | 3.1 s      | 2.9 s                  |
| Start offline (1 s)           | 0.35 s     | 0.69 s                 |
| First notes (1 s)             | **5.3 s**  | **41.5 s**             |
| Scroll (5% of frames dropped) | **95.1%**  | **99.8%**              |
| Search (100 ms)               | **138 ms** | **680 ms**             |
| Filter (100 ms)               | 1.3 ms     | 6.1 ms                 |
| Memory used by the page       | 679 MB     | 822 MB                 |
| Storage used on this device   | 17.9 MB    | 26.3 MB                |

Bold is over budget. Downloading and storing a 10,000-note group is cheap; drawing it is not. The
notes list draws every note at once, so the first notes, scrolling and search break first on every
device ([#596](https://github.com/spy4x/seed/issues/596)). Real phones, tablets and laptops are not
measured yet.

## Next

- [Run the load tests](load-tests.md)
- [Capacity](capacity.md)
