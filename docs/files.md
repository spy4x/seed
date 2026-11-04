# The file store

> Also on the website: [seedsaas.com/docs/files](https://seedsaas.com/docs/files).

This page sets up where Seed keeps files: the bundled Garage server, or another S3 store such as
Hetzner Object Storage.

Seed keeps files in an S3 store. By default, Compose runs [Garage](https://garagehq.deuxfleurs.fr),
a small S3 server, beside the apps, so a self-hosted product needs no outside service. Moving to
another S3 store is a change of settings.

Browsers upload and download with signed URLs. The API signs, the store checks the signature, and
no file passes through the API. Note attachments, profile pictures and data exports use it.

The other parts of this guide:

- [Add file uploads to a feature](file-uploads.md): the signed upload, keys and processed images.
- [Note attachments and profile pictures](attachments-and-pictures.md): the two features built on
  it.

## Use the bundled Garage

This is the default.

1. Keep `files` in `COMPOSE_PROFILES` in the env file.
2. Leave `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT` and `S3_BUCKET` empty.
3. On a new clone, write the key and the secrets:

   ```sh
   deno task init
   ```

4. Start the stack with `deno task dev`, or deploy:

   ```sh
   deno task deploy
   ```

Every start creates the key and the bucket from the env file when they are missing. It changes
nothing when they exist. A deploy refuses the example's values.

**An older env file** written before the file store existed lacks the settings, and the API refuses
to start, naming each missing one. Copy the file store block of `infra/envs/.env.example` into your
env file, then run `deno task init` again.

## Use another S3 store

1. Create a bucket and an access key in the store.
2. Take `files` out of `COMPOSE_PROFILES`.
3. Set the six `S3_*` settings below to the store's values.
4. In the bucket's CORS rules, allow `PUT` and `GET` from `https://<DOMAIN>`, with the
   `content-type` header. The browser now uploads to another origin.
5. Have the store answer with `X-Content-Type-Options: nosniff` where it can.
6. If the store's origin differs from the app's, allow it in the SPA's `img-src` too. Otherwise
   every avatar shows initials.

The store's own backups replace Seed's ([backups.md](backups.md)).

## Settings

| Setting                | Bundled Garage (default)                     | Another S3 store            |
| ---------------------- | -------------------------------------------- | --------------------------- |
| `COMPOSE_PROFILES`     | includes `files`                             | without `files`             |
| `S3_ENDPOINT`          | empty: `http://<PROJECT>-garage:3900`        | the store's address         |
| `S3_PUBLIC_ENDPOINT`   | empty: `https://<DOMAIN>` (`http://` in dev) | the same address            |
| `S3_REGION`            | `garage`                                     | the store's region          |
| `S3_BUCKET`            | empty: `<PROJECT>-files`                     | the bucket's name           |
| `S3_ACCESS_KEY_ID`     | `GK` and 24 hex characters                   | the store's key             |
| `S3_SECRET_ACCESS_KEY` | 64 hex characters                            | the store's secret          |
| `GARAGE_RPC_SECRET`    | 64 hex characters                            | any value but the example's |

The API reaches the store at `S3_ENDPOINT`. It signs browser URLs for `S3_PUBLIC_ENDPOINT`, since a
signature covers the host. Both use path-style addresses: `<endpoint>/<bucket>/<key>`.

## Upload budget

Whatever the plan, one person signs at most 50 uploads and 50 MiB an hour. Note attachments and
profile pictures count together, confirmed or not. More is refused with `UPLOAD_BUDGET`, a 429 over
HTTP. This stops one account, a guest of the public demo included, from filling the server's disk.

| Variable                           | What it does                     | Default           |
| ---------------------------------- | -------------------------------- | ----------------- |
| `ATTACHMENT_UPLOAD_FILES_PER_HOUR` | Uploads one person signs an hour | 50                |
| `ATTACHMENT_UPLOAD_BYTES_PER_HOUR` | Bytes one person signs an hour   | 52428800 (50 MiB) |

Both take whole numbers; leave them empty for the defaults. Each account has its own budget. One
client address can start 5 guest accounts an hour, so a stranger can sign 250 uploads and 250 MiB
in the first hour from one address, and more as the accounts pile up.

The plan's caps only limit what a group keeps ([attachments](attachments-and-pictures.md)).

## How the bundled Garage runs

- One node. Its data is in `.volumes/garage`, and `infra/configs/garage.toml` is its configuration.
- Browsers reach it on the app's own host. Traefik sends `https://<DOMAIN>/<bucket>/…` to Garage
  and everything else to the SPA. So uploads are same-origin, and the bucket needs no CORS rules.
- Every answer on that path carries `Content-Security-Policy: sandbox; default-src 'none'` and
  `X-Content-Type-Options: nosniff`. A browser then never runs a file as a page of the app.
- The bucket is private: every request needs a signature, and only the API holds the key. Garage's
  admin port is not published.
- Backups: [backups.md](backups.md).

A new `S3_ACCESS_KEY_ID` is added next to the old key, which keeps its access. To retire the old
one:

```sh
deno task compose exec garage /garage key delete --yes <old key id>
```

## Check it works

`/api/health` and the admin app's System page report whether the API reaches the store. A store
that does not answer leaves the API up, and health says `degraded`. Only uploads and downloads
fail.

To test the store end to end on your machine:

```sh
deno task test:files
```

It starts a Garage container of its own and uploads, confirms, downloads and deletes a file through
signed URLs. It also checks that the store refuses a larger body, another type, and an HTML page
sent as a PNG. CI does not run it, since CI's steps have no container tool.
`libs/server/files/files.test.ts` checks the rules against a fake store, in the usual tests.

## Next

- [Add file uploads to a feature](file-uploads.md)
- [Note attachments and profile pictures](attachments-and-pictures.md)
- [Backups](backups.md)
