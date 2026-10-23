# Backups

With `backup` in `COMPOSE_PROFILES`, a `backup` container saves the database,
`infra/configs/vapid.json` (the web push keys, which exist on the server only) and the bundled file
store ([files.md](files.md)) into a
[restic](https://restic.net) repository when it starts and every 24 hours after. Each database
snapshot is a full `pg_dump`; restic encrypts it and stores only what changed since the last one.
Every snapshot of the last two days is kept, then one per day for a week, one per week for a month
and one per month for half a year. Each snapshot carries the project's `PROJECT` as its host, and
the clean-up, the snapshot list and the restore look at that project's snapshots only. The profile
is off until you set it up, so a new product has no backup before these steps are done.

It saves nothing else. Valkey is a cache. The env file is not in the backup: keep your own copy of
it, since the file store's key is in it.

The file store is Garage's directory, `.volumes/garage`: its data blocks and the copies of its
metadata database that Garage writes every hour (`meta/snapshots`, the two newest). The live
metadata database is left out, since it changes under a copy. A restore therefore stands at the
newest hourly copy: a file uploaded after it, and before the backup ran, is missing from the
restored store, although the restored database can still name it. A product on another S3 store
relies on that store's own backups.

## Set it up

1. Create a place for the repository that is not on the server: a bucket at an S3-compatible
   provider, with a key that may read, write and delete in that bucket only. The Compose file passes
   an S3 key only, and the image has no SSH client, so an `sftp:` address does not work. The key
   sits on the server beside the repository's password, so whoever takes the server can delete the
   backups: turn on versioning or object lock for the bucket if the provider has it. Use one
   repository per project.
2. In the env file you deploy (`infra/envs/.env.prod`), add `backup` to `COMPOSE_PROFILES` and set:
   - `BACKUP_RESTIC_REPOSITORY`: the repository's address in restic's form, such as
     `s3:https://s3.example.com/app-backups`.
   - `BACKUP_RESTIC_PASSWORD`: a long random password. It encrypts the repository; without it no
     snapshot can be read, so keep a copy somewhere that is not the server.
   - `S3_BUCKET_BACKUPS_ACCESS_KEY_ID` and `S3_BUCKET_BACKUPS_SECRET_ACCESS_KEY`: the bucket's key.
3. `deno task deploy`. The container creates the repository on its first run.
4. On the server, in the app's directory, check that a snapshot is there:

   ```sh
   deno task compose run --rm backup restic snapshots
   ```

`docker ps` shows the container as unhealthy when the last complete backup is more than two days
old, and the `BackupMissing` alert ([stack.md](stack.md#alerts)) sends the same news to ntfy. A
project that never switched the profile on gets no such alert. The alert resolves by itself 14 days
after the last complete backup, because the bundled VictoriaMetrics keeps 14 days of data and the
last backup's time is then gone from it. A "resolved" with no new `Backup done.` line in
`deno task compose logs backup` means the backup is still broken.

## When the backup is unhealthy

`deno task compose logs backup` says why a run failed. A failed run is tried again 24 hours later,
or after an hour when the repository was locked.

- **"The repository is locked by another restic process."** A run that was killed half-way (a stop
  during the dump, a reboot, the out-of-memory killer) leaves its lock behind. Every run removes
  such stale locks first: at once when the process that held one is gone from the same container,
  and 30 minutes after it was last refreshed when the lock comes from another container, such as
  the one before a deploy. So the next try after an hour succeeds without anyone's help. Run
  `deno task compose run --rm backup restic unlock` by hand only when you know no other backup
  runs; it removes the same stale locks and no others.
- **"No repository answers at the address yet; creating one."** restic found no repository there,
  which is expected on the first run only. Later, check `BACKUP_RESTIC_REPOSITORY`.
- **"The repository could not be read"**, with restic's own message above it: a wrong password, a
  wrong key, or a network failure.

## Restore

A restore only goes into a database with no tables, so the current database is set aside first,
not overwritten. On the server, in the app's directory, with `<db>` for `DB_NAME`:

1. Stop everything that uses the database:

   ```sh
   deno task compose stop api worker backup postgres-prometheus-exporter
   ```

2. Rename the current database and create an empty one:

   ```sh
   deno task compose exec db psql -d postgres \
     -c 'ALTER DATABASE "<db>" RENAME TO "<db>_before_restore"' -c 'CREATE DATABASE "<db>"'
   ```

3. List the snapshots, choose one by its date, and restore it by its id. The newest is not always
   the right one: a snapshot made after the damage holds the damage. The restore says which
   snapshot it loads, with its time, before it changes anything; without an id it only prints the
   list of this project's database snapshots.

   ```sh
   deno task compose run --rm backup restore
   deno task compose run --rm backup restore <snapshot id>
   ```

4. Start the stack again. Migrations newer than the snapshot are applied as on any start, and
   Valkey is restarted so that the cache holds nothing newer than the database:

   ```sh
   deno task compose restart kv
   deno task compose up -d
   ```

5. When the restored data has proven right, drop `<db>_before_restore` by hand.

### The file store

Restore the files from the same backup run as the database. Even then the two can disagree: a file
uploaded in the hour before the backup can be named by the restored database but missing from the
restored store, since the store comes back as its newest hourly metadata copy. On the server, in
the app's directory:

1. Stop Garage and set its directory aside:

   ```sh
   deno task compose stop garage
   sudo mv .volumes/garage .volumes/garage-before-restore
   ```

2. List the file store's snapshots and restore the one taken with the database's (the times
   match):

   ```sh
   deno task compose run --rm backup restic snapshots --host <project> --tag files
   mkdir restored-files
   deno task compose run --rm -v "$PWD/restored-files:/restored:z" backup \
     restic restore <snapshot id> --target /restored
   ```

3. Put the blocks back, and the newest metadata copy in place of the database. Nothing else of
   `meta` is needed: Garage starts a fresh layout for the node and finds the blocks by their hash.

   ```sh
   sudo mkdir -p .volumes/garage/meta
   sudo mv restored-files/run/files/data .volumes/garage/data
   sudo cp "$(ls -d restored-files/run/files/meta/snapshots/* | tail -n 1)/db.sqlite" \
     .volumes/garage/meta/db.sqlite
   sudo chown -R root:root .volumes/garage && rm -r restored-files
   deno task compose up -d garage
   ```

4. When the files have proven right, delete `.volumes/garage-before-restore`.

### On a new server

A new server's backup container would save its empty database as soon as it starts, once a day,
into the same repository. With the clean-up rule above, the newest backup from the old server is
deleted on the seventh day that runs; only older ones are left. So keep the backup off until the
restore is done:

1. Deploy with `backup` taken out of `COMPOSE_PROFILES` in the env file. The deploy creates a
   database with empty tables and new web push keys.
2. Restore the database with the steps above, choosing the last snapshot from before the old server
   failed.
3. Before step 4 of those steps, put the old web push keys back in place of the new ones, so the
   push subscriptions people already gave keep working (`<project>` is `PROJECT` in the env file).
   The commands assume the server's SSH user is uid 1000, the user the `backup` and `api`
   containers run as:

   ```sh
   mkdir -m 700 restored-keys
   deno task compose run --rm -v "$PWD/restored-keys:/restored:z" backup \
     restic dump --host <project> --tag vapid --target /restored/vapid.json latest /vapid.json
   mv restored-keys/vapid.json infra/configs/vapid.json && chmod 600 infra/configs/vapid.json
   rmdir restored-keys
   ```

4. Restore the file store with the steps above, from the same night as the database.
5. Put `backup` back into `COMPOSE_PROFILES` and deploy again.

To rehearse a restore without touching the live database, create a spare one and name it:
`deno task compose run --rm -e PGDATABASE=<spare> backup restore <snapshot id>`.

`deno task test:backup` runs the same backup and restore against a throwaway Postgres
(`infra/backup/restore.test.sh`), and CI runs it on every pull request.
