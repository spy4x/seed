# Ids

Nothing in this repository creates a UUID version 4, except the two secrets listed below that wait
on a decision.

## An id is a UUID version 7

`uuidV7()` from `@spy4x/platform/universal/uuid` (in an e2e spec:
`@jsr/spy4x__platform/universal/uuid`, the same package under its npm name, because Playwright's
loader only finds packages in `node_modules`).

Every id is one, whatever it names, and that includes an id other people see.

A version 7 id starts with the time it was made, so new rows sit together in the index and sort by
age; a version 4 id is random and scatters over the index. The ids made this way:

- **Records:** groups, notes, tags, invitations, API tokens (the row's id, not the token) and
  the rows of a group's change log.
- **Jobs and outbox rows**, the ones the template queues and the ones `@spy4x/server` writes.
- **Requests:** idempotency keys and request ids.
- **Devices:** the id of a browser registered for push. The profile page labels a device by the
  last eight characters of its id, because the first ones are the time.
- **Fake billing ids** (`cs_fake_…`, `bps_fake_…`) of the development billing provider.
- **Test fixtures** and throwaway names (schemas, e-mail addresses). A name cut from an id takes
  its end, `uuidV7().slice(-8)`: the start is the clock and repeats for about a minute.

The browser makes the id of a note, a tag and a group, online and offline, so a retry or a queued
change names the same record. SQL never makes an id: the application passes it in, and no
`uuid` column has a default. Postgres 18 has `uuidv7()`, so SQL may make a version 7 id where no
caller needs to know it first; nothing here does yet.

## A secret is not an id, and is the owner's decision

A secret is a value that alone lets its holder in: a session token, a share link nobody else may
open, an API key, a cookie secret. A version 7 id shows when it was made and is easier to guess, so
a secret may need `randomBase64Url()` from `@spy4x/platform/tokens` instead. Whoever finds a secret
made as a UUID does not choose: leave the call as it is, ask the owner, and name the value and what
a correct guess would give.

Two such values are still a version 4 UUID from Web Crypto and wait on that decision. The guard
lets each through by its file and exact line:

- `apps/worker/demo/seed.ts`: the cookie secret of the seed script's own session manager.
- `libs/server/billing/setup.ts`: the webhook secret given to the billing client of a process that
  takes no webhooks.

Code that already makes a value that is no id (a password hash, a salt, a nonce, a key, a code, a
`randomBase64Url()` token such as an invitation link's) stays as it is.

The idempotency claim token is made by `@spy4x/server`, as a version 7 UUID from 1.64.1 on, so
`idempotency_keys.claim_token` stays `uuid`. It has no default: the store passes the token in
every insert.

## Old ids stay valid

Rows and offline changes made before this rule carry version 4 ids. They are never rewritten, and
every validator accepts a lower-case UUID of any version: `isUuid` and `UUID_PATTERN` from
`@spy4x/platform/universal/uuid`. Do not write a pattern that names a version. A test that needs
an old id writes it as a literal string.

## The guard

`tests/no-uuid-v4.test.ts` runs in `deno task check`. It reads every text file, whatever its
extension (code, SQL, shell, HTML, configuration, documents), and fails on a call that makes a
version 4 id, in TypeScript or SQL, and on a pattern or helper that accepts only version 4. Two old
migrations are allowed by their exact names, because applied migrations are history; a new migration
is checked. The two secrets above are allowed by their exact line, so a second call in either file
fails.
