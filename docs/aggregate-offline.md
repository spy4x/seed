# Make an aggregate work offline

> Also on the website: [seedsaas.com/docs/aggregate-offline](https://seedsaas.com/docs/aggregate-offline).

This page makes an aggregate readable, or writable, with no network. It extends step 7 of
[the aggregate reference](aggregates.md#7-spa-wiring-appsspasrc).

You need:

- An aggregate with a working store ([Add your first feature](first-feature.md)).
- The level it needs. [ADR 003](decisions/003-swappable-transport-and-local-data.md), section 4,
  sets the levels, and [offline-data.md](offline-data.md#the-three-levels) lists where every list
  stands.

## Level 1: online only

Write the store and nothing else. With no network, its read fails and the screen shows the error.

## Level 2: offline-readable

The default for a list. The device keeps the last answer and shows it when the server cannot be
reached. `apps/spa/src/state/members.ts` is the example.

1. Add the list's key to `READ_KEYS` in `state/read-keys.ts`. The key names everything the answer
   depends on: the group, and the cursor when the list is paged.
2. Give the store's factory a `device: LocalReads = noLocalReads` parameter. Pass `localReads` from
   `modules.ts` where the page builds the store.
3. Read through the copy: `device.through(key, read, early)`.
4. Add the list to `CASES` in `state/device-copies.test.ts`.

`read` must throw for a refusal, so only an unreachable server is answered by the copy. Wrap a
result object's failure in `ReadRefused`. `early` paints the copy while the screen has nothing to
show. It returns `false` when it painted nothing, and takes the copy back when called with
`undefined`.

The one `CASES` entry tests five promises of a level 2 list:

- The copy answers an unreachable server.
- Every answer from the server replaces the copy.
- The copy never hides a refusal.
- Nothing is kept while the module is off.
- The copy shows before the server has answered.

**A list that can mislead when old**, such as one that lists access, also says it is a saved copy.
The store exposes `savedAt` (`fresh ? null : savedAt`). The screen renders `SavedCopyNotice` from
`@spy4x/preact-system` always, with a title that names the list. `libs/ui/api-tokens.tsx` is the
example.

## Level 3: offline-writable

Only for an aggregate a person must change with no network. It costs a conflict screen.

1. Copy `offline/notes-collection.ts`. It is one `defineCollection` with the aggregate's commands,
   its error codes (`classifyByCode`), the wording of its failures and its device copy.
2. Add it to the `collections` list in `offline/index.ts`.
3. Wrap the store's dependencies as `offlineNotes` does.
4. Copy `offline/notes-collection.test.ts`.

The queue, the keys, the lock and the conflict rules come from `@spy4x/realtime/collections`; do
not write them again. The device copy is a view over the changes copy (`offline/device-copy.ts`).
Its `clear` ends the database, so a write in flight at sign-out cannot put the data back.

## Take part in the changes pull

A level 3 aggregate is read by the changes pull: a device asks only for what changed since its
cursor ([offline-data.md](offline-data.md#notes-and-tags-the-changes-pull)). Notes and tags take
part; copy them.

1. **Server.** Write a `ChangesAggregate` beside the repository, as
   `libs/server/notes/note-changes.ts` does. It has a `kind` and two queries. `sequences` reads the
   live rows' `change_sequence` after the cursor. `rows` reads the rows in `(after, through]`, in
   the list's shape. Add it to `CHANGES_AGGREGATES` in `apps/api/services/db-base.ts`.
2. **Tombstones.** A write that makes a row leave the group, such as a delete or a move away, calls
   `recordTombstones` (`libs/server/groups/group-changes.ts`) in its own transaction. A write that
   moves every row at once calls `forgetChangesBefore` instead. A deleted row's content never
   reaches a device.
3. **SPA.** Add the kind to `ChangesRows` and `CHANGES_KINDS` in `offline/device-copy.ts`, with an
   arktype schema of its row and a view over the copy. The collection's list read calls
   `pullOrKeep`, then reads the view.
4. **Tests.** Add a case to `tests/integration/group-changes.integration.test.ts` for its rows and
   tombstones, and one to `offline/device-copies.test.ts` for the view.

## Next

- [Offline](offline.md): the whole local data layer, and how to remove it.
- [Link two aggregates](aggregate-relations.md)
