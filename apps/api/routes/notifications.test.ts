import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { Hono } from "hono"
import {
  type Notification,
  NotificationMarkAllReadCommand,
  type NotificationPage,
  type NotificationRepository,
  NotificationUnreadCountQuery,
} from "@domain/notifications"
import { createNotificationCursor } from "@server/notifications/notification-cursor.ts"
import { actorFromAuth } from "../cqrs/actor.ts"
import type { APIContext } from "../_types.ts"
import { buildAuthData } from "../_testing/fake-auth.ts"
import {
  createNotificationListHandler,
  createNotificationMarkAllReadHandler,
  createNotificationMarkReadHandler,
  createNotificationUnreadCountHandler,
} from "../features/notifications/handlers.ts"
import { createNotificationsRoute } from "./notifications.ts"
import { apiError } from "../_testing/api-error.ts"

const cursor = await createNotificationCursor("a-test-secret-that-is-long-enough-123456")

const ACTOR_7 = actorFromAuth(buildAuthData({ user: { id: 7 } }))
const ACTOR_8 = actorFromAuth(buildAuthData({ user: { id: 8 } }))

const SAME_ORIGIN = {
  cookie: "sessionIdToken=1:token",
  origin: "http://local",
  "sec-fetch-site": "same-origin",
}

/** An inbox per person, in memory: ids 1-3 are user 7's, id 4 is user 8's. */
function repository(): NotificationRepository {
  const rows: (Notification & { userId: number })[] = [1, 2, 3, 4].map((id) => ({
    id: String(id),
    userId: id === 4 ? 8 : 7,
    kind: "group.removed",
    payload: { groupName: "Family" },
    link: "/groups",
    readAt: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
  }))
  const unread = (userId: number) =>
    rows.filter((r) => r.userId === userId && r.readAt === null).length
  return {
    list(userId, page: NotificationPage) {
      const mine = rows.filter((r) => r.userId === userId).reverse()
        .filter((r) => !page.after || Number(r.id) < Number(page.after.id))
      const shown = mine.slice(0, page.limit)
      return Promise.resolve({
        notifications: shown,
        nextPageKey: mine.length > page.limit ? { id: shown.at(-1)!.id } : null,
        unreadCount: unread(userId),
      })
    },
    unreadCount: (userId) => Promise.resolve(unread(userId)),
    markRead(userId, id) {
      const row = rows.find((r) => r.id === id && r.userId === userId)
      if (row && row.readAt === null) row.readAt = new Date()
      return Promise.resolve(row !== undefined)
    },
    markAllRead(userId) {
      for (const row of rows) if (row.userId === userId) row.readAt ??= new Date()
      return Promise.resolve()
    },
  }
}

function buildApp(signedInAs: number | null = 7) {
  const inbox = repository()
  const list = createNotificationListHandler(inbox)
  const unread = createNotificationUnreadCountHandler(inbox)
  const markRead = createNotificationMarkReadHandler(inbox)
  const markAllRead = createNotificationMarkAllReadHandler(inbox)
  const app = new Hono<APIContext>()
  app.use("*", async (c, next) => {
    c.set("requestId", "req-notifications-1")
    c.set("auth", signedInAs === null ? null : buildAuthData({ user: { id: signedInAs } }))
    await next()
  })
  app.route(
    "/notifications",
    createNotificationsRoute({
      list: (query) => list(query) as never,
      unreadCount: (query) => unread(query) as never,
      markRead: (command) => markRead(command) as never,
      markAllRead: (command) => markAllRead(command) as never,
      cursor,
      expectedOrigin: "http://local",
    }),
  )
  return app
}

const post = (app: Hono<APIContext>, path: string, headers: Record<string, string> = SAME_ORIGIN) =>
  app.request(`/notifications${path}`, { method: "POST", headers })

