#!/usr/bin/env bash
# Proves a backup can be restored: backs a database up with backup.sh, restores it into an empty
# one and compares what is there. It also kills a run half-way and runs the next one, saves the web
# push keys, and keeps two projects that share one repository apart.
#
# It needs `psql`, `pg_dump`, `pg_restore` and `restic` on PATH and a Postgres server where PGUSER
# may create databases (PGHOST, PGUSER, PGPASSWORD). `deno task test:backup` gives it both: the
# backup image and a throwaway server (test-local.sh). CI runs it in the Postgres image against
# its `postgres` service (.woodpecker/ci.yml, `backup-restore`). The repository is a directory
# that is removed at the end, and so are the databases it creates.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
BACKUP=${BACKUP_CMD:-$here/backup.sh}
SCHEMA=${SCHEMA_FILE:-$here/../../libs/server/db/schema.sql}
: "${PGHOST:?PGHOST is not set}" "${PGUSER:?PGUSER is not set}" "${PGPASSWORD:?PGPASSWORD is not set}"
for tool in psql pg_dump pg_restore pg_isready restic; do
  command -v "$tool" >/dev/null || { echo "FAILED: $tool is not on PATH"; exit 1; }
done
[ -r "$SCHEMA" ] || { echo "FAILED: cannot read the schema at $SCHEMA"; exit 1; }

suffix="$(date +%s)_$$"
SOURCE="backup_test_source_$suffix"
RESTORED="backup_test_restored_$suffix"
OCCUPIED="backup_test_occupied_$suffix"
NEW_SERVER="backup_test_new_server_$suffix"
REPLACED="backup_test_replaced_$suffix"
BROKEN="backup_test_broken_$suffix"
OTHER="backup_test_other_$suffix"
SHARED="backup_test_shared_$suffix"
LOCKER="backup_test_locker_$suffix"
work=$(mktemp -d)
cleanup() {
  # The session that holds a table lock for the kill case below, if it still runs.
  psql --no-psqlrc --quiet --dbname postgres --command "select pg_terminate_backend(pid)
    from pg_stat_activity where application_name = '$LOCKER'" >/dev/null 2>&1 || true
  for database in "$SOURCE" "$RESTORED" "$OCCUPIED" "$NEW_SERVER" "$REPLACED" "$BROKEN" "$OTHER" \
    "$SHARED"; do
    dropdb --if-exists --force --maintenance-db=postgres "$database" >/dev/null 2>&1 || true
  done
  find "$work" -delete
}
trap cleanup EXIT
# A directory here, not a real repository; the password protects nothing.
export RESTIC_REPOSITORY="$work/repository" RESTIC_PASSWORD=test-only
# This project's name, the health file and a stand-in for the web push keys: no real key.
export PROJECT=backup-test-a BACKUP_OK_FILE="$work/backup-ok" VAPID_FILE="$work/vapid.json"
printf '{"publicKey":"test-only","privateKey":"test-only"}\n' >"$VAPID_FILE"
# A stand-in for Garage's directory: one block, one metadata snapshot, and the live database.
export FILES_DIR="$work/files"
mkdir -p "$FILES_DIR/data/ab" "$FILES_DIR/meta/snapshots/2026-10-23T00:00:00Z"
printf 'block' >"$FILES_DIR/data/ab/block"
printf 'snapshot' >"$FILES_DIR/meta/snapshots/2026-10-23T00:00:00Z/db.sqlite"
printf 'live' >"$FILES_DIR/meta/db.sqlite"
OTHER_PROJECT=backup-test-b

