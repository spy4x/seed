# Delete, move and export an aggregate

> Also on the website: [seedsaas.com/docs/aggregate-lifecycle](https://seedsaas.com/docs/aggregate-lifecycle).

This page gives an aggregate restore after delete, a move to another group, and a place in the
group's file and the person's data export. Each section copies the notes files that do the same.

You need:

- The aggregate built ([the aggregate reference](aggregates.md)).

## Delete, restore and purge

A delete keeps the row and sets `deleted_at`, so it can come back. Copy the notes files that
mention `restore`.

1. **Domain.** Add an empty restore request schema: nothing but a restore changes a deleted row, so
   it needs no version. Add a socket payload with the group and the id, a command, a
   `<kind>.restored` event, an audit and activity kind, and a `deleted` flag on the list query.
2. **Repository.** `restore` runs in one transaction. It checks the role on the locked membership
   row and clears `deleted_at` only where it is set; a live or missing row is `NOT_FOUND`. It raises
   the version, counts the plan's cap with the restored row, writes the audit row and records one
   change. `list` takes `deleted` and pages the deleted rows by the same cursor.
3. **Handler and gate.** A restore needs edit rights, like a delete. `needsRoom` reserves room for
   one row, because a restore adds a live row as a create does.
4. **Transports.** Add `POST /:id/restore` with an empty body, `?deleted=true` on the list, the
   socket command `<kind>.restore` and the `deleted` flag of `<kind>.list`.
5. **Purge.** The worker's nightly cleanup (`libs/server/jobs/cleanup.ts`) calls a
   `purgeDeleted<Kind>`. It hard-deletes rows deleted longer ago than the restore window, and takes
   `now` as a parameter so a test sets the clock. Notes keep 30 days (`NOTE_RESTORE_DAYS`).
6. **Screens and SPA.** A delete from a row's menu offers Undo for eight seconds instead of asking
   (`useUndoToast`). The list's menu has "Show deleted notes", with Restore for editors. The store
   never queues a restore: it needs the server.
7. **Tests.** Both transports (every role, a stranger, a live row, the cap), Postgres (version,
   sequence, audit row, the deleted list's cursor), the purge with a fixed clock, the store, the
   screens and an e2e spec. Notes: `e2e/notes-restore.e2e.ts`, `e2e/notes-restore-offline.e2e.ts`
   and `tests/integration/notes-purge.integration.test.ts`.

Anything that hangs off the row, such as attachments, must go with it in the purge, or it is left
behind.

## Make it movable

A note can move to another group (`NoteMoveCommand`). Copy the notes files that mention `move`.

1. **Domain.** Add a request schema (`toGroupId` and 1 to `NOTE_MOVE_MAX` ids) and a socket payload
   that adds the source `groupId`. `parseNoteMoveRequest` refuses repeats, and a move into the same
   group with `SAME_GROUP`. Add the command and the `<kind>.moved_out` and `<kind>.moved_in` events.
2. **Repository.** One transaction:
   - Lock both groups in id order, so two opposite moves wait instead of deadlocking.
   - Check the actor's role on both locked membership rows.
   - Update `group_id` and raise the version. Any id not in the source rolls everything back with
     `NOT_FOUND`.
   - Count the cap on the target.
   - Record one change and one `audit_events` row per group.

   The id and the history stay: a move is an update, not a copy and a delete.
3. **Handler and gate.** The handler asks for edit rights in the source, then in the target. The
   entitlement gate judges the target (`needsRoom` with `toGroupId`), but only for someone who can
   write in the source. So a viewer of the source gets 403, not 402.
4. **Transports.** `POST /move`, registered before `POST /`, and the socket command `<kind>.move`.
5. **Screens.** The list gets a tick box per row and one move form posting `{ toGroupId, noteIds }`.
   The editor gets a form posting `{ toGroupId }`. Targets are the groups where the person may
   write (`moveTargetsOf`).
6. **SPA.** The store sends the command and never queues it. A queued write for a moved item
   becomes a conflict ([offline-writes.md](offline-writes.md)).
7. **Tests.** Both transports (viewer, stranger, same group, all or nothing, cap), Postgres, the
   hint to members of both groups, the screens and an e2e spec. Notes:
   `tests/integration/note-move-push.integration.test.ts` and `e2e/notes-move.e2e.ts`.

**Rows that point at others.** A note points at nothing in its group, so it moves alone. An
aggregate whose rows point at other rows of the same group decides first. Either the rows it
points at move with it, in the same transaction, or the move is refused with a clear error. Never
leave a reference in the old group.

### Register it for "move all data"

A person can move everything a group holds to another group, usually before deleting the empty
one (`group.moveAll`). One transaction moves every registered aggregate. An aggregate that does not
register stays behind and is lost with the group.

1. Write a `MovableAggregate` (`libs/server/groups/movable.ts`): a `kind` and
   `moveAll(sql, context)`. It moves the live rows inside the mover's transaction and returns how
   many moved. Stamp the rows with `context.changeSequence`.
2. Reuse the repository's own move; never copy its SQL. `libs/server/notes/note-movable.ts` calls
   `moveNoteRows`, as `PostgresNoteRepository.move` does.
3. Add it to `MOVABLE_AGGREGATES` in `apps/api/services/db-base.ts`. The list's order is the order
   of the moves.
4. Add a case to `tests/integration/group-move-all.integration.test.ts`: the rows moved, and a
   failure after yours leaves nothing moved.

The mover has already locked both groups, checked edit rights in both and recorded both changes.
The entitlement gate hands every cap of the target group's plan to the mover as
`context.allowances`, the product's own limit keys included. A capped aggregate reads its own,
such as `context.allowances.maxNotes`, counts what it moves under the group's lock and refuses
with a `PlanError` when the target would pass it. Nothing in Seed's files changes for it.

## Make it exportable

The owner of a group downloads it as one JSON file, and anyone who may create a group makes one
from such a file. The file holds one list per registered aggregate, keyed by its `kind`. An
aggregate that does not register is left out of every export.

The owner can also download the group as spreadsheets (`GET /api/groups/:groupId/export?format=csv`):
a ZIP with one `<kind>.csv` per aggregate that has a `csv` part, and a `README.txt` that names the
ones without. Nothing imports it; it is for a person to open.

1. **Domain.** Write the entry's arktype schema and a parser that reuses the aggregate's field
   rules (`noteExportEntrySchema` and `parseNoteExportEntry`). An entry has an `id`, what a person
   wrote, and the ids it points at. Never a person, a secret, a version or a deleted row. Refuse
   unknown fields (`"+": "reject"`).
2. **Server.** Write a `PortableAggregate` (`libs/server/groups/portable.ts`) beside the
   repository, as `libs/server/notes/note-portable.ts` does. Its parts are in the table below.
3. Add it to `PORTABLE_AGGREGATES` in `apps/api/services/db-base.ts`. The order is the order of
   the writes, so tags come before the notes that point at them.
4. A change an older file cannot satisfy raises `GROUP_EXPORT_VERSION`
   (`libs/domain/groups/export-import.ts`) and still reads the older version.
5. Add it to `tests/integration/group-files.integration.test.ts`: a round trip gives the same
   contents under new ids, and a failure halfway writes nothing.
6. **Spreadsheet.** Give it a `csv` part: the columns of `CsvColumn` (`@spy4x/platform/universal/csv`),
   each a field of the entry, its `header` an `app` catalog key such as `NoteSpreadsheet.title`
   (add the key to `i18n/app/*.ts` in every language, `i18n/TRANSLATING.md`), and a `format` for a
   field that is not text: a date as its ISO 8601 text, a list joined into one cell. The writer
   adds the byte order mark and guards every text cell against spreadsheet formulas; never write a
   second guard. Without a `csv` part the aggregate is listed in the ZIP's `README.txt` as not
   available as a spreadsheet.

| Part                           | What it does                                                               |
| ------------------------------ | -------------------------------------------------------------------------- |
| `kind`                         | The key in the file. Never rename it: files people keep name it            |
| `one`, `other`                 | The nouns the import page counts it with                                   |
| `limit`                        | The plan cap it counts against, if any                                     |
| `parse`, `check`               | One entry, and what is wrong across entries, such as a duplicate name      |
| `read(sql, groupId)`           | The group's live rows, in pages                                            |
| `write(tx, entries, context)`  | Writes the rows with new ids, and returns the new id of each file id      |
| `csv`                          | The columns of its spreadsheet, if it has one                              |

`write` gives every row a new `uuidV7()` id and stamps it with `context.changeSequence`. It maps
what a row points at with `context.newIdOf(kind, fileId)`.

## Put it in the person's data export

Every row a person made, or that is about them, goes into their data export
([data export](data-export.md)).

1. Add a section to `DATA_EXPORT_SECTIONS` in `libs/server/jobs/data-export-sections.ts`. Filter by
   the person, and leave out other people's data and secrets.
2. Add its rows to `tests/integration/data-export.integration.test.ts`.

## Next

- [Connect a feature to the app](aggregate-extras.md)
- [Link two aggregates](aggregate-relations.md)
