import { expect } from "@std/expect"
import { createFakeStore } from "./e2e-local-files.ts"

const BASE = `http://127.0.0.1:1/e2e-files`
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

Deno.test("the e2e file store keeps a PUT, copies it, reads a range and deletes it", async () => {
  const store = createFakeStore(`e2e-files`)
  const put = await store(
    new Request(`${BASE}/uploads/tmp/a?X-Amz-Signature=x`, {
      method: `PUT`,
      headers: { "content-type": `image/png` },
      body: PNG,
    }),
  )
  expect(put.status).toBe(200)

  const copied = await store(
    new Request(`${BASE}/pictures/a`, {
      method: `PUT`,
      headers: { "x-amz-copy-source": `/e2e-files/uploads/tmp/a` },
    }),
  )
  expect(await copied.text()).toContain(`<CopyObjectResult>`)

  const head = await store(new Request(`${BASE}/pictures/a`, { method: `HEAD` }))
  expect([head.headers.get(`content-type`), head.headers.get(`content-length`)]).toEqual([
    `image/png`,
    `12`,
  ])

  const range = await store(new Request(`${BASE}/pictures/a`, { headers: { range: `bytes=0-7` } }))
  expect(range.status).toBe(206)
  expect(new Uint8Array(await range.arrayBuffer())).toEqual(PNG.slice(0, 8))

  const listing = await store(new Request(`${BASE}?list-type=2&prefix=pictures/`))
  expect(await listing.text()).toContain(`<Key>pictures/a</Key>`)

  await store(new Request(`${BASE}/pictures/a`, { method: `DELETE` }))
  expect((await store(new Request(`${BASE}/pictures/a`, { method: `HEAD` }))).status).toBe(404)
  expect((await store(new Request(`${BASE}/uploads/tmp/a`))).status).toBe(200)
})

Deno.test("the e2e file store refuses a copy of an object it does not hold", async () => {
  const store = createFakeStore(`e2e-files`)
  const copied = await store(
    new Request(`${BASE}/pictures/b`, {
      method: `PUT`,
      headers: { "x-amz-copy-source": `/e2e-files/uploads/tmp/none` },
    }),
  )
  expect(copied.status).toBe(404)
})