sql() { psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$1" --command "$2"; }
tables() { sql "$1" "select count(*) from pg_tables where schemaname = 'public'"; }
notes() { sql "$1" "select string_agg(id || '=' || note, ',' order by id) from backup_probe"; }
# The id and the time of this project's newest database snapshot.
newest() {
  restic snapshots --json --host "$PROJECT" --tag db latest | grep -o "\"$1\":\"[^\"]*" |
    head -n 1 | cut -d'"' -f4
}
# How many database snapshots a project has.
count() { restic snapshots --json --host "$1" --tag db | grep -o '"short_id"' | wc -l; }
check() {
  if [ "$2" = "$3" ]; then echo "ok: $1"; else
    echo "FAILED: $1"
    echo "  expected: $2"
    echo "  found:    $3"
    exit 1
  fi
}

# Over TCP: while a new server sets itself up it answers on its socket only (docs/handoff.md).
for attempt in $(seq 1 60); do
  pg_isready --quiet --dbname=postgres && break
  [ "$attempt" != 60 ] || { echo "FAILED: no Postgres at $PGHOST after 60 s"; exit 1; }
  sleep 1
done

# The product's own schema, and rows to find again: a quote and a letter outside ASCII included.
createdb --maintenance-db=postgres "$SOURCE"
psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname "$SOURCE" --file "$SCHEMA" >/dev/null
sql "$SOURCE" "create table backup_probe (id integer primary key, note text not null);
  insert into backup_probe values (1, 'first'), (2, 'it''s'), (3, 'żółw')"
PGDATABASE=$SOURCE "$BACKUP" once
first_snapshot=$(newest short_id)
first_time=$(newest time)

# A later backup holds a change the first one does not.
sql "$SOURCE" "insert into backup_probe values (4, 'later')"
PGDATABASE=$SOURCE "$BACKUP" once

createdb --maintenance-db=postgres "$RESTORED"
PGDATABASE=$RESTORED "$BACKUP" restore latest
check "a restore into an empty database brings back every table" "$(tables "$SOURCE")" "$(tables "$RESTORED")"
check "a restore into an empty database brings back the rows of the latest backup" \
  "1=first,2=it's,3=żółw,4=later" "$(notes "$RESTORED")"

# One table the backup does not hold: nothing in the dump collides with it, so only the restore's
# own check can stop this one.
createdb --maintenance-db=postgres "$OCCUPIED"
sql "$OCCUPIED" "create table kept_data (id integer)"
if PGDATABASE=$OCCUPIED "$BACKUP" restore latest; then refused="not refused"; else refused=refused; fi
check "a restore into a database that holds a table is refused and adds nothing" \
  "refused, 1 table" "$refused, $(tables "$OCCUPIED") table"

# A replacement server: its first deploy creates the tables and the backup container saves them,
# empty, before anyone restores. The newest snapshot is now that one.
createdb --maintenance-db=postgres "$NEW_SERVER"
psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname "$NEW_SERVER" --file "$SCHEMA" >/dev/null
PGDATABASE=$NEW_SERVER "$BACKUP" once
createdb --maintenance-db=postgres "$REPLACED"
if PGDATABASE=$REPLACED "$BACKUP" restore; then refused="not refused"; else refused=refused; fi
check "a restore that names no snapshot is refused and loads nothing" \
  "refused, 0 tables" "$refused, $(tables "$REPLACED") tables"
# What docs/backups.md says to do there: choose a snapshot from before the failure and name it.
said=$(PGDATABASE=$REPLACED "$BACKUP" restore "$first_snapshot")
check "after later backups, one of an empty database among them, a restore by id brings back that snapshot's rows" \
  "1=first,2=it's,3=żółw" "$(notes "$REPLACED")"
check "a restore says which snapshot it loads, by id and time" \
  "snapshot $first_snapshot, saved at $first_time," \
  "$(grep -o "snapshot $first_snapshot, saved at [^ ]*" <<<"$said" || true)"

# A dump that breaks off in the middle of its rows. The rows are many, so that half of the file is
# past the list of tables at its start and the restore has created tables when it meets the end.
sql "$SOURCE" "create table backup_bulk as select n, repeat('x', 100) as filler from generate_series(1, 20000) n"
pg_dump --format=custom --compress=0 --no-password --dbname "$SOURCE" >"$work/whole.dump"
head -c $(($(stat -c %s "$work/whole.dump") / 2)) "$work/whole.dump" |
  restic backup --quiet --host "$PROJECT" --stdin --stdin-filename db.dump --tag db
createdb --maintenance-db=postgres "$BROKEN"
if PGDATABASE=$BROKEN "$BACKUP" restore "$(newest short_id)"; then failed="not failed"; else failed=failed; fi
check "a restore whose dump breaks off half-way fails and leaves the database empty" \
  "failed, 0 tables" "$failed, $(tables "$BROKEN") tables"

# The file store's blocks and metadata snapshots are saved; its live database is not.
files_dump() { restic dump --host "$PROJECT" --tag files latest "$FILES_DIR/$1" 2>/dev/null || echo missing; }
check "a backup saves the file store's blocks and metadata snapshots, not its live database" \
  "block snapshot missing" \
  "$(files_dump data/ab/block) $(files_dump meta/snapshots/2026-10-23T00:00:00Z/db.sqlite) $(files_dump meta/db.sqlite)"

# The web push keys are saved with the database, and come back as they were.
check "a backup saves the web push keys, and they come back unchanged" \
  "$(cat "$VAPID_FILE")" "$(restic dump --host "$PROJECT" --tag vapid latest /vapid.json)"

# A run killed half-way. Another session holds a lock on a table, so pg_dump waits inside
# `restic backup`, which holds its own lock on the repository; then the whole run is killed, the
# way a stop past its grace period, a reboot or the out-of-memory killer ends it.
PGAPPNAME=$LOCKER psql --no-psqlrc --quiet --dbname "$SOURCE" --command \
  "begin; lock table backup_probe in access exclusive mode; select pg_sleep(120)" >/dev/null 2>&1 &
for attempt in $(seq 1 30); do
  [ "$(sql "$SOURCE" "select count(*) from pg_locks l join pg_stat_activity a using (pid)
    where a.application_name = '$LOCKER' and l.mode = 'AccessExclusiveLock' and l.granted")" = 0 ] ||
    break
  [ "$attempt" != 30 ] || { echo "FAILED: the table lock was not taken in 30 s"; exit 1; }
  sleep 1
done
PGDATABASE=$SOURCE setsid "$BACKUP" once >"$work/killed.log" 2>&1 &
killed=$!
for attempt in $(seq 1 30); do
  [ -z "$(ls -A "$RESTIC_REPOSITORY/locks")" ] || break
  [ "$attempt" != 30 ] || { echo "FAILED: the run took no lock in 30 s"; cat "$work/killed.log"; exit 1; }
  sleep 1
done
kill -KILL -- "-$killed"
wait "$killed" || true
sql postgres "select pg_terminate_backend(pid) from pg_stat_activity where application_name = '$LOCKER'" >/dev/null
check "the killed run leaves its lock in the repository" "1" "$(ls -A "$RESTIC_REPOSITORY/locks" | wc -l)"
rm -f "$BACKUP_OK_FILE"
before=$(count "$PROJECT")
if PGDATABASE=$SOURCE "$BACKUP" once; then completed=completed; else completed=failed; fi
check "after a run killed half-way, the next run completes and touches the health file" \
  "completed, health file touched, $((before + 1)) snapshots" \
  "$completed, health file $([ -e "$BACKUP_OK_FILE" ] && echo touched || echo "not touched"), $(count "$PROJECT") snapshots"

# Two projects in one repository by mistake. The other one has a daily snapshot from ten days long
# ago; one clean-up for both would thin those out with this project's.
for day in 01 02 03 04 05 06 07 08 09 10; do
  echo "old" | restic backup --quiet --host "$OTHER_PROJECT" --tag db --stdin \
    --stdin-filename db.dump --time "2025-01-$day 12:00:00"
done
PGDATABASE=$SOURCE "$BACKUP" once
check "this project's clean-up leaves another project's snapshots in the same repository alone" \
  "10" "$(count "$OTHER_PROJECT")"
# The other project then saves the newest snapshot in the repository.
createdb --maintenance-db=postgres "$OTHER"
sql "$OTHER" "create table backup_probe (id integer primary key, note text not null);
  insert into backup_probe values (1, 'other project')"
PROJECT=$OTHER_PROJECT PGDATABASE=$OTHER "$BACKUP" once
createdb --maintenance-db=postgres "$SHARED"
PGDATABASE=$SHARED "$BACKUP" restore latest
check "with another project's newer snapshot in the repository, restore latest loads this project's" \
  "$(notes "$SOURCE")" "$(notes "$SHARED")"

echo "Backup and restore: all checks passed."
