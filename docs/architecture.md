# Architecture

Moved from the README. [ADR 001](decisions/001-deno-platform-template.md) and
[ADR 002](decisions/002-realtime-transport-and-sync.md) are authoritative; this page summarises
them. The diagram in the README, [`architecture.svg`](architecture.svg), shows what exists today.

## Migration status

> **Migration status: WIP.** App boundaries, groups with members, roles, invitations and
> ownership transfer, the notes reference aggregate ([aggregates.md](aggregates.md)) and tags, the
> outbox worker with its delayed and repeating jobs, the public website (`apps/mpa`,
> server-rendered, works without JavaScript), the offline SPA ([offline.md](offline.md)), the admin
> app (`apps/admin`) and the `libs/shared` split into `libs/platform` and `libs/domain` now exist.
> What is not built yet is listed on the [open issues](https://github.com/spy4x/seed/issues).
> Target architecture below and ADR 001 are authoritative.

## Database evolution

Database evolution is forward-additive. A migration that rewrites rows is idempotent and safe to
rerun during rollout.

## Target architecture

Apps compose bounded domain and platform libraries: Postgres is authoritative, browser data is
a local projection in IndexedDB, and REST endpoints dispatch CQRS flows with versioned,
cursor-based, idempotent sync.

Target apps:

- `apps/api`: REST, auth, authorization, CQRS dispatch, and sync transport.
- `apps/spa`: offline-capable Preact/Vite client backed by the shared data cache and outbox in
  IndexedDB.
- `apps/mpa`: the product's public website, server-rendered: home page, pricing, legal pages and
  the newsletter. It has no session; the product itself is the SPA.
- `apps/worker`: asynchronous event handlers, projections, and integrations.

Target libraries:

- `libs/platform`: reusable technical primitives and contracts. Today these come from the
  published `@spy4x/*` packages (spy4x/ts-libs) at an exact pinned version, not from code here.
- `libs/domain`: business rules, commands, events, and queries.
- `libs/server`: Postgres and server-side adapters.
- `libs/ui`: the SPA's product screens. Generic Preact UI comes from the `@spy4x/preact-*` packages.

Every group, including the one made at sign-up, uses one authorization and sync model. Full
boundary and sync rules are recorded in [ADR 001](decisions/001-deno-platform-template.md).

Distribution proceeds in stages: Git template first, proven generic libraries on JSR second,
then a CLI after generation and upgrade flows stabilize.

## Mail subscriptions

Visitors join a mailing list through `@spy4x/server/subscribers`; template ships one list, `news`,
and a product adds more in `SUBSCRIBER_LISTS` (`libs/domain/subscribers`) with no schema change. The
send path copies the password reset: the API writes a `subscription_requests` row and an outbox
job, and only the worker signs links and sends.

| Job                        | Enqueued by                                    | The worker                                                          |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `subscribers.confirm-mail` | `POST /api/subscribers`, the same for any address | signs the confirm token, sends, deletes the request row             |
| `subscribers.welcome-mail` | a successful confirm                           | sends the welcome with a one-click `List-Unsubscribe`, if still listed |
| `subscribers.send-issue`   | `deno task subscribers:send <list> <issue.json>` | runs `sendIssue` with the Postgres send log; a failed send throws, and the retry mails only the missed audience |

- **Secrets.** `SUBSCRIBERS_SECRET` (at least 32 printable characters, `openssl rand -base64 48`)
  signs every link, for the API and the worker alike; it and every previous secret must differ
  from `AUTH_COOKIE_SECRET`, so rotating cookies keeps every sent unsubscribe link working, and
  production refuses the public development secret. `SUBSCRIBERS_PREVIOUS_SECRETS`
  (comma-separated, optional) still verifies links signed before a rotation. Each list signs with
  its own key, derived from the secret. In production without a secret the routes answer 503 and the
  worker drops subscriber jobs; in development a fixed, public dev secret is used.
- **Pages.** `/subscribe`, `/subscribe/confirm` and `/unsubscribe` exist in the SPA and the MPA (the
  public website).
  Token pages answer `Cache-Control: no-store` and send no `Referer`, and a finished step leaves the
  token out of the address (the MPA answers 303 to the page without it).
- **One-click unsubscribe.** `POST /api/subscribers/unsubscribe` is the RFC 8058 target: a mail
  client's post without browser headers passes, a cross-site browser post gets 403. Only this route
  takes a post without browser headers. The unsubscribe routes refuse any token but the version 2
  format template signs: the library still reads antonshubin.com's version 1 tokens, and checks
  each against the whole list.
- **Rate limits.** Per IP on subscribing and on every token check, and three confirm mails an hour
  per address. The address budget is keyed by an HMAC under a key derived from the secret, so Valkey
  holds no address and no plain hash of one.
- **Issues.** In the worker container, `deno task subscribers:send news issue.json` (or `-` for
  stdin) takes `{ id, subject, preheader?, blocks }`, where each block is `{ heading }`,
  `{ paragraph }`, `{ list: [...] }` or `{ button: { href, label } }`. Rerunning the same `id`
  mails only who has not got it. In development the mail lands in `dev_mail`; links in it use
  plain HTTP, so the `List-Unsubscribe` header is left off there.
- **Cleanup.** The nightly cleanup removes requests older than a day.

## Documentation

- [Architecture decision](decisions/001-deno-platform-template.md)
- [Realtime transport and sync protocol](decisions/002-realtime-transport-and-sync.md)
- [Swappable transport and local data](decisions/003-swappable-transport-and-local-data.md)
- [Group sync design](design/group-sync.md)
- [Realtime transport and sync-on-reconnect](design/realtime-websockets.md)
- [Contributing](../CONTRIBUTING.md)
