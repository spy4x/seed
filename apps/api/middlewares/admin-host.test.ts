import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type { APIContext } from "../_types.ts"
import { createAdminHostGate } from "./admin-host.ts"
import { createMutationGuards } from "./mutation-guards.ts"

const ADMIN_HOST = "admin.example.com"

/** The gate in front of a route that answers 200 on every path. */
function buildApp(adminHost: string | null = ADMIN_HOST) {
  const app = new Hono<APIContext>()
  app.use("*", createAdminHostGate(adminHost))
  app.all("*", (c) => c.text("reached"))
  return app
}

async function statusOf(app: Hono<APIContext>, url: string, method = "GET") {
  return (await app.request(url, { method })).status
}

describe("admin host gate", () => {
  it("lets the admin host reach the operator area, sign-in, sign-out, session and address", async () => {
    const app = buildApp()
    for (
      const path of [
        "/api/admin/users",
        "/api/admin/users/42/block",
        "/api/auth/me",
        "/api/auth/email",
        "/api/auth/password/check",
        "/api/auth/totp/check",
        "/api/auth/sign-out",
      ]
    ) {
      expect({ path, status: await statusOf(app, `http://${ADMIN_HOST}${path}`) })
        .toEqual({ path, status: 200 })
    }
  })

  it("answers 404 on the admin host for every route of the product outside the area", async () => {
    const app = buildApp()
    for (
      const path of [
        "/api/auth/password/sign-up",
        "/api/auth/google/start",
        "/api/auth/account/delete",
        "/api/auth/email/change",
        "/api/groups",
        "/api/tokens",
        "/api/v1/notes",
        "/api/test/set-role",
        "/api/adminx",
      ]
    ) {
      expect({ path, status: await statusOf(app, `http://${ADMIN_HOST}${path}`) })
        .toEqual({ path, status: 404 })
    }
  })

  it("answers 404 for the operator area on the web app's host", async () => {
    const app = buildApp()
    expect(await statusOf(app, "http://app.example.com/api/admin/users")).toBe(404)
    expect(await statusOf(app, "http://app.example.com/api/admin")).toBe(404)
    expect(await statusOf(app, "http://app.example.com/api/admin/users/42/block", "POST"))
      .toBe(404)
    expect(await statusOf(app, "http://app.example.com/api/groups")).toBe(200)
  })

  it("answers 404 for the operator area everywhere when no admin host is configured", async () => {
    const app = buildApp(null)
    expect(await statusOf(app, `http://${ADMIN_HOST}/api/admin/users`)).toBe(404)
    expect(await statusOf(app, "http://app.example.com/api/admin/users")).toBe(404)
    expect(await statusOf(app, "http://app.example.com/api/auth/me")).toBe(200)
  })

  it("matches the admin host whatever its letter case", async () => {
    // A request's host arrives in lower case; the configured one may not be.
    const app = buildApp("Admin.Example.com")
    expect(await statusOf(app, "http://ADMIN.Example.com/api/admin/users")).toBe(200)
  })
})

describe("mutation guards with an admin app", () => {
  function guarded() {
    const guards = createMutationGuards("https://app.example.com", `https://${ADMIN_HOST}`)
    const app = new Hono<APIContext>()
    app.post("*", guards.anonymous, (c) => c.text("reached"))
    return app
  }

  function post(app: Hono<APIContext>, host: string, origin: string) {
    return app.request(`http://${host}/api/auth/password/check`, {
      method: "POST",
      headers: { origin, "sec-fetch-site": "same-origin" },
    })
  }

  it("accepts the admin app's origin on the admin host only", async () => {
    const app = guarded()
    expect((await post(app, ADMIN_HOST, `https://${ADMIN_HOST}`)).status).toBe(200)
    expect((await post(app, "app.example.com", `https://${ADMIN_HOST}`)).status).toBe(403)
  })

  it("accepts the web app's origin on the web app's host only", async () => {
    const app = guarded()
    expect((await post(app, "app.example.com", "https://app.example.com")).status).toBe(200)
    expect((await post(app, ADMIN_HOST, "https://app.example.com")).status).toBe(403)
  })
})
