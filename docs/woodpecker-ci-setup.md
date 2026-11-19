# Woodpecker CI Setup Guide

## Overview

The pipeline is two workflows: `.woodpecker/ci.yml` (`check`, `secrets`, the steps that start the
stack and the four image steps) and `.woodpecker/ci-browser.yml` (`browser`, `lighthouse`,
`e2e-smoke`, `e2e-full`). Woodpecker reads every `*.yml` file in the `.woodpecker/` folder at the
repository root as its own workflow and runs them at the same time, each in its own checkout with
its own services, with no setting to change in its web interface. Every product copied from the
template gets the pipeline the moment its repository is activated in Woodpecker. They report
`ci/woodpecker/pr/ci` and `ci/woodpecker/pr/ci-browser` on a pull request, and branch protection
requires both.

`ci.yml` runs on every pull request, every push to `main`, every release tag `v<digit>*` and the
nightly run on `main` (below); `ci-browser.yml` on all of them but a push to `main`. A tag
`ci-image-<n>` runs only `ci-image.yml` ([The CI image](#the-ci-image)). A push to `main` runs only `check`, `secrets` and the four image steps: its pull
request already ran the rest. A push to any other branch runs nothing: open a pull request to run
the pipeline. This is the one list of CI's steps; other pages link here.

A pull request opened before the split into two workflows reports no `ci/woodpecker/pr/ci-browser`
until it merges `main`, so it cannot merge before that.

A pull request whose title starts with `[WIP]` runs `.woodpecker/wip.yml` instead: `check` and
`secrets` only, copies of `ci.yml`'s steps, reported as `ci/woodpecker/pr/wip`. While the pull
request changes no file, as with only the empty commit that claims an issue, it runs nothing
(`on_empty: false`). Removing `[WIP]`
from the title starts `ci.yml` and `ci-browser.yml` without a new push (Woodpecker's
`pull_request_metadata` event with the reason `edited`), and every later push runs them too. A
commit pushed while the title starts with `[WIP]` has neither `ci/woodpecker/pr/ci` nor
`ci/woodpecker/pr/ci-browser`, which branch protection requires, so it cannot merge. Putting
`[WIP]` back without a push runs nothing and keeps the earlier statuses, so it does not block a
merge. Editing the body of a ready pull request is also `edited` and re-runs both workflows; that
is rare and accepted.

```
ci.yml (Postgres and Valkey services)       ci-browser.yml (its own Postgres and two Valkeys)

secrets                                     ready
check ──┬── integration                     browser (build,          e2e-smoke
        ├── backup-restore                    e2e-mpa, e2e-spa)      (pull request, tag)
        ├── alert-rules                         └──────────┬───────────┘
        └── runtimes                        lighthouse (website changes, nightly, tag)
image-node, image-bun,                                 │
image-mpa-node, image-mpa-bun               e2e-full (nightly)
```

`browser` and `e2e-smoke` start together, and `lighthouse` starts when both have ended. A pull
request that changes no file of the website skips `lighthouse`. `ready` only echoes a line: a pull request that changes only Markdown
skips every other step of `ci-browser.yml`, and a workflow with no step left posts no status, so
the required `ci/woodpecker/pr/ci-browser` would never arrive.

A pull request that changes only Markdown outside the product (the root `*.md` files, any
`README.md`, `docs/**/*.md`, `i18n/*.md`, `.github/` and `.claude/`: `markdown_only` under
`variables` in `ci.yml`, copied into `ci-browser.yml`) skips `integration`, `backup-restore`, `alert-rules`, `runtimes` and
`e2e-smoke`, which cannot fail over such a change and took about 20 minutes. `check` still runs,
and so does `lighthouse` when its own list names a changed file; the images only when one of
their own files changed (below). `browser` runs
only when a guide in `docs/*.md` changed (`internal_markdown`), because the website renders the
guides and `e2e/mpa/docs.mpa.ts` tests them. `ci-browser.yml` still runs `ready`.

Woodpecker runs the steps of a workflow in stages: a step starts only when the whole stage before
it has ended, so a workflow's wall time is the slowest step of each stage, added up, and the
pipeline's is that of the slower workflow. Checks that must run one after another in the shared
checkout are therefore commands of one step, `browser` (the reasons are in `ci-browser.yml`).
`lighthouse` is a stage of its own in `ci-browser.yml`, because lab performance falls when another
step shares the CPU; `ci.yml`'s steps run at the same time in their own workflow, and may share
the host with it.

- `check` runs `deno task check`: format, lint, type check and unit tests. On a pull request or
  its title edit, the unit tests and `integration` run only the test files whose imports reach a
  file the pull request changes, against the tip of its target branch, and the log says how many
  ran and how many were skipped. A change the imports cannot show (`deno.lock`, a `deno.json`,
  `.woodpecker/`, the migrations, `schema.sql`, fixtures, the test scripts: `RUN_ALL` in
  `infra/scripts/test.ts`) runs them all. A git failure fails the step, so a broken selection
  shows instead of silently costing a full run. Test groups that read the source tree from disk or
  run a program always run whole. A push to `main`, a tag and the nightly run test everything.
- `secrets` scans commits for secrets with gitleaks, beside `check`, on every event. A pull request
  scans its own commits since it left the target branch, so a key added and then removed in the
  same pull request still fails it; every other event scans the whole history. The log
  shows each finding with its value redacted. Run it locally with `gitleaks git . --redact` (every
  branch) or `gitleaks git . --redact --log-opts=origin/main..HEAD` (your branch, as CI does). To
  allow a false positive, end its line with a `gitleaks:allow` comment; a finding in a commit that
  is already pushed goes into `.gitleaksignore` instead, as the fingerprint gitleaks prints, under
  a `#` comment that says why it is no secret. A real secret is revoked first: removing it from
  the history does not help once it is public.
- `integration` runs `deno task test:integration --parallel`, four test files at a time, against a throw-away `postgres:18.6-alpine`
  service (user `tester`, password `ci-throwaway`, database `template_test`, reachable as host
  `postgres`) and a `valkey/valkey:8.1` service (password `ci-throwaway`, host `valkey`). It waits
  over TCP for both servers, see docs/handoff.md trap 3. The Postgres service runs with `fsync`,
  `synchronous_commit` and `full_page_writes` off: its data is thrown away with the run.
- `backup-restore` runs `infra/backup/restore.test.sh` in the `postgres:18.6` image against the same
  Postgres service: it backs a database up with restic, restores it into an empty one and compares
  them (docs/backups.md).
- `browser` runs three checks, one after another:
  - build: `deno task build` (the SPA production build);
  - e2e-mpa: the website's browser tests (`e2e/mpa/run.sh`);
  - e2e-spa: the SPA behind nginx (`e2e/spa/run.sh`).
- `lighthouse` builds the website and runs `deno task lighthouse` (`apps/mpa/lighthouse/run.sh`):
  the website's pages, served behind nginx with gzip, must score at least 95 for performance and
  100 for accessibility, best practices and SEO in Lighthouse mobile. The pages are listed in
  `apps/mpa/lighthouse/lighthouserc.json`, and the nightly run and a tag measure each three times. A
  pull request measures only the pages in `apps/mpa/lighthouse/quick.ts`, one run each
  (`LIGHTHOUSE_PAGES=quick`), against the same scores. It starts when `ready` and `browser` have
  ended, and the e2e steps wait for it, so nothing else of `ci-browser.yml` runs beside it. The nightly run and a tag
  always run it, and a push to `main` never. A pull request runs it only when it changes a file the website is built from: the
  `path` list of the step in `ci-browser.yml` (`apps/mpa`, `libs/ui`, `libs/domain`, the `libs/server`
  members the website imports, the two API files its stand-in blog API serves, `i18n`, the guides
  in `docs/*.md`, the manifests, `deno.lock` and `ci-browser.yml` itself). A new import of the website from another folder adds that folder to the list.
  The e2e steps depend on it as optional, so they still run when it is skipped.
- `image-node`, `image-bun`, `image-mpa-node` and `image-mpa-bun` build the Node and Bun images of
  the API and the website with kaniko, pushing nothing. A push to `main` and a tag always build them,
  the nightly run never;
  a pull request only when it changes what decides whether an image builds: the four Dockerfiles,
  `.dockerignore`, `deno.jsonc`, `deno.lock` and `ci.yml` (`image_when` under `variables` in
  `ci.yml`). A source change that breaks a bundle is caught by the push to `main` after the merge
  ([ringmaster#296](https://github.com/spy4x/ringmaster/issues/296)), to save CPU on the shared CI
  host.
- `e2e-smoke` runs the product's smoke set on every pull request (except one that changes only
  Markdown, above) and tag:
  `deno task e2e:local --smoke --max-failures=3`, the script a developer runs, against the Postgres
  and Valkey services (`E2E_SERVICES=environment`). The set is `SMOKE_SPECS` in
  `infra/scripts/e2e-local-plan.ts`: `auth-profile-ws-push.e2e.ts`, `sign-in-next.e2e.ts`,
  `notes.e2e.ts`, `profile-two-tabs.e2e.ts`, `groups-pages.e2e.ts` and `url-filters.e2e.ts`. A pull
  request that breaks sign-in, the profile, notes or the groups pages in a browser fails here.
- `e2e-full` runs every `e2e/*.e2e.ts` in the nightly run only: `deno task e2e:local
  --max-failures=10`, with the built SPA in the container's own nginx for the specs that start the
  app with no network (`E2E_BUILT=nginx`). It is not part of the pull-request check, so it blocks no
  merge; a red nightly run says a merge broke a screen outside the smoke set.
- The four browser steps run in the CI image ("The CI image" below), built on
  `mcr.microsoft.com/playwright`, which ships Chromium and its system libraries, with the pinned
  Deno release in it. Playwright's own browser download, run through Deno in the plain Deno image,
  hangs. The Playwright tag in `infra/ci/playwright.dockerfile` must equal the Playwright version in
  `deno.jsonc` (`e2e` task), because the browser build in the image belongs to that version.
- `browser` and `e2e-smoke` run at the same time in the checkout of `ci-browser.yml`. `browser`'s
  scripts keep the API's `vapid.json` in the checkout's root and use the `valkey` service;
  `e2e-smoke` keeps its keys in a scratch folder (`VAPID_KEYS_PATH`) and uses `valkey-smoke`, so
  neither worker takes the other's jobs. `e2e-full` runs after `browser`, on `valkey`. `ci.yml`'s
  steps have a checkout and services of their own, so they never meet.
- Both steps stop after that many failed tests. With sign-in broken every test fails, each after
  30 s, and a step would otherwise run into the script's limit of 25 minutes.
- A failed test is not retried: one failure fails the step, so a test that fails every second run
  shows red, not green (`tests/playwright-retries.test.ts`).

None of these steps needs a secret. A pull request from a fork waits until someone approves it in
Woodpecker, because the repository requires approval for forks.

Every Deno step runs `deno install --frozen` first, so a `deno.lock` that does not match
`deno.jsonc` fails the pipeline instead of being rewritten.

## The nightly run

A cron run on `main` every night runs both workflows: `check`, `secrets`, the stack's steps
(`integration`, `backup-restore`, `alert-rules`, `runtimes`), and in `ci-browser.yml` `browser`,
the full `lighthouse` run and `e2e-full`. It skips the images, which the push to `main` built, and `e2e-smoke`, whose specs
`e2e-full` runs too. The slow steps, `e2e-full` (about 40 minutes) and the full Lighthouse run
(about 15), run here rather than on each push to `main` for two reasons: the repository cancels a
running push or pull-request pipeline when a newer one starts, but never a cron one, so the run
finishes; and a merge, and a deploy that waits for `ci.yml`, no longer waits about 55 minutes. A red
nightly run is the sign that a merge broke something pull requests do not test. It blocks nothing.

Woodpecker keeps crons on the server, not in the workflow files, so create it once per repository:

- In the web interface: the repository's settings, **Crons**, name `nightly`, branch `main`,
  schedule `0 2 * * *` (02:00 UTC every day).
- Or with the API and a personal access token:

  ```sh
  curl -fsS -X POST -H "Authorization: Bearer $WOODPECKER_TOKEN" -H 'Content-Type: application/json' \
    -d '{"name":"nightly","branch":"main","schedule":"0 2 * * *"}' \
    "$WOODPECKER_SERVER/api/repos/<repo id>/cron"
  ```

The schedule takes five fields (minute, hour, day of month, month, day of week) or a descriptor such
as `@daily`, with no seconds field, in the cron's time zone, UTC unless set. A product that copies
`ci.yml` and `ci-browser.yml` creates its own cron the same way.

## Deploy on every push to main

Deploys run from a developer's machine with `deno task deploy` ([Deploy an
update](deploy-updates.md)) until a product turns on `.woodpecker/deploy.yml.example`. Then every
push to the default branch that passes `ci.yml` deploys itself the same way; a push runs no
`ci-browser.yml`, so the deploy waits for `ci` alone. Seed keeps it off
and deploys its own demo nightly from `.woodpecker/demo-deploy.yml`, which a product deletes.

1. Copy the file: `cp .woodpecker/deploy.yml.example .woodpecker/deploy.yml`. Change `main` in its
   `when` when the default branch has another name.
2. Make an SSH key for the pipeline alone: `ssh-keygen -t ed25519 -N '' -f deploy_key`. Add
   `deploy_key.pub` to the deploy user's `~/.ssh/authorized_keys` on the server.
3. In Woodpecker, open the repository's secrets and add four, each for the **push** event only:

   | Secret | Value |
   | --- | --- |
   | `deploy_ssh_key` | The private key, `deploy_key`. |
   | `deploy_ssh_config` | An SSH `Host` block named as `SSH_TO_SERVER`, with `HostName`, `Port` and `User`. |
   | `deploy_known_hosts` | `ssh-keyscan -p <port> <host>`, checked against the server's own keys. |
   | `deploy_env_key` | The contents of `.age/key.txt`, the key that decrypts the env files. |

4. Delete the local copies of `deploy_key` and `deploy_key.pub`, then merge the copy to the
   default branch. Its push pipeline is the first deploy. `gh pr checks` does not show it; the
   Woodpecker page of that push does.

The step holds the age key and an SSH key that can run Docker on the server, so its secrets are
limited to the push event: a pull request never sees them. Only code that reached the default
branch runs the deploy. A failed deploy turns that push pipeline red; fix it before the next merge.

## Activating a repository

1. In Woodpecker, open the repository and enable it. The forge webhook is created for you.
2. Leave the repository's **Pipeline path** empty. Woodpecker then uses `.woodpecker/`. Setting it
   to another path (for example `infra/configs/`) hides the pipeline from every copy of the
   template.
3. In the repository's settings, set **Cancel previous pipelines** to the events `push`,
   `pull_request` and `pull_request_metadata`. Removing `[WIP]` from a title starts a
   `pull_request_metadata` run; a push or another title edit right after it supersedes that run,
   and without this event it would keep an agent busy until it ends.
4. Check that a pull request without `[WIP]` in its title shows both statuses,
   `ci/woodpecker/pr/ci` and `ci/woodpecker/pr/ci-browser` (`gh pr checks <number>`).
5. In the forge's branch protection of `main`, require both statuses.

## Releases

`.woodpecker/release.yml` waits for `ci.yml` and `ci-browser.yml` and runs when a tag `v<digit>*` is pushed. Setup:

1. In the Woodpecker server, make the global secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   available to the `tag` event.
2. Set `IMAGE_PREFIX` at the top of `release.yml` (the Docker Hub name, without the image suffix).
3. Keep the images public: the product images start from the published base image.

Steps: `guard` (the tagged commit must be an ancestor of `main`), `build-base`, `publish-base`, then
`build-api`, `build-spa` and `build-mpa` in parallel, each followed by its `publish-*`. Kaniko
builds into a tar file without any secret, and crane, the only step with the token, pushes it. A
version without a pre-release suffix also gets `latest`. The worker and the migration run the API
image, so there is no worker image. How to cut a release: [Publish a release](releases.md).

## The CI image

`infra/ci/playwright.dockerfile` is the image of the four browser steps of `ci-browser.yml`
(`browser`, `lighthouse`, `e2e-smoke`, `e2e-full`): the Playwright image, plus `unzip`, `nginx`,
Deno and a Deno cache (`DENO_DIR=/opt/deno`) that already holds Lighthouse CI. A step that runs in
it downloads none of them. For those steps, the Dockerfile is the one place that holds the
versions of Playwright, Deno and Lighthouse CI.

To publish a new one, push a tag `ci-image-<n>` on a commit that is on `main`:

```bash
git tag ci-image-2 origin/main && git push origin ci-image-2
```

`.woodpecker/ci-image.yml` builds it with kaniko and pushes it with crane as
`<IMAGE_PREFIX>-ci:<n>` (here `antonshubin/template-ci:2`), with the same secrets and guard as
releases. It never moves `latest`. A product changes `IMAGE_PREFIX` at the top of `ci-image.yml`.
Then pin the new tag by its digest in the four browser steps of `ci-browser.yml`
(`image: <IMAGE_PREFIX>-ci:<n>@sha256:<digest>`; a product that changed `IMAGE_PREFIX` changes the
name there too). The digest is on Docker Hub:

```bash
curl -s https://hub.docker.com/v2/repositories/antonshubin/template-ci/tags/2 | jq -r .digest
```

## Changing the Deno version

Change the tag in every `image: denoland/deno:<version>` line of `ci.yml`, and the release URL and
SHA-256 in `runtimes` and in `infra/ci/playwright.dockerfile`, then publish a new CI image and pin
it in the four browser steps of `ci-browser.yml` (above). `ready` in `ci-browser.yml` pins the
Deno image by tag and digest: update both. Keep them equal to `DENO_VERSION` in `infra/envs/.env.example` and `Dockerfile.base`.

## Running the steps locally

```bash
# The checks, the integration tests (recipe in docs/handoff.md) and the smoke set
deno task check
deno task test:integration
deno task e2e:local --smoke
# The secrets scan of your branch
gitleaks git . --redact --log-opts=origin/main..HEAD
```

## Additional Resources

- [Woodpecker CI Documentation](https://woodpecker-ci.org/docs)
- [Woodpecker Secrets](https://woodpecker-ci.org/docs/usage/secrets)
- [Services in Woodpecker](https://woodpecker-ci.org/docs/usage/services)
