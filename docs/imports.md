# Imports

A person brings records into a group from a file: notes from a CSV today, bank transactions in a
product tomorrow. They upload the file, a job reads it, they match its columns to the record's
fields and check every row, then save. The valid rows are saved as one batch, and one undo removes
the whole batch.

The flow is the same for every kind of file. A kind says only which files it takes, the fields a
row maps to, and how a row is read, checked, written and removed. A product adds a kind without
touching the flow's files.

## The screens

The SPA's two pages name no kind, so a product's kind reuses them:

- `/imports/new?kind=notes` picks the file, refusing a wrong type or a file past the kind's size
  before the upload, and lists the person's recent imports of that kind in the selected group.
- `/imports/:importId` follows the import through its steps. While it is ready, the person matches
  columns to fields; every change checks all the rows again 400 ms later. Problems show on the
  20 preview rows, and the refused rows further down are listed by line, counted as a spreadsheet
  counts them (the header is line 1). The save button names the count of valid rows. A saved import
  offers the kind's list and an undo behind a confirmation.

The notes menu's "Import notes…" and the palette's "Import notes" open the picker, for an editor
or above with the notes on. The screens are `libs/ui/import-screen.tsx`, their words per kind are
`libs/ui/import-kinds.ts`, and the state is `apps/spa/src/state/imports.ts`.

The admin app's Imports module (`/imports`) lists every group's imports by status: the group, the
kind, the uploader's id, the counts, how long the read and the save took, and why one failed. It
never shows the file, its name, its cells, or the options and choices a person gave.

## The steps

| Status       | What happened                                                                   |
| ------------ | ------------------------------------------------------------------------------- |
| `READING`    | Uploaded. The read job has not finished.                                        |
| `READY`      | Read: the header, the first 20 rows, the row count and a guessed mapping.       |
| `FAILED`     | The file could not be read, or the save was refused. `failure` says why.        |
| `COMMITTING` | The person saved it. The commit job is writing the records.                     |
| `COMMITTED`  | The records are written, as one batch. Rows left out are counted.               |
| `UNDONE`     | The batch was removed the way its kind removes records (notes go to the trash). |

The file's bytes are kept in `imports.file` only while they are needed. They are dropped when the
import is saved or fails, and the nightly cleanup deletes every import not saved a day after its
upload, with its file. Saved and undone imports stay until their group or their uploader goes.

## The API

Under `/api/groups/:groupId/imports`, over HTTP only, because a file is an upload:

| Request                                              | Answer                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `POST /?kind=notes&name=notes.csv&options=…`, file   | 201 with the import. The body is the file, at most 5 MiB.      |
| `GET /`                                              | The person's own imports in the group, newest first, up to 50. |
| `GET /:importId`                                     | One import, with its preview.                                  |
| `POST /:importId/check`, `{ mapping }`               | Every refused row (up to 100, 10 errors each). Saves nothing.  |
| `POST /:importId/commit`, `{ mapping, choices? }`    | 202 with the import. The commit job saves it.                  |
| `POST /:importId/undo`                               | The import, undone, in the same request.                       |

A mapping is the field's key to the zero-based column: `{ "title": 0, "body": 1 }`. A field the
kind lacks, a column past the file and an unmapped required field are refused with 400 before
anything is queued. `options` and `choices` are optional, and a check of a kind with a review also
answers `reviews`: see "Options, review and choices" below.

Every step records a change on the group's change log (`import.created`, `import.read`,
`import.failed`, `import.committing`, `import.committed`, `import.undone`). Each member's socket
gets the hint; the import's screen then reads the import again with `GET /:importId`. Imports are
not part of the changes pull, because it would show them to every member.

