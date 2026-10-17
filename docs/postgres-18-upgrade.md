# Moving a server from Postgres 16 to Postgres 18

The Compose file runs Postgres 18. A server or a development machine that ran this template on
Postgres 16 has to move its data once, with `deno task db:upgrade-18`. A machine that starts on
Postgres 18 needs nothing from this page.

## Why a deploy alone is not enough

Postgres 18 cannot open a version 16 data directory, and its image keeps data in a different
place (`/var/lib/postgresql`, with a folder named after the version inside). So the Postgres 18
container gets a host directory of its own, `.volumes/postgres18`, and the Postgres 16 data stays
where it was, in `.volumes/postgres`, untouched.

Left like that, the first deploy would start an empty Postgres 18, run the migrations on it and
serve an app with no users. `deno task compose` therefore refuses every command that can start the
database (`up`, `start`, `restart`, `run`, `create`, `scale`, `watch`) while `.volumes/postgres`
exists and no upgrade has finished:

```text
Refusing to start: ./.volumes/postgres holds a Postgres 16 database, and Postgres 18 keeps its
data in ./.volumes/postgres18. Starting now would serve an empty database. Nothing was changed.
```

**What you see when you deploy without upgrading:** `deno task deploy` copies the files and then
fails at "Starting the app" with that message. The containers that were running keep running:
Postgres 16, the old API and the old worker still serve the app. Nothing is lost and nothing is
empty; the deploy is simply not finished until the upgrade has run.

The check lives in `deno task compose` (`infra/scripts/postgres-data.ts`), which is what the
deploy and `deno task dev` run. `docker compose up` typed by hand goes around it and would start
the empty database: do not start this stack that way on a machine that still has
`.volumes/postgres`.

The same check refuses after a rollback, with a message that says "Postgres 16 ran again": see
"Rolling back".

## The upgrade

It needs free disk space for one plain-text dump and one new data directory, each about the size
of the database. The app is down from the moment the API and the worker stop until they are back.
In the rehearsal (87 MB, 110,562 rows in 40 tables) that was 31 seconds; a dump and a restore
grow with the data, so expect roughly proportionally more.

Run step 2 inside `tmux` or `screen`, so a lost SSH connection does not interrupt it. Do not run
`deno task compose down` before it: the script dumps from the running Postgres 16 container.

Postgres' memory settings now fit a container limit of 2048 MB (`DB_MEM_LIMIT=2048m`, the
example's value). If the server's `infra/envs/.env` sets a larger `DB_MEM_LIMIT`, set the five
`DB_SHARED_BUFFERS`-style variables listed under it in `infra/envs/.env.example` before step 1, or
Postgres 18 starts with 512 MB of shared buffers whatever the limit.

1. On your machine, deploy this version. It stops at "Starting the app" as described above, with
   the new files on the server and the old containers still running.

   ```bash
   deno task deploy
   ```

2. On the server, in the app's directory (`PATH_ON_SERVER`), run the upgrade.

   ```bash
   deno task db:upgrade-18
   ```

3. Check it: the database answers as 18, every container is up, and you can sign in.

   ```bash
   deno task compose ps
   docker exec <PROJECT>-db psql -U <DB_USER> -d <DB_NAME> -Atc 'show server_version'
   ```

What the script does, in order (`infra/scripts/db-upgrade-18.ts`):

1. Fetches the Postgres 18 image and builds the others while everything still runs. If the image
   cannot be fetched, it stops here and nothing was changed.
2. Stops the API and the worker, so nothing writes any more.
3. Counts the rows of every table in every database and dumps the whole server with `pg_dumpall`
   into `.db-upgrade/postgres-16-<time>.sql`, readable by you only. If the count or the dump
   fails, or the dump is cut short, it starts the API and the worker again and stops: nothing
   else was changed. What the failed dump wrote stays beside it as `….sql.partial`; it is not a
   backup and can be deleted.
4. Stops Postgres 16 and starts Postgres 18 on the new, empty `.volumes/postgres18`. On a server
   whose project network was made from an older definition (one last deployed before the fixed
   subnet was removed), Compose has to recreate that network and cannot while any container runs
   on it, so the script removes every container of the project first: the SPA and the rest are
   down too from here until step 7, which creates them all again.
5. Restores the dump and counts the rows again. A table that is missing or extra, or a count that
   differs, fails the upgrade. So does any restore error other than the two a fresh server always
   gives (its own role and database exist already).
6. Writes `.volumes/postgres18/upgraded-from-16`. From here on `deno task compose` starts the
   database again.
7. Runs `compose up -d`: the `migrate` service applies the pending migrations, then the API, the
   worker and everything else start.

