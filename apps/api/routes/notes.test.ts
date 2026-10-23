import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import type {
  NoteCreateCommand,
  NoteListQuery,
  NoteMoveCommand,
  NoteRestoreCommand,
  NoteUpdateCommand,
} from "@domain/notes"
import { TagError } from "@domain/tags"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { createNotesRoute, type NotesRouteDependencies } from "./notes.ts"
import { apiError } from "../_testing/api-error.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const at = new Date("2026-10-02T10:00:00.000Z")
const note = {
  id: noteId,
  groupId,
  title: "Plan",
  body: "",
  tagIds: [],
  version: 1,
  changeSequence: "2",
  createdByUserId: 7,
  updatedByUserId: 7,
  createdAt: at,
  updatedAt: at,
}

function harness(
  created = true,
  auth: APIContext["Variables"]["auth"] = buildAuthData({ user: { id: 7 } }),
) {
  const seen: {
    create: NoteCreateCommand | null
    update: NoteUpdateCommand | null
    list: NoteListQuery | null
    move: NoteMoveCommand | null
    restore: NoteRestoreCommand | null
  } = { create: null, update: null, list: null, move: null, restore: null }
  const dependencies: NotesRouteDependencies = {
    create(command) {
      seen.create = command
      return Promise.resolve({ note, created })
    },
    update(command) {
      seen.update = command
      return Promise.resolve({ note })
    },
    delete: () =>
      Promise.resolve({ note: { id: noteId, groupId, version: 2, changeSequence: "3" } }),
    restore(command) {
      seen.restore = command
      return Promise.resolve({ note })
    },
    move(command) {
      seen.move = command
      return Promise.resolve({ notes: [note] })
    },
    get: () => Promise.resolve({ note }),
    list(query) {
      seen.list = query
      return Promise.resolve({ notes: [note], nextPageKey: { updatedAt: at, id: noteId } })
    },
    cursor: {
      encode: (userId, group) => Promise.resolve(`cursor-${userId}-${group}`),
      decode: () => Promise.resolve({ updatedAt: at, id: noteId }),
    },
  }
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-notes")
    c.set("auth", auth)
    await next()
  })
  app.route("/groups/:groupId/notes", createNotesRoute(dependencies))
  const request = (method: string, path: string, body?: unknown, headers = {}) =>
    app.request(`http://local/groups/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: "http://local",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  return { request, seen, dependencies }
}

describe("notes route", () => {
  it("creates a note in the group of the path, as the session's user, with the idempotency key", async () => {
    const { request, seen } = harness()

    const response = await request(
      "POST",
      `${groupId}/notes`,
      { id: noteId, title: " Plan ", body: "" },
      { "idempotency-key": "key-1" },
    )

    expect(response.status).toBe(201)
    expect(seen.create?.data).toMatchObject({
      groupId,
      id: noteId,
      title: "Plan",
      idempotencyKey: "key-1",
      actor: { userId: 7 },
    })
  })

  it("moves with the path's group as the source, the request id and the idempotency key", async () => {
    const { request, seen } = harness()
    const toGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"

    const response = await request(
      "POST",
      `${groupId}/notes/move`,
      { toGroupId, noteIds: [noteId] },
      { "idempotency-key": "key-2" },
    )

    expect(response.status).toBe(200)
    expect(seen.move?.data).toMatchObject({
      groupId,
      toGroupId,
      noteIds: [noteId],
      requestId: "req-notes",
      idempotencyKey: "key-2",
      actor: { userId: 7 },
    })
    expect(seen.create).toBe(null)
  })

  it("answers 409 to a move whose tags do not fit the other group", async () => {
    const { request, dependencies } = harness()
    dependencies.move = () =>
      Promise.reject(new TagError("TAG_LIMIT_REACHED", "The other group has no room"))

    const response = await request("POST", `${groupId}/notes/move`, {
      toGroupId: "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003",
      noteIds: [noteId],
    })

    expect(response.status).toBe(409)
    expect(await apiError(response)).toMatchObject({
      reason: "TAG_LIMIT_REACHED",
      message: "The other group has no room for these notes' tags",
    })
  })

  it("restores the note of the path in the group of the path, with the request id and key", async () => {
    const { request, seen } = harness()

    const response = await request(
      "POST",
      `${groupId}/notes/${noteId}/restore`,
      {},
      { "idempotency-key": "key-3" },
    )

    expect(response.status).toBe(200)
    expect((await response.json()).note.id).toBe(noteId)
    expect(seen.restore?.data).toMatchObject({
      groupId,
      id: noteId,
      requestId: "req-notes",
      idempotencyKey: "key-3",
      actor: { userId: 7 },
    })
  })

  it("lists the deleted notes only for `deleted=true`", async () => {
    const { request, seen } = harness()

    await request("GET", `${groupId}/notes?deleted=true`)
    const deleted = seen.list?.data.deleted
    await request("GET", `${groupId}/notes`)
    const live = seen.list?.data.deleted

    expect([deleted, live]).toEqual([true, false])
  })

  it("answers 200 to a create that found the same note already there", async () => {
    const { request } = harness(false)

    const response = await request("POST", `${groupId}/notes`, {
      id: noteId,
      title: "Plan",
      body: "",
    })

    expect(response.status).toBe(200)
  })

  it("updates with the version the client edited", async () => {
    const { request, seen } = harness()

    const response = await request("PATCH", `${groupId}/notes/${noteId}`, {
      title: "Plan",
      body: "b",
      version: 3,
    })

    expect(response.status).toBe(200)
    expect(seen.update?.data).toMatchObject({ groupId, id: noteId, version: 3 })
  })

  it("lists a page with a cursor bound to the user and the group", async () => {
    const { request, seen } = harness()

    const response = await request("GET", `${groupId}/notes?limit=10`)

    expect(response.status).toBe(200)
    expect(seen.list?.data.page.limit).toBe(10)
    expect((await response.json()).nextCursor).toBe(`cursor-7-${groupId}`)
  })

  it("refuses a malformed group or note id, a body naming a user, and a bad limit", async () => {
    const { request, seen } = harness()

    const responses = [
      await request("POST", "not-a-uuid/notes", { id: noteId, title: "Plan", body: "" }),
      await request("PATCH", `${groupId}/notes/not-a-uuid`, { title: "a", body: "", version: 1 }),
      await request("POST", `${groupId}/notes`, { id: noteId, title: "a", body: "", userId: 9 }),
      await request("GET", `${groupId}/notes?limit=101`),
      await request("POST", `${groupId}/notes/not-a-uuid/restore`, {}),
      await request("POST", `${groupId}/notes/${noteId}/restore`, { version: 1 }),
      await request("GET", `${groupId}/notes?deleted=yes`),
    ]

    expect(responses.map((response) => response.status)).toEqual([
      400,
      400,
      400,
      400,
      400,
      400,
      400,
    ])
    expect([seen.create, seen.update, seen.list, seen.restore]).toEqual([null, null, null, null])
  })

  it("refuses a write from another origin", async () => {
    const { request, seen } = harness()

    const response = await request(
      "POST",
      `${groupId}/notes`,
      { id: noteId, title: "Plan", body: "" },
      { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    )

    expect(response.status).toBe(403)
    expect(seen.create).toBe(null)
  })

  it("refuses a request without a session", async () => {
    const { request } = harness(true, null)

    const response = await request("GET", `${groupId}/notes`)

    expect(response.status).toBe(401)
    expect((await apiError(response)).reason).toBe("AUTH_REQUIRED")
  })
})
