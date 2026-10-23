import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { CommandBus, QueryBus } from "@spy4x/platform/cqrs"
import { createKvStore } from "@spy4x/platform/rate-limit"
import { ApiTokenAccess } from "@domain/api-tokens"
import { GroupRole } from "@domain/groups"
import { UserMFAStatus } from "@domain/identity"
import { NoteCreateCommand, NoteGetQuery, NoteListQuery } from "@domain/notes"
import type { LiveApiToken } from "@server/api-tokens/api-tokens.ts"
import { FREE_PLAN_ID } from "@domain/billing"
import { createSessionGate } from "../cqrs/session-gate.ts"
import { createEntitlementGate } from "../cqrs/entitlement-gate.ts"
import { ENTITLEMENT_NEEDS } from "../cqrs/entitlement-needs.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { MemoryNoteRepository, roles } from "../_testing/memory-notes.ts"
import type { APIContext } from "../_types.ts"
import {
  createNoteCreateHandler,
  createNoteGetHandler,
  createNoteListHandler,
} from "../features/notes/handlers.ts"
import { createTokenRateLimits } from "../middlewares/token-rate-limits.ts"
import { createTokenApiRoute } from "./token-api.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"
import { apiError } from "../_testing/api-error.ts"

/**
 * The token API over real buses, the real session gate and the real note handlers, with notes in
 * memory: what a token may reach is decided where the SPA's requests are decided too. Only the
 * token lookup is a stand-in; `tests/integration/api-tokens.integration.test.ts` covers it.
 */

const API = "http://app.example.com/api/v1"
const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111002"
/** A group the owner belongs to as well, but no token here is for. */
const otherGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111003"
/** A group where the owner is only a viewer. */
const viewerGroupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111004"
const noteId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const OWNER = 1

const READER = "tpl_reader000000000000000"
const WRITER = "tpl_writer000000000000000"
const WRITER_TWO = "tpl_writer200000000000000"
const VIEWER_WRITER = "tpl_viewer000000000000000"

function live(id: string, group: string, access: ApiTokenAccess): LiveApiToken {
  return { id, userId: OWNER, userMfa: UserMFAStatus.NOT_CONFIGURED, groupId: group, access }
}

const TOKENS = new Map<string, LiveApiToken>([
  [READER, live("token-reader", groupId, ApiTokenAccess.READ)],
  [WRITER, live("token-writer", groupId, ApiTokenAccess.WRITE)],
  [WRITER_TWO, live("token-writer-two", groupId, ApiTokenAccess.WRITE)],
  [VIEWER_WRITER, live("token-viewer", viewerGroupId, ApiTokenAccess.WRITE)],
])

