# ADR 003: Swappable transport and local data

- Status: accepted
- Date: 2026-10-10
- Maintainer: architecture owners
- Location: `docs/decisions/003-swappable-transport-and-local-data.md`
- Amends: "Transport per app" and the consequence "The SPA is not usable with the socket blocked"
  in [ADR 002](002-realtime-transport-and-sync.md). Everything else in ADR 002 stands: push with
  sequence and pull as the authority, bootstrap over REST, authorization in the handlers,
  idempotency.

## In short

A product built on this template chooses two things, per app and where it matters per aggregate:
how the page talks to the server (HTTP alone, or HTTP plus a WebSocket), and what it keeps on the
device (nothing, a copy to read, or a copy to read plus a queue of writes). Each choice is a module
behind a port. A store never knows which module is behind its port, and removing either module
leaves a working app.

## Context

ADR 002 says the SPA "speaks WebSocket for all mutations, queries and realtime updates". That is
not what was built, and not what products need:

- Part of the app is on the socket and part is not. Over the socket today: every note and group
  command, the member commands `group.setRole`, `group.removeMember` and `group.leave`,
  `profile.get`, `profile.update`, `push.*`, `group.list`, `group.deleted`, `note.get` and
  `note.locate`. Plain REST: the members list and transfer, invitations, notifications, activity,
  billing, API tokens, e-mail, sessions and the auth forms.
- A page with the socket blocked cannot write a note, rename itself or list its groups, although
  the server can serve the same commands over REST.
- The socket is also the only thing that notices a session has ended or now belongs to another
  person: its reconnect check signs the page out, and the queue of offline writes sends only while
  the socket is open. No store reacts to a `401`.
- The offline layer (`apps/spa/src/offline/notes-*.ts`) is written for notes. A second aggregate
  gets none of it: no local copy, no queue, no conflict screen.
- Some future products need no socket, and some need no local database. Today neither can be left
  out without editing the stores.

The owner's requirement, for the template: "construction bricks (modules) interchangeable as much
as possible". For this app: every screen reads from the device (fast, searchable and filterable
with no network, kept in step with the server), and only the writes that make sense offline are
queued.

What already exists and is kept: every store takes its calls as an injected `…Dependencies`
object; the server dispatches REST and socket requests on the same command and query buses;
`@spy4x/realtime` has the outbox, its IndexedDB store and the sync runner; `@spy4x/platform` has
`createDataCache`.

## Decision

### 1. Three ports on the client

A store is built from its dependencies, and the dependencies are built from at most three ports.

| Port           | What it does                                                        | Modules that fill it                                         |
| -------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Calls**      | `command(name, payload, { idempotencyKey })` and `query(name, payload)` | HTTP (always present), WebSocket (optional)                |
| **Changes**    | "something changed, read again", for a group or for the person      | timers and page events (always present), socket hints (optional) |
| **Local data** | a copy of the server's last answer, and optionally a queue of writes | none, read cache, read cache plus outbox                    |

**Calls.** A request is a name and a payload, the shape the socket already uses (`note.create`).
The HTTP module sends the same request to `POST /api/call/<name>` and reads the same answer, so
both modules throw the same errors (`RealtimeRequestError` with the server's code in `details`, and
`ConnectionLostError` when the server cannot be reached). A store, the outbox and the error
wording therefore work unchanged over either. The WebSocket module, when present, is preferred
while its socket is open and falls back to HTTP while it is not. A product may also pin one
aggregate to one module.

**A call is bound to the person the page believes it is.** A cookie can change under a running
page: another tab signs out and someone else signs in. So every call carries the id of the user the
page was started for, and both adapters refuse a call whose session belongs to anyone else with
`unauthorized`. An `unauthorized` answer over either module signs the page out, which is how a page
with no socket learns its session ended. The outbox may send only when "the calls port is reachable
as this user" (`canSend`), never merely "the socket is open". The queue of one person can therefore
not be sent as another over either transport.

