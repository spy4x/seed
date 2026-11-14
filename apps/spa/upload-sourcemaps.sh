#!/bin/sh
# Uploads the SPA's source maps to the error tracker (GlitchTip or Sentry) for the release the
# bundle reports, so a browser error shows source file names and lines. Runs once per deploy in the
# `sourcemaps` service (infra/compose/compose.prod.yml), from the `sourcemaps` stage of
# apps/spa/dockerfile.prod, which holds the built files with their maps; the served image has none.
#
# Reads, at run time: SOURCEMAPS_URL (the tracker's address), SOURCEMAPS_TOKEN (an API token with
# the project:releases scope), SOURCEMAPS_ORG and SOURCEMAPS_PROJECT (the organization's and the
# SPA project's slugs), and APP_COMMIT (the release, baked in at build time). The token never
# reaches an image or a build argument.
#
# Reporting must never fail a deploy: a missing setting or a failed upload prints one line and
# exits 0. docs/stack.md, "Source maps".

if [ -z "$APP_COMMIT" ]; then
  echo "Source maps not uploaded: the build has no commit (APP_COMMIT), so reports name no release."
  exit 0
fi
if [ -z "$SOURCEMAPS_URL" ] || [ -z "$SOURCEMAPS_TOKEN" ]; then
  echo "Source maps not uploaded: SOURCEMAPS_URL or SOURCEMAPS_TOKEN is empty."
  exit 0
fi
if [ -z "$SOURCEMAPS_ORG" ] || [ -z "$SOURCEMAPS_PROJECT" ]; then
  echo "Source maps not uploaded: SOURCEMAPS_ORG or SOURCEMAPS_PROJECT is empty."
  exit 0
fi

# sentry-cli reads these; the token stays out of its command line.
export SENTRY_URL="$SOURCEMAPS_URL" SENTRY_AUTH_TOKEN="$SOURCEMAPS_TOKEN"
export SENTRY_ORG="$SOURCEMAPS_ORG" SENTRY_PROJECT="$SOURCEMAPS_PROJECT"

# `~/` matches a bundle on any host: the tracker pairs a frame with its map by file name.
if sentry-cli sourcemaps upload --release "$APP_COMMIT" --url-prefix '~/' /sourcemaps; then
  echo "Source maps uploaded for release $APP_COMMIT."
else
  echo "Source maps not uploaded: sentry-cli failed (above). The deploy goes on without them."
fi
exit 0
