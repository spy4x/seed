#!/usr/bin/env bash
# Runs the browser tests of the SPA as production serves it (`e2e/spa`): puts the built SPA behind
# nginx with `apps/spa/nginx.conf`, migrates the database, starts the API and the worker, puts both
# behind one origin (`e2e/mpa/proxy.ts`) and runs Playwright. The specs check what nginx adds and
# the development stack never shows: the security headers, and that the app runs under its content
# security policy without a refusal.
#
# `SPA_SERVER` says where nginx comes from:
# - `container` (the default): builds the image of `apps/spa/dockerfile.prod` as a deploy does and
#   runs it, with the container tool `CONTAINER_PROVIDER` (`podman` by default, as
#   `deno task compose`). The images it builds are removed when it ends.
# - `nginx`: for a machine without a container tool that is thrown away afterwards, which is the CI
#   step (.woodpecker/ci.yml). It builds the SPA here and copies it, `nginx.conf`, the generated
#   header file and the allow list to the paths the image has them at, under /etc and /usr/share,
#   runs the two start scripts and starts the installed nginx. It needs root and an installed
#   nginx, and it does not prove the `COPY` lines of the Dockerfile.
#
# Needs from the environment: a Postgres and a Valkey that are already running, as `DB_HOST`,
# `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME`, `KV_HOSTNAME`, `KV_PORT` and `KV_PASSWORD`, and a
# browser Playwright can start. Run it from the repository root.
# The tests do not run in `DB_NAME`: the script connects there, drops and creates its own database
# `template_e2e_spa` and runs the stack against that.
# `FRONT_PORT` and `API_PORT` default to 8090 and 8000. `SITE_PORT`, where nginx answers, defaults
# to 8002 for the container; the installed nginx listens on 8080, as `nginx.conf` says.
set -euo pipefail

SPA_SERVER=${SPA_SERVER:-container}
FRONT_PORT=${FRONT_PORT:-8090}
API_PORT=${API_PORT:-8000}
case "$SPA_SERVER" in
  container) SITE_PORT=${SITE_PORT:-8002} ;;
  nginx)
    SITE_PORT=8080
    [ "$(id -u)" = 0 ] || { echo "SPA_SERVER=nginx writes under /etc and /usr/share: it needs root"; exit 1; }
    command -v nginx >/dev/null || { echo "SPA_SERVER=nginx needs nginx installed"; exit 1; }
    ;;
  *) echo "SPA_SERVER is \"$SPA_SERVER\"; it must be container or nginx"; exit 1 ;;
esac
export FRONT_PORT API_PORT SITE_PORT

DENO_VERSION=${DENO_VERSION:-2.9.7}
CONTAINER=${CONTAINER_PROVIDER:-podman}
# Named after this run, so two runs at once never share an image, and removed at the end.
BASE_IMAGE="template-e2e-spa-base:$$"
SPA_IMAGE="template-e2e-spa:$$"
SPA_CONTAINER="template-e2e-spa-$$"
# The tracker the container is told about, so the spec can find its origin in the policy. Nothing
# listens there and the app reports to it only when an error happens.
ERROR_TRACKER_ORIGIN=https://errors.example.com
export ERROR_TRACKER_ORIGIN

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
  if [ "$SPA_SERVER" = container ]; then
    "$CONTAINER" rm --force "$SPA_CONTAINER" >/dev/null 2>&1
    "$CONTAINER" rmi --force "$SPA_IMAGE" "$BASE_IMAGE" >/dev/null 2>&1
  fi
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
export DEV_EMAIL=dev@example.com
export TIMEZONE=Etc/UTC
export RATE_LIMITER_WINDOW_MS=60000
export RATE_LIMITER_STRICT_LIMIT=1000
export RATE_LIMITER_LIMIT=5000
export RATE_LIMITER_OTP_WINDOW_MS=900000
export RATE_LIMITER_OTP_LIMIT=1000
export API_URL="http://127.0.0.1:$API_PORT"
export SPA_BASE_URL="http://$DOMAIN"

# A fresh database of its own. Dropped first, so a rerun starts empty instead of failing on
# "already exists" or inheriting rows from the last run. `DB_NAME` is only the database to connect
# to; it must exist.
E2E_DB_NAME=template_e2e_spa
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

