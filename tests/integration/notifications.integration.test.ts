/// <reference lib="deno.ns" />
import { expect } from "@std/expect"
import postgres from "postgres"
import { sha256Hex } from "@spy4x/platform/tokens"
import { GroupRole } from "@domain/groups"
import { NotificationKind } from "@domain/notifications"
import {
  newInvitationToken,
  PostgresInvitationRepository,
} from "@server/groups/postgres-invitation-repository.ts"
import { createNotification } from "@server/notifications/create-notification.ts"
import { PostgresNotificationRepository } from "@server/notifications/postgres-notification-repository.ts"
import { OUTBOX_CLEANUP_JOB } from "@server/jobs/jobs.ts"
import { createOutboxProcessor, startRepeatingJobs } from "@server/jobs/wiring.ts"
import { purgeNotifications } from "@server/notifications/purge-notifications.ts"
import { listenForInboxNews } from "../../apps/api/services/inbox-news.ts"
import { insertUser, team, withSchema } from "./group-team.ts"

/**
 * A person's inbox against a real Postgres built from schema.sql: the four writers create their
 * notification in the transaction of the change, the inbox is private to its owner, its pages do
 * not skip, a change reaches the live sockets only once committed, and the worker's cleanup deletes
 * read rows after 90 days. Needs "DB_HOST", "DB_USER", "DB_PASS" and "DB_NAME" (recipe in
 * docs/handoff.md); it fails when they are missing.
 */

const NO_LIMITS = { maxMembers: null, memberRoles: true }

async function inboxOf(sql: postgres.Sql, userId: number) {
  return (await new PostgresNotificationRepository(sql).list(userId, { limit: 50 }))
    .notifications
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.test("notifications: a role change, a removal and a transfer tell the person in their inbox", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, onlyHere } = await team(sql)

    await repository.changeMemberRole(groupId, editor, GroupRole.VIEWER, owner)
    await repository.removeMember(groupId, onlyHere, admin)
    await repository.transferOwnership(groupId, admin, owner)

    const [role] = await inboxOf(sql, editor)
    expect(role.kind).toBe(NotificationKind.RoleChanged)
    expect(role.payload).toEqual({ groupName: "Team", from: "editor", to: "viewer" })
    expect(role.link).toBe(`/groups/${groupId}`)
    const [removed] = await inboxOf(sql, onlyHere)
    expect(removed.kind).toBe(NotificationKind.RemovedFromGroup)
    expect(removed.link).toBe("/groups")
    const [handed] = await inboxOf(sql, admin)
    expect(handed.kind).toBe(NotificationKind.OwnershipReceived)
    expect(handed.link).toBe(`/groups/${groupId}`)
    // Nobody is told about a change that was theirs: the actors' inboxes stay empty.
    expect(await inboxOf(sql, owner)).toEqual([])
  })
})

Deno.test("notifications: setting a role a member already has tells them nothing", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, editor } = await team(sql)

    await repository.changeMemberRole(groupId, editor, GroupRole.EDITOR, owner)

    expect(await inboxOf(sql, editor)).toEqual([])
  })
})

