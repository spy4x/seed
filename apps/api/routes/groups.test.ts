import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import {
  GroupCreateCommand,
  GroupError,
  GroupGetQuery,
  GroupListQuery,
  GroupRepository,
  GroupRole,
  GroupSelectCommand,
  GroupSelectedQuery,
} from "@domain/groups"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { AccessError, UserMFAStatus } from "@domain/identity"
import { CommandBus } from "@spy4x/platform/cqrs"
import { createSessionGate } from "../cqrs/session-gate.ts"
import type { APIContext } from "../_types.ts"
import { oversizedJson } from "../_testing/json-bodies.ts"
import { IdempotencyError } from "@spy4x/server/idempotency"
import { createGroupGetHandler } from "../features/groups/handlers.ts"
import { createGroupsRoute, GroupsRouteDependencies } from "./groups.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { apiError } from "../_testing/api-error.ts"

const id = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const now = new Date("2026-08-18T10:00:00.000Z")

function buildApp(
  dependencies: GroupsRouteDependencies,
  auth: APIContext["Variables"]["auth"] = buildAuthData({ user: { id: 7 } }),
) {
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-groups-1")
    c.set("auth", auth)
    await next()
  })
  app.route("/groups", createGroupsRoute(dependencies))
  return app
}

function dependencies(): GroupsRouteDependencies & {
  createCommand: GroupCreateCommand | null
  listQuery: GroupListQuery | null
  getQuery: GroupGetQuery | null
  selectCommand: GroupSelectCommand | null
  selectedQuery: GroupSelectedQuery | null
} {
  return {
    createCommand: null,
    listQuery: null,
    getQuery: null,
    selectCommand: null,
    selectedQuery: null,
    select(command) {
      this.selectCommand = command
      return Promise.resolve({ groupId: command.data.groupId, version: 5 })
    },
    selected(query) {
      this.selectedQuery = query
      return Promise.resolve({ groupId: id, version: 5 })
    },
    create(command) {
      this.createCommand = command
      return Promise.resolve({
        created: true,
        group: {
          id: command.data.id,
          name: command.data.name,
          description: "",
          color: null,
          emoji: null,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: now,
        },
      })
    },
    get(query) {
      this.getQuery = query
      return Promise.resolve({
        group: {
          id: query.data.groupId,
          name: "Team",
          description: "",
          color: null,
          emoji: null,
          role: GroupRole.OWNER,
          authorizationRevision: "1",
          changeSequence: "1",
          updatedAt: now,
        },
      })
    },
    rename: () => Promise.reject(new Error("not used")),
    updateDetails: () => Promise.reject(new Error("not used")),
    delete: () => Promise.reject(new Error("not used")),
    restore: () => Promise.reject(new Error("not used")),
    deleted: () => Promise.reject(new Error("not used")),
    members: () => Promise.reject(new Error("not used")),
    setRole: () => Promise.reject(new Error("not used")),
    removeMember: () => Promise.reject(new Error("not used")),
    leave: () => Promise.reject(new Error("not used")),
    transfer: () => Promise.reject(new Error("not used")),
    moveAll: () => Promise.reject(new Error("not used")),
    passwordLimit: (_c, next) => next(),
    list(query) {
      this.listQuery = query
      return Promise.resolve({ groups: [], nextPageKey: null })
    },
    cursor: {
      encode: () => Promise.resolve("next-token"),
      decode: () => Promise.resolve({ updatedAt: now, id }),
    },
  }
}

const mutationHeaders = {
  "content-type": "application/json",
  cookie: "sessionIdToken=1:token",
  origin: "http://local",
  "sec-fetch-site": "same-origin",
}

