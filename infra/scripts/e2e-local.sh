#!/usr/bin/env bash
# Runs the browser tests of the SPA (`e2e/*.e2e.ts`) against a stack of its own, so they need
# neither `deno task dev`, Traefik, nor port 80 or 5432: `deno task e2e:local`.
#
# Usage: deno task e2e:local [arguments for `playwright test`]
#   deno task e2e:local                          every spec
#   deno task e2e:local e2e/sessions.e2e.ts      one spec; `e2e/notes.e2e.ts:42` runs one test
#   deno task e2e:local -g "signing another"     tests whose title matches
#
# What it starts, each on a spare loopback port, and removes again when it ends or is stopped:
#   - Postgres and Valkey containers named `template-e2e-…`, with `CONTAINER_PROVIDER` (`podman`
#     by default, as `deno task compose`);
#   - the API, the worker and the Vite dev server of this checkout;
#   - a proxy that serves them at one origin, `http://app.localhost:<port>`, and sets the client
#     address headers itself, as Traefik does (`e2e-local-proxy.ts`).
#
# The specs name `http://app.localhost` without a port, so they run from a copy that names the
# port, under `e2e/results/` (ignored by git). Line numbers in a report match the tracked specs.
#
# Needs: Deno, a container tool, `curl`, `openssl`, and the Chromium of the pinned Playwright
# (`deno run -A npm:playwright@1.57.0 install chromium`). `E2E_CHROMIUM` names another Chromium
# binary to use instead. `E2E_LOCAL_TIMEOUT` is the deadline of the Playwright run in seconds
# (1500 by default).
#
# Under a process cap, allow 3000 tasks: the cap counts threads, and Chromium with several
# Playwright workers passes 500.
#   systemd-run --user --scope --quiet -p TasksMax=3000 -p MemoryMax=8G deno task e2e:local
#
# The API reads `vapid.json` from the repository root. The script puts one there while it runs and
# refuses to start when one is there already. It never prints a secret.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"

CONTAINER=${CONTAINER_PROVIDER:-podman}
RUN_ID="$$-$RANDOM"
PG_NAME="template-e2e-pg-$RUN_ID"
KV_NAME="template-e2e-kv-$RUN_ID"
COPY_DIR="$ROOT/e2e/results/.local-$RUN_ID"

for tool in deno curl openssl "$CONTAINER"; do
  command -v "$tool" >/dev/null || { echo "e2e:local needs $tool"; exit 1; }
done
if [ -e vapid.json ]; then
  echo "vapid.json exists in the repository root; move it away first"
  exit 1
fi

log() { echo "[e2e:local] $*"; }

SCRATCH=$(mktemp -d)
PIDS=()
CONTAINERS=()

# Stops a process this script started, with its children: each is started with `setsid`, so it
# leads a process group. `deno serve` does not exit on SIGTERM while it has open connections, so
# the group is killed when it is still there after 4 s.
stop_group() {
  kill -TERM -- "-$1" 2>/dev/null || return 0
  for _ in $(seq 1 20); do
    kill -0 -- "-$1" 2>/dev/null || return 0
    sleep 0.2
  done
  kill -KILL -- "-$1" 2>/dev/null
}

