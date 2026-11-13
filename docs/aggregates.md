# The aggregate reference

> Also on the website: [seedsaas.com/docs/aggregates](https://seedsaas.com/docs/aggregates).

Every file a new aggregate needs, in the order to write them, with notes as the worked example.
Copy the notes files, rename them, and change the fields and rules. Do not invent a second shape.

You need:

- [Add your first feature](first-feature.md) read once. It walks the same steps, in short.

An **aggregate** is one kind of thing a product keeps: a note, an invoice, a task. A note belongs to
one group. Every member reads notes; an editor or above writes them.

## The rules every aggregate follows

- **It lives inside a group**, the only tenancy boundary. Every row carries a `group_id`.
- **Authorization is in the handlers.** The transports only parse and dispatch, so both answer
  alike.
- **Every write reads the role again** in its own transaction, with `lockActorRole`
  (`libs/server/groups/group-change-log.ts`). A write that races a removal is then refused.
- **Every write moves the group's change sequence** and writes an outbox row, in the same
  transaction. That row becomes a hint on every member's socket: live updates need nothing else.
- **Every command carries an idempotency key**, and every update and delete names the version it
  saw. A stale version gets a conflict with the current version.
- **Screens are pure: props in, callbacks out** ("Three layers of UI" in `AGENTS.md`).
- **Something new stored about a person updates the privacy page**
  (`apps/mpa/routes/[[lang]]/privacy.tsx`) in the same pull request.

## The files, in order

### 1. Domain: `libs/domain/notes/`

| File           | What it holds                                                                                |
| -------------- | -------------------------------------------------------------------------------------------- |
| `+lib.ts`      | The `Note` shape, request schemas, errors, commands, queries, event kinds, the authorization rule and the `NoteRepository` port |
| `+lib.test.ts` | Tests of the schemas and the authorization rule                                              |

The request schemas are arktype. Their field names are also the form's field names and the socket
payloads'. The authorization rule is two functions, `assertCanReadNotes(role)` and
`assertCanWriteNotes(role)`. A person who is not a member gets `GROUP_NOT_FOUND`, never
"forbidden", so a stranger cannot learn that a group exists.

Its `deno.json` makes it a workspace member: add it to `workspace` in the root `deno.jsonc`, with
an `@domain/notes` alias, or its tests never run. Add it to the `COPY` lines of `Dockerfile.base`.

### 2. Database: `libs/server/db/`

| File                                   | What it holds                                                    |
| -------------------------------------- | ---------------------------------------------------------------- |
| `migrations/2026_10_02_0001_notes.sql` | The `notes` table                                                |
| `schema.sql`                           | The same table appended, so the snapshot matches the migrations |

The table has `group_id`, the fields, `version`, `change_sequence` (the group's sequence at the
row's last write), the author, the last editor and `deleted_at`. Compose applies migrations on every
start.

**Naming a migration.**

1. Take the newest file name in `libs/server/db/migrations/` on `main`.
2. Go one step past it: the same date with the next number, or the next date with `0001`. The date
   is a counter, not the calendar, so never use today's date.
3. Name the file `YYYY_MM_DD_NNNN_words_in_snake_case.sql`. A statement that cannot run in a
   transaction ends in `.no_transaction.sql`.
4. Append the name as the last line of `ON_MAIN` in `tests/migration-names.test.ts`.

The runner applies files in name order, so a file that sorts too early breaks an empty database.
When another pull request merges a migration first, rename yours past it. Never rename one on
`main`: databases know it by its name.

### 3. Repository: `libs/server/notes/`

| File                          | What it holds                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| `postgres-note-repository.ts` | Reads and writes. Each write calls `recordGroupChange`. It checks no role |
| `note-list-cursor.ts`         | The signed paging cursor, bound to the user and the group             |
| `deno.json`                   | Workspace member: register it and add an `@server/notes/` alias       |

`recordGroupChange` (`libs/server/groups/group-change-log.ts`) moves the sequence and writes the
outbox row. The version check is the `WHERE version = ${expected}` of the `UPDATE`. A create retried
with the same id and content returns the first note. Expose the repository on `AppDbBase`
(`apps/api/services/db-base.ts`) as a getter built per access: a cached one escapes the transaction.

### 4. Handlers: `apps/api/features/notes/handlers.ts` and `apps/api/cqrs/`

| File                                 | What it holds                                                    |
| ------------------------------------ | ---------------------------------------------------------------- |
| `features/notes/handlers.ts`         | One factory per command and query: read the role, check, call the repository |
| `cqrs/note-dependencies.ts`          | Wires the handlers to `db.note` and to the membership read       |
| `cqrs/command-handlers/note-*.ts`    | One file per command                                             |
| `cqrs/query-handlers/`               | One file per query                                               |
| `cqrs/+init.ts`                      | Registers every handler on its bus                               |

The session gate and the idempotency middleware need nothing from you: a command with an
`idempotencyKey` runs once per user and key.

### 5. Transports: operations listed once, reached over the socket and the call route

| File                                    | What it holds                                                      |
| --------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/features/notes/operations.ts` | Every operation by name: parse the payload, dispatch               |
| `apps/api/features/notes/list.ts`       | One page of the list, with its cursor. Both transports call it     |
| `apps/api/features/notes/errors.ts`     | REST error codes and statuses ([API errors](api-errors.md))        |
| `apps/api/routes/notes.ts`              | The REST routes under `/api/groups/:groupId/notes`                 |
| `apps/api/services/note-list-cursor.ts` | The cursor codec, keyed from the cookie secret                     |

The notes operations are the commands `note.create`, `note.update`, `note.delete`, `note.restore`
and `note.move`, and the queries `note.list`, `note.get`, `note.locate` and `note.search`.
`note.locate` finds a note's group by the note's id alone, and answers only a member.

The socket (`/api/ws`) and `POST /api/call/<name>` serve the one list through one dispatcher. The
call route takes the payload as the JSON body and the key in the `Idempotency-Key` header. So a new
aggregate writes only a list route (`GET`). The notes routes for single writes are older; do not
copy them. Every route under `/api` refuses a request whose page names another user.

Wire it up:

1. Mount the route in `apps/api/index.ts`, before `/groups`.
2. Spread the aggregate's operations into `operations` in `apps/api/services/realtimeHub.ts`.
3. Map its domain error in `toRequestError` (`apps/api/services/realtime.ts`). The client then gets
   `forbidden`, `not_found` or `conflict`, with the domain code and the current version.

The worker needs no change: a note's outbox row names its group.

### 6. Screens: `libs/ui/`

| File                     | What it holds                                                         |
| ------------------------ | --------------------------------------------------------------------- |
| `progressive.tsx`        | `NOTE_PATHS`: `/notes`, `/notes/new` and `/notes/:id`                 |
| `notes-screen.tsx`       | The list page, `NotesScreen`. It only reads and links                 |
| `note-editor-screen.tsx` | The editor page, `NoteEditorScreen`, for a new note and a saved one  |
| `notes.test.tsx`         | Drives both screens in a browser DOM: typing, submitting, the dialogs |

An aggregate has a **list page** and an **editor page**. The list's "New note" and each title are
links; a viewer gets no "New note". Everything that writes is on the editor page, which shows Save
and Discard only while a field differs. A viewer sees the note as text. The paths carry no group id:
the SPA acts on the person's selected group.

"Delete" in the page's menu asks first, with `ConfirmDialog`. A record that is never edited, such as
an API token, gets a create-only page (`api-token-new-screen.tsx`). It shows the secret once, and
keeps it out of the address, the history and the device cache.

### 7. SPA wiring: `apps/spa/src/`

| File                          | What it holds                                                          |
| ----------------------------- | ---------------------------------------------------------------------- |
| `state/notes.ts`              | The store: reads with `apiAsUser`, writes with `callCommand`, shows conflicts |
| `state/notes.test.ts`         | The store against fake calls                                           |
| `views/NotesView.tsx`         | Passes the store and the role to `NotesScreen`                         |
| `views/NoteEditorView.tsx`    | Passes the store and the role to `NoteEditorScreen`                    |
| `views/spa-paths.ts`          | The route table. Every row says whether a signed-out person may open it |
| `app.tsx`                     | What each route draws (`PAGES`), and the re-read on a hint             |
| `libs/ui/frame.tsx`           | The rail entry, with its label key in every `i18n/app/*.ts`            |
| `modules.ts`                  | The only file that imports the socket module and the offline layer     |
| `offline/notes-collection.ts` | Only for an offline-writable aggregate                                 |

`callCommand` adds the idempotency key and picks the socket or the call route. The type check fails
for a route with no page. The store never moves the group's cursor on its own writes.

#### Choosing the offline level

Decide the level before you write the store: 1 online only, 2 offline-readable (the default for a
list) or 3 offline-writable. [Make an aggregate work offline](aggregate-offline.md) has the steps.

### 8. Tests

| File                                                    | What it proves                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `apps/api/features/notes/transports.test.ts`            | Every scenario through the socket and the call route            |
| `apps/api/features/notes/operations.test.ts`            | Parsing and dispatch of the operations                          |
| `apps/api/routes/notes.test.ts`, `routes/call.test.ts`  | Parsing and dispatch of the REST routes                         |
| `tests/integration/notes.integration.test.ts`           | Postgres: one sequence step and outbox row per write, conflicts, paging |
| `e2e/notes.e2e.ts`                                      | Two members: one edits, the other's tab follows without a reload |

A second member is seeded, not invited: an e2e spec calls `POST /api/test/add-member`
(`apps/api/routes/dev.ts`). Teach `POST /api/test/cleanup-user` to delete the new table's rows.

### 9. The admin counterpart

Give the aggregate its operator view: one folder in `apps/admin/src/modules/` and one file in
`apps/api/routes/admin/`. [Admin modules](admin-modules.md) has the steps.

## Add a field to an existing aggregate

A new column on notes, such as a colour, touches these files, in this order. To list the files an
existing field touches, run `git grep -c -w tagIds`; the group time zone (#785) is a recent
example of a whole field change.

1. **Migration.** A new file in `libs/server/db/migrations/` ("Naming a migration" above), the
   same column in `libs/server/db/schema.sql`, and the file's name appended to `ON_MAIN` in
   `tests/migration-names.test.ts`.
2. **Domain.** The field on `Note` and in the payload schemas (`noteCreatePayloadSchema`,
   `noteUpdatePayloadSchema`) in `libs/domain/notes/+lib.ts`.
3. **Repository.** The reads and writes in `libs/server/notes/postgres-note-repository.ts`, and
   the in-memory twin the API tests use, `apps/api/_testing/memory-notes.ts`.
4. **Handlers.** The command's fields in `apps/api/features/notes/handlers.ts`. The token API
   (`apps/api/routes/token-api.ts`) only when it should show the field.
5. **Export, import and move.** `libs/server/notes/note-portable.ts`,
   `libs/domain/groups/export-import.ts` and the person's data export,
   `libs/server/jobs/data-export-sections.ts`.
6. **SPA.** The store (`apps/spa/src/state/notes.ts`) and the device's copy and queue
   (`apps/spa/src/offline/notes-collection.ts`, `notes-cache.ts`, `device-copy.ts`).
7. **Screens and words.** `libs/ui/note-editor-screen.tsx` and `libs/ui/notes-screen.tsx`; each new
   message in `i18n/app/en.ts` ([i18n/TRANSLATING.md](../i18n/TRANSLATING.md), "The loop").
8. **Admin and demo.** The admin counterpart when the aggregate has one, and the demo's sample data
   (`apps/worker/demo/seed.ts`, `fake-data.ts`; [the demo](demo.md#when-the-database-changes)).
9. **Tests.** The tests next to each file above, `tests/integration/notes.integration.test.ts` for
   the column, and the privacy page when the field is something new about a person ("The rules
   every aggregate follows").

## More for an aggregate

| Section                                      | Page                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Choosing the offline level, the changes pull | [Make an aggregate work offline](aggregate-offline.md)                                |
| Relations between aggregates                 | [Link two aggregates](aggregate-relations.md)                                         |
| Delete, restore and purge                    | [Delete, move and export](aggregate-lifecycle.md#delete-restore-and-purge)            |
| Making an aggregate movable, "move all data" | [Delete, move and export](aggregate-lifecycle.md#make-it-movable)                     |
| Making an aggregate exportable               | [Delete, move and export](aggregate-lifecycle.md#make-it-exportable)                  |
| The person's data export                     | [Delete, move and export](aggregate-lifecycle.md#put-it-in-the-persons-data-export)   |
| Settings, widgets, inbox, first run, demo    | [Connect a feature to the app](aggregate-extras.md)                                   |

## Next

- [Add your first feature](first-feature.md)
- [Make an aggregate work offline](aggregate-offline.md)