List pages and bootstrap stay plain `GET` routes with a cursor, as ADR 002 decided. They are reads
that both modules share; they are not part of the calls port. They carry the same user id as a
call and are refused the same way: a read whose session belongs to anyone else answers
`unauthorized`, signs the page out, and writes nothing to the device copy.

**Changes.** The pull stays the one path that makes a page correct (ADR 002). What varies is only
what triggers it. Without the socket: the start, the browser coming back online, the tab becoming
visible, the page's own write, and a timer while the tab is visible (30 s by default; the sync
runner's `pollIntervalMs`). With the socket: all of those, plus a hint the moment a change commits.
The socket module removes latency and adds no correctness.

The timer is cheap: it reads the groups list, which carries each group's change sequence, and reads
a group's notes and tags again only when that number moved.

**Local data.** One of three levels per aggregate:

1. **Online only.** The store calls the server and keeps nothing.
2. **Offline-readable.** Every full read replaces the device's copy. A read that cannot reach the
   server answers from the copy. A screen shows the copy at once and replaces it when the server
   answers. Search and filters run over the list the store holds, so they work with no network.
   The copy is saved with the time it was taken, so a screen can say how old it is.
3. **Offline-writable.** Level 2, plus the outbox: a write is saved on the device, shown at once,
   sent when the server is reachable, and shown as a conflict when the server refuses it.

A local copy is replaced as a whole by every full read, so it cannot drift. A delta pull from the
cursor is the later optimisation ADR 002 already allows for; it would sit behind the same port and
no store would change. The limit of full reads is the size of one list: 2 000 notes per group
today (20 pages of 100). A product past that adds the delta pull.

### 2. One place chooses the modules

`apps/spa/src/modules.ts` is the composition root: the only file that imports the WebSocket module
(`apps/spa/src/state/realtime.ts` today; it moves to its own folder `apps/spa/src/realtime/`) and
the local-data module (`apps/spa/src/offline/`). It reads two switches from the runtime
configuration (`/config.json`): `realtime` and `offline`, both `true` in this app. Stores import
ports from `modules.ts`, never a module, and views take the offline status line and the conflict
screen from it too.

- A product that never wants a module deletes its folder and its lines in `modules.ts`. A guard
  test per module (the pattern of `tests/offline-removal.test.ts`) fails when any other file
  imports the folder.
- The switches are what the tests use: the e2e suite runs its core specs once with
  `realtime: false` (HTTP only) and once with `offline: false` (online only), by answering
  `/config.json` from the test. ADR 002's governing test thereby becomes a test that runs: **delete
  every line of WebSocket code and the application must still converge to correct state.**

With `realtime: false` the page writes, reads and converges over HTTP, a few seconds later than
with the socket. With `offline: false` nothing is written to IndexedDB, the service worker still
caches the app's own files, and every screen needs the network.

### 3. The server: one table of operations, two adapters

The API already has the table: `SocketRequests`, a map from a request name to
`{ kind, handle({ actor, requestId, payload, idempotencyKey, signal }) }`, where `handle` parses
the payload and dispatches on a bus. It is renamed `Operations` and both adapters read it:

- the socket adapter, as today;
- a new HTTP adapter, `POST /api/call/<name>`, behind the same session gate and `Origin` check as
  every REST route. A command without an `Idempotency-Key` header is refused, as on the socket.

An aggregate lists its operations once and is reachable over both transports. Authorization,
entitlements, idempotency and the change log stay in the gates and handlers on the buses, so
neither adapter can skip them. `apps/api/features/notes/transports.test.ts` already runs the same
scenarios through REST and the socket; it gains the call route, and each new aggregate copies it.

Three kinds of route exist beside the table, and they are treated differently:

- **List and bootstrap routes** (`GET /api/groups/:id/notes` and the rest) stay. Both client
  modules read them.
- **Session routes for one command** (`POST /api/groups/:id/notes` and the like) duplicate an
  operation. Once an aggregate's operations are reachable through the call route and no client in
  this repository calls its per-command routes, those routes and their tests are deleted, so a
  command has two session entries (socket and call route), not three. A new aggregate adds its list
  route and its operations, and no hand-written route per command.
