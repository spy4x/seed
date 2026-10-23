import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { buildAuthData } from "./_testing/fake-auth.ts"
import { createApiApp } from "./app.ts"
import { createNotesRoute, type NotesRouteDependencies } from "./routes/notes.ts"
import type { APIContext } from "./_types.ts"
import { apiError } from "./_testing/api-error.ts"

type Auth = APIContext["Variables"]["auth"]

/** No peer is the proxy: these tests send no forwarded header. */
const noProxy = () => Promise.resolve(false)

/** The API's app with the notes route and one plain route, signed in as user 7 unless told. */
async function buildApp(auth: Auth = buildAuthData({ user: { id: 7 } })) {
  const effects: string[] = []
  const app = await createApiApp({
    write: () => {},
    parseAuth: async (c, next) => {
      c.set("auth", auth)
      await next()
    },
    isProxyPeer: noProxy,
  })
  const unused = () => Promise.reject(new Error("not part of this test"))
  const notes: NotesRouteDependencies = {
    create: unused,
    update: unused,
    delete: unused,
    restore: unused,
    move: unused,
    list: () => {
      effects.push("note list")
      return Promise.resolve({ notes: [], nextPageKey: null })
    },
    get: () => {
      effects.push("one note")
      return unused()
    },
    cursor: { encode: () => Promise.resolve("cursor"), decode: unused },
  }
  app.route("/groups/:groupId/notes", createNotesRoute(notes))
  app.route(
    "/notifications",
    new Hono<APIContext>().get("/", (c) => {
      effects.push("notifications")
      return c.json({ notifications: [] })
    }),
  )
  app.route(
    "/broken",
    new Hono<APIContext>().get("/", () => {
      throw new Error("a route failed")
    }),
  )
  app.route(
    "/tokens",
    new Hono<APIContext>()
      .post("/", (c) => {
        effects.push("token created")
        return c.json({ token: {} }, 201)
      })
      .delete("/:id", (c) => {
        effects.push("token revoked")
        return c.json({ success: true })
      }),
  )
  const get = (path: string, pageUser?: string) =>
    app.request(`http://local/api${path}`, {
      headers: pageUser === undefined ? {} : { "x-realtime-user": pageUser },
    })
  const write = (method: string, path: string, pageUser?: string) =>
    app.request(`http://local/api${path}`, {
      method,
      headers: pageUser === undefined ? {} : { "x-realtime-user": pageUser },
    })
  return { get, write, effects }
}

const READS = [
  "/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes?limit=10",
  "/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001",
  "/notifications",
]

/** The library's policy with nothing added: the API answers JSON and loads nothing. */
const POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
  "frame-ancestors 'none'"