# The worker sends the mail with the code that proves an address; the spec reads it back through
# /api/test/last-mail.
deno run --allow-all apps/worker/+main.ts >"$SCRATCH/worker.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do
  grep -q "Worker started" "$SCRATCH/worker.log" && break
  kill -0 "${PIDS[-1]}" 2>/dev/null || { echo "worker stopped"; tail -n 40 "$SCRATCH/worker.log"; exit 1; }
  sleep 0.5
done
grep -q "Worker started" "$SCRATCH/worker.log" || { echo "worker did not start within 60 s"; exit 1; }

TRACKER_DSN="https://public-key@${ERROR_TRACKER_ORIGIN#https://}/1"
if [ "$SPA_SERVER" = container ]; then
  # The image exactly as a deploy builds it: the base image first, then the SPA's own.
  "$CONTAINER" build --quiet --build-arg "DENO_VERSION=$DENO_VERSION" \
    --tag "$BASE_IMAGE" --file Dockerfile.base . >"$SCRATCH/base-image.log" 2>&1 ||
    { echo "the base image did not build"; tail -n 40 "$SCRATCH/base-image.log"; exit 1; }
  "$CONTAINER" build --quiet --build-arg "BASE_IMAGE=$BASE_IMAGE" \
    --tag "$SPA_IMAGE" --file apps/spa/dockerfile.prod . >"$SCRATCH/spa-image.log" 2>&1 ||
    { echo "the SPA image did not build"; tail -n 40 "$SCRATCH/spa-image.log"; exit 1; }
  "$CONTAINER" run --detach --name "$SPA_CONTAINER" --publish "127.0.0.1:$SITE_PORT:8080" \
    --env SPA_ENV=dev --env "SPA_ERROR_REPORT_DSN=$TRACKER_DSN" "$SPA_IMAGE" >/dev/null
  spa_log() { "$CONTAINER" logs "$SPA_CONTAINER" 2>&1 | tail -n 40; }
else
  # What apps/spa/dockerfile.prod does, by hand: keep the two in step.
  VITE_ENV=prod deno task spa:build >"$SCRATCH/spa-build.log" 2>&1 ||
    { echo "the SPA did not build"; tail -n 40 "$SCRATCH/spa-build.log"; exit 1; }
  HTML=/usr/share/nginx/html
  cp -r apps/spa/dist/. "$HTML/"
  # The distribution's own site would answer too; this configuration is the only one.
  find /etc/nginx/sites-enabled/default -delete 2>/dev/null || true
  mkdir -p /etc/nginx/conf.d /etc/nginx/spa /etc/spa
  cp apps/spa/nginx.conf /etc/nginx/conf.d/default.conf
  cp apps/spa/security-headers.conf /etc/nginx/spa/security-headers.conf
  cp apps/spa/public-env.allow /etc/spa/public-env.allow
  ln -sf /tmp/config.json "$HTML/config.json"
  # The two scripts nginx's entrypoint runs in the image before nginx starts.
  SPA_ENV=dev SPA_ERROR_REPORT_DSN="$TRACKER_DSN" sh apps/spa/runtime-config.sh
  SPA_ENV=dev SPA_ERROR_REPORT_DSN="$TRACKER_DSN" sh apps/spa/csp-connect.sh
  nginx -g "daemon off;" >"$SCRATCH/nginx.log" 2>&1 &
  PIDS+=($!)
  spa_log() { tail -n 40 "$SCRATCH/nginx.log"; }
fi
for _ in $(seq 1 120); do
  curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$SITE_PORT/" 2>/dev/null && break
  sleep 0.5
done
curl -fsS --max-time 2 -o /dev/null "http://127.0.0.1:$SITE_PORT/" ||
  { echo "nginx did not answer within 60 s"; spa_log; exit 1; }

deno run --allow-net --allow-env e2e/mpa/proxy.ts >"$SCRATCH/proxy.log" 2>&1 &
PIDS+=($!)
wait_for proxy "${PIDS[-1]}" "$SPA_BASE_URL/config.json"

deno task e2e --config=e2e/spa/playwright.config.ts
