/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import { parseDemoInfo } from "@domain/identity"
import { createDemoRoute } from "./demo.ts"

Deno.test("GET /api/demo is 404 while the demo is off", async () => {
  const route = createDemoRoute({
    password: null,
    appUrl: "https://app.example.com",
    adminUrl: null,
  })
  expect((await route.request("/")).status).toBe(404)
})

Deno.test("GET /api/demo answers both shared accounts and the apps' addresses", async () => {
  const route = createDemoRoute({
    password: "public-demo",
    appUrl: "https://app.example.com",
    adminUrl: "https://admin.example.com",
  })
  const response = await route.request("/")
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(parseDemoInfo(await response.json())).toEqual({
    userLogin: "demo@example.com",
    adminLogin: "admin@example.com",
    password: "public-demo",
    appUrl: "https://app.example.com",
    adminUrl: "https://admin.example.com",
  })
})
