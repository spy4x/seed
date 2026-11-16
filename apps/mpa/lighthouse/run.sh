#!/usr/bin/env bash
# The Lighthouse check of the public website (`deno task lighthouse`): every page in
# lighthouserc.json must score, in Lighthouse mobile, at least 95 for performance and 100 for
# accessibility, best practices and SEO, the median of three runs ("Design gate" in the global
# agent rules). `LIGHTHOUSE_PAGES=quick`, which pull requests set (.woodpecker/ci-browser.yml), measures
# only the pages in quick.ts, one run each, against the same scores; `all`, the default, measures
# every page. Starts the blog API stand-in (blog-api.ts) on 48412, the built MPA (`deno task
# mpa:build` first) on port 48410, nginx with gzip in
# front of it on 48411 (nginx.conf), and Lighthouse CI. Reports land in .lighthouseci/.
# CI runs this script (.woodpecker/ci-browser.yml); run it the same way on a machine, from the repository
# root. Needs nginx, and a Chromium: `CHROME_PATH`, or the newest one Playwright installed.
set -euo pipefail

HERE=apps/mpa/lighthouse
PAGES=${LIGHTHOUSE_PAGES:-all}
case "$PAGES" in
  all | quick) ;;
  *) echo "LIGHTHOUSE_PAGES must be all or quick, not $PAGES"; exit 1 ;;
esac
[ -f apps/mpa/dist/server.js ] || { echo "no MPA build: run deno task mpa:build first"; exit 1; }

if [ -z "${CHROME_PATH:-}" ]; then
  CHROME_PATH=$(find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" \
    -path '*/chromium-*/chrome-linux*/chrome' -type f 2>/dev/null | sort -V | tail -n 1)
  [ -n "$CHROME_PATH" ] || { echo "no Chromium found: set CHROME_PATH"; exit 1; }
fi
export CHROME_PATH

SCRATCH=$(mktemp -d)
PIDS=()
cleanup() {
  set +e
  # Each PID is a `timeout`, which passes TERM on to its server and, with `-k 5`, sends KILL five
  # seconds later: `deno serve` does not exit on TERM while it has open connections. Killing
  # `timeout` itself would leave the server running, so that is only the last resort.
  for pid in "${PIDS[@]}"; do
    kill -TERM "$pid" 2>/dev/null
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -KILL "$pid" 2>/dev/null
  done
  find "$SCRATCH" -delete
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

# The blog's pages read the API: blog-api.ts answers its public routes with the run's own fixture
# posts ($HERE/posts/), so /blog and a post are measured with content, and a product that deletes
# Seed's posts changes nothing here. Every other API address answers 404, and the pages render
# without it.
# The servers outlive every Lighthouse run: 54 runs took over 20 minutes on a loaded CI host.
timeout -k 5 2400 deno run --allow-net=127.0.0.1 --allow-read="$HERE/posts" "$HERE/blog-api.ts" 48412 >"$SCRATCH/api.log" 2>&1 &
PIDS+=($!)
wait_for api "${PIDS[-1]}" http://127.0.0.1:48412/api/blog/posts

# Production mode, with example hosts.
ENV=prod DOMAIN=app.example.com MPA_DOMAIN=www.example.com API_URL=http://127.0.0.1:48412 \
  timeout -k 5 2400 deno serve --allow-all --port 48410 --host 127.0.0.1 apps/mpa/dist/server.js \
  >"$SCRATCH/mpa.log" 2>&1 &
PIDS+=($!)
wait_for mpa "${PIDS[-1]}" http://127.0.0.1:48410/health

timeout -k 5 2400 nginx -p "$SCRATCH" -e stderr -c "$PWD/$HERE/nginx.conf" -g 'daemon off;' \
  >"$SCRATCH/nginx.log" 2>&1 &
PIDS+=($!)
wait_for nginx "${PIDS[-1]}" http://127.0.0.1:48411/health

CONFIG="$HERE/lighthouserc.json"
if [ "$PAGES" = quick ]; then
  CONFIG="$SCRATCH/lighthouserc.json"
  deno run --allow-read="$HERE" --allow-write="$CONFIG" "$HERE/quick.ts" "$HERE/lighthouserc.json" "$CONFIG"
fi

# Outside deno.lock: Lighthouse CI's own dependencies include the npm `uuid` package, which
# tests/no-uuid-v4.test.ts refuses in any tracked file. The version is pinned here.
# `--no-config` keeps deno.jsonc out: with it, Deno would resolve the project's own npm packages
# again on every run (`nodeModulesDir`), and the CI image's cache, made from this command with no
# config, would not cover them (infra/ci/playwright.dockerfile). So the repository's minimum
# dependency age does not hold here: what Lighthouse CI pulls in is resolved without it, in CI
# once, when the CI image is built.
# Lighthouse CI starts Lighthouse with Node, which finds Lighthouse's own packages only in a
# node_modules folder, never in Deno's cache. `--node-modules-dir=auto` makes one in the working
# directory, linked from that cache, so it runs in a scratch folder, away from the repository's
# own node_modules; the reports still land in .lighthouseci/reports.
ROOT=$PWD
case "$CONFIG" in /*) ;; *) CONFIG="$ROOT/$CONFIG" ;; esac
mkdir "$SCRATCH/lhci"
(cd "$SCRATCH/lhci" && deno run -A --no-config --no-lock --node-modules-dir=auto \
  npm:@lhci/cli@0.15.1 autorun --config="$CONFIG" --upload.outputDir="$ROOT/.lighthouseci/reports")
