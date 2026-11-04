#!/usr/bin/env bash
# Starts the API, the worker and the website on each runtime in turn (Deno, Node, Bun) and checks
# that they work (#623): the API answers and opens a WebSocket for a guest, the worker starts, and
# the website renders its home page with its stylesheet and serves a video by byte range
# (tests/runtimes/check.ts). CI runs this script (.woodpecker/ci.yml, step `runtimes`); run it the
# same way on a machine, from the repository root.
#
# Needs `deno`, `node` and `bun` on the PATH, and a Postgres and a Valkey that are already running,
# as `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `KV_HOSTNAME`, `KV_PORT` and
# `KV_PASSWORD`. Like e2e/mpa/run.sh it runs in a database of its own, `template_runtimes`, dropped
# and created first. `RUNTIMES` picks the runtimes, by default `deno node bun`. `API_PORT` and
# `MPA_PORT` default to 8000 and 8001.
#
# It runs in a copy of the checkout (the tracked and untracked files, not the ignored ones), made
# in a scratch folder: the builds and vapid.json it writes would otherwise clash with CI steps that
# share the checkout and run at the same time, such as `browser` (e2e/mpa/run.sh).
set -euo pipefail

if [ -z "${RUNTIMES_SMOKE_COPY:-}" ]; then
  COPY=$(mktemp -d)
  trap 'find "$COPY" -delete' EXIT INT TERM
  git ls-files -z --cached --others --exclude-standard |
    tar --null --ignore-failed-read -T - -cf - | tar -xf - -C "$COPY"
  cd "$COPY"
  deno install --frozen
  RUNTIMES_SMOKE_COPY=1 bash tests/runtimes/smoke.sh
  exit
fi

RUNTIMES=${RUNTIMES:-deno node bun}
API_PORT=${API_PORT:-8000}
MPA_PORT=${MPA_PORT:-8001}

# The API reads vapid.json from its working directory. Reuse existing keys; never replace them, and
# never leave a file in infra/configs/ that was not there.
if [ -e vapid.json ]; then
  echo "vapid.json exists in the repository root; move it away first"
  exit 1
fi

SCRATCH=$(mktemp -d)
PIDS=()
stop_all() {
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  PIDS=()
}
cleanup() {
  set +e
  stop_all
  find "$SCRATCH" -delete
  find vapid.json -delete 2>/dev/null
}
trap cleanup EXIT INT TERM

wait_for() { # <name> <pid> <url>
  for _ in $(seq 1 120); do
    curl -fsS --max-time 2 -o /dev/null "$3" 2>/dev/null && return 0
    kill -0 "$2" 2>/dev/null || { echo "$1 stopped"; tail -n 40 "$SCRATCH/$1.log"; return 1; }
    sleep 0.5
  done
  echo "$1 did not answer at $3 within 60 s"
  tail -n 40 "$SCRATCH/$1.log"
  return 1
}

# Throw-away secrets, never printed. The settings are e2e/mpa/run.sh's, without its proxy: the
# checks call the API directly and send the app's origin themselves.
AUTH_COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_PEPPER=$(openssl rand -hex 32)
S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)
export AUTH_COOKIE_SECRET AUTH_PEPPER S3_SECRET_ACCESS_KEY
export S3_ENDPOINT=http://127.0.0.1:9 S3_PUBLIC_ENDPOINT=http://127.0.0.1:9 S3_REGION=garage
export S3_BUCKET=runtimes-files S3_ACCESS_KEY_ID=GK000000000000000000000000
export ENV=dev
export DOMAIN="127.0.0.1:8080"
export MPA_DOMAIN="127.0.0.1:$MPA_PORT"
export DEV_EMAIL=dev@example.com
export TIMEZONE=Etc/UTC
export RATE_LIMITER_WINDOW_MS=60000 RATE_LIMITER_STRICT_LIMIT=1000 RATE_LIMITER_LIMIT=5000
export RATE_LIMITER_OTP_WINDOW_MS=900000 RATE_LIMITER_OTP_LIMIT=1000
export API_URL="http://127.0.0.1:$API_PORT"
export API_HOST=127.0.0.1 API_PORT MPA_HOST=127.0.0.1 MPA_PORT

RUNTIMES_DB_NAME=template_runtimes
deno eval '
import postgres from "postgres"
const name = Deno.args[0]
const sql = postgres({
  host: Deno.env.get("DB_HOST"),
  port: Number(Deno.env.get("DB_PORT")),
  user: Deno.env.get("DB_USER"),
  password: Deno.env.get("DB_PASS"),
  database: Deno.env.get("DB_NAME"),
  max: 1,
})
await sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
await sql.unsafe(`CREATE DATABASE ${name}`)
await sql.end()
' "$RUNTIMES_DB_NAME"
export DB_NAME=$RUNTIMES_DB_NAME

deno task db:migrate
if [ -f infra/configs/vapid.json ]; then
  cp infra/configs/vapid.json vapid.json
else
  deno task vapid-key:create >/dev/null && mv infra/configs/vapid.json vapid.json
fi

# Node and Bun run the bundles; Deno runs the sources, as in development.
deno task server:build
deno task mpa:build

for runtime in $RUNTIMES; do
  echo "== $runtime"
  case $runtime in
    deno)
      api=(deno run --allow-all apps/api/+main.ts)
      worker=(deno run --allow-all apps/worker/+main.ts)
      # Flags go before the file: after it, `deno serve` passes them to the script.
      website=(deno serve --allow-all --port "$MPA_PORT" --host 127.0.0.1 apps/mpa/dist/server.js)
      ;;
    node | bun)
      api=("$runtime" dist/server/api.js)
      worker=("$runtime" dist/server/worker.js)
      website=("$runtime" apps/mpa/dist/start.js)
      ;;
    *) echo "unknown runtime $runtime" && exit 1 ;;
  esac

  "${api[@]}" >"$SCRATCH/api.log" 2>&1 &
  PIDS+=($!)
  wait_for api "${PIDS[-1]}" "$API_URL/api/health"
  deno run --allow-net=127.0.0.1 tests/runtimes/check.ts api "$API_URL" "http://$DOMAIN" ||
    { tail -n 40 "$SCRATCH/api.log"; exit 1; }
  echo "API: health, guest and WebSocket"

  "${worker[@]}" >"$SCRATCH/worker.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 120); do
    grep -q "Worker started" "$SCRATCH/worker.log" && break
    kill -0 "${PIDS[-1]}" 2>/dev/null || { echo "worker stopped"; tail -n 40 "$SCRATCH/worker.log"; exit 1; }
    sleep 0.5
  done
  grep -q "Worker started" "$SCRATCH/worker.log" || { echo "worker did not start within 60 s"; exit 1; }
  echo "worker: started"

  "${website[@]}" >"$SCRATCH/website.log" 2>&1 &
  PIDS+=($!)
  wait_for website "${PIDS[-1]}" "http://$MPA_DOMAIN/health"
  deno run --allow-net=127.0.0.1 tests/runtimes/check.ts website "http://$MPA_DOMAIN" ||
    { tail -n 40 "$SCRATCH/website.log"; exit 1; }
  echo "website: home page, stylesheet and video"

  stop_all
done
