# Run the browser tests

> Also on the website: [seedsaas.com/docs/browser-tests](https://seedsaas.com/docs/browser-tests).

This page runs the Playwright specs in `e2e/` and says which of them CI runs, and when.

You need:

- A container tool: Podman, or Docker with `CONTAINER_PROVIDER=docker`.
- The Chromium of the pinned Playwright.

## Run them

`e2e:local` starts a stack of its own on spare ports: Postgres, Valkey, the API, the worker, the
SPA and a proxy. It removes all of it when it ends or is stopped.

```sh
deno task e2e:local
```

| To run                      | Command                                          |
| --------------------------- | ------------------------------------------------ |
| One spec                    | `deno task e2e:local e2e/sessions.e2e.ts`        |
| The test at one line        | `deno task e2e:local e2e/sessions.e2e.ts:42`     |
| Tests by name               | `deno task e2e:local -g "signing another"`       |
| Against the `dev` stack     | `deno task e2e`, at http://app.localhost         |
| The report of the last run  | `deno task e2e:report`                           |

Any argument that is not a spec path goes to Playwright as it is. The header of
[`infra/scripts/e2e-local.sh`](../infra/scripts/e2e-local.sh) lists the environment variables it
reads, and the process cap to allow when you run it under one.

## The two passes

Five specs start the app with no network: `e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts`,
`e2e/search-offline.e2e.ts`, `e2e/tags-offline.e2e.ts` and `e2e/notes-restore-offline.e2e.ts`.
They run against the built SPA, the image a deploy serves. Every other spec runs against the dev
server. [The app shell](offline-app-shell.md#offline-tests-run-against-the-built-spa) says why.

A run that needs both makes two passes: the dev server first, then the built SPA in its place.

- The run fails when either pass fails. Its last lines give the counts of each pass.
- The second pass's report is in `e2e/report/offline`. `e2e:report` does not open it.
- The traces of a pass's failed tests stay in `results/` of its report folder, whatever the
  reporter: open one with `deno run -A npm:playwright@1.57.0 show-trace <trace.zip>`.
- `E2E_SPA=dev` or `E2E_SPA=built` puts every spec on that one server.

## What CI runs

A merge needs the pull-request check, so that check runs a smoke set. The whole suite runs after
the merge. Every step of the pipeline is in [the CI guide](woodpecker-ci-setup.md).

| When                    | Step         | Specs                                                    |
| ----------------------- | ------------ | -------------------------------------------------------- |
| Pull request, and a tag | `e2e-smoke`  | The smoke set below (`deno task e2e:local --smoke`)      |
| Push to `main`          | `e2e-full`   | Every `e2e/*.e2e.ts` (`deno task e2e:local`)             |
| All three               | `browser`    | The website's `e2e/mpa/*.mpa.ts`                         |
| All three               | `browser`    | `e2e/spa/*.spa.ts`, on the SPA behind nginx              |
| All three, see below    | `lighthouse` | The website's Lighthouse budget (`deno task lighthouse`) |

A pull request runs `lighthouse` only when it changes a file the website is built from; a push to
`main` and a tag always run it. The file list is in [the CI guide](woodpecker-ci-setup.md).

The smoke set is `SMOKE_SPECS` in
[`infra/scripts/e2e-local-plan.ts`](../infra/scripts/e2e-local-plan.ts):

| Spec                            | What it covers                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| `e2e/auth-profile-ws-push.e2e.ts` | Sign-in through the form, a profile edit and sign-out         |
| `e2e/sign-in-next.e2e.ts`       | Sign-in from a link to a page, with and without a one-time code |
| `e2e/notes.e2e.ts`              | A note created, edited and deleted, and what a viewer may do    |
| `e2e/profile-two-tabs.e2e.ts`   | A name saved in one tab shows in another                        |
| `e2e/groups-pages.e2e.ts`       | A group created, renamed, deleted and restored                  |
| `e2e/url-filters.e2e.ts`        | Filters in the address follow the browser's back and forward    |

Every other screen is tested only on `main`, so a red `e2e-full` there means the last merge broke
one. It also turns the README's badge red, but blocks no pull request.

Both steps stop early: the smoke set after three failed tests, the whole suite after ten in a
pass. A red step may list only some failures, so run the specs on your machine for the rest.

## Add a spec to the smoke set

1. Run it ten times in a row on a healthy branch:

   ```sh
   E2E_LOCAL_TIMEOUT=3600 deno task e2e:local e2e/<spec> --repeat-each=10 --workers=1
   ```

   Ten runs take ten times as long as one. `E2E_LOCAL_TIMEOUT` is the deadline of one pass, 1500 s
   by default, which ten runs of a long spec such as `e2e/notes.e2e.ts` outgrow on a busy machine.

2. Add it to `SMOKE_SPECS` only when every run passed. A spec that fails once blocks every pull
   request.
3. Name it in the table above, in "The smoke set" of [Every task](development.md#the-smoke-set) and
   in [the CI guide](woodpecker-ci-setup.md). `tests/ci-browser-tests.test.ts` reads the last two
   and fails until both name it.

## Next

- [Every task](development.md)
- [Run the local stack](local-stack.md)