describe("groups route", () => {
  it("derives create actor only from authenticated session", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, name: " Team " }),
    })

    expect(response.status).toBe(201)
    expect(deps.createCommand?.data).toEqual({
      actor: {
        userId: 7,
        userMfa: UserMFAStatus.NOT_CONFIGURED,
        sessionSecondFactor: SecondFactorStatus.NotRequired,
        sessionId: 1,
      },
      id,
      name: "Team",
      description: "",
      color: null,
      emoji: null,
      requestId: "req-groups-1",
    })
  })

  it("creates a group with its description, colour and emoji in one request", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        id,
        name: "Trips",
        description: "Our trips",
        color: "#b91c1c",
        emoji: "🏕️",
      }),
    })

    expect(response.status).toBe(201)
    expect(deps.createCommand?.data).toMatchObject({
      description: "Our trips",
      color: "#b91c1c",
      emoji: "🏕️",
    })
  })

  it("answers 400 to a NUL in a new group's name and in a rename, and asks no bus", async () => {
    const deps = dependencies()
    const app = buildApp(deps)

    const created = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, name: "Te\u0000am" }),
    })
    const renamed = await app.request(`http://local/groups/${id}`, {
      method: "PATCH",
      headers: mutationHeaders,
      body: JSON.stringify({ name: "Te\u0000am" }),
    })

    for (const response of [created, renamed]) {
      expect(response.status).toBe(400)
      expect((await apiError(response)).reason).toBe("INVALID_REQUEST")
    }
    expect(deps.createCommand).toBe(null)
  })

  it("rejects client identity and returns request id", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, name: "Team", userId: 999 }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: "bad_request",
        message: "Request is invalid",
        reason: "INVALID_REQUEST",
        requestId: "req-groups-1",
      },
    })
    expect(deps.createCommand).toBe(null)
  })

  it("scopes list to authenticated session", async () => {
    const deps = dependencies()
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(200)
    expect(deps.listQuery?.data.actor.userId).toBe(19)
    expect(deps.listQuery?.data.page).toEqual({ limit: 50, after: undefined })
  })

  it("decodes bounded pagination and returns next cursor", async () => {
    const deps = dependencies()
    deps.list = (query) => {
      deps.listQuery = query
      return Promise.resolve({
        groups: [],
        nextPageKey: { updatedAt: now, id },
      })
    }
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups?limit=100&cursor=opaque")

    expect(response.status).toBe(200)
    expect(deps.listQuery?.data.page).toEqual({
      limit: 100,
      after: { updatedAt: now, id },
    })
    expect(await response.json()).toEqual({ groups: [], nextCursor: "next-token" })
  })

  it("reads the selected group of the authenticated session, not a group called selected", async () => {
    const deps = dependencies()
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups/selected")

    expect(response.status).toBe(200)
    expect(deps.selectedQuery?.data.actor.userId).toBe(19)
    expect(deps.getQuery).toBe(null)
    expect(await response.json()).toEqual({ groupId: id, version: 5 })
  })

  it("selects a group for the authenticated session with PUT", async () => {
    const deps = dependencies()
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request("http://local/groups/selected", {
      method: "PUT",
      headers: { ...mutationHeaders, "idempotency-key": "key-9" },
      body: JSON.stringify({ groupId: id }),
    })

    expect(response.status).toBe(200)
    expect(deps.selectCommand?.data).toEqual({
      actor: expect.objectContaining({ userId: 19 }),
      groupId: id,
      requestId: "req-groups-1",
      idempotencyKey: "key-9",
    })
    expect(await response.json()).toEqual({ groupId: id, version: 5 })
  })

  it("refuses to select from another origin or with a body that is not exactly a group id", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const crossSite = await app.request("http://local/groups/selected", {
      method: "PUT",
      headers: {
        ...mutationHeaders,
        origin: "http://evil.example",
        "sec-fetch-site": "cross-site",
      },
      body: JSON.stringify({ groupId: id }),
    })
    const wrongBody = await app.request("http://local/groups/selected", {
      method: "PUT",
      headers: mutationHeaders,
      body: JSON.stringify({ groupId: id, extra: 1 }),
    })

    expect(crossSite.status).toBe(403)
    expect(wrongBody.status).toBe(400)
    expect(deps.selectCommand).toBe(null)
  })

  it("reads one group for the authenticated session", async () => {
    const deps = dependencies()
    const app = buildApp(deps, buildAuthData({ user: { id: 19 } }))
    const response = await app.request(`http://local/groups/${id}`)

    expect(response.status).toBe(200)
    expect(deps.getQuery?.data).toEqual({
      actor: expect.objectContaining({ userId: 19 }),
      groupId: id,
    })
    expect((await response.json()).group.id).toBe(id)
  })

  it("answers a stranger's group id and an unknown id with the same 404", async () => {
    const ownGroup = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111aaa"
    const deps = dependencies()
    // The real handler over a repository that knows one group, whose only member is user 19.
    deps.get = createGroupGetHandler({
      getSummaryForMember: (groupId: string, userId: number) =>
        Promise.resolve(
          groupId === ownGroup && userId === 19
            ? {
              id: ownGroup,
              name: "Team",
              description: "",
              color: null,
              emoji: null,
              role: GroupRole.OWNER,
              authorizationRevision: "1",
              changeSequence: "1",
              updatedAt: now,
            }
            : null,
        ),
    } as GroupRepository)
    const stranger = await buildApp(deps, buildAuthData({ user: { id: 20 } }))
      .request(`http://local/groups/${ownGroup}`)
    const unknown = await buildApp(deps, buildAuthData({ user: { id: 20 } }))
      .request("http://local/groups/7b6d8d6c-1af5-4f04-8ae4-b1ee5d111bbb")

    expect(stranger.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(await stranger.json()).toEqual(await unknown.json())
  })

  it("refuses a group id that is not a UUID without asking the bus", async () => {
    const deps = dependencies()
    const response = await buildApp(deps).request("http://local/groups/not-a-uuid")

    expect(response.status).toBe(400)
    expect(deps.getQuery).toBe(null)
  })

  it("rejects an over-limit group page", async () => {
    const deps = dependencies()
    const app = buildApp(deps)
    const response = await app.request("http://local/groups?limit=101")

    expect(response.status).toBe(400)
    expect(deps.listQuery).toBe(null)
  })

  it("passes the session's second-factor state on rather than deciding here", async () => {
    const deps = dependencies()
    const app = buildApp(
      deps,
      buildAuthData({
        user: { mfa: UserMFAStatus.CONFIGURED },
        session: { secondFactor: SecondFactorStatus.NotRequired },
      }),
    )
    const response = await app.request("http://local/groups")

    // The route no longer rejects: session strength is checked by the session gate on the buses,
    // so a WebSocket transport is covered by the same check.
    expect(response.status).toBe(200)
    expect(deps.listQuery?.data.actor).toEqual({
      userId: 1,
      userMfa: UserMFAStatus.CONFIGURED,
      sessionSecondFactor: SecondFactorStatus.NotRequired,
      sessionId: 1,
    })
  })

  it("maps an access error from the dispatch to a 401 envelope", async () => {
    const deps = dependencies()
    deps.list = () => Promise.reject(new AccessError("MFA_REQUIRED", "Second factor missing"))
    const app = buildApp(deps)
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Complete MFA to access groups",
        reason: "MFA_REQUIRED",
        requestId: "req-groups-1",
      },
    })
  })

  describe("a session that still owes a second factor", () => {
    /** Dispatches through a real bus carrying the session gate, as the app does. */
    function gatedDependencies() {
      const deps = dependencies()
      const bus = new CommandBus()
      bus.use(createSessionGate([]))
      bus.register(GroupCreateCommand, (command) => {
        deps.createCommand = command
        return Promise.reject(new Error("the gate should have stopped this command"))
      })
      deps.create = (command) => bus.execute(command)
      return deps
    }
    const pendingAuth = () =>
      buildAuthData({
        user: { mfa: UserMFAStatus.CONFIGURED },
        session: { secondFactor: SecondFactorStatus.Pending },
      })

    it("gets 400 for a malformed body, because the route validates before it dispatches", async () => {
      const deps = gatedDependencies()
      const app = buildApp(deps, pendingAuth())
      const response = await app.request("http://local/groups", {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ id: "not-a-uuid", name: "Team" }),
      })

      expect(response.status).toBe(400)
      expect((await apiError(response)).reason).toBe("INVALID_REQUEST")
      expect(deps.createCommand).toBe(null)
    })

    it("gets 401 MFA_REQUIRED for a valid body, from the gate on dispatch", async () => {
      const deps = gatedDependencies()
      const app = buildApp(deps, pendingAuth())
      const response = await app.request("http://local/groups", {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({ id, name: "Team" }),
      })

      expect(response.status).toBe(401)
      expect((await apiError(response)).reason).toBe("MFA_REQUIRED")
      expect(deps.createCommand).toBe(null)
    })
  })

  it("maps typed conflicts to stable safe envelopes", async () => {
    const deps = dependencies()
    deps.create = () => {
      throw new GroupError("ID_ALREADY_EXISTS", "database-specific detail")
    }
    const app = buildApp(deps)
    const response = await app.request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({ id, name: "Team" }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: "conflict",
        message: "Group id is already in use",
        reason: "ID_ALREADY_EXISTS",
        requestId: "req-groups-1",
      },
    })
  })

  it("hides unexpected error details", async () => {
    const deps = dependencies()
    deps.list = () => {
      throw new Error("raw database text")
    }
    const app = buildApp(deps)
    const response = await app.request("http://local/groups")

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      error: {
        code: "internal",
        message: "Internal server error",
        reason: "INTERNAL_ERROR",
        requestId: "req-groups-1",
      },
    })
  })
})

