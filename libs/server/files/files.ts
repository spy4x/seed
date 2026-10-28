/**
 * The file store (docs/files.md): where a feature keeps a file, through the S3 API. Browsers
 * upload and download with signed URLs and never send a file through the API.
 *
 * A feature names what it accepts in a {@link FileRule}: the types and the largest size. Then:
 *
 * 1. {@link FileStore.signUpload} checks the browser's type and size against the rule and signs a
 *    PUT to a new staging key under {@link STAGING_PREFIX}, which the store accepts only with
 *    exactly that type and size.
 * 2. The browser PUTs the file and tells the API it is done.
 * 3. {@link FileStore.confirmUpload} copies the staging object, inside the store, to the feature's
 *    key, deletes the staging object, and checks the copy: its size, its type and its first bytes.
 *    A copy that is not what was signed is deleted and refused. No browser ever had a URL for the
 *    feature's key, so the bytes checked are the bytes kept: a PUT to the old upload URL lands
 *    on the staging key, never on a confirmed file.
 * 4. {@link FileStore.signDownload} signs a GET with the type the feature confirmed: an image is
 *    shown in place, any other file is saved as an attachment.
 *
 * What keeps a file from running as a page of the app is not the byte check but how it is served:
 * the forced `Content-Type`, `X-Content-Type-Options: nosniff`, the sandbox policy on every answer
 * of the store's route, and the attachment disposition for anything but an image.
 *
 * Two clients, one bucket: the API reaches the store at `S3_ENDPOINT`, and browsers at
 * `S3_PUBLIC_ENDPOINT`. A signature covers the host, so each URL is signed for the host that uses
 * it.
 *
 * @module
 */

import {
  matchesContentType,
  S3Storage,
  SNIFF_BYTES,
  SNIFFABLE_CONTENT_TYPES,
} from "@spy4x/server/storage"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** The S3 calls the file store makes. `S3Storage` has them all; a test passes a fake. */
export type ObjectStore = Pick<
  S3Storage,
  `presignPut` | `presignGet` | `head` | `getRange` | `copy` | `delete` | `list`
>

/** The file store's settings, read from the API's environment (`apps/api/services/config.ts`). */
export interface FileStoreSettings {
  /** Where the API reaches the store, such as `http://app-garage:3900`. */
  endpoint: string
  /** Where browsers reach it, such as `https://app.example.com`. */
  publicEndpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

/** What a feature accepts: the types, and the largest size in bytes. */
export interface FileRule {
  types: readonly string[]
  maxBytes: number
}

/** The file as the browser describes it, or as it was signed. */
export interface FileFacts {
  contentType: string
  size: number
}

/** Why the store refused a file. */
export enum FileRefusal {
  /** The type is not one the rule accepts, or not the one signed. */
  Type = 1,
  /** Empty, over the rule's limit, or not the size signed. */
  Size = 2,
  /** Nothing was uploaded under the key. */
  Missing = 3,
  /** The bytes are not the type the file claims. */
  Content = 4,
}

/**
 * A signed upload: the browser PUTs the file to `url` with these headers. `stagingKey` is where it
 * lands; the feature keeps it with the upload's owner and passes it to `confirmUpload`.
 */
export interface SignedUpload {
  url: string
  headers: { "content-type": string }
  stagingKey: string
}

/** `{ success, output, error }`: the value, or why the file was refused. */
export type FileResult<T> =
  | { success: true; output: T; error?: undefined }
  | { success: false; output?: undefined; error: FileRefusal }

/** Where browser uploads land until they are confirmed. A feature's keys are never under it. */
export const STAGING_PREFIX = `uploads/tmp/`

/** How long a signed upload or download stays valid: five minutes. */
export const FILE_URL_SECONDS = 300

/**
 * A rule for a feature's files.
 * @throws {Error} When a type cannot be confirmed by its bytes, or the limit is not a positive
 * whole number: a rule the store cannot enforce must not exist.
 */
export function fileRule(types: readonly string[], maxBytes: number): FileRule {
  const unknown = types.filter((type) => !SNIFFABLE_CONTENT_TYPES.includes(type))
  if (types.length === 0 || unknown.length > 0) {
    throw new Error(`A file rule needs types the store can confirm; not: ${unknown.join(`, `)}`)
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`A file rule's limit must be a positive whole number of bytes`)
  }
  return { types, maxBytes }
}

