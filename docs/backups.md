# Backups

> Also on the website: [seedsaas.com/docs/backups](https://seedsaas.com/docs/backups).

How to turn on the daily backup of the database, the web push keys and the file store, and what to
do when it fails.

**You need:**

- A deployed server ([Deploy to a server](deploy.md)).
- A bucket at an S3-compatible provider, away from the server.

## What it saves

With `backup` in `COMPOSE_PROFILES`, a `backup` container saves into a
[restic](https://restic.net) repository when it starts and every 24 hours after:

- the database, as a full `pg_dump`;
- the web push keys, `infra/configs/vapid.json`, which exist on the server only;
- the bundled file store ([Files](files.md)): Garage's data blocks and its two newest hourly copies
  of its metadata.

restic encrypts each snapshot and stores only what changed since the last one. It keeps every
snapshot of the last two days, then one per day for a week, one per week for a month and one per
month for half a year.

Nothing else is saved. Valkey is a cache. The env file is not in the backup: keep your own copy,
since the file store's key is in it. A product on another S3 store relies on that store's own
backups.

The profile is off until you set it up, so a new product has no backup before these steps.

## Set it up

1. Create a bucket for the repository, at a provider that is not the server. Use one repository per
   project.
2. Create a key that may read, write and delete in that bucket only.
3. Turn on versioning or object lock for the bucket, if the provider has it. The key sits on the
   server, so whoever takes the server could otherwise delete the backups.
4. In `infra/envs/.env.prod`, add `backup` to `COMPOSE_PROFILES` and set:

   | Variable                              | What it is                                                                 |
   | ------------------------------------- | -------------------------------------------------------------------------- |
   | `BACKUP_RESTIC_REPOSITORY`            | The repository's address, such as `s3:https://s3.example.com/app-backups`. |
   | `BACKUP_RESTIC_PASSWORD`              | A long random password that encrypts the repository.                       |
   | `S3_BUCKET_BACKUPS_ACCESS_KEY_ID`     | The bucket key's id.                                                       |
   | `S3_BUCKET_BACKUPS_SECRET_ACCESS_KEY` | The bucket key's secret.                                                   |

5. Keep a copy of `BACKUP_RESTIC_PASSWORD` away from the server. Without it no snapshot can be
   read.
6. Deploy. The container creates the repository on its first run:

   ```sh
   deno task deploy
   ```

7. On the server, in the app's directory, check that a snapshot is there:

   ```sh
   deno task compose run --rm backup restic snapshots
   ```

8. Rehearse a restore once, as [Restore from a backup](restore.md#rehearse-a-restore) says.

An `sftp:` address does not work: the image has no SSH client, and Compose passes an S3 key only.
Each snapshot carries `PROJECT` as its host, and the clean-up, the list and the restore look at
that project's snapshots only.

## When the backup is unhealthy

`docker ps` shows the container as unhealthy when the last complete backup is more than two days
old. The `BackupMissing` alert ([stack.md](stack.md#alerts)) sends the same news to ntfy.

1. Read why the run failed:

   ```sh
   deno task compose logs backup
   ```

2. Find the message below and act on it.

| Message                                                   | What it means                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| "The repository is locked by another restic process."     | A run killed half-way left its lock. Every run removes stale locks first, so the retry after an hour succeeds without your help. |
| "No repository answers at the address yet; creating one." | Expected on the first run only. Later, check `BACKUP_RESTIC_REPOSITORY`.                                                         |
| "The repository could not be read"                        | A wrong password, a wrong key or a network failure. restic's own message is above it.                                            |

A failed run is tried again 24 hours later, or after an hour when the repository was locked. A lock
is stale at once when its process is gone from the same container, and 30 minutes after its last
refresh when it comes from another container, such as the one before a deploy.

Remove stale locks by hand only when you know no other backup runs. This removes the same stale
locks and no others:

```sh
deno task compose run --rm backup restic unlock
```

The alert resolves by itself 14 days after the last complete backup, because the bundled
VictoriaMetrics keeps 14 days of data. A "resolved" with no new `Backup done.` line in the log
means the backup is still broken. A project that never turned the profile on gets no alert.

## Next

- [Restore from a backup](restore.md)
- [Files](files.md)