describe("groups route same-origin guard", () => {
  const originRefused = {
    error: {
      code: "forbidden",
      message: "Request origin is invalid",
      reason: "REQUEST_ORIGIN_INVALID",
      requestId: "req-groups-1",
    },
  }

  async function post(
    headers: Record<string, string>,
    auth: APIContext["Variables"]["auth"] = buildAuthData({ user: { id: 7 } }),
  ) {
    const deps = dependencies()
    const response = await buildApp(deps, auth).request("http://local/groups", {
      method: "POST",
      headers,
      body: JSON.stringify({ id, name: "Team" }),
    })
    return { deps, response }
  }

  it("accepts a same-origin POST with the session cookie", async () => {
    const { deps, response } = await post(mutationHeaders)

    expect(response.status).toBe(201)
    expect(deps.createCommand).not.toBe(null)
  })

  it("refuses a cross-site POST with the group error envelope", async () => {
    const { deps, response } = await post({
      ...mutationHeaders,
      origin: "https://evil.example.net",
      "sec-fetch-site": "cross-site",
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual(originRefused)
    expect(deps.createCommand).toBe(null)
  })

  it("refuses a same-site sibling origin", async () => {
    const { deps, response } = await post({
      ...mutationHeaders,
      origin: "http://admin.local",
      "sec-fetch-site": "same-site",
    })

    expect(response.status).toBe(403)
    expect(deps.createCommand).toBe(null)
  })

  it("refuses a POST without browser fetch metadata", async () => {
    const { deps, response } = await post({
      "content-type": mutationHeaders["content-type"],
      cookie: mutationHeaders.cookie,
    })

    expect(response.status).toBe(403)
    expect(deps.createCommand).toBe(null)
  })

  it("refuses a same-origin POST without the session cookie", async () => {
    const { cookie: _cookie, ...headers } = mutationHeaders
    const { deps, response } = await post(headers)

    expect(response.status).toBe(403)
    expect(deps.createCommand).toBe(null)
  })

  it("refuses a same-origin POST whose session cookie is empty", async () => {
    const { deps, response } = await post({ ...mutationHeaders, cookie: "sessionIdToken=" })

    expect(response.status).toBe(403)
    expect(deps.createCommand).toBe(null)
  })

  it("accepts Origin null when Sec-Fetch-Site is same-origin", async () => {
    const { deps, response } = await post({ ...mutationHeaders, origin: "null" })

    expect(response.status).toBe(201)
    expect(deps.createCommand).not.toBe(null)
  })

  it("answers a cross-site POST without a session with 401, not 403", async () => {
    const { deps, response } = await post({
      ...mutationHeaders,
      origin: "https://evil.example.net",
      "sec-fetch-site": "cross-site",
    }, null)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: {
        code: "unauthorized",
        message: "Authentication required",
        reason: "AUTH_REQUIRED",
        requestId: "req-groups-1",
      },
    })
    expect(deps.createCommand).toBe(null)
  })

  describe("behind a TLS-terminating proxy", () => {
    async function proxiedPost(origin: string) {
      const deps = { ...dependencies(), expectedOrigin: "https://app.example.com" }
      const response = await buildApp(deps).request("http://app.example.com/groups", {
        method: "POST",
        headers: { ...mutationHeaders, origin },
        body: JSON.stringify({ id, name: "Team" }),
      })
      return { deps, response }
    }

    it("accepts the configured https origin on an http request URL", async () => {
      const { deps, response } = await proxiedPost("https://app.example.com")

      expect(response.status).toBe(201)
      expect(deps.createCommand).not.toBe(null)
    })

    it("refuses any other origin, including the request URL's own", async () => {
      for (const origin of ["http://app.example.com", "https://evil.example.net"]) {
        const { deps, response } = await proxiedPost(origin)

        expect(response.status).toBe(403)
        expect(deps.createCommand).toBe(null)
      }
    })
  })
})