function memoryKv() {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

function buildApp(limit = 100) {
  const groups = roles({
    [`${groupId}:${OWNER}`]: GroupRole.OWNER,
    [`${otherGroupId}:${OWNER}`]: GroupRole.OWNER,
    [`${viewerGroupId}:${OWNER}`]: GroupRole.VIEWER,
  })
  const notes = new MemoryNoteRepository(groups)
  const dependencies = { notes, groups }
  const commands = new CommandBus()
  commands.use(createSessionGate([]))
  commands.use(createEntitlementGate({
    billingEnabled: true,
    planOf: () => Promise.resolve(FREE_PLAN_ID),
    roleOf: (group, user) => groups.roleOf(group, user),
    usage: {
      maxNotes: (group) =>
        Promise.resolve([...notes.notes.values()].filter((note) => note.groupId === group).length),
      maxMembers: () => Promise.reject(new Error("not part of this test")),
    },
  }, ENTITLEMENT_NEEDS))
  commands.register(NoteCreateCommand, createNoteCreateHandler(dependencies))
  const queries = new QueryBus()
  queries.use(createSessionGate([]))
  queries.register(NoteListQuery, createNoteListHandler(dependencies))
  queries.register(NoteGetQuery, createNoteGetHandler(dependencies))
  const looked: (string | undefined)[] = []
  const refusals: string[] = []
  const stores = new Map<string, ReturnType<typeof memoryKv>>()
  const limits = createTokenRateLimits({
    windowMs: 60_000,
    limit,
    store: (name) => stores.get(name) ?? stores.set(name, memoryKv()).get(name)!,
    onStoreError: (error) => {
      throw error
    },
  })
  const route = createTokenApiRoute({
    authenticate: (_c, presented) => {
      looked.push(presented)
      return Promise.resolve(TOKENS.get(presented ?? "") ?? null)
    },
    create: (command) => commands.execute(command),
    get: (query) => queries.execute(query),
    list: (query) => queries.execute(query),
    cursor: {
      encode: () => Promise.resolve("next"),
      decode: () => Promise.resolve({ updatedAt: new Date(0), id: noteId }),
    },
    limitByIp: limits.failuresByIp,
    limitByToken: limits.byToken,
    auditRefusal: (_c, tokenId, reason) => (
      refusals.push(`${tokenId} ${reason}`), Promise.resolve()
    ),
  })
  // `parseAuth` sets a signed-in session here, as it would for a browser with a cookie: the token
  // API must not use it.
  const app = new Hono<APIContext>().basePath("/api")
  app.use("*", async (c, next) => {
    c.set("requestId", "req-test-1")
    c.set("auth", buildAuthData())
    await next()
  })
  app.route("/v1", route)
  return { app, notes, looked, refusals, limits }
}

function headers(token?: string, ip = "198.51.100.7"): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-real-ip": ip,
    cookie: "sessionIdToken=1:token",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function createNote(app: Hono<APIContext>, token: string | undefined, group = groupId) {
  return app.request(`${API}/groups/${group}/notes`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ id: uuidV7(), title: "From a script", body: "" }),
  })
}

async function errorCode(response: Response): Promise<string> {
  return (await apiError(response)).reason ?? ``
}