/** The bare type of a `Content-Type` value: lower case, without parameters. */
function bareType(contentType: string): string {
  return contentType.split(`;`)[0].trim().toLowerCase()
}

/** Why `file` breaks `rule`, or `null` when it does not. */
function breaks(rule: FileRule, file: FileFacts): FileRefusal | null {
  // A rule built by hand could name a type the bytes cannot confirm: refuse it here too.
  if (
    !rule.types.includes(file.contentType) || !SNIFFABLE_CONTENT_TYPES.includes(file.contentType)
  ) {
    return FileRefusal.Type
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > rule.maxBytes) {
    return FileRefusal.Size
  }
  return null
}

/**
 * The `Content-Disposition` a download is served with. An image is shown in place (`inline`); any
 * other file is saved (`attachment`), since text that passed the check can still be markup. A
 * caller that must have the file saved, such as a "Download" button, passes `kind`. The name comes
 * twice: an ASCII fallback with quotes, backslashes and control characters replaced, and the full
 * name in UTF-8 (RFC 6266).
 */
export function downloadDisposition(
  contentType: string,
  filename: string,
  kind: `inline` | `attachment` = bareType(contentType).startsWith(`image/`)
    ? `inline`
    : `attachment`,
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, `_`) || `file`
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/** The file store a feature uses. */
export interface FileStore {
  readonly bucket: string
  /** Signs one browser upload of `file` to a new staging key, when `rule` accepts it. */
  signUpload(rule: FileRule, file: FileFacts): Promise<FileResult<SignedUpload>>
  /**
   * Moves the upload at `stagingKey` to `key` and checks the moved file against what was signed:
   * its size, its type and its first bytes. A file that fails is deleted. After a successful copy
   * the staging object is deleted too, and later PUTs to its URL never reach `key`.
   * @throws {Error} When `stagingKey` is not under {@link STAGING_PREFIX} or `key` is.
   */
  confirmUpload(stagingKey: string, key: string, signed: FileFacts): Promise<FileResult<FileFacts>>
  /**
   * Signs one download of `key`, a file `confirmUpload` accepted as `contentType`. The store
   * answers with that type, never the stored one, and with {@link downloadDisposition}.
   */
  signDownload(key: string, file: { contentType: string; filename: string }): Promise<string>
  /** Deletes `key`; a missing one is not an error. */
  delete(key: string): Promise<void>
  /**
   * The bytes of a confirmed file, read whole into memory, or `null` when it is gone. Only for a
   * small file, such as a profile picture's small width, that a page of another host shows.
   */
  read(key: string): Promise<Uint8Array | null>
  /** Whether the store answers, for the health route and the operator's System page. */
  isReachable(): Promise<boolean>
}

/** The whole object at `key`, or `null` when it is gone. */
async function readWhole(
  store: Pick<S3Storage, `head` | `getRange`>,
  bucket: string,
  key: string,
): Promise<Uint8Array | null> {
  const info = await store.head(bucket, key)
  if (info === null) return null
  if (info.size === 0) return new Uint8Array()
  return await store.getRange(bucket, key, 0, info.size - 1)
}

/**
 * The file store over two clients for one bucket: `internal` for the API's own calls, and
 * `browser` for the URLs it signs for browsers.
 */
