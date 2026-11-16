# The image of the browser steps in .woodpecker/ci-browser.yml (`browser`, `lighthouse`,
# `e2e-smoke`, `e2e-full`): the Playwright image with everything those steps would otherwise
# download on every run. .woodpecker/ci-image.yml builds and publishes it on a `ci-image-<n>` tag
# (docs/woodpecker-ci-setup.md, "The CI image").
#
# Playwright 1.57.0 must equal the version `deno task e2e` runs (deno.jsonc), because the browser
# build inside the image is tied to that version. Deno 2.9.7 must equal the version ci.yml and the
# `ready` step of ci-browser.yml use. Change them together.
FROM mcr.microsoft.com/playwright:v1.57.0-noble@sha256:3bed4b1a12f2338642f3d8cba28e291deef3c66bd4a964bbeb3e57bbff511dbd

# unzip unpacks the Deno release below. nginx serves the built SPA in `browser` and `e2e-full`, and
# the built website behind gzip in `lighthouse` (apps/mpa/lighthouse/run.sh).
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends unzip nginx \
  && find /var/lib/apt/lists -mindepth 1 -delete

# npm's newest `deno` package lags the binary, so take the pinned release itself, checked against
# its SHA-256.
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 5 -o /tmp/deno.zip https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip \
  && echo "c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490  /tmp/deno.zip" | sha256sum -c - \
  && unzip -q -o /tmp/deno.zip -d /usr/local/bin \
  && chmod +x /usr/local/bin/deno \
  && find /tmp/deno.zip -delete

# A fixed Deno cache, so the steps find what this image cached. Lighthouse CI is cached by running
# the command apps/mpa/lighthouse/run.sh runs, with `--version`. There is no deno.jsonc here, so
# this has the effect of run.sh's `--no-config`, which the step needs to start it without a
# download. The version must follow run.sh. The steps run as root, which owns the cache.
ENV DENO_DIR=/opt/deno
RUN deno run -A --no-lock npm:@lhci/cli@0.15.1 --version
