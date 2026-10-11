# Adding an aggregate

An aggregate is one kind of thing a product keeps, such as a note, an invoice or a task. This page
lists every file a new aggregate needs, in the order to write them, using **notes** as the worked
example. Copy the notes files, rename them, and change the fields and rules; do not invent a second
shape.

Notes are the reference because they touch every layer and hold no product rules: a note belongs to
one group, has a title, a body, who created and last changed it, and a version. Every member of the
group reads notes; an editor or above writes them.

## The rules every aggregate follows

- **It lives inside a group.** Groups are the only tenancy boundary, so every row carries a
  `group_id` and every check starts from the actor's membership of that group.
- **Authorization is in the handlers.** The REST route and the socket only parse and dispatch. The
  handler reads the actor's role and refuses before it touches anything, so both transports get the
  same answer from the same code (ADR 002, "Authentication, authorization, revocation").
- **Every write moves the group's change sequence** and writes an outbox row, in the same
  transaction as the write. The worker turns the outbox row into a hint on every member's socket,
  and their pages read again. Nothing else is needed for live updates.
- **Every command carries an idempotency key** over the socket, and **every update and delete names
  the version it saw**. A stale version is refused with a typed conflict that carries the current
  version, instead of overwriting a change the client never saw.
- **Screens are dumb: props in, callbacks out** (see "Three layers of UI" in `AGENTS.md`).

## The files, in order

### 1. Domain: `libs/domain/notes/`

| File           | What it holds                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `+lib.ts`      | The `Note` shape; the arktype request schemas (the REST bodies, which are also the form field names, and the socket payloads); `NoteError` and `NoteVersionConflictError`; the commands (`NoteCreateCommand`, `NoteUpdateCommand`, `NoteDeleteCommand`, `NoteMoveCommand`) and queries (`NoteListQuery`, `NoteGetQuery`); the outbox event kinds; the authorization rule; the `NoteRepository` port. |
| `+lib.test.ts` | The schemas and the authorization rule.                                                                                                                                                                                                                                                                                                                                                              |
| `deno.json`    | Makes it a workspace member.                                                                                                                                                                                                                                                                                                                                                                         |

Then register it in the root `deno.jsonc`: the `workspace` array (or its tests never run,
`docs/handoff.md` trap 1) and an `@domain/notes` import alias. Add its `deno.json` to the `COPY`
lines of `Dockerfile.base`; `tests/dockerfile-base.test.ts` fails until you do.

The authorization rule is two functions, `assertCanReadNotes(role)` and
`assertCanWriteNotes(role)`. A person who is not a member gets `GROUP_NOT_FOUND`, never "forbidden",
so a stranger cannot learn that a group exists.

### 2. Database: `libs/server/db/`

| File                                   | What it holds                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/2026_10_02_0001_notes.sql` | The `notes` table: `group_id`, the fields, `version`, `change_sequence` (the group sequence the note was last written at), who created and updated it, and `deleted_at` (a delete keeps the row). |
| `schema.sql`                           | The same table appended, so the snapshot matches the migrations.                                                                                                                                  |

Add the table to `SNAPSHOT_TABLES` and apply the migration in
`tests/integration/groups.integration.test.ts`, which compares the two. Compose applies migrations
on every start; nothing else is needed to deploy one.

### 3. Repository: `libs/server/notes/`

| File                          | What it holds                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postgres-note-repository.ts` | Reads and writes. Each write runs in a transaction that calls `recordGroupChange` (`libs/server/groups/group-change-log.ts`), which moves the group's sequence and writes the outbox row. It checks no role. |
| `note-list-cursor.ts`         | The signed paging cursor, bound to the user and the group, so a cursor cannot be replayed by someone else or on another group.                                                                               |
| `deno.json`                   | Workspace member; register it and add an `@server/notes/` alias like the domain.                                                                                                                             |

The version check is the `WHERE version = ${expected}` of the `UPDATE`. When no row matches, the
repository reads the note once more to tell "gone" (`NOTE_NOT_FOUND`) from "moved on"
(`NoteVersionConflictError` with the current version). A create retried with the same id and the
same content returns the first note instead of failing.