export function createFileStore(
  internal: ObjectStore,
  browser: ObjectStore,
  bucket: string,
): FileStore {
  return {
    bucket,
    async signUpload(rule, file) {
      const refusal = breaks(rule, file)
      if (refusal !== null) return { success: false, error: refusal }
      const stagingKey = `${STAGING_PREFIX}${uuidV7()}`
      const url = await browser.presignPut(bucket, stagingKey, {
        contentType: file.contentType,
        contentLength: file.size,
        expiresIn: FILE_URL_SECONDS,
      })
      const headers = { "content-type": file.contentType }
      return { success: true, output: { url, headers, stagingKey } }
    },
    async confirmUpload(stagingKey, key, signed) {
      if (!stagingKey.startsWith(STAGING_PREFIX) || key.startsWith(STAGING_PREFIX)) {
        throw new Error(`confirmUpload moves a key under ${STAGING_PREFIX} to one outside it`)
      }
      if (await internal.head(bucket, stagingKey) === null) {
        return { success: false, error: FileRefusal.Missing }
      }
      await internal.copy(bucket, stagingKey, key)
      await internal.delete(bucket, stagingKey)
      // The checks read the copy: nothing a browser PUTs from here on can change it.
      const info = await internal.head(bucket, key)
      if (info === null) return { success: false, error: FileRefusal.Missing }
      let refusal: FileRefusal | null = null
      if (info.size !== signed.size) refusal = FileRefusal.Size
      else if (bareType(info.contentType ?? ``) !== bareType(signed.contentType)) {
        refusal = FileRefusal.Type
      } else {
        const head = await internal.getRange(bucket, key, 0, SNIFF_BYTES - 1)
        if (!matchesContentType(head, signed.contentType)) refusal = FileRefusal.Content
      }
      if (refusal === null) return { success: true, output: signed }
      await internal.delete(bucket, key)
      return { success: false, error: refusal }
    },
    signDownload(key, file) {
      return browser.presignGet(bucket, key, {
        expiresIn: FILE_URL_SECONDS,
        responseContentType: file.contentType,
        responseContentDisposition: downloadDisposition(file.contentType, file.filename),
      })
    },
    delete(key) {
      return internal.delete(bucket, key)
    },
    read: (key) => readWhole(internal, bucket, key),
    async isReachable() {
      try {
        await internal.list(bucket, ``, { maxKeys: 1 })
        return true
      } catch {
        return false
      }
    },
  }
}

/**
 * The file store for `settings`. Path-style addressing (`<endpoint>/<bucket>/<key>`) on both
 * clients: Garage serves no bucket host names, and the browser's URLs stay on the app's host.
 */
export function s3FileStore(settings: FileStoreSettings): FileStore {
  const client = (endpoint: string) =>
    new S3Storage({
      endpoint,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      forcePathStyle: true,
    })
  return createFileStore(
    client(settings.endpoint),
    client(settings.publicEndpoint),
    settings.bucket,
  )
}

/**
 * What a worker job needs to keep a file it made itself, such as a data export (#229): no browser
 * takes part, so nothing is signed and nothing is confirmed. `deleteOlderThan` removes every object
 * under `prefix` stored before `before`, the safety net for a file whose row or job was lost.
 */
export interface ServerFiles {
  put(key: string, body: Uint8Array): Promise<void>
  /** The bytes of `key`, read whole into memory, or `null` when it is gone. */
  read(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  deleteOlderThan(prefix: string, before: Date): Promise<number>
}

/** {@link ServerFiles} over the store's internal client. */
export function createServerFiles(
  store: Pick<S3Storage, `upload` | `delete` | `list` | `head` | `getRange`>,
  bucket: string,
): ServerFiles {
  return {
    put: (key, body) => store.upload(bucket, key, body),
    read: (key) => readWhole(store, bucket, key),
    delete: (key) => store.delete(bucket, key),
    async deleteOlderThan(prefix, before) {
      let removed = 0
      let continuationToken: string | undefined
      do {
        const page = await store.list(bucket, prefix, { continuationToken })
        for (const object of page.objects) {
          if (object.lastModified && object.lastModified < before) {
            await store.delete(bucket, object.key)
            removed++
          }
        }
        continuationToken = page.continuationToken
      } while (continuationToken)
      return removed
    },
  }
}

/** {@link ServerFiles} for `settings`, reaching the store at `endpoint` as the API does. */
export function s3ServerFiles(settings: Omit<FileStoreSettings, `publicEndpoint`>): ServerFiles {
  return createServerFiles(
    new S3Storage({
      endpoint: settings.endpoint,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      forcePathStyle: true,
    }),
    settings.bucket,
  )
}
