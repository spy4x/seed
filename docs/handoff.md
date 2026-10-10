# Handoff: Deno platform template

> Written 2026-08-19 for whoever picks this up next, human or AI. It describes the
> state of `main`, the decisions already made and why, the traps this codebase
> has, and what to do next. Read [ADR 001](decisions/001-deno-platform-template.md)
> and [ADR 002](decisions/002-realtime-transport-and-sync.md) first - they are
> authoritative and this file is not.

## What this repository is

A reusable Deno platform template. **The reusability is the product.** Nothing here
is a shipping application; the goal is a baseline that new projects are generated
from, so anything product-specific is a defect rather than a feature.

Distribution is staged: Git template first, JSR packages for libraries once proven
across real projects, a CLI last.

## Ground rules

- **Deno only.** No `node`, `npm`, `pnpm`, `yarn` or `bun` commands. Selected
  `npm:` specifiers are fine where Vite or Preact need them - they still
  run through Deno.
- Enums start at 1, never 0.
- Money is integers.
- `BIGINT` crosses JSON as a decimal string (`::text` in SQL), because
  `Number.MAX_SAFE_INTEGER` is smaller than a Postgres bigint.
- Tenancy has exactly one boundary: the **group** (there is no
  "personal" kind: sign-up makes an ordinary group named "Personal").
  Roles are `VIEWER = 1`, `EDITOR = 2`, `ADMIN = 3`, `OWNER = 4`.
- Postgres is authoritative. The browser's local store is a disposable projection
  and never resolves a conflict.

## State of main

Green: `deno task check` (205 tests in nine runs), `deno task test:integration` (39 tests, 91
steps, needs Postgres), `deno task spa:build`, `deno task mpa:check`, the Playwright e2e suite
(28 tests) and the MPA's browser test (`e2e/mpa/run.sh`, 1 test).

```
apps/api      REST, the /api/ws socket, auth, CQRS dispatch. The only app with real behaviour.
apps/spa      Preact + Vite PWA. Wires the libs/ui auth, profile and groups screens;
              group commands and queries go over the socket.
apps/mpa      Fresh. The public website: server-rendered, works without JavaScript, no
              session. Calls the API over HTTP (API_URL) for the newsletter only; in
              compose under the `mpa` profile.
apps/worker   Drains outbox_events and announces group changes (pg_notify); sweeps
              expired idempotency keys; runs delayed and repeating jobs (below). Runs in compose
              as `worker`, from the API's image.

libs/platform  empty. Its primitives come from spy4x/ts-libs on JSR:
               @spy4x/validation, @spy4x/platform/{cqrs,cache,api,model,
               request-info,tokens}.
libs/domain    groups (enums, policy, commands/queries), identity (user, session,
               auth). May depend on platform only.
libs/server    db (migrations and schema.sql only), groups (Postgres repository,
               cursor, change notification). Database access, outbox, key-value store, config,
               request logging, sign-in and auth come from @spy4x/server/*.
libs/client    vite. Icons, useUrlFilters and the signed-in Shell come from
               @spy4x/preact-icons, @spy4x/preact-signals and @spy4x/preact-system.
libs/ui        The SPA's product screens (alias @ui/): auth, profile, groups, notes and
               the frames; the MPA renders only the newsletter's. See AGENTS.md.
```

What genuinely works end to end: sign-up creates the auth user and password key
(`@spy4x/server` auth tables), the `users` profile row, the first group and
the session in one transaction; `GET/POST /api/groups` with MFA-aware auth, CSRF
guard and signed keyset pagination; the worker claims and publishes outbox rows.

## What is decided (and must not be quietly re-litigated)

ADR 002 is recent and reverses part of ADR 001. In short:

- `apps/spa` speaks **WebSocket** for mutations, queries and realtime. It uses
  REST only for bootstrap and the auth endpoints that must exist before a socket
  can open.