describe("GET /notifications", () => {
  it("lists the person's own notifications newest first with the unread count", async () => {
    const response = await buildApp().request("/notifications")

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.notifications.map((n: Notification) => n.id)).toEqual(["3", "2", "1"])
    expect(body.unreadCount).toBe(3)
    expect(body.nextCursor).toBeNull()
  })

  it("pages with a signed cursor and refuses one that was not issued to this person", async () => {
    const app = buildApp()
    const first = await (await app.request("/notifications?limit=2")).json()
    expect(first.notifications.map((n: Notification) => n.id)).toEqual(["3", "2"])
    expect(typeof first.nextCursor).toBe("string")

    const second = await (await app.request(
      `/notifications?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
    )).json()
    expect(second.notifications.map((n: Notification) => n.id)).toEqual(["1"])
    expect(second.nextCursor).toBeNull()

    const other = await buildApp(8).request(
      `/notifications?cursor=${encodeURIComponent(first.nextCursor)}`,
    )
    expect(other.status).toBe(400)
    expect((await apiError(other)).reason).toBe("INVALID_CURSOR")
    const forged = await app.request("/notifications?cursor=nonsense")
    expect(forged.status).toBe(400)
  })

  it("never shows another person's notification", async () => {
    const body = await (await buildApp(8).request("/notifications")).json()

    expect(body.notifications.map((n: Notification) => n.id)).toEqual(["4"])
    expect(body.unreadCount).toBe(1)
  })

  it("refuses an out-of-range limit and an anonymous request", async () => {
    const app = buildApp()
    for (const limit of ["0", "51", "abc", "-1"]) {
      const response = await app.request(`/notifications?limit=${limit}`)
      expect(response.status).toBe(400)
      expect((await apiError(response)).reason).toBe("INVALID_REQUEST")
    }
    const anonymous = await buildApp(null).request("/notifications")
    expect(anonymous.status).toBe(401)
    expect((await apiError(anonymous)).reason).toBe("AUTH_REQUIRED")
  })
})

describe("GET /notifications/unread-count", () => {
  it("answers the bell's number for the person alone", async () => {
    expect(await (await buildApp().request("/notifications/unread-count")).json()).toEqual({
      unreadCount: 3,
    })
    expect(await (await buildApp(8).request("/notifications/unread-count")).json()).toEqual({
      unreadCount: 1,
    })
  })
})

describe("POST /notifications/:id/read", () => {
  it("marks one read and answers the new unread count", async () => {
    const app = buildApp()

    const response = await post(app, "/2/read")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ unreadCount: 2 })
    // Marking it again is not an error.
    expect(await (await post(app, "/2/read")).json()).toEqual({ unreadCount: 2 })
  })

  it("answers an id that is another person's exactly as an id that does not exist", async () => {
    const app = buildApp()

    const theirs = await post(app, "/4/read")
    const nowhere = await post(app, "/999/read")

    expect(theirs.status).toBe(404)
    expect(nowhere.status).toBe(404)
    expect(await theirs.json()).toEqual(await nowhere.json())
    // Their notification stays unread for them.
    expect(await (await buildApp(8).request("/notifications/unread-count")).json()).toEqual({
      unreadCount: 1,
    })
  })

  it("refuses an id that is not a positive number", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const response = await post(buildApp(), `/${id}/read`)
      expect(response.status).toBe(400)
    }
  })

  it("refuses a request from another origin, here and on read-all", async () => {
    for (const path of ["/1/read", "/read-all"]) {
      const response = await post(buildApp(), path, {
        origin: "http://evil.example",
        "sec-fetch-site": "cross-site",
      })

      expect(response.status).toBe(403)
      expect((await apiError(response)).reason).toBe("REQUEST_ORIGIN_INVALID")
    }
  })
})

describe("POST /notifications/read-all", () => {
  it("marks only the person's own notifications read", async () => {
    const app = buildApp()

    const response = await post(app, "/read-all")

    expect(await response.json()).toEqual({ unreadCount: 0 })
    // Read back through the same inbox: the session's person had their rows marked, no one else.
    expect(await (await app.request("/notifications/unread-count")).json()).toEqual({
      unreadCount: 0,
    })
  })

  it("leaves another person's notifications unread", async () => {
    // One repository for both people, as in production.
    const inbox = repository()
    const markAll = createNotificationMarkAllReadHandler(inbox)
    const count = createNotificationUnreadCountHandler(inbox)
    await markAll(new NotificationMarkAllReadCommand({ actor: ACTOR_7 }))
    expect(await count(new NotificationUnreadCountQuery({ actor: ACTOR_8 }))).toEqual({
      unreadCount: 1,
    })
  })
})
