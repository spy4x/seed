#!/usr/bin/env bash
# Runs the MPA's browser tests (`e2e/mpa`) against a stack made here: migrates the database, starts
# the API and the worker, builds and starts the MPA, puts both behind one origin
# (`e2e/mpa/proxy.ts`) and runs Playwright. CI runs this script (.woodpecker/ci.yml); run it the
# same way on a machine.
#
# Needs from the environment: a Postgres and a Valkey that are already running, as `DB_HOST`,
# `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `KV_HOSTNAME`, `KV_PORT` and `KV_PASSWORD`, and a
# browser Playwright can start (the e2e image has one). Run it from the repository root.
# The tests do not run in `DB_NAME`: the script connects there, drops and creates its own database
# `template_e2e` and runs the stack against that, so it never shares a database with another test
# run on the same Postgres (CI runs it beside the integration tests).
# `FRONT_PORT`, `API_PORT` and `MPA_PORT` default to 8080, 8000 and 8001.
set -euo pipefail

FRONT_PORT=${FRONT_PORT:-8080}
API_PORT=${API_PORT:-8000}
MPA_PORT=${MPA_PORT:-8001}
# The proxy sends everything but /api to SITE_PORT.
SITE_PORT=$MPA_PORT
export FRONT_PORT API_PORT MPA_PORT SITE_PORT

# The API reads vapid.json from its working directory. Reuse existing keys; never replace them, and
# never leave a file in infra/configs/ that was not there. Checked before the trap below, which
# deletes the root vapid.json: only one this script made.
if [ -e vapid.json ]; then
  echo "vapid.json exists in the repository root; move it away first"
  exit 1
fi

SCRATCH=$(mktemp -d)
PIDS=()
cleanup() {
  set +e
  for pid in "${PIDS[@]}"; do
    # `deno serve` does not exit on SIGTERM when it has open connections: stop it for good.
    kill -TERM "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$pid" 2>/dev/null
  done
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

# Throw-away secrets, never printed. The origin check compares the browser's Origin with
# http://$DOMAIN, port included. The address is `127.0.0.1`, not `app.localhost`: Chromium resolves
# the latter itself, but the Node side of Playwright (its `request` fixture) asks the system
# resolver, which in the CI container does not know it.
AUTH_COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_PEPPER=$(openssl rand -hex 32)
AUTH_TOTP=$(openssl rand -hex 20)
export AUTH_COOKIE_SECRET AUTH_PEPPER AUTH_TOTP
export ENV=dev
export DOMAIN="127.0.0.1:$FRONT_PORT"
# The proxy serves the MPA and the API at one origin, so the MPA's own host is DOMAIN here.
export MPA_DOMAIN="$DOMAIN"
export DEV_EMAIL=dev@example.com
export TIMEZONE=Etc/UTC
export RATE_LIMITER_WINDOW_MS=60000
export RATE_LIMITER_STRICT_LIMIT=1000
export RATE_LIMITER_LIMIT=5000
export RATE_LIMITER_OTP_WINDOW_MS=900000
export RATE_LIMITER_OTP_LIMIT=1000
export API_URL="http://127.0.0.1:$API_PORT"
export MPA_BASE_URL="http://$DOMAIN"

# A fresh database of its own. Dropped first, so a rerun starts empty instead of failing on
# "already exists" or inheriting rows from the last run. `DB_NAME` is only the database to connect
# to; it must exist.
E2E_DB_NAME=template_e2e
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
' "$E2E_DB_NAME"
export DB_NAME=$E2E_DB_NAME

deno task db:migrate

if [ -f infra/configs/vapid.json ]; then
  cp infra/configs/vapid.json vapid.json
else
  deno task vapid-key:create >/dev/null && mv infra/configs/vapid.json vapid.json
fi

deno serve --allow-all --port "$API_PORT" --host 127.0.0.1 apps/api/index.ts \
  >"$SCRATCH/api.log" 2>&1 &
PIDS+=($!)
wait_for api "${PIDS[-1]}" "http://127.0.0.1:$API_PORT/api/health"

# The worker sends the newsletter mails the subscribe spec reads back through /api/test/last-mail.
deno run --allow-all apps/worker/+main.ts >"$SCRATCH/worker.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do
  grep -q "Worker started" "$SCRATCH/worker.log" && break
  kill -0 "${PIDS[-1]}" 2>/dev/null || { echo "worker stopped"; tail -n 40 "$SCRATCH/worker.log"; exit 1; }
  sleep 0.5
done
grep -q "Worker started" "$SCRATCH/worker.log" || { echo "worker did not start within 60 s"; exit 1; }

deno task mpa:build
# Flags go before the file: after it, `deno serve` passes them to the script and ignores them.
deno serve --allow-all --port "$MPA_PORT" --host 127.0.0.1 apps/mpa/_fresh/server.js \
  >"$SCRATCH/mpa.log" 2>&1 &
PIDS+=($!)
wait_for mpa "${PIDS[-1]}" "http://127.0.0.1:$MPA_PORT/health"

deno run --allow-net --allow-env e2e/mpa/proxy.ts >"$SCRATCH/proxy.log" 2>&1 &
PIDS+=($!)
wait_for proxy "${PIDS[-1]}" "$MPA_BASE_URL/health"

deno task --cwd apps/mpa e2e
