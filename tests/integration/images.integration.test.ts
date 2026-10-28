/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import type postgres from "postgres"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { ImageRefusal, type processImage } from "@spy4x/server/images"
import type { ServerFiles } from "@server/files/files.ts"
import {
  IMAGE_WIDTHS_JOB,
  imageProcessJob,
  type ImageProcessJobDeps,
  type ImageScratch,
  imageWidthsJob,
} from "@server/files/images.ts"
import { readablePicture, setUserPicture } from "@server/auth/profile-pictures.ts"
import { listenForPictureStates } from "@server/auth/picture-state.ts"
import { PictureState } from "@domain/identity"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * Image processing (#464, docs/files.md) against a real Postgres built from schema.sql, with the
 * store, the folder on disk and `vips` faked: what the job keeps, what it deletes, and how a
 * profile picture is served before and after. Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME"
 * (recipe in docs/handoff.md); it fails when they are missing.
 */

/** A store that keeps what it was given and counts every put. */
function memoryFiles() {
  const stored = new Map<string, Uint8Array>()
  const puts: string[] = []
  const files: ServerFiles = {
    put: (key, body) => (puts.push(key), stored.set(key, body), Promise.resolve()),
    read: (key) => Promise.resolve(stored.get(key) ?? null),
    delete: (key) => (stored.delete(key), Promise.resolve()),
    deleteOlderThan: () => Promise.resolve(0),
  }
  return { files, stored, puts }
}

/** A folder kept in memory; `open` keeps the original under `<dir>/original`. */
function memoryScratch() {
  const written = new Map<string, Uint8Array>()
  let next = 0
  const scratch: ImageScratch = {
    open(bytes) {
      const dir = `/scratch/${next++}`
      written.set(`${dir}/original`, bytes)
      return Promise.resolve({ dir, input: `${dir}/original` })
    },
    read: (path) => Promise.resolve(written.get(path)!),
    close(dir) {
      for (const path of [...written.keys()]) if (path.startsWith(`${dir}/`)) written.delete(path)
      return Promise.resolve()
    },
  }
  return { scratch, written }
}

/**
 * A fake `processImage` for a photo 960 px wide: AVIF and WebP at each width it is asked for, none
 * wider than 960, or the refusal.
 */
function fakeProcess(
  written: Map<string, Uint8Array>,
  refusal: ImageRefusal | null = null,
  during: () => Promise<void> = () => Promise.resolve(),
): typeof processImage {
  return async (_input, dir, options) => {
    await during()
    if (refusal !== null) return { success: false, error: refusal }
    const widths = [...new Set((options?.widths ?? [480, 960]).map((w) => Math.min(w, 960)))]
    const output = (["avif", "webp"] as const).flatMap((extension) =>
      widths.map((width) => {
        const path = `${dir}/${width}.${extension}`
        written.set(path, new TextEncoder().encode(`${extension} bytes`))
        return { path, type: `image/${extension}` as const, width, height: width * 3 / 4 }
      })
    )
    return { success: true, output }
  }
}

/** A person whose picture `id` was just confirmed: its object stored, its image queued. */
async function personWithPicture(sql: postgres.Sql, stored: Map<string, Uint8Array>) {
  const userId = await insertUser(sql)
  const id = uuidV7()
  stored.set(`pictures/${id}`, new TextEncoder().encode(`heic with gps`))
  await sql.begin((tx) => setUserPicture(tx, userId, { id, contentType: `image/heic` }))
  return {
    userId,
    id,
    event: { aggregateId: id } as Parameters<ReturnType<typeof imageProcessJob>>[0],
  }
}

/** Both jobs, one after the other, as the worker runs them. */
async function processBoth(deps: ImageProcessJobDeps, event: { aggregateId: string }) {
  const job = event as Parameters<ReturnType<typeof imageProcessJob>>[0]
  await imageProcessJob(deps)(job)
  await imageWidthsJob(deps)(job)
}

async function stateOf(sql: postgres.Sql, userId: number) {
  const [row] = await sql<{ pictureState: number | null }[]>`
    SELECT picture_state FROM users WHERE id = ${userId}
  `
  return row.pictureState
}

async function variantsOf(sql: postgres.Sql, id: string) {
  return await sql<{ objectKey: string; contentType: string; width: number }[]>`
    SELECT object_key, content_type, width FROM image_variants WHERE image_id = ${id}
    ORDER BY object_key
  `
}

Deno.test("a new picture is queued, and the job stores its variants and deletes the original", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)
    expect(await stateOf(sql, userId)).toBe(PictureState.Preparing)
    const [queued] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM outbox_events
      WHERE event_kind = 'files.image-process' AND aggregate_id = ${id}
    `
    expect(queued.count).toBe(1)

    await processBoth({ sql, files, scratch, process: fakeProcess(written) }, event)

    expect([...stored.keys()].sort()).toEqual([
      `pictures/${id}/480.avif`,
      `pictures/${id}/480.webp`,
      `pictures/${id}/960.avif`,
      `pictures/${id}/960.webp`,
    ])
    expect(await variantsOf(sql, id)).toEqual([
      { objectKey: `pictures/${id}/480.avif`, contentType: `image/avif`, width: 480 },
      { objectKey: `pictures/${id}/480.webp`, contentType: `image/webp`, width: 480 },
      { objectKey: `pictures/${id}/960.avif`, contentType: `image/avif`, width: 960 },
      { objectKey: `pictures/${id}/960.webp`, contentType: `image/webp`, width: 960 },
    ])
    expect(written.size).toBe(0)
  })
})

/** How many runs of the wider widths' job wait for image `id`. */
async function widthsQueued(sql: postgres.Sql, id: string) {
  const [row] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM outbox_events
    WHERE event_kind = ${IMAGE_WIDTHS_JOB} AND aggregate_id = ${id} AND processed_at IS NULL
  `
  return row.count
}

