# Every task

> Also on the website: [seedsaas.com/docs/development](https://seedsaas.com/docs/development).

Every `deno task` of the repository root, what it does, and where it is explained. The tasks
themselves are in [`deno.jsonc`](../deno.jsonc).

To run the stack for the first time, follow [Run the local stack](local-stack.md).

## Tasks

| Task                         | What it does                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| **Set up and run**           |                                                                                                 |
| `init`                       | Once after cloning: the env file with generated secrets, and the web push keys                  |
| `dev`                        | Starts Traefik unless one runs, then the whole development stack                                |
| `compose`                    | Runs Compose for the project. Refuses a start when a host port it needs is taken               |
| `proxy:network`              | Creates the shared `proxy` network when it is missing                                           |
| `proxy:start`                | Starts Traefik on its own. It calls Docker, even under Podman                                   |
| `proxy:stop`                 | Stops Traefik                                                                                   |
| `vapid-key:create`           | Writes new web push keys to `infra/configs/vapid.json`                                          |
| **Database**                 |                                                                                                 |
| `db:migrate`                 | Applies the SQL migrations in `libs/server/db/migrations`                                       |
| `db:seed`                    | Adds the demo data and the development administrator                                           |
| `db:reset`                   | Drops, migrates and seeds a development database (`ENV=dev` only)                               |
| `db:upgrade-18`              | Once per server: moves the data from Postgres 16 to 18 ([guide](postgres-18-upgrade.md))        |
| **Checks and tests**         |                                                                                                 |
| `check`                      | Lint, format check, type check and unit tests                                                   |
| `fix`                        | Fixes lint findings and formats every file                                                      |
| `fix-n-check`                | `fix`, then `check`                                                                             |
| `lint:check`, `lint:fix`     | Lint, or lint and fix                                                                           |
| `fmt:check`, `fmt:fix`       | Check the format, or format                                                                     |
| `ts:check`                   | Type check                                                                                      |
| `test`                       | Unit tests, in parallel; one file or folder too (below the table)                               |
| `test:integration`           | Integration tests against your Postgres and Valkey                                              |
| `test:backup`                | Backs a database up and restores it, in containers of its own                                   |
| `test:files`                 | The file store against a Garage container of its own                                            |
| `e2e`                        | Browser tests against the stack `dev` started ([guide](browser-tests.md))                       |
| `e2e:local`                  | The same browser tests against a stack of their own                                             |
| `e2e:report`                 | Opens the report of the last browser test run                                                   |
| `load`, `load:group`         | Load tests against the local stack ([capacity](capacity.md))                                    |
| `hooks:install`              | Installs a git hook that runs `check` before every commit                                       |
| `hooks:pre-commit`           | What that hook runs                                                                             |
| **Apps**                     |                                                                                                 |
| `build`                      | Builds the SPA for production                                                                   |
| `api:dev`, `api:prod`        | Starts the API, with or without reloading on change. Compose runs them                          |
| `spa:dev`, `spa:build`       | Starts or builds the SPA                                                                        |
| `admin:dev`, `admin:build`   | Starts or builds the admin app                                                                  |
| `mpa:dev`, `mpa:build`       | Starts or builds the public website                                                             |
| `mpa:start`, `mpa:check`     | Serves the built website, or checks it                                                          |
| `changelog`                  | Reads the git history into `apps/mpa/changelog.json` for `/changelog`                           |
| `lighthouse`                 | Measures the built website against its Lighthouse budget                                        |
| **Operate**                  |                                                                                                 |
| `deploy`                     | Copies the production files to the server and starts them ([deploy](deploy.md))                 |
| `user:role`                  | Gives a person a role by their address ([apps](apps.md#the-admin-app))                          |
| `operator:create`            | Creates an administrator without mail ([access](operator-access.md#the-first-operator))         |
| `linkedin:sign-in` | Signs in to LinkedIn and prints the env lines the worker posts with ([blog](blog.md#linkedin)) |
| `subscribers:send`           | Queues an issue for a mailing list, in the worker container ([below](#mailing-list-issues))     |
| `env:encrypt`, `env:decrypt` | Encrypts or decrypts the env files ([below](#env-files))                                        |
| `env:status`, `env:keygen`   | Lists the env files and whether a key is present, or makes a new key                            |
| **Other**                    |                                                                                                 |
| `i18n:stamp`                 | Records which English each translation was made from ([i18n](../i18n/TRANSLATING.md))           |
| `video:admin`                | Records the website's admin panel video from a local stack                                      |
| `demo-video`                 | Records the README's demo video into `media/demo`                                               |
| `deps:check`, `deps:update`  | Lists outdated dependencies, or updates them one by one                                         |
| `update:ubuntu`              | Upgrades the packages of an Ubuntu server, with `sudo`                                          |

`deno task test` prints the failures and one summary line. Give it files or folders to run only
those, with their permissions and all their output: `deno task test apps/api/routes/auth.test.ts
--filter=429`. `--verbose`, or `CI=true` as in CI, prints the whole output of every run. The test
groups and their permissions are in `infra/scripts/test.ts`.

Each app also has tasks of its own, in its `deno.json`. Run one from the root with
`deno task --cwd apps/<app> <task>`. The website's `screenshots` and `loops` tasks record its
pictures and videos.

## The smoke set

`deno task e2e:local --smoke` runs these specs, the ones the pull-request check runs
([What CI runs](browser-tests.md#what-ci-runs)):

- `auth-profile-ws-push.e2e.ts`
- `sign-in-next.e2e.ts`
- `notes.e2e.ts`
- `profile-two-tabs.e2e.ts`
- `groups-pages.e2e.ts`
- `url-filters.e2e.ts`

## Env files

Seed's own env files are committed encrypted, one value at a time, as `infra/envs/*.age`.

| Task          | What it does                                                                     |
| ------------- | -------------------------------------------------------------------------------- |
| `env:decrypt` | Writes the plain files next to the `.age` ones, with the key in `.age/key.txt`   |
| `env:encrypt` | Updates the `.age` files after you edit a plain one                              |
| `env:keygen`  | Makes a new key in `.age/key.txt`. It never overwrites one                       |
| `env:status`  | Lists the plain and encrypted env files, and whether a key is present            |

A product made from Seed cannot read Seed's files. Delete them, then make its own:

```sh
deno task env:keygen
deno task env:encrypt
```

Keep a copy of the key in a password manager.

## Mailing list issues

`subscribers:send` runs in the worker container. It takes a list and an issue file:

```sh
deno task subscribers:send news issue.json
```

The file's format is in [Mail subscriptions](architecture.md#mail-subscriptions).

## Next

- [Run the local stack](local-stack.md)
- [Run the browser tests](browser-tests.md)
- [Add your first feature](first-feature.md)
