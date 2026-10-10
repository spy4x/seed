# Offline in the SPA

The SPA opens with no network, shows the notes it last saw, lets a person add, edit and delete
notes, and sends those changes when the connection is back. A change the server cannot take is
shown as a conflict for the person to settle; nothing is overwritten on its own.

All of it lives in `apps/spa/src/offline/` and one file in `apps/spa/public/`. Everything else in
the SPA works without them ([how to remove the layer](#removing-the-layer)).

## How it works

| Piece                                       | What it does                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `offline/local-store.ts`                    | Opens, for one signed-in user, the data cache (`createDataCache`) holding the last notes and groups the server sent, and the IndexedDB outbox store (`createIndexedDbOutboxStore`). |
| `offline/notes-outbox.ts`                   | Puts the notes (commands, error codes, wording, local store) behind the outbox of `@spy4x/realtime/outbox`, and applies queued writes to a list. |
| `offline/notes-offline.ts`, `groups-offline.ts` | Wrap the notes and groups stores' dependencies: reads keep and serve the local copy, note writes go through the outbox. |
| `offline/OfflineStatus.tsx`                 | Binds the queue to `SyncStatus` (offline, waiting, syncing, failed with Retry) and `ConflictChooser` (each conflict, with "Keep mine" and "Use the server's"), both from `@spy4x/preact-system`. |
| `install.ts`                                | `createInstallPrompt` from `@spy4x/preact-signals`; `app.tsx` renders `InstallPrompt` from `@spy4x/preact-system` for it.     |
| `offline/session-cache.ts`                  | Remembers who was signed in, so an offline start does not show the sign-in page.                                          |
| `offline/index.ts`                          | Starts and stops the layer for a user. It is given the calls port and sends the queue through it.                         |
| `sw.ts`, `sw-options.ts`                    | The service worker: the app's page, scripts and styles cached by `installOfflineShell`, and the push handlers.            |

### Reads: the device first

The notes and groups stores are unchanged in what they do: every read is a full read of the
server's answer, whether at start-up, after a reconnect or after a pushed hint
([ADR 002](decisions/002-realtime-transport-and-sync.md), "Push with sequence, pull as the
authority"). The offline layer sits behind that read:

- When the server answers, the whole answer replaces the group's local copy, and the queued
  writes are applied on top of it.
- When the network is down (`fetch` rejects), the local copy answers instead. An answer with an
  error status is not a network failure and is shown as the error it is.
- When a screen opens, the stores show the local copy at once and replace it when the read
  answers, so a slow connection does not show an empty list.

Because the local copy is replaced by every full read, it cannot drift from the server: the read
that runs after a reconnect is the same read that heals the store.

### Writes: the outbox

The queue and its rules are not in this repository: they are the outbox of
`@spy4x/realtime/outbox` (one entry per entity, a new key after an unknown outcome, keys that must
still match before an entry is cleared, one writer at a time, conflicts left to a person).
`offline/notes-outbox.ts` supplies what is about notes, and `offline/notes-outbox.test.ts` checks
those rules through it. The queue is kept by `createIndexedDbOutboxStore` from `@spy4x/realtime/outbox-indexeddb`, in its
own IndexedDB database per user (`offline:user:<id>:outbox`); the notes and groups the server last
sent are kept by `createDataCache` from `@spy4x/platform/browser/data-cache`
(`offline:user:<id>:notes` and `:groups`). A device that ran the earlier Dexie version keeps its
old `offline:user:<id>` database, which is no longer read: a write still queued there is not sent.

A note create, update or delete is saved in the outbox, in IndexedDB, then sent at once if the
server can be reached as its user, over the socket or over HTTP. If it cannot, the entry waits, and the person sees the change in the list with a
"waiting to sync" line. The sync runner (`createSyncRunner` from `@spy4x/realtime/sync-runner`) sends the queue when the layer
starts, when the browser comes back online, when the tab becomes visible or the window gains focus, and
again after a failed run, waiting longer each time. `App` also sends the queue in order before every read, and the read runs after
every reconnect and after every pushed hint.

- **Idempotency.** Every entry carries its own idempotency key, sent with the command, so a send
  that is repeated after a dropped connection runs once
  ([ADR 002](decisions/002-realtime-transport-and-sync.md), "Idempotency"). The server keeps keys
  for 7 days. A write older than that can still be sent: a replayed create answers "id already
  exists" and a replayed update answers a version conflict, and both show as conflicts, not as
  silent duplicates.
- **One entry per note.** A second edit of a note that was not sent yet replaces the first, so
  the queue holds what the person wants the note to be. Create then delete before any send sends
  nothing. An edit made after a send whose outcome is unknown gets a new key: the server would
  answer the old key with the first result and drop the new text. If that first send had been
  applied, the result is a conflict the person can see, not a lost edit.
- **Order.** Entries go out in the order they were made, and the loop stops at the first one that
  cannot reach the server.
- **Base version.** An update or delete carries the version the note had when the person started
  the edit. The server rejects it when the note moved on.
- **Undo.** Undo after a delete first asks the outbox to take the delete back (`withdraw`). When the
  delete has not been sent, it is removed from the queue and the note is shown again, with no
  network and no call to the server. Once a send has started, Undo restores the note on the
  server, which needs a connection.
- **Keeping the data.** When the layer starts it asks the browser to keep the site's storage
  (`requestPersistentStorage`), so a browser short of space, or Safari after a week of no visits,
  does not drop the queue.

### Conflicts

When the server refuses a queued write, the entry stays in the outbox marked as a conflict, and
the notes screen shows both sides:

| Why                                | What the person can do                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| The note changed on the server     | **Keep mine** sends the person's text on top of the server's version, or **Use the server's** drops it. |
| The note was deleted on the server | **Use the server's** removes it locally. The person's text stays on the screen until they choose. |
| The note was moved to another group | The same as deleted: the old group has no such note, so the entry is a "gone" conflict whose message says "deleted, or moved". |
| The server refused the write (role) | **Discard mine**.                                            |

**Moving notes is never queued.** A move names two groups and needs edit rights in both, which the
device cannot know, so it is sent only while the server can be reached; offline, the person sees "Moving
notes needs a connection". A write queued for a note that someone moves meanwhile does **not**
follow it: the entry names the old group, the server answers "not found" there, and it becomes a
conflict instead of silently editing the note in a group the person never chose. The person's text
stays in the entry until they discard it; the note itself is found in its new group. A queued
delete of a moved note is dropped without a message, like a delete of a note already gone. After a
successful move the device files the moved notes under their new group.

A write made online that the server refuses is not queued: the notes store shows it as before
(the "Someone changed this note" message and "Load the latest version").

### The app shell

`src/sw.ts` calls `installOfflineShell` from `@spy4x/platform/browser/offline-shell`, with the
options in `src/sw-options.ts`. On install it stores `/`, `/config.json` and every script, style and
image the page names. After that:

- files under `/assets/` (a build names them by content hash, so a copy is never stale) are
  answered from the cache first;
- every other request, the page itself included, goes to the network first and is answered from
  the cache only when the network fails, so a deploy, and an edit under the dev server, show at
  once. Every route is the same page, so any page load is stored and served under `/`. That
  includes `/config.json` (the runtime settings the app reads before it renders, `docs/stack.md`),
  which is also stored on install, so the app starts offline;
- `/api` and `/ws` (the route Traefik sends to the API) are never touched; an e2e test checks that
  no cached URL starts with either.

The cache is named `shell-<build id>`. The build id is a hash of every built file, so a deploy gives
the worker a new name and new bytes, and the old cache is deleted when the new worker activates.

A browser cannot load a worker that imports a `jsr:` specifier, so `serviceWorker()` from
`@spy4x/preact-theme/vite` (in `vite.config.ts`) bundles `src/sw.ts` into one classic `dist/sw.js`
after the app build and defines `__BUILD_ID__`. On the dev server the same plugin serves the bundle
from memory at `/sw.js`, with the build id `dev` (since preact-theme 3.8.0), which the e2e specs
need. The web manifest comes from `webManifest()` in the same file, written as
`manifest.webmanifest` and served by the dev server; `index.html` links it. The
worker's file must stay uncached by nginx (`apps/spa/nginx.conf`), or browsers would not see an
update.

`SWUpdater` from `@spy4x/preact-system` already registered `/sw.js` for push notifications, so no
registration was added. The same worker answers its `skipWaiting` message when a visitor accepts
the "New version available" prompt. A person's first visit is online by definition; the app can go
offline after the worker installed, which is after that first load.

### Signing out

Signing out drops the cached notes and groups and the remembered user. The outbox stays: a write
that never reached the server is the person's work, and goes out the next time the same user signs
in on this browser. Those unsent note texts stay in IndexedDB on a shared device until that user
signs in again, so on a shared browser use the browser's own "clear site data". A device that ran
the earlier Dexie version also keeps its old `offline:user:<id>` database: signing out does not
clear it, so its cached notes stay on that device until the browser's "clear site data". Signing out with no
network, or while the server answers with an error, signs the page out at once and records that a
sign-out is owed to the server (`localStorage`, `auth:sign-out-owed`). The app sends it first thing
at the next start, before asking who is signed in, and again when the browser comes back online. The
flag is cleared only when the server answers with success; while it is unreachable or answers with
an error (a proxy's 502 during a deploy), the person stays signed out and the remembered user is not
used. Signing in or completing the one-time code clears the flag. Until the server accepts the
sign-out, its session stays valid.

## What is not offline

Creating a group, the profile, two-factor set-up and sign-in need the server. Every tab of one browser shares one queue in IndexedDB. Each step on the queue (saving an edit,
sending one entry) holds a `navigator.locks` lock named for the user, so tabs take turns. After a
send, the entry is removed, or marked a conflict, only if it still carries the key that was sent;
an edit another tab made meanwhile has a new key and stays queued. The queue sends only while the
browser has a network and the page is signed in as the queue's user. Every send names that user, so
the server refuses one whose cookie now belongs to someone else, and a refused entry stays queued
for its owner's next sign-in.

## The modules and their switches

Two parts of the SPA are optional modules
([ADR 003](decisions/003-swappable-transport-and-local-data.md)): the WebSocket module
(`apps/spa/src/realtime/`) and this offline layer (`apps/spa/src/offline/`). One file,
`apps/spa/src/modules.ts`, imports them and decides which run. Every store and view imports its
ports from that file and never from a module's folder; two guard tests,
`tests/realtime-removal.test.ts` and `tests/offline-removal.test.ts`, fail when another file does.

`modules.ts` offers three things:

- **Calls:** `callCommand` and `callQuery`. A call is a name and a payload (`note.create`). It goes
  to `POST /api/call/<name>` over HTTP, or over the socket while the WebSocket module runs and its
  socket is open; a socket that drops under a call is answered by sending the call over HTTP with
  the same idempotency key. Every call names the user the page was started for, and an
  `unauthorized` answer over either signs the page out.
- **Changes:** `startModules` starts what triggers the pull: the start, the browser back online,
  the tab shown again, the page's own write, and a timer every 30 seconds while the tab is visible.
  An open socket replaces those with its hints and reconnects, so the timer runs whenever the
  socket is not open: the module is off, or its socket is blocked or has dropped. The timer and the
  page's own write run the cheap check (`createChangeCheck` in `apps/spa/src/state/pull.ts`): it reads the groups
  list and reads the open group's notes again only when that group's change sequence moved.
- **Local data:** the device copy, the queue and the offline status line. The queue is sent only
  while the calls port is reachable as its user (`canCallAs`): the page is signed in as them and
  the browser has a network.

### Switching a module off

`/config.json` carries two switches, `realtime` and `offline`. Both modules run unless the file
says `false`. In a deployment set `SPA_REALTIME=false` or `SPA_OFFLINE=false` for the `spa`
container (`infra/envs/.env.example`) and restart it; in development edit
`apps/spa/public/config.json`.

With `realtime: false` the page opens no socket: it writes and reads over HTTP and sees another
person's change within about 30 seconds instead of at once. The e2e spec
`e2e/realtime-off.e2e.ts` runs the core flows this way and fails if a socket is opened. With
`offline: false` nothing is written to the device and every screen needs the network.

### Removing the WebSocket module

A product that never wants the socket deletes it:

1. Delete the folder `apps/spa/src/realtime/`.
2. In `apps/spa/src/modules.ts`, delete the `./realtime/index.ts` import and its uses: the
   `socket` option of `createAppCallPort`, the `if (switches.realtime)` branch of `startModules`,
   the `disconnectRealtime` calls, and the `realtime` switch. `advanceGroupCursor` becomes an empty
   function and `connectionDisplay` always answers `"idle"`.
3. Delete `tests/realtime-removal.test.ts` with its clause in the `test` task in `deno.jsonc`, and
   the e2e specs that test the socket itself (`e2e/groups-socket.e2e.ts`,
   `e2e/realtime-resume.e2e.ts`).

The API's socket route (`/api/ws`) can stay: a server with no socket clients sends its hints to
nobody.

## Removing the layer

A product that does not want offline deletes the layer and keeps an online SPA that still gets live
updates. Do these steps. The guard test `tests/offline-removal.test.ts` fails when a file that imports the
layer is missing from this list.

1. Delete the folder `apps/spa/src/offline/`, and the files `apps/spa/src/sw-options.ts` and
   `apps/spa/src/sw-options.test.ts`.
2. In `apps/spa/src/sw.ts`, delete the `@spy4x/platform/browser/offline-shell` and `./sw-options.ts`
   imports and the `installOfflineShell(...)` call, and add back the one listener `SWUpdater` needs:
   `scope.addEventListener("message", (event) => { if (event.data?.action === "skipWaiting") scope.skipWaiting() })`.
   The push handlers stay.
3. In `apps/spa/src/modules.ts`, delete the `./offline/` imports and the "Local data" part of the
   file, the `startOfflineLayer` call in `startModules`, the `stopOfflineLayer` call in
   `forgetModules`, and the `offline` switch.
4. In `apps/spa/src/app.tsx`, delete what came from that part: `bootstrapSession(recallUser)`
   becomes `bootstrapSession()`; drop the effect that remembers the user and the `flushOutbox`
   line of `reads`.
5. In `apps/spa/src/state/notes.ts` and `apps/spa/src/state/groups.ts`, delete the `currentLayer`,
   `offlineNotes` and `offlineGroups` imports, and export the store built from `onlineNotes` and
   `onlineGroups` directly: `createNotesStore(onlineNotes)`, `createGroupsStore(onlineGroups)`. The
   optional `readLocal` dependency and its `showLocal` call can go with them.
6. In `apps/spa/src/views/NotesView.tsx` and `apps/spa/src/views/NoteEditorView.tsx`, delete the
   `OfflineStatus` import and element.
7. Delete the spec `e2e/offline.e2e.ts`, and this guard test with its clause in the `test` task in
   `deno.jsonc`: `tests/offline-removal.test.ts`. The unit tests lived in the folder and went with
   it.

The app then behaves as it did before the layer existed: reads and writes over the network only.
