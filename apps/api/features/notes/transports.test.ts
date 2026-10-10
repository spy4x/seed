import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { drainMicrotasks, FakeClock, FakeSocket } from "@spy4x/realtime/testing"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { FREE_PLAN_ID, PRO_PLAN_ID } from "@domain/billing"
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
import { createSessionGate } from "../../cqrs/session-gate.ts"
import { createEntitlementGate } from "../../cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../../cqrs/entitlement-needs.ts"
import { buildAuthData } from "../../_testing/fake-auth.ts"
import { MemoryNoteRepository, roles } from "../../_testing/memory-notes.ts"
import type { APIContext } from "../../_types.ts"
import {
  API_URL,
  mountRoute,
  sameOriginHeaders,
  WEB_APP_URL,
} from "../../_testing/mutation-requests.ts"
import { createCallRoute } from "../../routes/call.ts"
import { createNotesRoute } from "../../routes/notes.ts"
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
} from "./handlers.ts"
import { createNoteOperations } from "./operations.ts"

/**
 * Every transport over one pair of buses, as the API wires them. The socket and the call route
 * (`POST /api/call/<name>`) are two adapters of one operations table, so every scenario runs
 * through both and expects the same answer; the REST route keeps the list and read. The adapters
 * parse, and the gates and handlers on the buses decide who may do what. Nothing here stubs the
 * handlers, so a transport that skipped the buses, or a handler that skipped the check, fails these
 * tests. The group is on `plan` (the free plan unless a test says otherwise), with billing on.
 */

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
/** Where OWNER may write, may only read, and is no member at all. */
const editableGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
const readOnlyGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111004"
const strangerGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111005"
const OWNER = 1
const VIEWER = 2
const EDITOR = 3
const ADMIN = 4
const STRANGER = 9

function stack(plan = FREE_PLAN_ID, plans: Record<string, string> = {}) {
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${groupId}:${VIEWER}`]: GroupRole.VIEWER,
    [`${groupId}:${EDITOR}`]: GroupRole.EDITOR,
    [`${groupId}:${ADMIN}`]: GroupRole.ADMIN,
    [`${editableGroupId}:${OWNER}`]: GroupRole.EDITOR,
    [`${editableGroupId}:${VIEWER}`]: GroupRole.EDITOR,
    [`${readOnlyGroupId}:${OWNER}`]: GroupRole.VIEWER,
  })
  const notes = new MemoryNoteRepository(groups)
  const dependencies = { notes, groups }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: (group) => Promise.resolve(plans[group] ?? plan),
    roleOf: (group, user) => dependencies.groups.roleOf(group, user),
    usage: {
      maxNotes: (group) =>
        Promise.resolve([...notes.notes.values()].filter((note) => note.groupId === group).length),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  commands.register(NoteUpdateCommand, createNoteUpdateHandler(dependencies))
  commands.register(NoteDeleteCommand, createNoteDeleteHandler(dependencies))
  commands.register(NoteMoveCommand, createNoteMoveHandler(dependencies))
  commands.register(NoteRestoreCommand, createNoteRestoreHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  queries.register(NoteLocateQuery, createNoteLocateHandler(dependencies))
  const buses = {
    create: (command: NoteCreateCommand) => commands.execute(command),
    update: (command: NoteUpdateCommand) => commands.execute(command),
    delete: (command: NoteDeleteCommand) => commands.execute(command),
    move: (command: NoteMoveCommand) => commands.execute(command),
    restore: (command: NoteRestoreCommand) => commands.execute(command),
    list: (query: NoteListQuery) => queries.execute(query),
    get: (query: NoteGetQuery) => queries.execute(query),
    locate: (query: NoteLocateQuery) => queries.execute(query),
    cursor: {
      encode: () => Promise.resolve("next"),
      decode: () => Promise.resolve({ updatedAt: new Date(0), id: noteId }),
    },
  }
  return { notes, buses }
}

async function seedNote(notes: MemoryNoteRepository) {
  await notes.create({ groupId, id: noteId, title: "Plan", body: "" }, OWNER, null)
  await notes.update(
    { groupId, id: noteId, title: "Plan v2", body: "", expectedVersion: 1 },
    OWNER,
  )
  notes.writes = 0
}

/** Fills the group up to the free plan's cap of 10 notes. */
async function fillFreePlan(notes: MemoryNoteRepository) {
  for (let i = 0; i < 10; i++) {
    await notes.create({ groupId, id: crypto.randomUUID(), title: `Note ${i}`, body: "" }, 1, null)
  }
  notes.writes = 0
}

/** REST, for the list and read routes: the only note routes the session API keeps (ADR 003). */
/** The owner deletes the seeded note (version 2), leaving it at version 3, deleted. */
async function seedDeleted(notes: MemoryNoteRepository) {
  await seedNote(notes)
  await notes.delete({ groupId, id: noteId, expectedVersion: 2 }, OWNER)
  notes.writes = 0
}

function rest(buses: ReturnType<typeof stack>["buses"], userId: number) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-notes")
    c.set("auth", buildAuthData({ user: { id: userId }, session: { userId } }))
    await next()
  })
  app.route("/groups/:groupId/notes", createNotesRoute(buses))
  return (path: string) =>
    app.request(`http://local/groups/${groupId}/notes${path}`, {
      headers: { cookie: "sessionIdToken=1:token", "sec-fetch-site": "same-origin" },
    })
}

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

