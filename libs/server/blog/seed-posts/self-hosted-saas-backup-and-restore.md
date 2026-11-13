---
slug: self-hosted-saas-backup-and-restore
language: en
title: "Backups for a self-hosted SaaS, and how to prove the restore works"
seoTitle: "Self-hosted SaaS backup and restore: Postgres, files, a tested restore"
description: How to back up a self-hosted SaaS (database, files, keys) off the server, and prove the restore works before you need it.
tldr:
  - Back up the database, the uploaded files and any key that exists only on the server, to a bucket on another provider.
  - A backup is proven only by a restore. Rehearse one into a spare database; in Seed that is four commands.
  - Seed saves a daily pg_dump, the files and the web push keys with restic, and warns when the last backup is two days old.
  - It has no point-in-time recovery, so up to a day of writes can be lost, and it does not check the stored data on its own.
topic: Guides
intro: "Self-hosting a SaaS on one server is cheap until the disk dies. Here is what to back up, where to keep it and how to prove the restore works, with the backup Seed ships as the worked example."
relatedFeature: deploy
cover: covers/self-hosted-saas-backup-and-restore.webp
coverAlt: "A violet plant on a server on one island, and on another a sealed jar with a cutting of it beside a pot it is replanted into."
author: Anton Shubin
authorUrl: https://antonshubin.com/about
publishAt: 2026-11-08T09:00:00Z
newsletter: true
devto: false
---

To back up a self-hosted SaaS, save three things every day to storage on another provider: a dump
of the database, the files people uploaded, and every key that exists only on the server. Encrypt
the backup, keep its password somewhere other than the server, and get told when a run fails. Then
do the part most people skip: restore one backup into a spare database and check that the tables
are there. Until you have done that, you have a folder of hope.

Self-hosting on one fixed-price server is the whole point of Seed, and the fear that stops people
doing it is losing the data. So this post is the backup Seed ships, what it saves, how to rehearse
the restore, and, just as plainly, what it does not do. The commands are from the
[backup guide](/docs/backups) and the [restore guide](/docs/restore).

## What should a self-hosted SaaS back up?

Everything you cannot rebuild from git. Here is Seed's list, from
[docs/backups.md](/docs/backups):

| What                                    | In the backup? | Why                                                               |
| --------------------------------------- | -------------- | ----------------------------------------------------------------- |
| The Postgres database, as a `pg_dump`   | Yes            | Accounts, groups, every record people made.                       |
| The uploaded files (the bundled Garage) | Yes            | Its data blocks and its two newest hourly copies of its metadata. |
| The web push keys, `vapid.json`         | Yes            | They exist on the server only; without them push stops working.   |
| Valkey                                  | No             | It is a cache; it fills itself again.                             |
| The production env file                 | No             | It holds the backup's own keys. Keep your own copy elsewhere.     |
| Files on another S3 store               | No             | That store's own backups cover them.                              |

The env file is the one people forget. It holds the file store's key and the backup's password, so
a backup that contained it would hand both to whoever reads the backup. Keep it in your password
manager, or encrypted in git, but not only on the server.

## Where should the backups live?

Not on the same server, and better not at the same provider. A backup on the disk that died is not
a backup, and a backup in the same account goes down with a locked account. Seed's backup writes to
any S3-compatible bucket. The [deploy post](/blog/deploy-saas-to-one-hetzner-server) prices
Hetzner Object Storage for it, which is off the server; a bucket at a second provider also
survives trouble with the first.

Three settings matter more than the provider:

1. **A key for that one bucket**, allowed to read, write and delete there and nowhere else.
2. **Versioning or object lock on the bucket**, if the provider has it. The key sits on the server,
   so whoever takes the server could otherwise delete the backups too. This is the step that turns
   "they wiped my server" into a bad afternoon instead of a closed company.
3. **The repository password away from the server.** Without it no snapshot can be read, by an
   attacker or by you.

## How does Seed take the backup?