describe("the API's app", () => {
  it("refuses every read whose page names another user than the session's, and reads nothing", async () => {
    const { get, effects } = await buildApp()

    const responses = await Promise.all(READS.map((path) => get(path, "8")))

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
    expect((await apiError(responses[1])).code).toBe("unauthorized")
    expect(effects).toEqual([])
  })

  it("refuses every write whose page names another user than the session's, and writes nothing", async () => {
    const { write, effects } = await buildApp()

    const responses = [await write("POST", "/tokens", "8"), await write("DELETE", "/tokens/1", "8")]

    expect(responses.map((response) => response.status)).toEqual([401, 401])
    expect((await apiError(responses[0])).code).toBe("unauthorized")
    expect(effects).toEqual([])
  })

  it("accepts a write from a page that names the session's user, and from a caller that names nobody", async () => {
    const { write, effects } = await buildApp()

    const named = await write("POST", "/tokens", "7")
    const unnamed = await write("DELETE", "/tokens/1")

    expect([named.status, unnamed.status]).toEqual([201, 200])
    expect(effects).toEqual(["token created", "token revoked"])
  })

  it("serves a page that names the session's user, and a caller that names nobody", async () => {
    const { get, effects } = await buildApp()

    const named = await get("/notifications", "7")
    const unnamed = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes?limit=10")

    expect([named.status, unnamed.status]).toEqual([200, 200])
    expect(effects).toEqual(["notifications", "note list"])
  })

  it("leaves a request without a session to the route, whoever its page names", async () => {
    const { get, effects } = await buildApp(null)

    const signedOut = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes", "8")
    const open = await get("/notifications", "8")

    expect((await apiError(signedOut)).reason).toBe("AUTH_REQUIRED")
    expect(open.status).toBe(200)
    expect(effects).toEqual(["notifications"])
  })

  it("sends the security headers with a route's answer, a refusal, an unknown address and an error", async () => {
    const { get } = await buildApp()

    const responses = [
      await get("/notifications"),
      await get("/notifications", "8"),
      await get("/no-such-route"),
      await get("/broken"),
    ]

    expect(responses.map((response) => response.status)).toEqual([200, 401, 404, 500])
    for (const response of responses) {
      expect(response.headers.get("content-security-policy")).toBe(POLICY)
      expect(response.headers.get("x-content-type-options")).toBe("nosniff")
      expect(response.headers.get("referrer-policy")).toBe("no-referrer")
      expect(response.headers.get("x-frame-options")).toBe("DENY")
      expect(response.headers.get("strict-transport-security")).toBe(
        "max-age=15552000; includeSubDomains",
      )
    }
  })

  it("answers an unknown address, a guard's refusal and a failed route in the one error body", async () => {
    const { get } = await buildApp()

    const [unknown, refused, broken] = [
      await get("/no-such-route"),
      await get("/notifications", "8"),
      await get("/broken"),
    ]

    expect(await apiError(unknown)).toMatchObject({ code: "not_found", message: "Not found" })
    expect((await apiError(refused)).code).toBe("unauthorized")
    const failure = await apiError(broken)
    expect(failure).toMatchObject({ code: "internal", message: "Request failed" })
    expect(JSON.stringify(failure)).not.toContain("a route failed")
  })

  it("refuses a client address named by a container that is not the proxy, on every route", async () => {
    const app = await createApiApp({
      write: () => {},
      parseAuth: async (_c, next) => await next(),
      isProxyPeer: (peer) => Promise.resolve(peer === "172.18.0.2"),
    })
    app.get("/notifications", (c) => c.json({ notifications: [] }))
    const statusFrom = async (peer: string, path: string) => {
      const env = { remoteAddr: { transport: "tcp", hostname: peer, port: 40000 } }
      const init = { headers: { "x-real-ip": "192.0.2.1" } }
      return (await app.request(`http://local/api${path}`, init, env)).status
    }

    expect(await statusFrom("172.18.0.9", "/notifications")).toBe(403)
    expect(await statusFrom("172.18.0.9", "/no-such-route")).toBe(403)
    expect(await statusFrom("172.18.0.2", "/notifications")).toBe(200)
  })

  it("keeps the operator area to the admin host, and the admin host to the area", async () => {
    const app = await createApiApp({
      write: () => {},
      parseAuth: async (_c, next) => await next(),
      adminHost: "admin.local",
      isProxyPeer: noProxy,
    })
    app.get("/admin/users", (c) => c.json({ users: [] }))
    app.get("/notifications", (c) => c.json({ notifications: [] }))
    const status = async (url: string) => (await app.request(url)).status

    expect(await status("http://admin.local/api/admin/users")).toBe(200)
    expect(await status("http://local/api/admin/users")).toBe(404)
    expect(await status("http://admin.local/api/notifications")).toBe(404)
    expect(await status("http://local/api/notifications")).toBe(200)
  })

  it("answers 404 to the operator area spelled with percent-escapes on another host", async () => {
    const app = await createApiApp({
      write: () => {},
      parseAuth: async (_c, next) => await next(),
      adminHost: "admin.local",
      isProxyPeer: noProxy,
    })
    app.get("/admin/users/:id", (c) => c.json({ user: c.req.param("id") }))
    app.post("/admin/users/:id/block", (c) => c.json({ blocked: c.req.param("id") }))
    app.get("/notifications", (c) => c.json({ notifications: [] }))

    for (const area of ["%61dmin", "%41dmin", "ad%6din", "%61%64%6d%69%6e"]) {
      const get = await app.request(`http://local/api/${area}/users/42`)
      const post = await app.request(`http://local/api/${area}/users/42/block`, { method: "POST" })
      expect([area, get.status, post.status]).toEqual([area, 404, 404])
    }
    // The router reads an escaped spelling as the area itself, so the gate must too.
    expect((await app.request(`http://admin.local/api/%61dmin/users/42`)).status).toBe(200)
    // And the admin host cannot reach another route by escaping its letters.
    expect((await app.request("http://admin.local/api/%6eotifications")).status).toBe(404)
  })
})