Deno.test("the first job makes only the narrowest width, keeps the original and queues the rest", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)

    await imageProcessJob({ sql, files, scratch, process: fakeProcess(written) })(event)

    expect([...stored.keys()].sort()).toEqual([
      `pictures/${id}`,
      `pictures/${id}/480.avif`,
      `pictures/${id}/480.webp`,
    ])
    expect((await variantsOf(sql, id)).map((variant) => variant.width)).toEqual([480, 480])
    expect(await widthsQueued(sql, id)).toBe(1)
    expect(await stateOf(sql, userId)).toBe(PictureState.Preparing)
    // Shown already: the narrowest WebP is what a thumbnail asks for.
    expect((await readablePicture(sql, id, userId))?.objectKey).toBe(`pictures/${id}/480.webp`)
  })
})

Deno.test("the first job run again stores nothing again and queues the rest only once", async () => {
  await withSchema(async (sql) => {
    const { files, stored, puts } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { id, event } = await personWithPicture(sql, stored)
    const first = imageProcessJob({ sql, files, scratch, process: fakeProcess(written) })

    await first(event)
    await first(event)

    expect(puts.length).toBe(2)
    expect(await widthsQueued(sql, id)).toBe(1)
  })
})

Deno.test("a store that fails while the variants are stored keeps the original for the retry", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { id, event } = await personWithPicture(sql, stored)
    const failing = { ...files, put: () => Promise.reject(new Error(`store down`)) }

    await expect(
      imageProcessJob({ sql, files: failing, scratch, process: fakeProcess(written) })(event),
    ).rejects.toThrow(`store down`)

    expect([...stored.keys()]).toEqual([`pictures/${id}`])
    expect(await variantsOf(sql, id)).toEqual([])
  })
})

Deno.test("running the job twice stores nothing again and adds no row", async () => {
  await withSchema(async (sql) => {
    const { files, stored, puts } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { id, event } = await personWithPicture(sql, stored)
    const deps = { sql, files, scratch, process: fakeProcess(written) }

    await processBoth(deps, event)
    await processBoth(deps, event)

    expect(puts.length).toBe(4)
    expect((await variantsOf(sql, id)).length).toBe(4)
    expect(stored.has(`pictures/${id}`)).toBe(false)
  })
})

