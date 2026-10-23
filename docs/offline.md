# Offline in the SPA

The SPA opens with no network, shows every list it last saw, lets a person add, edit and delete
notes, and sends those changes when the connection is back. A change the server cannot take is
shown as a conflict for the person to settle; nothing is overwritten on its own.

All of it lives in `apps/spa/src/offline/` and one file in `apps/spa/public/`. Everything else in
the SPA works without them ([how to remove the layer](#removing-the-layer)).

## How it works

| Piece                                       | What it does                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `offline/notes-collection.ts`               | The notes as one adapter for `@spy4x/realtime/collections`: their commands, error codes, wording and device copy. The queue, its rules and the overlay of queued writes on a list are the library's. |
| `offline/notes-cache.ts`                    | The device copy of the notes, per group, for one signed-in user (`createDataCache`). |
| `state/read-keys.ts`                        | The key of every offline-readable list in the read cache (`@spy4x/realtime/read-cache`). |
| `offline/OfflineStatus.tsx`                 | Binds the queue to `SyncStatus` (offline, waiting, syncing, failed with Retry) and `ConflictChooser` (each conflict, with "Keep mine" and "Use the server's"), both from `@spy4x/preact-system`. |
| `install.ts`                                | `createInstallPrompt` from `@spy4x/preact-signals`; `app.tsx` renders `InstallPrompt` from `@spy4x/preact-system` for it.     |
| `modules.ts` (`signedInHint`)               | Remembers who was signed in, so an offline start does not show the sign-in page: `createSignedInHint` from `@spy4x/platform/browser/signed-in-hint`, under the `localStorage` key `offline:session`. It is a hint for what to show, never a credential. |
| `offline/index.ts`                          | Starts and stops the layer for a user: the read cache, the notes copy and the queue. It is given the calls port and sends the queue through it. |
| `sw.ts`, `sw-options.ts`                    | The service worker: the app's page, scripts and styles cached by `installOfflineShell`, and the push handlers.            |

### The three levels

Every aggregate is at one of three levels
([ADR 003](decisions/003-swappable-transport-and-local-data.md), section 4). The level says what
the device keeps for it, and [aggregates.md](aggregates.md#choosing-the-offline-level) has the
recipe for each.

| Level                | What works with no network                         | Which lists                                                                                                                              |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Online only       | Nothing: the screen says the server is unreachable | Deleted notes and deleted groups, sign-in, two-factor set-up, every write except a note's or a tag's                                                |
| 2. Offline-readable  | The last list the server sent                      | Groups, members, invitations, notifications and the bell's count, activity, the overview's widgets, the profile's push devices, billing, API tokens, signed-in devices |
| 3. Offline-writable  | The last list, and create, edit and delete         | Notes, tags                                                                                                                              |

### Reads: the device first

Every read is a full read of the server's answer, whether at start-up, after a reconnect or after a
pushed hint ([ADR 002](decisions/002-realtime-transport-and-sync.md), "Push with sequence, pull as
the authority"). The local-data module sits behind that read. A level 2 store reads its list
`through` a key of `localReads` (`apps/spa/src/modules.ts`), which is `cachedRead` from
`@spy4x/realtime/read-cache` over one IndexedDB database per user (`reads:<id>`):

- When the server answers, the answer replaces the copy under that key. For notes, the queued
  writes are then applied on top of it.
- When the server cannot be reached (`fetch` rejects, or a call ran out of tries), the copy answers
  instead. An answer with an error status is not a network failure: it is shown as the error it is,
  and a copy the screen had painted is taken back. The one exception is an answer taken for the
  proxy's ([which answers count as "unreachable"](#which-answers-count-as-unreachable)).
- When a screen opens with nothing to show, it paints the copy at once and replaces it when the
  read answers, so a slow connection does not show an empty list.
- Search and filters run over the list the store holds, so they work the same on a copy.

Because the copy is replaced by every full read, it cannot drift from the server: the read that
runs after a reconnect is the same read that heals the store.

API tokens and signed-in devices can mislead when they are old (a token revoked or a device signed
out elsewhere is still listed), so when their list comes from the device the section says so, with
the time the copy was saved. A name the person just changed is never replaced by the profile's
older copy.

### Writes: the outbox

The queue and its rules are not in this repository: they are the outbox of
`@spy4x/realtime/outbox` (one entry per entity, a new key after an unknown outcome, keys that must
still match before an entry is cleared, one writer at a time, conflicts left to a person).
`@spy4x/realtime/collections` puts one queue behind any number of aggregates;
`offline/notes-collection.ts` supplies what is about notes, and `offline/notes-collection.test.ts`
checks those rules through it. The queue is kept by `createIndexedDbOutboxStore` from
`@spy4x/realtime/outbox-indexeddb`, in its own IndexedDB database per user
(`offline:user:<id>:outbox`); the notes the server last sent are kept by `createDataCache` from
`@spy4x/platform/browser/data-cache` (`offline:user:<id>:notes`). The name of the queue's database
and the shape of its entries are unchanged from the version before the collections layer, so a write
queued by that version is sent by this one (`offline/index.test.ts` and `e2e/local-data.e2e.ts` open
such a queue). That version kept the groups in `offline:user:<id>:groups`; the layer moves them into
the read cache at its first start and deletes that database. A device that ran the earlier Dexie
version keeps its old `offline:user:<id>` database, which is no longer read: a write still queued
there is not sent.

A note create, update or delete is saved in the outbox, in IndexedDB, then sent at once if the
server can be reached as its user, over the socket or over HTTP. If it cannot, the entry waits, and
the person sees the change in the list with a "waiting to sync" line. The sync runner
(`createSyncRunner` from `@spy4x/realtime/sync-runner`) sends the queue when the layer starts, when
the browser comes back online, when the tab becomes visible or the window gains focus, and again
after a failed run, waiting longer each time. `App` also sends the queue in order before every read,
and the read runs after every reconnect and after every pushed hint.

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

### Tags: the second offline-writable aggregate, and what a parent means

Tags (`offline/tags-collection.ts`) are offline-writable like notes: they have their own device
copy (`offline:user:<id>:tags`) and their own queue (`offline:user:<id>:tags-outbox`), and signing
out treats them exactly as it treats notes. A note can name tags, so a tag is the **parent** of the
notes that name it and the tags collection is declared before the notes one. Four rules from
[ADR 003](decisions/003-swappable-transport-and-local-data.md), section 5, keep that safe:

1. **Parents go first.** One flush sends every waiting tag write before any waiting note write, so a
   tag made offline reaches the server before the note that names it.
2. **A child waits for its parent.** A note that names a tag still waiting in the queue is held
   back until that tag is sent. If the tag is in conflict, the note waits for the person's choice,
   and the sync line says so ("A note is waiting for your choice about a tag below"). Nothing is
   lost.
3. **A parent that will never exist loses its reference.** If the person withdraws a tag that was
   never sent, or the server refuses it for good, the tag's id is taken off the queued notes that
   name it, the notes are sent without it, and the sync line tells the person how many notes it
   happened to.
4. **The server ignores ids it does not know.** A note write that names a tag the server has not
   got (or no longer has) succeeds, and the answer lists the tags the note really has. So an
   old id in a queued note can never block it.

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
device cannot know, so it is sent only while the server can be reached; offline, the person sees
"Moving notes needs a connection". A write queued for a note that someone moves meanwhile does
**not** follow it: the entry names the old group, the server answers "not found" there, and it
becomes a conflict instead of silently editing the note in a group the person never chose. The
person's text stays in the entry until they discard it; the note itself is found in its new group. A
queued delete of a moved note is dropped without a message, like a delete of a note already gone.
After a successful move the device files the moved notes under their new group.

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
that run against it need. The web manifest comes from `webManifest()` in the same file, written as
`manifest.webmanifest` and served by the dev server; `index.html` links it. The
worker's file must stay uncached by nginx (`apps/spa/nginx.conf`), or browsers would not see an
update.

**The specs that start the app with no network run against the built SPA.** These are
`e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts` and `e2e/search-offline.e2e.ts`; `deno task e2e:local`
gives them the image of `apps/spa/dockerfile.prod` behind the harness's proxy instead of the dev
server, in a Playwright pass of their own after the other specs' (`infra/scripts/e2e-local.sh`;
`e2e-local-plan.ts` next to it decides the passes). What a person runs offline is that build: a few
files named by hash, stored by the worker when it installs. The dev server serves a different page,
several hundred modules fetched one by one (`/src/…`, `/@fs/…`, `/@id/…`,
`/node_modules/.vite/deps/…`) and stored one by one as each is first fetched, so a pass or a failure
there says little about the deployed app.

The reason for the move is a failure seen only on the dev server (spy4x/template#322): in about one
run of the whole suite in two, a page opened with no network stayed blank, around the fourth offline
load of `e2e/local-data.e2e.ts`. The worker answered every request the page made with status 200,
then five to nine module scripts were aborted (`net::ERR_ABORTED`) within 10 ms and nothing
rendered. Every aborted URL was one only the dev server has. Its cause is not known. In October 2026
the spec that failed ran 18 times in a row on the dev server, and once more inside a run of the
whole suite, without a blank start, so nothing was caught that names what aborts the scripts. On the
built SPA it ran 40 times without one either. A page that fails to start now names its uncaught
errors, failed requests and console in the test's error (`gotoApp`, `e2e/fixtures/app.ts`); if a
blank start ever shows on the built SPA, that message is where to look first, and it is a bug in the
product, not in the harness.

Three more intermittent failures were reported on these specs in the same week (spy4x/template#322),
and none of them came back on the built SPA in October 2026:

- In `e2e/local-data.e2e.ts`, "the app with the local-data module switched off", the note list
  showed the old title after an edit, a save and a reload (2 in 6 runs on an early head of
  spy4x/template#367), or stayed empty for 5 s after that reload (2 in 10 runs, on the dev server).
  It passed 30 runs in a row on the built SPA and 30 on the dev server, and the whole spec 20 runs
  in a row on the built SPA. That reload was a plain `page.reload()` made online, which the
  harness's rule forbids (`docs/handoff.md`, trap 9): a network change on the machine, such as a
  container starting, aborts the page's module scripts, and the page stays blank with nothing in the
  report saying why. The reload now goes through `gotoApp`, which loads the page again in that case
  and otherwise names the page's errors and failed requests. That explains an empty list; it does
  not explain the old title, whose cause is not known.
- In `e2e/offline.e2e.ts`, the first test, the note list was empty after the offline reload (1 in
  55 runs on a branch). It passed 30 runs in a row, and the whole spec 20 runs in a row. Its cause
  is not known.

`SWUpdater` from `@spy4x/preact-system` already registered `/sw.js` for push notifications, so no
registration was added. The same worker answers its `skipWaiting` message when a visitor accepts
the "New version available" prompt. A person's first visit is online by definition; the app can go
offline after the worker installed, which is after that first load.

### Which answers count as "unreachable"

A list read is answered by its saved copy, with the time it was saved at, when the server is
unreachable. That is:

- no answer at all: no network, a connection that fails, a socket that is not open;
- an answer taken for one the API did not write: a 502, 503, 504 or any other 5xx, a 404 or a
  429, each without a reason in its body. The proxy in front of the API answers these for a few
  seconds while the API's container is replaced by a deploy.

The rule is the library's (`isForeignAnswer` in `@spy4x/realtime`, which the calls port follows
too), and it reads only the status and the code it is given. Every error of the API has one body
([api-errors.md](api-errors.md)); a REST read hands its `reason`, the feature's own code, to
`ReadRefused`. So a 404 with a reason is the API saying the thing is gone, and deletes the copy; a
404 without one is the proxy, and the copy both answers and stays. A 5xx with a reason is the
server struggling: the screen shows the error and the copy stays. The feature routes answer an error
they did not expect with 500 and the reason `INTERNAL_ERROR`; the calls route (`/api/call/<name>`)
and the socket answer theirs with the code `internal`. A 401 or a 403 is a
refusal with or without a code.

The notes and tags lists follow the same rule, although their copy is not in the read cache: their
REST reads throw the same typed refusal (`ReadRefused`, `@spy4x/realtime/read-cache`), so a
proxy's 502 shows the saved notes or tags with the queued writes on top, and a 401, a 403 or the
API's own 404 for a group deletes what the device kept of that group's notes or tags. The queue is
not touched.

Not every answer of the API carries a reason, and the page cannot tell those from a proxy's:

- the rate limiter's 429 and the auth routes' errors (the devices list is one of them) have none;
- an error that no route handled is a 500 with the code `internal` and no reason.

With a saved copy, the page shows the copy with its "saved at" time for these too, and not "Too
many requests" or the error. Nothing is deleted, and the next read asks the server again. When the
device holds no copy, every answer on this page shows as the error it is.

### Which answer at start signs the person out

The app asks `/api/auth/me` who is signed in before it renders. Only a 401 means nobody is: the app
shows the sign-in page and deletes what the device kept for the remembered person. Every other
error answer (a proxy's 502 or bare 404 during a deploy, a 403, a 500, a 429) says nothing about
the session. Neither does a 2xx without a profile, such as a maintenance page or an empty body, nor
no answer at all: the app opens as the remembered person on their saved copy, and the first call
the server answers with `unauthorized` or 401 signs the page out. With nobody remembered (a first
visit, or the local-data module switched off) the sign-in page shows.

### Signing out

Signing out deletes every read copy (the `reads:<id>` database's entries and the notes) and the
remembered user. While signed in, a list's copy is also deleted when the server refuses that read
with 401, 403 or its own 404 (see above): the person lost access, or the thing is gone, and the copy
must not come back offline later. An answer that says nothing about access keeps the copy: a 500, a
timeout, or no network at all, since the server may well accept the same read a moment later. A
start that finds no session (the server answers 401, because the session ended elsewhere or
expired) does the same for the person the device remembered, before the sign-in page shows.

An answer still on its way at sign-out is not saved in this tab. Each copy is finished by its
deletion: the read cache (`ReadCache.clear`), and the notes copy and the tags copy, whose `clear`
(`offline/notes-cache.ts`, `offline/tags-cache.ts`) calls the library's `DataCache.finish`. A
finished copy stores nothing afterwards, whether the late write is a list read, a note being
opened, or the server's answer to a queued write that was being sent. The next sign-in opens new
copies. `offline/device-copies.test.ts` checks this on IndexedDB.

The person is forgotten at once; their copies take IndexedDB a moment. So before a deletion starts,
the user's id is written to a second `localStorage` key, `offline:owed-deletion`, and removed only
after the device has deleted the copies. A page that closes in between, or a device that refuses to
delete (the app logs a warning), leaves the id there. Every start deletes what is owed first: a
start with no session before the sign-in page shows, a signed-in start before the device copy is
opened. A person whose own copies the device still cannot delete works against the server alone for
that visit.

**Signing out deletes everything the app keeps in this browser** (#206). The owner decided on
2026-10-18: "when a user signs out - delete everything from local storage and local db. Simple as
that." Once the page settles with nobody signed in (the account menu's sign-out, a start whose
session ended with a 401, a sign-out by the server), `wipeDevice` in `modules.ts` deletes every
IndexedDB database of the app, the queue of unsent writes (`offline:user:<id>:outbox` and
`:tags-outbox`) and the old Dexie `offline:user:<id>` database included, every `localStorage` key
but a few, and all of `sessionStorage`. A write still in the queue is lost; the dialog below says
so first. What the server owns (the notes, the preferences, the selected group) comes back at the
next sign-in. The keys a sign-out keeps (`KEPT_KEYS`) hold no person's data: `auth:sign-out-owed`
and `offline:owed-deletion`, the debts that finish the sign-out; `theme` and
`install-prompt-dismissed`, the device's own answers; and `last-sign-in`, the masked hint the
sign-in page shows (spy4x/template#142), which "Not you? Forget" drops. The databases go after the
deletions already queued, so a copy those finished is not opened again. A browser that refuses to
delete a database logs a warning, and the next signed-out start tries again.

A change of user on one device does the same for the person before. When a provider sign-in's
redirect brings another person's cookie to a page that never signed the last one out, the
remembered person's databases, their queue included, and the same `localStorage` and
`sessionStorage` keys are deleted before the new person's offline copy opens. A signed-in start
that still owes someone a deletion (a sign-out cut short by a closed page) deletes that person's
databases too before it opens the copy.

Signing out with no network, or while the server answers with an error, signs the page out at once
and records that a sign-out is owed to the server (`localStorage`, `auth:sign-out-owed`). The app
sends it first thing at the next start, before asking who is signed in, and again when the browser
comes back online. The flag is cleared only when the server answers with success; while it is
unreachable or answers with an error (a proxy's 502 during a deploy), the person stays signed out
and the remembered user is not used. Signing in or completing the one-time code clears the flag.
Until the server accepts the sign-out, its session stays valid.

**Signing out with unsent changes asks first.** When the person signs out from the account menu
while the queue holds writes, the app does not sign out at once: `UnsentChangesDialog` from
`@spy4x/preact-system` asks, with the number of changes and the fact that signing out now deletes
them: "If you sign out now, they're deleted from this browser and never reach the server."
(`views/UnsentSignOut.tsx` passes these words). "Send, then sign out" (the focused primary) sends
the queue now and shows the wait in the same dialog: "Sending changes… 1 of 3 sent", "You're
offline. We'll send your changes when you're back online, then sign you out." (the button then reads
"Waiting…"), or "Couldn't reach the server. Trying again…" while the sync runner backs off. Once the
queue is empty, the sign-out goes on by itself. A write the server refused never sends by itself, so
it is counted apart; once only such writes are left, the button becomes "Review changes", which
closes the dialog and opens the notes page of their group, where the chooser is. "Sign out anyway"
signs out at once and deletes the queue with everything else; "Cancel", Escape and the backdrop keep
the person signed in. With an empty queue, or the module off, sign-out is immediate, as before. The
check is `watchUnsentChanges` in `modules.ts` (the counts and the wait are `offline/unsent.ts`);
`views/AppShell.tsx` asks it and `views/UnsentSignOut.tsx` draws the dialog. The two-factor step's
sign-out, a sign-out by the server (401) and "sign out other devices" never ask: no queue is open
there, or it is not this device that signs out.

## What is not offline

Every write except a note's or a tag's needs the server: creating a group, saving the profile,
inviting, revoking a token, signing a device out, two-factor set-up and sign-in. Deleted notes and
deleted groups are read from the server only. The selected group is switched offline only among
groups already on the device.

Every tab of one browser shares one queue in IndexedDB. Each step on the queue (saving an edit,
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
  page's own write run the cheap check (`createChangeCheck` in `apps/spa/src/state/pull.ts`): it
  reads the groups list and reads the open group's notes again only when that group's change
  sequence moved.
- **Local data:** `localReads` (the read copies of the level 2 lists), `offlineNotes` (the notes'
  copy and queue) and the offline status line. While the module is off `localReads` reads from the
  server and keeps nothing, so no store has a second code path. The queue is sent only
  while the calls port is reachable as its user (`canCallAs`): the page is signed in as them and
  the browser has a network.

### Switching a module off

`/config.json` carries two switches, `realtime` and `offline`. Both modules run unless the file
says `false`. In a deployment set `SPA_REALTIME=false` or `SPA_OFFLINE=false` for the `spa`
container (`infra/envs/.env.example`) and restart it; in development edit
`apps/spa/public/config.json`. `0` is read as `false` and `1` as `true`. Any other value is refused
with a warning in the browser's console and the module runs; the rest of the file, the error
tracker's address included, is read either way (`apps/spa/src/runtime-config.ts`).

With `realtime: false` the page opens no socket: it writes and reads over HTTP and sees another
person's change within about 30 seconds instead of at once. The e2e spec
`e2e/realtime-off.e2e.ts` runs the core flows this way and fails if a socket is opened. With
`offline: false` nothing is written to IndexedDB: no read copy, no notes, no queue, and no
remembered user. Every screen needs the network, and a note is written straight to the server. The
service worker still caches the app's files, so the page itself loads fast. The e2e spec
`e2e/local-data.e2e.ts` runs the core flows this way and fails if the page created an IndexedDB
database. Copies written before the switch was turned off are deleted at the next start, for the
person the device remembered and for anyone still owed a deletion; that person's unsent note writes
stay queued and are sent once, as below. A device with neither key in `localStorage` is not opened.

**A queue left while the module is off is sent once, then deleted.** At every signed-in start with
`offline: false`, the app looks for that person's queue databases (`offline:user:<id>:outbox` and
`offline:user:<id>:tags-outbox`) in `indexedDB.databases()`, without opening anything, so a device
with no queue still gets no database. When one is there, and the page can send as that person, the
writes go out in order (`offline/send-once.ts`), and the databases are deleted. A write that cannot
reach the server keeps the whole queue for the next start or the next time the browser comes back
online; the person sees nothing, because the writes are still safe on the device. A write the server
refused cannot be resolved with the module off, since there is no conflict screen: it is dropped,
and one warning that stays until dismissed says so, naming up to three:
`2 changes you made offline couldn't be saved: "Shopping list", "Trip plan".` A browser that cannot
list its databases keeps the queue.

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
updates. Do these steps. The guard test `tests/offline-removal.test.ts` fails when a file that
imports the layer is missing from this list.

1. Delete the folder `apps/spa/src/offline/`, and the files `apps/spa/src/sw-options.ts` and
   `apps/spa/src/sw-options.test.ts`.
2. In `apps/spa/src/sw.ts`, delete the `@spy4x/platform/browser/offline-shell` and `./sw-options.ts`
   imports and the `installOfflineShell(...)` call, and add back the one listener `SWUpdater` needs:
   `scope.addEventListener("message", (event) => { if (event.data?.action === "skipWaiting")
   scope.skipWaiting() })`. The push handlers stay.
3. In `apps/spa/src/modules.ts`, delete the `./offline/` imports and the "Local data" part of the
   file, the `startOfflineLayer` call in `startModules`, the `stopOfflineLayer` call in
   `forgetModules`, and the `offline` switch. Keep the `LocalReads` and `createLocalReads`
   re-export and `noLocalReads`, and make the last line of that part
   `export const localReads = noLocalReads`.
   The stores of the level 2 lists then read from the server and keep nothing, with no change to
   them or to their tests. `watchUnsentChanges` and the `UnsentWait` and `UnsentView` types go
   with that part; delete `sendLeftQueue`, its call in `startModules`, and the `databases` option.
4. In `apps/spa/src/app.tsx`, delete what came from that part: `bootstrapSession(recallUser)`
   becomes `bootstrapSession()` and loses its `wipeDevice` step; in the effect that remembers the
   user, drop `rememberUser` and call `clearBrowserStorage()` where it called `wipeDevice()`; drop
   the `flushOutbox` line of `reads`.
5. In `apps/spa/src/state/notes.ts`, delete the `currentLayer` and `offlineNotes` imports and
   export the store built from `onlineNotes` directly: `createNotesStore(onlineNotes)`. The
   optional `readLocal` dependency and its `showLocal` call can go with them.
6. In `apps/spa/src/state/tags.ts`, delete the `currentLayer` and `offlineTags` imports and export
   the store built from `onlineTags` directly: `createTagsStore(onlineTags)`. In
   `apps/spa/src/views/AppShell.tsx`, delete the `currentLayer` import and make the search's
   `deviceNotes` answer `[]`: with no copy, a search the server cannot answer finds nothing.
7. In `apps/spa/src/views/NotesView.tsx`, `apps/spa/src/views/NoteEditorView.tsx` and
   `apps/spa/src/views/TagsView.tsx`, delete the `OfflineStatus` import and element.
8. In `apps/spa/src/views/AppShell.tsx`, delete `useSignOut` and the `watchUnsentChanges` and
   `UnsentSignOut` imports, and pass `useSignOutNow()` as `onSignOut`. Delete
   `apps/spa/src/views/UnsentSignOut.tsx` and `apps/spa/src/views/UnsentSignOut.test.tsx`.
9. Delete the specs `e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts` and `e2e/search-offline.e2e.ts`
   (with their names in `OFFLINE_SPECS` of `infra/scripts/e2e-local-plan.ts`), the offline test in
   `e2e/tags.e2e.ts` (the one named "a tag made and renamed with no network..."), and this guard
   test with its clause in the `test` task in `deno.jsonc`: `tests/offline-removal.test.ts`. The
   unit tests of the layer lived in the folder and went with it.

The app then behaves as it did before the layer existed: reads and writes over the network only.
