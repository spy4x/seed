# Handoff: Deno platform template

> For whoever works on this repository next, human or AI. It describes how `main` is laid out,
> the decisions already made and why, and the traps this codebase has. Read
> [ADR 001](decisions/001-deno-platform-template.md),
> [ADR 002](decisions/002-realtime-transport-and-sync.md) and
> [ADR 003](decisions/003-swappable-transport-and-local-data.md) first - they are authoritative
> and this file is not. What is still to build is in the
> [open issues](https://github.com/spy4x/seed/issues), not here.

## What this repository is

Seed, a SaaS starter. It ships the public website (seedsaas.com), the product and its admin
panel, and every new product starts as a copy of it ([products.md](products.md)). What only
Seed's own site and demo need is listed in `AGENTS.seed.md`; anything specific to one product
does not belong here. Code any project could reuse lives in the JSR packages of
`spy4x/ts-libs` and `spy4x/preact-components`.

## Ground rules

- **Deno, Node and Bun.** Seed's servers run on all three (#623). New code
  uses web standards, with runtime-specific calls behind `@spy4x/platform`
  adapters; Deno stays the toolchain (`deno task`). See the
  [runtime policy](runtime-policy.md).
- Enums start at 1, never 0.
- Money is integers.
- `BIGINT` crosses JSON as a decimal string (`::text` in SQL), because
  `Number.MAX_SAFE_INTEGER` is smaller than a Postgres bigint.
- Tenancy has exactly one boundary: the **group** (there is no
  "personal" kind: sign-up makes an ordinary group named "Personal").
  Roles are `VIEWER = 1`, `EDITOR = 2`, `ADMIN = 3`, `OWNER = 4`.
- Postgres is authoritative. The browser's local store is a disposable projection
  and never resolves a conflict.

## Map of the repository

What each folder holds; `deno.jsonc` lists the workspace members. Run `deno task check` for the
state of the tests: this page keeps no count.

```
apps/api      REST, the /api/ws socket, the call route, auth, CQRS dispatch, the operator API.
apps/spa      Preact + Vite PWA: the product. Commands go over the socket (over HTTP with the
              realtime module off), reads over REST; an IndexedDB copy and a queue of writes keep
              it working offline.
apps/mpa      Preact SSR (`@spy4x/preact-server`). The public website: server-rendered,
              works without JavaScript, no session. Calls the API over HTTP (API_URL) for
              the newsletter only; in compose under the `mpa` profile.
apps/admin    Preact + Vite. The operator area on its own host (ADMIN_DOMAIN), one module per
              area (apps/admin/src/modules). In compose under the `admin` profile.
apps/worker   Drains outbox_events and announces group changes (pg_notify); sweeps
              expired idempotency keys; runs delayed and repeating jobs (below). Runs in compose
              as `worker`, from the API's image.

libs/platform  what the SPA and the admin app share: i18n.ts (the interface language and its
               catalogs) and shortcuts.ts (keyboard shortcuts). Every other primitive comes
               from spy4x/ts-libs on JSR (@spy4x/platform, @spy4x/server, @spy4x/realtime and
               the rest).
libs/domain    one member per aggregate: api-tokens, billing, blog, catalog, contact-links,
               groups, identity, notes, notifications, subscribers, tags (enums, policy,
               commands and queries), plus errors (the API's one error body).
               May depend on platform only.
libs/server    db (migrations and schema.sql), auth, files, jobs, mail and telegram, and one
               Postgres member per aggregate: api-tokens, billing, blog (docs/blog.md), catalog,
               contact-links, groups, notes, notifications, subscribers, tags.
               Database access, outbox, key-value store, config, request logging and the sign-in
               core come from @spy4x/server/*.
libs/ui        The product screens (alias @ui/) of the SPA and the admin app; the MPA renders
               only the newsletter's. See AGENTS.md.
```

## What is decided (and must not be quietly re-litigated)

ADR 002 is recent and reverses part of ADR 001. In short:

- `apps/spa` speaks **WebSocket** for mutations, queries and realtime. It uses
  REST only for bootstrap and the auth endpoints that must exist before a socket
  can open.
- `apps/mpa` is the public website, not a second client of the product (spy4x/template#265): home
  page, pricing (from the `PLANS` catalog), privacy, terms, `robots.txt`, `sitemap.xml`, `llms.txt`
  and the newsletter. It speaks REST only, for the newsletter, and has no session; its sign-in and
  sign-up links open the SPA at `DOMAIN`.
- **`apps/mpa` no longer runs on Fresh** (spy4x/seed#623, 2026-11-04). It runs on
  `@spy4x/preact-server` (spy4x/preact-components), a small layer with Fresh 2's API shape on web
  standards, built by Vite into `apps/mpa/dist/` ([website-server.md](website-server.md)). The
  goals: run on Node and Bun as well as Deno, own which scripts load and what is preloaded, and
  stop reaching into Fresh's private symbols. The layer is new and may not be final: when it
  falls short, fix and improve it in the library instead of working around it here.
- Every transport is a thin adapter over **one set of CQRS handlers**. A transport parses,
  authenticates and dispatches; it holds no business rule.
- **Session strength is checked on the buses, not in a transport.** Every
  command and query carries an `Actor` (`libs/domain/identity`), which a
  transport builds from its session (`apps/api/cqrs/actor.ts`). The session gate
  (`apps/api/cqrs/session-gate.ts`) is attached to both bus singletons where they
  are built (`apps/api/services/commandBus.ts` and `queryBus.ts`), and refuses a
  message whose session still owes a second factor. It denies by default: a
  message without an actor is refused unless it is listed as anonymous in
  `session-gate.ts`. A new transport gets the check by dispatching
  through the buses; it must not add its own. An `Actor` is a snapshot of the
  session: a long-lived transport such as the WebSocket must re-validate the
  session instead of trusting an actor it built at upgrade.
- **Push with sequence, pull as the authority.** A pushed change carries the
  sequence it was committed at. The client applies it only if that sequence is
  contiguous with its cursor; on any gap it discards the payload and pulls.
- The governing test: **delete every line of WebSocket code and the app must
  still converge to correct state.**
- Bootstrap is REST.
- Idempotency key on every command, expected version on updates, keys kept 7 days.
- `Origin` is validated at the WebSocket upgrade. Handshakes are not governed by
  CORS, and `SameSite=Lax` still admits a same-site subdomain.
- Live sockets are re-evaluated on sign-out, session expiry and
  `authorization_revision` change. A session that may no longer act loses its sockets; a person
  who loses a group keeps the socket and stops getting that group's hints
  (`docs/archive/group-sync.md`, "Access changes on open sockets").

## Which documents to trust

Documentation drifts here, so check status before believing anything.

| Document                                            | Status                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/decisions/001-deno-platform-template.md`      | Authoritative, except transport and sync rules, which ADR 002 replaced                                                               |
| `docs/decisions/002-realtime-transport-and-sync.md` | Authoritative, except "Transport per app", which ADR 003 amended |
| `docs/decisions/003-swappable-transport-and-local-data.md` | Authoritative. Most recent decision |
| `docs/archive/`                                     | Superseded designs. Each says on its first line what replaced it and what still stands                                               |
| `docs/stack.md`                                     | Current. What is actually running and deployed                                                                                       |
| `docs/principles.md`                                | Current, general                                                                                                                     |
| `docs/woodpecker-ci-setup.md`                       | Current. The one list of CI's steps                                                                                                  |
| `docs/financy-extraction-inventory.md`              | Working list. Delete rows as they land, delete the file when drained                                                                 |

A new ADR supersedes rather than rewrites: ADR 001 keeps its text and carries a
pointer. Do not edit accepted decisions in place.

## Traps in this codebase

These cost real time to find. Do not rediscover them.

### 1. Deno workspace test discovery

`deno test <dir>` only collects from
workspace _members_ once the directory contains any. Moving tests under
`libs/platform` silently dropped 10 of 20 tests, with the step count unchanged
so it looked fine. The same hid `libs/server/jobs`'s tests from `deno task check`
until spy4x/template#139 made it, `libs/server/auth` and `libs/server/mail` members. Every lib
holding tests is registered in the `workspace` array in `deno.jsonc`; add new ones there or their
tests will not run.

### 2. `deno fmt` from the repo root, always

Running it inside a member
directory picks up that member's `deno.json`, which has no `fmt` block, so it
formats with defaults and adds semicolons that root `fmt --check` then rejects.

### 3. Postgres readiness must be checked over TCP

The postgres image runs a
temporary unix-socket-only server during initdb. `pg_isready` without `-h`
reports ready against that one, tests connect, the temporary server shuts
down, and everything fails with `ConnectionReset` at random. See the recipe
below.

### 4. `.git` is inside a Syncthing folder shared across several machines

`.stignore` excludes only `node_modules` and `.volumes`. Absolute paths in
worktree pointers do not survive the hop between machines, so a worktree can
look missing or `prunable` when nothing is wrong - run `git worktree repair`
rather than assuming lost work. Concurrent git operations on two machines can
corrupt objects; prefer the remote as the sync channel.

### 5. `DbService.group` is constructed per access on purpose

`begin()` derives
the transactional service with `Object.create(this)` and rebinds `sql`, so
caching the repository would silently escape the transaction.

### 8. Accounts sign in with an e-mail address; older accounts keep their username (spy4x/template#139)

An account made before spy4x/template#139 signs in with its username: its password key's `subject`
is the username and its `email` is `NULL`. Code must not assume every account has an address; such
an account cannot ask for a reset code until it adds one. The rest of sign-in (password reset,
sign-in codes, proving and changing an address, Google and GitHub, passkeys, wrong-password counts)
is described at the top of each sign-in service in `apps/api/services/` and in the auth routes
(`apps/api/routes/auth*.ts`). How mail is sent, or not, without SMTP: `libs/server/mail/mail.ts`.

### 9. A full-stack e2e spec loads pages through the stack fixture (spy4x/template#105)

A full-stack e2e spec imports `test` from `e2e/fixtures/stack.ts` and loads pages through `gotoApp`
or `signIn`. That fixture warms Vite's page bundles once per
worker, and `gotoApp` loads the page again when a network change
leaves it blank. A spec on Playwright's own `test`, or one calling `page.goto` or
`page.reload` while online, gets none of this and brings the cold-start flakes back. Older specs
still call `page.reload()` directly; `grep -n "page.reload" e2e/*.e2e.ts` lists them.

### 10. A rollback past the `api_tokens.revoked_at` migration revives revoked tokens (spy4x/template#293)

A revoked token keeps its row and hash for 30 days, and only code from that
change on reads `revoked_at`: older code finds the row and lets the token act. So every token
revoked in the last 30 days works again after such a rollback, among them the ones a password
change ended after a break-in. Before rolling back, delete those rows:
`DELETE FROM api_tokens WHERE revoked_at IS NOT NULL;`. Their audit rows stay and still name
them. Going forward is safe: old code runs against the new column, and compose runs the
migration before the new API starts.

### 11. A rollback past the cache's key prefix needs Valkey flushed first (PR spy4x/template#21)

Since PR spy4x/template#21 every key the API writes to Valkey starts with `api:`
(`apps/api/services/cache.ts`); older code reads and writes the same values without it. Rolled back
past that change, the old code finds the unprefixed keys it left behind, up to a month old, and
serves them as current. Flush Valkey before such a rollback. Going forward is safe: the new code
ignores the old keys.

### 12. The operator area answers on the admin host only

`/api/admin/*` is 404 on every host but
`ADMIN_DOMAIN`, and everywhere when it is unset. On the admin host only `/api/admin/*` and five auth
calls (`/api/auth/me`, `/api/auth/email`, `/api/auth/password/check`, `/api/auth/totp/check`,
`/api/auth/sign-out`) answer (`apps/api/middlewares/admin-host.ts`). The gate reads the decoded path
the router matches (`c.req.path`), never the raw URL: `/api/%61dmin` is the operator area too. The
host is compared with its port, so a test against `admin.localhost:<port>` sets `ADMIN_DOMAIN` with
that port, as `e2e:local` does.

### 13. The database must know the old zone names browsers report

Some browsers still report a zone by its old name: `Asia/Saigon`, `Asia/Calcutta`, `Europe/Kiev`.
The stock Debian `postgres` image refuses those in `AT TIME ZONE`, because Debian 13 moved them to
`tzdata-legacy`, so every per-day count failed for those people. The `db` service is built from
`infra/postgres/Dockerfile`, which copies the names Debian lacks from the Alpine image of the same
release, so no build needs a Debian mirror. CI and `e2e:local` run the Alpine image, which has the
old names, so they never showed the failure.

## Running it

```sh
deno task check            # fmt, lint, types, unit tests
deno task spa:build
deno task mpa:check
deno task dev              # compose up
deno task e2e:local        # browser tests on a stack of its own (docs/browser-tests.md)
```

Integration tests need a throwaway Postgres and Valkey (Valkey requires a password, as in
production):

```bash
NAME="template-test-$$"
PASS=$(openssl rand -hex 24)
trap 'docker rm -f "$NAME" "$NAME-kv" >/dev/null' EXIT
docker run -d --name "$NAME" -e POSTGRES_USER=tester -e POSTGRES_PASSWORD="$PASS" \
  -e POSTGRES_DB=template_test -p 127.0.0.1::5432 postgres:18.6-alpine
docker run -d --name "$NAME-kv" -e REDISCLI_AUTH="$PASS" -p 127.0.0.1::6379 valkey/valkey:8.1 \
  valkey-server --requirepass "$PASS"
PORT=$(docker port "$NAME" 5432/tcp | cut -d: -f2)
KV_PORT=$(docker port "$NAME-kv" 6379/tcp | head -1 | cut -d: -f2)

# Wait over TCP, not the unix socket - see trap 3 above.
timeout 90 docker exec "$NAME" sh -c \
  'until pg_isready -h 127.0.0.1 -U tester -d template_test -q; do sleep 0.5; done'
timeout 30 docker exec "$NAME-kv" sh -c 'until valkey-cli ping | grep -q PONG; do sleep 0.5; done'

DB_HOST=127.0.0.1 DB_PORT="$PORT" DB_USER=tester DB_PASS="$PASS" DB_NAME=template_test \
  KV_HOSTNAME=127.0.0.1 KV_PORT="$KV_PORT" KV_PASSWORD="$PASS" \
  deno task test:integration
```

Compose, and so `deno task deploy`, applies migrations itself: the one-shot `migrate` service runs
`deno task db:migrate` on every `up`, and the new API and worker start only after it exits with 0.
There is no manual migration step in production. A failed migration fails `compose up` and leaves
the new API and worker created but not started; fix the migration and deploy again. A deploy
(`compose up -d --build`, in `infra/scripts/deploy.ts`) stops and removes the old API and worker
before `migrate` runs, and starts the new ones only after it exits with 0, so the API is down for as
long as the migration runs. Old code never runs against the migrated database. A server that still
holds Postgres 16 data refuses to start until `deno task db:upgrade-18` has moved it:
[postgres-18-upgrade.md](postgres-18-upgrade.md).

To run the API for real outside compose you also need Valkey (`valkey-server --requirepass
<KV_PASSWORD>`; the API refuses to start without `KV_PASSWORD` and sends it with `AUTH`),
migrations applied (`deno task db:migrate`), and `infra/configs/vapid.json` present
(`deno task vapid-key:create`) copied to `./vapid.json`, since the API reads it
from the working directory while compose bind-mounts it. Compose fails the start when the file is
missing; `deno task deploy` generates it on the server.

Live updates between tabs need the worker too: without it a group created in one tab shows in
another only after a reconnect or a reload, and the e2e test "a group created in one tab appears in
the other tab without a reload or reconnect" fails. Compose runs it as `worker`; outside compose,
start it with `deno run --allow-sys -E -N apps/worker/+main.ts` and the API's `DB_*`, `ENV` and
`DOMAIN` values. It also sends the password reset mails.

## Where to find a pattern

- **Add an aggregate:** [aggregates.md](aggregates.md).
- **Add a field to an aggregate:** [aggregates.md](aggregates.md#add-a-field-to-an-existing-aggregate).
- **Follow a write from the SPA to Postgres and back:** [how-calls-travel.md](how-calls-travel.md).
- **Confirm before a delete:** `ConfirmDialog` from `@spy4x/preact-ui/confirm-dialog` with
  `tone="danger"`; example: the delete in `libs/ui/note-editor-screen.tsx`.
- **Rate-limit an endpoint:** every socket or call operation already spends the caller's budget
  (`apps/api/middlewares/operation-rate-limits.ts`). An operation with a tighter limit of its own:
  `apps/api/features/notes/search-rate-limit.ts`. A REST route: the middlewares in
  `apps/api/middlewares/*rate-limit*.ts`, wired in `apps/api/index.ts`.
- **Add an i18n key:** [i18n/TRANSLATING.md](../i18n/TRANSLATING.md), "The loop".
- **Add a background job:** [jobs.md](jobs.md).
- **Add an admin module:** [admin-modules.md](admin-modules.md).

## Working agreements

- Small, focused PRs.
- Verify before claiming. Run the gates, and run the app when the change touches
  runtime behaviour.
- State facts from the code, not from memory.