cleanup() {
  set +e
  trap - EXIT
  trap '' INT TERM
  log "cleaning up"
  # Last started, first stopped: Playwright, the proxy, the dev server, the worker, the API.
  for ((i = ${#PIDS[@]} - 1; i >= 0; i--)); do stop_group "${PIDS[i]}"; done
  for name in "${CONTAINERS[@]}"; do
    timeout 60 "$CONTAINER" rm --force --volumes "$name" >/dev/null 2>&1
  done
  find "$COPY_DIR" -delete 2>/dev/null
  find "$SCRATCH" -delete
  find vapid.json -delete 2>/dev/null
}
trap cleanup EXIT
# `deno task` forwards a signal the script also gets from its process group, so it arrives twice.
# The first one switches both off: a second `exit` during cleanup would end the script with
# cleanup half done.
trap 'trap "" INT TERM; exit 130' INT
trap 'trap "" INT TERM; exit 143' TERM

# Starts "$@" in the background as the leader of its own process group, with its output in
# $SCRATCH/<name>.log, and records it for cleanup.
start() { # <name> <command…>
  local name=$1
  shift
  setsid "$@" >"$SCRATCH/$name.log" 2>&1 &
  PIDS+=($!)
}

# Waits until <check> succeeds, at most <seconds>, and fails early when the process is gone.
wait_for() { # <name> <pid> <seconds> <check…>
  local name=$1 pid=$2 seconds=$3
  shift 3
  for _ in $(seq 1 $((seconds * 2))); do
    "$@" >/dev/null 2>&1 && return 0
    kill -0 "$pid" 2>/dev/null || { log "$name stopped"; tail -n 40 "$SCRATCH/$name.log"; return 1; }
    sleep 0.5
  done
  log "$name was not ready within $seconds s"
  tail -n 40 "$SCRATCH/$name.log"
  return 1
}

answers() { curl -fsS --max-time 2 -o /dev/null "$1"; }

spare_port() {
  deno eval 'const l = Deno.listen({ hostname: "127.0.0.1", port: 0 }); console.log(l.addr.port); l.close()'
}

# Fill node_modules before anything else starts, so the API, Vite and Playwright do not each take
# Deno's node_modules lock on their first run.
log "installing dependencies"
timeout 600 deno install --frozen

# Throw-away secrets, never printed.
AUTH_COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_PEPPER=$(openssl rand -hex 32)
AUTH_TOTP=$(openssl rand -hex 20)
DB_PASS=$(openssl rand -hex 24)
KV_PASSWORD=$(openssl rand -hex 24)
API_PORT=$(spare_port)
SPA_PORT=$(spare_port)
FRONT_PORT=$(spare_port)

log "starting $PG_NAME and $KV_NAME with $CONTAINER"
CONTAINERS+=("$PG_NAME")
timeout 300 "$CONTAINER" run --detach --name "$PG_NAME" --pids-limit=500 --memory=2g \
  -e POSTGRES_USER=tester -e POSTGRES_PASSWORD="$DB_PASS" -e POSTGRES_DB=template_e2e \
  -p 127.0.0.1::5432 docker.io/library/postgres:16-alpine >/dev/null
CONTAINERS+=("$KV_NAME")
# REDISCLI_AUTH lets the `valkey-cli ping` below authenticate.
timeout 300 "$CONTAINER" run --detach --name "$KV_NAME" --pids-limit=500 --memory=1g \
  -e REDISCLI_AUTH="$KV_PASSWORD" -p 127.0.0.1::6379 docker.io/valkey/valkey:8.1 \
  valkey-server --requirepass "$KV_PASSWORD" >/dev/null
DB_PORT=$("$CONTAINER" port "$PG_NAME" 5432/tcp | head -n 1 | cut -d: -f2)
KV_PORT=$("$CONTAINER" port "$KV_NAME" 6379/tcp | head -n 1 | cut -d: -f2)

# Over TCP, not the unix socket: the image answers on the socket while it still initialises
# (docs/handoff.md, "Traps in this codebase").
timeout 90 "$CONTAINER" exec "$PG_NAME" sh -c \
  'until pg_isready -h 127.0.0.1 -U tester -d template_e2e -q; do sleep 0.5; done' ||
  { log "postgres was not ready within 90 s"; exit 1; }
timeout 60 "$CONTAINER" exec "$KV_NAME" sh -c \
  'until valkey-cli ping 2>/dev/null | grep -q PONG; do sleep 0.5; done' ||
  { log "valkey was not ready within 60 s"; exit 1; }

export ENV=dev
# The API's origin check compares the browser's Origin with http://$DOMAIN, port included.
export DOMAIN="app.localhost:$FRONT_PORT"
export DEV_EMAIL=dev@example.com
export TIMEZONE=Etc/UTC
export AUTH_COOKIE_SECRET AUTH_PEPPER AUTH_TOTP
export RATE_LIMITER_WINDOW_MS=60000
export RATE_LIMITER_STRICT_LIMIT=1000
export RATE_LIMITER_LIMIT=5000
export RATE_LIMITER_OTP_WINDOW_MS=900000
export RATE_LIMITER_OTP_LIMIT=1000
export DB_HOST=127.0.0.1 DB_PORT DB_USER=tester DB_PASS DB_NAME=template_e2e
export KV_HOSTNAME=127.0.0.1 KV_PORT KV_PASSWORD

log "migrating the database"
timeout 300 deno task db:migrate

# Reuse existing web push keys; never replace them, and leave no file in infra/configs/ that was
# not there. Cleanup deletes the copy in the repository root.
if [ -f infra/configs/vapid.json ]; then
  cp infra/configs/vapid.json vapid.json
else
  timeout 120 deno task vapid-key:create >/dev/null && mv infra/configs/vapid.json vapid.json
fi

log "starting the API on 127.0.0.1:$API_PORT"
start api deno serve --allow-all --port "$API_PORT" --host 127.0.0.1 apps/api/index.ts
wait_for api "${PIDS[-1]}" 60 answers "http://127.0.0.1:$API_PORT/api/health"

# The worker sends the mails the specs read back and announces changes to other tabs.
log "starting the worker"
start worker deno run --allow-all apps/worker/+main.ts
wait_for worker "${PIDS[-1]}" 60 grep -q "Worker started" "$SCRATCH/worker.log"

log "starting the dev server on 127.0.0.1:$SPA_PORT"
start spa env VITE_ENV=dev deno task spa:dev --port "$SPA_PORT" --strictPort --host 127.0.0.1
wait_for spa "${PIDS[-1]}" 120 answers "http://127.0.0.1:$SPA_PORT/"

log "starting the proxy on 127.0.0.1:$FRONT_PORT"
start proxy env FRONT_PORT="$FRONT_PORT" API_PORT="$API_PORT" SPA_PORT="$SPA_PORT" \
  deno run --allow-net=127.0.0.1 --allow-env=FRONT_PORT,API_PORT,SPA_PORT \
  infra/scripts/e2e-local-proxy.ts
wait_for proxy "${PIDS[-1]}" 30 answers "http://127.0.0.1:$FRONT_PORT/api/health"

# Chromium resolves *.localhost itself; Playwright's own requests ask the system resolver.
getent hosts app.localhost >/dev/null 2>&1 ||
  log "warning: app.localhost does not resolve here; requests the specs make outside the browser will fail"

# The copy of the specs and their fixtures that names the port, and a config that points at it.
# It lives inside the checkout so `@playwright/test` resolves through this node_modules.
mkdir -p "$COPY_DIR"
cp -r e2e/fixtures "$COPY_DIR/fixtures"
for spec in e2e/*.e2e.ts; do
  sed -e "s#http://app.localhost\"#http://app.localhost:$FRONT_PORT\"#g" "$spec" \
    >"$COPY_DIR/$(basename "$spec")"
done
LAUNCH=""
[ -n "${E2E_CHROMIUM:-}" ] && LAUNCH="use: { launchOptions: { executablePath: \"$E2E_CHROMIUM\" } },"
cat >"$COPY_DIR/playwright.config.ts" <<CONFIG
import { defineConfig, devices } from "@playwright/test"
import { playwrightBaseConfig } from "@jsr/spy4x__preact-system/playwright"

export default defineConfig({
  ...playwrightBaseConfig({
    baseURL: "http://app.localhost:$FRONT_PORT",
    ci: !!Deno.env.get("CI"),
    chromium: devices["Desktop Chrome"],
    $LAUNCH
  }),
  testDir: "$COPY_DIR",
  outputDir: "$COPY_DIR/results",
})
CONFIG

# Playwright matches a file argument against the path of the copy, so `e2e/notes.e2e.ts:42`
# becomes `notes.e2e.ts:42`. Everything else is passed on as it is.
ARGS=()
for arg in "$@"; do
  file=${arg%%:*}
  if [[ "$file" == *.e2e.ts && -f "$file" ]]; then
    ARGS+=("$(basename "$file")${arg#"$file"}")
  else
    ARGS+=("$arg")
  fi
done

# In the background, so a signal reaches the traps above while Playwright runs.
log "running Playwright at http://app.localhost:$FRONT_PORT"
PLAYWRIGHT_HTML_OUTPUT_DIR="$ROOT/e2e/report" setsid \
  timeout --kill-after=10 "${E2E_LOCAL_TIMEOUT:-1500}" \
  deno run -A --node-modules-dir npm:playwright@1.57.0 test \
  --config="$COPY_DIR/playwright.config.ts" "${ARGS[@]}" &
PIDS+=($!)
STATUS=0
wait "${PIDS[-1]}" || STATUS=$?
[ "$STATUS" = 124 ] && log "Playwright did not finish within ${E2E_LOCAL_TIMEOUT:-1500} s"
exit "$STATUS"
