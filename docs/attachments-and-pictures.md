# Note attachments and profile pictures

> Also on the website: [seedsaas.com/docs/attachments-and-pictures](https://seedsaas.com/docs/attachments-and-pictures).

This page explains the two features Seed builds on the file store: files kept on a note, and a
person's picture in place of their initials.

Both use the signed upload of [file-uploads.md](file-uploads.md). Both share one waiting count and
one hourly [upload budget](files.md#upload-budget).

## Note attachments

A note keeps images (JPEG, PNG, WebP, GIF) and PDFs. Every member of the group reads them. An
editor or above adds and removes them, as for the note itself.

| Part       | Where                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| Domain     | `libs/domain/notes/attachments.ts`                                        |
| Handlers   | `apps/api/features/notes/attachments.ts`                                  |
| Table      | `note_attachments`                                                        |
| Operations | `attachment.sign`, `.confirm`, `.cancel`, `.remove`, `.list`, `.download` |

### Adding a file

1. **Sign.** The handler checks the role, the note and every limit. It signs the upload and keeps
   a row in `file_uploads` with the staging key, for the person who asked.
2. **Upload.** The browser sends the file to the store.
3. **Confirm.** The handler settles that row for the same person, so a second confirm finds
   nothing. The store moves the bytes to `attachments/<id>` and checks them.
4. **Keep.** The row is added under a lock on the group, after the role and the limits are checked
   again. A file refused at this point is deleted from the store.

The page cancels a waiting upload when the person cancels it, before a retry, and when they open
another note. It then stops counting as waiting at once.

### Limits

- **Waiting uploads.** One person has at most 20 uploads waiting
  (`ATTACHMENT_PENDING_MAX`). An upload waits for 10 minutes after it is signed
  (`ATTACHMENT_PENDING_MINUTES`), until it is confirmed or cancelled. An abandoned upload never
  locks anyone out.
- **Upload budget.** At most 50 uploads and 50 MiB an hour per person, whatever the plan
  ([files.md](files.md#upload-budget)). Signs sent at once wait for each other, so each counts the
  ones before it.
- **Plan limits.** The group's plan (`PLANS` in `libs/domain/billing`) sets `maxAttachments` and
  `storageBytes` for the group. Its `attachments` rule sets `maxFileBytes` for one file and
  `maxPerNote` for one note.
- **Billing off.** The group's caps are lifted like every other cap. The file and note rules stay.

A deleted note's files count until it is purged.

### Deleting and clean-up

- Deleting an attachment, its note, its group or its owner's account queues its file in
  `file_deletions`.
- Removing an attachment deletes its file at once when the store answers.
- The worker's nightly clean-up deletes every queued file. It also forgets uploads signed more than
  a day ago and deletes staging files older than a day.

### Downloads and exports

- A download is signed only for a member of the file's group.
- A group's JSON export holds notes and tags only, not files.
- A person's data export ([data-export.md](data-export.md)) lists the files they attached, without
  their bytes.

### In the admin panel

The admin app lists a group's files by name, with the note's title, the uploader and the date. It
searches and pages them. An operator can open, download or remove a file, and each open or download
is audited ([admin-modules.md](admin-modules.md)).

The bytes go through the admin API with `nosniff`. Only a JPEG, PNG, WebP or GIF is shown in place;
any other file is saved. The route's sandbox policy is replaced by the app's own until
[spy4x/ts-libs#772](https://github.com/spy4x/ts-libs/issues/772) is released.

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
