import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { FREE_PLAN_ID } from "@domain/billing"
import { GroupRole } from "@domain/groups"
import {
  NoteCreateCommand,
  NoteDeleteCommand,
  NoteGetQuery,
  NoteListQuery,
  NoteLocateQuery,
  NoteMoveCommand,
  NoteRestoreCommand,
  NoteUpdateCommand,
} from "@domain/notes"
import {
  TAG_MAX_PER_GROUP,
  TagCreateCommand,
  TagDeleteCommand,
  TagGetQuery,
  TagListQuery,
  TagUpdateCommand,
} from "@domain/tags"
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { createEntitlementGate } from "../../cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../cqrs/entitlement-needs.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { MemoryNoteRepository, roles } from "../../_testing/memory-notes.ts"
import { MemoryTagRepository } from "../../_testing/memory-tags.ts"
import type { APIContext } from "../../_types.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  WEB_APP_URL,
} from "../../_testing/mutation-requests.ts"
import { createCallRoute } from "../../routes/call.ts"
import { createTagsRoute } from "../../routes/tags.ts"
import { Realtime, toRequestError } from "../../services/realtime.ts"
import {
  createNoteCreateHandler,
  createNoteDeleteHandler,
  createNoteGetHandler,
  createNoteListHandler,
  createNoteLocateHandler,
  createNoteMoveHandler,
  createNoteRestoreHandler,
  createNoteUpdateHandler,
} from "../notes/handlers.ts"
import { createNoteOperations } from "../notes/operations.ts"
import {
  createTagCreateHandler,
  createTagDeleteHandler,
  createTagGetHandler,
  createTagListHandler,
  createTagUpdateHandler,
} from "./handlers.ts"
import { createTagOperations } from "./operations.ts"
import { isUuid, uuidV7 } from "@spy4x/platform/universal/uuid"
import { apiError } from "../../_testing/api-error.ts"
import { checkedError } from "../../_testing/api-error.ts"

/**
 * Tags over every transport, as the API wires them: one pair of buses, the gates and the real
 * handlers over in-memory repositories. The socket and the call route are two adapters of one
 * operations table, so every scenario runs through both and expects the same answer; the REST
 * route keeps the list. The note scenarios at the end are the contract between a tag and the notes
 * that carry it (ADR 003, section 5, rules 3 and 4).
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const otherGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const tagId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112001"
const secondTagId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112002"
const unknownTagId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d112999"
const OWNER = 1
const VIEWER = 2
const STRANGER = 9

function stack() {
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
    [`${otherGroupId}:${OWNER}`]: GroupRole.OWNER,
  })
  const notes = new MemoryNoteRepository(groups)
  const tags = new MemoryTagRepository(notes)
  const noteDependencies = { notes, groups }
  const tagDependencies = { tags, groups }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: () => Promise.resolve(FREE_PLAN_ID),
    roleOf: (group, user) => groups.roleOf(group, user),
    usage: {
      maxNotes: () => Promise.resolve(0),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(noteDependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(noteDependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(noteDependencies))
  commands.register(NoteMoveCommand, createNoteMoveHandler(noteDependencies))
  commands.register(NoteRestoreCommand, createNoteRestoreHandler(noteDependencies))
  commands.register(TagCreateCommand, createTagCreateHandler(tagDependencies))
  commands.register(TagUpdateCommand, createTagUpdateHandler(tagDependencies))
  commands.register(TagDeleteCommand, createTagDeleteHandler(tagDependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(noteDependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(noteDependencies))
  queries.register(NoteLocateQuery, createNoteLocateHandler(noteDependencies))
  queries.register(TagListQuery, createTagListHandler(tagDependencies))
  queries.register(TagGetQuery, createTagGetHandler(tagDependencies))
  const operations = {
    ...createNoteOperations({
      create: (command) => commands.execute(command),
      update: (command) => commands.execute(command),
      delete: (command) => commands.execute(command),
      move: (command) => commands.execute(command),
      restore: (command) => commands.execute(command),
      list: (query) => queries.execute(query),
      get: (query) => queries.execute(query),
      locate: (query) => queries.execute(query),
      search: () => Promise.reject(new Error("not part of this test")),
      cursor: {
        encode: () => Promise.resolve("next"),
        decode: () => Promise.resolve({ updatedAt: new Date(0), id: noteId }),
      },
    }),
    ...createTagOperations({
      create: (command) => commands.execute(command),
      update: (command) => commands.execute(command),
      delete: (command) => commands.execute(command),
      list: (query) => queries.execute(query),
      get: (query) => queries.execute(query),
    }),
  }
  return { notes, tags, operations, queries }
}

type Stack = ReturnType<typeof stack>

/** An answer in the socket's frame shape, whichever adapter carried the call. */
type Answer =
  | { kind: "server.result"; payload: unknown }
  | { kind: "server.error"; code: string; message: string; details?: unknown }
  | undefined