- `apps/mpa` is the public website, not a second client of the product (#265): home page,
  pricing (from the `PLANS` catalog), privacy, terms, `robots.txt`, `sitemap.xml` and the
  newsletter. It speaks REST only, for the newsletter, and has no session; its sign-in and sign-up
  links open the SPA at `DOMAIN`.
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
  (`docs/design/group-sync.md`, "Access changes on open sockets").

## Which documents to trust

Documentation drifts here, so check status before believing anything.

| Document                                            | Status                                                                                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/decisions/001-deno-platform-template.md`      | Authoritative, except transport and sync rules, which ADR 002 replaced                                                               |
| `docs/decisions/002-realtime-transport-and-sync.md` | Authoritative, except "Transport per app", which ADR 003 amended |
| `docs/decisions/003-swappable-transport-and-local-data.md` | Authoritative. Most recent decision |
| `docs/design/group-sync.md`                         | Superseded in part. Its change log, cursor, idempotency and conflict rules still stand; its "WebSocket is optional" framing does not |
| `docs/prd/group-sync-platform.md`                   | Superseded in part. Read "REST" as "through the shared CQRS handlers"                                                                |
| `docs/stack.md`                                     | Current. What is actually running and deployed                                                                                       |
| `docs/principles.md`                                | Current, general                                                                                                                     |
| `docs/woodpecker-ci-setup.md`                       | Current. `.woodpecker/ci.yml` runs check, build, integration and e2e on every pull request and push to `main`                        |
| `docs/financy-extraction-inventory.md`              | Working list. Delete rows as they land, delete the file when drained                                                                 |

A new ADR supersedes rather than rewrites: ADR 001 keeps its text and carries a
pointer. Do not edit accepted decisions in place.

## Traps in this codebase

These cost real time to find. Do not rediscover them.

1. **Deno workspace test discovery.** `deno test <dir>` only collects from
   workspace _members_ once the directory contains any. Moving tests under
   `libs/platform` silently dropped 10 of 20 tests, with the step count unchanged
   so it looked fine. The same hid `libs/server/jobs`'s tests from `deno task check`
   until #139 made it, `libs/server/auth` and `libs/server/mail` members. Every lib holding tests is registered in the `workspace`
   array in `deno.jsonc`; add new ones there or their tests will not run.
2. **`deno fmt` from the repo root, always.** Running it inside a member
   directory picks up that member's `deno.json`, which has no `fmt` block, so it
   formats with defaults and adds semicolons that root `fmt --check` then rejects.
3. **Postgres readiness must be checked over TCP.** The postgres image runs a
   temporary unix-socket-only server during initdb. `pg_isready` without `-h`
   reports ready against that one, tests connect, the temporary server shuts
   down, and everything fails with `ConnectionReset` at random. See the recipe
   below.
4. **`.git` is inside a Syncthing folder shared across several machines.**
   `.stignore` excludes only `node_modules` and `.volumes`. Absolute paths in
   worktree pointers do not survive the hop between machines, so a worktree can
   look missing or `prunable` when nothing is wrong - run `git worktree repair`
   rather than assuming lost work. Concurrent git operations on two machines can
   corrupt objects; prefer the remote as the sync channel.
5. **`DbService.group` is constructed per access on purpose.** `begin()` derives
   the transactional service with `Object.create(this)` and rebinds `sql`, so
   caching the repository would silently escape the transaction.
6. **`apps/api`'s cache keys gained an `api:` prefix (PR #21).** `RedisKvStore`
   scopes every key it writes under a mandatory prefix; the app's old kv client
   wrote unprefixed keys (`user_123`, `userSession_...`, etc). Rolling back to a
   commit before that PR makes the app read those old unprefixed keys again.
   Only `userSession_*` matters here: it caches the session row itself, so a
   stale unprefixed entry for a session a user has since signed out of - under
   the prefixed version, which never touched that old key - makes the rollback
   read it as still active and the session comes back to life. Stale
   `isSessionTokenExpired_*` entries do not have this effect: that cache only
   ever holds `true`, to short-circuit a token already known to be expired, so
   a stale or missing entry there can only cause an extra DB check or a false
   "expired", never revive a session. **Flush Valkey before rolling back past
   this commit.** The forward direction has a matching one-time step: on the
   first deploy of this PR, delete every Valkey key that does not match
   `api:*`:
   ```sh
   valkey-cli --scan | grep -v '^api:' | xargs -r valkey-cli del
   ```
   The stale unprefixed keys expire on their own TTL regardless, but deleting
   them up front removes any chance of the same rollback problem recurring if
   a later rollback-then-roll-forward cycle skips this step.
7. **Sign-in moved to the `@spy4x/server` auth tables (migration
   `2026_09_24_0001_auth_package_tables.sql`).** Deploying it signs every
   existing user out for good: `user_keys` and `user_sessions` are dropped, so
   every password hash, session and authenticator-app secret is gone, and every
   `users.mfa` is reset to not configured. Each `users` row is kept (profile,
   groups, audit rows) under an `auth_users` row with the same id, but nothing
   can sign in to it any more; signing up again with the same username creates
   a new user. New password hashes are PBKDF2-SHA-256 at 600 000 iterations with
   the pepper as an HMAC key, and the session cookie value has a new format.
   `AUTH_PEPPER` and `AUTH_COOKIE_SECRET` must now be at least 32 characters, or
   the API refuses to start (`openssl rand -hex 32`). `AUTH_TOTP` is no longer
   read, but config still requires it (a follow-up removes it). Sessions are no
   longer cached in Valkey, so the `userSession_*` and `isSessionTokenExpired_*`
   keys of trap 6 are never written again. Rolling back past this migration
   needs a database restore: the old tables are gone. **Deploy step:** the
   migration resets `users.mfa` in SQL only, and the API cached `users` rows in
   Valkey for 30 days (`api:user_<id>`). Since the second factor and role are read
   from Postgres (#97) a stale entry only affects the profile display; delete those
   keys once, right after the migration runs, to clear it:
   ```sh
   valkey-cli --scan --pattern 'api:user_*' | xargs -r valkey-cli del
   ```

8. **Accounts sign in with an e-mail address; older accounts keep their username
   (#139).** Sign-up takes an address, normalised by `normalizeEmail`
   (`@spy4x/server/auth`), and stores it on the password key twice: as `subject`,
   which is what sign-in looks up, and as `email`. The address is never stored on
   `users`. An account made before #139 keeps its username as `subject` and
   `email` stays `NULL`; it signs in with the username as before, through the
   same field (`login`): a value `normalizeEmail` accepts is looked up as an
   address, anything else as a username. An address is attached to a key at
   sign-up or by a proven address change (below), so it is nullable, unique when
   set (`UNIQUE (method, subject)`), and compared after normalising. A username
   account has no address, so it cannot ask for a reset link until it adds one.

   **Password reset.** `POST /api/auth/password/forgot` with `{ email }` answers the
   same body for every valid address and queues the `auth.password-reset-mail` job
   with the address in `password_reset_requests`, never in the job row. The
   worker issues the code (a challenge of `@spy4x/server/auth`: only its SHA-256
   is stored, one per address, 30 minutes, with no practical cap on wrong guesses: a small cap would let anyone lock an address's reset, and the per-IP limit stops floods) and mails the link
   in the same step, so the raw code exists only in the mail. `POST
   /api/auth/password/reset` with `{ email, code, newPassword }` spends the code,
   marks the address proven, sets the password and signs out every session of
   the user; it signs nobody in. Limits: the IP limit of the other anonymous auth
   routes, and 3 requests an hour per address (`ratelimit-reset` in Valkey,
   keyed by a hash of the address, refusing when Valkey is down).

   **Proving an address (#140).** Sign-up queues the `auth.email-code-mail` job
   (request row in `email_code_requests`, never the code). The worker issues an
   8-character code with `@spy4x/server/auth/email-code` (only a hash is stored,
   10 minutes, single use, 5 guesses per code) and mails it. Until the code is
   entered, every signed-in page of the SPA shows a banner linking to `/email`.
   `GET /api/auth/email` answers `{ email, proven, pending }`; `POST
   /api/auth/email/verify` takes `{ code }`; `POST /api/auth/email/send` asks for
   a new code (3 mails an hour per address, `ratelimit-email-code` in Valkey);
   codes come from `createEmailProof` and are bound to the user and the address,
   so another account proving the same address cannot spend this one's guesses;
   wrong codes also count against the account in `email_code_failures`
   (`@spy4x/server/lockout`: 5 in a row lock it for 15 minutes, doubling). A
   wrong and an expired code get the same answer. An unproven address cannot
   turn on an authenticator app. `provenAddressOwner`
   (`libs/server/auth/email-verification.ts`) is the one check invitations
   (#131) and OAuth linking (#141) must call before trusting an address.

   **Changing the address.** `POST /api/auth/email/change` with `{ email,
   password }` stores the new address in `email_changes` and mails it a code;
   the account keeps signing in with the old address until that code is
   entered. A code mail to a new address, the first one or a resend, spends the
   account's budget (3 an hour, `ratelimit-email-change`) and the address's change
   budget (3 an hour from all accounts, `ratelimit-email-change-address`), never
   the address's own code budget: the address may be someone else's, and a
   stranger must not run its owner's budget out (#224). Both refusals use one
   wording. The verify call then moves the password key to the new address,
   signs out every other session and gives this one a new cookie. A username
   account adds its first address the same way, and from then on signs in with
   the address instead of the username. A password reset drops a waiting change.
   A reset and a move of one account both lock its password key first
   (`lockPasswordKey`), so neither copies a hash the other is replacing.

   **A squatted address.** Anyone can still sign up first with someone else's
   address, but it stays unproven and cannot carry a second factor. A reset
   link proves the mailbox, so it gives the owner the account back: new
   password, address proven, every session signed out, and any authenticator
   app removed. Sign-up still answers 401 for a taken address, which tells that
   an account uses it.

   **Mail.** `libs/server/mail` picks the transport: with `ENV=dev` the console
   sender of `@spy4x/email` plus a copy in the `dev_mail` table, which the e2e
   specs read through `POST /api/test/last-mail` (reset links and codes alike); any other `ENV` uses SMTP when
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are all set,
   and otherwise sends nothing. The console sender never runs in production: it
   prints the link, and container logs are shipped. The SPA's nginx logs paths
   without the query string, and the reset pages send no referrer.

   **Production mail.** Since 2026-10-02 production sends through the
   `noreply@antonshubin.com` mailbox on the owner's mail server (shared with
   Vaultwarden and Healthchecks), set in the main checkout's
   `infra/envs/.env.prod`. When any of the five `SMTP_*` keys is missing or invalid, the API
   and the worker still start, each logs one warning naming the missing keys,
   `/forgot-password` gives its usual answer and sends nothing, and sign-up works
   but no code arrives. No code is ever logged outside `ENV=dev`. The worker
   reads the keys at start-up, so a change needs a deploy.

9. **A full-stack e2e spec imports `test` from `e2e/fixtures/stack.ts` and loads pages
   through `gotoApp` or `signIn` (#105).** That fixture warms Vite's page bundles once per
   worker and blocks Google Fonts, and `gotoApp` loads the page again when a network change
   leaves it blank. A spec on Playwright's own `test`, or one calling `page.goto` or
   `page.reload` while online, gets none of this and brings the cold-start flakes back. The
   one plain reload left is the one made with the network cut (`e2e/offline.e2e.ts`).

## Running it

```sh
deno task check            # fmt, lint, types, unit tests
deno task spa:build
deno task mpa:check
deno task dev              # compose up
```

Integration tests need a throwaway Postgres and Valkey (Valkey requires a password, as in
production):

```bash
NAME="template-test-$$"
PASS=$(openssl rand -hex 24)
trap 'docker rm -f "$NAME" "$NAME-kv" >/dev/null' EXIT
docker run -d --name "$NAME" -e POSTGRES_USER=tester -e POSTGRES_PASSWORD="$PASS" \
  -e POSTGRES_DB=template_test -p 127.0.0.1::5432 postgres:16-alpine
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
`deno task db:migrate` on every `up`, and the API and the worker start only after it exits with 0.
There is no manual migration step in production. A failed migration fails `compose up` and leaves
the new API and worker created but not started; fix the migration and deploy again.

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
`DOMAIN` values. It also sends the password reset mails (trap 8).

## What is not built yet

- The password and two-factor calls are still REST: they change the session the socket is bound
  to. The profile and push REST routes stay; the MPA no longer uses them.
- Invitations (#131) are the only way into a group through the product; tests may still seed a
  member with `POST /api/test/add-member`. The nightly cleanup deletes invitations that have been
  dead (expired, revoked, declined or used up) for over 30 days.
- No local projection in the SPA, no offline outbox, no conflict UI. The page keeps its cursors in
  `localStorage` and rereads the whole group list to catch up.
- The worker publishes a group change with `pg_notify`, which reaches only API instances that are
  listening at that moment. A push missed that way is caught by the pull after the next reconnect.

## How a profile or push call travels

`profile.get`, `profile.update`, `push.register`, `push.remove` and `push.list` are served from
`apps/api/features/profile/operations.ts` and `features/push/operations.ts` and dispatched on the same buses
as the REST routes (`/api/users/me`, `/api/push`). The two commands that
change devices carry an idempotency key. Every change emits `UserProfileUpdatedEvent` or
`PushDevicesUpdatedEvent`, whether it came over REST or the socket, and an event handler calls
`Realtime.notifyUserChange`, which sends a `change.hint` (group id `user:<id>`, aggregate `user`,
sequence = the clock in milliseconds) to every socket of that user. The SPA's pull answers that
hint with `profileStore.refresh()`, so a second tab follows without a reload.

## How a group call travels

1. `apps/spa/src/realtime/index.ts` opens `/api/ws`. The upgrade runs the same session gate as
   REST and the `Origin` check, then `apps/api/services/realtime.ts` remembers which session each
   socket belongs to.
2. `group.create`, `group.list`, `group.get`, `group.select` and `group.selected` are dispatched on the same command and query buses REST uses,
   from `apps/api/features/groups/operations.ts`. Each frame reads the session again from the database,
   so a signed-out or expired session is refused. Authorization stays in the buses.
3. A command needs an idempotency key. `@spy4x/server/idempotency` (ts-libs) stores it for 7 days
   per user and runs the command once; a repeat returns the first result, and a repeat while the
   first still runs waits, then answers `conflict`. The worker sweeps expired keys hourly.
4. Every committed group change bumps `groups.next_change_sequence` and writes an outbox row in
   the same transaction. The worker drains the outbox and sends `pg_notify`; the API turns it into
   a `change.hint` with the sequence for every member's open sockets.
5. A job is an outbox row with `aggregate_type = 'job'`, no group and no payload, claimed once its
   `available_at` has come. `scheduleOutboxEvent` (from `@spy4x/server/outbox`) writes one, in the
   transaction of the change that needs it. Add a handler to the `JobPublisher` in
   `libs/server/jobs/wiring.ts`; it reads what it needs from the database. A failing job backs off
   (1 s, 2 s, 4 s, up to 5 minutes) and after 10 attempts stops with its error in
   `last_error_code`. A repeating job is listed in `repeatEveryMs`: a successful run writes the
   next one. The worker starts one, `outbox.cleanup`, at 03:00 UTC and then daily: it removes
   outbox rows processed more than 7 days ago. A job that gave up stays unprocessed, so the
   worker does not restart it; look for rows with `last_error_code` set.
6. A listener on the in-process event bus that throws is isolated, logged as one JSON line with the
   event and listener names and the request id, and counted in `event_listener_failures_total`
   (a `createCounter` from `@spy4x/platform/universal/metrics`). Register listeners with `subscribe` (not `eventBus.on`) so the
   name is known, and mark each best-effort or durable in `apps/api/cqrs/+init.ts`. Nothing exports
   the counter yet (`renderPrometheus` prints it); the scrape endpoint and the alert rule are #159. An outbox row has no payload,
   so a listener that needs the event's data cannot be durable until it has one. An audit record
   is therefore never a listener: sign-up, sign-in, sign-out and the profile change write their
   `auth_audits` row with `tx.authAudit.insert` in the command's transaction, so a failed row
   undoes the action and a kept action always has its row (#191). A new audited action does the
   same.
7. The SPA treats a hint as a reason to read. The read is `GET /api/groups`, the same one it makes
   at start-up and after every reconnect, so a lost frame costs one read.
8. The selected group is per person, not per group: a `user_settings` row holds `selected_group_id`
   and a `version`. It is read through `getSelected`, which checks membership at read time and, when
   nothing is stored or the stored group is gone, deleted or was left, answers with their oldest
   group. That read stores nothing and announces nothing, so it can never
   overwrite a choice committed at the same moment; only `select` writes. A `select` emits `GroupSelectedEvent`;
   its listener calls `Realtime.notifyUserChange`, the same one-person hint the profile and push
   devices use (cursor `user:<id>`), and the SPA answers that hint by reading the profile and the
   selection again. The event bus is in-process, so only the API instance that took the `select`
   reaches the person's sockets; another instance's sockets catch up on their next reconnect.
   Notes live at `/notes` and show the selected group's notes. An old `/groups/:groupId/notes`
   link only redirects: to `/notes` when that group is already the selected one, otherwise to
   `/groups`. It never selects, because a link another site controls must not switch a person's
   group (the API refuses a select that is not a post from the app's own page). The create form
   names the group on screen.
   `/groups` lists the groups as cards (the person's role, a "Selected" badge, a settings link
   and an "Open notes" form). `/groups/:groupId` is the settings page: `GroupSettingsScreen` in
   `libs/ui`, one `<section>` per concern. General shows the name and the role, and a rename form
   for an admin or the owner (`PATCH /api/groups/:id`, `group.rename`). A "Delete group"
   section, for the owner only, holds the confirmation text and the delete
   (`DELETE /api/groups/:id`, `group.delete`). Each later issue (members, roles and leaving #130;
   invitations #131; ownership #132; moving notes #133; moving all of a group's data #260; the extra fields #134) adds its own section
   to that screen, shown only to the roles that may use it.
9. **Deleting a group.** A delete is soft: `groups.deleted_at` is set and the row, its members and
   its notes stay. The server refuses it with `LAST_GROUP` (409) when it is the actor's last active
   group, and the settings page then shows the button disabled with the reason. A member whose only
   group it was gets a new group named "Personal" in the same transaction. Every read of groups
   filters `deleted_at`, so the selection falls back to the oldest remaining group at read time;
   nothing has to clear a stored choice. The delete is an access change: it raises the group's
   `authorization_revision` and names every member on the `group_access_lost` channel at its
   commit, so each member's socket gets the delete's hint and their pages read again.
   `listMemberUserIds` leaves a deleted group out, so no later hint for it reaches anyone. The
   restore raises the revision too. The owner restores it from the "Deleted groups" section of
   `/groups` (`POST /api/groups/:id/restore`, `group.restore`, `POST /groups/:id/restore`; the list
   is `GET /api/groups/deleted`, `group.deleted`) for `GROUP_RESTORE_DAYS` (30) days, by the
   database clock. The nightly `outbox.cleanup` job also runs `purgeDeletedGroups`, which removes
   groups past that for good, with their notes and members, so a group may live up to a day longer
   than 30 days but can no longer be restored. The settings page of a deleted group is a 404.
10. **The personal kind is gone** (migration `2026_10_07_0001_group_kind_removed.sql`: it drops
   `groups.kind` and its indexes and rewrites no row, so every group, membership and note stays).
   `createFirst` and `ensureFirst` replace `createPersonal` and `ensurePersonal`; the create body
   is `{ id, name }`; the picker and list show the role only; the seed and the dev add-member
   route no longer look at a kind.

    The migration drops `groups.kind`, so the API that reads it must not run against the migrated
    database and the new API must not run against the old one: migrate before the API starts. Compose
    already does (the API and the worker wait for the `migrate` service to complete), so there is no rolling deploy and
    nothing to add; a deploy that keeps the old API running while the new migration applies would
    break it.

    **Audit.** Rename, delete and restore each write an `audit_events` row (kind `group.renamed`,
    `group.deleted`, `group.restored`, with the actor and request id) in the same transaction as
    the change. Migration `2026_10_08_0001_audit_outlives_group.sql` makes `audit_events.group_id`
    nullable with `ON DELETE SET NULL`, so the purge leaves the rows behind with the group id
    emptied; they are the record of who deleted what.

    **A note and a delete racing.** The handlers check the role before the write, so a delete can
    land between the check and a note write. `recordGroupChange` refuses a deleted group inside the
    write's transaction (`GroupNotActiveError`, answered as `GROUP_NOT_FOUND`), and the note write
    rolls back; the delete records its own change with `allowDeleted`. The delete's row locks are
    `FOR NO KEY UPDATE`, because `FOR UPDATE` conflicts with the key-share lock a note insert takes
    on its foreign keys and the two deadlock.

    **Rollback of the kind migration.** Dropping the column cannot be undone by the migration
    runner (they are forward-only). To go back by hand, after stopping the new API:
    `ALTER TABLE groups ADD COLUMN kind INT2 NOT NULL DEFAULT 2;`
    `ALTER TABLE groups ADD CONSTRAINT groups_kind_check CHECK (kind IN (1, 2));`
    `CREATE INDEX idx_groups_kind_created_id ON groups (kind, created_at, id);`
    Every group comes back as shared (`2`). To restore the old one-personal-group rule, mark each
    owner's oldest live group as personal, then build the unique index:
    `UPDATE groups SET kind = 1 WHERE id IN (SELECT DISTINCT ON (owner_user_id) id FROM groups WHERE deleted_at IS NULL ORDER BY owner_user_id, created_at, id);`
    `CREATE UNIQUE INDEX idx_groups_one_active_personal_per_user ON groups (owner_user_id) WHERE kind = 1 AND deleted_at IS NULL;`
    Pick per owner, not per member: a member's oldest group may be one someone else owns, and two
    personal groups for one owner make the index refuse to build. A group marked personal this way
    may already have other members, which the old code's personal rule did not allow.

## Next steps, in dependency order

Each is intended to be one small PR. Small PRs are an explicit requirement here.

1. **SPA local projection and offline outbox.**

Member removal, role changes and leaving (#130) call `recordAccessChange` in their transaction,
with the removed member in its list of users who lost access (a demoted member keeps access).
Note writes and rename read the actor's role again inside their own transaction with
`lockActorRole` (`libs/server/groups/group-change-log.ts`): it locks the group row, then the
membership `FOR SHARE`, so a write racing a removal or demotion waits for it and is then refused
(#230). The member commands lock the group row too, then the memberships of the actor and the
target with `lockMemberRoles` (`FOR UPDATE`), and check the rule on those rows. Keep the group row
first in both: the other order deadlocks a write against a member change (the "lock order" tests
in `tests/integration/group-write-race.integration.test.ts`). `recordAccessChange` and
`recordGroupChange` take a transaction, never the pool. Members' sign-in addresses go only to the
owner and admins (`canSeeMemberEmails`); other members get no `email` field.

Invitations (#131): only `sha256(token)` is stored (`group_invitations.token_hash`), so a link
is shown once, in the answer to its create, and never again: the create sends no
`Idempotency-Key`, since the idempotency store would keep the token. The link is
`/invite/:token`; the API takes the token only in a JSON body, never in a URL it logs, and the SPA
sends no referrer from the invitation page. Pending invitations take no seat: the create is refused
by the entitlement gate when the members alone fill the plan's `maxMembers`, and the accept counts
the members again
under the group row's lock (`PostgresInvitationRepository.accept`). An address-bound invitation is
accepted only by an account that proved that address (`provenAddressOwner`). Create, accept and
revoke write their audit rows in their own transaction. Creates are capped per user per hour,
mails per address per hour, and previews and answers per IP (`invitation-rate-limits.ts`).
A member who is removed or leaves loses every pending invitation they made, and one who is
demoted loses those above what they may now invite with, in the same transaction
(`revokeInvitationsOf`). `group_invitation_acceptances` records who accepted each invitation, so
a removed member cannot rejoin through the team link they used. On a plan without `memberRoles`
an invitation adds a viewer only, on create and on accept; the role picker says so.

Ownership transfer (#132): `POST /api/groups/:id/transfer` takes `{ userId, name, password }`, over
HTTP only, never the socket, so the password does not cross a long-lived channel. It spends the
per-user budget a password change spends (`strictByUser`), checks the role, then the typed name,
then the password, so a refused request spends no password check. One transaction demotes the old
owner to admin before it promotes the new one: the partial unique index
`group_members_one_owner_key` allows one owner row per group and cannot be deferred. The old
owner's admin links are revoked, and their viewer and editor links stay; the new owner's links stay.
The new owner gets a web push. A subscription that still renews refuses the transfer
(`SUBSCRIPTION_RENEWS`); after it, the old owner's billing customer is handed over and the new owner
checks out with their own ([docs/billing.md](billing.md), "Transfer of ownership").

Moving all of a group's data (#260): `POST /api/groups/:id/move-all` takes `{ toGroupId }`, and the
socket command `group.moveAll` takes `{ groupId, toGroupId }`. One transaction locks both groups in
id order, checks edit rights in both on the locked rows, records a change in each
(`group.data_moved_out`, `group.data_moved_in`), runs every aggregate in `MOVABLE_AGGREGATES`
(`apps/api/services/db-base.ts`) and writes one audit event per group; any failure rolls back the
lot. A group with nothing to move is refused (`NOTHING_TO_MOVE`), moving into the same group is
`SAME_GROUP`, and notes deleted earlier stay behind. The target's note cap is read by the gate and
counted by the repository, which refuses with the plan refusal. The settings menu offers it as
"Move all data to...", then the delete confirmation. A new aggregate registers as described in
[docs/aggregates.md](aggregates.md), "Register it for move all data".

Extraction from the sibling Financy project is tracked separately in
[docs/financy-extraction-inventory.md](financy-extraction-inventory.md);
delete rows there as they land.

## Working agreements

- Small, focused PRs. The first one was 277 files and that was too big to review.
- Verify before claiming. Run the gates, and run the app when the change touches
  runtime behaviour.
- State facts from the code, not from memory. Both sibling projects were read
  before being described, and both turned out to differ from their own docs.
