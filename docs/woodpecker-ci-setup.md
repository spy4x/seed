# Woodpecker CI Setup Guide

## Overview

The pipeline lives in `.woodpecker/ci.yml`. Woodpecker reads every `*.yml` file in the
`.woodpecker/` folder at the repository root as its own workflow, with no setting to change in its
web interface. Every product copied from the template gets the pipeline the moment its repository is
activated in Woodpecker.

It runs on every pull request, every push to `main` and every tag, in this order; only
`release.yml` (below) filters tags to `v<digit>*`. A push to any other branch runs nothing: open a
pull request to run the pipeline. This is the one list of CI's steps; other pages link here.

```
check ──┬── build ────────┐
        ├── integration   │   (Postgres and Valkey services)
        ├── backup-restore│   (Postgres service)
        └── e2e-mpa ──────┴── e2e-spa ──┬── e2e-smoke   (pull request and tag)
               │                        └── e2e-full    (push to `main`)
               └── lighthouse
```

- `check` runs `deno task check`: format, lint, type check and unit tests.
- `build` runs `deno task build` (the SPA production build).
- `integration` runs `deno task test:integration` against a throw-away `postgres:18.6-alpine`
  service (user `tester`, password `ci-throwaway`, database `template_test`, reachable as host
  `postgres`) and a `valkey/valkey:8.1` service (password `ci-throwaway`, host `valkey`). It waits
  over TCP for both servers, see docs/handoff.md trap 3.
- `backup-restore` runs `infra/backup/restore.test.sh` in the `postgres:18.6` image against the same
  Postgres service: it backs a database up with restic, restores it into an empty one and compares
  them (docs/backups.md).
- `e2e-mpa` and `e2e-spa` run the website's browser tests and the SPA behind nginx
  (`e2e/mpa/run.sh`, `e2e/spa/run.sh`).
- `lighthouse` runs `deno task lighthouse` (`apps/mpa/lighthouse/run.sh`): the website's pages,
  built and served behind nginx with gzip, must score at least 95 for performance and 100 for
  accessibility, best practices and SEO in Lighthouse mobile. The pages are listed in
  `apps/mpa/lighthouse/lighthouserc.json`.
- `e2e-smoke` runs the product's smoke set on every pull request and tag:
  `deno task e2e:local --smoke --max-failures=3`, the script a developer runs, against the Postgres
  and Valkey services (`E2E_SERVICES=environment`). The set is `SMOKE_SPECS` in
  `infra/scripts/e2e-local-plan.ts`: `auth-profile-ws-push.e2e.ts`, `sign-in-next.e2e.ts`,
  `notes.e2e.ts`, `profile-two-tabs.e2e.ts`, `groups-pages.e2e.ts` and `url-filters.e2e.ts`. A pull
  request that breaks sign-in, the profile, notes or the groups pages in a browser fails here.
- `e2e-full` runs every `e2e/*.e2e.ts` on a push to `main` only: `deno task e2e:local
  --max-failures=10`, with the built SPA in the container's own nginx for the specs that start the
  app with no network (`E2E_BUILT=nginx`). It is not part of the pull-request check, so it blocks no
  merge; a red run on `main` says the last merge broke a screen outside the smoke set.
- The four browser steps run in `mcr.microsoft.com/playwright`, which ships Chromium and its system
  libraries, and install the pinned Deno release from GitHub, checked against its SHA-256.
  Playwright's own browser download, run through Deno in the plain Deno image, hangs. The image
  tag must equal the Playwright version in `deno.jsonc` (`e2e` task), because the browser build in
  the image belongs to that version.
- The browser steps run one after another: each keeps the API's `vapid.json` in the shared
  checkout and starts a worker on the one Valkey service.
- Both steps stop after that many failed tests. With sign-in broken every test fails, each after
  30 s, and a step would otherwise run into the script's limit of 25 minutes.
- A failed test is not retried: one failure fails the step, so a test that fails every second run
  shows red, not green (`tests/playwright-retries.test.ts`).

None of these steps needs a secret. A pull request from a fork waits until someone approves it in
Woodpecker, because the repository requires approval for forks.

Every Deno step runs `deno install --frozen` first, so a `deno.lock` that does not match
`deno.jsonc` fails the pipeline instead of being rewritten.

## Deploy is not wired up

Deploys run from a developer's machine with `deno task deploy` (docs/deploy.md, "Production
certificates"). `.woodpecker/deploy.yml.example` holds an old build and
deploy pipeline. Woodpecker ignores it because of the extension, and its steps have never run:
its header lists what would have to change first. This guide documents no secrets or SSH keys for
it, because nothing reads them.

## Activating a repository

1. In Woodpecker, open the repository and enable it. The forge webhook is created for you.
2. Leave the repository's **Pipeline path** empty. Woodpecker then uses `.woodpecker/`. Setting it
   to another path (for example `infra/configs/`) hides the pipeline from every copy of the
   template.
3. Check that a pull request shows the `check`, `build`, `integration`, `backup-restore`,
   `e2e-mpa`, `e2e-spa` and `e2e-smoke` results (`gh pr checks <number>`).

## Releases

`.woodpecker/release.yml` waits for `ci.yml` and runs when a tag `v<digit>*` is pushed. Setup:

1. In the Woodpecker server, make the global secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   available to the `tag` event.
2. Set `IMAGE_PREFIX` at the top of `release.yml` (the Docker Hub name, without the image suffix).
3. Keep the images public: the product images start from the published base image.

Steps: `guard` (the tagged commit must be an ancestor of `main`), `build-base`, `publish-base`, then
`build-api`, `build-spa` and `build-mpa` in parallel, each followed by its `publish-*`. Kaniko
builds into a tar file without any secret, and crane, the only step with the token, pushes it. A
version without a pre-release suffix also gets `latest`. The worker and the migration run the API
image, so there is no worker image. How to cut a release: [the deploy guide](deploy.md#releases).

## Changing the Deno version

Change the tag in every `image: denoland/deno:<version>` line of `ci.yml`, and the release URL and
SHA-256 in the five Playwright steps (`e2e-mpa`, `e2e-spa`, `e2e-smoke`, `e2e-full`, `lighthouse`). Keep them
equal to `DENO_VERSION` in `infra/envs/.env.example` and `Dockerfile.base`.

## Running the steps locally

```bash
# The checks, the integration tests (recipe in docs/handoff.md) and the smoke set
deno task check
deno task test:integration
deno task e2e:local --smoke
```

## Additional Resources

- [Woodpecker CI Documentation](https://woodpecker-ci.org/docs)
- [Woodpecker Secrets](https://woodpecker-ci.org/docs/usage/secrets)
- [Services in Woodpecker](https://woodpecker-ci.org/docs/usage/services)
