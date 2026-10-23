/// <reference lib="deno.ns" />
/**
 * The file store against a real Garage: `deno task test:files` (tests/files/run.sh) starts one and
 * runs this file. Run alone without it, every test fails on the missing settings instead of
 * passing without a store.
 */
import { expect } from "@std/expect"
import { FileRefusal, fileRule, s3FileStore, s3ServerFiles } from "@server/files/files.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

function setting(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not set: run this file with deno task test:files`)
  return value
}

function store() {
  const endpoint = setting(`S3_ENDPOINT`)
  return s3FileStore({
    endpoint,
    publicEndpoint: endpoint,
    region: setting(`S3_REGION`),
    bucket: setting(`S3_BUCKET`),
    accessKeyId: setting(`S3_ACCESS_KEY_ID`),
    secretAccessKey: setting(`S3_SECRET_ACCESS_KEY`),
  })
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2])
const images = fileRule([`image/png`], 1024)

/** PUTs `body` to a signed upload the way a browser would, and answers the status. */
async function put(url: string, contentType: string, body: Uint8Array): Promise<number> {
  const response = await fetch(url, {
    method: `PUT`,
    headers: { "content-type": contentType },
    body: body.slice(),
  })
  await response.body?.cancel()
  return response.status
}

Deno.test("a file is uploaded, confirmed, downloaded and deleted through signed URLs", async () => {
  const files = store()
  const key = `test/${uuidV7()}`
  const signed = { contentType: `image/png`, size: PNG.length }

  const upload = await files.signUpload(images, signed)
  if (!upload.success) throw new Error(`refused: ${upload.error}`)
  const { url, stagingKey } = upload.output
  expect(await put(url, `image/png`, PNG)).toBe(200)
  expect(await files.confirmUpload(stagingKey, key, signed)).toEqual({
    success: true,
    output: signed,
  })

  const download = await fetch(await files.signDownload(key, { ...signed, filename: `a.png` }))
  expect(download.status).toBe(200)
  expect(download.headers.get(`content-type`)).toBe(`image/png`)
  expect(download.headers.get(`content-disposition`)).toMatch(/^inline; filename="a.png"/)
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG)

  await files.delete(key)
  expect(await files.confirmUpload(stagingKey, key, signed))
    .toEqual({ success: false, error: FileRefusal.Missing })
})

Deno.test("bytes PUT to the upload URL after the confirm never reach the confirmed file", async () => {
  const files = store()
  const key = `test/${uuidV7()}`
  const signed = { contentType: `image/png`, size: PNG.length }
  const upload = await files.signUpload(images, signed)
  if (!upload.success) throw new Error(`refused: ${upload.error}`)
  const { url, stagingKey } = upload.output

  try {
    expect(await put(url, `image/png`, PNG)).toBe(200)
    expect(await files.confirmUpload(stagingKey, key, signed))
      .toEqual({ success: true, output: signed })
    const html = new TextEncoder().encode(`<html><script>alert(1)</script></html>`)
    expect(await put(url, `image/png`, html.slice(0, PNG.length))).toBe(200)

    const download = await fetch(await files.signDownload(key, { ...signed, filename: `a.png` }))
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PNG)
  } finally {
    await files.delete(key)
    await files.delete(stagingKey)
  }
})

Deno.test("the store refuses a body larger than signed, and another type than signed", async () => {
  const files = store()
  const key = `test/${uuidV7()}`
  const upload = await files.signUpload(images, { contentType: `image/png`, size: 8 })
  if (!upload.success) throw new Error(`refused: ${upload.error}`)

  expect(await put(upload.output.url, `image/png`, PNG)).toBeGreaterThanOrEqual(400)
  expect(await put(upload.output.url, `text/html`, PNG.slice(0, 8))).toBeGreaterThanOrEqual(400)
  expect(
    await files.confirmUpload(upload.output.stagingKey, key, { contentType: `image/png`, size: 8 }),
  )
    .toEqual({ success: false, error: FileRefusal.Missing })
})

Deno.test("an HTML page uploaded under a PNG's signature is refused and deleted", async () => {
  const files = store()
  const key = `test/${uuidV7()}`
  const html = new TextEncoder().encode(`<html><script>alert(1)</script></html>`)
  const signed = { contentType: `image/png`, size: html.length }
  const upload = await files.signUpload(images, signed)
  if (!upload.success) throw new Error(`refused: ${upload.error}`)
  const { url, stagingKey } = upload.output

  expect(await put(url, `image/png`, html)).toBe(200)
  expect(await files.confirmUpload(stagingKey, key, signed))
    .toEqual({ success: false, error: FileRefusal.Content })
  expect(await files.confirmUpload(stagingKey, key, signed))
    .toEqual({ success: false, error: FileRefusal.Missing })
  const download = await fetch(await files.signDownload(key, { ...signed, filename: `a.png` }))
  await download.body?.cancel()
  expect(download.status).toBe(404)
})

Deno.test("the store answers as reachable", async () => {
  expect(await store().isReachable()).toBe(true)
})

Deno.test("a file the server made is stored, downloaded as an attachment, and deleted", async () => {
  const files = store()
  const server = s3ServerFiles({
    endpoint: setting(`S3_ENDPOINT`),
    region: setting(`S3_REGION`),
    bucket: setting(`S3_BUCKET`),
    accessKeyId: setting(`S3_ACCESS_KEY_ID`),
    secretAccessKey: setting(`S3_SECRET_ACCESS_KEY`),
  })
  const key = `data-exports/${uuidV7()}.zip`
  const zip = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])

  await server.put(key, zip)
  const signed = await files.signDownload(key, {
    contentType: `application/zip`,
    filename: `my.zip`,
  })
  const download = await fetch(signed)
  expect(download.status).toBe(200)
  expect(download.headers.get(`content-type`)).toBe(`application/zip`)
  expect(download.headers.get(`content-disposition`)).toMatch(/^attachment; filename="my.zip"/)
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(zip)

  // Nothing under the prefix is old enough yet; then everything is.
  expect(await server.deleteOlderThan(`data-exports/`, new Date(Date.now() - 60_000))).toBe(0)
  expect(await server.deleteOlderThan(`data-exports/`, new Date(Date.now() + 60_000))).toBe(1)
  const gone = await fetch(signed)
  await gone.body?.cancel()
  expect(gone.status).toBe(404)
})
