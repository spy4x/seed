# Restore from a backup

> Also on the website: [seedsaas.com/docs/restore](https://seedsaas.com/docs/restore).

How to bring back the database, the file store and the web push keys from the backup, on the same
server or a new one, and how to rehearse it.

**You need** a backup set up as [Backups](backups.md) says. Run every command on the server, in the
app's directory. `<db>` is `DB_NAME` and `<project>` is `PROJECT` from the env file.

## Restore

A restore only goes into a database with no tables, so the current database is set aside first,
never overwritten.

1. Stop everything that uses the database:

   ```sh
   deno task compose stop api worker backup postgres-prometheus-exporter
   ```

2. Rename the current database and create an empty one:

   ```sh
   deno task compose exec db psql -d postgres \
     -c 'ALTER DATABASE "<db>" RENAME TO "<db>_before_restore"' -c 'CREATE DATABASE "<db>"'
   ```

3. List this project's database snapshots:

   ```sh
   deno task compose run --rm backup restore
   ```

4. Choose one by its date. The newest is not always right: a snapshot made after the damage holds
   the damage.
5. Restore it by its id. It names the snapshot and its time before it changes anything:

   ```sh
   deno task compose run --rm backup restore <snapshot id>
   ```

6. Restart Valkey, so the cache holds nothing newer than the database, then start the stack. Newer
   migrations are applied as on any start:

   ```sh
   deno task compose restart kv
   deno task compose up -d
   ```

7. When the restored data has proven right, drop `<db>_before_restore` by hand.

### The file store

Restore the files from the same backup run as the database. Even then, a file uploaded in the hour
before the backup can be named by the database but missing from the store: the store comes back as
its newest hourly metadata copy.

1. Stop Garage and set its directory aside:

   ```sh
   deno task compose stop garage
   sudo mv .volumes/garage .volumes/garage-before-restore
   ```

2. List the file store's snapshots, and choose the one whose time matches the database's:

   ```sh
   deno task compose run --rm backup restic snapshots --host <project> --tag files
   ```

3. Restore it into a new directory:

   ```sh
   mkdir restored-files
   deno task compose run --rm -v "$PWD/restored-files:/restored:z" backup \
     restic restore <snapshot id> --target /restored
   ```

4. Put the blocks back, and the newest metadata copy in place of Garage's database, then start
   Garage:

   ```sh
   sudo mkdir -p .volumes/garage/meta
   sudo mv restored-files/run/files/data .volumes/garage/data
   sudo cp "$(ls -d restored-files/run/files/meta/snapshots/* | tail -n 1)/db.sqlite" \
     .volumes/garage/meta/db.sqlite
   sudo chown -R root:root .volumes/garage && rm -r restored-files
   deno task compose up -d garage
   ```

5. When the files have proven right, delete `.volumes/garage-before-restore`.

Nothing else of `meta` is needed: Garage starts a fresh layout and finds the blocks by their hash.

## On a new server

Keep the backup off until the restore is done. A new server's backup would save its empty database
into the same repository every day, and after seven runs the clean-up deletes the old server's
newest snapshot.

1. Deploy with `backup` taken out of `COMPOSE_PROFILES`. The deploy creates empty tables and new
   web push keys.
2. Restore the database as above, up to step 5. Choose the last snapshot from before the old server
   failed.
3. Put the old web push keys back, so people's push subscriptions keep working. This assumes the SSH
   user is uid 1000, as the containers are:

   ```sh
   mkdir -m 700 restored-keys
   deno task compose run --rm -v "$PWD/restored-keys:/restored:z" backup \
     restic dump --host <project> --tag vapid --target /restored/vapid.json latest /vapid.json
   mv restored-keys/vapid.json infra/configs/vapid.json && chmod 600 infra/configs/vapid.json
   rmdir restored-keys
   ```

4. Finish the database restore from step 6.
5. Restore the file store as above, from the same night as the database.
6. Put `backup` back into `COMPOSE_PROFILES` and deploy again.

## Rehearse a restore

Restore into a spare database once, so you know the backup can be read before you need it.

1. Create the spare database:

   ```sh
   deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
   ```

2. List the snapshots and restore one into it:

   ```sh
   deno task compose run --rm backup restore
   deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
   ```

3. Compare its tables with the live database's. The list must match:

   ```sh
   deno task compose exec db psql -d <db>_restore_test -c '\dt'
   ```

4. Drop it:

   ```sh
   deno task compose exec db psql -d postgres -c 'DROP DATABASE "<db>_restore_test"'
   ```

`deno task test:backup` runs the same backup and restore against a throwaway Postgres, and CI runs
it on every pull request.

## Next

- [Backups](backups.md)
- [Deploy to a server](deploy.md)
