/// <reference lib="deno.ns" />
/**
 * The file store `deno task e2e:local` gives the API, so a browser test can upload a file. It
 * answers the S3 calls the API's file store makes (`libs/server/files/files.ts`), path-style, from
 * memory: a PUT, a copy, a HEAD, a ranged or whole GET, a DELETE and a listing. It checks no
 * signature: the store's signing is covered by `tests/files/garage.test.ts` against a real Garage.
 * Reads `FILES_PORT` and listens on 127.0.0.1; the proxy sends it the bucket's paths.
 */

interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

const xml = (body: string, status = 200) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { "content-type": `application/xml` },
  })

const notFound = () => xml(`<Error><Code>NoSuchKey</Code></Error>`, 404)

const escape = (text: string) =>
  text.replaceAll(`&`, `&amp;`).replaceAll(`<`, `&lt;`).replaceAll(`>`, `&gt;`)

/** The object's bytes for a `Range: bytes=<start>-<end>` header, or all of them without one. */
function ranged(object: StoredObject, range: string | null, headers: Headers): Response {
  const match = range?.match(/^bytes=(\d+)-(\d+)$/)
  if (!match) return new Response(object.bytes as Uint8Array<ArrayBuffer>, { headers })
  const start = Number(match[1])
  if (start >= object.bytes.length) return new Response(null, { status: 416 })
  const end = Math.min(Number(match[2]), object.bytes.length - 1)
  headers.set(`content-range`, `bytes ${start}-${end}/${object.bytes.length}`)
  return new Response(object.bytes.slice(start, end + 1) as Uint8Array<ArrayBuffer>, {
    status: 206,
    headers,
  })
}

/** A store for `bucket` that keeps its objects in memory, as a request handler. */
export function createFakeStore(bucket: string): (request: Request) => Promise<Response> {
  const objects = new Map<string, StoredObject>()
  const prefix = `/${bucket}/`
  return async (request) => {
    const url = new URL(request.url)
    if (url.pathname === `/${bucket}` && request.method === `GET`) {
      const wanted = url.searchParams.get(`prefix`) ?? ``
      const contents = [...objects].filter(([key]) => key.startsWith(wanted)).map(([key, object]) =>
        `<Contents><Key>${escape(key)}</Key><Size>${object.bytes.length}</Size></Contents>`
      )
      return xml(`<ListBucketResult><IsTruncated>false</IsTruncated>${contents.join(``)}</ListBucketResult>`)
    }
    if (!url.pathname.startsWith(prefix)) return notFound()
    const key = decodeURIComponent(url.pathname.slice(prefix.length))
    const object = objects.get(key)
    switch (request.method) {
      case `PUT`: {
        const source = request.headers.get(`x-amz-copy-source`)
        if (source !== null) {
          const from = objects.get(decodeURIComponent(source).replace(/^\/[^/]+\//, ``))
          if (!from) return notFound()
          objects.set(key, { ...from })
          return xml(`<CopyObjectResult></CopyObjectResult>`)
        }
        objects.set(key, {
          bytes: new Uint8Array(await request.arrayBuffer()),
          contentType: request.headers.get(`content-type`) ?? `application/octet-stream`,
        })
        return new Response(null, { status: 200 })
      }
      case `HEAD`:
      case `GET`: {
        if (!object) return notFound()
        const headers = new Headers({
          "content-type": url.searchParams.get(`response-content-type`) ?? object.contentType,
          "content-length": String(object.bytes.length),
        })
        const disposition = url.searchParams.get(`response-content-disposition`)
        if (disposition) headers.set(`content-disposition`, disposition)
        if (request.method === `HEAD`) return new Response(null, { headers })
        headers.delete(`content-length`)
        return ranged(object, request.headers.get(`range`), headers)
      }
      case `DELETE`:
        objects.delete(key)
        return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405 })
  }
}

if (import.meta.main) {
  const port = Number(Deno.env.get(`FILES_PORT`))
  const bucket = Deno.env.get(`S3_BUCKET`)
  if (!Number.isInteger(port) || port <= 0) throw new Error(`FILES_PORT must be a port number`)
  if (!bucket) throw new Error(`S3_BUCKET is required`)
  Deno.serve({ hostname: `127.0.0.1`, port, onListen: () => {} }, createFakeStore(bucket))
}