Deno.test("notifications: an invitation tells the existing account that proved the address, and no one else", async () => {
  await withSchema(async (sql) => {
    const { groupId, admin, stranger, viewer } = await team(sql)
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES
      ('sam@example.com', ${stranger}), ('vi@example.com', ${viewer})`
    const invitations = new PostgresInvitationRepository(sql)
    const send = async (email: string | null) =>
      await invitations.create(
        {
          groupId,
          role: GroupRole.EDITOR,
          expiresInDays: 7,
          maxUses: 1,
          email,
          tokenHash: await sha256Hex(newInvitationToken()),
        },
        admin,
        NO_LIMITS,
      )

    await send(`sam@example.com`)
    await send(null)
    // The viewer is a member already: the invitation to their address is not news to them.
    await send(`vi@example.com`)
    await send(`nobody@example.com`)

    const [invited] = await inboxOf(sql, stranger)
    expect(invited.kind).toBe(NotificationKind.InvitationReceived)
    expect(invited.payload).toEqual({ groupName: "Team", role: "editor" })
    expect(await inboxOf(sql, stranger)).toHaveLength(1)
    expect(await inboxOf(sql, viewer)).toEqual([])
    const [{ count }] = await sql<
      { count: number }[]
    >`SELECT count(*)::int AS count FROM notifications`
    expect(count).toBe(1)
  })
})

Deno.test("notifications: each writer's notification is written in its change's transaction", async () => {
  await withSchema(async (sql) => {
    const { repository, groupId, owner, admin, editor, onlyHere, stranger } = await team(sql)
    await sql`INSERT INTO auth_email_owners (email, user_id) VALUES ('sam@example.com', ${stranger})`
    // Test-only: every change below ends in a failure at commit, after its notification was written.
    await sql.unsafe(`
      CREATE FUNCTION force_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced failure at commit'; END $$;
      CREATE CONSTRAINT TRIGGER fail_member_change AFTER UPDATE OR DELETE ON group_members
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION force_commit_failure();
      CREATE CONSTRAINT TRIGGER fail_group_change AFTER UPDATE ON groups
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION force_commit_failure();
      CREATE CONSTRAINT TRIGGER fail_invitation AFTER INSERT ON group_invitations
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION force_commit_failure();
    `)
    const heard: number[] = []
    const stop = await listenForInboxNews(sql, { notifyUserChange: (id) => heard.push(id) })
    try {
      const invitations = new PostgresInvitationRepository(sql)
      const changes: Record<string, () => Promise<unknown>> = {
        "role change": () => repository.changeMemberRole(groupId, editor, GroupRole.VIEWER, owner),
        "removal": () => repository.removeMember(groupId, onlyHere, admin),
        "ownership transfer": () => repository.transferOwnership(groupId, admin, owner),
        "invitation": async () =>
          await invitations.create(
            {
              groupId,
              role: GroupRole.EDITOR,
              expiresInDays: 7,
              maxUses: 1,
              email: "sam@example.com",
              tokenHash: await sha256Hex(newInvitationToken()),
            },
            admin,
            NO_LIMITS,
          ),
      }
      for (const [name, change] of Object.entries(changes)) {
        await expect(change(), name).rejects.toThrow()
      }
      await sleep(300)
      const [{ count }] = await sql<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM notifications`
      expect(count).toBe(0)
      expect(heard).toEqual([])
    } finally {
      await stop()
    }
  })
})

Deno.test("notifications: a change that rolls back leaves no notification and no hint", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    const heard: number[] = []
    const stop = await listenForInboxNews(sql, { notifyUserChange: (id) => heard.push(id) })
    try {
      await sql.begin(async (transaction) => {
        await createNotification(transaction, {
          userId: owner,
          kind: NotificationKind.RemovedFromGroup,
          link: "/groups",
          payload: { groupName: "Gone" },
        })
        throw new Error("the change failed after the notification")
      }).catch(() => {})
      await sleep(300)
      expect(await inboxOf(sql, owner)).toEqual([])
      expect(heard).toEqual([])

      await sql.begin((transaction) =>
        createNotification(transaction, {
          userId: owner,
          kind: NotificationKind.RemovedFromGroup,
          link: "/groups",
          payload: { groupName: "Kept" },
        })
      )
      const deadline = Date.now() + 5_000
      while (heard.length === 0 && Date.now() < deadline) await sleep(20)
      expect(heard).toEqual([owner])
      expect(await inboxOf(sql, owner)).toHaveLength(1)
    } finally {
      await stop()
    }
  })
})