Deno.test("a refused image keeps no variant, loses its original and is marked refused", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)

    await imageProcessJob({
      sql,
      files,
      scratch,
      process: fakeProcess(written, ImageRefusal.Format),
    })(event)

    expect(await stateOf(sql, userId)).toBe(PictureState.Refused)
    expect(stored.size).toBe(0)
    expect(await variantsOf(sql, id)).toEqual([])
    const [image] = await sql<{ refused: number }[]>`SELECT refused FROM images WHERE id = ${id}`
    expect(image.refused).toBe(ImageRefusal.Format)
  })
})

Deno.test("a picture replaced while it is processed leaves no copy behind", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)
    const replace = () => sql.begin((tx) => setUserPicture(tx, userId, null)).then(() => {})

    await imageProcessJob({ sql, files, scratch, process: fakeProcess(written, null, replace) })(
      event,
    )

    expect([...stored.keys()]).toEqual([])
    const [image] = await sql`SELECT 1 FROM images WHERE id = ${id}`
    expect(image).toBeUndefined()
  })
})

Deno.test("a picture is served as its narrowest WebP once processed, never as its original", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)
    expect(await readablePicture(sql, id, userId)).toBeNull()

    await processBoth({ sql, files, scratch, process: fakeProcess(written) }, event)

    expect(await readablePicture(sql, id, userId)).toEqual({
      id,
      contentType: `image/webp`,
      objectKey: `pictures/${id}/480.webp`,
    })
  })
})

Deno.test("a picture kept before images were processed is served as stored", async () => {
  await withSchema(async (sql) => {
    const userId = await insertUser(sql)
    const id = uuidV7()
    await sql`UPDATE users SET picture_id = ${id}, picture_type = 'image/png', picture_state = 2 WHERE id = ${userId}`

    expect(await readablePicture(sql, id, userId)).toEqual({
      id,
      contentType: `image/png`,
      objectKey: `pictures/${id}`,
    })
  })
})

Deno.test("replacing a processed picture queues its original and every variant for deletion", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, id, event } = await personWithPicture(sql, stored)
    await processBoth({ sql, files, scratch, process: fakeProcess(written) }, event)

    await sql.begin((tx) => setUserPicture(tx, userId, null))

    const queued = await sql<{ objectKey: string }[]>`
      SELECT object_key FROM file_deletions ORDER BY object_key
    `
    expect(queued.map((row) => row.objectKey)).toEqual([
      `pictures/${id}`,
      `pictures/${id}/480.avif`,
      `pictures/${id}/480.webp`,
      `pictures/${id}/960.avif`,
      `pictures/${id}/960.webp`,
    ])
    expect(await variantsOf(sql, id)).toEqual([])
  })
})

Deno.test("a processed picture becomes ready, and the person's open pages are told", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { userId, event } = await personWithPicture(sql, stored)
    const heard: number[] = []
    const told = Promise.withResolvers<void>()
    const stop = await listenForPictureStates(sql, (id) => {
      heard.push(id)
      if (id === userId) told.resolve()
    })
    try {
      await processBoth({ sql, files, scratch, process: fakeProcess(written) }, event)
      const timer = setTimeout(() => told.reject(new Error(`no announcement within 5 s`)), 5000)
      await told.promise.finally(() => clearTimeout(timer))
    } finally {
      await stop()
    }

    expect(await stateOf(sql, userId)).toBe(PictureState.Ready)
    expect(heard).toContain(userId)
  })
})

Deno.test("a group lists a member's picture only once it is ready", async () => {
  await withSchema(async (sql) => {
    const { files, stored } = memoryFiles()
    const { scratch, written } = memoryScratch()
    const { repository, groupId, owner, editor } = await team(sql)
    const id = uuidV7()
    stored.set(`pictures/${id}`, new TextEncoder().encode(`png`))
    await sql.begin((tx) => setUserPicture(tx, editor, { id, contentType: `image/png` }))
    const pictureOf = async () =>
      (await repository.listMembers(groupId, owner))!.members
        .find((member) => member.userId === editor)!.pictureId

    expect(await pictureOf()).toBeNull()
    const event = { aggregateId: id } as Parameters<ReturnType<typeof imageProcessJob>>[0]
    await processBoth({ sql, files, scratch, process: fakeProcess(written) }, event)
    expect(await pictureOf()).toBe(id)
  })
})
