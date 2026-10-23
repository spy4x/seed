#!/usr/bin/env bash
# `deno task test:backup`: runs restore.test.sh inside the backup image, against a Postgres server
# of its own. It builds the image from this checkout, starts the server from the image the `backup`
# service is built on, and removes the containers, the network and the image when it ends or is
# stopped. Needs Docker, or Podman with CONTAINER_PROVIDER=podman; nothing else is touched.
set -euo pipefail

cd "$(dirname "$0")/../.."
ENGINE=${CONTAINER_PROVIDER:-docker}
# The first match: the db and the backup services each name the image (the same one).
POSTGRES_IMAGE=$(sed -n '/^ *- POSTGRES_IMAGE=/{s///p;q;}' infra/compose/compose.shared.yml)
[ -n "$POSTGRES_IMAGE" ] || { echo "FAILED: compose.shared.yml names no POSTGRES_IMAGE"; exit 1; }

NAME="backup-test-$(date +%s)-$$"
cleanup() {
  "$ENGINE" rm --force --volumes "$NAME-run" "$NAME-db" >/dev/null 2>&1 || true
  "$ENGINE" network rm "$NAME" >/dev/null 2>&1 || true
  "$ENGINE" image rm "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$ENGINE" build --quiet --tag "$NAME" --build-arg "POSTGRES_IMAGE=$POSTGRES_IMAGE" infra/backup >/dev/null
"$ENGINE" network create "$NAME" >/dev/null
# Not a secret: the server lives for this run and is reachable from its own network only.
"$ENGINE" run --detach --name "$NAME-db" --network "$NAME" --pids-limit=500 --memory=8g \
  -e POSTGRES_PASSWORD=backup-test "$POSTGRES_IMAGE" >/dev/null
"$ENGINE" create --name "$NAME-run" --network "$NAME" --pids-limit=500 --memory=8g \
  -e PGHOST="$NAME-db" -e PGUSER=postgres -e PGPASSWORD=backup-test \
  -e BACKUP_CMD=backup -e SCHEMA_FILE=/tmp/schema.sql \
  --entrypoint bash "$NAME" /tmp/restore.test.sh >/dev/null
"$ENGINE" cp infra/backup/restore.test.sh "$NAME-run:/tmp/restore.test.sh"
"$ENGINE" cp libs/server/db/schema.sql "$NAME-run:/tmp/schema.sql"
"$ENGINE" start --attach "$NAME-run"
