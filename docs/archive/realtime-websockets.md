> **Archived.** Replaced by [ADR 002](../decisions/002-realtime-transport-and-sync.md), which took
> its recommendation.

# Realtime transport and sync-on-reconnect

- Status: superseded by [ADR 002](../decisions/002-realtime-transport-and-sync.md).
  Kept as the analysis record; the decision lives in the ADR.
- Date: 2026-08-19
- Related: [ADR 001](../decisions/001-deno-platform-template.md), [group sync design](group-sync.md),
  [Financy inventory](../financy-extraction-inventory.md)

## The questions

1. Do WebSockets live in `apps/api`, or in their own app?
2. If their own app, what is it called?
3. How does a client catch up after reopening the app or losing and regaining a connection?

## The constraint that decides most of this

ADR 001 already fixed the important part:

> No WebSocket correctness dependency; WS may hint earlier pull but protocol must work without it.

That single line changes the shape of the answer. If WebSockets only *hint*, the realtime layer
holds no business logic, validates no commands, and owns no data. It is a fan-out of small
"group X moved to sequence N" messages. Everything that must be correct — ordering, idempotency,
conflict rejection — lives in the REST/CQRS path and is exercised identically whether or not a
socket is connected.

This is the main lesson from Financy, where the opposite choice was made: its WS service is 1232
lines because it dispatches all 19 CQRS commands, validates every model, and streams entity lists.
That makes the socket a second mutation path with its own validation and its own security surface,
and it means the app does not work when the socket is down.

## Topology: same app or separate app

**Option A — inside `apps/api`.** One auth path, one middleware chain, one deployment unit. The
handler can call the command bus in-process. Simplest thing that works, and the default most
generated projects want.

Costs: sockets are long-lived and stateful, so every API deploy drops every connection; REST and
realtime must scale together even though one scales on CPU-per-request and the other on
concurrent-connections-and-memory; and a misbehaving socket handler can add latency to REST in
the same process.

**Option B — a separate app.** Independent scaling and deploy cadence, so rolling the API does not
drop sockets. Failure isolation. Because the layer is hint-only it needs no command bus at all.

Costs: it needs its own way to authenticate the session cookie, and a cross-process channel to
learn that something changed — Valkey pub/sub, or polling `outbox_events`. That is one more
service every generated project must run and operate.

### Recommendation

**Superseded.** This section originally recommended keeping WebSockets hint-only,
with no correctness dependency. ADR 002 decided otherwise: `apps/spa` speaks
WebSocket for mutations, queries and realtime, and pushed changes are stamped
with a sequence so a client can detect a gap and fall back to a cursor pull.

The analysis above still holds and is why the hint-only option was considered at
all. What changed is the weighting: the template's value is in demonstrating a
transport-agnostic CQRS core, and sequence-stamped push keeps the latency of
direct push while confining every transport failure to a redundant pull.

The library boundary recommended here stands. Put the connection registry and
the message protocol in `libs/server/realtime` and mount it from `apps/api`, so
extraction later is a deployment change rather than a rewrite.

### Naming, when it is extracted

`apps/realtime`. It names the capability rather than the transport, so adding SSE or long-polling
later does not make the name a lie. `apps/ws-api` is the weaker option: it reads as "a second API",
which is exactly what this must not become.

## Sync on reconnect

The rule: **pushed data is an optimization; the cursor pull is the authority.**
A push carries the change and the sequence it was committed at. The client applies
it only when that sequence is contiguous with its cursor, and otherwise discards it
and pulls. See [ADR 002](../decisions/002-realtime-transport-and-sync.md).

Client state, persisted in Dexie so it survives reloads:

- `cursor` per group — the last committed `next_change_sequence` the client has applied.
- `authorizationRevision` per group — as of the last successful pull.

The flow:

1. **Cold start, no cursor for a group** — client calls the bootstrap endpoint and receives a
   snapshot plus the cursor that snapshot was taken at.
2. **Warm start or reconnect** — client calls pull with its cursors and receives ordered changes
   and new cursors. This is the same call whether it has been offline for a second or a week.
3. **Steady state** — server sends `sync.hint { groupId, sequence }` when a group advances. The
   client pulls only if `sequence` is greater than its cursor. The hint carries no payload, so a
   dropped or duplicated hint costs at most one redundant pull.
4. **Authorization changed** — if a pull reports an `authorizationRevision` different from the
   client's, that group is re-bootstrapped rather than incrementally pulled. This is what stops a
   client that was removed from a group, or downgraded, from continuing an incremental stream.
5. **No socket at all** — the client polls pull on an interval. Correctness is unchanged; only
   latency differs. This is the property ADR 001 asks for, and it is the reason this design is
   testable without a browser.

### Why not Financy's approach

Financy sends `SYNC_START` with a `lastSyncAt` timestamp and the server streams back full entity
lists per model. Three problems, all avoided above:

- **Timestamps cannot order writes.** Two commits in the same millisecond have no defined order,
  and any clock skew between application instances silently drops or repeats rows. The per-group
  monotonic sequence already in this schema has neither failure mode.
- **The checkpoint was never persisted**, so the client sends `0` and re-downloads everything on
  every connect. A cursor that does not survive a reload is not a cursor. Persisting it in Dexie is
  the whole point.
- **Data over the socket** means the sync path only works when the socket works, and it must be
  reimplemented for the offline case anyway.

## What this needs from the server

None of this exists yet; `next_change_sequence` and `authorization_revision` are currently declared
but never incremented, and `outbox_events` is written but never read.

1. Increment `next_change_sequence` on every committed group-scoped change, and record the change
   so it can be replayed in order.
2. Increment `authorization_revision` on membership and role changes.
3. Drain `outbox_events` in `apps/worker` and publish hints.
4. Bootstrap and pull endpoints.
5. The realtime library and its `apps/api` mount.

## Open questions

- Does a hint fan out to every member of a group, or only to sockets whose user is an active
  member at send time? The second is one membership lookup per hint; the first leaks the fact that
  a group changed.
- Should hints coalesce? A group under rapid writes should probably emit at most one hint per
  client per interval, since the client pulls the latest state regardless.
- Does the worker publish through Valkey pub/sub from the start? Doing so now costs little and
  removes the single-process assumption before it becomes load-bearing.

## Maintenance

When the topology question is answered, promote the decision to `docs/decisions/002-*.md`, mark
this file superseded, and leave the sync-on-reconnect detail here as the design record.
