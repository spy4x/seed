/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { createHealthRoute } from "./health.ts"

async function health(isDbConnected: boolean, isCacheConnected: boolean) {
  const route = createHealthRoute({
    isDbConnected: () => Promise.resolve(isDbConnected),
    isCacheConnected: () => Promise.resolve(isCacheConnected),
  })
  const response = await route.request("/")
  return { status: response.status, body: await response.json() }
}

Deno.test("health reports ok when the database and the cache answer", async () => {
  const { status, body } = await health(true, true)

  expect(status).toBe(200)
  expect(body).toMatchObject({ status: "ok", checks: { database: true, cache: true } })
})

Deno.test("health reports degraded, still 200, when only the cache is down", async () => {
  const { status, body } = await health(true, false)

  expect(status).toBe(200)
  expect(body).toMatchObject({ status: "degraded", checks: { database: true, cache: false } })
})

Deno.test("health reports down with 503 when the database is down", async () => {
  const { status, body } = await health(false, true)

  expect(status).toBe(503)
  expect(body).toMatchObject({ status: "down", checks: { database: false, cache: true } })
})
