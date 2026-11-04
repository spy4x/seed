# Add file uploads to a feature

> Also on the website: [seedsaas.com/docs/file-uploads](https://seedsaas.com/docs/file-uploads).

This page shows how a feature lets people upload and download files through the file store, and
how it has photos made safe and small.

**You need:** the file store set up ([files.md](files.md)).

`libs/server/files/files.ts` is the one module for files. The API's instance is `files`, in
`apps/api/services/files.ts`.

## Upload and download a file

1. Name what the feature accepts, with the allowed types and the largest size in bytes:

   ```ts
   const rule = fileRule([`image/png`, `image/jpeg`], 5 * 1024 * 1024)
   ```

2. When a person asks to upload, sign it:

   ```ts
   const upload = await files.signUpload(rule, { contentType, size })
   ```

   It refuses another type or a larger size. Otherwise its `output` holds a URL, the header to send
   with it, and the `stagingKey` the file lands on. The URL lasts five minutes.

3. Keep the staging key with the person who asked, so nobody else can confirm it.
4. The browser sends the file with a `PUT` to that URL, then tells the API it is done.
5. Confirm it, with the feature's own key for the file and the type and size you signed:

   ```ts
   const confirmed = await files.confirmUpload(stagingKey, key, { contentType, size })
   ```

   The store copies the file to `key` and deletes the staging copy. It then reads the copy's size,
   type and first bytes, and deletes and refuses a file that is not what was signed. Both calls
   answer `{ success, output, error }`.

6. Only now write the file's row to the feature's table.
7. To let someone download it, sign a `GET` that lasts five minutes:

   ```ts
   const url = await files.signDownload(key, { contentType, filename })
   ```

The store answers a download with the confirmed type, never the stored one. An image is shown in
place, and any other file is saved under its name.

### Which types are allowed

Only types whose bytes the store can check: PNG, JPEG, GIF, WebP, HEIC, PDF, ZIP, plain text, CSV
and JSON (`SNIFFABLE_CONTENT_TYPES` of `@spy4x/server/storage`). SVG and HTML are not allowed,
because both can carry script.

### Keys and access

- Keys are the feature's choice, such as `notes/<group id>/<file id>`, with UUID version 7 ids.
- Never use a key under `uploads/tmp/`: staging keys live there.
- The feature's handler checks who may upload to or read a key, as for any other command.

Confirmed bytes cannot be replaced. No browser ever had a URL for the final key, and a `PUT` to an
old upload URL lands on the staging key again. A file never runs as a page of the app because of
how it is served: the forced type, `nosniff`, the sandbox policy and the attachment download.

## Store a file the server makes

A file the server makes itself, such as a data export ([data-export.md](data-export.md)), needs no
signed upload. The worker uses `s3ServerFiles` from the same module:

| Call                              | What it does                                           |
| --------------------------------- | ------------------------------------------------------ |
| `put(key, body)`                  | Stores the file.                                       |
| `delete(key)`                     | Deletes it.                                            |
| `deleteOlderThan(prefix, before)` | Deletes every file under `prefix` older than `before`. |

The worker reads the same settings as the API, without `S3_PUBLIC_ENDPOINT`.

## Process photos

A photo straight from a phone is a HEIC of several megabytes that only Safari shows. It also
carries where it was taken. A feature that keeps a photo for others to see has it processed
([#464](https://github.com/spy4x/seed/issues/464)):

1. In the transaction that keeps the photo, queue it:

   ```ts
   await queueImage(tx, imageId, key)
   ```

   This writes a row to `images` and queues the `files.image-process` job
   (`libs/server/files/images.ts`).

2. Show it with `responsiveImage` of `@spy4x/platform/universal/srcset`. It turns a row's variants
   into `srcset`, `sizes`, `width` and `height` for a `<picture>`.

The jobs make AVIF and WebP copies at 480, 960 and 1600 pixels wide, never wider than the photo.
Each copy is turned upright, with no EXIF, XMP, GPS or colour profile left. They are stored at
`<key>/<width>.avif` and `<key>/<width>.webp`, and listed in `image_variants` with their sizes.

The first job makes only the 480 width, then queues `files.image-widths` for the others. The second
job marks the image processed and only then deletes the original, so no copy that says where it was
taken stays. On the worker's half a CPU, the 480 width of a phone photo takes about a second and the
rest about nine. So the admin app shows every photo of a batch before any wide copy is made.

- **When it shows.** The admin app shows a photo once one copy exists; the website once it is
  processed.
- **Time limit.** A run stops after two minutes and is retried like any job ([jobs.md](jobs.md)).
- **Running twice** changes nothing. A retried job writes the same copies under the same keys. An
  image whose row is gone, because its picture was replaced meanwhile, leaves nothing behind.
- **A refused image** gets `images.refused`, no copy, and loses its original too. That is a file
  libvips cannot read, one that is not JPEG, PNG, WebP or HEIC, or one over 100 million pixels.
- **Deleting** an `images` row deletes its variants' rows. Both queue their files in
  `file_deletions`, which the worker empties.

The worker needs `vips-tools`, `vips-heif` and `libheif-aom`, which `Dockerfile.base` installs.
Compose gives it `--allow-run=vips,vipsheader`, and read and write access to `/tmp/images` only.

The catalog's photos are processed this way too ([catalog.md](catalog.md)). Note attachments are
not: they are kept and downloaded as uploaded.

## Next

- [Note attachments and profile pictures](attachments-and-pictures.md): two features built this
  way.
- [Background jobs](jobs.md): how the photo jobs run and retry.
