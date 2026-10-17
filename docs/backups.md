# Backups

With `backup` in `COMPOSE_PROFILES`, a `backup` container saves the database into a
[restic](https://restic.net) repository when it starts and every 24 hours after. Each snapshot is a
full `pg_dump` of the database; restic encrypts it and stores only what changed since the last one.
Every snapshot of the last two days is kept, then one per day for a week, one per week for a month
and one per month for half a year. The profile is off until you set it up, so a new product has no
backup before these steps are done.

It saves the database only. Valkey is a cache, and the template bundles no file store: nothing in it
keeps files yet. A product that adds uploads adds their store and its backup. The env file and
`infra/configs/vapid.json` (the web push keys, which exist on the server only) are not in the
backup either: keep your own copy of both.

## Set it up

1. Create a place for the repository that is not on the server, such as a bucket at an
   S3-compatible provider, with a key that may read, write and delete in that bucket only. Use one
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
old, and `deno task compose logs backup` says why a run failed.

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
   list.

   ```sh
   deno task compose run --rm backup restic snapshots
   deno task compose run --rm backup restore <snapshot id>
   ```

4. Start the stack again. Migrations newer than the snapshot are applied as on any start, and
   Valkey is restarted so that the cache holds nothing newer than the database:

   ```sh
   deno task compose restart kv
   deno task compose up -d
   ```

5. When the restored data has proven right, drop `<db>_before_restore` by hand.

On a new server, run the same steps after the first `deno task deploy`, which creates a database
with empty tables. The backup container there saves that empty database as soon as it starts, so
the newest snapshots in the list are empty ones: choose the last snapshot from before the old server
failed. Restore soon after the deploy, because every day the new server runs adds an empty snapshot
and the old ones thin out.

To rehearse a restore without touching the live database, create a spare one and name it:
`deno task compose run --rm -e PGDATABASE=<spare> backup restore <snapshot id>`.

`deno task test:backup` runs the same backup and restore against a throwaway Postgres
(`infra/backup/restore.test.sh`), and CI runs it on every pull request.
