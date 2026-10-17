#!/usr/bin/env bash
# Proves a backup can be restored: backs a database up with backup.sh, restores it into an empty
# one and compares what is there.
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
work=$(mktemp -d)
cleanup() {
  for database in "$SOURCE" "$RESTORED" "$OCCUPIED" "$NEW_SERVER" "$REPLACED" "$BROKEN"; do
    dropdb --if-exists --force --maintenance-db=postgres "$database" >/dev/null 2>&1 || true
  done
  find "$work" -delete
}
trap cleanup EXIT
# A directory here, not a real repository; the password protects nothing.
export RESTIC_REPOSITORY="$work/repository" RESTIC_PASSWORD=test-only

sql() { psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$1" --command "$2"; }
tables() { sql "$1" "select count(*) from pg_tables where schemaname = 'public'"; }
notes() { sql "$1" "select string_agg(id || '=' || note, ',' order by id) from backup_probe"; }
# The id and the time of the newest snapshot in the repository.
newest() { restic snapshots --json latest | grep -o "\"$1\":\"[^\"]*" | head -n 1 | cut -d'"' -f4; }
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
  restic backup --quiet --stdin --stdin-filename db.dump --tag db
createdb --maintenance-db=postgres "$BROKEN"
if PGDATABASE=$BROKEN "$BACKUP" restore "$(newest short_id)"; then failed="not failed"; else failed=failed; fi
check "a restore whose dump breaks off half-way fails and leaves the database empty" \
  "failed, 0 tables" "$failed, $(tables "$BROKEN") tables"

echo "Backup and restore: all checks passed."
