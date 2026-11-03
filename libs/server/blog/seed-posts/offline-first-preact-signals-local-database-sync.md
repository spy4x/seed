---
slug: offline-first-preact-signals-local-database-sync
language: en
title: "Offline-first with Preact signals: how Seed's local database syncs"
seoTitle: "Offline-first Preact app: how the local database syncs"
description: "How Seed's Preact app works offline: signals for the screen, IndexedDB for a copy of every list and a queue of writes, and a pull by change number that keeps both in step."
tldr:
  - Seed's app shows every list from IndexedDB first, then asks the server only for what changed since the last change number it holds.
  - Notes and tags can be written offline. Each write waits in a queue with its own idempotency key and goes out in order when the network is back.
  - A write the server refuses becomes a conflict you settle yourself. Nothing is overwritten behind your back.
  - The whole layer sits in one folder, behind one switch. A product that doesn't want it deletes the folder.
topic: Deep dive
author: Anton Shubin
publishAt: 2026-11-02T14:00:00Z
newsletter: false
---

How do you make a Preact app offline-first? In Seed it takes three pieces. Preact signals hold what
the screen shows. IndexedDB holds a copy of every list and a queue of writes. And a pull by change
number keeps that copy in step with Postgres. The app opens with no network, shows what it last
saw, lets you write and edit notes, and sends them when the connection is back.

This post is for developers who want that in their own SaaS and want to know where the sharp
edges are before they start. I'll show the moving parts, the rules that keep data safe, and the
bits I deliberately left online-only.

## What does "offline-first" mean here?

Not "everything works on a plane". That promise is how you end up with a sync engine bigger than
your product. Seed puts every part of the app at one of three levels
([ADR 003](https://github.com/spy4x/seed/blob/main/docs/decisions/003-swappable-transport-and-local-data.md)):

| Level               | What works with no network                  | Which parts                                                      |
| ------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| 1. Online only      | Nothing: the screen says the server is away | Sign-in, two-factor set-up, deleted notes, most writes           |
| 2. Offline-readable | The last list the server sent               | Groups, members, invitations, notifications, billing, API tokens |
| 3. Offline-writable | The last list, plus create, edit and delete | Notes and tags                                                   |

The rule behind the table fits in one sentence: every list a person works from is kept on the
device, only content is queued, and anything that changes who can see or do what needs the
server's answer first. Inviting someone offline and finding out a day later that it never
happened is worse than a clear "this needs a connection".

## Where do Preact signals fit in?

Every screen reads a store, and every store is a handful of signals. Here is the top of the notes
store, as it is in
[`apps/spa/src/state/notes.ts`](https://github.com/spy4x/seed/blob/main/apps/spa/src/state/notes.ts):

```ts
export function createNotesStore(dependencies: NotesDependencies) {
  const groupId = signal<string | null>(null)
  const notes = signal<readonly NoteItem[]>([])
  const loading = signal(false)
  const listError = signal<string | null>(null)
```

The store never knows whether a list came from the server or from the device. It gets its calls
through injected dependencies, and one file, `apps/spa/src/modules.ts`, decides what sits behind
them. When a screen opens with nothing to show, the store paints the device's copy at once and
swaps in the server's answer when it arrives. Search and filters run over the list the store
already holds, so they work the same with the network off.

That separation is the whole trick. Signals make the swap cheap: write the new array into
`notes.value` and only the parts of the screen that read it draw again. No reducer, no cache
library, no "is this stale?" flag in every component.

## How does the local copy stay in step with the server?

Most lists are small, so the app simply reads them again in full and replaces the copy. A copy
that is replaced by every read cannot drift.

Notes are different, because a group can hold tens of thousands of them. For notes and tags the
device keeps one IndexedDB database per user with each group's rows and the change number it is
complete through. Every write on the server bumps the group's change number. The device asks:

```http
GET /api/groups/:groupId/changes?after=1842
```

The answer holds every row changed after that number and a small tombstone (`{ kind, id }`, never
the content) for each row that was deleted or moved away. Pages hold at most 500 changes and
never split one change number, and the server reads each page in one `REPEATABLE READ` snapshot,
so a page cannot mix two moments. The device writes the rows and its new number in one IndexedDB
transaction: either both land or neither does.

Tombstones are kept for 90 days. A device that has been away longer, or a server restored from a
backup, gets "too old" and reads the group from zero. Slower, but always correct. Two tabs never
pull at once either: they take turns through `navigator.locks`.

The full story, with every edge case I hit, is in [docs/offline.md](/docs/offline).

## What happens to a note you write offline?

It goes into an outbox, a queue in its own IndexedDB database, and shows in the list at once with
a "waiting to sync" line. When the server can be reached again, the queue goes out in the order
you wrote it. Try it here: the figure starts offline, with one note already waiting.

<OfflineSyncDemo />

That is a model, of course. The real queue follows a few rules that took me longer to get right
than I'd like to admit:

- **Every entry carries its own idempotency key.** A send repeated after a dropped connection
  runs once on the server. The server keeps keys for 7 days.
- **One entry per note.** Edit a note twice before it is sent, and the queue holds only what you
  want the note to be now. Create and delete it before any send, and nothing is sent at all.
- **Order holds.** Entries go out in the order they were made, and the loop stops at the first
  one that cannot reach the server.
- **Tags go before the notes that name them.** A tag made offline reaches the server before the
  note that uses it, and a note waits while its tag is still queued.
- **The browser is asked to keep the data.** The layer calls `navigator.storage.persist()` through
  a small helper, so a browser short on space does not quietly drop your queue.

## What if someone else changed the same note?

Every edit carries the version the note had when you started typing. If the note moved on in the
meantime, the server refuses the write, and the entry stays in the queue marked as a conflict.
The notes screen shows both sides, with **Keep mine** and **Use the server's**. A note deleted on
the server is a conflict too, and your text stays on the screen until you choose.

I could have picked "last write wins" and saved a week. I would also have lost someone's text the
first time two people edited the same note on a train. Conflicts that a person settles are
boring, and boring is what I want from data.

## Can I turn it off?

Yes, two ways. Set `SPA_OFFLINE=false` for the app's container and it writes nothing to IndexedDB:
no copy, no queue, every screen needs the network. Or delete the layer for good: it lives in
`apps/spa/src/offline/`, and the removal steps are listed in the docs. A guard test,
`tests/offline-removal.test.ts`, fails if any file outside the list still imports the folder, so
you can't half-delete it by accident.

The same switch exists for the WebSocket. How the app stays correct without it is the next deep
dive: [Realtime over WebSocket, with HTTP as a fallback](/blog/realtime-websocket-with-http-fallback).

## Try it with your own network

Open the [live demo](https://app.seedsaas.com), start a guest account, then switch the network
off in your browser's developer tools. Write a note, edit it, switch the network back on, and
watch the line under the list. Then [read the code](https://github.com/spy4x/seed): it is all
MIT-licensed, and the offline layer is one folder.
