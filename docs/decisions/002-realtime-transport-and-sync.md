# ADR 002: Realtime transport and sync protocol

- Status: accepted; superseded in part by [ADR 003](003-swappable-transport-and-local-data.md),
  which replaces "Transport per app" and the consequence "The SPA is not usable with the socket
  blocked"
- Date: 2026-08-19
- Maintainer: architecture owners
- Location: `docs/decisions/002-realtime-transport-and-sync.md`
- Supersedes: the transport and sync rules in
  [ADR 001](001-deno-platform-template.md); the recommendation in
  [realtime design](../design/realtime-websockets.md)

## Context

ADR 001 made REST the external application protocol and gave WebSockets no
correctness role: "WS may hint earlier pull but protocol must work without it".
That is a defensible design, but it is not the one this repository wants to
demonstrate.

The template's product is reusability, so its most valuable demonstration is
that a CQRS core is transport-agnostic: the same command and query handlers
serve two clients with genuinely different architectures. That is worth more
than two clients that differ only cosmetically.

Two existing projects informed this, and both were read rather than recalled.

**Financy** puts CRUD on the socket: its WebSocket service dispatches nineteen
CQRS commands and streams entity lists. The transport therefore carries
validation, authorization and error mapping, and the application does not work
when the socket is down. Its client also sends a hardcoded `0` as the sync
floor, so every connect re-downloads every model.

**SmartLite (`gb`)** keeps mutations on REST and uses the socket for
sync-on-connect and change broadcast - closer to what we want - but its
checkpoint is a timestamp, and that produces two silent failure modes:

- The client discards the server's `SYNC_FINISHED` timestamp and sends its own
  `Date.now()` as the next sync floor. A client clock running fast means every
  row the server changed inside that skew window is never delivered again, not
  late but never, until something else touches the row.
- The checkpoint is taken after iterating every model, so a row changed during
  the iteration is missed and the checkpoint still advances past it.

Neither failure appears in any log. Both are consequences of ordering writes by
wall-clock time and of treating pushed data as the only path. This ADR is
written so that neither is expressible here.

## Decision

### Transport per app

- `apps/spa` speaks WebSocket for all mutations, queries and realtime updates.
  It uses REST only for bootstrap and for the auth endpoints that must exist
  before a socket can be opened - sign-in, sign-up, password reset.
- `apps/mpa` speaks REST only, request/response, with no realtime. Keeping it
  strictly synchronous is what makes it a distinct reference architecture.
- Both transports are thin adapters over the same command and query handlers.
  A transport parses, authenticates, and dispatches; it holds no business rule.

### Push with sequence, pull as the authority

Servers push committed changes over the socket, stamped with the per-group
`next_change_sequence` they were committed at.

A client applies a pushed change only when its sequence is contiguous with the
cursor the client already holds. On any gap it discards the payload and pulls
from its cursor over REST. Correctness therefore lives in exactly one path -
the cursor pull - which is also the path that runs when the socket is absent.

This keeps the latency of direct push while making the transport's failure
modes - dropped frames, reconnect gaps, reordering, duplicate delivery -
degrade to a redundant pull rather than to divergent local state.

The governing test for any future change: **delete every line of WebSocket code
and the application must still converge to correct state.** If it cannot, the
change is wrong.

### One mechanism

There is no second, lower-guarantee lane for high-frequency or disposable data.
Every synced entity uses sequence-stamped push with cursor pull. A stream-shaped
feed such as telemetry, where a dropped frame is genuinely acceptable, would
justify a second mechanism, but the template does not have one and will not
grow one speculatively.

### Bootstrap over REST

Initial load is a REST endpoint for both apps, returning a page of state plus
the cursor it was taken at.

Bootstrap runs on a new device, after cleared storage, and when a cursor is too
old to serve - the moments when the payload is largest and the user is least
patient. REST gives resumability from the last page cursor, flow control from
the response stream, and a request that can be reproduced with `curl`. Streaming
a large snapshot over the socket instead means re-implementing chunk cursors,
acknowledgements and interleaving to avoid stalling live traffic, and gives up
per-response codec choice.

### Authentication, authorization, revocation

- Authentication happens once, at the WebSocket upgrade, from the session
  cookie sent with the handshake.
- Authorization is checked per message, exactly as it is per REST request. The
  checks live in the CQRS handlers, not in route middleware, so both transports
  are covered by one implementation. Leaving them in middleware would let the
  socket bypass them entirely.
- The upgrade validates the `Origin` header against the configured application
  URL. WebSocket handshakes are not governed by CORS, and `SameSite=Lax`
  protects only against cross-site origins - a same-site subdomain can still
  open an authenticated socket. Origin validation closes that and stops the
  cookie policy from being a single point of failure.
- A long-lived socket outlives the check that opened it. On sign-out, on session
  expiry, and on an `authorization_revision` change, live sockets are
  re-evaluated and closed if no longer entitled. The per-message check is the
  primary control; the fan-out bounds how long a revoked session keeps reading.

### Idempotency

- Every command carries a client-generated idempotency key.
- The server stores key to result and returns the original result on replay
  without re-applying the mutation. A retry must be indistinguishable from a
  first delivery.
- Updates additionally carry the expected entity version, so a stale write is
  rejected with the authoritative version rather than silently overwriting.
- Keys are retained for **7 days**, which bounds how long a client may be
  offline and still flush its queue safely. Retention is swept, not unbounded.

At-least-once delivery on a socket and an offline outbox that replays on
reconnect both make duplicate submission normal rather than exceptional, so
idempotency is required on every command, not only on those that look risky.

## Consequences

- Authorization must move out of route middleware into the CQRS handlers before
  the WebSocket transport can carry mutations. This is a prerequisite, not a
  follow-up.
- The SPA is not usable with the socket blocked, since only auth and bootstrap
  are reachable over REST. The sync protocol remains correct without the socket;
  the SPA simply has no other transport wired.
- Sequence-stamped push requires `next_change_sequence` to be incremented on
  every committed group-scoped change, and every change to be replayable in
  order. Neither exists yet.
- `authorization_revision` must be incremented on membership and role changes.
- An idempotency key store with a 7-day sweep is new persistence to add.
- Two transports mean two adapters to test, but only one set of handlers, so
  transport tests can stay thin.

## Maintenance

Architecture owners review this record. If the transport split, the push and
pull contract, the revocation model, or the idempotency guarantees change, add a
new ADR and mark this record superseded; do not rewrite accepted history.
