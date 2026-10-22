/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { StorageError } from "@spy4x/server/storage"
import {
  createFileStore,
  downloadDisposition,
  FILE_URL_SECONDS,
  FileRefusal,
  fileRule,
  type ObjectStore,
} from "./files.ts"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
const HTML = new TextEncoder().encode(`<html><script>alert(1)</script></html>`)

/** One object the fake store holds. */
interface Stored {
  bytes: Uint8Array
  contentType?: string
}

/** A store that keeps objects in a map and records every call. Nothing opens a socket. */
function fakeStore(objects = new Map<string, Stored>(), fail = false) {
  const calls: { method: string; args: unknown[] }[] = []
  const record = (method: string, args: unknown[]) => {
    calls.push({ method, args })
    if (fail) throw new StorageError(`request_failed`, `${method} failed`)
  }
  const store: ObjectStore = {
    presignPut(...args) {
      record(`presignPut`, args)
      return Promise.resolve(`https://app.example.test/put/${args[1]}`)
    },
    presignGet(...args) {
      record(`presignGet`, args)
      return Promise.resolve(`https://app.example.test/get/${args[1]}`)
    },
    head(...args) {
      record(`head`, args)
      const object = objects.get(args[1])
      return Promise.resolve(
        object ? { size: object.bytes.length, contentType: object.contentType } : null,
      )
    },
    getRange(...args) {
      record(`getRange`, args)
      const [, key, start, end] = args
      return Promise.resolve(objects.get(key)?.bytes.slice(start, end + 1) ?? new Uint8Array())
    },
    delete(...args) {
      record(`delete`, args)
      objects.delete(args[1])
      return Promise.resolve()
    },
    list(...args) {
      return Promise.resolve().then(() => {
        record(`list`, args)
        return { objects: [] }
      })
    },
  }
  return { store, calls, objects }
}

const images = fileRule([`image/png`, `image/jpeg`], 1000)

Deno.test("a rule refuses a type whose bytes the store cannot check, and a limit below one byte", () => {
  expect(() => fileRule([`image/svg+xml`], 1000)).toThrow(`image/svg+xml`)
  expect(() => fileRule([], 1000)).toThrow()
  expect(() => fileRule([`image/png`], 0)).toThrow(`limit`)
  expect(() => fileRule([`image/png`], 1.5)).toThrow(`limit`)
})

Deno.test("an upload is signed with the exact type and size, on the browser's client, for five minutes", async () => {
  const internal = fakeStore()
  const browser = fakeStore()
  const files = createFileStore(internal.store, browser.store, `app-files`)

  const signed = await files.signUpload(`a/b`, images, { contentType: `image/png`, size: 12 })

  expect(signed).toEqual({
    success: true,
    output: { url: `https://app.example.test/put/a/b`, headers: { "content-type": `image/png` } },
  })
  expect(browser.calls).toEqual([{
    method: `presignPut`,
    args: [`app-files`, `a/b`, {
      contentType: `image/png`,
      contentLength: 12,
      expiresIn: FILE_URL_SECONDS,
    }],
  }])
  expect(internal.calls).toEqual([])
})

Deno.test("an upload of another type is refused before anything is signed", async () => {
  const browser = fakeStore()
  const files = createFileStore(fakeStore().store, browser.store, `app-files`)

  for (const contentType of [`text/html`, `application/pdf`, `IMAGE/PNG`]) {
    expect(await files.signUpload(`k`, images, { contentType, size: 10 }))
      .toEqual({ success: false, error: FileRefusal.Type })
  }
  expect(browser.calls).toEqual([])
})

Deno.test("a hand-built rule that names a type the bytes cannot confirm signs nothing", async () => {
  const browser = fakeStore()
  const files = createFileStore(fakeStore().store, browser.store, `app-files`)
  const loose = { types: [`text/html`], maxBytes: 1000 }

  expect(await files.signUpload(`k`, loose, { contentType: `text/html`, size: 10 }))
    .toEqual({ success: false, error: FileRefusal.Type })
  expect(browser.calls).toEqual([])
})

Deno.test("an upload larger than the limit, empty, or of no whole size is refused", async () => {
  const browser = fakeStore()
  const files = createFileStore(fakeStore().store, browser.store, `app-files`)

  for (const size of [1001, 0, -1, 2.5, Number.NaN]) {
    expect(await files.signUpload(`k`, images, { contentType: `image/png`, size }))
      .toEqual({ success: false, error: FileRefusal.Size })
  }
  expect(await files.signUpload(`k`, images, { contentType: `image/png`, size: 1000 }))
    .toMatchObject({ success: true })
  expect(browser.calls.length).toBe(1)
})

