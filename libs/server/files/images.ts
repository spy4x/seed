/**
 * Processed images (#464, docs/files.md): an uploaded photo becomes upright AVIF and WebP widths
 * with no metadata, and its original, which may carry where it was taken, is deleted.
 *
 * A feature that keeps a photo calls {@link queueImage} in the transaction that keeps it. The
 * worker's {@link IMAGE_PROCESS_JOB} then reads the original from the store, runs `processImage` of
 * `@spy4x/server/images` on it, stores the variants under `<original key>/<width>.<avif|webp>`,
 * records them in `image_variants`, marks the owner's picture ready (or refused) and tells their
 * open pages, and deletes the original last.
 *
 * @module
 */

import type postgres from "postgres"
import { type ImageRefusal, processImage } from "@spy4x/server/images"
import { enqueueJob, type JobHandler } from "../jobs/jobs.ts"
import type { ServerFiles } from "./files.ts"
import { PictureState } from "@domain/identity"
import { announcePictureState } from "../auth/picture-state.ts"

/** The job that processes one image. Its `aboutId` is the `images` row's id. */
export const IMAGE_PROCESS_JOB = `files.image-process`

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

/**
 * Processes the image the job names. An image that is gone (its picture was replaced) does
 * nothing. One processed already only has its original deleted, so a run again, or one after a
 * crash between the transaction and that delete, changes nothing else. A crash before the
 * transaction stores the same variants again under the same keys. A refused image (not an image,
 * too large) is marked so, keeps no variant, and loses its original too.
 */
export function imageProcessJob(deps: ImageProcessJobDeps): JobHandler {
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

    const { dir, input } = await scratch.open(bytes)
    const variants: { objectKey: string; contentType: string; width: number; height: number }[] = []
    let refused: ImageRefusal | null = null
    try {
      const result = await process(input, dir, {
        signal: AbortSignal.timeout(IMAGE_PROCESS_TIMEOUT_MS),
      })
      if (!result.success) refused = result.error
      for (const variant of result.output ?? []) {
        const objectKey = `${image.objectKey}/${variant.path.split(`/`).pop()}`
        await files.put(objectKey, await scratch.read(variant.path))
        const { type: contentType, width, height } = variant
        variants.push({ objectKey, contentType, width, height })
      }
    } finally {
      await scratch.close(dir)
    }

    const gone = await deps.sql.begin(async (tx) => {
      const [row] = await tx<{ processedAt: Date | null }[]>`
        SELECT processed_at FROM images WHERE id = ${id} FOR UPDATE
      `
      if (!row || row.processedAt) return !row
      await tx`UPDATE images SET processed_at = now(), refused = ${refused} WHERE id = ${id}`
      const owners = await tx<{ id: number }[]>`
        UPDATE users SET updated_at = now(),
          picture_state = ${refused === null ? PictureState.Ready : PictureState.Refused}
        WHERE picture_id = ${id}
        RETURNING id
      `
      for (const owner of owners) await announcePictureState(tx, owner.id)
      for (const variant of variants) {
        await tx`
          INSERT INTO image_variants (object_key, image_id, content_type, width, height)
          VALUES (${variant.objectKey}, ${id}, ${variant.contentType}, ${variant.width},
            ${variant.height})
          ON CONFLICT (object_key) DO NOTHING
        `
      }
      return false
    })
    // Its picture was replaced meanwhile: these copies belong to no row. (One another run finished
    // first keeps them: they are its variants, under the same keys.)
    if (gone) {
      for (const variant of variants) await files.delete(variant.objectKey)
    }
    await files.delete(image.objectKey)
  }
}