Errors keep the API's one shape (`docs/api-errors.md`) and reuse reasons the apps already have
words for: `GROUP_NOT_FOUND` and `ITEM_NOT_FOUND` (404), `INVALID_REQUEST` (400, also an unknown
kind), `IMPORT_REFUSED` (422, a file that cannot be read), `FILE_TOO_LARGE` (413),
`VERSION_CONFLICT` (409, a step the import's status does not allow) and `ROLE_INSUFFICIENT` (403).
The message names the exact problem.

## Who may do what

- **Upload, check, save and undo**: a member whose role may create the kind's records. For notes,
  an editor or above.
- **See an import**: the person who started it, and the group's admins and owner. Anyone else, a
  member of another group included, gets the API's usual not-found answer.
- Every write checks the role again inside its own transaction, on the locked group. The commit
  job checks the uploader's role when it runs, so a person removed after the upload saves nothing.
- A guest account cannot upload (`docs/guests.md`). API tokens cannot import.

## A save is whole or nothing

The commit job reads the stored file again, checks every row under the saved mapping and writes
every valid row in one transaction. It also writes the batch to `import_records` and drops the
file. If the group's plan has no room, or the uploader lost their role, nothing is written and the
import is marked `FAILED` with the reason in words. Any other fault rolls the transaction back and
the job is tried again. Both jobs run only on an import in the step they finish, so a rerun writes
nothing twice.

Undo runs in the request, in one transaction. It hands the batch's ids to the kind's `undo`, which
removes them through the aggregate's own delete. An id already gone is skipped.

## Options, review and choices

Three optional parts of a kind, for files that land in one parent record or repeat what the group
has already, such as a bank statement: it belongs to one account, and a second import of it must
not save its rows twice. The notes kind uses none of them.

- **Options at the upload.** `options` is a JSON object of text, at most 2048 bytes and 20 keys,
  each key a field key such as `accountId`. A kind with `readOptions` reads them inside the
  upload's transaction, after the role check, and its answer is stored in `imports.options` and
  returned as the import's `options`. It refuses with an `ImportError`; a record of another group
  is `ITEM_NOT_FOUND`, so a stranger's ids read as missing. It is called with `{}` when the upload
  has no options, so a kind may require them. A kind without `readOptions` refuses any options
  with `INVALID_REQUEST` before anything is written. Every later step gets the stored value:
  `check` as its third argument, `review`, `commit` and `undo` on their context.
- **A review with the database.** A kind with `review(tx, values, context)` answers, for every
  checked value in order, `{ skip, suggestions }`: why a save leaves the row out (such as "Saved
  before") or `null`, and values for its choice fields, such as a category guessed from the payee.
  A check runs it in a read-only transaction and answers `reviews`: `{ row, cells, skip,
  suggestions }` for each of the first 5,000 valid rows, in file order. The cells come from the
  person's own file and are shown only to those who may see the import. The commit job runs the
  review again in its own transaction, under the group's lock, and leaves out the skipped rows,
  counted in `skippedCount` (`null` for a kind without a review). So a second save of the same file
  saves nothing, even when both previews came before either save. A review that answers a
  different number of rows than it was given is a fault in the kind and throws.
- **Choices at the save.** A field marked `choice: true` may be set per row: `choices` maps a row
  number (1 is the first row, as a string) to `{ field: value }`, at most 20 fields of at most 200
  characters per row. A choice field need not be mapped to a column; a required field cannot be
  one. A field that is not a choice, a row number below 1 and a row past the file are refused with
  400 before anything is queued. The choices are stored in `imports.choices` for the commit job,
  which hands `commit` one entry per value on `context.choices`: the review's suggestions overlaid
  with the person's choices for that row. The kind checks them itself, as it checks any value from
  outside (a category of another group is refused). A choice for a row that was refused or
  skipped is ignored.

## The batch table

`import_records` holds one row per record a save made: the import's id and the record's id. It is a
join table, not a column on each aggregate, so a product adds a kind without changing its
aggregate's table. Its rows go when the import goes; the records stay.

## Add a kind

1. Write the kind with `importKind` from `libs/server/imports/import-kind.ts`. Use
   `libs/server/notes/note-import.ts` as the example. A kind has:
   - `id`: lower case words joined by `-`, never renamed once used;
   - `label`, the file endings it takes (`accept`) and its size cap (`maxBytes`, at most 5 MiB);
   - `fields`: `{ key, label, required?, choice? }`;
   - `canCreate(role)`: whether a role may create these records;
   - `read(bytes)`: the header or `null`, every row as text cells and a guessed mapping, or why
     the file cannot be read, in words. Read CSV with `@spy4x/platform/universal/csv`
     (`decodeTextFile`, `sniffCsv`, `parseCsv` with limits), never by hand, and refuse text that
     `hasUnstorableTextCharacters` (`@spy4x/platform/universal/text`) finds, such as the NUL bytes
     of a binary file, which Postgres cannot store;
   - `check(row, mapping, options)`: the value to write, or each problem in words;
   - optionally `readOptions` and `review` ("Options, review and choices" above);
   - `commit(tx, values, context)`: writes every value in the flow's transaction, stamped with
     `context.changeSequence`, checks the plan's cap from `context.allowances` and the values on
     `context.choices`, and answers the new ids;
   - `undo(tx, ids, context)`: removes them through the aggregate's own delete.
2. List it in `importKinds` (`libs/server/imports/registry.ts`).
3. Put its `id`, `accept`, `maxBytes` and `maxRows` in `libs/domain` (`ImportKindLimits`, as
   `NOTE_IMPORT_KIND`), so the server kind and the SPA's picker read the same limits. Add its case
   and words to `importKindView` (`libs/ui/import-kinds.ts`) and a link to
   `IMPORT_PATHS.new(id)` where its records are listed.
4. Test its `read` with an awkward file (another encoding, a file past its limits, formula and
   HTML cells, which stay text).

## The notes kind

Notes from a `.csv` or `.txt` file of at most 2 MiB, 5,000 rows and 50 columns. The file may be
UTF-8, UTF-16 with its byte-order mark, or a single-byte encoding (read as Windows-1252). The
delimiter is guessed. A first row that names a field (`title`, `name`, `subject`, `heading`) is the
header. A file that is not text, such as a picture renamed `.csv`, fails with "The file is not a
text file." A row needs a title; its body is optional. Undo moves the batch's notes to the trash.

With `NOTES=false` (docs/start-a-product.md) the API and the worker leave this kind out: an upload
of `kind=notes` is refused, and a notes import made before the switch fails when its job runs.
