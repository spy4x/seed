# How offline reads work

> Also on the website: [seedsaas.com/docs/offline-data](https://seedsaas.com/docs/offline-data).

This page explains what the SPA keeps on the device, how it reads with no network, and when it
treats the server as unreachable.

## The pieces

All of the layer lives in `apps/spa/src/offline/`. The queue, its rules and the read cache come
from the shared library `@spy4x/realtime`.

| Piece                         | What it does                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `offline/index.ts`            | Starts and stops the layer for a user: the read cache, the notes and tags copy, the queues. |
| `offline/device-copy.ts`      | The device copy of every group's notes and tags, kept by the changes pull.                  |
| `offline/notes-collection.ts` | The notes' commands, error codes and wording for the shared queue.                          |
| `offline/tags-collection.ts`  | The same for tags.                                                                          |
| `offline/OfflineStatus.tsx`   | The sync line (offline, waiting, syncing, failed with Retry) and the conflict chooser.      |
| `state/read-keys.ts`          | The key of every offline-readable list in the read cache.                                   |
| `modules.ts`                  | The composition root: decides which modules run, and remembers who was signed in.           |
| `sw.ts`, `sw-options.ts`      | The service worker that caches the app's files ([the app shell](offline-app-shell.md)).     |

The remembered user (`localStorage` key `offline:session`) only decides what to show at an offline
start. It is never a credential.

## The three levels

Every aggregate is at one of three levels
([ADR 003](decisions/003-swappable-transport-and-local-data.md), section 4). The level says what
the device keeps. [aggregates.md](aggregates.md#choosing-the-offline-level) has the recipe for each.

| Level               | What works with no network                         | Which lists                                                                                                                                              |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Online only      | Nothing: the screen says the server is unreachable | Deleted notes and groups, sign-in, two-factor set-up, every write but a note's or a tag's                                                                |
| 2. Offline-readable | The last list the server sent                      | Groups, members, invitations, notifications and the bell's count, activity, the overview's widgets, push devices, billing, API tokens, signed-in devices |
| 3. Offline-writable | The last list, and create, edit and delete         | Notes, tags                                                                                                                                              |

The selected group can be switched offline only among groups already on the device.

## The modules and their switches

Two parts of the SPA are optional modules
([ADR 003](decisions/003-swappable-transport-and-local-data.md)): the WebSocket module
(`apps/spa/src/realtime/`) and the offline layer. Only `apps/spa/src/modules.ts` imports them.
Every store and view takes its ports from that file. `tests/realtime-removal.test.ts` and
`tests/offline-removal.test.ts` fail when another file imports a module's folder.

`modules.ts` offers three ports:

- **Calls:** `callCommand` and `callQuery`, such as `note.create`. A call goes over the socket while
  it is open, otherwise to `POST /api/call/<name>`. A socket that drops mid-call is retried over
  HTTP with the same idempotency key. An `unauthorized` answer signs the page out.
- **Changes:** what triggers a fresh read. An open socket sends hints. Without one, the page reads
  on start, back online, when the tab shows again, after its own write, and every 30 seconds while
  visible. That check (`createChangeCheck`, `state/pull.ts`) reads the open group's notes only
  when the group's change sequence moved.
- **Local data:** `localReads` (the level 2 copies), `offlineNotes` and the sync line. With the
  module off, `localReads` reads from the server and keeps nothing, so no store has a second code
  path.

To turn a module off or remove it, see [offline.md](offline.md#switching-a-module-off).

## Reads: the device first

Every read is a full read of the server's answer
([ADR 002](decisions/002-realtime-transport-and-sync.md), "Push with sequence, pull as the
authority"). A level 2 store reads its list through a key of `localReads`. That is `cachedRead`
from `@spy4x/realtime/read-cache`, over one IndexedDB database per user (`reads:<id>`).

- **The server answers:** the answer replaces the copy. For notes, the queued writes are applied on
  top.
- **The server is unreachable:** the copy answers instead, with the time it was saved.
- **The server answers with an error:** the screen shows the error, and a painted copy is taken
  back.
- **A screen opens with nothing to show:** it paints the copy at once, then the read replaces it.

Search and filters run over the list the store holds, so they work the same on a copy. Every full
read replaces the copy, so it cannot drift from the server.

API tokens and signed-in devices say when their list comes from the device, with the time it was
saved. Old copies of those can mislead: a revoked token is still listed.

## Notes and tags: the changes pull

A group can hold tens of thousands of notes, so notes and tags are pulled, not read in full. One
IndexedDB database per user (`offline:user:<id>:changes`) holds each group's notes, tags and the
change sequence the copy is complete through. A read asks for the changes after that sequence
(`group.changes`, or `GET /api/groups/:groupId/changes?after=<sequence>`), applies them, and
answers from the copy.

- **Pages.** One page holds up to 500 changes and never splits a sequence. Deleted or moved rows
  come as tombstones (`{ kind, id }`). The device asks again until `more` is false.
- **Tombstones** are kept for 90 days. A cursor older than that, or past the group's sequence after
  a restore, is answered "too old", and the device reads the group in full from `0`.
- **The device's own writes.** The server's answer to a write goes into the copy at the group's
  current cursor, never past it. Another member's change still arrives with the next pull.
- **Refusals.** A pull the server refuses (the person left, or the group is gone) deletes that
  group's copy. An unreachable server leaves the copy as it is.
- **Tabs.** One pull at a time across the browser's tabs (`navigator.locks`).

Without the layer, the notes store pages the REST list (`/api/groups/:groupId/notes`) instead.

## Which answers count as "unreachable"

The copy answers when there is no answer at all: no network, a failed connection, a closed socket.
It also answers for a 5xx, 404 or 429 without a `reason` in its body. The proxy in front of the API
answers those for a few seconds during a deploy.

The API's feature routes put a `reason` in every error ([api-errors.md](api-errors.md)):

| Answer               | What the screen does                    |
| -------------------- | --------------------------------------- |
| 404 with a reason    | The thing is gone: the copy is deleted. |
| 404 without a reason | The proxy: the copy answers and stays.  |
| 5xx with a reason    | The error shows, and the copy stays.    |
| 401 or 403           | A refusal: the copy is deleted.         |

The rule is `isForeignAnswer` in `@spy4x/realtime`. The rate limiter's 429 and the auth routes'
errors carry no reason, so with a saved copy, those show the copy too.

## Next

- [How offline writes sync](offline-writes.md).
- [Sign-out and the device's data](offline-sign-out.md).
- [Offline in the SPA](offline.md): turn it off or remove it.