- **The token API** (`/api/v1`, the only routes that accept a token) is a separate public contract
  with its own routes. This ADR does not change it.

What is plain REST today (the members list and transfer, invitations, notifications, activity,
billing, API tokens, e-mail, sessions, the auth forms) keeps its routes. It already works without
the socket, which is the swap this ADR must guarantee. One moves into the table when it needs the
socket or the outbox, not before. What is socket-only today and not notes or tags (`group.list`,
`group.deleted`, the member commands, `profile.*`, `push.*`) is already in the table, so the call
route makes it reachable over HTTP with no new handler.

### 4. The level of every aggregate in this app

| Aggregate                         | Level                | Why                                                                                   |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Notes                             | 3, offline-writable  | The product's content: a person writes it anywhere. Moving and restoring stay online (two groups, or a server-side state the device cannot know). |
| Deleted notes, deleted groups     | 1, online only       | Rarely opened, and restoring needs the server. The device keeps no copy, as today.     |
| Tags (spy4x/template#170)                       | 3, offline-writable  | Content too, and a note written offline must be able to take a tag created offline.   |
| Groups list                       | 2, offline-readable  | Needed to show anything. Create, rename, delete and restore change access for other people, so they need the server. |
| Selected group                    | 2, offline-readable  | Read to know which notes to show. Switching is a server setting shared by every device; offline switching is not built (see "Not decided here"). |
| Members                           | 2, offline-readable  | A list a person looks up. Roles, removal, leaving, transfer and moving all notes change access: online only. |
| Invitations (a group's, and my own) | 2, offline-readable | The same. Inviting sends mail; revoking, accepting and declining are access changes: online only. |
| Notifications                     | 2, offline-readable  | An inbox is read on the move. Marking as read is online; it is a convenience, not content. |
| Activity                          | 2, offline-readable  | A log is only read. The device keeps the pages the person has opened.                  |
| Profile                           | 2, offline-readable  | Shown on every page. Changes are account changes: online only.                         |
| Billing (plan and status)         | 2, offline-readable  | The plan decides what the screens offer. Checkout and the portal are the provider's pages. |
| API tokens, signed-in devices     | 2, offline-readable, marked with the time of the copy | The lists show with no network, but a stale security list must say it is stale. Creating, revoking and signing a device out are online only. |
| Password, e-mail change, two-factor set-up, account deletion, sign-in and sign-up | 1, online only | Security actions with nothing to list. The server must answer before anything changes. |
| Push devices                      | 2 for the list, with the profile it is read with; 1 for registering and removing | Registration is a conversation between this browser, its push service and the server. |
| Newsletter (the MPA, and the SPA's `/subscribe`, `/subscribe/confirm` and `/unsubscribe`) | none | Public forms with no session and no local data. |

The rule behind the table: **every list a person works from is kept on the device; only content is
queued; anything that changes who can see or do what needs the server's answer first.**

**What a device keeps after its person leaves.** Signing out on the page deletes every read copy.
Queued writes stay, as `docs/offline.md` explains: they are text that exists nowhere else, and only
their owner's next sign-in can send or discard them. Today the read copies are deleted only by a
running page, so a session that ended while the app was closed leaves them on disk. That gap is
closed with this work: a start that finds no session deletes the read copies of the user the device
remembers before it shows sign-in.

### 5. Offline-writable aggregates share one layer

Each offline-writable aggregate has its own queue (its own IndexedDB database per user) and
supplies an adapter: how an entry becomes a command, how an error reads, the conflict wording, and
how a queued entry looks in a list. The layer owns everything else: opening the stores, the lock
shared by every tab, the sync runner, the conflict screen and the status line.

A note's tags travel inside the note's own write as a list of tag ids, so one note has one queue
entry. Tags are the parent and notes depend on them. Four rules make that safe:

1. **One ordered flush.** Queues are sent in a declared order, parents first: tags, then notes. One
   lock spans the whole flush, and a write submitted while online goes through the same flush, so a
   note can never overtake the tag queue.
2. **A note waits for its tags.** A note entry is not sent while a tag it names is still queued or
   is in conflict. It stays "waiting", with its text safe on the device. The status line reports it
   as waiting on the person's choice about the tag, not as a send that keeps failing.
3. **A tag that will never exist leaves the notes that name it.** When a queued tag create is
   undone, dropped (created and deleted before any send) or discarded after the server refused it,
   the layer removes that tag from the queued notes and tells the person. The notes then send
   without it.
4. **The server ignores tag ids it does not know in a note write.** Deleting a tag removes its
   links (spy4x/template#170), and another member may delete a tag at any moment, so a write that names a tag
   deleted a second ago must not fail. The answer carries the tags the note really has, and the
   page shows those. Removing a tag's links does not change the version of the notes that had it,
   so deleting a tag never turns an offline edit of such a note into a conflict.

So a refused tag never costs a note's text: the worst outcome is a note saved without one tag, and
the person is told.

### 6. Where the code lives

Reusable code is written in the libraries first, released, then imported (the rule in
`AGENTS.md`). The template keeps only what names this app's aggregates.

| Piece                                                                                   | Home                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------- |
| The calls port, sending one command again with the same idempotency key, "is this error worth a retry" (`apps/spa/src/state/realtime-call.ts` today). The waiting between tries uses the existing `backoffDelay`; no second retry helper is written | `@spy4x/realtime` (new)   |
| The HTTP calls module for the client, and "prefer the socket, fall back to HTTP"        | `@spy4x/realtime` (new)                |
| The operations table type and the HTTP adapter for the server (web-standard `Request` in, `Response` out) | `@spy4x/realtime` (new)   |
| A read cache behind a list read: replace on answer, answer from the copy when unreachable, show the copy first, and the time the copy was taken (`createDataCache` stores none today) | `@spy4x/realtime` on `createDataCache` (new) |
| A notice "saved copy from <time>" for a list shown from the device                      | preact-components (exists: `SavedCopyNotice`) |
| An offline-writable collection: cache plus outbox plus the overlay of queued entries on a list, from one adapter; several collections flushed in order under one lock, with the "waits for its parent" rule of section 5 | `@spy4x/realtime` on `createOutbox` (new) |
| The outbox, its IndexedDB store, the sync runner, the data cache                        | ts-libs (exist)                        |
| `SyncStatus`, `ConflictChooser`                                                         | preact-components (exist)              |
| Three bugs this depended on, all fixed in ts-libs 1.56.0: the pull on the first open (ts-libs#399), an outbox event inside a transaction (ts-libs#367), nested error bodies in `apiFetch` (ts-libs#452) | ts-libs |
| `modules.ts`, each aggregate's adapter and wording, the level table above               | the template                           |

## Consequences

- ADR 002's sentence "The SPA is not usable with the socket blocked" stops being true, on purpose.
- Notes move onto the shared layer with no change a person can see; the existing offline e2e specs
  must pass unchanged. Queued writes already on a device keep their database name and shape.
- A new aggregate chooses a level and lists its operations; `docs/aggregates.md` and
  `docs/offline.md` gain the recipe for each level and both transports.
- Every list now costs storage on the device and one more thing to clear at sign-out. More kinds of
  data sit on a device than before (members, tokens, devices, the plan), which is why section 4
  closes the gap of a session that ended while the app was closed. A shared browser still holds
  one thing after sign-out: the unsent writes of the person who left, by design.
- The per-command session routes for notes and groups go away once the call route serves them.
- The call route is a second way in to every operation. It is covered by the same gates, and the
  transport test runs every scenario through it, so the cost is one more adapter to keep thin.
- A timer pull costs requests that the socket avoided. It runs only while a tab is visible and
  only in an app that has no socket module.

## Not decided here

- **Switching the selected group with no network.** It needs a rule for a setting that two devices
  change in opposite ways. Until then a person offline reads the group that was selected when the
  connection dropped.
- **Delta pulls.** See "Local data" above.
- **Moving the REST-only aggregates into the operations table.** Each moves when it needs to.

## Maintenance

Architecture owners review this record. If the ports, the level of an aggregate, or the home of a
piece changes, add a new ADR and mark this one superseded; do not rewrite accepted history.
