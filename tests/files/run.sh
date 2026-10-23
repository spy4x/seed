#!/usr/bin/env bash
# `deno task test:files`: runs garage.test.ts against a Garage server of its own, started from the
# image and the config the `garage` service uses (infra/compose/compose.shared.yml,
# infra/configs/garage.toml), with throw-away keys and no volume. The container is removed when the
# run ends or is stopped. Needs Docker, or Podman with CONTAINER_PROVIDER=podman.
set -euo pipefail

cd "$(dirname "$0")/../.."
ENGINE=${CONTAINER_PROVIDER:-docker}
IMAGE=$(sed -n "s/^ *image: \(docker.io\/dxflrs\/garage:.*\)$/\1/p" infra/compose/compose.shared.yml)
[ -n "$IMAGE" ] || { echo "FAILED: compose.shared.yml names no Garage image"; exit 1; }

NAME="files-test-$(date +%s)-$$"
trap '"$ENGINE" rm --force "$NAME" >/dev/null 2>&1 || true' EXIT

export S3_REGION=garage S3_BUCKET=files-test
S3_ACCESS_KEY_ID="GK$(openssl rand -hex 12)"
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
export S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY
timeout 300 "$ENGINE" run --detach --name "$NAME" --pids-limit=500 --memory=1g \
  -v "$PWD/infra/configs/garage.toml:/etc/garage.toml:ro,z" \
  -e GARAGE_RPC_SECRET="$(openssl rand -hex 32)" \
  -e GARAGE_DEFAULT_ACCESS_KEY="$S3_ACCESS_KEY_ID" \
  -e GARAGE_DEFAULT_SECRET_KEY="$S3_SECRET_ACCESS_KEY" \
  -e GARAGE_DEFAULT_BUCKET="$S3_BUCKET" \
  -p 127.0.0.1::3900 "$IMAGE" /garage server --single-node --default-bucket >/dev/null

timeout 60 bash -c "until '$ENGINE' exec '$NAME' /garage bucket info '$S3_BUCKET' >/dev/null 2>&1; do sleep 0.5; done" ||
  { echo "FAILED: Garage did not create its bucket within 60 s"; "$ENGINE" logs "$NAME" | tail -n 20; exit 1; }
PORT=$("$ENGINE" port "$NAME" 3900/tcp | head -n 1 | sed 's/.*://')
export S3_ENDPOINT="http://127.0.0.1:$PORT"

timeout 120 deno test --no-prompt --allow-env=S3_ENDPOINT,S3_REGION,S3_BUCKET,S3_ACCESS_KEY_ID,S3_SECRET_ACCESS_KEY \
  --allow-net="127.0.0.1:$PORT" tests/files/garage.test.ts
