/**
 * Processed images (#464, docs/files.md): an uploaded photo becomes upright AVIF and WebP widths
 * with no metadata, and its original, which may carry where it was taken, is deleted.
 *
 * A feature that keeps a photo calls {@link queueImage} in the transaction that keeps it. The
 * worker then runs `processImage` of `@spy4x/server/images` on it in two jobs (#514). The first,
 * {@link IMAGE_PROCESS_JOB}, makes only the narrowest width, the one the admin's thumbnails show,
 * records it in `image_variants` and queues the second. The second, {@link IMAGE_WIDTHS_JOB},
 * makes the wider ones, marks the image processed and the owner's picture ready (or refused), tells
 * their open pages, and deletes the original last. On the worker's half a CPU the narrowest width
 * takes about a second and the widest AVIF about six, so a batch of photos gets every preview
 * before any photo's wide widths.
 *
 * @module
 */

import type postgres from "postgres"
import { IMAGE_WIDTHS, type ImageRefusal, processImage } from "@spy4x/server/images"
import { enqueueJob, type JobHandler } from "../jobs/jobs.ts"
import type { ServerFiles } from "./files.ts"
import { PictureState } from "@domain/identity"
import { announcePictureState } from "../auth/picture-state.ts"

/** The job that makes an image's narrowest width. Its `aboutId` is the `images` row's id. */
export const IMAGE_PROCESS_JOB = `files.image-process`

/** The job that makes an image's wider widths and finishes it. Its `aboutId` is the same id. */
export const IMAGE_WIDTHS_JOB = `files.image-widths`

/** What the first job makes: the width the admin's thumbnails show (`photoThumbnail`). */
export const IMAGE_FIRST_WIDTHS: readonly number[] = IMAGE_WIDTHS.slice(0, 1)

/** What the second job makes: every other width. */
export const IMAGE_LATER_WIDTHS: readonly number[] = IMAGE_WIDTHS.slice(1)

/** How long one image may take before the run is stopped and retried. */
export const IMAGE_PROCESS_TIMEOUT_MS = 120_000

/**
 * Keeps the photo at `objectKey` as image `id` and queues its processing. Inside the transaction
 * that keeps the photo, so a rollback queues nothing.
 */
export async function queueImage(sql: postgres.Sql, id: string, objectKey: string): Promise<void> {
  await sql`INSERT INTO images (id, object_key) VALUES (${id}, ${objectKey})`
  await enqueueJob(sql, IMAGE_PROCESS_JOB, id, { inMs: 0 })
}

/**
 * A folder of its own for one run, since `vips` reads and writes files. The worker passes one on
 * the local disk (`apps/worker/+main.ts`); a test passes a fake.
 */
export interface ImageScratch {
  /** Makes a new folder, writes `bytes` into it, and answers the folder and the file's path. */
  open(bytes: Uint8Array): Promise<{ dir: string; input: string }>
  read(path: string): Promise<Uint8Array>
  /** Removes the folder and everything in it. */
  close(dir: string): Promise<void>
}

export interface ImageProcessJobDeps {
  sql: postgres.Sql
  /** `null` when the worker has no file store settings: the job fails and is retried. */
  files: ServerFiles | null
  /** `null` when the worker has no disk to work on: the job fails and is retried. */
  scratch: ImageScratch | null
  /** `processImage` unless a test passes its own. */
  process?: typeof processImage
}

interface StoredVariant {
  objectKey: string
  contentType: string
  width: number
  height: number
}

/**
 * Makes the image's narrowest width, stores and records it, and queues {@link IMAGE_WIDTHS_JOB}
 * in the same transaction, so the admin shows the photo while the wider widths are made. A run
 * that finds the width recorded already (a retry after that transaction) queues nothing again. A
 * refused image is finished here, as the second job would finish it.
 */
export function imageProcessJob(deps: ImageProcessJobDeps): JobHandler {
  return imageJob(deps, IMAGE_FIRST_WIDTHS, true)
}

