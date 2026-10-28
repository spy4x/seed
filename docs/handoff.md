# Handoff: Deno platform template

> For whoever works on this repository next, human or AI. It describes how `main` is laid out,
> the decisions already made and why, and the traps this codebase has. Read
> [ADR 001](decisions/001-deno-platform-template.md),
> [ADR 002](decisions/002-realtime-transport-and-sync.md) and
> [ADR 003](decisions/003-swappable-transport-and-local-data.md) first - they are authoritative
> and this file is not. What is still to build is in the
> [open issues](https://github.com/spy4x/seed/issues), not here.

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

## Map of the repository

What each folder holds; `deno.jsonc` lists the workspace members. Run `deno task check` for the
state of the tests: this page keeps no count.

```
apps/api      REST, the /api/ws socket, the call route, auth, CQRS dispatch, the operator API.
apps/spa      Preact + Vite PWA: the product. Commands go over the socket (over HTTP with the
              realtime module off), reads over REST; an IndexedDB copy and a queue of writes keep
              it working offline.
apps/mpa      Fresh. The public website: server-rendered, works without JavaScript, no
              session. Calls the API over HTTP (API_URL) for the newsletter only; in
              compose under the `mpa` profile.
apps/admin    Preact + Vite. The operator area on its own host (ADMIN_DOMAIN), one module per
              area (apps/admin/src/modules). In compose under the `admin` profile.
apps/worker   Drains outbox_events and announces group changes (pg_notify); sweeps
              expired idempotency keys; runs delayed and repeating jobs (below). Runs in compose
              as `worker`, from the API's image.

libs/platform  empty. Its primitives come from spy4x/ts-libs on JSR (@spy4x/platform,
               @spy4x/server, @spy4x/realtime and the rest).
libs/domain    one member per aggregate: api-tokens, billing, blog, groups, identity, notes,
               notifications, subscribers, tags (enums, policy, commands and queries).
               May depend on platform only.
libs/server    db (migrations and schema.sql), auth, jobs and mail, and one Postgres member per
               aggregate: api-tokens, billing, blog (docs/blog.md), groups, notes, notifications,
               subscribers, tags.
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

Sign-up takes an address, normalised by `normalizeEmail`
(`@spy4x/server/auth`), and stores it on the password key twice: as `subject`,
which is what sign-in looks up, and as `email`. The address is never stored on
`users`. An account made before spy4x/template#139 keeps its username as `subject` and
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
is stored, one per address, 30 minutes, with no practical cap on wrong guesses: a small cap would
let anyone lock an address's reset, and the per-IP limit stops floods) and mails the link in the
same step, so the raw code exists only in the mail. `POST /api/auth/password/reset` with `{ email,
code, newPassword }` spends the code, marks the address proven, sets the password and signs out
every session of the user; it signs nobody in. It also revokes every API token, removes every push
subscription (spy4x/template#409), ends the Telegram link with every link code and "Link" press
made before it (#269), and drops a waiting address change. A subscribe stores its row
under the lock the reset takes on the user, after checking that its session is still live, so one
that started before the reset stores nothing. When the address was not proven before, it removes the
authenticator app and every sign-in method but the password as well ("A squatted address" below); an
address proven before keeps them. Limits: the IP limit of the other anonymous auth routes, and 3
requests an hour per address (`ratelimit-reset` in Valkey, keyed by a hash of the address, refusing
when Valkey is down).

**Sign-in links (#391).** `POST /api/auth/link` with `{ email, next? }` answers the same body for
every valid address, writes a row to `sign_in_link_requests` and queues the `auth.sign-in-link-mail`
job, whose worker issues the secret (`randomBase64Url`, 32 bytes, a challenge of
`@spy4x/server/auth` stored as a hash, 15 minutes) and mails `/sign-in/link/open#token=<id>.<secret>`
in the same step. The token rides in the fragment, so no request, log or `Referer` carries it, and
the page strips it with `history.replaceState`. Opening the page spends nothing, because mail
scanners open links; Continue sends `POST /api/auth/link/redeem` with `{ token }`. One link used
stops every other link of the address. The link signs in the owner of a proven address, or creates
an account (proven) for a new one; an unproven password key on the address refuses it (409), since
the link proves the mailbox, not that account. A guest uses only a link that guest asked for
(`sign_in_link_requests.requested_by_user_id`): any other link is spent and refused with 403 and the
code `SIGN_IN_LINK_ASKED_ELSEWHERE`, and the guest's session stays, since a guest key has no secret
and a replaced session would lose the account. Sessions run on a per-user `email-link` key with no
secret, which `GET /api/auth/methods` never lists (its `emailLink` says whether a link reaches the
account) and which counts as provider proof like a passkey. A second factor still applies. Limits: 3
links an hour per client share and 10 per address (`ratelimit-sign-in-link`). Code:
`libs/server/auth/sign-in-links.ts`, `libs/server/jobs/sign-in-link-mail.ts`,
`apps/api/services/sign-in.ts` (`redeemSignInLink`).

**Sign-up proves the address first (spy4x/template#142).** `POST /api/auth/password/sign-up` hashes
the password, writes a waiting sign-up to `sign_up_requests` (10 minutes, `SIGN_UP_CODE_MINUTES`),
queues the `auth.sign-up-code-mail` job and sets the signed HttpOnly cookie `password_sign_up` (path
`/api/auth/password/sign-up`). It does that for every well-formed address and never asks whether an
account uses it, so the answer, the work and the mail are the same for a free and a taken address.
It spends the sign-up code budgets (`ratelimit-sign-up-code`, spy4x/template#494): three mails an
hour to the address from one client (an IPv4 address, or an IPv6 /48), and ten an hour to the
address from all clients together. A client past its three spends nothing of the ten, so a
stranger who keeps signing an address up cannot lock its owner out, and the account's own budget
(`ratelimit-email-code`) is never touched. The nightly cleanup deletes expired codes from `auth_challenges`. The worker mails
`emailCodeMail` with a code of `libs/server/auth/sign-up-requests.ts` (a challenge of purpose
`app.sign-up` bound to the waiting sign-up and the address, 5 guesses over all its codes). `POST
/api/auth/password/sign-up/verify` with `{ code }`: the right code for a free address creates the
account with its password key proven, as `signUp` would but proven, and signs it in; for an address
an account uses (its password key, proven or not, or a proven owner) it creates nothing and answers
`{ accountExists: { email, password, providers } }`, told only to whoever holds the mailbox. Either
way the waiting sign-up is gone. A wrong code is 400 with `EMAIL_CODE_REFUSED`; no waiting sign-up
(expired, guessed at too often, or never started) is 410. `GET` reads the waiting sign-up back for a
reload, `/resend` and `/cancel` give a new code or forget it. The nightly cleanup deletes expired
ones. `signIn.signUp`, which creates an unproven account at once, is no longer reachable from a
route; the seed script and the integration tests still use it. The e2e specs sign up through
`e2e/fixtures/sign-up.ts`, which reads the code from `/api/test/last-mail` and enters it. Every
sign-up spends one of the caller's three code mails an hour to the address, so `POST
/api/test/cleanup-user` also forgets the address's budgets, the caller's share among them: a spec
with a fixed address can run again on a dev stack within the hour, as long as it calls the route
through the same proxy as its browser.

**Proving an address (spy4x/template#140).** An address change, and an account made before
spy4x/template#142, prove their address with the `auth.email-code-mail` job (request row in
`email_code_requests`, never the code). The worker issues an 8-character code with
`@spy4x/server/auth/email-code` (only a hash is stored, 10 minutes, single use, 5 guesses per code)
and mails it. Until the code is entered, every signed-in page of the SPA shows a banner linking to
`/profile/account?verify`, which opens the e-mail dialog at its code. `GET /api/auth/email` answers `{ email, proven, pending }`; `POST /api/auth/email/verify`
takes `{ code }`; `POST /api/auth/email/send` asks for a new code (3 mails an hour per address,
`ratelimit-email-code` in Valkey, which sign-ups never spend); codes come from `createEmailProof`
and are bound to the user and the address, so another account proving the same address cannot spend
this one's guesses; wrong codes also count against the account in `email_code_failures`
(`@spy4x/server/lockout`: 5 in a row lock it for 15 minutes, doubling). A wrong and an expired code
get the same answer. An unproven address cannot turn on an authenticator app. `provenAddressOwner`
(`libs/server/auth/email-verification.ts`) is the check an invitation by address
(spy4x/template#131) calls before trusting an address. Google and GitHub sign-in do not call it: the
library decides by the addresses both sides have verified (below).

**Google and GitHub (spy4x/template#141, spy4x/template#142).** `apps/api/services/oauth-sign-in.ts`
wraps `createOAuthSignIn` of `@spy4x/server/auth/oauth`, one per provider whose client id and secret
are both set (docs/sign-in-providers.md); `apps/api/routes/auth-oauth.ts` holds the routes and is
mounted before `createAuthRoute`. A provider method is a row of `auth_keys` with the provider's name
as `method` and the provider's user id as `subject`: there is no table of its own. The state of a
flow lives in Valkey for 10 minutes and in the HttpOnly cookie `oauth_state_<provider>`. An unknown
person gets no account: the callback stores a pending sign-up, sets the cookie `oauth_sign_up` and
redirects to `/sign-up/confirm`, where `POST /api/auth/sign-up/confirm` creates the user, profile
and first group. That cookie is signed with the cookie secret (`@spy4x/platform/signed-payload`),
because the API acts on what it says and the library's flow store cannot be read, only taken from:
one that was edited or written by hand reads as no cookie. The library, not `provenAddressOwner`,
decides whether a provider account joins an existing one: only by an address both sides have
verified. Linking from the profile is the library's connect flow (`connectUrl`,
`handleConnectCallback`): bound to the signed-in user, it adds the provider whatever its address and
touches no other account, and a provider account that already signs in to someone else ends at
`/?oauth=link-taken`. Its `state` has its own HttpOnly cookie, `oauth_connect_<provider>`; the one
callback route runs the connect when that cookie holds the callback's `state`, and the sign-in
otherwise. `DELETE /api/auth/methods/:id` refuses the last usable method and ends the sessions that
method started. A sign-up the provider vouches for deletes another account's unproven claim to the
same address (the library's rule against sitting on an address): the question page warns first
(`PendingSignUp.unconfirmedAccount`) and the locked account gets the audit row
`UNCONFIRMED_ADDRESS_TAKEN`. A link whose provider vouches for such an address locks that account
too, with the same row but no warning: a link has no question page. Whether a claim was taken is
read from the database around the write (`reportingTakenClaims`), never from the browser. "Go back"
takes the held profile out of the flow store. The two routes a browser opens as a page, `start` and
`callback`, answer every failure with a redirect to `/sign-in?oauth=…`, a spent rate limit included.
The sign-in page's "last used" hint is `apps/spa/src/state/last-sign-in.ts` over `createLastSignIn`
of `@spy4x/platform/browser/last-sign-in`: the app remembers the method the session used, read from
`GET /api/auth/methods`, once a person is signed in with every factor done.

**An account with no password** confirms with a provider sign-in where the others give the
password: `oauth.proofUntil` (`apps/api/services/oauth-sign-in.ts`) holds while the request's
session was started by an `oauth:*` or `passkey` key less than `PROVIDER_PROOF_MINUTES` ago, read from
`auth_sessions.created_at`. It proves the browser is signed in to the provider, not who is at the
keyboard: where the provider is still signed in, the new sign-in is one click (#204).
`POST /api/auth/account/delete`, `POST /api/auth/email/change` and
`POST /api/auth/totp/connect/start` take it in place of `password`, and
`POST /api/auth/password/set` adds the first password key, on the account's address, proven,
and signs out every other session of the account; the one that set it stays signed in
(spy4x/template#406). `GET /api/auth/methods` answers `providerProofUntil`, so the dialogs show the
form or the links back to the provider (`libs/ui/provider-proof.tsx`). A changed address of such an
account lives on the `email-code` key its code proved, which `readEmailStatus` reads before the
provider's own address. A first password takes that key away (`dropCodeKeys`,
`libs/server/auth/email-verification.ts`), and so does a later change of address, so no `email-code`
key stays on an address the account has left. Such an account cannot move to an address another of
its sign-in methods carries already (`EMAIL_ALREADY_CARRIED`): it reads its address from those
methods, so the change would answer "done" and change nothing. `POST /api/auth/password/set` asks
for `otp` while two-factor is on, and `POST /api/auth/methods/:provider/link` asks for the password
or the same provider proof, so a session cannot make itself recent by linking one more provider.
`DELETE /api/auth/methods/:id` asks for the same proof (`refusalWithoutProof`,
`apps/api/routes/auth-oauth.ts`), before it answers whether the method exists. Every link and
unlink, an automatic link at sign-in included, queues a mail to the account's first proven address
naming the provider and the time (`sign_in_method_changes` and the outbox job in
`libs/server/jobs/sign-in-method-mail.ts`). Not built: a first password by reset mail, so "forgot
password" still finds no key for such an account.

**Passkeys (#222).** A passkey is an `auth_keys` row of method `passkey` whose `subject` is the
credential id (at most 255 characters; a longer one is refused), with its public key, counter,
transports and name in `auth_passkeys` (`libs/server/auth/passkeys.ts`). The WebAuthn checks are
`@spy4x/server/webauthn`; `apps/api/services/passkey-sign-in.ts` keeps each challenge in Valkey
under `passkey:<ceremony>:…<challenge>` and takes it with the atomic `take`, so a response answers
once. The relying party is the web app's host and origin (`config.webAppUrl`). The routes are
`apps/api/routes/auth-passkeys.ts`: `POST /api/auth/passkeys/add/options` asks for the password or
the proof above, `POST /api/auth/passkeys` stores the passkey named after the browser
(`deviceName`, " 2" on a clash), `PATCH /api/auth/passkeys/:id` renames it
(writing `SIGN_IN_METHOD_RENAMED` with both names), and
`DELETE /api/auth/methods/:id` removes it like any method. `POST /api/auth/passkeys/sign-in` (with
`/options`) signs in with any passkey of the site and owes no authenticator code, except to restore
an account that waits to be deleted with two-factor on. The device verifies the person on every
ceremony, so the passkey counts as both factors: an account with an authenticator app gets a
`Completed` session, which the 2FA gate lets through; an unknown credential answers 404 with
`unknown: true`, and the SPA tells the device to forget it. `POST /api/auth/passkeys/confirm`
(with `/options`) is a passkey sign-in again by a signed-in person, checked against that person's
id, and replaces the session: it is the passkey's way to make the proof above fresh.

**Changing the address.** `POST /api/auth/email/change` with `{ email,
password }` stores the new address in `email_changes` and mails it a code;
the account keeps signing in with the old address until that code is
entered. A code mail to a new address, the first one or a resend, spends the
account's budget (3 an hour, `ratelimit-email-change`) and the address's change
budget (3 an hour from all accounts, `ratelimit-email-change-address`), never
the address's own code budget: the address may be someone else's, and a
stranger must not run its owner's budget out (spy4x/template#224). Both refusals use one
wording. The verify call then moves the password key to the new address,
signs out every other session, those a Google or GitHub sign-in started included, and gives
this one a new cookie. An account with no password has its new address on the code key instead,
and every other session ends the same way while this one keeps its cookie (spy4x/template#406). A
username account adds its first address the same way, and from then on signs in with the address
instead of the username. A password reset drops a waiting change. A reset and a move of one account
both lock its password key first (`lockPasswordKey`), so neither copies a hash the other is
replacing.

**Wrong passwords from a session (spy4x/template#406).** Every step a signed-in person confirms with
the password counts the wrong ones in `password_check_failures`, keyed by the user id: turning
two-factor on or off, a password change, an address change, deleting the account, linking or
unlinking a provider, creating an API token and handing a group over. They share one count
(`signIn.checkPassword`, and `changePassword`, `requestEmailChange` and `countPasswordCheck`, which
count the same way) with the sign-in page's policy: 5 free, then a lock of 1 minute doubling to 15
(`PASSWORD_LOCK_POLICY`, `apps/api/services/password-locked.ts`). While it runs, even the right
password is answered 429 with `Retry-After` (`PasswordLockedError`). The sign-in page keeps its own
count per name (`password_failures`), so a stranger who types the person's address there does not
lock their signed-in steps, and a session's guesses do not lock the sign-in page. A check counts as
wrong until it is found right, so more than six checks of one account at the same moment are refused
(the sixth sets the lock): no person sends that many.

**A squatted address.** Anyone can still sign up first with someone else's
address, but it stays unproven and cannot carry a second factor. A reset
link proves the mailbox, so it gives the owner the account back: new
password, address proven, every session signed out, every API token
revoked, every push subscription removed (spy4x/template#409), so no browser keeps getting
the account's notifications, any authenticator app removed, and every other
sign-in method deleted (spy4x/template#404): each linked Google or GitHub account, and a code key
for another address if the account holds one. Whoever linked them did so before anyone proved the
address, so they would be a way back in. This happens only on the reset that proves the address; a
later reset keeps the methods. A person who linked their own provider before confirming their own
address links it again after a reset. Since spy4x/template#142 a password sign-up can no longer
squat an address: the account exists only once the code mailed to the address is entered.

An account whose address is not proven cannot invite (spy4x/template#411): creating an invitation,
by link or by address, is refused with `ADDRESS_NOT_PROVEN` (403) and "Verify your e-mail address in
your profile before you invite anyone.", which the SPA shows above the invitation form's buttons
with a "Verify e-mail" button. The reset removes no members, so without this a squatter could let a
second account of theirs into the first group and keep it there after the owner's reset. The reset
that proves the address also revokes every pending invitation the account made, in every group
(`revokeAllInvitationsOf`), so a link made before this rule existed lets nobody in afterwards. An
account with no address (a username account from before spy4x/template#139) cannot invite either
until it adds and proves one. The check is `hasProvenAddress`
(`libs/server/auth/email-verification.ts`), asked by the create handler in
`apps/api/features/groups/invitations.ts`.

**Mail.** `libs/server/mail` picks the transport: with `ENV=dev` the console
sender of `@spy4x/email` plus a copy in the `dev_mail` table, which the e2e
specs read through `POST /api/test/last-mail` (reset links and codes alike); any other `ENV` uses
SMTP when `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` are all set, and
otherwise sends nothing. The console sender never runs in production: it prints the link, and
container logs are shipped. The SPA's nginx logs paths without the query string, and the reset pages
send no referrer.

When any of the five `SMTP_*` keys is missing or invalid outside `ENV=dev`, the API and the
worker still start, each logs one warning naming the missing keys, `/forgot-password` gives its
usual answer and sends nothing, and sign-up works but no code arrives. No code is ever logged
outside `ENV=dev`. The worker reads the keys at start-up, so a change needs a deploy.

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
deno task e2e:local        # browser tests on a stack of its own (docs/development.md, "Browser tests")
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
`DOMAIN` values. It also sends the password reset mails (trap 8).

**Personal API tokens: what is asked, what ends one, what is kept.** Creating a token asks for the
account's current password (`signIn.verifyPassword`, behind the strict per-user limit), so a
stolen session cannot mint one; an account with no password cannot create tokens and is told so.
The password is checked inside the create's transaction, under the lock on the person's `users` row
(`lockUser`), and counted around it (`signIn.countPasswordCheck`, below "Wrong passwords from a
session"): the count needs a pool connection of its own, which it must not wait for while the
transaction holds one. A password change and a reset take that lock too, after the password key's,
and write the password and revoke the tokens in one transaction: both happen or neither, and a token
made with the old password never outlives the change. The create queues the `api-token.created-mail`
job, which mails the owner's proven address. A token's name is one line: line breaks and control
characters are refused (`hasUnsafeTextCharacters`), since the name goes into that mail as plain
text.

A token is revoked by its owner, by a password change or reset (every token of the person; "sign
out other devices" alone leaves them), when its owner leaves or is removed from its group, and when
its group is deleted. A restored group or a member added back does not get the tokens back. Revoking
sets `api_tokens.revoked_at` and keeps the row, so the next request with that token can still be
tied to its owner and audited. A revoked or expired token is refused and hidden from that moment.
A token of a soft-deleted account is not revoked: it works again if the account is restored.
The migration that added `revoked_at` also revoked the tokens the older code had left asleep: those
of people no longer in the token's group and of groups in the trash, each with its audit row.

The nightly `outbox.cleanup` job runs `purgeExpiredApiTokens`, which deletes a row
`API_TOKEN_PURGE_GRACE_DAYS` (30) days after it expired or was revoked, by the database clock, so a
row may live up to a day longer. A token that never expires stays until it is revoked.

Every token row in `auth_audits` (created 8, used 9, revoked 10, purged 11, refused 12) names the
token in `identifier`: `<id> group=<group id> access=<read|write>[ reason=<why>] name=<name>`,
built in SQL by `apiTokenAuditIdentifier`, so a row still says which token after the token's row is
gone. No hash or part of a token is written. A revoke's reason is `owner`, `password-change`,
`password-reset`, `membership-ended` or `group-deleted`. A refused request (reason `revoked`,
`expired` or `scope`) writes at most one row per token and reason in five minutes
(`REFUSAL_AUDIT_WINDOW_MS`); while Valkey is down it writes none. A token nobody holds has no owner
and leaves no row. The purge writes one row per expired token; a revoked one already has its
revoke row.

## How a profile or push call travels

`profile.get`, `profile.update`, `push.register`, `push.remove` and `push.list` are served from
`apps/api/features/profile/operations.ts` and `features/push/operations.ts` and dispatched on the
same buses as the REST routes (`/api/users/me`, `/api/push`). The two commands that change devices
carry an idempotency key. Every change emits `UserProfileUpdatedEvent` or `PushDevicesUpdatedEvent`,
whether it came over REST or the socket, and an event handler calls `Realtime.notifyUserChange`,
which sends a `change.hint` (group id `user:<id>`, aggregate `user`, sequence = the clock in
milliseconds) to every socket of that user. The SPA's pull answers that hint with
`profileStore.refresh()`, so a second tab follows without a reload.

## How a group call travels

1. `apps/spa/src/realtime/index.ts` opens `/api/ws`. The upgrade runs the same session gate as
   REST and the `Origin` check, then `apps/api/services/realtime.ts` remembers which session each
   socket belongs to.
2. `group.create`, `group.list`, `group.get`, `group.select` and `group.selected` are dispatched on
   the same command and query buses REST uses, from `apps/api/features/groups/operations.ts`. Each
   frame reads the session again from the database, so a signed-out or expired session is refused.
   Authorization stays in the buses.
3. A command needs an idempotency key. `@spy4x/server/idempotency` (ts-libs) stores it for 7 days
   per user and runs the command once; a repeat returns the first result, and a repeat while the
   first still runs waits, then answers `conflict`. The worker sweeps expired keys hourly.
4. Every committed group change bumps `groups.next_change_sequence` and writes an outbox row in
   the same transaction. The worker drains the outbox and sends `pg_notify`; the API turns it into
   a `change.hint` with the sequence for every member's open sockets. `pg_notify` reaches only the
   API instances listening at that moment; a push missed that way is caught by the pull after the
   next reconnect.
5. A job is an outbox row with `aggregate_type = 'job'`, no group and no payload:
   [jobs.md](jobs.md) says how to add one (`defineJob` in `libs/server/jobs/registry.ts`), queue a
   run (`enqueueJob`) and make it repeat. A failing job backs off up to 15 minutes and after 20
   attempts is given up (`JOB_RETRY` in `libs/server/jobs/job-failures.ts`): the row is closed and
   keeps the error's class in `last_error_code` until the cleanup removes it a week later. The
   worker logs each failed attempt with the row's kind, the attempt, the stage and the error's
   class, never its message, and the last one as `abandoned`. Two things are not logged. An attempt
   lost with a worker that died mid-run is retried after its lease without a line, unless it was
   the last one, which is logged with stage `lease`. And the line is written after the row is
   closed, so a worker that dies between the two leaves the closed row as the only trace, for those
   seven days. The nightly cleanup (`outbox.cleanup`, 03:00 UTC) removes outbox rows processed more
   than 7 days ago and runs every purge, each as its own step (`cleanupSteps` in
   `libs/server/jobs/cleanup.ts`); a step that throws is logged and stops no other step. Rows that a
   worker from before this (10 attempts, never closed) had given up are closed by migration
   `2026_11_01_0001_close_given_up_outbox_rows.sql`. A cancelled run (from the admin's Jobs module)
   is closed with `cancelled_at` set; the worker writes a fresh run of a cancelled repeating job
   when it starts.
6. A listener on the in-process event bus that throws is isolated, logged as one JSON line with the
   event and listener names and the request id, and counted in `event_listener_failures_total`
   (a `createCounter` from `@spy4x/platform/universal/metrics`). Register listeners with `subscribe`
   (not `eventBus.on`) so the name is known, and mark each best-effort or durable in
   `apps/api/cqrs/+init.ts`. Nothing exports the counter yet (`renderPrometheus` prints it). Once
   the API serves it, add a scrape job to `infra/configs/vmagent.yml` and a rule to
   `infra/configs/alerts.yml` (docs/stack.md, "Monitoring"). An outbox row has no payload, so a
   listener that needs the event's data cannot be durable until it has one. An audit record is
   therefore never a listener: sign-up, sign-in, sign-out and the profile change write their
   `auth_audits` row with `tx.authAudit.insert` in the command's transaction, so a failed row undoes
   the action and a kept action always has its row (spy4x/template#191). A new audited action does
   the same.
7. The SPA treats a hint as a reason to read. `pull` (`apps/spa/src/state/pull.ts`) reads again
   what the hint names: the groups list (over REST, `GET /api/groups`, or as the socket's
   `group.list` query), then the open group's notes, tags and members. It is the same read the page
   makes at start-up and after every reconnect, so a lost frame costs one read.
8. The selected group is per person, not per group: a `user_settings` row holds `selected_group_id`
   and a `version`. It is read through `getSelected`, which checks membership at read time and, when
   nothing is stored or the stored group is gone, deleted or was left, answers with their oldest
   group. That read stores nothing and announces nothing, so it can never
   overwrite a choice committed at the same moment; only `select` writes. A `select` emits
   `GroupSelectedEvent`; its listener calls `Realtime.notifyUserChange`, the same one-person hint
   the profile and push devices use (cursor `user:<id>`), and the SPA answers that hint by reading
   the profile and the selection again. The event bus is in-process, so only the API instance that
   took the `select` reaches the person's sockets; another instance's sockets catch up on their next
   reconnect. Notes live at `/notes` and show the selected group's notes. An old
   `/groups/:groupId/notes` link only redirects: to `/notes` when that group is already the selected
   one, otherwise to `/groups`. It never selects, because a link another site controls must not
   switch a person's group (the API refuses a select that is not a post from the app's own page).
   The create form names the group on screen. `/groups` lists the groups, each row one link to the
   group's page, with the person's role and "Current" on the current group. `/groups/new` and
   `/groups/:groupId` are the same editor: `GroupEditorScreen` in `libs/ui`. Its form holds the
   name, description, emoji and colour; a create sends them in one `group.create`, and a save sends
   a rename (`PATCH /api/groups/:id`, `group.rename`) and the details (`group.updateDetails`), each
   only when it changed. An editor or a viewer sees the details as text. A "Delete group" section,
   for the owner only, holds the confirmation text and the delete (`DELETE /api/groups/:id`,
   `group.delete`). Each later issue (members, roles and leaving spy4x/template#130; invitations
   spy4x/template#131; ownership spy4x/template#132; moving notes spy4x/template#133; moving all of
   a group's data spy4x/template#260; the extra fields spy4x/template#134) adds its own section to
   that screen, shown only to the roles that may use it.
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
10. **There is no group kind.** Every group is an ordinary one; sign-up makes one named
    "Personal" (`createFirst`, `ensureFirst`), and the create body is `{ id, name }`. Migration
    `2026_10_07_0001_group_kind_removed.sql` dropped `groups.kind` and rewrote no row.

    **Audit.** Rename, delete and restore each write an `audit_events` row (kind `group.renamed`,
    `group.deleted`, `group.restored`, with the actor and request id) in the same transaction as
    the change. Migration `2026_10_08_0001_audit_outlives_group.sql` makes `audit_events.group_id`
    nullable with `ON DELETE SET NULL`, so the purge leaves the rows behind with the group id
    emptied; they are the record of who deleted what.

    **A note and a delete racing.** A delete can land while a note write is on its way.
    `recordGroupChange` refuses a deleted group inside the write's transaction
    (`GroupNotActiveError`, answered as `GROUP_NOT_FOUND`), and the note write rolls back; the
    delete records its own change with `allowDeleted`. The delete's row locks are `FOR NO KEY
    UPDATE`, because `FOR UPDATE` conflicts with the key-share lock a note insert takes on its
    foreign keys and the two deadlock.

## Members, invitations and ownership

Member removal, role changes and leaving (spy4x/template#130) call `recordAccessChange` in their
transaction, with the removed member in its list of users who lost access (a demoted member keeps
access). Note writes and rename read the actor's role again inside their own transaction with
`lockActorRole` (`libs/server/groups/group-change-log.ts`): it locks the group row, then the
membership `FOR SHARE`, so a write racing a removal or demotion waits for it and is then refused
(spy4x/template#230). The member commands lock the group row too, then the memberships of the actor
and the target with `lockMemberRoles` (`FOR UPDATE`), and check the rule on those rows. Keep the
group row first in both: the other order deadlocks a write against a member change (the "lock order"
tests in `tests/integration/group-write-race.integration.test.ts`). `recordAccessChange` and
`recordGroupChange` take a transaction, never the pool. Members' sign-in addresses go only to the
owner and admins (`canSeeMemberEmails`); other members get no `email` field.

Invitations (spy4x/template#131): only `sha256(token)` is stored (`group_invitations.token_hash`),
so a link is shown once, in the answer to its create, and never again: the create sends no
`Idempotency-Key`, since the idempotency store would keep the token. The link is `/invite/:token`;
the API takes the token only in a JSON body, never in a URL it logs, and the SPA sends no referrer
from the invitation page. Pending invitations take no seat: the create is refused by the entitlement
gate when the members alone fill the plan's `maxMembers`, and the accept counts the members again
under the group row's lock (`PostgresInvitationRepository.accept`). An address-bound invitation is
accepted only by an account that proved that address (`provenAddressOwner`). Create, accept and
revoke write their audit rows in their own transaction. Creates are capped per user per hour, mails
per address per hour, and previews and answers per IP (`invitation-rate-limits.ts`). A member who is
removed or leaves loses every pending invitation they made, and one who is demoted loses those above
what they may now invite with, in the same transaction (`revokeInvitationsOf`).
`group_invitation_acceptances` records who accepted each invitation, so a removed member cannot
rejoin through the team link they used. On a plan without `memberRoles` an invitation adds a viewer
only, on create and on accept; the role picker says so. Invitations are the only way into a group
through the product. The nightly cleanup deletes invitations that have been dead (expired, revoked,
declined or used up) for over 30 days.

Ownership transfer (spy4x/template#132): `POST /api/groups/:id/transfer` takes `{ userId, name,
password }`, over HTTP only, never the socket, so the password does not cross a long-lived channel.
It spends the per-user budget a password change spends (`strictByUser`), checks the role, then the
typed name, then the password, so a refused request spends no password check. One transaction
demotes the old owner to admin before it promotes the new one: the partial unique index
`group_members_one_owner_key` allows one owner row per group and cannot be deferred. The old owner's
admin links are revoked, and their viewer and editor links stay; the new owner's links stay. The new
owner gets a web push. A subscription that still renews refuses the transfer
(`SUBSCRIPTION_RENEWS`); after it, the old owner's billing customer is handed over and the new owner
checks out with their own ([the billing guide](billing.md), "Transfer of ownership").

Moving all of a group's data (spy4x/template#260): `POST /api/groups/:id/move-all` takes `{
toGroupId }`, and the socket command `group.moveAll` takes `{ groupId, toGroupId }`. One transaction
locks both groups in id order, checks edit rights in both on the locked rows, records a change in
each (`group.data_moved_out`, `group.data_moved_in`), runs every aggregate in `MOVABLE_AGGREGATES`
(`apps/api/services/db-base.ts`) and writes one audit event per group; any failure rolls back the
lot. A group with nothing to move is refused (`NOTHING_TO_MOVE`), moving into the same group is
`SAME_GROUP`, and notes deleted earlier stay behind. The target's note cap is read by the gate and
counted by the repository, which refuses with the plan refusal. The settings menu offers it as "Move
all data to...", then the delete confirmation. A new aggregate registers as described in
[the aggregate guide](aggregates.md), "Register it for move all data".

## Working agreements

- Small, focused PRs.
- Verify before claiming. Run the gates, and run the app when the change touches
  runtime behaviour.
- State facts from the code, not from memory.