describe("groups route caps the JSON body", () => {
  it("answers an oversized body with the INVALID_REQUEST envelope", async () => {
    const deps = dependencies()
    const response = await buildApp(deps).request("http://local/groups", {
      method: "POST",
      headers: mutationHeaders,
      body: oversizedJson({ id, name: "Team" }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: "bad_request",
        message: "Request is invalid",
        reason: "INVALID_REQUEST",
        requestId: "req-groups-1",
      },
    })
    expect(deps.createCommand).toBe(null)
  })
})

describe("groups route idempotency", () => {
  const post = (app: ReturnType<typeof buildApp>, extra: Record<string, string> = {}) =>
    app.request("http://local/groups", {
      method: "POST",
      headers: { ...mutationHeaders, ...extra },
      body: JSON.stringify({ id, name: "Team" }),
    })

  it("passes the Idempotency-Key header to the create command", async () => {
    const deps = dependencies()
    const response = await post(buildApp(deps), { "idempotency-key": "key-1" })

    expect(response.status).toBe(201)
    expect(deps.createCommand?.data.idempotencyKey).toBe("key-1")
  })

  for (
    const [code, status, error] of [
      ["IDEMPOTENCY_KEY_INVALID", 400, new IdempotencyError("INVALID_KEY", "bad key")],
      ["IDEMPOTENCY_KEY_REUSED", 422, new IdempotencyError("KEY_REUSED", "other body")],
      ["IDEMPOTENCY_IN_PROGRESS", 409, new IdempotencyError("IN_PROGRESS", "still running")],
      ["INTERNAL_ERROR", 500, new IdempotencyError("INVALID_COMMAND", "name too long")],
    ] as const
  ) {
    it(`answers ${status} ${code} when the key is refused`, async () => {
      const deps = dependencies()
      deps.create = () => Promise.reject(error)
      const response = await post(buildApp(deps), { "idempotency-key": "key-1" })

      expect(response.status).toBe(status)
      expect((await apiError(response)).reason).toBe(code)
    })
  }
})
