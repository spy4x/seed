import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import { createKvStore, type RateLimitStore } from "@spy4x/platform/rate-limit"
import { GroupError, GroupRole, InvitationError } from "@domain/groups"
import { buildAuthData } from "../_testing/fake-auth.ts"
import type { APIContext } from "../_types.ts"
import {
  createInvitationRateLimits,
  INVITATIONS_PER_USER,
} from "../features/groups/invitation-rate-limits.ts"
import {
  createGroupInvitationsRoute,
  createInvitationsRoute,
  type InvitationsRouteDependencies,
} from "./invitations.ts"
import { apiError } from "../_testing/api-error.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const token = "A".repeat(43)

function memoryStore(): RateLimitStore {
  const entries = new Map<string, unknown>()
  return createKvStore({
    backend: {
      get: (key) => Promise.resolve(entries.get(key)),
      set: (key, value) => Promise.resolve(void entries.set(key, value)),
      delete: (key) => Promise.resolve(void entries.delete(key)),
    },
  })
}

function buildApp(
  overrides: Partial<InvitationsRouteDependencies> = {},
  strictLimit = 1_000,
) {
  const dependencies: InvitationsRouteDependencies = {
    create: () => Promise.reject(new Error("unused")),
    list: () => Promise.resolve({ invitations: [] }),
    revoke: () => Promise.resolve({ revoked: true }),
    preview: () => Promise.reject(new Error("unused")),
    mine: () => Promise.resolve({ invitations: [] }),
    accept: () => Promise.reject(new Error("unused")),
    decline: () => Promise.resolve({ declined: true }),
    rateLimits: createInvitationRateLimits({ windowMs: 60_000, strictLimit, store: memoryStore }),
    ...overrides,
  }
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-invite")
    c.set("auth", buildAuthData({ user: { id: 42 }, session: { userId: 42 } }))
    await next()
  })
  app.route("/groups/:groupId/invitations", createGroupInvitationsRoute(dependencies))
  app.route("/invitations", createInvitationsRoute(dependencies))
  return (path: string, body: unknown, init: { method?: string; crossSite?: boolean } = {}) =>
    app.request(`http://local${path}`, {
      method: init.method ?? "POST",
      headers: {
        "content-type": "application/json",
        cookie: "sessionIdToken=1:token",
        origin: init.crossSite ? "https://attacker.example" : "http://local",
        "sec-fetch-site": init.crossSite ? "cross-site" : "same-origin",
      },
      body: JSON.stringify(body),
    })
}

describe("invitation routes", () => {
  it("refuses a cross-site accept, create and revoke with 403 before they run", async () => {
    const ran: string[] = []
    const post = buildApp({
      accept: () => Promise.resolve(void ran.push("accept") as never),
      create: () => Promise.resolve(void ran.push("create") as never),
      revoke: () => Promise.resolve(void ran.push("revoke") as never),
    })

    const accept = await post("/invitations/accept", { token }, { crossSite: true })
    const create = await post(`/groups/${groupId}/invitations`, { role: GroupRole.VIEWER }, {
      crossSite: true,
    })
    const revoke = await post(`/groups/${groupId}/invitations/${groupId}`, null, {
      method: "DELETE",
      crossSite: true,
    })

    expect([accept.status, create.status, revoke.status]).toEqual([403, 403, 403])
    expect((await apiError(accept)).reason).toBe("REQUEST_ORIGIN_INVALID")
    expect(ran).toEqual([])
  })

  it("answers an expired invitation with 410 and says it expired", async () => {
    const post = buildApp({
      accept: () =>
        Promise.reject(new InvitationError("INVITATION_EXPIRED", "This invitation has expired")),
    })

    const response = await post("/invitations/accept", { token })

    expect(response.status).toBe(410)
    expect(await apiError(response)).toMatchObject({
      reason: "INVITATION_EXPIRED",
      message: "This invitation has expired",
    })
  })

  it("tells an admin which roles they may invite with", async () => {
    const message = "An admin can invite viewers and editors only; the owner can invite admins"
    const post = buildApp({
      create: () => Promise.reject(new GroupError("ROLE_INSUFFICIENT", message)),
    })

    const response = await post(`/groups/${groupId}/invitations`, { role: GroupRole.ADMIN })

    expect(response.status).toBe(403)
    expect(await apiError(response)).toMatchObject({ reason: "ROLE_INSUFFICIENT", message })
  })

  it("refuses accept attempts past the per-IP budget with 429", async () => {
    let accepted = 0
    const post = buildApp({
      accept: () => {
        accepted++
        return Promise.resolve({ groupId, role: GroupRole.VIEWER, selected: {} as never })
      },
    }, 2)

    const statuses = []
    for (let i = 0; i < 3; i++) statuses.push((await post("/invitations/accept", { token })).status)

    expect(statuses).toEqual([200, 200, 429])
    expect(accepted).toBe(2)
  })

  it("refuses a person's invitations past the hourly budget with 429", async () => {
    let created = 0
    const post = buildApp({
      create: () => {
        created++
        return Promise.resolve({ invitation: {} as never, token, mailSent: false })
      },
    })

    const statuses = []
    for (let i = 0; i <= INVITATIONS_PER_USER; i++) {
      statuses.push((await post(`/groups/${groupId}/invitations`, { role: 1 })).status)
    }

    expect(statuses.filter((status) => status === 201)).toHaveLength(INVITATIONS_PER_USER)
    expect(statuses.at(-1)).toBe(429)
    expect(created).toBe(INVITATIONS_PER_USER)
  })
})