/** One adapter of the operations table, signed in as one user. */
interface Transport {
  command(name: string, payload: unknown): Promise<Answer>
  query(name: string, payload: unknown): Promise<Answer>
  shutdown(): void
}

function socket(stack: Stack, userId: number): Transport {
  const auth = buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } })
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    operations: stack.operations,
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth)
  let sent = 0
  const send = async (frame: Record<string, unknown>) => {
    const id = `request-${++sent}`
    ws.receive(JSON.stringify({ ...frame, id }))
    let answer: Record<string, unknown> | undefined
    for (let drains = 0; !answer && drains < 10; drains++) {
      await drainMicrotasks()
      answer = ws.frames().find((candidate) =>
        (candidate as { requestId?: string }).requestId === id
      ) as Record<string, unknown> | undefined
    }
    if (!answer) return undefined
    const { requestId: _requestId, ...rest } = answer
    return rest as Answer
  }
  return {
    command: (name, payload) =>
      send({ kind: "client.command", name, payload, idempotencyKey: `key-${name}` }),
    query: (name, payload) => send({ kind: "client.query", name, payload }),
    shutdown: () => realtime.shutdown(),
  }
}

/** `POST /api/call/<name>`, as the page's HTTP calls module sends it. */
function callRoute(stack: Stack, userId: number): Transport {
  const app = mountRoute(
    "/call",
    createCallRoute({
      operations: stack.operations,
      mapError: toRequestError,
      log: () => {},
      expectedOrigin: WEB_APP_URL,
    }),
    buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } }),
  )
  const send = async (name: string, payload: unknown, headers: Record<string, string>) => {
    const response = await app.request(`${API_URL}/call/${name}`, {
      method: "POST",
      headers: { ...sameOriginHeaders, "x-realtime-user": String(userId), ...headers },
      body: JSON.stringify(payload),
    })
    const body = await response.json()
    if (response.ok) return { kind: "server.result", payload: body.result } as Answer
    return { kind: "server.error", ...checkedError(body) } as Answer
  }
  return {
    command: (name, payload) => send(name, payload, { "idempotency-key": `key-${name}` }),
    query: (name, payload) => send(name, payload, {}),
    shutdown: () => {},
  }
}

const TRANSPORTS = [["the socket", socket], ["the call route", callRoute]] as const

const create = { groupId, id: tagId, name: "Work", color: "#1d4ed8" }

