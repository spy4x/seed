/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import {
  PICTURE_MAX_BYTES,
  PictureCancelCommand,
  PictureConfirmCommand,
  PictureError,
  PictureRemoveCommand,
  PictureSignCommand,
  type User,
} from "@domain/identity"
import { ATTACHMENT_UPLOAD_BUDGET } from "@domain/notes"
import { FileRefusal, type FileStore } from "@server/files/files.ts"
import type { LedgerUpload, UploadRefusal } from "@server/files/upload-ledger.ts"
import type { UserProfileUpdatedEvent } from "../../cqrs/events.ts"
import {
  createPictureCancelHandler,
  createPictureConfirmHandler,
  createPictureRemoveHandler,
  createPictureSignHandler,
  type PictureHandlerDependencies,
} from "./picture.ts"

const OLD_PICTURE = `0190a000-0000-7000-8000-0000000000aa`

/**
 * The handlers over an in-memory ledger and `users` row, and a file store that records its calls.
 * `confirm` makes the store refuse the moved bytes; `refuse` makes the ledger refuse the sign;
 * `storeDown` makes every delete fail.
 */
function setUp(
  options: {
    confirm?: FileRefusal
    refuse?: UploadRefusal
    storeDown?: boolean
    picture?: string | null
    gone?: boolean
  } = {},
) {
  const calls: string[] = []
  const uploads = new Map<string, LedgerUpload & { settled: boolean }>()
  const emitted: UserProfileUpdatedEvent[] = []
  let picture: string | null = options.picture ?? null
  const forgotten: string[] = []
  let staged = 0
  const files: FileStore = {
    bucket: `files`,
    signUpload(rule, file) {
      calls.push(`signUpload ${file.contentType} ${file.size}`)
      if (!rule.types.includes(file.contentType)) {
        return Promise.resolve({ success: false, error: FileRefusal.Type })
      }
      if (file.size > rule.maxBytes) {
        return Promise.resolve({ success: false, error: FileRefusal.Size })
      }
      const stagingKey = `uploads/tmp/${++staged}`
      return Promise.resolve({
        success: true,
        output: {
          url: `https://app.example.test/${stagingKey}`,
          headers: {
            "content-type": file.contentType,
          },
          stagingKey,
        },
      })
    },
    confirmUpload(stagingKey, key, signed) {
      calls.push(`confirmUpload ${stagingKey} ${key}`)
      return Promise.resolve(
        options.confirm === undefined
          ? { success: true, output: signed }
          : { success: false, error: options.confirm },
      )
    },
    signDownload: () => Promise.reject(new Error(`not used`)),
    delete(key) {
      calls.push(`delete ${key}`)
      return options.storeDown ? Promise.reject(new Error(`store down`)) : Promise.resolve()
    },
    read: () => Promise.reject(new Error(`not used`)),
    isReachable: () => Promise.resolve(true),
  }
  const dependencies: PictureHandlerDependencies = {
    files,
    budget: ATTACHMENT_UPLOAD_BUDGET,
    emit: (event) => emitted.push(event),
    pictures: {
      reserve(upload) {
        if (options.refuse) return Promise.resolve(options.refuse)
        uploads.set(upload.id, { ...upload, settled: false })
        return Promise.resolve(null)
      },
      claim(id, userId) {
        const upload = uploads.get(id)
        if (!upload || upload.settled || upload.userId !== userId) return Promise.resolve(null)
        upload.settled = true
        return Promise.resolve(upload)
      },
      release(id, userId) {
        const upload = uploads.get(id)
        if (upload && upload.userId === userId) upload.settled = true
        return Promise.resolve()
      },
      set(userId, next) {
        if (options.gone) return Promise.resolve(null)
        const previous = picture
        picture = next?.id ?? null
        const user = { id: userId, pictureId: picture } as unknown as User
        return Promise.resolve({ user, previous })
      },
      forgetDeletion(key) {
        forgotten.push(key)
        return Promise.resolve()
      },
    },
  }
  const actor = (userId: number) => ({ userId, sessionId: `s`, role: 1 }) as never
  const sign = (userId = 7, contentType = `image/png`, size = 1000) =>
    createPictureSignHandler(dependencies)(
      new PictureSignCommand({ actor: actor(userId), contentType, size }),
    )
  const confirm = (id: string, userId = 7) =>
    createPictureConfirmHandler(dependencies)(
      new PictureConfirmCommand({ actor: actor(userId), id, request: {} }),
    )
  const cancel = (id: string, userId = 7) =>
    createPictureCancelHandler(dependencies)(
      new PictureCancelCommand({ actor: actor(userId), id, request: {} }),
    )
  const remove = (userId = 7) =>
    createPictureRemoveHandler(dependencies)(
      new PictureRemoveCommand({ actor: actor(userId), request: {} }),
    )
  return {
    calls,
    emitted,
    forgotten,
    uploads,
    picture: () => picture,
    sign,
    confirm,
    cancel,
    remove,
  }
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (cause) => cause)
  expect(error).toBeInstanceOf(PictureError)
  return (error as PictureError).code
}

