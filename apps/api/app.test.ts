import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { buildAuthData } from "./_testing/fake-auth.ts"
import { createApiApp } from "./app.ts"
import { createNotesRoute, type NotesRouteDependencies } from "./routes/notes.ts"
import type { APIContext } from "./_types.ts"

type Auth = APIContext["Variables"]["auth"]

/** The API's app with the notes route and one plain route, signed in as user 7 unless told. */
function buildApp(auth: Auth = buildAuthData({ user: { id: 7 } })) {
  const reads: string[] = []
  const app = createApiApp({
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

describe("the API's app", () => {
  it("refuses every read whose page names another user than the session's, and reads nothing", async () => {
    const { get, reads } = buildApp()

    const responses = await Promise.all(READS.map((path) => get(path, "8")))

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
    expect((await responses[1].json()).error.code).toBe("unauthorized")
    expect(reads).toEqual([])
  })

  it("serves a page that names the session's user, and a caller that names nobody", async () => {
    const { get, reads } = buildApp()

    const named = await get("/notifications", "7")
    const unnamed = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes?limit=10")

    expect([named.status, unnamed.status]).toEqual([200, 200])
    expect(reads).toEqual(["notifications", "note list"])
  })

  it("leaves a request without a session to the route, whoever its page names", async () => {
    const { get, reads } = buildApp(null)

    const signedOut = await get("/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002/notes", "8")
    const open = await get("/notifications", "8")

    expect((await signedOut.json()).error.code).toBe("AUTH_REQUIRED")
    expect(open.status).toBe(200)
    expect(reads).toEqual(["notifications"])
  })
})