for (const [via, open] of TRANSPORTS) {
  describe(`tags over ${via}`, () => {
    it("refuses every write of a viewer and changes nothing", async () => {
      const s = stack()
      await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
      s.tags.writes = 0
      const as = open(s, VIEWER)

      const answers = [
        await as.command("tag.create", { ...create, id: secondTagId, name: "Home" }),
        await as.command("tag.update", { ...create, name: "Job", version: 1 }),
        await as.command("tag.delete", { groupId, id: tagId, version: 1 }),
      ]

      for (const answer of answers) {
        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
      }
      expect(s.tags.writes).toBe(0)
      as.shutdown()
    })

    it("lets a viewer list the group's tags by name", async () => {
      const s = stack()
      await s.tags.create({ groupId, id: secondTagId, name: "work", color: "#b91c1c" }, OWNER)
      await s.tags.create({ groupId, id: tagId, name: "Home", color: "#1d4ed8" }, OWNER)
      await s.tags.create({
        groupId: otherGroupId,
        id: uuidV7(),
        name: "Other",
        color: "#4b5563",
      }, OWNER)
      const as = open(s, VIEWER)

      const answer = await as.query("tag.list", { groupId })

      expect(answer).toMatchObject({ kind: "server.result" })
      const listed = (answer as { payload: { tags: { name: string }[] } }).payload.tags
      expect(listed.map((tag) => tag.name)).toEqual(["Home", "work"])
      as.shutdown()
    })

    it("tells a stranger the group does not exist", async () => {
      const s = stack()
      const as = open(s, STRANGER)

      const answer = await as.query("tag.list", { groupId })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "not_found",
        details: { code: "GROUP_NOT_FOUND" },
      })
      as.shutdown()
    })

    it("lets an owner create, rename and recolour, and delete a tag", async () => {
      const s = stack()
      const as = open(s, OWNER)

      const created = await as.command("tag.create", create)
      const updated = await as.command("tag.update", {
        ...create,
        name: "Job",
        color: "#b91c1c",
        version: 1,
      })
      const deleted = await as.command("tag.delete", { groupId, id: tagId, version: 2 })

      expect(created).toMatchObject({
        kind: "server.result",
        payload: { created: true, tag: { name: "Work", color: "#1d4ed8", version: 1 } },
      })
      expect(updated).toMatchObject({
        kind: "server.result",
        payload: { tag: { name: "Job", color: "#b91c1c", version: 2 } },
      })
      expect(deleted).toMatchObject({
        kind: "server.result",
        payload: { tag: { id: tagId, version: 2 } },
      })
      expect(s.tags.tags.size).toBe(0)
      as.shutdown()
    })

    it("renames a tag whose id and group id are UUID version 4, made before ids became version 7", async () => {
      expect([isUuid(groupId, 4), isUuid(tagId, 4)]).toEqual([true, true])
      const s = stack()
      await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
      const as = open(s, OWNER)

      const updated = await as.command("tag.update", { ...create, name: "Job", version: 1 })

      expect(updated).toMatchObject({
        kind: "server.result",
        payload: { tag: { id: tagId, name: "Job", version: 2 } },
      })
      as.shutdown()
    })

    it("answers a stale rename with a conflict and the current version", async () => {
      const s = stack()
      await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
      const as = open(s, OWNER)

      const answer = await as.command("tag.update", { ...create, name: "Job", version: 5 })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "conflict",
        details: { code: "VERSION_CONFLICT", currentVersion: 1 },
      })
      expect(s.tags.tags.get(tagId)?.name).toBe("Work")
      as.shutdown()
    })

    it("refuses a name another tag of the group has, whatever its case", async () => {
      const s = stack()
      await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
      const as = open(s, OWNER)

      const answer = await as.command("tag.create", { ...create, id: secondTagId, name: "WORK" })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "conflict",
        details: { code: "TAG_NAME_TAKEN" },
      })
      as.shutdown()
    })

    it("refuses the tag past the group's cap as a conflict, and keeps the group at the cap", async () => {
      const s = stack()
      for (let index = 0; index < TAG_MAX_PER_GROUP; index++) {
        await s.tags.create(
          { groupId, id: uuidV7(), name: `Tag ${index}`, color: "#4b5563" },
          OWNER,
        )
      }
      const as = open(s, OWNER)

      const answer = await as.command("tag.create", { ...create, name: "One too many" })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "conflict",
        details: { code: "TAG_LIMIT_REACHED" },
      })
      expect(s.tags.tags.size).toBe(TAG_MAX_PER_GROUP)
      as.shutdown()
    })

    it("refuses a colour that is no #rrggbb and an empty name", async () => {
      const s = stack()
      const as = open(s, OWNER)

      const answers = [
        await as.command("tag.create", { ...create, color: "blue" }),
        await as.command("tag.create", { ...create, color: "#1d4ed" }),
        await as.command("tag.create", { ...create, name: "   " }),
      ]

      for (const answer of answers) {
        expect(answer).toMatchObject({ kind: "server.error", code: "bad_request" })
      }
      expect(s.tags.tags.size).toBe(0)
      as.shutdown()
    })

    it("refuses a NUL in a tag name, and stores nothing", async () => {
      const s = stack()
      const as = open(s, OWNER)
      await as.command("tag.create", create)
      const nul = "a\u0000b"

      const answers = [
        await as.command("tag.create", { ...create, id: secondTagId, name: nul }),
        await as.command("tag.update", { ...create, name: nul, version: 1 }),
      ]

      for (const answer of answers) {
        expect(answer).toMatchObject({
          kind: "server.error",
          code: "bad_request",
          details: { code: "INVALID_REQUEST" },
        })
      }
      expect([...s.tags.tags.values()].map((tag) => tag.name)).toEqual(["Work"])
      as.shutdown()
    })

    it("answers a retried create with the first tag", async () => {
      const s = stack()
      const as = open(s, OWNER)

      await as.command("tag.create", create)
      const again = await as.command("tag.create", create)

      expect(again).toMatchObject({ kind: "server.result" })
      expect(s.tags.writes).toBe(1)
      as.shutdown()
    })

    it("answers a delete of a tag that is gone as not found", async () => {
      const s = stack()
      const as = open(s, OWNER)

      const answer = await as.command("tag.delete", { groupId, id: tagId, version: 1 })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "not_found",
        details: { code: "TAG_NOT_FOUND" },
      })
      as.shutdown()
    })

    describe("tags on notes", () => {
      const note = { groupId, id: noteId, title: "Plan", body: "" }

      it("keeps the tags a note names that exist and ignores the ones that do not", async () => {
        const s = stack()
        await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
        await s.tags.create(
          { groupId: otherGroupId, id: secondTagId, name: "Elsewhere", color: "#b91c1c" },
          OWNER,
        )
        const as = open(s, OWNER)

        const answer = await as.command("note.create", {
          ...note,
          tagIds: [unknownTagId, tagId, secondTagId],
        })

        expect(answer).toMatchObject({
          kind: "server.result",
          payload: { note: { tagIds: [tagId] } },
        })
        as.shutdown()
      })

      it("ignores an unknown tag id on an update and answers with the tags the note has", async () => {
        const s = stack()
        await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
        await s.notes.create({ ...note, tagIds: [tagId] }, OWNER, null)
        const as = open(s, OWNER)

        const answer = await as.command("note.update", {
          ...note,
          tagIds: [unknownTagId],
          version: 1,
        })

        expect(answer).toMatchObject({
          kind: "server.result",
          payload: { note: { tagIds: [], version: 2 } },
        })
        as.shutdown()
      })

      it("keeps a note's tags when an update names none", async () => {
        const s = stack()
        await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
        await s.notes.create({ ...note, tagIds: [tagId] }, OWNER, null)
        const as = open(s, OWNER)

        const answer = await as.command("note.update", { ...note, title: "Plan 2", version: 1 })

        expect(answer).toMatchObject({
          kind: "server.result",
          payload: { note: { tagIds: [tagId] } },
        })
        as.shutdown()
      })

      it("removes a deleted tag from its notes without changing their version", async () => {
        const s = stack()
        await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
        await s.notes.create({ ...note, tagIds: [tagId] }, OWNER, null)
        const before = s.notes.notes.get(noteId)!
        const as = open(s, OWNER)

        const deleted = await as.command("tag.delete", { groupId, id: tagId, version: 1 })

        expect(deleted).toMatchObject({ kind: "server.result" })
        const after = s.notes.notes.get(noteId)!
        expect(after.tagIds).toEqual([])
        expect(after.version).toBe(before.version)
        expect(after.changeSequence).toBe(before.changeSequence)
        as.shutdown()
      })

      it("lists each tag with how many live notes carry it, leaving deleted notes out", async () => {
        const s = stack()
        await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)
        await s.tags.create({ groupId, id: secondTagId, name: "Home", color: "#b91c1c" }, OWNER)
        await s.notes.create({ ...note, tagIds: [tagId, secondTagId] }, OWNER, null)
        await s.notes.create({ ...note, id: uuidV7(), tagIds: [tagId] }, OWNER, null)
        const gone = uuidV7()
        await s.notes.create({ ...note, id: gone, tagIds: [tagId] }, OWNER, null)
        await s.notes.delete({ groupId, id: gone, expectedVersion: 1 }, OWNER)
        const as = open(s, VIEWER)

        const answer = await as.query("tag.list", { groupId })

        const listed = (answer as { payload: { tags: { name: string; noteCount: number }[] } })
          .payload.tags
        expect(listed.map(({ name, noteCount }) => [name, noteCount])).toEqual([
          ["Home", 1],
          ["Work", 2],
        ])
        as.shutdown()
      })
    })
  })
}

