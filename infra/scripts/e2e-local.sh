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
#     by default here; `deno task compose` runs Docker by default);
#   - the API, the worker and the Vite dev server of this checkout (`E2E_SPA=built` puts the
#     built SPA there instead, see below);
#   - a proxy that serves them at one origin, `http://app.localhost:<port>`, and sets the client
#     address headers itself, as Traefik does (`e2e-local-proxy.ts`).
#
# The specs name `http://app.localhost` without a port, so they run from a copy that names the
# port, under `e2e/results/` (ignored by git). Line numbers in a report match the tracked specs.
#
# `E2E_SPA` says what serves the SPA:
#   - `dev`: the Vite dev server, which compiles each module when a page asks for it;
#   - `built`: the SPA as a deploy serves it. The script builds the image of
#     `apps/spa/dockerfile.prod` (the base image first) and runs it, so the page is the hashed
#     bundle behind nginx with `apps/spa/nginx.conf`. The builds keep no image of their steps,
#     and the two images they make carry a label that names this run and are removed by it at
#     the end. Every run therefore builds from the start, which takes a minute or two.
# Left unset, the specs that start the app with no network (`OFFLINE_SPECS` of
# `e2e-local-plan.ts`) get the built SPA and every other spec the dev server (docs/offline.md,
# "The app shell", says why). One Playwright pass has one server, so a run makes two passes when
# it needs both: the dev server first, then the built SPA in its place.
#   deno task e2e:local                                            two passes: every spec
#   deno task e2e:local e2e/notes.e2e.ts                           one pass, dev server
#   deno task e2e:local e2e/offline.e2e.ts e2e/local-data.e2e.ts   one pass, built SPA
#   deno task e2e:local e2e/notes.e2e.ts e2e/offline.e2e.ts        two passes, one spec each
# An argument that is not a spec path goes to both passes. The exit code is Playwright's: the
# first pass's that is not 0. One exception: of two passes, one in which Playwright found no test
# (a `-g` that matches tests of the other pass only) does not fail the run; it fails when neither
# pass found one. The last lines give the counts of each pass, when the reporter prints them. The
# report of the second of two passes is in `e2e/report/offline`. With `E2E_SPA` set, every spec
# asked for runs in one pass against that server.
#
# Needs: Deno, a container tool, `curl`, `openssl`, and the Chromium of the pinned Playwright
# (`deno run -A npm:playwright@1.57.0 install chromium`). `E2E_CHROMIUM` names another Chromium
# binary to use instead. `E2E_LOCAL_TIMEOUT` is the deadline of one Playwright pass in seconds
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
command -v deno >/dev/null || { echo "e2e:local needs deno"; exit 1; }
# The passes of this run: what serves the SPA, which specs it may see, and its arguments.
PASS_SERVER=()
PASS_SPECS=()
PASS_ARGS=() # the arguments of a pass, one per line
PLAN=$(deno run --allow-read infra/scripts/e2e-local-plan.ts "${E2E_SPA:-}" "$@")
while IFS= read -r line; do
  case "$line" in
    "pass "*)
      read -r _ server specs <<<"$line"
      PASS_SERVER+=("$server")
      PASS_SPECS+=("$specs")
      PASS_ARGS+=("")
      ;;
    "arg "*) PASS_ARGS[-1]+="${line#arg }"$'\n' ;;
  esac
