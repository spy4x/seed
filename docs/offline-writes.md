# How offline writes sync

> Also on the website: [seedsaas.com/docs/offline-writes](https://seedsaas.com/docs/offline-writes).

This page explains how a note or tag written with no network reaches the server, and what the
person sees when the server refuses it.

## Writes: the outbox

A note or tag create, edit or delete goes into a queue, the outbox, in IndexedDB. It is sent at
once when the server can be reached, over the socket or HTTP. Otherwise it waits, and the list shows
the change with a "waiting to sync" line.

The queue and its rules come from `@spy4x/realtime/outbox`. The SPA keeps one queue per user and
aggregate: `offline:user:<id>:outbox` for notes and `offline:user:<id>:tags-outbox` for tags.

The queue is sent:

- when the layer starts;
- when the browser comes back online;
- when the tab becomes visible or the window gains focus;
- after a failed run, waiting longer each time;
- before every read.

Its rules:

- **Idempotency.** Each entry carries its own idempotency key, so a send repeated after a dropped
  connection runs once. The server keeps keys for 7 days. An older replay shows as a conflict, never
  as a silent duplicate.
- **One entry per note.** A second edit before the send replaces the first. Create then delete
  before any send sends nothing.
- **A new key after an unknown outcome.** An edit made after a send whose result is unknown gets a
  new key. Otherwise the server would answer the old key with the first result and drop the new
  text.
- **Order.** Entries go out in the order they were made. The run stops at the first one that cannot
  reach the server.
- **Base version.** An edit or delete carries the version the note had when the edit began. The
  server refuses it when the note moved on.
- **Undo.** Undo of an unsent delete takes it off the queue, with no network. Once the send started,
  Undo restores the note on the server.
- **Keeping the data.** The layer asks the browser to keep the site's storage, so a browser short of
  space, or Safari after a week, does not drop the queue.

**Tabs.** Every tab of a browser shares the queue. Each step holds a `navigator.locks` lock named
for the user, so tabs take turns. An entry is removed only if it still carries the key that was
sent, so another tab's newer edit stays queued.

**Users.** The queue is sent only while the page is signed in as its user. Every send names that
user, so the server refuses one whose cookie now belongs to someone else.

## Tags, and what a parent means

A note can name tags, so a tag is the **parent** of the notes that name it. Four rules from
[ADR 003](decisions/003-swappable-transport-and-local-data.md), section 5, keep that safe:

1. **Parents go first.** One flush sends every waiting tag write before any note write.
2. **A child waits for its parent.** A note that names a waiting tag is held back until the tag is
   sent. If the tag is in conflict, the note waits for the person's choice, and the sync line says
   so.
3. **A parent that will never exist loses its reference.** If a tag is withdrawn before it was sent,
   or refused for good, its id is taken off the queued notes. The sync line says how many notes
   were changed.
4. **The server ignores tag ids it does not know.** The note write succeeds, and the answer lists
   the tags the note really has.

## Conflicts

When the server refuses a queued write, the entry stays in the outbox, marked as a conflict. The
notes screen shows both sides:

| Why                                 | What the person can do                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| The note changed on the server      | **Keep mine** sends their text on top, or **Use the server's** drops it.     |
| The note was deleted on the server  | **Use the server's** removes it locally. Their text stays until they choose. |
| The note was moved to another group | The same as deleted. The message says "deleted, or moved".                   |
| The server refused the write (role) | **Discard mine**.                                                            |

The server's side shows the server's copy of a changed note or tag. A deleted one reads "The note is
no longer in this group." Any other conflict without a copy reads "The server's version isn't
available."

A write made online that the server refuses is not queued. The notes screen shows "Someone changed
this note since you opened it." with "Load the latest version".

## Moving notes

Moving notes is never queued. A move needs edit rights in two groups, which the device cannot know.
Offline, the person sees "You need a connection to move notes."

A queued write does not follow a note someone moved meanwhile. It names the old group, the server
answers "not found", and it becomes a conflict. The person's text stays in the entry until they
discard it. A queued delete of a moved note is dropped silently.

## Next

- [Sign-out and the device's data](offline-sign-out.md).
- [How offline reads work](offline-data.md).
- [Offline in the SPA](offline.md).
