import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import {
  type ActivityEvent,
  type ActivityPage,
  type ActivityResult,
  type GroupAccess,
  GroupRole,
} from "@domain/groups"
import { createActivityCursor } from "@server/groups/activity-cursor.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import { createGroupActivityHandler } from "../features/groups/activity.ts"
import { createGroupActivityRoute } from "./group-activity.ts"
import { apiError } from "../_testing/api-error.ts"

const groupId = "7b6d8d6c-1af5-4f04-8ae4-b1ee5d111001"
const cursor = await createActivityCursor("a-test-secret-that-is-long-enough-123456")

function event(id: number): ActivityEvent {
  return {
    id: String(id),
    kind: "group.renamed",
    at: new Date("2026-10-01T10:00:00.000Z"),
    actor: { userId: 7, name: "Ada" },
    target: null,
    entity: null,
    details: { from: "A", to: "B" },
  }
}

/** A group whose three events are paged by the requested limit, read by a member of `role`. */
function buildApp(
  role: GroupRole | null,
  signedIn = true,
) {
  const pages: ActivityPage[] = []
  const handler = createGroupActivityHandler(
    {
      getForMember: () => Promise.resolve(role === null ? null : { role } as GroupAccess),
    },
    {
      list(_groupId, page): Promise<ActivityResult> {
        pages.push(page)
        const all = [3, 2, 1].filter((id) => !page.after || id < Number(page.after.id))
        const events = all.slice(0, page.limit).map(event)
        return Promise.resolve({
          events,
          nextPageKey: all.length > page.limit ? { id: events.at(-1)!.id } : null,
        })
      },
    },
  )
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-activity-1")
    c.set("auth", signedIn ? buildAuthData({ user: { id: 7 } }) : null)
    await next()
  })
  app.route(
    "/groups/:groupId/activity",
    createGroupActivityRoute({ list: (query) => handler(query), cursor }),
  )
  return { app, pages }
}

const get = (app: Hono<APIContext>, query = "") =>
  app.request(`/groups/${groupId}/activity${query}`)

describe("GET /groups/:groupId/activity", () => {
  for (const [name, role] of [["owner", GroupRole.OWNER], ["admin", GroupRole.ADMIN]] as const) {
    it(`lets the ${name} read the log`, async () => {
      const response = await get(buildApp(role).app)
      expect(response.status).toBe(200)
      expect((await response.json()).events.map((e: ActivityEvent) => e.id)).toEqual([
        "3",
        "2",
        "1",
      ])
    })
  }

  for (
    const [name, role] of [["editor", GroupRole.EDITOR], ["viewer", GroupRole.VIEWER]] as const
  ) {
    it(`refuses the ${name} with ROLE_INSUFFICIENT`, async () => {
      const response = await get(buildApp(role).app)
      expect(response.status).toBe(403)
      expect((await apiError(response)).reason).toBe("ROLE_INSUFFICIENT")
    })
  }

  it(`tells a stranger the group does not exist`, async () => {
    const response = await get(buildApp(null).app)
    expect(response.status).toBe(404)
    expect((await apiError(response)).reason).toBe("GROUP_NOT_FOUND")
  })

  it(`refuses a request with no session`, async () => {
    const response = await get(buildApp(GroupRole.OWNER, false).app)
    expect(response.status).toBe(401)
  })

  it(`pages with a signed cursor until nextCursor is null`, async () => {
    const { app, pages } = buildApp(GroupRole.ADMIN)
    const first = await (await get(app, `?limit=2`)).json()
    expect(first.events.map((e: ActivityEvent) => e.id)).toEqual(["3", "2"])
    expect(typeof first.nextCursor).toBe(`string`)

    const second = await (await get(app, `?limit=2&cursor=${first.nextCursor}`)).json()
    expect(second.events.map((e: ActivityEvent) => e.id)).toEqual(["1"])
    expect(second.nextCursor).toBeNull()
    expect(pages.at(-1)?.after).toEqual({ id: "2" })
  })

  it(`answers 400 for a limit outside 1 to 100 and for a forged cursor`, async () => {
    const { app } = buildApp(GroupRole.ADMIN)
    for (const limit of [`0`, `101`, `abc`]) {
      const response = await get(app, `?limit=${limit}`)
      expect(response.status).toBe(400)
      expect((await apiError(response)).reason).toBe("INVALID_REQUEST")
    }
    const forged = await get(app, `?cursor=forged`)
    expect(forged.status).toBe(400)
    expect((await apiError(forged)).reason).toBe("INVALID_CURSOR")
  })
})