Deno.test("an upload is confirmed when its size, type and first bytes are what was signed", async () => {
  const internal = fakeStore(new Map([[`k`, { bytes: PNG, contentType: `image/png` }]]))
  const files = createFileStore(internal.store, fakeStore().store, `app-files`)
  const signed = { contentType: `image/png`, size: PNG.length }

  expect(await files.confirmUpload(`k`, signed)).toEqual({ success: true, output: signed })
  expect(internal.objects.has(`k`)).toBe(true)
  expect(internal.calls.find((call) => call.method === `getRange`)?.args)
    .toEqual([`app-files`, `k`, 0, 511])
})

Deno.test("an HTML page uploaded as a PNG is refused and deleted", async () => {
  const internal = fakeStore(new Map([[`k`, { bytes: HTML, contentType: `image/png` }]]))
  const files = createFileStore(internal.store, fakeStore().store, `app-files`)

  expect(await files.confirmUpload(`k`, { contentType: `image/png`, size: HTML.length }))
    .toEqual({ success: false, error: FileRefusal.Content })
  expect(internal.objects.has(`k`)).toBe(false)
})

Deno.test("an upload of another size or stored type than signed is refused and deleted", async () => {
  for (
    const [stored, signed, error] of [
      [{ bytes: PNG, contentType: `image/png` }, { contentType: `image/png`, size: 99 }, 2],
      [{ bytes: PNG, contentType: `image/jpeg` }, { contentType: `image/png`, size: 12 }, 1],
    ] as const
  ) {
    const internal = fakeStore(new Map([[`k`, stored]]))
    const files = createFileStore(internal.store, fakeStore().store, `app-files`)

    expect(await files.confirmUpload(`k`, signed)).toEqual({ success: false, error })
    expect(internal.objects.has(`k`)).toBe(false)
  }
})

Deno.test("confirming a key nothing was uploaded to reports it missing and deletes nothing", async () => {
  const internal = fakeStore()
  const files = createFileStore(internal.store, fakeStore().store, `app-files`)

  expect(await files.confirmUpload(`k`, { contentType: `image/png`, size: 12 }))
    .toEqual({ success: false, error: FileRefusal.Missing })
  expect(internal.calls.map((call) => call.method)).toEqual([`head`])
})

Deno.test("a download is signed on the browser's client with the checked type and its disposition", async () => {
  const browser = fakeStore()
  const files = createFileStore(fakeStore().store, browser.store, `app-files`)

  await files.signDownload(`k`, { contentType: `text/plain`, filename: `notes.txt` })

  expect(browser.calls).toEqual([{
    method: `presignGet`,
    args: [`app-files`, `k`, {
      expiresIn: FILE_URL_SECONDS,
      responseContentType: `text/plain`,
      responseContentDisposition: `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
    }],
  }])
})

Deno.test("an image is shown in place and every other file is saved", () => {
  expect(downloadDisposition(`image/png`, `a.png`)).toMatch(/^inline;/)
  expect(downloadDisposition(`text/plain`, `a.txt`)).toMatch(/^attachment;/)
  expect(downloadDisposition(`application/pdf`, `a.pdf`)).toMatch(/^attachment;/)
})

Deno.test("a file name cannot break out of its header, and keeps its letters in the UTF-8 part", () => {
  expect(downloadDisposition(`text/plain`, `Отчёт "1"\r\n.txt`)).toBe(
    `attachment; filename="_____ _1___.txt"; ` +
      `filename*=UTF-8''%D0%9E%D1%82%D1%87%D1%91%D1%82%20%221%22%0D%0A.txt`,
  )
  expect(downloadDisposition(`text/plain`, ``)).toBe(
    `attachment; filename="file"; filename*=UTF-8''`,
  )
})

Deno.test("the store counts as reachable only when a listing succeeds", async () => {
  const up = createFileStore(fakeStore().store, fakeStore().store, `app-files`)
  const down = createFileStore(fakeStore(new Map(), true).store, fakeStore().store, `app-files`)

  expect(await up.isReachable()).toBe(true)
  expect(await down.isReachable()).toBe(false)
})
