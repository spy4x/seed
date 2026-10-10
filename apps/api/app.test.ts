import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { buildAuthData } from "./_testing/fake-auth.ts"
import { createApiApp } from "./app.ts"
import { createNotesRoute, type NotesRouteDependencies } from "./routes/notes.ts"
import type { APIContext } from "./_types.ts"

type Auth = APIContext["Variables"]["auth"]

/** The API's app with the notes route and one plain route, signed in as user 7 unless told. */
async function buildApp(auth: Auth = buildAuthData({ user: { id: 7 } })) {
  const reads: string[] = []
  const app = await createApiApp({
    write: () => {},
    parseAuth: async (c, next) => {
      c.set("auth", auth)
      await next()
    },
  })
  const unused = () => Promise.reject(new Error("not part of this test"))
  const notes: NotesRouteDependencies = {
    create: unused,
    update: unused,
    delete: unused,
    restore: unused,
    move: unused,
    list: () => {
      reads.push("note list")
      return Promise.resolve({ notes: [], nextPageKey: null })
    },
    get: () => {
      reads.push("one note")
      return unused()
    },
    cursor: { encode: () => Promise.resolve("cursor"), decode: unused },
  }
  app.route("/groups/:groupId/notes", createNotesRoute(notes))
  app.route(
    "/notifications",
    new Hono<APIContext>().get("/", (c) => {
      reads.push("notifications")
      return c.json({ notifications: [] })
    }),
  )
  app.route(
    "/broken",
    new Hono<APIContext>().get("/", () => {
      throw new Error("a route failed")
    }),
  )
  const get = (path: string, pageUser?: string) =>
    app.request(`http://local/api${path}`, {
      headers: pageUser === undefined ? {} : { "x-realtime-user": pageUser },
    })
  return { get, reads }
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
    const { get, reads } = await buildApp()

    const responses = await Promise.all(READS.map((path) => get(path, "8")))

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
    expect((await responses[1].json()).error.code).toBe("unauthorized")
    expect(reads).toEqual([])
  })

  it("serves a page that names the session's user, and a caller that names nobody", async () => {
    const { get, reads } = await buildApp()

    const named = await get("/notifications", "7")
    const unnamed = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes?limit=10")

    expect([named.status, unnamed.status]).toEqual([200, 200])
    expect(reads).toEqual(["notifications", "note list"])
  })

  it("leaves a request without a session to the route, whoever its page names", async () => {
    const { get, reads } = await buildApp(null)

    const signedOut = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes", "8")
    const open = await get("/notifications", "8")

    expect((await signedOut.json()).error.code).toBe("AUTH_REQUIRED")
    expect(open.status).toBe(200)
    expect(reads).toEqual(["notifications"])
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
})