function socket(buses: ReturnType<typeof stack>["buses"], userId: number): Transport {
  const auth = buildAuthData({ user: { id: userId }, session: { id: userId * 10, userId } })
  const realtime = new Realtime({
    clock: new FakeClock(),
    entitledSession: () => Promise.resolve(auth),
    memberUserIds: () => Promise.resolve([]),
    operations: createNoteOperations(buses),
    log: () => {},
  })
  const ws = new FakeSocket("wss://app.example.com/api/ws")
  ws.openFromPeer()
  realtime.attach(ws, auth)
  let sent = 0
  const send = async (frame: Record<string, unknown>) => {
    const id = `request-${++sent}`
    ws.receive(JSON.stringify({ ...frame, id }))
    // A handler awaits more than one drain covers; the bound keeps a missing answer a failure.
    let answer: Record<string, unknown> | undefined
    for (let drains = 0; !answer && drains < 10; drains++) {
      await drainMicrotasks()
      answer = ws.frames().find((candidate) =>
        (candidate as { requestId?: string }).requestId === id
      ) as Record<string, unknown> | undefined
    }
    if (!answer) return undefined
    // The request id is the socket's own; the scenarios compare what both adapters answer.
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
function callRoute(buses: ReturnType<typeof stack>["buses"], userId: number): Transport {
  const app = mountRoute(
    "/call",
    createCallRoute({
      operations: createNoteOperations(buses),
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
    return { kind: "server.error", ...body.error } as Answer
  }
  return {
    command: (name, payload) => send(name, payload, { "idempotency-key": `key-${name}` }),
    query: (name, payload) => send(name, payload, {}),
    shutdown: () => {},
  }
}

const TRANSPORTS = [["the socket", socket], ["the call route", callRoute]] as const

for (const [via, open] of TRANSPORTS) {
  describe(`notes over ${via}`, () => {
    it("refuses every write of a viewer and changes nothing", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      const as = open(buses, VIEWER)

      const answers = [
        await as.command("note.create", {
          groupId,
          id: crypto.randomUUID(),
          title: "Mine",
          body: "",
        }),
        await as.command("note.update", { groupId, id: noteId, title: "x", body: "", version: 2 }),
        await as.command("note.delete", { groupId, id: noteId, version: 2 }),
      ]

      for (const answer of answers) {
        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
      }
      expect(notes.writes).toBe(0)
      as.shutdown()
    })

    it("lets a viewer read a note", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      const as = open(buses, VIEWER)

      const answer = await as.query("note.get", { groupId, id: noteId })

      expect(answer).toMatchObject({
        kind: "server.result",
        payload: { note: { title: "Plan v2" } },
      })
      as.shutdown()
    })

    it("answers a stale update with a conflict and the current version", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      const as = open(buses, OWNER)

      const answer = await as.command("note.update", {
        groupId,
        id: noteId,
        title: "From version 1",
        body: "",
        version: 1,
      })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "conflict",
        details: { code: "VERSION_CONFLICT", currentVersion: 2 },
      })
      expect(notes.notes.get(noteId)?.title).toBe("Plan v2")
      as.shutdown()
    })

    it("answers a stale delete with a conflict and the current version", async () => {
      const { notes, buses } = stack()
      await seedNote(notes)
      const as = open(buses, OWNER)

      const answer = await as.command("note.delete", { groupId, id: noteId, version: 1 })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "conflict",
        details: { code: "VERSION_CONFLICT", currentVersion: 2 },
      })
      expect(notes.notes.has(noteId)).toBe(true)
      as.shutdown()
    })

    it("lets an owner create, update and delete", async () => {
      const { notes, buses } = stack()
      const as = open(buses, OWNER)

      const created = await as.command("note.create", {
        groupId,
        id: noteId,
        title: "A",
        body: "",
      })
      const updated = await as.command("note.update", {
        groupId,
        id: noteId,
        title: "B",
        body: "b",
        version: 1,
      })
      const deleted = await as.command("note.delete", { groupId, id: noteId, version: 2 })

      expect(created).toMatchObject({ kind: "server.result", payload: { created: true } })
      expect(updated).toMatchObject({ kind: "server.result", payload: { note: { version: 2 } } })
      expect(deleted).toMatchObject({ kind: "server.result", payload: { note: { version: 3 } } })
      expect(notes.writes).toBe(3)
      as.shutdown()
    })

    it("refuses a note over the free plan's cap, and tells the owner to upgrade", async () => {
      const { notes, buses } = stack()
      await fillFreePlan(notes)
      const as = open(buses, OWNER)

      const answer = await as.command("note.create", {
        groupId,
        id: crypto.randomUUID(),
        title: "Eleventh",
        body: "",
      })

      expect(answer).toMatchObject({
        kind: "server.error",
        code: "forbidden",
        details: {
          code: "PLAN_LIMIT_REACHED",
          entitlement: "maxNotes",
          limit: 10,
          canUpgrade: true,
        },
      })
      expect(notes.writes).toBe(0)
      as.shutdown()
    })

    it("lets a group on Pro add notes past the free plan's cap", async () => {
      const { notes, buses } = stack(PRO_PLAN_ID)
      await fillFreePlan(notes)
      const as = open(buses, OWNER)

      const answer = await as.command("note.create", {
        groupId,
        id: crypto.randomUUID(),
        title: "Eleventh",
        body: "",
      })

      expect(answer).toMatchObject({ kind: "server.result", payload: { created: true } })
      expect(notes.writes).toBe(1)
      as.shutdown()
    })

    it("lets a group over its cap read, edit and delete what it has", async () => {
      const { notes, buses } = stack()
      await fillFreePlan(notes)
      await seedNote(notes)
      const as = open(buses, OWNER)

      const answers = [
        await as.query("note.get", { groupId, id: noteId }),
        await as.command("note.update", {
          groupId,
          id: noteId,
          title: "Kept",
          body: "",
          version: 2,
        }),
        await as.command("note.delete", { groupId, id: noteId, version: 3 }),
      ]

      expect(answers.map((answer) => answer?.kind)).toEqual([
        "server.result",
        "server.result",
        "server.result",
      ])
      as.shutdown()
    })

    describe("moving notes to another group", () => {
      const second = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111006"

      async function seedTwo(notes: MemoryNoteRepository) {
        await seedNote(notes)
        await notes.create({ groupId, id: second, title: "Other", body: "" }, OWNER, null)
        notes.writes = 0
      }

      /** Fills the target group with `count` notes of its own. */
      async function fillTarget(notes: MemoryNoteRepository, count: number) {
        for (let i = 0; i < count; i++) {
          await notes.create(
            { groupId: editableGroupId, id: crypto.randomUUID(), title: `T${i}`, body: "" },
            OWNER,
            null,
          )
        }
        notes.writes = 0
      }

      function groupsOf(notes: MemoryNoteRepository) {
        return [...notes.notes.values()].map((note) => [note.id, note.groupId])
      }

      it("moves the notes, keeping their ids and raising their versions", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId, second],
        })

        expect(answer).toMatchObject({
          kind: "server.result",
          payload: {
            notes: [{ id: noteId, groupId: editableGroupId, version: 3 }, { id: second }],
          },
        })
        expect(groupsOf(notes)).toEqual([[noteId, editableGroupId], [second, editableGroupId]])
        as.shutdown()
      })

      it("moves only the notes it was given", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId],
        })

        expect(answer).toMatchObject({
          kind: "server.result",
          payload: { notes: [{ id: noteId }] },
        })
        expect(groupsOf(notes)).toEqual([[noteId, editableGroupId], [second, groupId]])
        as.shutdown()
      })

      it("refuses a viewer of the source group and moves nothing", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, VIEWER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId],
        })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("refuses a move to a group where the person only reads or is no member", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, OWNER)

        const viewerTarget = await as.command("note.move", {
          groupId,
          toGroupId: readOnlyGroupId,
          noteIds: [noteId],
        })
        const strangerTarget = await as.command("note.move", {
          groupId,
          toGroupId: strangerGroupId,
          noteIds: [noteId],
        })

        expect(viewerTarget).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
        expect(strangerTarget).toMatchObject({ kind: "server.error", code: "not_found" })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("refuses a move into the same group, and an empty or repeating list", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, OWNER)

        const same = await as.command("note.move", {
          groupId,
          toGroupId: groupId,
          noteIds: [noteId],
        })
        const empty = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [],
        })
        const twice = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId, noteId],
        })

        expect(same).toMatchObject({
          kind: "server.error",
          code: "bad_request",
          details: { code: "SAME_GROUP" },
        })
        expect(empty).toMatchObject({ kind: "server.error", code: "bad_request" })
        expect(twice).toMatchObject({ kind: "server.error", code: "bad_request" })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("moves none when one of the notes is not in the source group", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId, crypto.randomUUID()],
        })

        expect(answer).toMatchObject({ kind: "server.error", code: "not_found" })
        expect(groupsOf(notes)).toEqual([[noteId, groupId], [second, groupId]])
        as.shutdown()
      })

      it("lets a move into a group on Pro past the free source group's cap", async () => {
        const { notes, buses } = stack(FREE_PLAN_ID, { [editableGroupId]: PRO_PLAN_ID })
        await fillFreePlan(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [(await notes.list(groupId, { limit: 1 })).notes[0].id],
        })

        expect(answer).toMatchObject({ kind: "server.result" })
        as.shutdown()
      })

      it("refuses a move into a full free group when the source group is on Pro", async () => {
        const { notes, buses } = stack(FREE_PLAN_ID, { [groupId]: PRO_PLAN_ID })
        await seedTwo(notes)
        await fillTarget(notes, 10)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId],
        })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "PLAN_LIMIT_REACHED" },
        })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("tells a viewer of the source group they cannot write there, even when the target is full", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        await fillTarget(notes, 10)
        const as = open(buses, VIEWER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId],
        })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("refuses a move that would take the target group over the free plan's cap", async () => {
        const { notes, buses } = stack()
        await seedTwo(notes)
        await fillTarget(notes, 9)
        const as = open(buses, OWNER)

        const answer = await as.command("note.move", {
          groupId,
          toGroupId: editableGroupId,
          noteIds: [noteId, second],
        })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "PLAN_LIMIT_REACHED" },
        })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })
    })

    describe("finding the group of a note by its id", () => {
      it("tells a member the group of a note in any of their groups", async () => {
        const { notes, buses } = stack()
        await seedNote(notes)
        const as = open(buses, VIEWER)

        const answer = await as.query("note.locate", { id: noteId })

        expect(answer).toMatchObject({ kind: "server.result", payload: { groupId } })
        as.shutdown()
      })

      it("answers a note in a group the person is not in exactly as a note that does not exist", async () => {
        const { notes, buses } = stack()
        await seedNote(notes)
        // OWNER is in `groupId` only through the roles above; this note is in a group nobody is in.
        const foreignId = crypto.randomUUID()
        await notes.create(
          { groupId: strangerGroupId, id: foreignId, title: "Secret", body: "" },
          OWNER,
          null,
        )
        const as = open(buses, OWNER)

        const foreign = await as.query("note.locate", { id: foreignId })
        const missing = await as.query("note.locate", { id: crypto.randomUUID() })

        expect(foreign).toMatchObject({
          kind: "server.error",
          code: "not_found",
          details: { code: "NOTE_NOT_FOUND" },
        })
        expect(JSON.stringify(foreign)).toBe(JSON.stringify(missing))
        expect(JSON.stringify(foreign)).not.toContain(strangerGroupId)
        as.shutdown()
      })

      it("answers a note that was deleted as not found", async () => {
        const { notes, buses } = stack()
        await seedNote(notes)
        await notes.delete({ groupId, id: noteId, expectedVersion: 2 }, OWNER)
        const as = open(buses, OWNER)

        const answer = await as.query("note.locate", { id: noteId })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "not_found",
          details: { code: "NOTE_NOT_FOUND" },
        })
        as.shutdown()
      })
    })

    describe("deleting and restoring a note", () => {
      for (
        const [name, userId] of [["an owner", OWNER], ["an admin", ADMIN], [
          "an editor",
          EDITOR,
        ]] as const
      ) {
        it(`lets ${name} restore a deleted note, at the next version`, async () => {
          const { notes, buses } = stack()
          await seedDeleted(notes)
          const as = open(buses, userId)

          const answer = await as.command("note.restore", { groupId, id: noteId })

          expect(answer).toMatchObject({
            kind: "server.result",
            payload: { note: { id: noteId, version: 4 } },
          })
          expect(notes.notes.get(noteId)?.version).toBe(4)
          expect(notes.deleted.size).toBe(0)
          as.shutdown()
        })
      }

      it("refuses a viewer's restore, and the note stays deleted", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        const as = open(buses, VIEWER)

        const answer = await as.command("note.restore", { groupId, id: noteId })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: { code: "ROLE_INSUFFICIENT" },
        })
        expect(notes.writes).toBe(0)
        expect(notes.deleted.has(noteId)).toBe(true)
        as.shutdown()
      })

      it("answers a stranger's restore as an unknown group, never as a missing note", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        const as = open(buses, STRANGER)

        const answer = await as.command("note.restore", { groupId, id: noteId })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "not_found",
          details: { code: "GROUP_NOT_FOUND" },
        })
        expect(notes.writes).toBe(0)
        as.shutdown()
      })

      it("refuses a stranger's list of deleted notes as an unknown group, with no title", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        const as = open(buses, STRANGER)

        const answer = await as.query("note.list", { groupId, deleted: true })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "not_found",
          details: { code: "GROUP_NOT_FOUND" },
        })
        expect(JSON.stringify(answer)).not.toContain(noteId)
        as.shutdown()
      })

      it("restores a note and lists it again", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        const as = open(buses, EDITOR)

        const restored = await as.command("note.restore", { groupId, id: noteId })
        const listed = await as.query("note.list", { groupId })

        expect(restored).toMatchObject({
          kind: "server.result",
          payload: { note: { id: noteId, version: 4 } },
        })
        expect(listed).toMatchObject({
          kind: "server.result",
          payload: { notes: [{ id: noteId }] },
        })
        as.shutdown()
      })

      it("lists deleted notes only when asked", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        const as = open(buses, VIEWER)

        const live = await as.query("note.list", { groupId })
        const gone = await as.query("note.list", { groupId, deleted: true })
        const invalid = await as.query("note.list", { groupId, deleted: "maybe" })

        expect(live).toMatchObject({ kind: "server.result", payload: { notes: [] } })
        expect(gone).toMatchObject({
          kind: "server.result",
          payload: { notes: [{ id: noteId }] },
        })
        expect(invalid).toMatchObject({ kind: "server.error", code: "bad_request" })
        as.shutdown()
      })

      it("answers a restore of a note that is not deleted as not found", async () => {
        const { notes, buses } = stack()
        await seedNote(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.restore", { groupId, id: noteId })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "not_found",
          details: { code: "NOTE_NOT_FOUND" },
        })
        as.shutdown()
      })

      it("refuses a restore into a group at the free plan's cap, and keeps the note deleted", async () => {
        const { notes, buses } = stack()
        await seedDeleted(notes)
        await fillFreePlan(notes)
        const as = open(buses, OWNER)

        const answer = await as.command("note.restore", { groupId, id: noteId })

        expect(answer).toMatchObject({
          kind: "server.error",
          code: "forbidden",
          details: {
            code: "PLAN_LIMIT_REACHED",
            entitlement: "maxNotes",
            limit: 10,
            canUpgrade: true,
          },
        })
        expect(notes.writes).toBe(0)
        expect(notes.deleted.has(noteId)).toBe(true)
        as.shutdown()
      })

      it("restores into a full group once a live note makes room, and on Pro past the cap", async () => {
        const full = stack()
        await seedDeleted(full.notes)
        await fillFreePlan(full.notes)
        const [live] = [...full.notes.notes.keys()]
        await full.notes.delete({ groupId, id: live, expectedVersion: 1 }, OWNER)
        const pro = stack(PRO_PLAN_ID)
        await seedDeleted(pro.notes)
        await fillFreePlan(pro.notes)
        const withRoom = open(full.buses, OWNER)
        const onPro = open(pro.buses, OWNER)

        const answers = [
          await withRoom.command("note.restore", { groupId, id: noteId }),
          await onPro.command("note.restore", { groupId, id: noteId }),
        ]

        expect(answers.map((answer) => answer?.kind)).toEqual(["server.result", "server.result"])
        withRoom.shutdown()
        onPro.shutdown()
      })
    })
  })
}

describe("notes over the REST reads", () => {
  it("lets a viewer read a note", async () => {
    const { notes, buses } = stack()
    await seedNote(notes)

    const response = await rest(buses, VIEWER)(`/${noteId}`)

    expect(response.status).toBe(200)
    expect((await response.json()).note.title).toBe("Plan v2")
  })

  it("lists deleted notes only when asked, and refuses a flag it cannot read", async () => {
    const { notes, buses } = stack()
    await seedDeleted(notes)
    const read = rest(buses, VIEWER)

    const live = await (await read("")).json()
    const gone = await (await read("?deleted=true")).json()
    const invalid = await read("?deleted=maybe")

    expect(live.notes).toEqual([])
    expect(gone.notes.map((note: { id: string }) => note.id)).toEqual([noteId])
    expect(invalid.status).toBe(400)
  })

  it("refuses a stranger's list of deleted notes as an unknown group, with no title", async () => {
    const { notes, buses } = stack()
    await seedDeleted(notes)

    const response = await rest(buses, STRANGER)("?deleted=true")
    const text = await response.text()

    expect(response.status).toBe(404)
    expect(JSON.parse(text).error.code).toBe("GROUP_NOT_FOUND")
    expect(text).not.toContain(noteId)
  })
})