Deno.test("notifications: reading and marking read tells the person's sockets, and a repeat does not", async () => {
  await withSchema(async (sql) => {
    const { owner, stranger } = await team(sql)
    const inbox = new PostgresNotificationRepository(sql)
    for (const userId of [owner, owner, stranger]) {
      await createNotification(sql, {
        userId,
        kind: NotificationKind.OwnershipReceived,
        link: "/groups",
        payload: {},
      })
    }
    const heard: number[] = []
    const stop = await listenForInboxNews(sql, { notifyUserChange: (id) => heard.push(id) })
    try {
      const [first] = (await inbox.list(owner, { limit: 10 })).notifications
      expect(await inbox.markRead(owner, first.id)).toBe(true)
      await sleep(300)
      expect(heard).toEqual([owner])
      expect(await inbox.unreadCount(owner)).toBe(1)

      // Marking it again changes nothing, so it announces nothing.
      expect(await inbox.markRead(owner, first.id)).toBe(true)
      await sleep(300)
      expect(heard).toEqual([owner])

      await inbox.markAllRead(owner)
      await sleep(300)
      expect(heard).toEqual([owner, owner])
      expect(await inbox.unreadCount(owner)).toBe(0)
      expect(await inbox.unreadCount(stranger)).toBe(1)
    } finally {
      await stop()
    }
  })
})

Deno.test("notifications: a person can neither read nor mark another person's notification", async () => {
  await withSchema(async (sql) => {
    const { owner, stranger } = await team(sql)
    const inbox = new PostgresNotificationRepository(sql)
    await createNotification(sql, {
      userId: owner,
      kind: NotificationKind.OwnershipReceived,
      link: "/groups",
      payload: {},
    })
    const [mine] = (await inbox.list(owner, { limit: 10 })).notifications

    expect((await inbox.list(stranger, { limit: 10 })).notifications).toEqual([])
    // Someone else's id and an id that exists nowhere answer the same: not found.
    expect(await inbox.markRead(stranger, mine.id)).toBe(false)
    expect(await inbox.markRead(stranger, "999999999")).toBe(false)
    await inbox.markAllRead(stranger)
    expect(await inbox.unreadCount(owner)).toBe(1)
    expect((await inbox.list(owner, { limit: 10 })).notifications[0].readAt).toBeNull()
  })
})

Deno.test("notifications: pages follow each other without skipping or repeating a row", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    const inbox = new PostgresNotificationRepository(sql)
    for (let i = 1; i <= 5; i++) {
      await createNotification(sql, {
        userId: owner,
        kind: NotificationKind.RemovedFromGroup,
        link: "/groups",
        payload: { groupName: `G${i}` },
      })
    }

    const seen: string[] = []
    let after: { id: string } | undefined
    do {
      const page = await inbox.list(owner, { limit: 2, after })
      seen.push(...page.notifications.map((n) => String(n.payload.groupName)))
      expect(page.unreadCount).toBe(5)
      after = page.nextPageKey ?? undefined
    } while (after)

    expect(seen).toEqual(["G5", "G4", "G3", "G2", "G1"])
  })
})

Deno.test("notifications: the cleanup deletes read ones after 90 days and keeps the rest", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    const kinds = ["old-read", "recent-read", "old-unread", "just-read"]
    for (const kind of kinds) {
      await createNotification(sql, { userId: owner, kind, link: "/groups", payload: {} })
    }
    await sql`UPDATE notifications SET read_at = now() - interval '91 days'
      WHERE kind = 'old-read'`
    await sql`UPDATE notifications SET read_at = now() - interval '89 days'
      WHERE kind = 'recent-read'`
    await sql`UPDATE notifications SET created_at = now() - interval '200 days'
      WHERE kind = 'old-unread'`
    await sql`UPDATE notifications SET read_at = now() WHERE kind = 'just-read'`

    expect(await purgeNotifications(sql)).toBe(1)

    const left = (await sql<{ kind: string }[]>`SELECT kind FROM notifications ORDER BY kind`)
      .map((row) => row.kind)
    expect(left).toEqual(["just-read", "old-unread", "recent-read"])
  })
})