With `backup` in `COMPOSE_PROFILES`, a `backup` container runs once when it starts and every 24
hours after ([infra/backup/backup.sh](https://github.com/spy4x/seed/blob/main/infra/backup/backup.sh)).
It saves into a [restic](https://restic.net) repository, which encrypts each snapshot and transfers
only the parts that changed since the last one.

A few choices in that script are the difference between a backup and a file that looks like one:

- **restic runs `pg_dump` itself** and saves nothing when `pg_dump` fails, so a dump that broke
  off half-way never becomes a snapshot. `pg_dump` makes a consistent export while the app keeps
  reading and writing, and does not block other users
  ([Postgres docs](https://www.postgresql.org/docs/current/app-pgdump.html)), so the app stays up.
- **The dump uses the server's own Postgres version.** The backup image is built on the database's
  image ([infra/backup/Dockerfile](https://github.com/spy4x/seed/blob/main/infra/backup/Dockerfile)),
  so `pg_dump` and `pg_restore` never lag behind the server.
- **The dump is not compressed.** restic compresses it, and finds what did not change only in plain
  data, so a daily dump of a mostly unchanged database stays small.
- **Old snapshots are thinned, not hoarded.** Every snapshot of the last two days stays, then one a
  day for a week, one a week for a month and one a month for half a year
  ([restic's `forget`](https://restic.readthedocs.io/en/stable/060_forget.html)).
- **A killed run cleans up after itself.** A reboot or the out-of-memory killer can leave restic's
  lock behind; every run removes stale locks first, and a run that meets a live lock tries again
  in an hour.

Turning it on is the `backup` profile and four variables in the env file, then a deploy. The profile is off until you set it
up, so a fresh product has no backup until you do.

## How do you know the backup still runs?

A backup that stopped in March is found in June, on the day you need it. Seed says so three ways:

- `docker ps` shows the backup container as unhealthy when the last complete backup is more than
  two days old.
- The `BackupMissing` alert ([infra/configs/alerts.yml](https://github.com/spy4x/seed/blob/main/infra/configs/alerts.yml))
  sends the same news to ntfy.
- The admin panel's System page warns when the last backup is 26 hours old and shows an error at 48
  ([libs/domain/identity/admin-system.ts](https://github.com/spy4x/seed/blob/main/libs/domain/identity/admin-system.ts)).

The log names the cause: a wrong password or key, a lock, or a repository that does not answer.

## How do you prove a restore works?

You restore one. Not the whole server: one snapshot into a spare database, next to the live one,
while the app keeps running. In Seed, on the server, in the app's folder (`<db>` is your `DB_NAME`):

```sh
deno task compose exec db psql -d postgres -c 'CREATE DATABASE "<db>_restore_test"'
deno task compose run --rm backup restore
deno task compose run --rm -e PGDATABASE=<db>_restore_test backup restore <snapshot id>
deno task compose exec db psql -d <db>_restore_test -c '\dt'
```

The second line lists the snapshots and changes nothing; the third loads the one you named. The
table list must match the live database's. Then drop the spare database. It takes a few minutes,
and afterwards "we have backups" is a fact rather than a feeling.

Do it once after you turn the backup on, and again after anything big changes: a new Postgres
version, a new bucket, a new password.

Seed also tests the script itself. `deno task test:backup` and the `backup-restore` step of CI, on
every pull request, back a database up with the real script, restore it into an empty one and
compare the rows
([infra/backup/restore.test.sh](https://github.com/spy4x/seed/blob/main/infra/backup/restore.test.sh)).
The same test kills a run half-way and checks the next one succeeds, and keeps two projects that
share a repository apart. That proves the script; only your own rehearsal proves your bucket, your
key and your password.

## How do you restore for real?

Slowly, and without overwriting anything. The [restore guide](/docs/restore) has every command;
these are the ideas behind them:

1. **Set the damaged database aside, never on top of it.** Stop the app, rename the database and
   create an empty one. The restore refuses a database that holds tables, so two states never mix.
2. **Choose the snapshot by its date.** The newest is not always right: a snapshot made after the
   damage holds the damage. That is why `restore` has no default and names the snapshot and its
   time before it loads anything.
3. **Load it in one transaction.** A restore that fails half-way leaves an empty database, not a
   half-filled one (`pg_restore --single-transaction`,
   [Postgres docs](https://www.postgresql.org/docs/current/app-pgrestore.html)).
4. **Restart the cache, then the app.** Migrations newer than the snapshot run as on any start.
5. **Bring the files back from the same night** as the database.

On a new server, keep the backup off until the restore is done. Otherwise the new server saves its
empty database into the same repository every day, and after seven runs the clean-up starts
deleting the old server's snapshots. I would rather you read that here than discover it.

## What does Seed's backup not do?

- **No point-in-time recovery.** It is one dump a day, so a failure can cost up to a day of writes.
  Seed archives no write-ahead log; if an hour of lost orders is too much for your product, you
  need that on top.
- **It does not read back the stored data on its own.** `restic check` verifies the repository's
  structure, and `--read-data` reads every stored pack
  ([restic docs](https://restic.readthedocs.io/en/stable/045_working_with_repos.html)), but the
  script runs neither. You can run one by hand:
  `deno task compose run --rm backup restic check --read-data-subset=10%`.
- **It does not rehearse the restore for you.** CI tests the script, not your bucket.
- **It does not save the env file**, on purpose, and it cannot write over SSH: the repository
  must be an S3 bucket.
- **It is off until you turn it on.**

That is honest everyday safety for one server, not a bank's. For most products that is the right
amount: the dangerous gap is rarely the missing hour, it is the backup nobody ever restored.

## Your turn

If you run Seed already, rehearse a restore today: four commands, a few minutes. If you are
choosing where to host, start with [how to install Seed and run it locally](/blog/install-seed-and-run-it-locally),
then [put it on one Hetzner server](/blog/deploy-saas-to-one-hetzner-server) and turn the backup
on in the same sitting. Something in the guides unclear? [Open an issue](https://github.com/spy4x/seed/issues)
and I will fix it.
