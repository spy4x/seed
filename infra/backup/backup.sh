#!/usr/bin/env bash
# Backs the database up into a restic repository, and restores it from there. docs/backups.md.
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
# PROJECT names the project: every snapshot carries it as its host, and the clean-up, the snapshot
# list and `restore latest` look at this project's snapshots only, so two projects that share a
# repository by mistake do not delete or load each other's. VAPID_FILE, when set, names the web
# push keys (infra/configs/vapid.json), saved with the database in every run. FILES_DIR, when set,
# names the bundled file store's directory (Garage's, .volumes/garage, docs/files.md): its data and
# its metadata snapshots are saved too, when the store has written any.
set -euo pipefail

# The dump's name inside every snapshot.
DUMP_NAME=db.dump
VAPID_NAME=vapid.json
# Touched after every complete run; the service's health check reads its age.
OK_FILE=${BACKUP_OK_FILE:-/tmp/backup-ok}
INTERVAL_SECONDS=86400
# restic's exit code when the repository is locked by another restic process.
LOCKED=11
# A run that met a lock tries again after an hour: restic takes a lock of another host for stale 30
# minutes after its last refresh, so the next try can remove it.
LOCKED_RETRY_SECONDS=3600
# libpq waits forever for a database that takes the connection and never answers; psql and pg_dump
# give up after this many seconds instead, so a stuck database fails the run rather than hangs it.
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

# Stops with the name of every variable that is missing, never a value.
require_env() {
  local name missing=()
  for name in RESTIC_REPOSITORY RESTIC_PASSWORD PROJECT PGHOST PGUSER PGPASSWORD PGDATABASE; do
    [ -n "${!name:-}" ] || missing+=("$name")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    log "Not set: ${missing[*]}. RESTIC_REPOSITORY and RESTIC_PASSWORD come from" \
      "BACKUP_RESTIC_REPOSITORY and BACKUP_RESTIC_PASSWORD in the env file (docs/backups.md)."
    exit 1
  fi
}

# Says what a lock means and how it goes away, and passes restic's exit code on.
explain_lock() {
  local code=$?
  if [ "$code" = "$LOCKED" ]; then
    log "The repository is locked by another restic process. restic unlock removes a lock once its" \
      "process is gone, or 30 minutes after a lock of another host was last refreshed; each run" \
      "does that first (docs/backups.md, \"When the backup is unhealthy\")."
  fi
  return "$code"
}

# One backup. Every step returns its failure, with restic's exit code, itself: the caller runs this
# inside `if`, where `set -e` is off.
backup_once() {
  local code=0
  # restic answers 10 when no repository is at the address, and 11 when an exclusive lock, such as
  # one left by a killed clean-up, stops it reading. Anything else is not a missing repository.
  restic cat config >/dev/null || code=$?
  case "$code" in
    0 | "$LOCKED") ;;
    10)
      log "No repository answers at the address yet; creating one."
      restic init || return
      ;;
    *)
      log "The repository could not be read (restic exit code ${code}); see restic's message above."
      return "$code"
      ;;
  esac
  # A run killed half-way (a stop during the dump, a reboot, the out-of-memory killer) leaves its
  # lock behind, and every later clean-up would fail on it. This removes stale locks only: those
  # of a process that is gone on this host, and those of another host that nobody refreshed for
  # 30 minutes.
  restic unlock || explain_lock || return
  # restic runs pg_dump itself and saves nothing when pg_dump fails, so a half dump never becomes a
  # snapshot. The dump is not compressed: restic compresses, and finds what did not change since
  # the last snapshot only in plain data.
  log "Dumping ${PGDATABASE}."
  restic backup --host "$PROJECT" --tag db --stdin-filename "$DUMP_NAME" --stdin-from-command -- \
    pg_dump --format=custom --compress=0 --no-password || explain_lock || return
  # Without the web push keys every stored push subscription is dead after a restore.
  if [ -n "${VAPID_FILE:-}" ]; then
    restic backup --host "$PROJECT" --tag vapid --stdin-filename "$VAPID_NAME" --stdin \
      <"$VAPID_FILE" || explain_lock || return
  fi
  # The files: Garage's blocks, and the snapshots of its metadata it writes every hour. The live
  # metadata database changes under a copy, so it is left out; a restore takes the newest snapshot.
  if [ -n "${FILES_DIR:-}" ] && [ -d "$FILES_DIR/data" ] && [ -d "$FILES_DIR/meta/snapshots" ]; then
    log "Saving the file store."
    restic backup --host "$PROJECT" --tag files -- "$FILES_DIR/data" "$FILES_DIR/meta/snapshots" ||
      explain_lock || return
  fi
  # Grouped by the project and the file, so this project's database, its keys and every other
  # host's snapshots are thinned apart. Every snapshot of the last two days stays (a restart makes
  # an extra one), then one per day.
  restic forget --host "$PROJECT" --group-by host,paths --keep-within 2d --keep-daily 7 \
    --keep-weekly 4 --keep-monthly 6 --prune || explain_lock || return
  log "Backup done."
  record_success
  touch "$OK_FILE"
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
  local code wait_seconds
  while true; do
    code=0
    wait_seconds=$INTERVAL_SECONDS
    backup_once || code=$?
    if [ "$code" = "$LOCKED" ]; then
      wait_seconds=$LOCKED_RETRY_SECONDS
      log "BACKUP FAILED. The next try is in an hour."
    elif [ "$code" != 0 ]; then
      log "BACKUP FAILED. The next try is in $((INTERVAL_SECONDS / 3600)) hours."
    fi
    sleep "$wait_seconds" &
    wait $!
  done
}

restore() {
  local snapshot="${1:-}" tables found id saved
  # No default: the newest snapshot is not always the one to take. A replacement server saves its
  # own empty database as soon as it starts, and a backup made after the damage holds the damage.
  if [ -z "$snapshot" ]; then
    restic snapshots --compact --host "$PROJECT" --tag db || true
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
      "was changed (docs/backups.md)."
    exit 1
  fi
  # Said before anything is loaded, so the person sees which backup they are getting.
  # `latest` is this project's newest database snapshot; restic ignores the filters for an id.
  found=$(restic snapshots --json --host "$PROJECT" --tag db "$snapshot")
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
