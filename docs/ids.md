# Ids

> Also on the website: [seedsaas.com/docs/ids](https://seedsaas.com/docs/ids).

This page says how Seed makes ids, why every one is a UUID version 7, and what a secret uses
instead.

You need:

- Nothing installed. Read it before you add a table, a job or anything else with an id.

## An id is a UUID version 7

Every id is one, whatever it names, including an id other people see. Make it with `uuidV7()`
from `@spy4x/platform/universal/uuid`.

An e2e spec imports the same package as `@jsr/spy4x__platform/universal/uuid`, its npm name.
Playwright's loader finds packages only in `node_modules`.

A version 7 id starts with the time it was made. New rows sit together in the index and sort by
age. A version 4 id is random and scatters over the index.

| What                  | Examples                                                                       |
| --------------------- | ------------------------------------------------------------------------------ |
| Records               | Groups, notes, tags, invitations, API token rows, a group's change log rows    |
| Jobs and outbox rows  | The ones Seed queues, and the ones `@spy4x/server` writes                      |
| Requests              | Idempotency keys and request ids                                               |
| Devices               | A browser registered for push                                                  |
| Fake billing ids      | `cs_fake_…` and `bps_fake_…` of the development billing provider               |
| Test fixtures         | Throwaway schemas and e-mail addresses                                         |

A name cut from an id takes its end, `uuidV7().slice(-8)`. Its start is the clock and repeats for
about a minute. For the same reason, the profile page labels a device by the last eight characters
of its id.

## Who makes the id

The browser makes the id of a note, a tag and a group, online and offline. A retry or a queued
change then names the same record.

SQL never makes an id: the application passes it in, and no `uuid` column has a default. Postgres
18 has `uuidv7()`, so SQL may make one where no caller needs to know it first. Nothing here does
yet.

## A secret is not an id

A secret is a value that alone lets its holder in: a session token, a private share link, an API
key, a cookie secret. A version 7 id shows when it was made and is easier to guess. So a secret
may need `randomBase64Url()` from `@spy4x/platform/tokens` instead.

That choice is the owner's. If you find a secret made as a UUID, leave the call as it is and ask.
Name the value and what a correct guess would give.

Two values still wait on that decision. Each is a version 4 UUID from Web Crypto:

| File                           | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `apps/worker/demo/seed.ts`     | The cookie secret of the seed script's own session manager            |
| `libs/server/billing/setup.ts` | The webhook secret of the billing client in a process with no webhooks |

Code that already makes a value that is no id stays as it is. That covers a password hash, a
salt, a nonce, a key, a code and a `randomBase64Url()` token such as an invitation link's.

The idempotency claim token comes from `@spy4x/server` as a version 7 UUID, from 1.64.1 on. So
`idempotency_keys.claim_token` stays `uuid`, with no default.

## Old ids stay valid

Rows and offline changes made before this rule carry version 4 ids. They are never rewritten.
Every validator accepts a lower-case UUID of any version: use `isUuid` and `UUID_PATTERN` from
`@spy4x/platform/universal/uuid`.

Do not write a pattern that names a version. A test that needs an old id writes it as a literal
string.

## The guard

`tests/no-uuid-v4.test.ts` runs in `deno task check`. It reads every text file git tracks, whatever
its extension, and fails on any of these:

- a call that makes a version 4 id, in TypeScript or SQL;
- a pattern or helper that accepts only version 4.

Two old migrations are allowed by their exact names, because applied migrations are history. A new
migration is checked. The two secrets above are allowed by their exact line, so a second call in
either file fails.

## Next

- [The aggregate reference](aggregates.md)
- [Architecture](architecture.md)