describe("tags over the call route", () => {
  it("answers 400 to a tag name that holds a NUL", async () => {
    const app = mountRoute(
      "/call",
      createCallRoute({
        operations: stack().operations,
        mapError: toRequestError,
        log: () => {},
        expectedOrigin: WEB_APP_URL,
      }),
      buildAuthData({ user: { id: OWNER }, session: { id: OWNER * 10, userId: OWNER } }),
    )

    const response = await app.request(`${API_URL}/call/tag.create`, {
      method: "POST",
      headers: {
        ...sameOriginHeaders,
        "x-realtime-user": String(OWNER),
        "idempotency-key": "key-nul",
      },
      body: JSON.stringify({ ...create, name: "a\u0000b" }),
    })

    expect(response.status).toBe(400)
    expect(await apiError(response)).toMatchObject({
      code: "bad_request",
      details: { code: "INVALID_REQUEST" },
    })
  })
})

describe("tags over the REST list", () => {
  function rest(s: Stack, userId: number | null) {
    const app = new Hono<APIContext>()
    app.use("*", async (c, next) => {
      c.set("requestId", "req-tags")
      if (userId !== null) {
        c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
      }
      await next()
    })
    app.route(
      "/groups/:groupId/tags",
      createTagsRoute({ list: (query) => s.queries.execute(query) }),
    )
    return (id: string) => app.request(`http://local/groups/${id}/tags`)
  }

  it("lists a member's group tags", async () => {
    const s = stack()
    await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)

    const response = await rest(s, VIEWER)(groupId)

    expect(response.status).toBe(200)
    expect((await response.json()).tags).toMatchObject([{ id: tagId, name: "Work" }])
  })

  it("lists the tags of a group whose id is a UUID version 4", async () => {
    expect(isUuid(groupId, 4)).toBe(true)
    const s = stack()
    await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)

    const response = await rest(s, OWNER)(groupId)

    expect(response.status).toBe(200)
    expect((await response.json()).tags).toMatchObject([{ id: tagId }])
  })

  it("answers a stranger as an unknown group, with no tag", async () => {
    const s = stack()
    await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)

    const response = await rest(s, STRANGER)(groupId)

    expect(response.status).toBe(404)
    expect(JSON.stringify(await response.json())).not.toContain("Work")
  })

  it("answers 401 and lists nothing when there is no session", async () => {
    const s = stack()
    await s.tags.create({ groupId, id: tagId, name: "Work", color: "#1d4ed8" }, OWNER)

    const response = await rest(s, null)(groupId)

    expect(response.status).toBe(401)
    expect(JSON.stringify(await response.json())).not.toContain("Work")
  })

  it("refuses a group id that is not a UUID", async () => {
    const response = await rest(stack(), OWNER)("not-a-group")

    expect(response.status).toBe(400)
  })
})
