#!/usr/bin/env bash
# Backs the database up into a restic repository, and restores it from there. README, "Backups".
#
#   backup             a backup now, then one every 24 hours (what the `backup` service runs)
#   backup once        one backup, then old snapshots are thinned out
#   backup restore <snapshot>
#                      loads the snapshot with that id (`latest` for the newest) into the database
#                      PGDATABASE names, which must hold no tables; without an id it lists the
#                      snapshots and loads nothing
#   backup <command>   anything else runs as it is, with the repository set: `backup restic snapshots`
#
# It reads the database from libpq's variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) and
# the repository from restic's (RESTIC_REPOSITORY, RESTIC_PASSWORD, and the keys of the repository's
# backend, such as AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY). No secret is passed as an argument.
set -euo pipefail

# The dump's name inside every snapshot.
DUMP_NAME=db.dump
# Touched after every complete run; the service's health check reads its age.
OK_FILE=/tmp/backup-ok
INTERVAL_SECONDS=86400

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Stops with the name of every variable that is missing, never a value.
require_env() {
  local name missing=()
  for name in RESTIC_REPOSITORY RESTIC_PASSWORD PGHOST PGUSER PGPASSWORD PGDATABASE; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log "Not set: ${missing[*]}. RESTIC_REPOSITORY and RESTIC_PASSWORD come from" \
      "BACKUP_RESTIC_REPOSITORY and BACKUP_RESTIC_PASSWORD in the env file (README, \"Backups\")."
    exit 1
  fi
}

# One backup. Every step returns its failure itself: the caller runs this inside `if`, where
# `set -e` is off.
backup_once() {
  if ! restic cat config >/dev/null 2>&1; then
    log "No repository answers at the address yet; creating one."
    restic init || return 1
  fi
  # restic runs pg_dump itself and saves nothing when pg_dump fails, so a half dump never becomes a
  # snapshot. The dump is not compressed: restic compresses, and finds what did not change since
  # the last snapshot only in plain data.
  log "Dumping ${PGDATABASE}."
  restic backup --stdin-filename "$DUMP_NAME" --tag db --stdin-from-command -- \
    pg_dump --format=custom --compress=0 --no-password || return 1
  # Snapshots are grouped by path only: the host is the container's name, new on every deploy.
  # Every snapshot of the last two days stays (a restart makes an extra one), then one per day.
  restic forget --group-by paths --keep-within 2d --keep-daily 7 --keep-weekly 4 --keep-monthly 6 \
    --prune || return 1
  log "Backup done."
  record_success
}

# Tells the operator area's System page (#429) when the last backup finished. Never fails the
# backup: a database without the table yet (its migration not run) only logs a line.
record_success() {
  if ! psql --no-psqlrc --no-password --quiet --set ON_ERROR_STOP=1 --command \
    "insert into backup_status (target, succeeded_at) values ('database', now())
     on conflict (target) do update set succeeded_at = excluded.succeeded_at" >/dev/null; then
    log "Could not record the backup's time for the System page; the backup itself is saved."
  fi
}

schedule() {
  # Without a handler the first process of a container ignores SIGTERM and a stop waits to kill it.
  trap 'exit 0' TERM INT
  while true; do
    if backup_once; then
      touch "$OK_FILE"
    else
      log "BACKUP FAILED. The next try is in $((INTERVAL_SECONDS / 3600)) hours."
    fi
    sleep "$INTERVAL_SECONDS" &
    wait $!
  done
}

restore() {
  local snapshot="${1:-}" tables found id saved
  # No default: the newest snapshot is not always the one to take. A replacement server saves its
  # own empty database as soon as it starts, and a backup made after the damage holds the damage.
  if [ -z "$snapshot" ]; then
    restic snapshots --compact || true
    log "Name the snapshot to restore, by its id from the list above (or \"latest\" for the newest):" \
      "backup restore <id>. Nothing was changed."
    exit 1
  fi
  # A restore over existing tables would mix two states, so it only goes into an empty database.
  tables=$(psql --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --command \
    "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'")
  if [ "$tables" != 0 ]; then
    log "Database ${PGDATABASE} holds ${tables} tables. A restore needs an empty database: nothing" \
      "was changed (README, \"Backups\")."
    exit 1
  fi
  # Said before anything is loaded, so the person sees which backup they are getting.
  found=$(restic snapshots --json "$snapshot")
  id=$(grep -o '"short_id":"[0-9a-f]*' <<<"$found" | head -n 1 | cut -d'"' -f4 || true)
  saved=$(grep -o '"time":"[^"]*' <<<"$found" | head -n 1 | cut -d'"' -f4 || true)
  if [ -z "$id" ]; then
    log "No snapshot ${snapshot} in the repository. Nothing was changed."
    exit 1
  fi
  log "Restoring snapshot ${id}, saved at ${saved}, into ${PGDATABASE}."
  # One transaction: a restore that fails half-way leaves the database empty, not half filled.
  restic dump "$id" "/$DUMP_NAME" |
    pg_restore --no-owner --no-password --exit-on-error --single-transaction --dbname "$PGDATABASE"
  log "Restore done."
}

case "${1:-schedule}" in
  schedule)
    require_env
    schedule
    ;;
  once)
    require_env
    backup_once
    ;;
  restore)
    require_env
    shift
    restore "$@"
    ;;
  *) exec "$@" ;;
esac