Expose it on `AppDbBase` in `apps/api/services/db-base.ts` as a getter built per access, like
`group` (trap 5: a cached repository escapes the transaction).

### 4. Handlers: `apps/api/features/notes/handlers.ts` and `apps/api/cqrs/`

`handlers.ts` holds one factory per command and query. Each reads the actor's role in the group,
runs the authorization rule, then calls the repository. The session gate on both buses has already
checked the session's strength.

`apps/api/cqrs/note-dependencies.ts` wires the handlers to `db.note` and to the membership read
(`db.group.getForMember`, always from Postgres). One file per handler under
`cqrs/command-handlers/` and `cqrs/query-handlers/` builds it, and `cqrs/+init.ts` registers it on
the bus. The idempotency middleware on the command bus needs nothing from you: a command whose data
carries an `idempotencyKey` runs once per user and key.

### 5. Transports: operations listed once, reached over the socket and the call route

| File                                    | What it holds                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/list.ts`       | One page of the list, with its cursor. Both transports call it, so they cannot drift apart.                                                                 |
| `apps/api/features/notes/operations.ts`     | The operations `note.create`, `note.update`, `note.delete`, `note.restore`, `note.move` (commands) and `note.list`, `note.get`, `note.locate` (queries): parse the payload, dispatch. `note.locate` finds the group of a note by its id alone, for a link to a note of another of the person's groups: it answers only a member, and `NOTE_NOT_FOUND` otherwise. |
| `apps/api/features/notes/errors.ts`     | REST error codes and statuses. A version conflict answers 409 with `currentVersion`.                                                                        |
| `apps/api/routes/notes.ts`              | `GET`, `POST`, `PATCH`, `DELETE` and `POST /:noteId/restore` under `/api/groups/:groupId/notes`, with the same-origin guard on writes and an optional `Idempotency-Key` header.         |
| `apps/api/services/note-list-cursor.ts` | The cursor codec, keyed from the cookie secret.                                                                                                             |

An aggregate lists its operations once, in `operations.ts`. Both transports serve that one list
through one dispatcher: the socket (`/api/ws`) and the call route, `POST /api/call/<name>`
(`apps/api/routes/call.ts`), which takes the payload as the JSON body and a command's key in the
`Idempotency-Key` header. Both refuse a call whose session is not the user the page names. A new
aggregate therefore writes no per-command REST route: it needs only its list (`GET`) route. Every
route under `/api` stands behind one check (`createApiApp` in `apps/api/app.ts`) that refuses a
request whose page names another user, and the SPA names its user on every request: its one REST
function, `apiFetch` in `apps/spa/src/state/api.ts`, sends each one through `apiAsUser`
(`tests/spa-reads.test.ts` fails when a store calls another way). The per-command routes of notes and groups in the table above are
older than the call route and are still used by the e2e specs to seed data; do not copy them.

Then wire them: mount the route in `apps/api/index.ts` (before `/groups`), add the operations
to the `Realtime` in `apps/api/services/realtimeHub.ts`, and map `NoteError` in `toRequestError`
(`apps/api/services/realtime.ts`), so the client gets `forbidden`, `not_found` or `conflict` with
the domain code (and the current version) in `details`.

The worker needs no change. A note's outbox row names the group as its aggregate and the group's
sequence as its version, so it is announced exactly like a group change.

### 6. Screens: `libs/ui/`

An aggregate has two pages, a **list page** and an **editor page**, and each is one screen. Copy
both. The list page only reads and links; everything that writes happens on the editor page, which
has its own address, a back link to the list and room for a long text.

| File                     | What it holds                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `progressive.tsx`        | `NOTE_PATHS`: the pages the screens link to: `/notes`, `/notes/new` and `/notes/:id`. They carry no group id: the SPA acts on the person's selected group (see "How a group call travels", item 8, in `docs/handoff.md`).                                                                                                                                    |
| `notes-screen.tsx`       | The list page, `NotesScreen`: props in, links and callbacks out. "New note" and each note's title are links; the only form is the move of selected notes. A viewer gets the list and no "New note".                                                                                                                                                          |
| `note-editor-screen.tsx` | The editor page, `NoteEditorScreen`, for `/notes/new` (no note yet) and `/notes/:id`. Its fields carry the API's field names; "Save" and "Cancel" are the form's own, and the app's callbacks take the submit. A viewer gets the note as text. A note that cannot be read is "Note not found". The version conflict link and message are part of the screen. |
| `screens.test.tsx`       | Renders the newsletter screens on the server and checks that every action is a working form or link whose fields match the request schema.                                                                                                                                                                                                                   |
| `interactions.test.tsx`  | Drives each screen in a browser DOM: typing, submitting through the callback, and the delete dialog.                                                                                                                                                                                                                                                         |

Deleting asks first. With the app's `onDelete`, "Delete" in the page's menu opens
preact-components' `ConfirmDialog`; without it, the menu has no delete.

**A note in another of the person's groups.** A note belongs to one group, and the pages work on the
person's selected group. A link must never change the selection (another site could switch a
person's group with one), so opening `/notes/:id` never switches. When the note is in another of
the person's groups, the page (found through `note.locate`) names that group and offers "Switch to
<group>": only that button selects the group, through the same `group.select` command as the picker,
and the note then opens. A note that does not exist and a note in a group the person is not in both
show the plain "Note not found" page; the lookup answers them identically, so it never says whether
an id is taken.

### 7. SPA wiring: `apps/spa/src/`

| File                       | What it holds                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state/notes.ts` | The store: reads a group's notes with `apiAsUser`, writes with `callCommand` from `modules.ts` (which adds the idempotency key and picks the socket or `POST /api/call/<name>`), and turns a version conflict into the conflict UI. |
| `state/notes.test.ts`      | The store against fake calls.                                                                                                                                                                                                               |
| `views/NotesView.tsx`      | Passes the store and the group's role to `NotesScreen`.                                                                                                                                                                                     |
| `views/NoteEditorView.tsx` | Passes the store and the group's role to `NoteEditorScreen` for `/notes/new` and `/notes/:id`, with the offline conflict state above it.                                                                                                    |
| `views/spa-paths.ts`       | Lists the paths the router owns, for preact-components' `UnsavedGuard` in `NoteEditorView.tsx`, which asks before the person leaves the editor page with text that is not saved: on closing the tab, and on a click on any link in the app. |
| `app.tsx`                  | The routes, and the pull: a hint for the open group reads its notes again.                                                                                                                                                                  |
| `modules.ts` | The composition root: the only file that imports the WebSocket module and the offline layer. Stores import their ports from it ([offline.md](offline.md), "The modules and their switches"). |
| `offline/notes-collection.ts` | Notes are offline-writable (level 3): their adapter for the shared collections layer. A level 1 or 2 aggregate has no file here. |