Deno.test("a picture is signed to a staging key and kept in the ledger with no note", async () => {
  const { sign, uploads } = setUp()
  const signed = await sign()
  expect(signed.url).toBe(`https://app.example.test/uploads/tmp/1`)
  expect(signed.headers).toEqual({ "content-type": `image/png` })
  expect(uploads.get(signed.id)).toMatchObject({ noteId: null, userId: 7, size: 1000 })
})

Deno.test("a GIF, a PDF and a file over 1 MiB are refused before anything is kept", async () => {
  const { sign, uploads } = setUp()
  expect(await refusal(sign(7, `image/gif`))).toBe(`FILE_TYPE`)
  expect(await refusal(sign(7, `application/pdf`))).toBe(`FILE_TYPE`)
  expect(await refusal(sign(7, `image/jpeg`, PICTURE_MAX_BYTES + 1))).toBe(`FILE_TOO_LARGE`)
  expect(uploads.size).toBe(0)
})

Deno.test("the shared ledger's refusals reach the person as the picture's own", async () => {
  expect(await refusal(setUp({ refuse: `UPLOAD_BUDGET` }).sign())).toBe(`UPLOAD_BUDGET`)
  expect(await refusal(setUp({ refuse: `UPLOADS_PENDING` }).sign())).toBe(`UPLOADS_PENDING`)
})

Deno.test("a confirm moves the bytes to pictures/<id>, deletes the old picture and tells the person's tabs", async () => {
  const { sign, confirm, calls, emitted, forgotten, picture } = setUp({ picture: OLD_PICTURE })
  const { id } = await sign()
  const { user } = await confirm(id)
  expect(user.pictureId).toBe(id)
  expect(picture()).toBe(id)
  expect(calls).toContain(`confirmUpload uploads/tmp/1 pictures/${id}`)
  expect(calls).toContain(`delete pictures/${OLD_PICTURE}`)
  expect(forgotten).toEqual([`pictures/${OLD_PICTURE}`])
  expect(emitted.map((event) => event.data.user.pictureId)).toEqual([id])
})

Deno.test("only the person who signed a picture confirms it", async () => {
  const { sign, confirm } = setUp()
  const { id } = await sign(7)
  expect(await refusal(confirm(id, 8))).toBe(`UPLOAD_NOT_FOUND`)
  await confirm(id, 7)
  expect(await refusal(confirm(id, 7))).toBe(`UPLOAD_NOT_FOUND`)
})

Deno.test("a file whose bytes are not the image it claims is refused and the picture stays", async () => {
  const { sign, confirm, emitted, picture } = setUp({
    confirm: FileRefusal.Content,
    picture: OLD_PICTURE,
  })
  const { id } = await sign()
  expect(await refusal(confirm(id))).toBe(`FILE_CONTENT`)
  expect(picture()).toBe(OLD_PICTURE)
  expect(emitted).toEqual([])
})

Deno.test("a picture confirmed after its account went away is deleted from the store", async () => {
  const { sign, confirm, calls } = setUp({ gone: true })
  const { id } = await sign()
  expect(await refusal(confirm(id))).toBe(`UPLOAD_NOT_FOUND`)
  expect(calls).toContain(`delete pictures/${id}`)
})

Deno.test("a store that does not answer leaves the old picture queued for the worker", async () => {
  const { sign, confirm, forgotten } = setUp({ picture: OLD_PICTURE, storeDown: true })
  const { id } = await sign()
  await confirm(id)
  expect(forgotten).toEqual([])
})

Deno.test("a cancelled upload can no longer be confirmed, and only its signer cancels it", async () => {
  const { sign, cancel, confirm } = setUp()
  const mine = await sign(7)
  await cancel(mine.id, 8)
  await cancel(mine.id, 7)
  expect(await refusal(confirm(mine.id))).toBe(`UPLOAD_NOT_FOUND`)
})

Deno.test("removing the picture deletes its file and tells the person's tabs; with none it changes nothing", async () => {
  const withPicture = setUp({ picture: OLD_PICTURE })
  const { user } = await withPicture.remove()
  expect(user.pictureId).toBe(null)
  expect(withPicture.calls).toEqual([`delete pictures/${OLD_PICTURE}`])
  expect(withPicture.emitted.length).toBe(1)

  const without = setUp()
  await without.remove()
  expect(without.calls).toEqual([])
  expect(without.emitted).toEqual([])
})