done <<<"$PLAN"
[ ${#PASS_SERVER[@]} -gt 0 ] || { echo "e2e-local-plan.ts gave no pass"; exit 1; }
RUN_ID="$$-$RANDOM"
PG_NAME="template-e2e-pg-$RUN_ID"
KV_NAME="template-e2e-kv-$RUN_ID"
SPA_NAME="template-e2e-spa-$RUN_ID"
# Named after this run, so two runs at once never share an image.
BASE_IMAGE="template-e2e-local-base:$RUN_ID"
SPA_IMAGE="template-e2e-local-spa:$RUN_ID"
# On every image a build of this run makes.
IMAGE_LABEL="template-e2e-local-run=$RUN_ID"
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
BUILT=0

# Stops a process this script started, with its children: each is started with `setsid`, so it
# leads a process group. `deno serve` does not exit on SIGTERM while it has open connections, so
# the group is killed when it is still there after 4 s.
stop_group() {
  kill -TERM -- "-$1" 2>/dev/null || return 0
  for _ in $(seq 1 20); do
    kill -0 -- "-$1" 2>/dev/null || return 0
    sleep 0.2
  done
  # The group may end between the last check and this line; that is not a failure.
  kill -KILL -- "-$1" 2>/dev/null || true
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
  # Only this run's images: the label names the run. Unused ones, and the container is gone.
  if [ "$BUILT" = 1 ]; then
    timeout 120 "$CONTAINER" image prune --all --force --filter "label=$IMAGE_LABEL" >/dev/null 2>&1
  fi
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
  -p 127.0.0.1::5432 docker.io/library/postgres:18.6-alpine >/dev/null
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

# Builds an image with this run's label. In the foreground: a signal is acted on when the build
# ends, because a build that is killed leaves its working containers behind, which carry no name
# of the run to find them by.
build_image() { # <name> <arguments for `build`…>
  local name=$1 options=(--label "$IMAGE_LABEL")
  shift
  # Podman keeps every step of a build as an untagged image and starts the next build from those.
  # Switched off: nothing untagged stays behind, and no build depends on a step image that
  # another run removes meanwhile (a build failed that way: "image not known"). Docker with
  # BuildKit keeps no such images and does not know the option.
  if "$CONTAINER" build --help 2>/dev/null | grep -q -- --layers; then
    options+=(--layers=false)
  fi
  BUILT=1
  setsid --wait timeout 900 "$CONTAINER" build --quiet "${options[@]}" "$@" \
    >"$SCRATCH/$name.log" 2>&1 ||
    { log "the $name did not build"; tail -n 40 "$SCRATCH/$name.log"; exit 1; }
}

# Puts <server> at $SPA_PORT, in place of the dev server when that is there. A run starts the dev
# server first, so the built SPA never has to make way.
SPA_SERVER=""
SPA_PID=""
start_spa() { # <dev|built>
  [ "$SPA_SERVER" = "$1" ] && return 0
  SPA_SERVER=$1
  if [ "$1" = built ]; then
    # The image exactly as a deploy builds it, as `e2e/spa/run.sh` does: keep the two in step.
    log "building the SPA image"
    build_image "base image" --tag "$BASE_IMAGE" --file Dockerfile.base .
    build_image "SPA image" --build-arg "BASE_IMAGE=$BASE_IMAGE" --tag "$SPA_IMAGE" \
      --file apps/spa/dockerfile.prod .
    # Only now, so the port is free for a moment and not for the whole build.
    if [ -n "$SPA_PID" ]; then
      log "stopping the dev server"
      stop_group "$SPA_PID"
      SPA_PID=""
    fi
    log "starting the built SPA on 127.0.0.1:$SPA_PORT"
    CONTAINERS+=("$SPA_NAME")
    timeout 300 "$CONTAINER" run --detach --name "$SPA_NAME" --pids-limit=500 --memory=1g \
      --env SPA_ENV=dev -p "127.0.0.1:$SPA_PORT:8080" "$SPA_IMAGE" >/dev/null
    for _ in $(seq 1 120); do
      answers "http://127.0.0.1:$SPA_PORT/" 2>/dev/null && break
      sleep 0.5
    done
    answers "http://127.0.0.1:$SPA_PORT/" || {
      log "the built SPA did not answer within 60 s"
      "$CONTAINER" logs "$SPA_NAME" 2>&1 | tail -n 40
      exit 1
    }
  else
    log "starting the dev server on 127.0.0.1:$SPA_PORT"
    start spa env VITE_ENV=dev deno task spa:dev --port "$SPA_PORT" --strictPort --host 127.0.0.1
    SPA_PID=${PIDS[-1]}
    wait_for spa "$SPA_PID" 120 answers "http://127.0.0.1:$SPA_PORT/"
  fi
}
start_spa "${PASS_SERVER[0]}"

log "starting the proxy on 127.0.0.1:$FRONT_PORT"
start proxy env FRONT_PORT="$FRONT_PORT" API_PORT="$API_PORT" SPA_PORT="$SPA_PORT" \
  deno run --allow-net=127.0.0.1 --allow-env=FRONT_PORT,API_PORT,SPA_PORT \
  infra/scripts/e2e-local-proxy.ts
wait_for proxy "${PIDS[-1]}" 30 answers "http://127.0.0.1:$FRONT_PORT/api/health"

# Chromium resolves *.localhost itself; Playwright's own requests ask the system resolver.
getent hosts app.localhost >/dev/null 2>&1 ||
  log "warning: app.localhost does not resolve here; requests the specs make outside the browser will fail"

# The copy of the fixtures, and a config that points at it. Each pass adds its specs, with the port
# named. It lives inside the checkout so `@playwright/test` resolves through this node_modules.
mkdir -p "$COPY_DIR"
cp -r e2e/fixtures "$COPY_DIR/fixtures"
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

OFFLINE_SPECS=" $(deno eval 'import { OFFLINE_SPECS } from "./infra/scripts/e2e-local-plan.ts"; console.log(OFFLINE_SPECS.join(" "))') "

# Leaves in the copy the specs pass <specs> may see: `all`, `offline`, or `other` (the rest).
copy_specs() { # <all|offline|other>
  local spec name kind
  find "$COPY_DIR" -maxdepth 1 -name '*.e2e.ts' -delete
  for spec in e2e/*.e2e.ts; do
    name=$(basename "$spec")
    kind=other
    [[ "$OFFLINE_SPECS" == *" $name "* ]] && kind=offline
    [ "$1" = all ] || [ "$1" = "$kind" ] || continue
    sed -e "s#http://app.localhost\"#http://app.localhost:$FRONT_PORT\"#g" "$spec" \
      >"$COPY_DIR/$name"
  done
}

# What Playwright printed last in <log>: "12 passed (1.2m)", "1 failed", "2 flaky" and the like.
# Only for the summary: some reporters print no such line, and the exit code never reads it.
counts() { # <log>
  sed -e 's/\x1b\[[0-9;]*[A-Za-z]//g' "$1" | tr '\r' '\n' |
    grep -E '^ +[0-9]+ (passed|failed|flaky|skipped|interrupted|did not run)' |
    sed -e 's/^ *//' | paste -sd, - | sed -e 's/,/, /g'
}

PASSES=${#PASS_SERVER[@]}
STATUS=0
SUMMARY=()
EMPTY=0 # the passes in which Playwright found no test
for i in "${!PASS_SERVER[@]}"; do
  server=${PASS_SERVER[i]}
  start_spa "$server"
  copy_specs "${PASS_SPECS[i]}"
  ARGS=()
  [ -z "${PASS_ARGS[i]}" ] || mapfile -t ARGS <<<"${PASS_ARGS[i]%$'\n'}"
  REPORT="$ROOT/e2e/report"
  [ "$i" = 0 ] || REPORT="$ROOT/e2e/report/offline"
  # In the background, so a signal reaches the traps above while Playwright runs.
  log "pass $((i + 1)) of $PASSES: running Playwright at http://app.localhost:$FRONT_PORT ($server)"
  PLAYWRIGHT_HTML_OUTPUT_DIR="$REPORT" setsid \
    timeout --kill-after=10 "${E2E_LOCAL_TIMEOUT:-1500}" \
    deno run -A --node-modules-dir npm:playwright@1.57.0 test \
    --config="$COPY_DIR/playwright.config.ts" "${ARGS[@]}" > >(tee "$SCRATCH/pass-$i.log") 2>&1 &
  PIDS+=($!)
  PASS_STATUS=0
  wait "${PIDS[-1]}" || PASS_STATUS=$?
  # `tee` may still be writing the last lines.
  sleep 1
  COUNTS=$(counts "$SCRATCH/pass-$i.log" || true)
  SHOWN=$PASS_STATUS
  if [ "$PASS_STATUS" = 124 ]; then
    COUNTS="did not finish within ${E2E_LOCAL_TIMEOUT:-1500} s${COUNTS:+, $COUNTS}"
  elif [ "$PASS_STATUS" != 0 ] && grep -q "Error: No tests found" "$SCRATCH/pass-$i.log"; then
    # Playwright's own error and exit code, whatever the reporter.
    COUNTS="no test found"
    EMPTY=$((EMPTY + 1))
    # The other pass may hold every test the arguments ask for.
    [ "$PASSES" = 1 ] || PASS_STATUS=0
  fi
  SUMMARY+=("pass $((i + 1)), $server: ${COUNTS:+$COUNTS }(exit $SHOWN)")
  [ "$STATUS" != 0 ] || STATUS=$PASS_STATUS
done
for line in "${SUMMARY[@]}"; do log "$line"; done
if [ "$PASSES" -gt 1 ] && [ "$EMPTY" = "$PASSES" ]; then
  log "no test found in any pass"
  STATUS=1
fi
exit "$STATUS"
