#!/usr/bin/env bash
# The Lighthouse check of the public website (`deno task lighthouse`): every page in
# lighthouserc.json must score, in Lighthouse mobile, at least 95 for performance and 100 for
# accessibility, best practices and SEO, the median of three runs ("Design gate" in the global
# agent rules). Starts the blog API stand-in (blog-api.ts) on 48412, the built MPA (`deno task
# mpa:build` first) on port 48410, nginx with gzip in
# front of it on 48411 (nginx.conf), and Lighthouse CI. Reports land in .lighthouseci/.
# CI runs this script (.woodpecker/ci.yml); run it the same way on a machine, from the repository
# root. Needs nginx, and a Chromium: `CHROME_PATH`, or the newest one Playwright installed.
set -euo pipefail

HERE=apps/mpa/lighthouse
[ -f apps/mpa/_fresh/server.js ] || { echo "no MPA build: run deno task mpa:build first"; exit 1; }

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
  for pid in "${PIDS[@]}"; do
    # `deno serve` does not exit on SIGTERM when it has open connections: stop it for good.
    kill -TERM "$pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
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

# The blog's pages read the API: blog-api.ts answers its public routes with the dev seed's
# published post, so /blog and that post are measured with content. Every other API address
# answers 404, and the pages render without it.
timeout 900 deno run --allow-net=127.0.0.1 "$HERE/blog-api.ts" 48412 >"$SCRATCH/api.log" 2>&1 &
PIDS+=($!)
wait_for api "${PIDS[-1]}" http://127.0.0.1:48412/api/blog/posts

# Production mode, with example hosts.
ENV=prod DOMAIN=app.example.com MPA_DOMAIN=www.example.com API_URL=http://127.0.0.1:48412 \
  timeout 900 deno serve --allow-all --port 48410 --host 127.0.0.1 apps/mpa/_fresh/server.js \
  >"$SCRATCH/mpa.log" 2>&1 &
PIDS+=($!)
wait_for mpa "${PIDS[-1]}" http://127.0.0.1:48410/health

timeout 900 nginx -p "$SCRATCH" -e stderr -c "$PWD/$HERE/nginx.conf" -g 'daemon off;' \
  >"$SCRATCH/nginx.log" 2>&1 &
PIDS+=($!)
wait_for nginx "${PIDS[-1]}" http://127.0.0.1:48411/health

# Outside deno.lock: Lighthouse CI's own dependencies include the npm `uuid` package, which
# tests/no-uuid-v4.test.ts refuses in any tracked file. The version is pinned here, and the
# repository's minimum dependency age still holds for everything it pulls in.
deno run -A --no-lock npm:@lhci/cli@0.15.1 autorun --config="$HERE/lighthouserc.json"
