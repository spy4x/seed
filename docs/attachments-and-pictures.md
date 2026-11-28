# Attachments and profile pictures

> Also on the website: [seedsaas.com/docs/attachments-and-pictures](https://seedsaas.com/docs/attachments-and-pictures).

This page explains the two features Seed builds on the file store: files kept on a record, such as
a note, and a person's picture in place of their initials.

Both use the signed upload of [file-uploads.md](file-uploads.md). Both share one waiting count and
one hourly [upload budget](files.md#upload-budget).

## Attachments

A record keeps images (JPEG, PNG, WebP, GIF) and PDFs. Each kind of record that keeps files is an
attachment kind. Seed ships one, the note; a product adds its own
([Add attachments to a record kind](#add-attachments-to-a-record-kind)). For a note, every member
of the group reads the files, and an editor or above adds and removes them, as for the note itself.

| Part       | Where                                                                           |
| ---------- | ------------------------------------------------------------------------------- |
| Domain     | `libs/domain/attachments`                                                       |
| Kinds      | `libs/server/attachments` (`registry.ts` lists them)                            |
| Handlers   | `apps/api/features/attachments/attachments.ts`                                  |
| Note kind  | `libs/server/notes/attachment-kind.ts`, table `note_attachments`                |
| Operations | `attachment.sign`, `.confirm`, `.cancel`, `.remove`, `.list`, `.download`       |

A kind's operations start with its own prefix. The note's is `attachment`, and its payload names
the record `noteId`.

### Adding a file

1. **Sign.** The handler checks the role, the record and every limit. It signs the upload and keeps
   a row in `file_uploads` with the staging key, the kind and the record, for the person who
   asked.
2. **Upload.** The browser sends the file to the store.
3. **Confirm.** The handler settles that row for the same person and the same kind, so a second
   confirm, or a confirm through another kind, finds nothing. The store moves the bytes to
   `attachments/<id>` and checks them.
4. **Keep.** The row is added under a lock on the group, after the role, the record and the limits
   are checked again. A file refused at this point is deleted from the store.

The page cancels a waiting upload when the person cancels it, before a retry, and when they open
another record. It then stops counting as waiting at once.

### Limits

- **Waiting uploads.** One person has at most 20 uploads waiting
  (`ATTACHMENT_PENDING_MAX`). An upload waits for 10 minutes after it is signed
  (`ATTACHMENT_PENDING_MINUTES`), until it is confirmed or cancelled. An abandoned upload never
  locks anyone out.
- **Upload budget.** At most 50 uploads and 50 MiB an hour per person, whatever the plan
  ([files.md](files.md#upload-budget)). Signs sent at once wait for each other, so each counts the
  ones before it.
- **Plan limits.** The group's plan (`PLANS` in `libs/domain/billing`) sets `maxAttachments` and
  `storageBytes` for the group, counting the files of every kind. Its `attachments` rule sets
  `maxFileBytes` for one file and `maxPerRecord` for one record; a full record refuses with
  `RECORD_FULL`.
- **Billing off.** The group's caps are lifted like every other cap. The file and record rules
  stay.

A deleted record's files count until it is purged.

### Deleting and clean-up

- Deleting an attachment, its record, its group or its owner's account queues its file in
  `file_deletions`, through the trigger `queue_attachment_deletion()` on every kind's table.
- Removing an attachment deletes its file at once when the store answers.
- The worker's nightly clean-up deletes every queued file. It also forgets uploads signed more than
  a day ago and deletes staging files older than a day.

### Downloads and exports

- A download is signed only for a member of the file's group.
- A group's JSON export holds notes and tags only, not files.
- A person's data export ([data-export.md](data-export.md)) lists the files they attached, of
  every kind, without their bytes.

### In the admin panel

The admin app lists a group's files of every kind by name, with the record's title, the uploader
and the date. It
searches and pages them. An operator can open, download or remove a file, and each open or download
is audited ([admin-modules.md](admin-modules.md)).

The bytes go through the admin API with `nosniff`. Only a JPEG, PNG, WebP or GIF is shown in place;
any other file is saved. The route's sandbox policy is replaced by the app's own until
[spy4x/ts-libs#772](https://github.com/spy4x/ts-libs/issues/772) is released.

### Add attachments to a record kind

A product's own record, a task say, keeps files the way a note does. The handlers, the plan's
caps, the clean-up, the admin's files list and the data export take every kind from one list.

1. **A migration.** Add the attachment table with the columns of `note_attachments`, its record
   column (`task_id`) a foreign key to the record with `ON DELETE CASCADE`. Add the trigger
   `AFTER DELETE ... EXECUTE FUNCTION queue_attachment_deletion()`, which queues the file in
   `file_deletions`. The record table needs `id`, `group_id`, `deleted_at` and a title column.
2. **The kind.** Write it with `attachmentKind` (`libs/server/attachments/kind.ts`), as
   `libs/server/notes/attachment-kind.ts` does: its name (kept in `file_uploads.record_kind` and
   the audit rows, at most 32 characters), its operations' prefix (`taskFile`), its payload's
   record field (`taskId`), its tables, who may read and write, and its own not-found error.
3. **The list.** Add it to `attachmentKinds` in `libs/server/attachments/registry.ts`.
4. **The page.** Call `<prefix>.sign`, `.confirm`, `.cancel`, `.remove`, `.list` and `.download`
   with the record field.

Every table and column name comes from this code and is checked at start-up, never from a
request. A kind reads, confirms and removes only its own rows in its own group: an upload signed
for one kind is not found by another kind's confirm.

`NOTES=false` leaves only the note kind out, so `attachment.*` is refused as unknown and every
other kind keeps working. The admin app's Files tab is the exception: it is still mounted with the
notes only ([admin-modules.md](admin-modules.md)), so with the notes off an operator does not see
another kind's files there yet.

`tests/integration/attachment-kinds.integration.test.ts` registers a second kind beside the note
and is the example to copy.

## Profile pictures

A person may put a picture where their initials are
([#228](https://github.com/spy4x/seed/issues/228)). It is a JPEG, PNG, WebP or HEIC of 10 MiB at
most, room for a phone's photo. It is [processed](file-uploads.md#process-photos), and every avatar
shows its narrowest WebP, cropped to a circle.

| Part       | Where                                                                             |
| ---------- | --------------------------------------------------------------------------------- |
| Rules      | `PICTURE_TYPES`, `PICTURE_MAX_BYTES` in `libs/domain/identity/profile-picture.ts` |
| Handlers   | `apps/api/features/profile/picture.ts`                                            |
| Operations | `picture.sign`, `.confirm`, `.cancel`, `.remove`                                  |

The person is always the session's own.

### Setting and removing

1. **Sign** checks the type and size and signs the upload, under the same waiting count and budget
   as attachments.
2. **Confirm** moves the bytes to `pictures/<id>` and checks them. It then sets the person's picture
   with an audit row, and queues the picture's processing.
3. The picture it replaced is deleted from the store at once. When the store does not answer, the
   worker deletes it later.

**Remove** clears the picture the same way. An operator removes one from the person's page in the
admin app, which is audited; the worker deletes the file. An operator never uploads one. The
picture of an account deleted for good is deleted too.

### Showing it

Every avatar's `src` is `/api/pictures/<id>`.

- A signed-in person who may see it gets a redirect to a signed URL of its narrowest WebP. That is
  their own picture, or a member's of a group they share. A browser may keep it for four minutes.
- Anyone else gets a 404, as for a picture that does not exist.
- Until the worker has made the WebP, which takes seconds, and for a refused picture, it answers
  404. The original is never served.
- A picture kept before processing existed is served as stored.

The admin app may not load the store's host (its `img-src` is `'self'`). So its avatars use
`/api/admin/users/pictures/<id>`, which answers the bytes themselves with `nosniff`.

### While it is prepared

The picture is Preparing from Confirm until its job sets it to Ready or Refused. Every page the
person has open then reads the profile again.

- Pages ask for a picture only once it is ready, so nobody waits on a 404.
- The group's members list leaves it out until then.
- The profile says "Preparing your picture…" meanwhile, and "We could not use that picture. Choose
  another." after a refusal.
- In the admin app, the user list and the person's page show the initials meanwhile. The page's
  "Profile picture" row says "Preparing the picture…", or "This picture could not be used." after a
  refusal, and the operator can still remove it.
- A new picture has a new id, so nothing stale shows.

## Next

- [The file store](files.md): settings and the upload budget.
- [Add file uploads to a feature](file-uploads.md): the same flow for a new feature.