It ends with the number of rows and tables that matched and how long the apps were down. Run a
second time, it finds the marker, says "Already upgraded" and changes nothing.

The script never renames, writes or deletes `.volumes/postgres`.

## When it fails

- **Before Postgres 18 started** (the message ends "Nothing was changed"): the server is as it
  was, on Postgres 16, with the apps running. Fix the cause and run the upgrade again.
- **After Postgres 18 started** (the message says "The upgrade failed"): the database, the API and
  the worker are stopped (on a server whose network had to be recreated, every container of the
  project is removed), and `deno task compose up` is still refused, so the half-filled database
  is never served. Roll back as below to bring the app back, then find the cause.
- **"The data is on Postgres 18 … but the apps did not start"**: the move is done and marked; a
  migration or an app failed afterwards. Read its log (`deno task compose logs migrate`), fix it
  and run `deno task compose up -d`.

### When the run is interrupted

Ctrl-C, or a signal from a closed terminal, is handled like this:

- **Until the dump is whole**, the script stops, starts the API and the worker again and ends with
  "Interrupted … Nothing was changed".
- **Once it says "From here on the run cannot be stopped"**, it carries on to the end, because
  stopping there would leave the server without a database. Ctrl-C in a terminal also reaches the
  command the script is running at that moment; if that command dies, the run ends as "The upgrade
  failed" above.

When the script itself was killed, or the server went down, nothing put the apps back, and the
dump it was writing in `.db-upgrade` is partial although its name ends in `.sql`: delete it. Find
where the run stopped:

```bash
deno task compose ps --all
ls .volumes
```

- **There is no `.volumes/postgres18`**: Postgres 16 was never replaced. Either run
  `deno task db:upgrade-18` again, which does the whole upgrade from the start, or bring the app
  back as it was. `deno task compose start` is refused here, so start the old containers by name;
  starting a container that already runs does nothing.

  ```bash
  docker start <PROJECT>-db <PROJECT>-api <PROJECT>-worker
  ```

  The upgrade also needs that first container: when it answers "The database container does not
  answer", run `docker start <PROJECT>-db` and then the upgrade again.
- **`.volumes/postgres18` is there without `upgraded-from-16` in it**: the script answers "an
  upgrade never finished". Roll back as below, move that directory away, then upgrade again.

## Rolling back

Rolling back is starting Postgres 16 on the old directory again, which is what the previous
version's Compose file does. Everything written to Postgres 18 since the upgrade is lost: the old
directory holds the data as it was when the API and the worker stopped.

On your machine, deploy the last commit before this change. A deploy from an older commit replaces
every newer file on the server, the Compose file included.

```bash
git switch --detach <last commit that ran Postgres 16>
deno task deploy
git switch -
```

In the rehearsal the rollback took 9 seconds, and Postgres 16 showed the same 110,562 rows it had
before the upgrade.

### Upgrading again after a rollback

`.volumes/postgres18` still holds the copy from before the rollback, and its marker. Postgres 16
changes its own directory every time it starts, so `deno task compose` sees that it ran after the
marker was written and refuses to start Postgres 18 on that older copy:

```text
Refusing to start: ./.volumes/postgres changed after the upgrade to Postgres 18 finished, so
Postgres 16 ran again (a rollback) and ./.volumes/postgres18 misses everything written since.
```

So deploying this version again stops at "Starting the app" with Postgres 16 still serving, as on
the first deploy, and `deno task db:upgrade-18` refuses with "this server was rolled back". On
the server, move the stale directory away, then upgrade:

```bash
sudo mv .volumes/postgres18 .volumes/postgres18-rolled-back-$(date +%F)
deno task db:upgrade-18
```

The check compares two modification times: `.volumes/postgres` itself and the marker. If you
created or removed a file directly in `.volumes/postgres` by hand after an upgrade and Postgres 16
never ran again, the refusal is a false alarm; `sudo touch .volumes/postgres18/upgraded-from-16`
clears it.

## Afterwards

The old data directory and the dump stay on the server until you remove them by hand. Keep them
until you trust the new database and a backup of it exists (docs/backups.md).
Once `.volumes/postgres` is gone, rolling back is no longer possible.

```bash
sudo rm -r .volumes/postgres .db-upgrade
```

## On a development machine

`deno task dev` gives the same refusal when `.volumes/postgres` exists. To keep the data, run
`deno task db:upgrade-18` while the old containers are still running (if they are stopped, start
them from the last commit that ran Postgres 16). To start empty instead, delete
`.volumes/postgres`, run `deno task dev` and then `deno task db:seed`.
