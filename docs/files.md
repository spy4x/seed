# The file store

Seed keeps files in an S3 store. With `files` in `COMPOSE_PROFILES` (the default) Compose runs
[Garage](https://garagehq.deuxfleurs.fr), a small S3 server, beside the apps, so a self-hosted
product needs no outside service. Moving to another S3 store, such as Hetzner Object Storage, is a
change of settings.

Browsers upload and download with signed URLs: the API signs, the store checks the signature, and
no file passes through the API. Note attachments and profile pictures use it (below); data
exports ([#229](https://github.com/spy4x/seed/issues/229)) build on it.

## How a feature uses it

`libs/server/files/files.ts` is the one module; the API's instance is `files` in
`apps/api/services/files.ts`.

1. Name what the feature accepts: `fileRule([`image/png`, `image/jpeg`], 5 * 1024 * 1024)`. Only
   types whose bytes the store can check are allowed (`SNIFFABLE_CONTENT_TYPES` of
   `@spy4x/server/storage`: PNG, JPEG, GIF, WebP, HEIC, PDF, ZIP, plain text, CSV, JSON). SVG and HTML are
   not among them: both can carry script.
2. `files.signUpload(rule, { contentType, size })` refuses another type or a size over the limit,
   and otherwise answers a URL, the header to PUT with, and the `stagingKey` the file lands on
   (`uploads/tmp/<UUID v7>`). Type and size are signed, so the store refuses any other. The URL
   lasts five minutes. Keep the staging key with the person who asked for it, so nobody else can
   confirm it.
3. The browser PUTs the file and tells the API it is done.
4. `files.confirmUpload(stagingKey, key, signed)` copies the staging object, inside the store, to
   the feature's `key`, deletes the staging object, and reads the copy: its size, its type and its
   first 512 bytes. A file that is not what was signed is deleted and refused. Only a confirmed
   file goes into the feature's table. Confirmed bytes cannot be replaced: no browser ever had a
   URL for `key`, and a PUT to the old upload URL lands on the staging key again, never on the
   confirmed file. What keeps a file from running as a page of the app is how it is served: the
   forced type, `nosniff`, the sandbox policy and the attachment disposition below.
5. `files.signDownload(key, { contentType, filename })` signs a GET for five minutes. The store
   answers with the confirmed type, never the stored one; an image is shown in place, and any other
   file is saved as an attachment under its name.

A file the server makes itself, such as a person's data export ([data-export.md](data-export.md)),
needs no signed upload: the worker stores it with `put(key, body)` of `s3ServerFiles` (the same
module), deletes it with `delete(key)` and sweeps old ones with `deleteOlderThan(prefix, before)`.
The worker reads the same settings as the API, without `S3_PUBLIC_ENDPOINT`
(`readServerFilesSetup`).

Keys are the feature's choice, such as `notes/<group id>/<file id>`, with UUID version 7 ids,
never under `uploads/tmp/`. The authorization check (who may upload to or read a key) belongs to the
feature's handler, as for any other command.

## Processed images

A photo straight from a phone is a HEIC of several megabytes that only Safari shows, and it
carries where it was taken. A feature that keeps a photo for others to see has it processed
(#464): `queueImage(tx, id, key)` (`libs/server/files/images.ts`), in the transaction that keeps
the photo, writes a row to `images` and queues the `files.image-process` job.

- **The jobs** read the original from the store into a folder of their own under `/tmp/images`,
  run `processImage` of `@spy4x/server/images` on it, and store the variants it makes: AVIF and
  WebP at 480, 960 and 1600 pixels wide, never wider than the photo, turned upright, with no
  EXIF, XMP, GPS or colour profile left. They go to `<key>/<width>.avif` and `<key>/<width>.webp`
  and into `image_variants` with their sizes. The first job, `files.image-process`, makes only the
  480 width and queues `files.image-widths`, which makes the others, sets `images.processed_at`,
  and only then deletes the original, so no copy that says where it was taken stays. The split
  (#514) is for speed: on the worker's half a CPU a phone photo's 480 width takes about a second
  and the rest about nine, so the admin shows every photo of a batch before any wide width is
  made. The admin shows a photo once a variant exists; the website once it is processed. A run
  stops after two minutes and is retried like any job ([jobs.md](jobs.md)).
- **Running it twice** changes nothing: a processed image only has its original deleted again, a
  first job that finds its width recorded queues nothing again, and a crash before the row is
  marked writes the same variants under the same keys. An image whose
  row is gone (its picture was replaced meanwhile) leaves nothing behind.
- **A refused image** (libvips cannot read it, it is not JPEG, PNG, WebP or HEIC, or it has more
  than 100 million pixels) gets `images.refused`, no variant, and loses its original too.
- **Deleting.** Deleting an `images` row deletes its variants' rows, and both queue their objects
  in `file_deletions`. A replaced or removed profile picture deletes its image.
- **What the worker needs.** The base image installs `vips-tools`, `vips-heif` and `libheif-aom`
  (`Dockerfile.base`), and compose gives the worker `--allow-run=vips,vipsheader` and read and
  write access to `/tmp/images` only.
- **Showing one.** `responsiveImage` of `@spy4x/platform/universal/srcset` turns a row's variants
  into `srcset`, `sizes`, `width` and `height` for a `<picture>`.

The catalog's photos are processed this way too; their bytes reach the store through the API
([catalog.md](catalog.md)). Note attachments are not processed: they are files kept and downloaded as uploaded.

## Note attachments

A note keeps images (JPEG, PNG, WebP, GIF) and PDFs. Every member of the group reads them; an
editor or above adds and removes them, as for the note. The domain is
`libs/domain/notes/attachments.ts`, the handlers `apps/api/features/notes/attachments.ts` and the
table `note_attachments`, with the operations `attachment.sign`, `.confirm`, `.cancel`, `.remove`,
`.list` and `.download`.

- **Sign.** The handler checks the role, the live note and every limit, signs the upload and
  keeps a row in `file_uploads` for the person who asked, with the staging key. Every feature's
  signed uploads share that table (`libs/server/files/upload-ledger.ts`), so the waiting count and
  the budget below count note attachments and profile pictures together. One person has at most
  20 uploads waiting (`ATTACHMENT_PENDING_MAX`): signed in the last ten
  minutes (`ATTACHMENT_PENDING_MINUTES`, the URL's five and five more) and neither confirmed nor
  cancelled. An older one can no longer be uploaded, so an abandoned upload never locks anyone out.
- **Upload budget.** Whatever the plan, and with billing off too, one person signs at most 50
  uploads and 50 MiB an hour, counted on every signed upload, confirmed or not. More is refused
  with `UPLOAD_BUDGET` (a 429 over HTTP). The waiting count, the budget and the new row are one
  transaction that locks the person's row first, so signs sent at once wait for each other and
  each counts the ones before it. This is what stops one account, a guest of the public demo
  included, from filling the server's disk; the plan's caps only limit what a group keeps. A
  server sets its own with `ATTACHMENT_UPLOAD_FILES_PER_HOUR` and
  `ATTACHMENT_UPLOAD_BYTES_PER_HOUR` (whole numbers; empty for the defaults). Each account has
  its own budget, and one client address can start 5 guest accounts an hour
  (`GUEST_STARTS_PER_HOUR`), so a stranger's ceiling grows with the accounts they open: 250
  uploads and 250 MiB in the first hour from one address, more as the accounts pile up.
- **Cancel.** The page cancels the person's own waiting upload when they cancel it, before a
  retry and when they open another note, so it stops counting as waiting at once.
- **Confirm.** The handler settles that row in one `UPDATE ... RETURNING` for the same person, so
  a second confirm of the same upload, or one by somebody else, finds nothing. The row stays for
  the budget. The store then moves the bytes to `attachments/<id>` and checks them; the row is
  added in a transaction that locks the group, checks the role again and counts the limits under
  the lock, before the insert. A file refused at that point is deleted from the store.
- **Limits** come from the group's plan (`PLANS` in `libs/domain/billing`): `maxAttachments` and
  `storageBytes` for the group, refused as a plan limit, and `attachments` (`maxFileBytes`,
  `maxPerNote`) for one file and one note. With billing off the group's caps are lifted like every
  other cap, and the file and note rules stay. A deleted note's files count until it is purged.
- **Deleting.** Deleting a row, by its removal or with its note, its group or its owner's account
  (foreign keys with `ON DELETE CASCADE`), queues its object in `file_deletions` (a trigger). A
  removal deletes the object at once when the store answers. The worker's nightly clean-up
  (`libs/server/notes/attachment-cleanup.ts`) deletes every queued object, forgets uploads signed
  more than a day ago, confirmed or not, and deletes staging objects older than a day.
- **Downloads** are signed for a member of the file's group only: every read joins the note and
  its group. The admin app lists a group's files by name, with the note's title, the uploader and
  the date, searches and pages them, and an operator can open, download or remove one
  ([admin-modules.md](admin-modules.md)). Its bytes go through the admin API with `nosniff` (the
  route's sandbox policy is replaced by the app's own until spy4x/ts-libs#772): only a JPEG, PNG,
  WebP or GIF is shown in place, any other file is saved, and each open or download is audited.
- **Exports.** A group's JSON export (`group.exported`) holds notes and tags only. A person's data
  export ([data-export.md](data-export.md)) lists the files they attached, without their bytes.

## Profile pictures

A person may put a picture where their initials are ([#228](https://github.com/spy4x/seed/issues/228)):
a JPEG, PNG, WebP or HEIC of 10 MiB at most (`PICTURE_TYPES`, `PICTURE_MAX_BYTES` in
`libs/domain/identity/profile-picture.ts`), room for a phone's photo. It is processed (above), and
every avatar shows its narrowest WebP, cropped to a circle with CSS. The handlers are `apps/api/features/profile/picture.ts`, with the operations
`picture.sign`, `.confirm`, `.cancel` and `.remove`; the person is always the session's.

- **Sign** checks the type and size, signs the upload and keeps it in `file_uploads` with no note,
  under the same waiting count and hourly budget as attachments.
- **Confirm** settles that row for the same person, moves the bytes to `pictures/<id>` and checks
  them, then sets `users.picture_id` and `picture_type` with an audit row (`PROFILE_UPDATED`,
  `picture`) and queues the picture's processing. The picture it replaced is deleted from the store at once; when the store does not
  answer, a trigger on `users` has queued it in `file_deletions` for the worker. The same trigger
  queues the picture of an account deleted for good.
- **Remove** clears the picture the same way. An operator removes one from the person's page in
  the admin app (`POST /api/admin/users/:id/picture/remove`, audited as
  `PICTURE_REMOVED_BY_OPERATOR`); the worker deletes its file. An operator never uploads one.
- **Showing it.** Every avatar's `src` is `/api/pictures/<id>`: for a signed-in person who may see
  it (their own, or a member's of a group they share), that answers a redirect to a five-minute
  signed URL of its narrowest WebP, which a browser may keep for four minutes. Until the worker
  has made it (seconds), and for a refused picture, it answers 404; the original is never served.
  A picture kept before processing existed is served as stored. Anyone else gets a 404, as for a
  picture that does not exist.
- **Its state.** `users.picture_state` (`PictureState`) is Preparing from Confirm until the job
  sets it to Ready or Refused, in its transaction, and announces it on the `user_picture` channel
  (`libs/server/auth/picture-state.ts`). The API turns that into the person's profile hint, so
  every page they have open reads the profile again. Pages ask for the picture only once it is
  ready (`shownPictureId`), and the group's members list leaves one out until then, so nobody
  waits on a 404. The profile row says "Preparing your picture…" meanwhile, and "We could not use
  that picture. Choose another." after a refusal, both in its status region. A new picture has a new id, so nothing stale shows. The admin app's host
  may not load the store's (its `img-src` is `'self'`), so its avatars use
  `/api/admin/users/pictures/<id>`, which answers the bytes themselves with the store's sandbox
  policy and `nosniff`. With another S3 store on an origin of its own, the SPA's `img-src` must
  allow that origin too, or every avatar shows initials.

## Where it runs

| Setting                | Bundled Garage (default)                    | Another S3 store                   |
| ---------------------- | ------------------------------------------- | ---------------------------------- |
| `COMPOSE_PROFILES`     | includes `files`                            | without `files`                    |
| `S3_ENDPOINT`          | empty: `http://<PROJECT>-garage:3900`       | the store's address                |
| `S3_PUBLIC_ENDPOINT`   | empty: `https://<DOMAIN>` (`http://` in dev) | the same address                   |
| `S3_REGION`            | `garage`                                    | the store's region                 |
| `S3_BUCKET`            | empty: `<PROJECT>-files`                    | the bucket's name                  |
| `S3_ACCESS_KEY_ID`     | `GK` and 24 hex characters                  | the store's key                    |
| `S3_SECRET_ACCESS_KEY` | 64 hex characters                           | the store's secret                 |
| `GARAGE_RPC_SECRET`    | 64 hex characters                           | any value but the example's        |

`deno task init` writes the key, the secret and the RPC secret into a new `infra/envs/.env`. An
env file written before the file store existed lacks them, and the API then refuses to start,
naming each missing setting: copy the file store block of `.env.example` into it and run
`deno task init` again. A deploy refuses the example's values.

The API reaches the store at `S3_ENDPOINT` and signs browser URLs for `S3_PUBLIC_ENDPOINT`, since a
signature covers the host. Both use path-style addresses (`<endpoint>/<bucket>/<key>`).

### The bundled Garage

- One node. Its data is in `.volumes/garage`; `infra/configs/garage.toml` is its configuration.
- Every start creates the key and the bucket from the env file when they are missing and changes
  nothing when they exist.
- Browsers reach it on the app's own host: Traefik sends `https://<DOMAIN>/<bucket>/…` to Garage
  and everything else to the SPA, so uploads are same-origin and the bucket needs no CORS rules.
  Every answer on that path carries `Content-Security-Policy: sandbox; default-src 'none'` and
  `X-Content-Type-Options: nosniff`, so a browser does not run a file as a page of the app's origin.
- The bucket is private: every request needs a signature, and only the API holds the key. Garage's
  admin port is not published.
- A new `S3_ACCESS_KEY_ID` is added next to the old key, which keeps its access. To retire the
  old one: `deno task compose exec garage /garage key delete --yes <old key id>`.
- `/api/health` and the admin app's System page report whether the API reaches the store. A store
  that does not answer leaves the API up (health says `degraded`): only uploads and downloads fail.
- Backups: [backups.md](backups.md).

### Another S3 store

Take `files` out of `COMPOSE_PROFILES`, set the six `S3_*` settings, and allow `PUT` and `GET` from
`https://<DOMAIN>`, with the `content-type` header, in the bucket's CORS rules: the browser now
uploads to another origin. Have the store answer with `X-Content-Type-Options: nosniff` where it
can. The store's own backups replace the ones above.

## Tests

`libs/server/files/files.test.ts` checks the rules against a fake store. `deno task test:files`
starts a Garage container of its own and uploads, confirms, downloads and deletes a file through
signed URLs, checks that bytes PUT to the upload URL after the confirm do not change the file, and
checks that the store refuses a larger body, another type, and an HTML page sent
as a PNG. CI does not run it, since its steps have no container tool.
