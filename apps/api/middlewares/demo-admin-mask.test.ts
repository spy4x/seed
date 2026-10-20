/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { Hono } from "hono"
import type { APIContext } from "../_types.ts"
import { createDemoAdminMask, maskRealAddresses } from "./demo-admin-mask.ts"

Deno.test("masks real addresses and keeps the made-up ones", () => {
  expect(maskRealAddresses(`{"email":"ada.lovelace@gmail.com","other":"demo@example.com"}`))
    .toBe(`{"email":"a***@g***.com","other":"demo@example.com"}`)
  expect(maskRealAddresses(`id,email\n1,"Bob@Mail.Example.org"\n2,eve@example.com`))
    .toBe(`id,email\n1,"B***@M***.org"\n2,eve@example.com`)
  // A subdomain of example.com is someone's real domain.
  expect(maskRealAddresses(`x@mail.example.com`)).toBe(`x***@m***.com`)
  expect(maskRealAddresses(`ünal@пример.рф`)).toBe(`ü***@п***.рф`)
})

/** An API with the mask, where each route answers `body` with `type`. */
function app() {
  const api = new Hono<APIContext>().basePath("/api")
  api.use("*", createDemoAdminMask())
  api.get("/admin/users", (c) => c.json({ items: [{ email: "ada@gmail.com" }] }))
  api.get(
    "/admin/users/export.csv",
    () => new Response(`email\nada@gmail.com\n`, { headers: { "content-type": "text/csv" } }),
  )
  api.get("/admin/missing", (c) => c.json({ error: "ada@gmail.com" }, 404))
  api.get("/users/me", (c) => c.json({ email: "ada@gmail.com" }))
  return api
}

Deno.test("masks every admin answer, JSON and CSV, and keeps its status", async () => {
  const json = await app().request("/api/admin/users")
  expect(await json.json()).toEqual({ items: [{ email: "a***@g***.com" }] })
  const csv = await app().request("/api/admin/users/export.csv")
  expect(csv.headers.get("content-type")).toBe("text/csv")
  expect(await csv.text()).toBe(`email\na***@g***.com\n`)
  const missing = await app().request("/api/admin/missing")
  expect(missing.status).toBe(404)
  expect(await missing.json()).toEqual({ error: "a***@g***.com" })
})

Deno.test("leaves a person's own answers outside the admin API as they are", async () => {
  expect(await (await app().request("/api/users/me")).json()).toEqual({ email: "ada@gmail.com" })
})