Deno.test("notifications: the cleanup deletes unread ones a year after they were created", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    const kinds = ["year-old-unread", "younger-unread", "year-old-read-recently"]
    for (const kind of kinds) {
      await createNotification(sql, { userId: owner, kind, link: "/groups", payload: {} })
    }
    await sql`UPDATE notifications SET created_at = now() - interval '366 days'
      WHERE kind IN ('year-old-unread', 'year-old-read-recently')`
    await sql`UPDATE notifications SET created_at = now() - interval '364 days'
      WHERE kind = 'younger-unread'`
    // Reading it starts the read clock: an old notification read last week stays its 90 days.
    await sql`UPDATE notifications SET read_at = now() - interval '7 days'
      WHERE kind = 'year-old-read-recently'`

    expect(await purgeNotifications(sql)).toBe(1)

    const left = (await sql<{ kind: string }[]>`SELECT kind FROM notifications ORDER BY kind`)
      .map((row) => row.kind)
    expect(left).toEqual(["year-old-read-recently", "younger-unread"])
  })
})

Deno.test("notifications: a deleted account takes its notifications with it", async () => {
  await withSchema(async (sql) => {
    const gone = await insertUser(sql)
    const stays = await insertUser(sql)
    for (const userId of [gone, stays]) {
      await createNotification(sql, {
        userId,
        kind: NotificationKind.OwnershipReceived,
        link: "/groups",
        payload: {},
      })
    }

    await sql`DELETE FROM users WHERE id = ${gone}`

    expect(await inboxOf(sql, gone)).toEqual([])
    expect(await inboxOf(sql, stays)).toHaveLength(1)
  })
})

Deno.test("notifications: a link that leaves the app is refused before it is stored", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    for (
      const link of [
        "https://evil.example/",
        "//evil.example",
        "/\\evil.example",
        "",
        "/\t/evil.example",
      ]
    ) {
      await expect(
        createNotification(sql, { userId: owner, kind: "x", link, payload: {} }),
      ).rejects.toThrow()
    }
    expect(await inboxOf(sql, owner)).toEqual([])
    // The database refuses them too, whatever writes the row: a browser drops a tab, a line feed
    // or a carriage return inside a link, so "/\t/evil.example" would open https://evil.example.
    for (const link of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example"]) {
      await expect(
        sql`INSERT INTO notifications (user_id, kind, link, payload)
            VALUES (${owner}, 'x', ${link}, '{}')`,
        JSON.stringify(link),
      ).rejects.toThrow(/notifications_link_check/)
    }
  })
})

Deno.test("notifications: a link is stored in its normalized form", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    await createNotification(sql, { userId: owner, kind: "space", link: "/a b", payload: {} })
    await createNotification(sql, { userId: owner, kind: "dots", link: "/a/../b", payload: {} })
    const links = Object.fromEntries((await inboxOf(sql, owner)).map((n) => [n.kind, n.link]))
    expect(links).toEqual({ space: "/a%20b", dots: "/b" })
  })
})

Deno.test("notifications: the worker's nightly cleanup runs the purge of old notifications", async () => {
  await withSchema(async (sql) => {
    const { owner } = await team(sql)
    for (const kind of ["old-read", "old-unread", "unread"]) {
      await createNotification(sql, { userId: owner, kind, link: "/groups", payload: {} })
    }
    await sql`UPDATE notifications SET read_at = now() - interval '91 days' WHERE kind = 'old-read'`
    await sql`UPDATE notifications SET created_at = now() - interval '366 days'
      WHERE kind = 'old-unread'`
    const processor = createOutboxProcessor(sql, {
      store: {} as never,
      sender: { send: () => Promise.reject(new Error("no mail in this test")) },
      brand: { webAppUrl: "http://app.localhost" },
      log: () => {},
    })

    // Started two days ago: its first 03:00 UTC run is due, and the next one it writes differs.
    await startRepeatingJobs(sql, new Date(Date.now() - 2 * 86_400_000))
    await sql`
      UPDATE outbox_events SET available_at = now() - interval '1 second'
      WHERE event_kind = ${OUTBOX_CLEANUP_JOB} AND processed_at IS NULL
    `
    expect((await processor.drainOnce()).failed).toBe(0)

    const left = (await sql<{ kind: string }[]>`SELECT kind FROM notifications`).map((r) => r.kind)
    expect(left).toEqual(["unread"])
  })
})