describe("token API", () => {
  it("lists and reads the notes of its group with a read-only token", async () => {
    const { app, notes } = buildApp()
    await notes.create({ groupId, id: noteId, title: "Plan", body: "" }, OWNER, null)

    const list = await app.request(`${API}/groups/${groupId}/notes`, { headers: headers(READER) })
    expect(list.status).toBe(200)
    expect(((await list.json()) as { notes: { id: string }[] }).notes.map((n) => n.id))
      .toEqual([noteId])

    const one = await app.request(`${API}/groups/${groupId}/notes/${noteId}`, {
      headers: headers(READER),
    })
    expect(one.status).toBe(200)
  })

  it("refuses a list limit that is not a whole number from 1 to 100", async () => {
    const { app } = buildApp()
    for (const limit of ["0", "101", "-1", "1.5", "abc", "", "10x"]) {
      const response = await app.request(`${API}/groups/${groupId}/notes?limit=${limit}`, {
        headers: headers(READER),
      })
      expect([limit, response.status]).toEqual([limit, 400])
      expect(await errorCode(response)).toBe("INVALID_REQUEST")
    }
    for (const limit of ["1", "100"]) {
      const response = await app.request(`${API}/groups/${groupId}/notes?limit=${limit}`, {
        headers: headers(READER),
      })
      expect([limit, response.status]).toEqual([limit, 200])
    }
  })

  it("creates a note in its group with a read-write token, as its owner", async () => {
    const { app, notes } = buildApp()
    const response = await createNote(app, WRITER)

    expect(response.status).toBe(201)
    const [note] = [...notes.notes.values()]
    expect(note.groupId).toBe(groupId)
    expect(note.title).toBe("From a script")
  })

  it("accepts tag ids on a created note and ignores the ones the group does not have", async () => {
    const { app, notes } = buildApp()
    const response = await app.request(`${API}/groups/${groupId}/notes`, {
      method: "POST",
      headers: headers(WRITER),
      body: JSON.stringify({
        id: uuidV7(),
        title: "Tagged",
        body: "",
        tagIds: [uuidV7()],
      }),
    })

    expect(response.status).toBe(201)
    expect(((await response.json()) as { note: { tagIds: string[] } }).note.tagIds).toEqual([])
    expect([...notes.notes.values()].map((note) => note.title)).toEqual(["Tagged"])
  })

  it("refuses a write with a read-only token and writes nothing", async () => {
    const { app, notes } = buildApp()
    const response = await createNote(app, READER)

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe("TOKEN_SCOPE")
    expect(notes.notes.size).toBe(0)
  })

  it("refuses another group, even one its owner belongs to", async () => {
    const { app, notes } = buildApp()
    const list = await app.request(`${API}/groups/${otherGroupId}/notes`, {
      headers: headers(WRITER),
    })
    expect(list.status).toBe(403)
    expect(await errorCode(list)).toBe("TOKEN_SCOPE")

    const create = await createNote(app, WRITER, otherGroupId)
    expect(create.status).toBe(403)
    expect(notes.notes.size).toBe(0)
  })

  it("reports a scope refusal for the audit trail, and no served request or other refusal", async () => {
    const { app, refusals } = buildApp()
    await app.request(`${API}/groups/${groupId}/notes`, { headers: headers(READER) })
    // Refused for the owner's role, not for the token's scope.
    expect((await createNote(app, VIEWER_WRITER, viewerGroupId)).status).toBe(403)
    // Refused for what it asked, not for what the token may do.
    const badLimit = await app.request(`${API}/groups/${groupId}/notes?limit=0`, {
      headers: headers(READER),
    })
    expect(badLimit.status).toBe(400)
    expect(refusals).toEqual([])

    await createNote(app, READER)
    await app.request(`${API}/groups/${otherGroupId}/notes`, { headers: headers(WRITER) })
    expect(refusals).toEqual([
      `${TOKENS.get(READER)!.id} scope`,
      `${TOKENS.get(WRITER)!.id} scope`,
    ])
  })

  it("allows one audit row per token and reason in five minutes", async () => {
    let now = 1_000_000
    const store = memoryKv()
    const limits = createTokenRateLimits({
      windowMs: 60_000,
      limit: 100,
      clock: () => now,
      store: () => store,
      onStoreError: (error) => {
        throw error
      },
    })
    expect(await limits.refusalAudit("token-a:scope")).toBe(true)
    expect(await limits.refusalAudit("token-a:scope")).toBe(false)
    expect(await limits.refusalAudit("token-a:revoked")).toBe(true)
    expect(await limits.refusalAudit("token-b:scope")).toBe(true)

    now += 5 * 60_000 - 1
    expect(await limits.refusalAudit("token-a:scope")).toBe(false)
    now += 2
    expect(await limits.refusalAudit("token-a:scope")).toBe(true)
  })

  it("does no more than its owner may: a read-write token of a viewer cannot write", async () => {
    const { app, notes } = buildApp()
    const response = await createNote(app, VIEWER_WRITER, viewerGroupId)

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe("ROLE_INSUFFICIENT")
    expect(notes.notes.size).toBe(0)
  })

  it("refuses a request without a live token with 401, whatever session cookie it carries", async () => {
    const { app } = buildApp()
    for (const token of [undefined, "tpl_unknown00000000000000"]) {
      const response = await app.request(`${API}/groups/${groupId}/notes`, {
        headers: headers(token),
      })
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe(`Bearer realm="api"`)
      expect(await errorCode(response)).toBe("TOKEN_INVALID")
    }
  })

  it("gives each token a budget of its own", async () => {
    const { app } = buildApp(2)
    const list = (token: string) =>
      app.request(`${API}/groups/${groupId}/notes`, { headers: headers(token) })

    expect((await list(WRITER)).status).toBe(200)
    expect((await list(WRITER)).status).toBe(200)
    expect((await list(WRITER)).status).toBe(429)
    expect((await list(WRITER_TWO)).status).toBe(200)
  })

  it("stops an address that keeps presenting bad tokens before it reaches the lookup", async () => {
    const { app, looked } = buildApp(2)
    const guess = () =>
      app.request(`${API}/groups/${groupId}/notes`, {
        headers: headers("tpl_guess0000000000000000"),
      })

    expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(401)
    expect((await guess()).status).toBe(429)
    expect(looked.length).toBe(2)
  })
})
