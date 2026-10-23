# The file store

Seed keeps files in an S3 store. With `files` in `COMPOSE_PROFILES` (the default) Compose runs
[Garage](https://garagehq.deuxfleurs.fr), a small S3 server, beside the apps, so a self-hosted
product needs no outside service. Moving to another S3 store, such as Hetzner Object Storage, is a
change of settings.

Browsers upload and download with signed URLs: the API signs, the store checks the signature, and
no file passes through the API. Nothing in the template uploads a file yet; note attachments
([#225](https://github.com/spy4x/seed/issues/225)), profile pictures
([#228](https://github.com/spy4x/seed/issues/228)) and data exports
([#229](https://github.com/spy4x/seed/issues/229)) build on it.

## How a feature uses it

`libs/server/files/files.ts` is the one module; the API's instance is `files` in
`apps/api/services/files.ts`.

1. Name what the feature accepts: `fileRule([`image/png`, `image/jpeg`], 5 * 1024 * 1024)`. Only
   types whose bytes the store can check are allowed (`SNIFFABLE_CONTENT_TYPES` of
   `@spy4x/server/storage`: PNG, JPEG, GIF, WebP, PDF, ZIP, plain text, CSV, JSON). SVG and HTML are
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

Keys are the feature's choice, such as `notes/<group id>/<file id>`, with UUID version 7 ids,
never under `uploads/tmp/`. The authorization check (who may upload to or read a key) belongs to the
feature's handler, as for any other command.

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