/**
 * Makes the image's wider widths and finishes it. An image that is gone (its picture was replaced)
 * does nothing. One processed already only has its original deleted, so a run again, or one after
 * a crash between the transaction and that delete, changes nothing else. A crash before the
 * transaction stores the same variants again under the same keys. A refused image (not an image,
 * too large) is marked so, keeps no variant, and loses its original too.
 */
export function imageWidthsJob(deps: ImageProcessJobDeps): JobHandler {
  return imageJob(deps, IMAGE_LATER_WIDTHS, false)
}

function imageJob(
  deps: ImageProcessJobDeps,
  widths: readonly number[],
  first: boolean,
): JobHandler {
  const process = deps.process ?? processImage
  return async (event) => {
    const id = event.aggregateId
    const [image] = await deps.sql<{ objectKey: string; processedAt: Date | null }[]>`
      SELECT object_key, processed_at FROM images WHERE id = ${id}
    `
    if (!image) return
    const files = deps.files
    if (!files) throw new Error(`the worker has no file store settings`)
    const scratch = deps.scratch
    if (!scratch) throw new Error(`the worker has no folder to process images in`)
    if (image.processedAt) return await files.delete(image.objectKey)
    const bytes = await files.read(image.objectKey)
    if (bytes === null) throw new Error(`the image's original is not in the store`)
    // A photo narrower than a later width gets it at its own width, which the first job made.
    const made = new Set(
      (await deps.sql<{ objectKey: string }[]>`
        SELECT object_key FROM image_variants WHERE image_id = ${id}
      `).map((row) => row.objectKey),
    )

    const { dir, input } = await scratch.open(bytes)
    const variants: StoredVariant[] = []
    let refused: ImageRefusal | null = null
    try {
      const result = await process(input, dir, {
        widths,
        signal: AbortSignal.timeout(IMAGE_PROCESS_TIMEOUT_MS),
      })
      if (!result.success) refused = result.error
      for (const variant of result.output ?? []) {
        const objectKey = `${image.objectKey}/${variant.path.split(`/`).pop()}`
        if (made.has(objectKey)) continue
        await files.put(objectKey, await scratch.read(variant.path))
        const { type: contentType, width, height } = variant
        variants.push({ objectKey, contentType, width, height })
      }
    } finally {
      await scratch.close(dir)
    }

    const finish = !first || refused !== null
    const gone = await deps.sql.begin(async (tx) => {
      const [row] = await tx<{ processedAt: Date | null }[]>`
        SELECT processed_at FROM images WHERE id = ${id} FOR UPDATE
      `
      if (!row || row.processedAt) return !row
      if (finish) {
        await tx`UPDATE images SET processed_at = now(), refused = ${refused} WHERE id = ${id}`
        const owners = await tx<{ id: number }[]>`
          UPDATE users SET updated_at = now(),
            picture_state = ${refused === null ? PictureState.Ready : PictureState.Refused}
          WHERE picture_id = ${id}
          RETURNING id
        `
        for (const owner of owners) await announcePictureState(tx, owner.id)
      }
      let added = 0
      for (const variant of variants) {
        const inserted = await tx`
          INSERT INTO image_variants (object_key, image_id, content_type, width, height)
          VALUES (${variant.objectKey}, ${id}, ${variant.contentType}, ${variant.width},
            ${variant.height})
          ON CONFLICT (object_key) DO NOTHING
        `
        added += inserted.count
      }
      if (!finish && added > 0) await enqueueJob(tx, IMAGE_WIDTHS_JOB, id, { inMs: 0 })
      return false
    })
    // Its picture was replaced meanwhile: these copies belong to no row. (One another run finished
    // first keeps them: they are its variants, under the same keys.)
    if (gone) {
      for (const variant of variants) await files.delete(variant.objectKey)
    }
    if (gone || finish) await files.delete(image.objectKey)
  }
}