The store does not move the group's cursor on its own writes: another member's change may have
taken the sequence just before, and moving past it would drop that change's hint. Its own hint costs
one extra read instead.

#### Choosing the offline level

Decide the level before writing the store
([ADR 003](decisions/003-swappable-transport-and-local-data.md), section 4;
[offline.md](offline.md#the-three-levels) lists where every list stands today).

**Level 1, online only.** Write the store as above and nothing else. With no network its read
fails and the screen shows the store's error.

**Level 2, offline-readable.** The default for a list. Four steps, as in `state/members.ts`:

1. Add the list's key to `READ_KEYS` in `state/read-keys.ts`. A key names everything the answer
   depends on: the group, and the cursor when the list is paged.
2. Give the store's factory a `device: LocalReads = noLocalReads` parameter, and pass `localReads`
   (from `modules.ts`) where the page's store is built.
3. Make the read `device.through(key, read, early)`. `read` must throw for a refusal (wrap a
   result object's failure in `ReadRefused`), so only an unreachable server is answered by the
   copy. `early` paints the copy when the screen has nothing to show, returns `false` when it
   painted nothing, and takes the copy back when it is called with `undefined`.
4. Add the list to `CASES` in `state/device-copies.test.ts`. That one entry runs the five promises
   of a level 2 list against the store: the copy answers an unreachable server, every answer
   replaces it, a refusal is not hidden by it, nothing is kept while the module is off, and it
   shows before the server has answered.

A list that can mislead when old (it lists access a person may have revoked) also exposes
`savedAt` from the answer (`fresh ? null : savedAt`), and its screen says the list is a saved copy,
as `libs/ui/api-tokens.tsx` does.

**Level 3, offline-writable.** Only for an aggregate a person must be able to change with no
network; it costs a conflict screen. Copy `offline/notes-collection.ts`: one `defineCollection`
with the aggregate's commands, its error codes (`classifyByCode`), the wording of its failures and
its device copy, added to the `collections` list in `offline/index.ts`. The queue, the keys, the
lock and the conflict rules come from `@spy4x/realtime/collections` and are not written again.
Then wrap the store's dependencies as `offlineNotes` does, and copy
`offline/notes-collection.test.ts`.

### 8. Tests

| File                                                             | What it proves                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/features/notes/transports.test.ts`                     | Every scenario through the socket and through the call route, on real buses and handlers, and the REST list reads: a viewer's writes are refused; a stale version conflicts.                                                     |
| `apps/api/features/notes/operations.test.ts`, `routes/notes.test.ts`, `routes/call.test.ts` | Parsing and dispatch of each transport.                                                                                                                   |
| `tests/integration/notes.integration.test.ts`                    | Postgres: one sequence step and one outbox row per write, conflicts, viewers, paging.                                                                     |
| `e2e/notes.e2e.ts`                                               | Two members: one creates, edits and deletes on the note pages; the other's open tab follows without a reload; a viewer sees a note without edit controls. |
| `e2e/notes-restore.e2e.ts`                                       | Delete then Undo, delete then Show deleted notes and Restore, with the other member's open tab following. |
| `tests/integration/notes-purge.integration.test.ts`              | The worker's purge removes notes deleted over 30 days ago and keeps restored ones, with the clock set by the test. |
| `e2e/notes-move.e2e.ts`                                          | Moving one note and ticked notes, with members of both groups watching.                                                                                   |
| `tests/integration/note-move-push.integration.test.ts`           | Members of both groups get a hint for a move; a stranger gets none.                                                                                       |

The product cannot add a member yet, so tests seed one: the integration test inserts the row, and
the e2e spec calls `POST /api/test/add-member` (`apps/api/routes/dev.ts`, mounted only in
development). Teach `POST /api/test/cleanup-user` to delete the new table's rows too.

## Relations between aggregates

Tags are the worked example: a note names tags by id (`tagIds`), and a tag knows nothing of notes.
Copy these choices:

- **The link is its own table** (`note_tags`, with the group's change log recording every change),
  and it has no foreign key to the child on the parent's side. Deleting the parent removes its
  links and never touches the child's row or version, so a delete of a tag moves no note.
- **The child's write carries the ids; the server ignores unknown ones** and answers with the
  links the child really has. A client never needs to know whether the parent still exists.
- **Moving the child maps the parent by name:** a moved note keeps its tags by name, and the target
  group gets any tag it lacks, each with its own audit event.
- **The parent is capped per group** (`TAG_MAX_PER_GROUP`), because its list has no pages. The
  repository counts after its insert, inside the transaction that holds the group's row, so two
  creates at once cannot both pass. A move whose new tags do not fit is refused whole
  (`TAG_LIMIT_REACHED`): moving the notes without their tags would lose them silently.
- **Offline, the parent's collection is declared first** in `offline/index.ts` and named in the
  child's `dependencies` (`parents`, `on`, `without`). The four rules are in
  [offline.md](offline.md#tags-the-second-offline-writable-aggregate-and-what-a-parent-means).
- **The child's screens read the parent's store** (`state/tags.ts`) for their picker, labels and
  filter; the filter lives in the address (`useUrlFilters`) and runs over the local list.

The tag files, in the order of this document:

| Step | Files |
| --- | --- |
| 1. Domain | `libs/domain/tags/+lib.ts`, `+lib.test.ts`, `deno.json` |
| 2. Database | `libs/server/db/migrations/2026_10_27_0001_tags.sql`, `schema.sql` |
| 3. Repository | `libs/server/tags/postgres-tag-repository.ts`, and `setNoteTags` and the move mapping in `libs/server/notes/postgres-note-repository.ts` |
| 4. Handlers | `apps/api/features/tags/handlers.ts`, `apps/api/cqrs/` (dependencies, command and query handlers, `+init.ts`) |
| 5. Transports | `apps/api/features/tags/operations.ts`, `errors.ts`, `apps/api/routes/tags.ts`, `realtimeHub.ts` |
| 6. Screens | `libs/ui/tags-screen.tsx`, `tag-parts.tsx`, the tag parts of `notes-screen.tsx` and `note-editor-screen.tsx`, `tags.test.tsx` |
| 7. SPA wiring | `state/tags.ts`, `offline/tags-collection.ts`, `tags-cache.ts`, `views/TagsView.tsx`, the tag parts of `NotesView.tsx`, `NoteEditorView.tsx`, `pull.ts`, `OfflineStatus.tsx` |
| 8. Tests | `apps/api/features/tags/transports.test.ts`, `tests/integration/tags.integration.test.ts`, `state/tags.test.ts`, `offline/tags-collection.test.ts`, `e2e/tags.e2e.ts`, `e2e/tags-realtime-off.e2e.ts` |

The MPA has no session, so tags exist in the SPA only.

## Delete, restore and purge

A delete keeps the row (`deleted_at`), so it can come back. An aggregate follows the notes files that
mention `restore`:

1. **Domain.** A request schema (empty: a restore needs no version, because nothing but a restore
   changes a deleted row), a socket payload with the group and the id, a command, a `<kind>.restored`
   event, an audit and activity kind, and a `deleted` flag on the list query.
2. **Repository.** `restore` runs in one transaction: it checks the role on the locked membership
   row, clears `deleted_at` only where it is set (a live or missing row is `NOT_FOUND`), raises the
   version, counts the plan's cap including the restored row and refuses with the plan's refusal,
   writes the audit row and records one change in the group's log. `list` takes `deleted` and pages
   the deleted rows by the same cursor, served by a partial index.
3. **Handler and gate.** Edit rights are required, as for a delete. `needsRoom` reserves room for
   one row, because a restore adds a live row exactly as a create does.
4. **Transports.** `POST /:id/restore` (empty body), `?deleted=true` on the list, the socket command
   `<kind>.restore` and the `deleted` flag of `<kind>.list`.
5. **Purge.** The worker's nightly cleanup (`libs/server/jobs/wiring.ts`) calls a `purgeDeleted<Kind>`
   that hard-deletes rows deleted more than the restore window ago. It takes `now` as a parameter, so
   a test sets the clock. Notes use 30 days (`NOTE_RESTORE_DAYS`). Anything that hangs off the row,
   such as attachments, must be removed with it, or the purge leaves orphans.
6. **Screens and SPA.** A delete offers Undo for ten seconds (`useUndoToast`, which pushes it to the app's toast list), and the list's menu
   has "Show deleted notes", which lists the deleted rows with a Restore button for editors. The
   store never queues a restore: it needs the server, like a move.
7. **Tests.** Both transports (every role, stranger, a live row, the cap), Postgres (version,
   sequence, audit row, the deleted list's cursor), the purge against a fixed clock and through the
   nightly job, the store, the screens and an e2e spec.

## Making an aggregate movable

A note can move to another group (`NoteMoveCommand`). An aggregate becomes movable by following the
same steps; copy the notes files that mention `move`:

1. **Domain.** A request schema (`toGroupId` and 1 to `NOTE_MOVE_MAX` ids), a socket payload schema
   that adds `groupId` (the source), `parseNoteMoveRequest` (refuses repeats and a move into the
   same group with `SAME_GROUP`), the command, and `<kind>.moved_out` and `<kind>.moved_in` events.
2. **Repository.** One transaction that locks both groups in id order (so two opposite moves wait
   for each other instead of deadlocking), checks the actor's role on both locked membership rows,
   updates `group_id`, raises the version, refuses with `NOT_FOUND` and rolls back when any id is not
   in the source, counts the cap on the target, records one change per group (`moved_out` on the
   source, `moved_in` on the target) and writes one `audit_events` row per group. The id and the
   history stay: a move is an update, not a copy and a delete.
3. **Handler and gate.** The handler asks for edit rights in the source, then in the target. The
   entitlement gate judges the target group (`needsRoom` with `toGroupId`), so a move into a full
   group is refused, but only for someone who can write in the source too (its `judges` reads the
   source role through `roleIn`), so a viewer of the source gets 403, not 402; the repository counts all moved rows, the gate only reserves room for one.
4. **Transports.** `POST /move` (registered before `POST /`) and the socket command `<kind>.move`.
5. **Screens.** The list gets a tick box per row and one form posting `{ toGroupId, noteIds }`; the
   item page gets a form posting `{ toGroupId }`. Targets are the person's groups where they may
   write (`moveTargetsOf`).
6. **SPA and offline.** The store sends the command over the socket and never queues it. A queued
   write for a moved item becomes a conflict (`docs/offline.md`).
7. **Tests.** Both transports (viewer, stranger, same group, all-or-nothing, cap), Postgres (one
   sequence step and one audit row per group, rights in both groups, opposite moves), the hint for
   members of both groups (`tests/integration/note-move-push.integration.test.ts`), the screens and
   an e2e spec.
8. **Entities tied to their group.** Notes reference nothing, so a note moves alone. An aggregate
   whose rows point at other rows of the same group (in Financy, a transaction's account and
   category) must decide before it becomes movable: the references move with it in the same
   transaction, or the move is refused with a clear error when a reference would be left behind.
   Never move the row and leave its references in the old group.

### Register it for "move all data"

A person can move everything a group holds to another group (`GroupMoveAllCommand`,
`POST /api/groups/:groupId/move-all`, socket `group.moveAll`), usually before deleting the emptied
group. One command moves every registered aggregate in one transaction, so a movable aggregate must
register, or its rows stay behind and are lost when the group is deleted.

1. Write a `MovableAggregate` (`libs/server/groups/movable.ts`): a `kind` and
   `moveAll(sql, context)`, which moves the aggregate's live rows inside the transaction the mover
   opened and returns how many moved. Reuse the repository's own move (the notes file
   `libs/server/notes/note-movable.ts` calls `moveNoteRows`, the function `PostgresNoteRepository.move`
   uses); never copy its SQL. Stamp the rows with `context.changeSequence`, the target's sequence.
2. Add it to `MOVABLE_AGGREGATES` in `apps/api/services/db-base.ts`. The order is the order of the
   moves; the mover has already recorded both groups' changes, locked both groups and checked edit
   rights in both.
3. Only the notes cap is wired today. The entitlement gate reads one cap for one command and hands
   it over as one number, `allowance` (`apps/api/cqrs/entitlement-needs.ts`), so the handler passes
   `{ maxNotes: allowance }`. A second capped aggregate needs the gate to read several caps for one
   command first; that is not built. Count the rows against the target under the lock, as
   `moveNoteRows` does with `assertRoomFor`.
4. Add a case to `tests/integration/group-move-all.integration.test.ts`: the rows moved, and a
   failure after your aggregate leaves nothing moved.

The counts go into the audit events, which the activity page words as "N items".

## Adding a setting to a group

A setting is a property of the group itself, such as its description, colour and emoji. It is not
a new aggregate: the group already has the table, the repository, the transports and the change
event. Follow the details command (`group.updateDetails`, spy4x/template#134) file by file.

1. **Migration.** One file in `libs/server/db/migrations/` adds the column, with a default or a
   nullable type so existing rows stay valid, and a `CHECK` for a limit the database can hold.
   Mirror the same lines in `libs/server/db/schema.sql`; `groups.integration.test.ts` compares the
   snapshot with the migrations. Tests that apply a hand-written list of migrations
   (`auth.integration.test.ts`, `valkey-outage.integration.test.ts`, `groups.integration.test.ts`,
   `db-group-transaction.integration.test.ts`)
   need the new file added.
2. **Domain.** Add the field to `Group` and `GroupSummary` in `libs/domain/groups/+lib.ts`, one
   parser per field that throws `GroupError` with `INVALID_REQUEST`, and a limit constant the screen
   can import. A colour is stored as a palette name and checked against `GROUP_COLORS`, never a hex
   value. Settings that change together share one command so one request is one audit row.
3. **Repository.** Add the column to the selects and to `toGroup` and `toSummary`. The write locks
   the member's row, checks the role, updates, then calls `audit()` and `recordChange()` in the
   same transaction. That outbox row is the change event.
4. **Command and handler.** The handler judges the role again (`assertCanEditDetails` reuses the
   rename rule), so REST and the socket enforce it alike. Register the command in
   `apps/api/cqrs/+init.ts`, `apps/api/index.ts` and `apps/api/services/realtimeHub.ts`.
5. **Transports.** A REST route (`PUT /api/groups/:groupId/details`) and the socket command
   (`group.updateDetails`), with the same bad-input and role tests as the other group commands.
6. **Screen.** An "Edit details" item in the settings menu opens a dialog; the form is never open
   by default. Hide the item when the role may not edit. New fields on `GroupRow`, `PickerGroup`
   and the SPA's `GroupItem` are optional, because the offline store may hold groups saved before
   the field existed.
7. **Other members.** Nothing to add: `recordChange()` makes the worker send a hint to every
   member's socket, and their pages read the group again. Test it with two pages and a count of
   page loads, as `e2e/groups-details.e2e.ts` does.

## Telling a person in their inbox

A change that a person should hear about, and did not make themselves, writes a notification
(spy4x/template#147). Follow `libs/server/groups/group-notifications.ts`.

1. **Same transaction.** Call `createNotification(tx, …)` from `@server/notifications` inside the
   transaction of the change, after the change, so the row exists exactly when the change does.
   The group writers call a helper from `group-notifications.ts` after their `audit()` line.
2. **A kind, a payload, a link.** Add the kind to `NotificationKind` and its sentence to
   `describeNotification` in `libs/domain/notifications`. The payload holds only the facts the
   sentence needs, never a note body or an address. The link is an in-app path; the database and
   `createNotification` both refuse anything else.
3. **Nothing else.** The row announces itself: `createNotification` sends the Postgres
   notification `user_notification` in the same transaction, the API turns it into a hint on the
   person's sockets, and the page reads the new count. A test per writer in
   `tests/integration/notifications.integration.test.ts` shows the row and who got it.

## Giving a new account starter data

A new account should not open onto an empty app. Sign-up queues one worker job per account
(`libs/server/jobs/starter-data.ts`), and the job creates the template's starter data: one welcome
note in the person's first group. The sign-up never waits for it and never fails because of it.

- **The request row is the marker.** Sign-up writes one `starter_data_requests` row and the outbox
  job in its own transaction, through `db.starterData.queue(userId)`. The job's id is the row's id.
  The worker sets `done_at` when it has finished, so a job that runs again does nothing.
- **Make the write repeatable.** The welcome note's id is the request's id, so a retry that lands
  between the note and the marker finds the note and adds none. Do the same for your data: derive
  each row's id from the request id (or use `ON CONFLICT DO NOTHING`), never "insert and hope".
- **Add yours inside `starterDataJob`**, after the welcome note, using your repository's own create
  (the one the handlers use), with the person as the actor. Skip quietly when the group is gone:
  `NoteError` there means "nothing to seed", not a failure to retry. Financy's default categories
  would be one more call here.
- **Test it with a forced retry** (`tests/integration/starter-data.integration.test.ts`): run the
  job twice, and once more with the outbox row put back as unprocessed, and count the rows.

Every list also needs a first-run empty state: `EmptyState` with one action when there is
something to do (`New note`, `New group`), and none when there is not (the inbox, the activity
log). See `docs/design/ui-layout.md`.

## What is left to the next aggregate

- The SPA creates a note in the group it shows, over the socket, so a note never lands in a group
  other than the one on screen.
- The role check and the write are two steps, not one transaction. Membership cannot change
  through the product yet; when it can, the check moves into the write's transaction.
- The SPA reads the whole list again on every hint. A pull of only the notes changed after the
  cursor needs the `change_sequence` column, which is already there, and a query that uses it.
